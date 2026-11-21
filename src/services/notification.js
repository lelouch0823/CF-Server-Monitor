import { getLatestTimestampsForAllServers } from '../database/schema.js';
import { clearServersListCache, getAllServers } from '../utils/cache.js';
import {
  DEFAULT_NOTIFICATION_TEMPLATE,
  getExpireReminderDays,
  getResourceAlertConfig,
  getResourceAlertRuleThresholds,
  getTgNotifyMinutes,
  loadSiteSettings,
  normalizeExpireNotificationTime,
  normalizeBooleanSetting,
  normalizeNotificationTemplate,
  normalizeNotificationTimezone,
  normalizeNotificationWebhookBody,
  normalizeNotificationWebhookFormat,
  normalizeNotificationWebhookHeaders,
  normalizeNotificationWebhookMethod,
  debug
} from '../utils/settings.js';
import {
  GB,
  getTrafficUsageBytes,
  normalizePct,
  normalizePctOrNull,
  normalizeTrafficLimitGb
} from '../utils/traffic.js';
import { detectBillingCycle, isEnabledFlag, normalizeBillingCycle, renewExpireDateIfNeeded } from '../utils/serverBilling.js';
import {
  NOTIFICATION_MAX_RETRIES,
  NOTIFICATION_RETRY_DELAY_MS,
  RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE,
  RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE,
  RESOURCE_ALERT_COMPACT_RESULT_FORMAT,
  RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT
} from '../utils/config.js';
import { getNotificationMessages } from './notificationMessages.js';

const RESOURCE_ALERT_STATE_ACTIVE = 'active';
const RESOURCE_ALERT_STATE_RECOVERED = 'recovered';
const RESOURCE_ALERT_STATE_KEY = 'resource_alert_state';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTIFICATION_CHUNK_MAX_CHARS = 1800;
const NOTIFICATION_FETCH_TIMEOUT_MS = 8000;
const SMTP_SEND_TIMEOUT_MS = 10000;

function isPrivateOrReservedIpv4Octets(a, b) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function parseIpv6Hextets(ipv6Host) {
  const zoneStripped = String(ipv6Host || '').split('%')[0].toLowerCase();
  if (!zoneStripped || !zoneStripped.includes(':')) return null;

  let working = zoneStripped;
  // Support embedded dotted-quad IPv4 suffix if present before URL normalization
  const lastColon = working.lastIndexOf(':');
  const tailSegment = working.slice(lastColon + 1);
  if (tailSegment.includes('.')) {
    const v4Match = tailSegment.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4Match) return null;
    const octets = v4Match.slice(1).map(Number);
    if (octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hiHex = ((octets[0] << 8) | octets[1]).toString(16);
    const loHex = ((octets[2] << 8) | octets[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hiHex}:${loHex}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  const parsePart = part => {
    if (!part) return [];
    const tokens = part.split(':');
    const nums = [];
    for (const token of tokens) {
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
      nums.push(parseInt(token, 16));
    }
    return nums;
  };

  if (doubleColonParts.length === 2) {
    const left = parsePart(doubleColonParts[0]);
    const right = parsePart(doubleColonParts[1]);
    if (!left || !right || left.length + right.length >= 8) return null;
    const zeros = new Array(8 - left.length - right.length).fill(0);
    return [...left, ...zeros, ...right];
  }

  const full = parsePart(working);
  return full && full.length === 8 ? full : null;
}

function isBlockedIpv6Hextets(h) {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
  const tailA = (h6 >> 8) & 0xff;
  const tailB = h6 & 0xff;

  // Unspecified (::/128) & Loopback (::1/128)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) {
    return true;
  }

  // IPv4-compatible IPv6 (::w.x.y.z, ::/96)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isPrivateOrReservedIpv4Octets(tailA, tailB);
  }

  // IPv4-mapped IPv6 (::ffff:w.x.y.z)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isPrivateOrReservedIpv4Octets(tailA, tailB);
  }

  // SIIT IPv4-translated IPv6 (::ffff:0:w.x.y.z)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0) {
    return isPrivateOrReservedIpv4Octets(tailA, tailB);
  }

  // NAT64 Well-Known Prefix (64:ff9b::/96 and local-use 64:ff9b:1::/48)
  if (h0 === 0x0064 && h1 === 0xff9b && ((h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) || h2 === 1)) {
    return isPrivateOrReservedIpv4Octets(tailA, tailB);
  }

  // 6to4 (2002::/16) embeds IPv4 in h1:h2
  if (h0 === 0x2002) {
    const v4a = (h1 >> 8) & 0xff;
    const v4b = h1 & 0xff;
    return isPrivateOrReservedIpv4Octets(v4a, v4b);
  }

  // Multicast (ff00::/8)
  if ((h0 & 0xff00) === 0xff00) {
    return true;
  }

  // Link-local (fe80::/10)
  if ((h0 & 0xffc0) === 0xfe80) {
    return true;
  }

  // Unique Local Address (fc00::/7)
  if ((h0 & 0xfe00) === 0xfc00) {
    return true;
  }

  return false;
}

export function isBlockedNotificationHost(rawHost) {
  const rawTrimmed = String(rawHost || '').trim();
  if (!rawTrimmed) return true;

  let candidate = rawTrimmed.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!candidate) return true;

  // 先用标准 WHATWG URL 解析器规范化主机名（将八进制 0177.0.0.1、十进制 2130706433、缩写 127.1、十六进制 0x7f.1 等统一转为标准点分 IPv4）
  let host = candidate;
  try {
    const authorityHost = candidate.includes(':') ? `[${candidate}]` : candidate;
    const normalizedUrl = new URL(`http://${authorityHost}`);
    host = normalizedUrl.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  } catch (_) {
    return true;
  }
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata' ||
    host === 'instance-data' ||
    host === '0' ||
    host === '0.0.0.0'
  ) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    return isPrivateOrReservedIpv4Octets(octets[0], octets[1]);
  }

  if (host.includes(':')) {
    const hextets = parseIpv6Hextets(host);
    if (!hextets) return true;
    return isBlockedIpv6Hextets(hextets);
  }

  return false;
}

export function validateSafeNotificationUrl(rawUrl) {
  let parsed;
  try {
    parsed = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new Error('通知目标 URL 格式无效');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('通知目标 URL 仅支持 http/https 协议');
  }

  if (isBlockedNotificationHost(parsed.hostname)) {
    throw new Error('通知目标地址不允许指向本地回环、内网或云元数据地址');
  }

  return parsed;
}

export function splitNotificationEntries(entries, maxChars = NOTIFICATION_CHUNK_MAX_CHARS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const limit = Math.max(64, Number(maxChars) || NOTIFICATION_CHUNK_MAX_CHARS);
  const chunks = [];
  let currentLines = [];
  let currentClients = [];
  let currentItems = [];
  let currentLen = 0;

  const flush = () => {
    if (currentLines.length === 0) return;
    const text = currentLines.join('\n');
    chunks.push({
      text,
      clients: currentClients,
      count: currentItems.length,
      items: currentItems
    });
    currentLines = [];
    currentClients = [];
    currentItems = [];
    currentLen = 0;
  };

  for (const entry of entries) {
    if (!entry) continue;
    const rawLine = String(entry.text || '').trim();
    if (!rawLine) continue;
    const safeLine = rawLine.length > limit ? `${rawLine.slice(0, limit - 3)}...` : rawLine;
    const addedLen = currentLines.length === 0 ? safeLine.length : currentLen + 1 + safeLine.length;

    if (currentLines.length > 0 && addedLen > limit) {
      flush();
    }

    currentLines.push(safeLine);
    if (entry.client) currentClients.push(String(entry.client));
    currentItems.push(entry.item);
    currentLen = currentLines.length === 1 ? safeLine.length : currentLen + 1 + safeLine.length;
  }

  flush();
  return chunks;
}

