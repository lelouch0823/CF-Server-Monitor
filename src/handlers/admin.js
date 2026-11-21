import * as authMiddleware from '../middleware/auth.js';
import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, clearServersListCache } from '../utils/cache.js';
import {
  clearAppearanceSettingsCache,
  generateRandomSecret,
  isValidThemeOptions,
  isWssReportConfigured,
  isWssReportEnabled,
  normalizeBooleanSetting,
  normalizeDefaultLanguage,
  normalizeDisplayMode,
  normalizeExpireNotificationTime,
  normalizeExpireReminder,
  normalizeFrontendWsTimeoutMinutes,
  normalizeLongHistoryPoints,
  normalizeNotificationLanguage,
  normalizeNotificationTemplate,
  normalizeNotificationTimezone,
  normalizeNotificationWebhookBody,
  normalizeNotificationWebhookFormat,
  normalizeNotificationWebhookHeaders,
  normalizeNotificationWebhookMethod,
  normalizePreferredTheme,
  normalizeResourceAlertRules,
  normalizeTgNotify,
  normalizeTrafficAlertThreshold,
  normalizeWssReportHours,
  saveSiteOptions,
  saveThemeOptions,
  validateTextSetting,
  validateUserAgent,
  TEXT_SETTING_MAX_LENGTHS,
  SITE_FIELDS,
  APPEARANCE_FIELDS
} from '../utils/settings.js';
import { mergeMetricsIntoServer, toSafeMetricFloat } from '../utils/metrics.js';
import { normalizePctOrNull } from '../utils/traffic.js';
import { verifyTurnstileToken, hashPassword } from '../utils/common.js';
import { AppError, createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createErrorResponse } from '../utils/errors.js';
import { addServerColumns } from '../database/updateDatabase.js';
import { clearResourceAlertState, isSmtpNotificationTarget, sendNotification } from '../services/notification.js';
import { getNotificationMessages } from '../services/notificationMessages.js';
import {
  getHistoryIdRange,
  getNextServerHistoryPartitionId,
  HISTORY_MAX_PARTITION_ID,
  isHistoryPartitionUniqueError,
  normalizeHistoryPartitionId
} from '../database/indexOptimization.js';
import { isValidTrafficCorrection, normalizeConnectionMode, normalizePingMode, normalizeWssReportInterval, validateAgentConfigInput, validatePingNode, validateNetworkInterfaces } from '../utils/agentConfig.js';
import { scheduleAgentConfigChanged, scheduleAgentReportModeChanged, scheduleBroadcasterInvalidate } from '../utils/agentConfigNotify.js';
import { clearLatestReportCache } from '../utils/latestReportCache.js';
import { detectBillingCycle, detectCurrencySymbol, normalizeBillingCycle, normalizeCurrency, normalizePrice, parseDateOnly, renewExpireDateIfNeeded } from '../utils/serverBilling.js';
import { THEME_PREVIEW_AUTH_TTL_SECONDS } from '../utils/config.js';
import { readBoundedJsonObject } from './update.js';

const {
  AUTH_COOKIE_NAME,
  buildAuthCookie,
  buildClearAuthCookie,
  checkAuth,
  simpleAuthResponse,
  validateCredentials,
  generateToken
} = authMiddleware;

const PING_NODE_FIELDS = ['custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'node_1', 'node_2', 'node_3', 'node_4'];
const THEME_PREVIEW_AUTH_COOKIE = 'cfsm_theme_preview_auth';
const DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO = 20;
const ADMIN_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const ADMIN_MAX_BATCH_ITEMS = 1000;
const D1_MUTATION_BATCH_SIZE = 50;
const VALID_TRAFFIC_CALC_TYPES = new Set(['total', 'ul', 'dl', 'max']);
const IMPORT_MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const IMPORT_MAX_FUTURE_DRIFT_MS = 60 * 1000;

const IMPORT_SERVER_COLUMNS = Object.freeze([
  'id', 'name', 'server_group', 'region', 'tags', 'note',
  'price', 'billing_cycle', 'auto_renewal', 'currency', 'expire_date',
  'traffic_limit', 'traffic_calc_type', '"interface"',
  'reset_day', 'collect_interval', 'report_interval', 'wss_report_interval',
  'connection_mode', 'ping_mode', 'auto_update',
  'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd',
  'node_1', 'node_2', 'node_3', 'node_4',
  'rx_correction', 'tx_correction',
  'offline_notify_disabled', 'is_hidden',
  'sort_order', 'history_partition_id', 'timestamp', 'traffic_alert_percent'
]);
const IMPORT_SERVER_PLACEHOLDERS = IMPORT_SERVER_COLUMNS.map(() => '?').join(', ');

function toUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function isDurableObjectsHibernationInvocationType(value) {
  const type = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!type) return false;
  return type.includes('hibernation') || (type.includes('websocket') && type.includes('message'));
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? '1' : '0';
}

function normalizeServerRegion(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

function normalizeServerBillingData(data = {}) {
  const billingCycle = normalizeBillingCycle(data.billing_cycle || detectBillingCycle(data.price));
  const autoRenewal = normalizeBooleanFlag(data.auto_renewal);

  return {
    price: normalizePrice(data.price),
    billing_cycle: billingCycle,
    auto_renewal: autoRenewal,
    currency: normalizeCurrency(data.currency || detectCurrencySymbol(data.price) || '¥'),
    expire_date: renewExpireDateIfNeeded(
      data.expire_date || '',
      billingCycle,
      autoRenewal
    ).expire_date
  };
}

function isValidUUID(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function isValidName(name) {
  return name && typeof name === 'string' && name.trim().length > 0 && name.length <= 100;
}

function isMissingColumnError(error) {
  const message = error?.message || String(error);
  return /no such column|has no column/i.test(message);
}

async function handleServerMutationError(db, error, fallbackMessage) {
  if (isMissingColumnError(error)) {
    console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
    await addServerColumns(db);
    return createBadRequestResponse('dbColumnsAdded');
  }

  const errMsg = error?.message || String(error);
  return createBadRequestResponse(errMsg || fallbackMessage);
}

function sanitizeCspDomains(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .split(',')
    .map(s => s.trim())
    .map(normalizeCspOrigin)
    .filter(Boolean)
    .filter((domain, index, arr) => arr.indexOf(domain) === index)
    .join(',');
}

function normalizeCspOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\s;"']/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname && url.pathname !== '/') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function normalizePingNodeFields(source, fields = PING_NODE_FIELDS) {
  const values = {};
  for (const field of fields) {
    if (source?.[field] === undefined) continue;
    const result = validatePingNode(source[field]);
    if (!result.valid) {
      return { valid: false, field };
    }
    // Keep the disabled-node sentinel as text so D1 does not coerce it to 0.0 in TEXT columns.
    values[field] = source[field] === 0 || source[field] === '0' ? '0' : result.value;
  }
  return { valid: true, values };
}

function normalizeImportedPingNodeValue(value) {
  return value === null || value === undefined ? '' : value;
}

function normalizeNetworkInterfaceField(value) {
  const result = validateNetworkInterfaces(value);
  if (!result.valid) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: result.value };
}

function hasAppearanceInput(settings) {
  if (settings.appearance_options !== undefined) return true;
  return APPEARANCE_FIELDS
    .filter(field => field !== 'theme_options')
    .some(field => settings[field] !== undefined);
}

function extractBearerToken(request) {
  const authHeader = request?.headers?.get?.('Authorization') || '';
  const parts = authHeader.trim().split(/\s+/);
  return parts[0] === 'Bearer' && parts[1] ? parts[1] : '';
}

function getCookieValue(request, name) {
  const cookie = request?.headers?.get?.('Cookie') || '';
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch (_) {
      return item.slice(prefix.length);
    }
  }
  return '';
}

async function resolveVerifiedPreviewToken(request, env, sys) {
  if (typeof authMiddleware.getVerifiedAuthToken === 'function') {
    return (await authMiddleware.getVerifiedAuthToken(request, env, sys)) || '';
  }

  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    const bearerOnlyRequest = new Request(request.url, {
      headers: { Authorization: `Bearer ${bearerToken}` }
    });
    if (await checkAuth(bearerOnlyRequest, env, sys)) {
      return bearerToken;
    }
  }

  const cookieHeader = request?.headers?.get?.('Cookie') || '';
  if (cookieHeader) {
    const cookieOnlyRequest = new Request(request.url, {
      headers: { Cookie: cookieHeader }
    });
    if (await checkAuth(cookieOnlyRequest, env, sys)) {
      return getCookieValue(request, AUTH_COOKIE_NAME || 'cfsm_auth');
    }
  }

  return '';
}

function buildThemePreviewUrl(request, themeUrl) {
  const previewUrl = new URL('/', request.url);
  previewUrl.searchParams.set('theme_url', themeUrl);
  return previewUrl.toString();
}

function buildThemePreviewAuthCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${THEME_PREVIEW_AUTH_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function buildClearThemePreviewAuthCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function createSuccessResponseWithCookies(data, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) {
    if (cookie) headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(data), { status: 200, headers });
}

function normalizeThemeUrl(value) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    const ref = parts[3];
    if (
      parts.length < 4 ||
      parts[2] !== 'tree' ||
      !/^[A-Za-z0-9._-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9._-]+$/.test(ref) ||
      parts.some(part => part === '.' || part === '..' || /[%\\]/.test(part))
    ) {
      return null;
    }

    return `https://github.com/${parts.join('/')}`;
  } catch (_) {
    return null;
  }
}

function getThemeRawIndexUrl(themeUrl) {
  const normalized = normalizeThemeUrl(themeUrl);
  if (!normalized) return '';

  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  const themePath = [owner, repo, ref, ...parts.slice(4)]
    .map(part => encodeURIComponent(part))
    .join('/');
  return `https://raw.githubusercontent.com/${themePath}/index.html`;
}

async function validateThemeUrlAvailable(themeUrl) {
  if (!themeUrl) return true;

  const rawIndexUrl = getThemeRawIndexUrl(themeUrl);
  if (!rawIndexUrl) return false;

  try {
    const res = await fetch(rawIndexUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'CFSM-Theme-Validate' }
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function executeBatchedStatements(db, statements, chunkSize = D1_MUTATION_BATCH_SIZE) {
  for (let offset = 0; offset < statements.length; offset += chunkSize) {
    const chunk = statements.slice(offset, offset + chunkSize);
    if (typeof db.batch === 'function') {
      await db.batch(chunk);
    } else {
      for (const stmt of chunk) {
        await stmt.run();
      }
    }
  }
}

async function deleteServersAndHistory(db, ids) {
  const uniqueIds = Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  ));
  if (uniqueIds.length === 0) return;

  const partitionIds = new Set();
  for (let offset = 0; offset < uniqueIds.length; offset += D1_MUTATION_BATCH_SIZE) {
    const chunkIds = uniqueIds.slice(offset, offset + D1_MUTATION_BATCH_SIZE);
    const placeholders = chunkIds.map(() => '?').join(', ');
    const queryResult = await db.prepare(
      `SELECT id, history_partition_id FROM servers WHERE id IN (${placeholders})`
    ).bind(...chunkIds).all();
    for (const row of queryResult?.results || []) {
      const partitionId = normalizeHistoryPartitionId(row?.history_partition_id);
      if (partitionId) {
        partitionIds.add(partitionId);
      }
    }
  }

  let oldTableExists = false;
  if (partitionIds.size > 0) {
    try {
      const oldTableRow = await db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
      ).first();
      oldTableExists = Boolean(oldTableRow);
    } catch (_) {
      oldTableExists = false;
    }
  }

  const historyDeleteStatements = [];
  for (const partitionId of partitionIds) {
    const { startId, endId } = getHistoryIdRange(partitionId);
    historyDeleteStatements.push(
      db.prepare('DELETE FROM metrics_history WHERE id >= ? AND id <= ?').bind(startId, endId)
    );
    if (oldTableExists) {
      historyDeleteStatements.push(
        db.prepare('DELETE FROM metrics_history_old WHERE id >= ? AND id <= ?').bind(startId, endId)
      );
    }
  }

  const serverDeleteStatements = uniqueIds.map(id =>
    db.prepare('DELETE FROM servers WHERE id = ?').bind(id)
  );

  try {
    await executeBatchedStatements(
      db,
      [...historyDeleteStatements, ...serverDeleteStatements],
      D1_MUTATION_BATCH_SIZE
    );
  } catch (e) {
    const msg = e?.message || String(e || '');
    if (!/no such table:\s*metrics_history/i.test(msg)) {
      throw e;
    }
    // 全新未初始化 metrics_history 表时，容错跳过不存在的历史表并继续删除 servers 行
    for (const stmt of historyDeleteStatements) {
      try {
        await stmt.run();
      } catch (histErr) {
        if (!/no such table:\s*metrics_history/i.test(histErr?.message || String(histErr || ''))) {
          throw histErr;
        }
      }
    }
    await executeBatchedStatements(db, serverDeleteStatements, D1_MUTATION_BATCH_SIZE);
  }
}

async function deleteServer(db, id) {
  await deleteServersAndHistory(db, [id]);
}

function getUtcTodayRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86400000 - 1);
  return {
    date: start.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function getUtcYesterdayRange() {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(todayStart.getTime() - 86400000);
  const end = new Date(todayStart.getTime() - 1);
  return {
    date: start.toISOString().slice(0, 10),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

async function cloudflareGraphql(query, variables, token) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json();
  if (!response.ok || data.errors) {
    const message = data.errors && data.errors.length > 0 ? data.errors.map(e => e.message).join('; ') : 'Cloudflare GraphQL request failed';
    throw new Error(message);
  }
  return data.data;
}

function estimateDurableObjectsWebSocketBillableRequests(messages) {
  const count = toUsageNumber(messages);
  if (count <= 0) return 0;
  return Math.ceil(count / DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO);
}

export function estimateDurableObjectsBillableRequests(breakdown = {}) {
  if (breakdown === null || typeof breakdown !== 'object') {
    return estimateDurableObjectsWebSocketBillableRequests(breakdown);
  }

  const httpRequests = toUsageNumber(breakdown.httpRequests);
  const hibernationWakeups = toUsageNumber(breakdown.hibernationWakeups);
  const inboundWebSocketMessages = toUsageNumber(breakdown.inboundWebSocketMessages);

  return Math.ceil(httpRequests) +
    Math.ceil(hibernationWakeups) +
    estimateDurableObjectsWebSocketBillableRequests(inboundWebSocketMessages);
}

export function summarizeDurableObjectsUsage(invocationGroups = [], periodicGroups = []) {
  const summary = {
    httpRequests: 0,
    hibernationWakeups: 0,
    inboundWebSocketMessages: 0,
    outboundWebSocketMessages: 0,
    rawRequests: 0,
    billableRequests: 0
  };

  for (const group of invocationGroups || []) {
    const requests = toUsageNumber(group?.sum?.requests);
    summary.rawRequests += requests;
    if (isDurableObjectsHibernationInvocationType(group?.dimensions?.type)) {
      summary.hibernationWakeups += requests;
    } else {
      summary.httpRequests += requests;
    }
  }

  for (const group of periodicGroups || []) {
    summary.inboundWebSocketMessages += toUsageNumber(group?.sum?.inboundWebsocketMsgCount);
    summary.outboundWebSocketMessages += toUsageNumber(group?.sum?.outboundWebsocketMsgCount);
  }

  summary.billableRequests = estimateDurableObjectsBillableRequests(summary);
  return summary;
}

async function fetchCloudflareUsage(token, accountId, range) {
  const query = `query CloudflareUsage($accountTag: string!, $start: Date, $end: Date, $startTime: Time!, $endTime: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { rowsRead rowsWritten }
          dimensions { databaseId }
        }
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $startTime, datetime_leq: $endTime }
        ) {
          sum { requests }
        }
        durableObjectsInvocationsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { requests }
          dimensions { type }
        }
        durableObjectsPeriodicGroups(
          limit: 10000
          filter: { date_geq: $start, date_leq: $end }
        ) {
          sum { duration inboundWebsocketMsgCount outboundWebsocketMsgCount }
        }
      }
    }
  }`;
  const data = await cloudflareGraphql(query, {
    accountTag: accountId,
    start: range.start,
    end: range.end,
    startTime: range.startTime,
    endTime: range.endTime
  }, token);
  const account = data.viewer?.accounts?.[0] || {};
  const groups = account.d1AnalyticsAdaptiveGroups || [];
  const usage = groups.reduce((total, group) => {
    total.rowsRead += Number(group.sum?.rowsRead || 0);
    total.rowsWritten += Number(group.sum?.rowsWritten || 0);
    return total;
  }, { rowsRead: 0, rowsWritten: 0 });
  const workersRequests = (account.workersInvocationsAdaptive || []).reduce((total, group) => {
    return total + Number(group.sum?.requests || 0);
  }, 0);
  const durableObjectsUsage = summarizeDurableObjectsUsage(
    account.durableObjectsInvocationsAdaptiveGroups || [],
    account.durableObjectsPeriodicGroups || []
  );
  const durableObjectsDuration = (account.durableObjectsPeriodicGroups || []).reduce((total, group) => {
    return total + Number(group.sum?.duration || 0);
  }, 0);
  return {
    rowsRead: usage.rowsRead,
    rowsWritten: usage.rowsWritten,
    workersRequests,
    durableObjectsRequests: durableObjectsUsage.billableRequests,
    durableObjectsHttpRequests: durableObjectsUsage.httpRequests,
    durableObjectsHibernationWakeups: durableObjectsUsage.hibernationWakeups,
    durableObjectsInboundWebSocketMessages: durableObjectsUsage.inboundWebSocketMessages,
    durableObjectsOutboundWebSocketMessages: durableObjectsUsage.outboundWebSocketMessages,
    durableObjectsRawRequests: durableObjectsUsage.rawRequests,
    durableObjectsRequestsEstimated: true,
    durableObjectsRequestBillingRatio: DURABLE_OBJECTS_WEBSOCKET_MESSAGE_BILLING_RATIO,
    durableObjectsDuration,
    databaseCount: groups.length
  };
}

async function getD1DailyUsage(token, accountId) {
  if (!token) throw new Error('cloudflareTokenRequired');
  if (!accountId) throw new Error('cloudflareAccountIdRequired');

  const todayRange = getUtcTodayRange();
  const yesterdayRange = getUtcYesterdayRange();

  const [todayUsage, yesterdayUsage] = await Promise.all([
    fetchCloudflareUsage(token, accountId, todayRange),
    fetchCloudflareUsage(token, accountId, yesterdayRange)
  ]);

  const yesterday = {
    rowsRead: yesterdayUsage.rowsRead,
    rowsWritten: yesterdayUsage.rowsWritten,
    workersRequests: yesterdayUsage.workersRequests,
    durableObjectsRequests: yesterdayUsage.durableObjectsRequests,
    durableObjectsHttpRequests: yesterdayUsage.durableObjectsHttpRequests,
    durableObjectsHibernationWakeups: yesterdayUsage.durableObjectsHibernationWakeups,
    durableObjectsInboundWebSocketMessages: yesterdayUsage.durableObjectsInboundWebSocketMessages,
    durableObjectsOutboundWebSocketMessages: yesterdayUsage.durableObjectsOutboundWebSocketMessages,
    durableObjectsRawRequests: yesterdayUsage.durableObjectsRawRequests,
    durableObjectsRequestsEstimated: yesterdayUsage.durableObjectsRequestsEstimated,
    durableObjectsRequestBillingRatio: yesterdayUsage.durableObjectsRequestBillingRatio,
    durableObjectsDuration: yesterdayUsage.durableObjectsDuration
  };

  return {
    today: {
      rowsRead: todayUsage.rowsRead,
      rowsWritten: todayUsage.rowsWritten,
      workersRequests: todayUsage.workersRequests,
      durableObjectsRequests: todayUsage.durableObjectsRequests,
      durableObjectsHttpRequests: todayUsage.durableObjectsHttpRequests,
      durableObjectsHibernationWakeups: todayUsage.durableObjectsHibernationWakeups,
      durableObjectsInboundWebSocketMessages: todayUsage.durableObjectsInboundWebSocketMessages,
      durableObjectsOutboundWebSocketMessages: todayUsage.durableObjectsOutboundWebSocketMessages,
      durableObjectsRawRequests: todayUsage.durableObjectsRawRequests,
      durableObjectsRequestsEstimated: todayUsage.durableObjectsRequestsEstimated,
      durableObjectsRequestBillingRatio: todayUsage.durableObjectsRequestBillingRatio,
      durableObjectsDuration: todayUsage.durableObjectsDuration
    },
    yesterday
  };
}

// 登录失败节流：按客户端 IP 维护带容量上限（LRU）的内存滑动窗口计数，
// 防止攻击者故意触发全局锁定封死真实管理员，同时抑制 PBKDF2 算力放大。
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LOCK_THRESHOLD = 5;
const LOGIN_FAILURE_LOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_MAX_IPS = 1000;
const LOGIN_USERNAME_MAX_LENGTH = 128;
const LOGIN_PASSWORD_MAX_LENGTH = 256;
const loginFailureMap = new Map();

export function resetLoginFailureStateForTests() {
  loginFailureMap.clear();
}

function getClientIpKey(request) {
  const raw = String(request?.headers?.get?.('CF-Connecting-IP') || '').trim();
  return raw ? raw.slice(0, 128) : 'local';
}

function pruneLoginFailureMap(now) {
  for (const [ip, state] of loginFailureMap) {
    if (!state) {
      loginFailureMap.delete(ip);
      continue;
    }
    if (state.lockedUntil > 0 && state.lockedUntil <= now) {
      loginFailureMap.delete(ip);
      continue;
    }
    if (!state.lockedUntil && state.firstFailureTs > 0 && now - state.firstFailureTs > LOGIN_FAILURE_WINDOW_MS) {
      loginFailureMap.delete(ip);
    }
  }

  while (loginFailureMap.size > LOGIN_FAILURE_MAX_IPS) {
    const oldestKey = loginFailureMap.keys().next().value;
    if (oldestKey === undefined) break;
    loginFailureMap.delete(oldestKey);
  }
}

function isLoginLocked(clientIp, now) {
  const state = loginFailureMap.get(clientIp);
  if (!state) return false;
  if (state.lockedUntil > now) {
    // Refresh LRU order on active lock hit
    loginFailureMap.delete(clientIp);
    loginFailureMap.set(clientIp, state);
    return true;
  }
  if (state.lockedUntil && state.lockedUntil <= now) {
    loginFailureMap.delete(clientIp);
  }
  return false;
}

function recordLoginFailure(clientIp, now) {
  pruneLoginFailureMap(now);
  const existing = loginFailureMap.get(clientIp);
  let nextState;
  if (!existing || !existing.firstFailureTs || now - existing.firstFailureTs > LOGIN_FAILURE_WINDOW_MS) {
    nextState = { count: 1, firstFailureTs: now, lockedUntil: 0 };
  } else {
    const nextCount = existing.count + 1;
    if (nextCount >= LOGIN_FAILURE_LOCK_THRESHOLD) {
      nextState = { count: 0, firstFailureTs: 0, lockedUntil: now + LOGIN_FAILURE_LOCK_MS };
    } else {
      nextState = { count: nextCount, firstFailureTs: existing.firstFailureTs, lockedUntil: 0 };
    }
  }
  loginFailureMap.delete(clientIp);
  loginFailureMap.set(clientIp, nextState);
  pruneLoginFailureMap(now);
}

function recordLoginSuccess(clientIp) {
  loginFailureMap.delete(clientIp);
}

async function handleLoginAction({ request, env, sys, data }) {
  const { username, password } = data;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return createBadRequestResponse('missingCredentials');
  }
  if (username.length > LOGIN_USERNAME_MAX_LENGTH || password.length > LOGIN_PASSWORD_MAX_LENGTH) {
    return createBadRequestResponse('invalidCredentials');
  }

  const turnstileEnabled = normalizeBooleanSetting(sys?.turnstile_enabled) === 'true';
  const turnstileLoginEnabled = normalizeBooleanSetting(sys?.turnstile_login_enabled) === 'true';
  const turnstileSecretKey = sys && sys.turnstile_secret_key || '';

  // 启用登录 Turnstile 时，先验证 Turnstile 再检查/累计登录失败次数
  if (turnstileEnabled || turnstileLoginEnabled) {
    const turnstileToken = request.headers.get('X-Turnstile-Token');
    const isTurnstileVerified = await verifyTurnstileToken(turnstileToken, turnstileSecretKey);

    if (!isTurnstileVerified) {
      return createErrorResponse(new AppError('verificationFailed', 403));
    }
  }

  const now = Date.now();
  const clientIp = getClientIpKey(request);
  if (isLoginLocked(clientIp, now)) {
    return createErrorResponse(new AppError('tooManyAttempts', 429));
  }

  const credentialResult = await validateCredentials(username, password, env, sys);

  if (!credentialResult.valid) {
    recordLoginFailure(clientIp, now);
    return createUnauthorizedResponse('invalidCredentials');
  }
  recordLoginSuccess(clientIp);

  if (credentialResult.needsPasswordUpgrade) {
    try {
      const upgradedPasswordHash = await hashPassword(password);
      await saveSiteOptions(env.DB, { password: upgradedPasswordHash });
      if (sys) {
        sys.password = upgradedPasswordHash;
      }
    } catch (e) {
      console.error('Password hash upgrade failed:', e);
    }
  }

  try {
    const token = await generateToken(env, sys);
    return createSuccessResponse({
      success: true,
      token: token,
      message: 'loginSuccessful'
    }, {
      'Set-Cookie': buildAuthCookie(request, token)
    });
  } catch (e) {
    return createErrorResponse(e);
  }
}

function handleLogoutAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearAuthCookie(request),
    buildClearThemePreviewAuthCookie(request)
  ]);
}

function handleClearThemePreviewAuthAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearThemePreviewAuthCookie(request)
  ]);
}

const PUBLIC_ADMIN_ACTION_HANDLERS = {
  login: handleLoginAction,
  logout: handleLogoutAction,
  clear_theme_preview_auth: handleClearThemePreviewAuthAction
};