// 记录本 isolate 是否已确认资源告警状态为空，避免每分钟重复执行一次 DELETE
let resourceAlertStateKnownEmpty = false;

function getZonedDateParts(timestamp = Date.now(), timezone = 'UTC') {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = normalizeNotificationTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function formatNotificationTime(timestamp = Date.now(), settings = {}) {
  const parts = getZonedDateParts(timestamp, settings?.notification_timezone);
  if (!parts) return getNotificationMessages(settings).invalidTime;
  const pad = value => String(value).padStart(2, '0');
  return `${Number(parts.year)}/${Number(parts.month)}/${Number(parts.day)} ` +
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function formatLastReportTime(timestamp, settings = {}) {
  if (!timestamp) return getNotificationMessages(settings).noReport;

  return formatNotificationTime(timestamp, settings);
}

function isExpireNotificationTimeDue(settings = {}, timestamp = Date.now()) {
  const parts = getZonedDateParts(timestamp, settings.notification_timezone);
  if (!parts) return false;
  return Number(parts.hour) === Number(normalizeExpireNotificationTime(settings.expire_notification_time));
}

function getZonedDateSerial(timestamp, timezone) {
  const parts = getZonedDateParts(timestamp, timezone);
  if (!parts) return NaN;
  return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS);
}

function parseDateSerial(dateString) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }
  return Math.floor(date.getTime() / DAY_MS);
}

function formatMegabitsPerSecond(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0 Mbps';
  const mbps = number * 8 / 1000 / 1000;
  return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0%';
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function getResourceMetricLabel(metric, messages) {
  const metricLabels = {
    cpu: 'CPU',
    ram: 'RAM',
    disk: 'DISK',
    ...messages.metrics
  };
  return metricLabels[metric?.metric] || metric?.metric || '';
}

function formatResourceMetricValue(metric, value) {
  if (metric?.metric === 'cpu' || metric?.metric === 'ram' || metric?.metric === 'disk') {
    return formatPercent(value);
  }
  return formatMegabitsPerSecond(value);
}

function parseResourceAlertState(row) {
  if (!row || !row.value) return { signature: '', servers: {} };
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
      return {
        signature: String(parsed.signature || ''),
        servers: parsed.servers
      };
    }
  } catch (_) {}
  return { signature: '', servers: {} };
}

function hasResourceAlertStateEntries(alertState) {
  return alertState && typeof alertState === 'object' && Object.keys(alertState).length > 0;
}

function getD1Changes(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(changes) && changes > 0 ? changes : 0;
}

export async function clearResourceAlertState(db) {
  if (!db) return false;
  const result = await db.prepare(
    `DELETE FROM settings WHERE key = ?`
  ).bind(RESOURCE_ALERT_STATE_KEY).run();
  resourceAlertStateKnownEmpty = true;
  return getD1Changes(result) > 0;
}

async function saveResourceAlertState(db, configSignature, alertState, hadStoredState) {
  if (hasResourceAlertStateEntries(alertState)) {
    await db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(RESOURCE_ALERT_STATE_KEY, JSON.stringify({ signature: configSignature, servers: alertState })).run();
    resourceAlertStateKnownEmpty = false;
    return;
  }

  if (hadStoredState) {
    await clearResourceAlertState(db);
  }
}

function getResourceAlertStateStatus(state) {
  if (!state || typeof state !== 'object') return RESOURCE_ALERT_STATE_ACTIVE;
  return state.status === RESOURCE_ALERT_STATE_RECOVERED
    ? RESOURCE_ALERT_STATE_RECOVERED
    : RESOURCE_ALERT_STATE_ACTIVE;
}

function getResourceAlertStateTimestamp(state, key) {
  if (!state || typeof state !== 'object') return 0;
  const timestamp = Number(state[key] || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function getStoredResourceAlertMetrics(alert) {
  return (alert?.metrics || []).map(m => ({
    metric: m.metric,
    mode: m.mode,
    threshold: m.threshold,
    triggerValue: m.triggerValue ?? m.current
  }));
}

function canRecoverResourceAlert(evaluation) {
  const metrics = Array.isArray(evaluation?.metrics) ? evaluation.metrics : [];
  return metrics.length > 0 && metrics.every(metric => {
    const current = Number(metric?.current);
    const threshold = Number(metric?.threshold);
    return Number.isFinite(current) && Number.isFinite(threshold) && current < threshold;
  });
}

// compact-v1 的正常节点仅携带数值摘要；只在需要判断恢复时还原完整指标。
function expandResourceAlertEvaluation(evaluation) {
  if (!evaluation?.metricDefinitions) return evaluation;
  const definitions = evaluation.metricDefinitions;
  const values = evaluation.metrics;
  if (!Array.isArray(definitions) || !Array.isArray(values) || definitions.length !== values.length) return null;
  const metrics = [];
  for (let index = 0; index < definitions.length; index++) {
    const summary = values[index];
    // 顺序：triggerValue, current, min, max, avg。异常响应不能被当成恢复。
    if (!Array.isArray(summary) || summary.length !== 5 || !summary.every(Number.isFinite)) return null;
    metrics.push({
      ...definitions[index],
      triggerValue: summary[0],
      triggered: false,
      current: summary[1],
      min: summary[2],
      max: summary[3],
      avg: summary[4]
    });
  }
  return { serverId: evaluation.serverId, metrics };
}

function getResourceAlertRuleIntervalMs(rule) {
  const minutes = Number(rule?.intervalMinutes);
  const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return Math.max(5, normalizedMinutes) * 60 * 1000;
}

function formatCurrentTime(settings = {}) {
  return formatNotificationTime(Date.now(), settings);
}

function getResourceAlertRuleStateKey(rule, serverId) {
  return `${rule.id}:${serverId}`;
}

function getResourceAlertRuleServerIds(rule, servers) {
  const allServerIds = servers.map(server => String(server.id)).filter(Boolean);
  if (!Array.isArray(rule.servers) || rule.servers.length === 0) {
    return allServerIds;
  }

  const allowed = new Set(allServerIds);
  const seen = new Set();
  const ids = [];
  for (const serverId of rule.servers) {
    const id = String(serverId || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function formatConciseResourceMetric(metric, valueKey, messages) {
  const label = getResourceMetricLabel(metric, messages);
  const value = metric?.[valueKey] ?? metric?.current;
  return `${label} ${formatResourceMetricValue(metric, value)}`;
}

function buildGroupedResourceAlertEntries(nodes, valueKey, messages) {
  const groups = new Map();

  for (const item of Array.isArray(nodes) ? nodes : []) {
    const serverName = String(item?.server?.name || '').trim();
    if (!serverName) continue;

    const sourceMetrics = item.alert?.metrics || item.metrics || [];
    if (!Array.isArray(sourceMetrics) || sourceMetrics.length === 0) continue;

    let group = groups.get(serverName);
    if (!group) {
      group = { serverName, metrics: [], seen: new Set(), stateKeys: [] };
      groups.set(serverName, group);
    }

    if (item.key && !group.stateKeys.includes(item.key)) {
      group.stateKeys.push(item.key);
    }

    for (const metric of sourceMetrics) {
      const text = formatConciseResourceMetric(metric, valueKey, messages);
      if (!text || group.seen.has(text)) continue;
      group.seen.add(text);
      group.metrics.push(text);
    }
  }

  return Array.from(groups.values())
    .filter(group => group.metrics.length > 0)
    .map(group => ({
      serverName: group.serverName,
      stateKeys: group.stateKeys,
      text: `${group.serverName}  ${group.metrics.join('  ')}`
    }));
}

function appendResourceAlertNotificationChunks(planItems, entries, options) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  let chunkEntries = [];
  let chunkClients = [];
  let chunkStateKeys = [];
  const flush = () => {
    if (chunkEntries.length === 0) return;

    const nodeList = chunkEntries.map(entry => entry.text).join('\n');
    planItems.push({
      payload: {
        msg: nodeList,
        context: {
          event: options.event,
          emoji: options.emoji,
          clients: chunkClients,
          count: new Set(chunkClients).size || chunkEntries.length,
          message: nodeList
        }
      },
      stateKeys: Array.from(new Set(chunkStateKeys))
    });
    chunkEntries = [];
    chunkClients = [];
    chunkStateKeys = [];
  };

  for (const entry of entries) {
    const candidateEntries = [...chunkEntries, entry];
    const candidateNodeList = candidateEntries.map(item => item.text).join('\n');
    const candidate = candidateNodeList;
    if (chunkEntries.length > 0 && candidate.length > RESOURCE_ALERT_NOTIFICATION_SOFT_LIMIT) {
      flush();
    }
    chunkEntries.push(entry);
    if (entry.serverName) chunkClients.push(entry.serverName);
    if (Array.isArray(entry.stateKeys)) chunkStateKeys.push(...entry.stateKeys);
  }

  flush();
}

function buildResourceAlertDeliveryPlan(alertNodes, recoveredNodes, settings = {}) {
  const messages = getNotificationMessages(settings);
  const planItems = [];
  appendResourceAlertNotificationChunks(
    planItems,
    buildGroupedResourceAlertEntries(alertNodes, 'triggerValue', messages),
    {
      event: messages.events.resourceAlert,
      emoji: '❌'
    }
  );
  appendResourceAlertNotificationChunks(
    planItems,
    buildGroupedResourceAlertEntries(recoveredNodes, 'current', messages),
    {
      event: messages.events.resourceRecovered,
      emoji: '✅'
    }
  );
  return planItems;
}

export function buildResourceAlertNotificationPayloads(alertNodes, recoveredNodes, settings = {}) {
  return buildResourceAlertDeliveryPlan(alertNodes, recoveredNodes, settings).map(item => item.payload);
}

async function evaluateResourceAlertRules(stub, ruleRequests) {
  const resultMap = new Map();
  const requests = [];

  for (const item of Array.isArray(ruleRequests) ? ruleRequests : []) {
    const serverIds = Array.isArray(item?.serverIds) ? item.serverIds : [];
    for (let offset = 0; offset < serverIds.length; offset += RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE) {
      requests.push({
        rule: item.rule,
        serverIds: serverIds.slice(offset, offset + RESOURCE_ALERT_EVALUATE_SERVER_BATCH_SIZE)
      });
    }
  }

  for (let offset = 0; offset < requests.length; offset += RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE) {
    const batch = requests.slice(offset, offset + RESOURCE_ALERT_EVALUATE_RULE_BATCH_SIZE);
    if (batch.length === 0) continue;

    try {
      const response = await stub.fetch('http://internal/evaluate-resource-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultFormat: RESOURCE_ALERT_COMPACT_RESULT_FORMAT,
          rules: batch.map(({ rule, serverIds }) => ({
            ruleId: rule.id,
            serverIds,
            mode: rule.mode,
            windowMinutes: Number(rule.intervalMinutes),
            thresholds: getResourceAlertRuleThresholds(rule)
          }))
        })
      });

      if (!response.ok) {
        console.warn('[ResourceAlert] DO evaluate failed:', response.status);
        continue;
      }

      const result = await response.json();
      for (const item of Array.isArray(result?.results) ? result.results : []) {
        const ruleId = String(item?.ruleId || '').trim();
        if (!ruleId) continue;
        const existing = resultMap.get(ruleId) || {
          alerts: [],
          evaluatedServerIds: [],
          evaluations: []
        };
        const alerts = Array.isArray(item.alerts) ? item.alerts : [];
        const evaluations = Array.isArray(item.evaluations)
          ? item.evaluations.filter(evaluation => evaluation && evaluation.serverId)
          : [];
        existing.alerts.push(...alerts);
        if (item.format === RESOURCE_ALERT_COMPACT_RESULT_FORMAT) {
          // 紧凑响应的 alerts / evaluations 覆盖全部成功评估节点，失败节点仍不参与状态迁移。
          existing.evaluatedServerIds.push(...alerts.map(alert => String(alert.serverId)));
          for (const evaluation of evaluations) {
            evaluation.metricDefinitions = item.metricDefinitions;
            existing.evaluatedServerIds.push(String(evaluation.serverId));
          }
        } else {
          // 滚动部署时仍接受旧 DO 的完整响应。
          existing.evaluatedServerIds.push(...(
            Array.isArray(item.evaluatedServerIds)
              ? item.evaluatedServerIds.map(id => String(id)).filter(Boolean)
              : []
          ));
        }
        existing.evaluations.push(...evaluations);
        resultMap.set(ruleId, existing);
      }
    } catch (e) {
      console.warn('[ResourceAlert] DO evaluate failed:', e?.message || e);
    }
  }

  return resultMap;
}

async function fetchWithRetry(url, options = {}, retries = NOTIFICATION_MAX_RETRIES) {
  const safeUrl = validateSafeNotificationUrl(url);
  for (let i = 0; i < retries; i++) {
    try {
      const requestOptions = {
        ...options,
        redirect: 'error',
        signal: options?.signal || AbortSignal.timeout(NOTIFICATION_FETCH_TIMEOUT_MS)
      };
      const response = await fetch(safeUrl.toString(), requestOptions);
      if (response.ok) return response;

      const status = Number(response.status) || 0;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw new Error(`HTTP ${status}`);
      }

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      } else {
        throw new Error(`HTTP ${status || 'error'}`);
      }
    } catch (e) {
      if (e?.message && /^HTTP 4\d\d$/.test(e.message) && e.message !== 'HTTP 408' && e.message !== 'HTTP 429') {
        throw e;
      }
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      } else {
        throw e;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^[\s✅⚠️⏰💌•-]+/u, '')
    .trim();
}

function inferNotificationEvent(msg, fallback) {
  const firstLine = String(msg || '').split('\n').find(line => line.trim());
  return stripMarkdown(firstLine || fallback) || fallback;
}

function escapeJsonStringFragment(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1);
}

function renderTemplate(template, data, options = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data[key] ?? '';
    return options.jsonString ? escapeJsonStringFragment(value) : String(value);
  });
}

function normalizeNotificationClients(context = {}) {
  const source = Array.isArray(context.clients)
    ? context.clients
    : (context.client ? String(context.client).split(',') : []);
  const clients = source
    .map(client => String(client || '').trim())
    .filter(Boolean);
  if (clients.length > 0) return Array.from(new Set(clients));
  return ['CF Server Monitor'];
}