export function sanitizeAdminSettings(fullSettings = {}) {
  const { jwt_secret, password, ...safeSettings } = fullSettings || {};
  return {
    ...safeSettings,
    password_configured: Boolean(String(password || '').trim())
  };
}

async function handleGetSettingsAction({ env, sys, loadFullSettings }) {
  const fullSettings = loadFullSettings ? await loadFullSettings() : sys;
  return createSuccessResponse({
    success: true,
    settings: sanitizeAdminSettings(fullSettings),
    api_secret: env.API_SECRET
  });
}

async function handleStartThemePreviewAction({ request, env, sys, data }) {
  const normalizedThemeUrl = normalizeThemeUrl(data.theme_url);
  if (!normalizedThemeUrl) {
    return createBadRequestResponse('invalidThemeUrl');
  }
  if (!await validateThemeUrlAvailable(normalizedThemeUrl)) {
    return createBadRequestResponse('invalidThemeUrl');
  }

  const token = await resolveVerifiedPreviewToken(request, env, sys);
  if (!token) {
    return simpleAuthResponse();
  }

  return createSuccessResponse({
    success: true,
    preview_url: buildThemePreviewUrl(request, normalizedThemeUrl)
  }, {
    'Set-Cookie': buildThemePreviewAuthCookie(request, token)
  });
}

async function handleSaveThemeOptionsAction({ env, sys, data }) {
  const themeOptions = data.theme_options ?? data.settings?.theme_options;
  if (!isValidThemeOptions(themeOptions)) {
    return createBadRequestResponse('invalidThemeOptionsFormat');
  }

  await saveThemeOptions(env.DB, themeOptions);
  if (sys) {
    sys.theme_options = themeOptions;
  }

  return createSuccessResponse({
    success: true,
    theme_options: themeOptions,
    message: 'updateSuccess'
  });
}

async function handleListAction({ env, data }) {
  // 管理后台「刷新缓存」会带 refresh: true，跳过本 isolate 的 120 秒列表缓存直接读 D1
  if (data?.refresh === true) {
    clearServersListCache();
  }

  const servers = await getAllServers(env.DB);
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);

  const now = Date.now();
  const ONLINE_THRESHOLD = 300000;
  const stats = {
    total: servers.length,
    online: 0,
    offline: 0,
    total_cpu: 0,
    total_net_in: 0,
    total_net_out: 0,
    avg_cpu: 0
  };

  const serversWithStatus = servers.map(server => {
    const latestMetrics = latestMetricsMap.get(server.id);
    const item = { ...server, region_override: server.region || '' };
    let isOnline = false;

    if (latestMetrics) {
      isOnline = (now - latestMetrics.timestamp) < ONLINE_THRESHOLD;
      mergeMetricsIntoServer(item, latestMetrics);
    } else {
      item.last_updated = 0;
      item.is_online = false;
      item.cpu_cores = 0;
      item.cpu_info = '';
      item.arch = '';
      item.os = '';
      item.agent_version = '';
      item.ip_v4 = '0';
      item.ip_v6 = '0';
      item.boot_time = '';
    }

    item.is_online = isOnline;
    if (!item.region) item.region = server.region || '';
    delete item.bandwidth;

    if (isOnline) {
      stats.online++;
      stats.total_cpu += toSafeMetricFloat(item.cpu, { min: 0, max: 100 });
      stats.total_net_in += toSafeMetricFloat(item.net_in_speed);
      stats.total_net_out += toSafeMetricFloat(item.net_out_speed);
    } else {
      stats.offline++;
    }

    return item;
  });

  if (stats.online > 0) {
    stats.avg_cpu = (stats.total_cpu / stats.online).toFixed(2);
  }

  return createSuccessResponse({
    success: true,
    servers: serversWithStatus,
    stats
  });
}

async function handleD1UsageAction({ data, sys }) {
  const hasCloudflareToken = Object.prototype.hasOwnProperty.call(data, 'cloudflare_token');
  const hasCloudflareAccountId = Object.prototype.hasOwnProperty.call(data, 'cloudflare_account_id');
  const cloudflareToken = hasCloudflareToken ? data.cloudflare_token : (sys?.cloudflare_token || '');
  const cloudflareAccountId = hasCloudflareAccountId ? data.cloudflare_account_id : (sys?.cloudflare_account_id || '');

  try {
    const usage = await getD1DailyUsage(String(cloudflareToken || '').trim(), String(cloudflareAccountId || '').trim());
    return createSuccessResponse({
      success: true,
      usage,
      message: 'd1UsageQueried'
    });
  } catch (e) {
    return createBadRequestResponse(e.message);
  }
}

async function handleSendTestNotificationAction({ data }) {
  const {
    tg_bot_token,
    tg_chat_id,
    notification_webhook_enabled,
    notification_webhook_url,
    notification_webhook_method,
    notification_webhook_format,
    notification_webhook_headers,
    notification_webhook_body,
    notification_template,
    notification_timezone,
    notification_language,
    expire_notification_time
  } = data;
  const webhookEnabled = normalizeBooleanSetting(notification_webhook_enabled) === 'true';
  if (webhookEnabled) {
    if (!notification_webhook_url || String(notification_webhook_url).trim().length === 0) {
      return createBadRequestResponse('notificationWebhookUrlRequired');
    }
  } else if (isSmtpNotificationTarget(tg_bot_token)) {
    // SMTP 邮件渠道（smtp:// 前缀）视为有效的内置通知目标
  } else if (!tg_bot_token || tg_bot_token.trim().length === 0) {
    return createBadRequestResponse('tgBotTokenRequired');
  }
  try {
    const notificationLanguage = normalizeNotificationLanguage(notification_language);
    const messages = getNotificationMessages({ notification_language: notificationLanguage });
    const result = await sendNotification({
      tg_bot_token,
      tg_chat_id: tg_chat_id || '',
      notification_webhook_enabled: normalizeBooleanSetting(notification_webhook_enabled),
      notification_webhook_url: notification_webhook_url || '',
      notification_webhook_method: normalizeNotificationWebhookMethod(notification_webhook_method),
      notification_webhook_format: normalizeNotificationWebhookFormat(notification_webhook_format),
      notification_webhook_headers: normalizeNotificationWebhookHeaders(notification_webhook_headers),
      notification_webhook_body: normalizeNotificationWebhookBody(notification_webhook_body),
      notification_template: normalizeNotificationTemplate(notification_template),
      notification_timezone: normalizeNotificationTimezone(notification_timezone),
      notification_language: notificationLanguage,
      expire_notification_time: normalizeExpireNotificationTime(expire_notification_time)
    }, messages.testMessage, {
      event: messages.events.test,
      emoji: '✅',
      clients: ['CF Server Monitor'],
      count: 1,
      message: messages.testMessage
    });
    if(result) {
      console.warn('Test notification failed:', result);
      // 附带具体失败原因，前端 i18n 未命中时会原样展示（不含密码等敏感信息）
      return createBadRequestResponse(`testNotificationFailed: ${result}`);
    }
    return createSuccessResponse({ success: true, message: 'testNotificationSent' });
  } catch (e) {
    return createBadRequestResponse(`testNotificationFailed: ${e?.message || e}`);
  }
}

const AUTHENTICATED_ADMIN_ACTION_HANDLERS = {
  get_settings: handleGetSettingsAction,
  start_theme_preview: handleStartThemePreviewAction,
  save_theme_options: handleSaveThemeOptionsAction,
  list: handleListAction,
  d1_usage: handleD1UsageAction,
  send_test_notification: handleSendTestNotificationAction
};

const BOOLEAN_SITE_SETTING_FIELDS = new Set([
  'auto_discovery',
  'is_public',
  'show_price',
  'show_expire',
  'show_tf',
  'show_three_net_details',
  'wss_report_enabled',
  'notification_webhook_enabled',
  'turnstile_enabled',
  'turnstile_login_enabled',
  'servers_optimized'
]);