function inferNotificationEmoji(event) {
  const normalizedEvent = String(event || '');
  if (/恢复|测试|成功/.test(normalizedEvent)) return '✅';
  if (/到期|提醒/.test(normalizedEvent)) return '⚠️';
  if (/离线|告警|失败|异常/.test(normalizedEvent)) return '❌';
  return 'ℹ️';
}

function buildNotificationContext(settings, msg, context = {}) {
  const now = formatCurrentTime(settings);
  const clients = normalizeNotificationClients(context);
  const count = Number.isFinite(Number(context.count)) && Number(context.count) > 0
    ? Number(context.count)
    : clients.length;
  const event = context.event || inferNotificationEvent(msg, getNotificationMessages(settings).events.notification);
  return {
    title: '💌 Cloudflare Server Monitor',
    event,
    emoji: context.emoji || inferNotificationEmoji(event),
    client: context.client || clients.join(', '),
    clients: clients.join(', '),
    count: String(count),
    message: context.message || String(msg || ''),
    time: context.time || now
  };
}

function formatNotificationMessage(settings, msg, context) {
  const template = normalizeNotificationTemplate(settings?.notification_template || DEFAULT_NOTIFICATION_TEMPLATE);
  return renderTemplate(template, context) || String(msg || '');
}

function parseWebhookHeaders(rawHeaders, context) {
  const raw = renderTemplate(normalizeNotificationWebhookHeaders(rawHeaders), context).trim();
  const headers = {};
  if (!raw) return headers;

  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers must be an object');
    }
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || /^(host|content-length)$/i.test(normalizedKey)) continue;
      headers[normalizedKey] = String(value ?? '');
    }
    return headers;
  }

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key || /^(host|content-length)$/i.test(key)) continue;
    headers[key] = line.slice(index + 1).trim();
  }
  return headers;
}

function buildWebhookQueryParams(settings, context) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  try {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]);
    }
  } catch (_) {}

  const params = new URLSearchParams(renderTemplate(rawBody, context));
  return Array.from(params.entries());
}

function renderUrlTemplate(template, data) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data[key] ?? '';
    return encodeURIComponent(String(value));
  });
}

function buildWebhookUrl(settings, context, method) {
  const trimmedRawUrl = String(settings.notification_webhook_url || '').trim();
  if (!trimmedRawUrl) throw new Error('missing webhook url');

  // 禁止通过模板变量动态篡改协议/主机名导致 SSRF
  const staticProbe = trimmedRawUrl.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, 'tpl');
  const baseParsed = validateSafeNotificationUrl(staticProbe);
  const schemeAndAuthority = trimmedRawUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  if (!schemeAndAuthority || /\{\{/.test(schemeAndAuthority[0])) {
    throw new Error('webhook url authority cannot contain template variables');
  }

  const renderedUrl = renderUrlTemplate(trimmedRawUrl, context);
  const url = validateSafeNotificationUrl(renderedUrl);
  if (url.hostname.toLowerCase() !== baseParsed.hostname.toLowerCase()) {
    throw new Error('webhook url host mismatch');
  }

  if (method === 'GET') {
    for (const [key, value] of buildWebhookQueryParams(settings, context)) {
      if (!key) continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildWebhookBody(settings, context, format) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  if (format === 'json') {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    return JSON.stringify(JSON.parse(body));
  }
  if (format === 'form') {
    try {
      const body = renderTemplate(rawBody, context, { jsonString: true });
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(parsed)) {
          params.set(key, String(value ?? ''));
        }
        return params.toString();
      }
    } catch (_) {}
  }
  return renderTemplate(rawBody, context);
}

async function sendCustomWebhookNotification(settings, context) {
  const method = normalizeNotificationWebhookMethod(settings.notification_webhook_method);
  const format = normalizeNotificationWebhookFormat(settings.notification_webhook_format);
  const endpoint = buildWebhookUrl(settings, context, method);
  const headers = parseWebhookHeaders(settings.notification_webhook_headers, context);
  const options = { method, headers };

  if (method !== 'GET') {
    const contentTypeHeader = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!contentTypeHeader) {
      headers['Content-Type'] = format === 'json'
        ? 'application/json'
        : (format === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8');
    }
    options.body = buildWebhookBody(settings, context, format);
  }

  await fetchWithRetry(endpoint, options);
}

// SMTP 通知复用 tg_bot_token 字段，配置以 "smtp:" 前缀协议存储（方案 A）。
// 格式: smtp://<user>:<password>@<host>:<port>?from=<from>&to=<to1,to2>&secure=<auto|tls|starttls>
export function isSmtpNotificationTarget(token) {
  // 与前端保持一致：协议头大小写不敏感（SMTP:// 同样识别）
  return String(token || '').trim().toLowerCase().indexOf('smtp:') === 0;
}

function hasNotificationTarget(settings) {
  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    return String(settings?.notification_webhook_url || '').trim().length > 0;
  }
  // 内置渠道（含 SMTP）只要 tg_bot_token 非空即视为已配置目标
  return String(settings?.tg_bot_token || '').trim().length > 0;
}

// ===== 月流量阈值告警（上报路径触发，账期重置=数值回落，状态={u,th,lim}）=====
const TRAFFIC_ALERT_STATE_KEY = 'traffic_alert_state';
const TRAFFIC_ALERT_RESET_FACTOR = 0.5;

function parseTrafficAlertState(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && Number.isFinite(o.u) && o.u > 0) {
      return { u: Math.round(o.u), th: normalizePct(o.th), lim: normalizeTrafficLimitGb(o.lim) };
    }
  } catch (_) {}
  return null;
}

// hooks.patchCache?.(serverId, valueOrNull) —— 缓存实现由调用方注入，本函数不 import 任何 cache 模块
export async function evaluateTrafficAlert(env, server, metrics, hooks = {}) {
  try {
    if (!env?.DB || !server || !metrics) return;

    const limit = normalizeTrafficLimitGb(server.traffic_limit);
    if (limit <= 0) return; // 未设限额：不监控

    const settings = await loadSiteSettings(env.DB);
    const globalPct = normalizePct(settings?.traffic_alert_threshold);
    // 逐台阈值三态：null/未设置 → 跟随全局；数字（含 0）→ 覆盖，0 = 显式关闭该服务器告警
    const pctServer = normalizePctOrNull(server.traffic_alert_percent);
    const effectivePct = pctServer === null ? globalPct : pctServer;
    if (effectivePct <= 0) return;                 // 阈值关闭 / 该服务器显式关闭
    if (!hasNotificationTarget(settings)) return;  // 未配置通知渠道：不发也不写

    const used = Math.round(getTrafficUsageBytes(
      metrics.net_rx_monthly,
      metrics.net_tx_monthly,
      server.traffic_calc_type
    ));
    const limitBytes = limit * GB;
    const percent = (used / limitBytes) * 100;

    const oldStr = server[TRAFFIC_ALERT_STATE_KEY] == null ? '' : String(server[TRAFFIC_ALERT_STATE_KEY]);
    const state = parseTrafficAlertState(server[TRAFFIC_ALERT_STATE_KEY]);

    if (state) {
      // ① 回落=新账期/重装/大校正 → 持久清零（不可只在内存即时重算）
      if (used < state.u * TRAFFIC_ALERT_RESET_FACTOR) {
        const { meta } = await env.DB.prepare(
          `UPDATE servers SET traffic_alert_state = NULL WHERE id = ? AND COALESCE(traffic_alert_state,'') = ?`
        ).bind(server.id, oldStr).run();
        if (meta && meta.changes > 0) {
          hooks.patchCache?.(server.id, null);
        } else {
          hooks.invalidateCache?.(server.id);
        }
        return;
      }
      // ② 规则签名一致且未回落 → 同账期已发，抑制
      if (state.th === effectivePct && state.lim === limit) return;
      // ③ th/lim 变 → 重新可发，继续
    }

    if (percent < effectivePct) return; // 未达阈值

    // 先发后写
    const serverName = server.name || server.id;
    const messages = getNotificationMessages(settings);
    const usage = messages.trafficUsed({
      usedGb: (used / GB).toFixed(1),
      limitGb: limit,
      percent: percent.toFixed(1),
      threshold: effectivePct
    });
    const msg = `${serverName}  ${usage}`;
    const err = await sendNotification(settings, msg, {
      event: messages.events.trafficAlert,
      emoji: '📈',
      clients: [serverName],
      count: 1,
      message: msg
    });
    if (err) return; // 失败：不写，下次上报重试

    const newStr = JSON.stringify({ u: used, th: effectivePct, lim: limit });
    const { meta } = await env.DB.prepare(
      `UPDATE servers SET traffic_alert_state = ? WHERE id = ? AND COALESCE(traffic_alert_state,'') = ?`
    ).bind(newStr, server.id, oldStr).run();
    if (meta && meta.changes > 0) {
      hooks.patchCache?.(server.id, newStr);
    } else {
      hooks.invalidateCache?.(server.id);
    }
  } catch (e) {
    console.error('[traffic-alert] evaluate failed:', e);
  }
}