export async function handleAdminAPI(request, env, sys, loadFullSettings = null, ctx = null) {
  const bodyResult = await readBoundedJsonObject(request, ADMIN_MAX_REQUEST_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.status === 413) {
      console.warn('Admin API payload too large:', {
        declaredLength: bodyResult.declaredLength ?? null,
        byteLength: bodyResult.byteLength ?? null,
        limit: ADMIN_MAX_REQUEST_BYTES
      });
      return createErrorResponse(new AppError('payloadTooLarge', 413));
    }
    console.warn('Admin API invalid JSON body:', bodyResult.reason);
    return createBadRequestResponse('invalidJson');
  }

  const data = bodyResult.data;

  try {
    const action = typeof data.action === 'string' ? data.action : '';
    const publicActionHandler = action && Object.hasOwn(PUBLIC_ADMIN_ACTION_HANDLERS, action)
      ? PUBLIC_ADMIN_ACTION_HANDLERS[action]
      : null;
    if (publicActionHandler) {
      return publicActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (!await checkAuth(request, env, sys)) {
      return simpleAuthResponse();
    }

    const authenticatedActionHandler = action && Object.hasOwn(AUTHENTICATED_ADMIN_ACTION_HANDLERS, action)
      ? AUTHENTICATED_ADMIN_ACTION_HANDLERS[action]
      : null;
    if (authenticatedActionHandler) {
      return authenticatedActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (action === 'save_settings') {
      if (data.settings !== undefined && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) {
        return createBadRequestResponse('invalidSettingsFormat');
      }
      const settings = data.settings || {};
      if (
        settings.password !== undefined &&
        settings.password !== null &&
        settings.password !== '' &&
        (typeof settings.password !== 'string' || settings.password.length > LOGIN_PASSWORD_MAX_LENGTH)
      ) {
        return createBadRequestResponse('invalidPassword');
      }
      if (!String(sys?.password || '').trim() && !String(settings.password || '')) {
        return createBadRequestResponse('passwordRequired');
      }

      const normalizedThemeUrl = normalizeThemeUrl(settings.theme_url);
      if (normalizedThemeUrl === null) {
        return createBadRequestResponse('invalidThemeUrl');
      }
      if (normalizedThemeUrl && !await validateThemeUrlAvailable(normalizedThemeUrl)) {
        return createBadRequestResponse('invalidThemeUrl');
      }

      // 如果 turnstile_enabled 或 turnstile_login_enabled 开启，验证 turnstile_site_key 和 turnstile_secret_key 都不为空
      const effectiveTurnstileEnabled = settings.turnstile_enabled !== undefined
        ? normalizeBooleanSetting(settings.turnstile_enabled) === 'true'
        : normalizeBooleanSetting(sys?.turnstile_enabled) === 'true';
      const effectiveTurnstileLoginEnabled = settings.turnstile_login_enabled !== undefined
        ? normalizeBooleanSetting(settings.turnstile_login_enabled) === 'true'
        : normalizeBooleanSetting(sys?.turnstile_login_enabled) === 'true';
      if (effectiveTurnstileEnabled || effectiveTurnstileLoginEnabled) {
        const effectiveSiteKey = settings.turnstile_site_key !== undefined
          ? settings.turnstile_site_key
          : sys?.turnstile_site_key;
        const effectiveSecretKey = settings.turnstile_secret_key !== undefined
          ? settings.turnstile_secret_key
          : sys?.turnstile_secret_key;
        if (typeof effectiveSiteKey !== 'string' || effectiveSiteKey.trim().length === 0) {
          return createBadRequestResponse('turnstileSiteKeyRequired');
        }
        if (typeof effectiveSecretKey !== 'string' || effectiveSecretKey.trim().length === 0) {
          return createBadRequestResponse('turnstileSecretKeyRequired');
        }
      }

      // 如果 tg_notify、expire_reminder 或资源告警开启，验证通知渠道配置非空
      const hasResourceAlertRulesInput = settings.resource_alert_rules !== undefined;
      const tgNotify = settings.tg_notify !== undefined
        ? normalizeTgNotify(settings.tg_notify)
        : normalizeTgNotify(sys?.tg_notify);
      const expireReminder = settings.expire_reminder !== undefined
        ? normalizeExpireReminder(settings.expire_reminder)
        : normalizeExpireReminder(sys?.expire_reminder);
      const currentResourceAlertRules = normalizeResourceAlertRules(sys?.resource_alert_rules);
      const normalizedResourceAlertRules = hasResourceAlertRulesInput
        ? normalizeResourceAlertRules(settings.resource_alert_rules)
        : currentResourceAlertRules;
      const resourceAlertEnabled = normalizedResourceAlertRules.length > 0;
      if (tgNotify !== '0' || expireReminder !== '0' || resourceAlertEnabled) {
        const webhookEnabled = settings.notification_webhook_enabled !== undefined
          ? normalizeBooleanSetting(settings.notification_webhook_enabled) === 'true'
          : normalizeBooleanSetting(sys?.notification_webhook_enabled) === 'true';
        const effectiveWebhookUrl = settings.notification_webhook_url !== undefined
          ? settings.notification_webhook_url
          : sys?.notification_webhook_url;
        const effectiveTgBotToken = settings.tg_bot_token !== undefined
          ? settings.tg_bot_token
          : sys?.tg_bot_token;
        if (webhookEnabled) {
          if (!effectiveWebhookUrl || typeof effectiveWebhookUrl !== 'string' || effectiveWebhookUrl.trim().length === 0) {
            return createBadRequestResponse('notificationWebhookUrlRequired');
          }
        } else if (isSmtpNotificationTarget(effectiveTgBotToken)) {
          // SMTP 邮件渠道（smtp:// 前缀）视为有效的内置通知目标，允许通过告警门槛校验
        } else if (!effectiveTgBotToken || typeof effectiveTgBotToken !== 'string' || effectiveTgBotToken.trim().length === 0) {
          return createBadRequestResponse('tgBotTokenRequired');
        }
      }

      const pingNodes = normalizePingNodeFields(settings);
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
      }

      // UA 与文本设置项必须在任何写库动作之前完成校验，防止出现部分写库的半成品状态。
      let normalizedUserAgent = '';
      if (settings.ua !== undefined) {
        if (settings.ua !== null && typeof settings.ua !== 'string') {
          return createBadRequestResponse('invalidUserAgent');
        }
        const uaResult = validateUserAgent(settings.ua);
        if (!uaResult.valid) {
          return createBadRequestResponse('invalidUserAgent');
        }
        normalizedUserAgent = uaResult.value;
      }

      for (const textField of Object.keys(TEXT_SETTING_MAX_LENGTHS)) {
        if (settings[textField] !== undefined) {
          const check = validateTextSetting(textField, settings[textField]);
          if (!check.valid) {
            return createBadRequestResponse(`invalidSetting:${textField}`);
          }
        }
      }

      if (settings.appearance_options !== undefined && (
        settings.appearance_options === null ||
        typeof settings.appearance_options !== 'object' ||
        Array.isArray(settings.appearance_options)
      )) {
        return createBadRequestResponse('invalidThemeOptionsFormat');
      }

      const nestedAppearanceOptions = settings.appearance_options || {};
      if (nestedAppearanceOptions.theme_options !== undefined && !isValidThemeOptions(nestedAppearanceOptions.theme_options)) {
        return createBadRequestResponse('invalidThemeOptionsFormat');
      }
      for (const textField of Object.keys(TEXT_SETTING_MAX_LENGTHS)) {
        if (nestedAppearanceOptions[textField] !== undefined) {
          const check = validateTextSetting(textField, nestedAppearanceOptions[textField]);
          if (!check.valid) {
            return createBadRequestResponse(`invalidSetting:${textField}`);
          }
        }
      }

      const shouldSaveAppearanceOptions = hasAppearanceInput(settings);
      let appearanceOptions = {};

      if (shouldSaveAppearanceOptions) {
        let existingAppearanceOptions = {};
        try {
          const existingRow = await env.DB.prepare(
            "SELECT value FROM settings WHERE key = 'appearance_options'"
          ).first();
          if (existingRow && existingRow.value) {
            const parsed = JSON.parse(existingRow.value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              existingAppearanceOptions = parsed;
            }
          }
        } catch (_) {
          existingAppearanceOptions = {};
        }

        appearanceOptions = { ...existingAppearanceOptions };
        for (const field of APPEARANCE_FIELDS) {
          const value = field === 'theme_options'
            ? nestedAppearanceOptions.theme_options
            : (settings[field] !== undefined ? settings[field] : nestedAppearanceOptions[field]);
          if (value !== undefined) {
            if (field === 'csp_static' || field === 'csp_api') {
              appearanceOptions[field] = sanitizeCspDomains(value);
            } else if (field === 'display_mode') {
              appearanceOptions[field] = normalizeDisplayMode(value);
            } else if (field === 'preferred_theme') {
              appearanceOptions[field] = normalizePreferredTheme(value);
            } else if (field === 'default_language') {
              appearanceOptions[field] = normalizeDefaultLanguage(value);
            } else if (field === 'theme_options') {
              appearanceOptions[field] = value;
            } else if (field in TEXT_SETTING_MAX_LENGTHS) {
              appearanceOptions[field] = validateTextSetting(field, value).value;
            } else {
              appearanceOptions[field] = value;
            }
          }
        }
        await env.DB.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).bind('appearance_options', JSON.stringify(appearanceOptions)).run();
        clearAppearanceSettingsCache();
      }

      const isPasswordChanged = typeof settings.password === 'string' && settings.password.length > 0;
      const previousUsername = String(sys?.username || '').trim();
      const incomingUsername = settings.username !== undefined ? String(settings.username ?? '').trim() : previousUsername;
      const isUsernameChanged = settings.username !== undefined && incomingUsername !== previousUsername;

      const siteOptions = {};
      for (const field of SITE_FIELDS) {
        if (field === 'jwt_secret') continue;
        if (settings[field] !== undefined) {
          if (field === 'password') {
            if (isPasswordChanged) {
              siteOptions[field] = await hashPassword(settings[field]);
            }
          } else if (field === 'username') {
            siteOptions[field] = incomingUsername;
          } else if (PING_NODE_FIELDS.includes(field)) {
            siteOptions[field] = pingNodes.values[field];
          } else if (field === 'tg_notify') {
            siteOptions[field] = tgNotify;
          } else if (field === 'expire_reminder') {
            siteOptions[field] = expireReminder;
          } else if (field === 'long_history_points') {
            siteOptions[field] = normalizeLongHistoryPoints(settings[field]);
          } else if (field === 'frontend_ws_timeout_minutes') {
            siteOptions[field] = normalizeFrontendWsTimeoutMinutes(settings[field]);
          } else if (field === 'resource_alert_rules') {
            siteOptions[field] = normalizedResourceAlertRules;
          } else if (field === 'wss_report_hours') {
            siteOptions[field] = normalizeWssReportHours(settings[field]);
          } else if (BOOLEAN_SITE_SETTING_FIELDS.has(field)) {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_timezone') {
            siteOptions[field] = normalizeNotificationTimezone(settings[field]);
          } else if (field === 'notification_language') {
            siteOptions[field] = normalizeNotificationLanguage(settings[field]);
          } else if (field === 'expire_notification_time') {
            siteOptions[field] = normalizeExpireNotificationTime(settings[field]);
          } else if (field === 'notification_webhook_method') {
            siteOptions[field] = normalizeNotificationWebhookMethod(settings[field]);
          } else if (field === 'notification_webhook_format') {
            siteOptions[field] = normalizeNotificationWebhookFormat(settings[field]);
          } else if (field === 'notification_webhook_headers') {
            siteOptions[field] = normalizeNotificationWebhookHeaders(settings[field]);
          } else if (field === 'notification_webhook_body') {
            siteOptions[field] = normalizeNotificationWebhookBody(settings[field]);
          } else if (field === 'notification_template') {
            siteOptions[field] = normalizeNotificationTemplate(settings[field]);
          } else if (field === 'traffic_alert_threshold') {
            siteOptions[field] = normalizeTrafficAlertThreshold(settings[field]);
          } else if (field === 'theme_url') {
            siteOptions[field] = normalizedThemeUrl;
          } else if (field === 'ua') {
            siteOptions[field] = normalizedUserAgent;
          } else if (field in TEXT_SETTING_MAX_LENGTHS) {
            siteOptions[field] = validateTextSetting(field, settings[field]).value;
          } else {
            siteOptions[field] = settings[field];
          }
        }
      }

      if (isPasswordChanged || isUsernameChanged) {
        siteOptions.jwt_secret = generateRandomSecret(32);
      }

      await saveSiteOptions(env.DB, siteOptions);
      try {
        await addServerColumns(env.DB);
      } catch (e) {
        console.error('[settings-save] 保存设置后补列失败:', e);
      }
      const shouldCloseAgentWssReports = !isWssReportEnabled({ ...sys, ...siteOptions });
      if (hasResourceAlertRulesInput && !resourceAlertEnabled) {
        await clearResourceAlertState(env.DB);
      }
      if (sys && typeof sys === 'object') {
        Object.assign(sys, shouldSaveAppearanceOptions ? appearanceOptions : {}, siteOptions);
      }
      if (shouldCloseAgentWssReports && (
        settings.wss_report_enabled !== undefined ||
        settings.wss_report_hours !== undefined
      )) {
        scheduleAgentReportModeChanged(env, ctx);
      }
      scheduleBroadcasterInvalidate(env, ctx, { refreshSettings: true });

      if (isPasswordChanged || isUsernameChanged) {
        const tokenContext = sys && typeof sys === 'object' ? sys : siteOptions;
        const newToken = await generateToken(env, tokenContext);
        return createSuccessResponse({
          success: true,
          token: newToken,
          message: 'updateSuccess'
        }, {
          'Set-Cookie': buildAuthCookie(request, newToken)
        });
      }

      return createSuccessResponse({
        success: true,
        message: 'updateSuccess'
      });
    } 
    else if (action === 'add') {
      const name = data.name || 'New Server';
      if (!isValidName(name)) {
        return createBadRequestResponse('invalidServerName');
      }
      if (
        data.server_group !== undefined &&
        data.server_group !== null &&
        (typeof data.server_group === 'object' || typeof data.server_group === 'boolean' || String(data.server_group).trim().length > 64)
      ) {
        return createBadRequestResponse('invalidServerGroup');
      }
      const networkInterfaces = normalizeNetworkInterfaceField(data.interface);
      if (!networkInterfaces.valid) {
        return createBadRequestResponse('invalidNetworkInterface');
      }
      
      const id = crypto.randomUUID();
      const group = String(data.server_group ?? '').trim() || 'Default';
      const region = normalizeServerRegion(data.region);

      try {
        const orderRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM servers').first();
        const maxOrder = orderRow?.max_order;
        const sortOrder = (Number.isFinite(Number(maxOrder)) ? Math.trunc(Number(maxOrder)) : -1) + 1;

        const MAX_PARTITION_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_PARTITION_RETRIES; attempt++) {
          const historyPartitionId = await getNextServerHistoryPartitionId(env.DB);
          try {
            await env.DB.prepare(`
              INSERT INTO servers
              (id, name, server_group, region, "interface", sort_order, history_partition_id, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(id, name.trim(), group, region, networkInterfaces.value, sortOrder, historyPartitionId, Date.now()).run();
            break;
          } catch (insertError) {
            if (isHistoryPartitionUniqueError(insertError) && attempt < MAX_PARTITION_RETRIES - 1) {
              continue;
            }
            throw insertError;
          }
        }
      } catch (e) {
        return handleServerMutationError(env.DB, e, 'serverAddFailed');
      }
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        id: id,
        message: 'serverAdded'
      });
    } 
    else if (action === 'delete') {
      const { id } = data;
      if (!id || typeof id !== 'string' || !isValidUUID(id)) {
        return createBadRequestResponse('invalidServerId');
      }
      
      await deleteServer(env.DB, id);
      
      clearServersListCache();
      clearLatestReportCache(id);
      scheduleBroadcasterInvalidate(env, ctx, { deletedServerIds: [id] });
      
      return createSuccessResponse({ 
        success: true, 
        message: 'serverDeleted'
      });
    } 
    else if (action === 'save_order') {
      const { orders } = data;
      if (!orders || !Array.isArray(orders) || orders.length === 0) {
        return createBadRequestResponse('missingSortData');
      }
      if (orders.length > ADMIN_MAX_BATCH_ITEMS) {
        return createBadRequestResponse('tooManyServers');
      }

      for (let i = 0; i < orders.length; i++) {
        if (typeof orders[i] !== 'string' || !isValidUUID(orders[i])) {
          return createBadRequestResponse('invalidSortId');
        }
      }

      const statements = orders.map((orderId, index) =>
        env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(index, orderId)
      );
      await executeBatchedStatements(env.DB, statements, D1_MUTATION_BATCH_SIZE);
      
      clearServersListCache();
      
      return createSuccessResponse({ 
        success: true, 
        message: 'sortOrderSaved'
      });
    }
    else if (action === 'edit') {
      const { id, name, server_group, region, tags, note, price, billing_cycle, auto_renewal, currency, expire_date, traffic_limit, traffic_calc_type, traffic_alert_percent, interface: networkInterfaceInput, reset_day, collect_interval, report_interval, wss_report_interval, connection_mode, ping_mode, auto_update, custom_ct, custom_cu, custom_cm, custom_bd, node_1, node_2, node_3, node_4, rx_correction, tx_correction, offline_notify_disabled, is_hidden } = data;
      if (!id || typeof id !== 'string' || !isValidUUID(id)) {
        return createBadRequestResponse('invalidServerId');
      }
      if (!isValidName(name || '')) {
        return createBadRequestResponse('invalidServerName');
      }
      if (
        server_group !== undefined &&
        server_group !== null &&
        (typeof server_group === 'object' || typeof server_group === 'boolean' || String(server_group).trim().length > 64)
      ) {
        return createBadRequestResponse('invalidServerGroup');
      }
      if (
        traffic_limit !== undefined &&
        traffic_limit !== null &&
        (typeof traffic_limit === 'object' || typeof traffic_limit === 'boolean' || String(traffic_limit).trim().length > 32)
      ) {
        return createBadRequestResponse('invalidTrafficLimit');
      }
      const trimmedExpireDate = expire_date === undefined || expire_date === null ? '' : String(expire_date).trim();
      if (trimmedExpireDate && !parseDateOnly(trimmedExpireDate)) {
        return createBadRequestResponse('invalidExpireDate');
      }
      if ((tags !== undefined && tags !== null && typeof tags === 'object') || (note !== undefined && note !== null && typeof note === 'object')) {
        return createBadRequestResponse('invalidFieldFormat');
      }

      const effectiveConnectionMode = isWssReportConfigured(sys) ? connection_mode : 'http';
      const agentConfigResult = validateAgentConfigInput({
        collect_interval,
        report_interval,
        wss_report_interval,
        reset_day,
        connection_mode: effectiveConnectionMode,
        ping_mode
      });
      if (!agentConfigResult.valid) {
        return createBadRequestResponse(agentConfigResult.error);
      }
      const normalizedAgentConfig = agentConfigResult.config;

      const pingNodes = normalizePingNodeFields({ custom_ct, custom_cu, custom_cm, custom_bd, node_1, node_2, node_3, node_4 });
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
      }
      const networkInterfaces = normalizeNetworkInterfaceField(networkInterfaceInput);
      if (!networkInterfaces.valid) {
        return createBadRequestResponse('invalidNetworkInterface');
      }
      const safeTags = String(tags || '')
        .split(',')
        .map(tag => tag.trim().replace(/[^\p{L}\p{N} ._\-]/gu, '').slice(0, 32))
        .filter(Boolean)
        .slice(0, 12)
        .join(',');
      const safeNote = String(note || '').trim().slice(0, 500);
      const safeGroup = String(server_group ?? '').trim() || 'Default';
      const safeTrafficLimit = traffic_limit === undefined || traffic_limit === null ? '' : String(traffic_limit).trim();
      const safeTrafficCalcType = VALID_TRAFFIC_CALC_TYPES.has(String(traffic_calc_type || 'total'))
        ? String(traffic_calc_type || 'total')
        : 'total';

      const toNullCorrection = (v) => {
        if (v === null || v === undefined || v === '') return null;
        return isValidTrafficCorrection(v) ? Number(v) : undefined;
      };
      const safeRx = toNullCorrection(rx_correction);
      const safeTx = toNullCorrection(tx_correction);
      if (safeRx === undefined || safeTx === undefined) {
        return createBadRequestResponse('invalidTrafficCorrection');
      }

      const billingData = normalizeServerBillingData({
        price,
        billing_cycle,
        auto_renewal,
        currency,
        expire_date: trimmedExpireDate
      });
      
      try {
        await env.DB.prepare(`
          UPDATE servers
          SET name = ?, server_group = ?, region = ?, tags = ?, note = ?, price = ?, billing_cycle = ?, auto_renewal = ?, currency = ?, expire_date = ?, traffic_limit = ?, traffic_calc_type = ?, "interface" = ?, reset_day = ?, collect_interval = ?, report_interval = ?, wss_report_interval = ?, connection_mode = ?, ping_mode = ?, auto_update = ?, custom_ct = ?, custom_cu = ?, custom_cm = ?, custom_bd = ?, node_1 = ?, node_2 = ?, node_3 = ?, node_4 = ?, rx_correction = ?, tx_correction = ?, offline_notify_disabled = ?, is_hidden = ?, traffic_alert_percent = ?
          WHERE id = ?
        `).bind(
          name.trim(),
          safeGroup,
          normalizeServerRegion(region),
          safeTags,
          safeNote,
          billingData.price,
          billingData.billing_cycle,
          billingData.auto_renewal,
          billingData.currency,
          billingData.expire_date,
          safeTrafficLimit,
          safeTrafficCalcType,
          networkInterfaces.value,
          normalizedAgentConfig.reset_day,
          normalizedAgentConfig.collect_interval,
          normalizedAgentConfig.report_interval,
          normalizedAgentConfig.wss_report_interval,
          normalizedAgentConfig.connection_mode,
          normalizedAgentConfig.ping_mode,
          normalizeBooleanFlag(auto_update),
          pingNodes.values.custom_ct ?? null,
          pingNodes.values.custom_cu ?? null,
          pingNodes.values.custom_cm ?? null,
          pingNodes.values.custom_bd ?? null,
          pingNodes.values.node_1 ?? null,
          pingNodes.values.node_2 ?? null,
          pingNodes.values.node_3 ?? null,
          pingNodes.values.node_4 ?? null,
          safeRx,
          safeTx,
          normalizeBooleanFlag(offline_notify_disabled),
          normalizeBooleanFlag(is_hidden),
          normalizePctOrNull(traffic_alert_percent),
          id
        ).run();
      } catch (e) {
        return handleServerMutationError(env.DB, e, 'serverUpdateFailed');
      }
      
      clearServersListCache();
      clearLatestReportCache(id);
      scheduleAgentConfigChanged(env, ctx, id);
      scheduleBroadcasterInvalidate(env, ctx, { updatedServerIds: [id] });
      
      return createSuccessResponse({ 
        success: true, 
        message: 'serverUpdated'
      });
    }
    else if (action === 'batch_delete') {
      const { ids } = data;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return createBadRequestResponse('selectServersToDelete');
      }
      if (ids.length > ADMIN_MAX_BATCH_ITEMS) {
        return createBadRequestResponse('tooManyServers');
      }

      for (const id of ids) {
        if (typeof id !== 'string' || !isValidUUID(id)) {
          return createBadRequestResponse('invalidServerIdInList');
        }
      }

      const uniqueIds = Array.from(new Set(ids));
      await deleteServersAndHistory(env.DB, uniqueIds);
      
      clearServersListCache();
      clearLatestReportCache(uniqueIds);
      scheduleBroadcasterInvalidate(env, ctx, { deletedServerIds: uniqueIds });
      
      return createSuccessResponse({ 
        success: true, 
        message: 'batchDeleted'
      });
    }
    
    else if (action === 'export_servers') {
      try {
        const servers = await env.DB.prepare('SELECT * FROM servers ORDER BY sort_order ASC').all();
        return createSuccessResponse({
          success: true,
          servers: servers.results || [],
          message: 'serversExported'
        });
      } catch (e) {
        return createBadRequestResponse('serversExportFailed');
      }
    }
    else if (action === 'import_servers') {
      const { servers: importData } = data;
      if (!importData || !Array.isArray(importData) || importData.length === 0) {
        return createBadRequestResponse('noServersToImport');
      }
      if (importData.length > ADMIN_MAX_BATCH_ITEMS) {
        return createBadRequestResponse('tooManyServers');
      }

      try {
        await addServerColumns(env.DB);
      } catch (e) {
        console.error('[import_servers] 导入前补列失败:', e);
      }

      const existingServers = await env.DB.prepare('SELECT id FROM servers').all();
      const existingIds = new Set((existingServers.results || []).map(s => s.id));

      const existingPartitionIds = await env.DB.prepare(
        'SELECT history_partition_id FROM servers WHERE history_partition_id > 0'
      ).all();
      const usedPartitionIds = new Set(
        (existingPartitionIds.results || [])
          .map(s => Number(s.history_partition_id))
          .filter(id => Number.isInteger(id) && id > 0 && id <= HISTORY_MAX_PARTITION_ID)
      );

      let imported = 0;
      let skipped = 0;
      const skippedIds = [];
      const pendingInserts = [];
      const IMPORT_BATCH_SIZE = 50;
      const importNow = Date.now();
      const PARTITION_COLUMN_INDEX = IMPORT_SERVER_COLUMNS.indexOf('history_partition_id');
      const insertSql = `INSERT INTO servers (${IMPORT_SERVER_COLUMNS.join(', ')}) VALUES (${IMPORT_SERVER_PLACEHOLDERS})`;

      const toOptionalInt = (val, fallback) => {
        if (val === undefined || val === null || val === '') return fallback;
        if (typeof val === 'object' || typeof val === 'boolean') return NaN;
        const n = Number(val);
        return Number.isInteger(n) ? n : NaN;
      };

      for (const server of importData) {
        if (!server || typeof server !== 'object' || Array.isArray(server)) {
          skipped++;
          skippedIds.push('(invalid)');
          continue;
        }

        const serverId = typeof server.id === 'string' ? server.id.trim() : '';
        if (!serverId || !isValidUUID(serverId)) {
          skipped++;
          skippedIds.push(String(server?.id || '(invalid)').slice(0, 64));
          continue;
        }

        if (existingIds.has(serverId)) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const serverName = typeof server.name === 'string' ? server.name.trim() : '';
        if (!isValidName(serverName)) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const safeSortOrder = toOptionalInt(server.sort_order, 0);
        if (!Number.isInteger(safeSortOrder) || safeSortOrder < -1000000 || safeSortOrder > 1000000) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const trimmedExpireDate = server.expire_date === undefined || server.expire_date === null
          ? ''
          : String(server.expire_date).trim();
        if (trimmedExpireDate && !parseDateOnly(trimmedExpireDate)) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        if (
          (server.server_group !== undefined && server.server_group !== null && (typeof server.server_group === 'object' || typeof server.server_group === 'boolean' || String(server.server_group).trim().length > 64)) ||
          (server.traffic_limit !== undefined && server.traffic_limit !== null && (typeof server.traffic_limit === 'object' || typeof server.traffic_limit === 'boolean' || String(server.traffic_limit).trim().length > 32)) ||
          (server.tags !== undefined && server.tags !== null && (typeof server.tags === 'object' || typeof server.tags === 'boolean' || String(server.tags).length > 512)) ||
          (server.note !== undefined && server.note !== null && (typeof server.note === 'object' || typeof server.note === 'boolean' || String(server.note).length > 500))
        ) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const collectInterval = toOptionalInt(server.collect_interval, 0);
        const reportInterval = toOptionalInt(server.report_interval, 60);
        const resetDay = toOptionalInt(server.reset_day, 1);
        const wssReportInterval = server.wss_report_interval === undefined || server.wss_report_interval === null || server.wss_report_interval === ''
          ? normalizeWssReportInterval(undefined)
          : toOptionalInt(server.wss_report_interval, NaN);
        const agentConfigCheck = validateAgentConfigInput({
          collect_interval: collectInterval,
          report_interval: reportInterval,
          wss_report_interval: wssReportInterval,
          reset_day: resetDay,
          connection_mode: server.connection_mode || 'auto',
          ping_mode: server.ping_mode || 'tcp'
        });
        if (!agentConfigCheck.valid) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const pingNodeValues = {};
        let pingNodesValid = true;
        for (const field of PING_NODE_FIELDS) {
          const rawNode = server[field];
          if (rawNode === undefined || rawNode === null || rawNode === '') {
            pingNodeValues[field] = '';
          } else if (rawNode === 0 || rawNode === '0') {
            pingNodeValues[field] = '0';
          } else {
            const check = validatePingNode(rawNode);
            if (!check.valid) {
              pingNodesValid = false;
              break;
            }
            pingNodeValues[field] = check.value;
          }
        }
        if (!pingNodesValid) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const networkInterfaces = normalizeNetworkInterfaceField(server.interface);
        if (!networkInterfaces.valid) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        const toImportedCorrection = (v) => {
          if (v === null || v === undefined || v === '') return null;
          return isValidTrafficCorrection(v) ? Number(v) : undefined;
        };
        const safeRxCorrection = toImportedCorrection(server.rx_correction);
        const safeTxCorrection = toImportedCorrection(server.tx_correction);
        if (safeRxCorrection === undefined || safeTxCorrection === undefined) {
          skipped++;
          skippedIds.push(serverId);
          continue;
        }

        let safeTimestamp = importNow;
        if (server.timestamp !== undefined && server.timestamp !== null && server.timestamp !== '' && server.timestamp !== 0 && server.timestamp !== '0') {
          if (typeof server.timestamp === 'object' || typeof server.timestamp === 'boolean') {
            skipped++;
            skippedIds.push(serverId);
            continue;
          }
          const parsedTs = Number(server.timestamp);
          if (
            !Number.isFinite(parsedTs) ||
            parsedTs < IMPORT_MIN_TIMESTAMP_MS ||
            parsedTs > importNow + IMPORT_MAX_FUTURE_DRIFT_MS
          ) {
            skipped++;
            skippedIds.push(serverId);
            continue;
          }
          safeTimestamp = Math.trunc(parsedTs);
        }

        let partitionId = Number(server.history_partition_id);
        if (!Number.isInteger(partitionId) || partitionId <= 0 || partitionId > HISTORY_MAX_PARTITION_ID || usedPartitionIds.has(partitionId)) {
          partitionId = 0;
          for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
            if (!usedPartitionIds.has(id)) {
              partitionId = id;
              break;
            }
          }
          if (partitionId === 0) {
            skipped++;
            skippedIds.push(serverId);
            continue;
          }
        }

        usedPartitionIds.add(partitionId);
        existingIds.add(serverId);

        const billingData = normalizeServerBillingData({
          ...server,
          expire_date: trimmedExpireDate
        });
        const safeGroup = String(server.server_group ?? '').trim() || 'Default';
        const safeTags = String(server.tags || '')
          .split(',')
          .map(tag => tag.trim().replace(/[^\p{L}\p{N} ._\-]/gu, '').slice(0, 32))
          .filter(Boolean)
          .slice(0, 12)
          .join(',');
        const safeNote = String(server.note || '').trim().slice(0, 500);
        const safeTrafficLimit = server.traffic_limit === undefined || server.traffic_limit === null
          ? ''
          : String(server.traffic_limit).trim();
        const safeTrafficCalcType = VALID_TRAFFIC_CALC_TYPES.has(String(server.traffic_calc_type || 'total'))
          ? String(server.traffic_calc_type || 'total')
          : 'total';

        const bindValues = [
          serverId,
          serverName,
          safeGroup,
          normalizeServerRegion(server.region),
          safeTags,
          safeNote,
          billingData.price,
          billingData.billing_cycle,
          billingData.auto_renewal,
          billingData.currency,
          billingData.expire_date,
          safeTrafficLimit,
          safeTrafficCalcType,
          networkInterfaces.value,
          agentConfigCheck.config.reset_day,
          agentConfigCheck.config.collect_interval,
          agentConfigCheck.config.report_interval,
          agentConfigCheck.config.wss_report_interval,
          normalizeConnectionMode(server.connection_mode) || 'auto',
          normalizePingMode(server.ping_mode) || 'tcp',
          normalizeBooleanFlag(server.auto_update),
          pingNodeValues.custom_ct,
          pingNodeValues.custom_cu,
          pingNodeValues.custom_cm,
          pingNodeValues.custom_bd,
          pingNodeValues.node_1,
          pingNodeValues.node_2,
          pingNodeValues.node_3,
          pingNodeValues.node_4,
          safeRxCorrection,
          safeTxCorrection,
          normalizeBooleanFlag(server.offline_notify_disabled),
          normalizeBooleanFlag(server.is_hidden),
          safeSortOrder,
          partitionId,
          safeTimestamp,
          normalizePctOrNull(server.traffic_alert_percent)
        ];

        pendingInserts.push({
          id: serverId,
          bindValues,
          statement: env.DB.prepare(insertSql).bind(...bindValues)
        });
        imported++;
      }

      const importedServerIds = [];
      const insertSingleItemWithRetry = async (item) => {
        let rowInserted = false;
        let currentStmt = item.statement;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await currentStmt.run();
            rowInserted = true;
            break;
          } catch (rowError) {
            if (isHistoryPartitionUniqueError(rowError) && attempt < 2 && PARTITION_COLUMN_INDEX >= 0) {
              try {
                const nextPid = await getNextServerHistoryPartitionId(env.DB);
                usedPartitionIds.add(nextPid);
                const nextValues = [...item.bindValues];
                nextValues[PARTITION_COLUMN_INDEX] = nextPid;
                currentStmt = env.DB.prepare(insertSql).bind(...nextValues);
                continue;
              } catch (allocError) {
                console.warn('[import_servers] partition reallocation failed:', {
                  id: item.id,
                  error: allocError?.message || String(allocError)
                });
              }
            }
            console.warn('[import_servers] failed to insert server row:', {
              id: item.id,
              error: rowError?.message || String(rowError)
            });
            break;
          }
        }
        if (rowInserted) {
          importedServerIds.push(item.id);
        } else {
          imported--;
          skipped++;
          skippedIds.push(item.id);
        }
      };

      for (let i = 0; i < pendingInserts.length; i += IMPORT_BATCH_SIZE) {
        const chunk = pendingInserts.slice(i, i + IMPORT_BATCH_SIZE);
        if (typeof env.DB.batch === 'function') {
          try {
            await env.DB.batch(chunk.map(item => item.statement));
            for (const item of chunk) {
              importedServerIds.push(item.id);
            }
          } catch (_) {
            // 原子批失败说明本批无任何行落库，安全逐条重试
            for (const item of chunk) {
              await insertSingleItemWithRetry(item);
            }
          }
        } else {
          // 无 db.batch 的环境直接逐条执行，避免前面已落库的行在异常后重复执行
          for (const item of chunk) {
            await insertSingleItemWithRetry(item);
          }
        }
      }

      clearServersListCache();
      if (importedServerIds.length > 0) {
        scheduleBroadcasterInvalidate(env, ctx, { updatedServerIds: importedServerIds });
      }

      return createSuccessResponse({
        success: true,
        imported,
        skipped,
        skippedIds,
        message: imported > 0 ? 'serversImported' : 'noServersImported'
      });
    }
    
    return createBadRequestResponse('unknownAction');
    
  } catch (e) {
    console.error('Admin API 错误:', e);
    return createErrorResponse(e);
  }
}