const SMTP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 信封地址防注入：剥离 CR/LF 并校验邮箱格式（subject/body 已有 sanitize，信封同样需要）
function normalizeSmtpAddress(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function parseSmtpNotificationConfig(rawToken) {
  const url = new URL(String(rawToken).trim());
  const host = url.hostname;
  if (!host) throw new Error('缺少 SMTP 主机');
  if (isBlockedNotificationHost(host)) {
    throw new Error('SMTP 主机不允许指向本地回环、内网或云元数据地址');
  }

  const secureParam = (url.searchParams.get('secure') || 'auto').toLowerCase();
  // 不提供 'off'（明文传输），避免凭据被静默降级为明文发送
  const allowedSecure = ['auto', 'tls', 'starttls'];
  const secureTransport = allowedSecure.includes(secureParam) ? secureParam : 'auto';
  const port = url.port ? Number(url.port) : (secureTransport === 'tls' ? 465 : 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('SMTP 端口无效');
  }
  // Cloudflare Workers 永久封禁 25 端口出站
  if (port === 25) {
    throw new Error('Cloudflare Workers 不支持 25 端口，请使用 465(implicit TLS) 或 587(STARTTLS)');
  }
  // auto 模式下非 465/587 端口会被库推导为明文连接，必须显式指定加密方式
  if (secureTransport === 'auto' && port !== 465 && port !== 587) {
    throw new Error('非 465/587 端口必须显式指定加密方式 (secure=tls 或 secure=starttls)');
  }

  const decode = value => {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  };
  const username = decode(url.username || '');
  const password = decode(url.password || '');
  if (!username) throw new Error('缺少 SMTP 用户名');
  if (!password) throw new Error('缺少 SMTP 密码');

  const from = normalizeSmtpAddress(url.searchParams.get('from') || username);
  if (!SMTP_EMAIL_PATTERN.test(from)) throw new Error('SMTP 发件人地址无效');
  const to = (url.searchParams.get('to') || '')
    .split(',')
    .map(normalizeSmtpAddress)
    .filter(Boolean);
  if (to.length === 0) throw new Error('缺少收件人 (to)');
  if (to.some(address => !SMTP_EMAIL_PATTERN.test(address))) {
    throw new Error('SMTP 收件人地址无效');
  }

  return { host, port, username, password, from, to, secureTransport };
}

// 仅对临时性失败重试：连接类异常与 4xx（如 421/450 限流、暂时不可用）；
// 5xx 为永久性拒绝（550 收件人拒绝等），454 为认证失败（部分邮箱如 QQ 使用 4xx 码），
// 两者重试无意义且易触发邮箱风控
function isSmtpRetryableError(error) {
  const match = String(error?.message || error).match(/SMTP error (\d{3})/);
  if (!match) return true;
  const code = Number(match[1]);
  return code >= 400 && code < 500 && code !== 454;
}

async function withSmtpRetry(task, retries = NOTIFICATION_MAX_RETRIES) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      await task();
      return;
    } catch (e) {
      lastError = e;
      if (!isSmtpRetryableError(e)) break;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

function withPromiseTimeout(promise, timeoutMs, timeoutMessage) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function sendSmtpNotification(settings, context, formattedMsg) {
  let config;
  try {
    config = parseSmtpNotificationConfig(settings.tg_bot_token);
  } catch (e) {
    return `SMTP 通知配置错误: ${e.message}`;
  }
  try {
    // 动态导入：cloudflare-smtp 依赖 cloudflare:sockets，仅在运行时（Workers）加载
    const { sendMail } = await import('cloudflare-smtp');
    const rawSubject = `${context.emoji || ''} ${context.event || getNotificationMessages(settings).events.notification}`;
    const subject = rawSubject.replace(/[\r\n\u0000]+/g, ' ').trim().slice(0, 256);
    const text = String(formattedMsg || '').replace(/\*/g, '');
    await withSmtpRetry(() => withPromiseTimeout(
      sendMail(
        {
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          from: config.from,
          to: config.to,
          secureTransport: config.secureTransport
        },
        { subject, text }
      ),
      SMTP_SEND_TIMEOUT_MS,
      'SMTP 发送超时'
    ));
    return;
  } catch (e) {
    return `SMTP 邮件通知发送失败: ${e.message}`;
  }
}

function matchesExactOrSubdomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export async function sendNotification(settings, msg, notificationContext = {}) {
  const context = buildNotificationContext(settings || {}, msg, notificationContext);
  const formattedMsg = formatNotificationMessage(settings || {}, msg, context);
  context.notification = formattedMsg;
  const title = context.title;

  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    if (!String(settings?.notification_webhook_url || '').trim()) return "自定义 Webhook 通知失败: 缺少 URL";
    try {
      await sendCustomWebhookNotification(settings, context);
      return;
    } catch (e) {
      return "自定义 Webhook 通知发送失败: " + e.message;
    }
  }

  const rawToken = String(settings?.tg_bot_token || '').trim();
  if (!rawToken) return;
  if (isSmtpNotificationTarget(rawToken)) {
    // SMTP 邮件通知（前缀协议: smtp://...），置于内置渠道分发链最前
    return await sendSmtpNotification(settings, context, formattedMsg);
  }
  if (rawToken.toLowerCase().startsWith('onebot:')) {
    const onebotUrl = rawToken.slice('onebot:'.length).trim();
    const targetId = settings.tg_chat_id || '';
    if (!targetId) {
      return "OneBot 通知失败: 缺少 tg_chat_id（私人: QQ号，群: group:群号）";
    }
    try {
      const parsedUrl = validateSafeNotificationUrl(onebotUrl);
      const isGroup = parsedUrl.pathname.includes('send_group_msg');
      const body = {
        [isGroup ? 'group_id' : 'user_id']: targetId,
        message: [
          {
            type: 'text',
            data: {
              text: `${title}\n${String(formattedMsg || '').replace(/\*/g, '')}\n`
            }
          }
        ]
      };
      await fetchWithRetry(parsedUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return;
    } catch (e) {
      return "OneBot 通知发送失败: " + e.message;
    }
  }
  if (rawToken.toLowerCase().startsWith('bark:')) {
    const barkUrl = rawToken.slice('bark:'.length).trim();
    try {
      const parsedUrl = validateSafeNotificationUrl(barkUrl);
      await fetchWithRetry(parsedUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          markdown: formattedMsg,
          group: "Cloudflare Server Monitor"
        })
      });
      return;
    } catch (e) {
      return "Bark通知发送失败: " + e.message;
    }
  }
  if (rawToken.toLowerCase().startsWith('server:')) {
    const serverUrl = rawToken.slice('server:'.length).trim();
    try {
      const parsedUrl = validateSafeNotificationUrl(serverUrl);
      await fetchWithRetry(parsedUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          desp: formattedMsg
        })
      });
      return;
    } catch (e) {
      return "Server酱通知发送失败: " + e.message;
    }
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawToken)) {
    let parsedUrl;
    try {
      parsedUrl = validateSafeNotificationUrl(rawToken);
    } catch (e) {
      return "通知地址校验失败: " + e.message;
    }
    const hostname = parsedUrl.hostname.toLowerCase();

    if (matchesExactOrSubdomain(hostname, 'feishu.cn') || matchesExactOrSubdomain(hostname, 'larksuite.com')) {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            msg_type: "interactive",
            card: {
              schema: "2.0",
              header: { template: "blue", title: { content: title, tag: "plain_text" } },
              body: { elements: [{ tag: "markdown", content: formattedMsg }] }
            }
          })
        });
        return;
      } catch (e) {
        return "飞书通知发送失败: " + e.message;
      }
    }

    if (hostname === 'oapi.dingtalk.com' || hostname === 'api.dingtalk.com') {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: "markdown",
            markdown: { title: title, text: formattedMsg }
          })
        });
        return;
      } catch (e) {
        return "钉钉通知发送失败: " + e.message;
      }
    }

    if (hostname === 'api.day.app') {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            markdown: formattedMsg,
            group: "Cloudflare Server Monitor"
          })
        });
        return;
      } catch (e) {
        return "Bark通知发送失败: " + e.message;
      }
    }

    if (hostname === 'qyapi.weixin.qq.com') {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: "text",
            text: {
              content: formattedMsg.replace(/\*/g, '')
            }
          })
        });
        return;
      } catch (e) {
        return "企业微信通知发送失败: " + e.message;
      }
    }

    if (hostname === 'sctapi.ftqq.com') {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            desp: formattedMsg
          })
        });
        return;
      } catch (e) {
        return "Server酱通知发送失败: " + e.message;
      }
    }

    if (hostname === 'wxpusher.zjiecode.com' && parsedUrl.pathname.startsWith('/api/send/message/SPT_')) {
      const match = parsedUrl.pathname.match(/\/message\/(SPT_[A-Za-z0-9_-]+)/);
      const spt = match ? match[1] : null;
      if (!spt) return "WxPusher 通知失败: 无法提取 SPT";
      try {
        await fetchWithRetry("https://wxpusher.zjiecode.com/api/send/message/simple-push", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: formattedMsg,
            summary: title,
            contentType: 3,
            spt
          })
        });
        return;
      } catch (e) {
        return "WxPusher通知发送失败: " + e.message;
      }
    }

    if (parsedUrl.pathname.endsWith('/message') && parsedUrl.searchParams.has('token')) {
      try {
        await fetchWithRetry(parsedUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title,
            message: formattedMsg,
            priority: 5,
            extras: {
              "client::display": { "contentType": "text/markdown" }
            }
          })
        });
        return;
      } catch (e) {
        return "Gotify通知发送失败: " + e.message;
      }
    }

    return "未知的通知方式";
  }

  if (settings.tg_chat_id) {
    if (!/^[A-Za-z0-9:_-]+$/.test(rawToken)) {
      return "Telegram 通知发送失败: Bot Token 格式无效";
    }
    try {
      await fetchWithRetry(`https://api.telegram.org/bot${rawToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.tg_chat_id,
          text: formattedMsg
        })
      });
      return;
    } catch (e) {
      return "Telegram 通知发送失败: " + e.message;
    }
  }

  return "未知的通知方式";
}

export async function checkOfflineNodes(db, options = {}) {
  const siteSettings = options.siteSettings ?? await loadSiteSettings(db);
  const tgNotifyMinutes = getTgNotifyMinutes(siteSettings.tg_notify);

  if (tgNotifyMinutes === 0 || !hasNotificationTarget(siteSettings)) return;

  try {
    const allServers = await getAllServers(db);
    const existingServerIds = new Set(allServers.map(server => String(server.id)));
    const servers = allServers.filter(server => server.offline_notify_disabled !== '1');
    if (servers.length === 0) return;

    const latestTimestampsMap = await getLatestTimestampsForAllServers(db, { servers });
    if (!latestTimestampsMap) {
      // 获取失败时跳过本次检测，避免把所有服务器误判为离线
      debug('[Cron] 获取最新上报时间戳失败，跳过本次离线检测');
      return;
    }

    let alertState = {};
    const stateRes = await db.prepare(
      "SELECT value FROM settings WHERE key = 'alert_state'"
    ).first();
    
    if (stateRes && stateRes.value) {
      try {
        const parsed = JSON.parse(stateRes.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          alertState = Object.assign({}, parsed);
        }
      } catch (e) {
        alertState = {};
      }
    }

    let stateChanged = false;
    // 清理已从数据库删除的服务器残留 key，保留仍存在于 allServers 的节点状态
    for (const key of Object.keys(alertState)) {
      if (!existingServerIds.has(key)) {
        delete alertState[key];
        stateChanged = true;
      }
    }

    const now = Date.now();
    const offlineThreshold = tgNotifyMinutes * 60 * 1000;
    const offlineNodes = [];
    const recoveredNodes = [];

    for (const s of servers) {
      const hasLatestReport = latestTimestampsMap.has(s.id);
      const lastReportTime = latestTimestampsMap.get(s.id);

      let isOffline = true;
      if (hasLatestReport) {
        isOffline = now - lastReportTime > offlineThreshold;
      }

      if (isOffline && !Object.hasOwn(alertState, s.id)) {
        offlineNodes.push({
          id: s.id,
          name: s.name,
          lastReportTime
        });
      } else if (!isOffline && Object.hasOwn(alertState, s.id) && alertState[s.id]) {
        recoveredNodes.push(s);
      }
    }

    const messages = getNotificationMessages(siteSettings);

    if (offlineNodes.length > 0) {
      const offlineChunks = splitNotificationEntries(
        offlineNodes.map(n => ({
          text: `${n.name}  ${messages.lastReport(formatLastReportTime(n.lastReportTime, siteSettings))}`,
          client: n.name,
          item: n
        })),
        NOTIFICATION_CHUNK_MAX_CHARS
      );
      for (const chunk of offlineChunks) {
        const err = await sendNotification(siteSettings, chunk.text, {
          event: messages.events.offline,
          emoji: '❌',
          clients: chunk.clients,
          count: chunk.count,
          message: chunk.text
        });
        if (err) {
          console.error('[Cron] 离线告警通知发送失败，下一轮重试:', err);
        } else {
          for (const n of chunk.items) {
            alertState[n.id] = true;
          }
          stateChanged = true;
        }
      }
    }

    if (recoveredNodes.length > 0) {
      const recoveredChunks = splitNotificationEntries(
        recoveredNodes.map(n => ({
          text: n.name,
          client: n.name,
          item: n
        })),
        NOTIFICATION_CHUNK_MAX_CHARS
      );
      for (const chunk of recoveredChunks) {
        const err = await sendNotification(siteSettings, chunk.text, {
          event: messages.events.recovered,
          emoji: '✅',
          clients: chunk.clients,
          count: chunk.count,
          message: chunk.text
        });
        if (err) {
          console.error('[Cron] 恢复通知发送失败，下一轮重试:', err);
        } else {
          for (const s of chunk.items) {
            delete alertState[s.id];
          }
          stateChanged = true;
        }
      }
    }

    if (stateChanged) {
      await db.prepare(
        'INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(JSON.stringify(alertState)).run();
    }
  } catch (e) {
    console.error('离线检测失败:', e);
  }
}

export async function checkResourceAlerts(env, options = {}) {
  if (!env?.DB || !env?.METRICS_BROADCASTER) return;

  const db = env.DB;
  const minute = Number.isFinite(options?.minute) ? options.minute : new Date().getUTCMinutes();
  // 每 2 分钟强制刷新一次设置，其余分钟复用缓存（TTL 120s），降低每分钟的 CPU 开销
  const forceRefresh = minute % 2 === 0;
  const siteSettings = options.siteSettings ?? await loadSiteSettings(db, { forceRefresh });
  if (!hasNotificationTarget(siteSettings)) return;

  const resourceConfig = getResourceAlertConfig(siteSettings);

  if (!resourceConfig.enabled || !resourceConfig.hasRules) {
    if (!resourceAlertStateKnownEmpty) {
      await clearResourceAlertState(db);
    }
    return;
  }

  try {
    const allServers = await getAllServers(db);
    if (allServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const serverMap = new Map(allServers.map(server => [String(server.id), server]));
    const id = env.METRICS_BROADCASTER.idFromName('global');
    const stub = env.METRICS_BROADCASTER.get(id);
    const activeMap = new Map();
    const evaluationMap = new Map();
    const configuredRules = [];
    const configuredRuleServers = [];
    const evaluatedRuleServers = [];

    const configSignature = JSON.stringify({
      rules: resourceConfig.rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        servers: rule.servers,
        intervalMinutes: rule.intervalMinutes,
        mode: rule.mode
      }))
    });

    for (const rule of resourceConfig.rules) {
      const serverIds = getResourceAlertRuleServerIds(rule, allServers);
      if (serverIds.length === 0) continue;

      const ruleServers = [];
      for (const serverId of serverIds) {
        const server = serverMap.get(String(serverId));
        if (!server) continue;
        ruleServers.push({
          key: getResourceAlertRuleStateKey(rule, serverId),
          rule,
          server,
          serverId: String(serverId)
        });
      }
      if (ruleServers.length === 0) continue;
      configuredRuleServers.push(...ruleServers);
      configuredRules.push({ rule, serverIds, ruleServers });
    }

    if (configuredRuleServers.length === 0) {
      await clearResourceAlertState(db);
      return;
    }

    const evaluationResults = await evaluateResourceAlertRules(stub, configuredRules);
    for (const { rule, ruleServers } of configuredRules) {
      const result = evaluationResults.get(String(rule.id));
      if (!result) continue;
      const evaluatedServerIdSet = new Set(result.evaluatedServerIds);
      evaluatedRuleServers.push(...ruleServers.filter(item => evaluatedServerIdSet.has(item.serverId)));
      for (const alert of result.alerts) {
        activeMap.set(getResourceAlertRuleStateKey(rule, alert.serverId), { rule, alert });
      }
      for (const evaluation of result.evaluations || []) {
        evaluationMap.set(getResourceAlertRuleStateKey(rule, evaluation.serverId), evaluation);
      }
    }

    const stateRow = await db.prepare(
      `SELECT value FROM settings WHERE key = ?`
    ).bind(RESOURCE_ALERT_STATE_KEY).first();
    const hadStoredState = !!stateRow;
    const parsedState = parseResourceAlertState(stateRow);
    const nextAlertState = parsedState.servers && typeof parsedState.servers === 'object' && !Array.isArray(parsedState.servers)
      ? { ...parsedState.servers }
      : {};

    const now = Date.now();
    const alertNodes = [];
    const recoveredNodes = [];
    const pendingStateUpdates = new Map();
    const validStateKeys = new Set(configuredRuleServers.map(item => item.key));
    let nonNotifiedStateChanged = hadStoredState && parsedState.signature !== configSignature;

    for (const key of Object.keys(nextAlertState)) {
      if (!validStateKeys.has(key)) {
        delete nextAlertState[key];
        nonNotifiedStateChanged = true;
      }
    }

    for (const { key, rule, server } of evaluatedRuleServers) {
      const active = activeMap.get(key);
      const alert = active?.alert;
      const currentState = nextAlertState[key];
      const currentStatus = currentState
        ? getResourceAlertStateStatus(currentState)
        : '';
      const ruleIntervalMs = getResourceAlertRuleIntervalMs(rule);

      if (alert) {
        const isActiveAlert = currentStatus === RESOURCE_ALERT_STATE_ACTIVE;
        const recoveredAt = currentStatus === RESOURCE_ALERT_STATE_RECOVERED
          ? getResourceAlertStateTimestamp(currentState, 'recoveredAt')
          : 0;
        if (recoveredAt > 0 && now - recoveredAt < ruleIntervalMs) {
          continue;
        }

        if (!isActiveAlert) {
          const serverName = String(server?.name || '').trim();
          const newEntry = {
            status: RESOURCE_ALERT_STATE_ACTIVE,
            alertAt: now,
            lastTriggeredAt: now,
            metrics: getStoredResourceAlertMetrics(alert)
          };
          if (serverName) {
            alertNodes.push({ key, rule, server, alert });
            pendingStateUpdates.set(key, newEntry);
          } else {
            nextAlertState[key] = newEntry;
            nonNotifiedStateChanged = true;
          }
        } else {
          const lastTriggeredAt = getResourceAlertStateTimestamp(currentState, 'lastTriggeredAt');
          if (lastTriggeredAt === 0 || now - lastTriggeredAt >= ruleIntervalMs) {
            nextAlertState[key] = {
              ...currentState,
              status: RESOURCE_ALERT_STATE_ACTIVE,
              alertAt: getResourceAlertStateTimestamp(currentState, 'alertAt') || now,
              lastTriggeredAt: now,
              metrics: getStoredResourceAlertMetrics(alert)
            };
            nonNotifiedStateChanged = true;
          }
        }
      } else if (currentState) {
        if (currentStatus === RESOURCE_ALERT_STATE_ACTIVE) {
          const evaluation = expandResourceAlertEvaluation(evaluationMap.get(key));
          if (!canRecoverResourceAlert(evaluation)) {
            continue;
          }

          const serverName = String(server?.name || '').trim();
          const recoveredEntry = {
            ...currentState,
            status: RESOURCE_ALERT_STATE_RECOVERED,
            recoveredAt: now,
            metrics: evaluation?.metrics || currentState.metrics
          };
          if (serverName) {
            recoveredNodes.push({ key, rule, server, metrics: evaluation?.metrics || [] });
            pendingStateUpdates.set(key, recoveredEntry);
          } else {
            nextAlertState[key] = recoveredEntry;
            nonNotifiedStateChanged = true;
          }
        } else {
          const recoveredAt = getResourceAlertStateTimestamp(currentState, 'recoveredAt');
          if (recoveredAt === 0 || now - recoveredAt >= ruleIntervalMs) {
            delete nextAlertState[key];
            nonNotifiedStateChanged = true;
          }
        }
      }
    }

    // 先发送通知分片，仅将发送成功的分片关联的 stateKeys 写入持久化状态；
    // 发送失败的分片保留原状态，以便下一分钟重试，杜绝“先存库后发通知”漏报。
    let notifiedStateChanged = false;
    const deliveryPlan = buildResourceAlertDeliveryPlan(alertNodes, recoveredNodes, siteSettings);
    for (const item of deliveryPlan) {
      const notificationError = await sendNotification(siteSettings, item.payload.msg, item.payload.context);
      if (notificationError) {
        console.warn('[ResourceAlert] notification failed:', notificationError);
        continue;
      }
      for (const key of item.stateKeys) {
        if (pendingStateUpdates.has(key)) {
          nextAlertState[key] = pendingStateUpdates.get(key);
          notifiedStateChanged = true;
        }
      }
    }

    if (nonNotifiedStateChanged || notifiedStateChanged) {
      await saveResourceAlertState(db, configSignature, nextAlertState, hadStoredState);
    }
  } catch (e) {
    console.error('资源负载告警检测失败:', e);
  }
}

export async function checkExpiringServers(db, options = {}) {
  const siteSettings = await loadSiteSettings(db);
  const now = Number(options?.now || Date.now());

  try {
    const zonedParts = getZonedDateParts(now, siteSettings.notification_timezone);
    const referenceDateStr = zonedParts
      ? `${String(zonedParts.year).padStart(4, '0')}-${String(zonedParts.month).padStart(2, '0')}-${String(zonedParts.day).padStart(2, '0')}`
      : undefined;
    const todaySerial = String(getZonedDateSerial(now, siteSettings.notification_timezone));

    // 当日提醒状态：sent=true 已发送（当日不再重复）；sent=false 发送失败，等待下一小时重试
    let reminderState = null;
    try {
      const res = await db.prepare(
        "SELECT value FROM settings WHERE key = 'expire_reminder_state'"
      ).first();
      reminderState = res ? JSON.parse(res.value) : null;
    } catch (e) {
      reminderState = null;
    }
    const sentToday = reminderState?.date === todaySerial && reminderState?.sent === true;
    const failedToday = reminderState?.date === todaySerial && reminderState?.sent === false;

    // 到达配置的提醒时间，或当天此前发送失败需要重试时才继续
    if (options?.scheduled && !isExpireNotificationTimeDue(siteSettings, now) && !failedToday) {
      return false;
    }

    const allServers = await getAllServers(db);
    const reminderDays = getExpireReminderDays(siteSettings.expire_reminder);
    const renewedServers = [];

    // 先完成自动续费遍历，确保即使当天已发送过到期提醒（sentToday），新到期的自动续费机器仍能按时推进账期
    for (const s of allServers) {
      if (!s.expire_date) continue;

      const billingCycle = normalizeBillingCycle(detectBillingCycle(s.price) || s.billing_cycle);
      // 续费时机 = 到期日 - min(提醒天数, 5)，最长提前 5 天
      const renewal = renewExpireDateIfNeeded(
        s.expire_date,
        billingCycle,
        s.auto_renewal,
        now,
        Math.min(reminderDays, 5),
        { referenceDateStr }
      );
      if (renewal.renewed) {
        await db.prepare(
          'UPDATE servers SET expire_date = ?, billing_cycle = ? WHERE id = ?'
        ).bind(renewal.expire_date, billingCycle, s.id).run();
        s.expire_date = renewal.expire_date;
        s.billing_cycle = billingCycle;
        renewedServers.push({ name: s.name, expire_date: renewal.expire_date });
        debug(`[Cron] 服务器 ${s.name} 已自动续费，到期日期更新为 ${s.expire_date}`);
      }
    }

    const messages = getNotificationMessages(siteSettings);
    if (renewedServers.length > 0) {
      clearServersListCache();

      // 续费成功提醒：与「到期提醒」开关解耦，只要配置了通知渠道就发送
      if (hasNotificationTarget(siteSettings)) {
        const renewalChunks = splitNotificationEntries(
          renewedServers.map(s => ({
            text: `${s.name}  ${messages.renewedUntil(s.expire_date)}`,
            client: s.name,
            item: s
          })),
          NOTIFICATION_CHUNK_MAX_CHARS
        );
        for (const chunk of renewalChunks) {
          debug(`[Cron] 发送自动续费成功通知: ${chunk.text}`);
          const err = await sendNotification(siteSettings, chunk.text, {
            event: messages.events.renewed,
            emoji: '✅',
            clients: chunk.clients,
            count: chunk.count,
            message: chunk.text
          });
          if (err) {
            console.error('自动续费成功通知发送失败:', err);
          }
        }
      }
    }

    if (sentToday) {
      return false;
    }

    const expiringServers = [];
    const shouldNotify = reminderDays > 0 && hasNotificationTarget(siteSettings);
    const currentDateSerial = getZonedDateSerial(now, siteSettings.notification_timezone);

    for (const s of allServers) {
      if (!s.expire_date) continue;
      // 勾选自动续费的节点只走「续费成功」提醒，不计入到期提醒
      if (isEnabledFlag(s.auto_renewal)) continue;
      if (!shouldNotify) continue;

      const expireDateSerial = parseDateSerial(s.expire_date);
      if (!Number.isFinite(expireDateSerial) || !Number.isFinite(currentDateSerial)) continue;

      const days = expireDateSerial - currentDateSerial;
      debug(`[Cron] 检测到服务器 ${s.name} 到期日期 ${s.expire_date}，剩余天数 ${days} 天`);

      if (days > 0 && days <= reminderDays) {
        expiringServers.push({ name: s.name, expire_date: s.expire_date, days });
      }
    }

    if (expiringServers.length > 0) {
      const expiringChunks = splitNotificationEntries(
        expiringServers.map(s => ({
          text: `${s.name}  ${messages.daysLeft(s.days)}  ${s.expire_date}`,
          client: s.name,
          item: s
        })),
        NOTIFICATION_CHUNK_MAX_CHARS
      );
      let allSent = true;
      for (const chunk of expiringChunks) {
        debug(`[Cron] 发送到期提醒通知: ${chunk.text}`);
        const err = await sendNotification(siteSettings, chunk.text, {
          event: messages.events.expiring,
          emoji: '⚠️',
          clients: chunk.clients,
          count: chunk.count,
          message: chunk.text
        });
        if (err) {
          allSent = false;
          console.error('服务器到期提醒通知发送失败，下一小时重试:', err);
        }
      }
      try {
        await db.prepare(
          "INSERT INTO settings (key, value) VALUES ('expire_reminder_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(JSON.stringify({ date: todaySerial, sent: allSent })).run();
      } catch (e) {
        console.error('写入到期提醒状态失败:', e);
      }
    }
    return true;
  } catch (e) {
    console.error('到期检测失败:', e);
    return false;
  }
}
