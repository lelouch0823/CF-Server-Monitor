import { getAllServers, getLatestMetricsCache, setLatestMetricsCache, getMetricsHistoryCache, setMetricsHistoryCache, getCacheDuration, clearAllCaches } from '../utils/cache.js';
import { saveSiteOptions, debug, normalizeLongHistoryPoints, DEFAULT_LONG_HISTORY_POINTS } from '../utils/settings.js';
import {
  attachDiskMetricsObject,
  flattenDiskMetrics,
  isDisabledProbeMetric,
  normalizeProbeMetricRow,
  sanitizeGpuInfo,
  toSafeMetricFloat,
  toSafeMetricInt,
  toSafeMetricString
} from '../utils/metrics.js';
import {
  ensureServerOptimization,
  buildHistoryId,
  getServerHistoryInfo,
  getHistoryIdRange,
  SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL
} from './indexOptimization.js';
import { addHistoryColumns } from './updateDatabase.js';
import {
  buildSparseHistoryQuery,
  shouldUseSparseHistorySampling
} from './historySampling.js';
import {
  createHistoryTableSql,
  HISTORY_INSERT_COLUMNS,
  HISTORY_TABLE_COLUMNS
} from '../utils/historyFields.js';
import {
  DASHBOARD_LATENCY_WINDOW_CACHE_MAX_SERVERS,
  DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS,
  DASHBOARD_LATENCY_WINDOW_HOURS,
  DASHBOARD_LATENCY_WINDOW_POINTS,
  DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY
} from '../utils/config.js';

const initializedDbs = new WeakSet();
let fallbackDbInitialized = false;

function isDbInitialized(db) {
  if (db && typeof db === 'object') return initializedDbs.has(db);
  return fallbackDbInitialized;
}

function setDbInitialized(db, value) {
  if (db && typeof db === 'object') {
    if (value) initializedDbs.add(db);
    else initializedDbs.delete(db);
  } else {
    fallbackDbInitialized = Boolean(value);
  }
}

const LOSS_AGG_COLUMNS = new Set(['loss_ct', 'loss_cu', 'loss_cm', 'loss_bd', 'loss_node_1', 'loss_node_2', 'loss_node_3', 'loss_node_4']);
const VALID_HISTORY_COLUMN_SET = new Set(HISTORY_TABLE_COLUMNS.map(([name]) => name));
const DEFAULT_HISTORY_MAX_POINTS = 160;
const MIN_VALID_METRIC_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_METRIC_DRIFT_MS = 120 * 1000;
const MAX_PING_LATENCY_MS = 600000;

export function clampMetricTimestamp(value, serverNow = Date.now()) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return serverNow;
  const ms = raw < 10000000000 ? raw * 1000 : raw;
  if (ms < MIN_VALID_METRIC_TIMESTAMP_MS || ms > serverNow + MAX_FUTURE_METRIC_DRIFT_MS) {
    return serverNow;
  }
  return Math.trunc(ms);
}

function parseValidatedHistoryColumns(columns) {
  const list = String(columns || '')
    .split(',')
    .map(c => c.trim())
    .filter(c => c && c !== 'timestamp');
  if (list.length === 0) {
    throw new Error('Missing history columns');
  }
  for (const col of list) {
    if (!VALID_HISTORY_COLUMN_SET.has(col) || col === 'id') {
      throw new Error(`Invalid history column: ${col}`);
    }
  }
  return list;
}

function safeParseJsonRow(rawJson) {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}
const LATENCY_NODE_FIELDS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'];
const DASHBOARD_LATENCY_COLUMNS = LATENCY_NODE_FIELDS
  .flatMap(field => [`ping_${field}`, `loss_${field}`]);
const dashboardLatencyHistoryCache = new Map();

function pruneDashboardLatencyHistoryCache(now = Date.now()) {
  for (const [serverId, entry] of dashboardLatencyHistoryCache) {
    if (!entry || now - entry.cachedAt > DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) {
      dashboardLatencyHistoryCache.delete(serverId);
    }
  }

  while (dashboardLatencyHistoryCache.size > DASHBOARD_LATENCY_WINDOW_CACHE_MAX_SERVERS) {
    const oldestServerId = dashboardLatencyHistoryCache.keys().next().value;
    if (oldestServerId === undefined) break;
    dashboardLatencyHistoryCache.delete(oldestServerId);
  }
}

export function clearDashboardLatencyHistoryCache() {
  dashboardLatencyHistoryCache.clear();
}

export async function initDatabase(db) {
  if (isDbInitialized(db)) return;

  debug('初始化数据库');
  
  try {
    const SettingTableExists = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='settings'
    `).first();
    if (!SettingTableExists) {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY, 
          value TEXT
        )
      `).run();
      await saveSiteOptions(db, { servers_optimized: 'true' });
    }

    // 判断servers表是否存在
    const ServerTableExists = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='servers'
    `).first();
    if (!ServerTableExists) {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT,
          server_group TEXT DEFAULT 'Default',
          region TEXT DEFAULT '',
          tags TEXT DEFAULT '',
          note TEXT DEFAULT '',
          price TEXT DEFAULT '',
          billing_cycle TEXT DEFAULT 'month',
          auto_renewal TEXT DEFAULT '0',
          currency TEXT DEFAULT '¥',
          expire_date TEXT DEFAULT '',
          traffic_limit TEXT DEFAULT '',
          traffic_calc_type TEXT DEFAULT 'total',
          traffic_alert_percent INTEGER DEFAULT NULL,
          traffic_alert_state TEXT,
          "interface" TEXT DEFAULT '',
          reset_day INTEGER DEFAULT 1,
          collect_interval INTEGER DEFAULT 0,
          report_interval INTEGER DEFAULT 60,
          wss_report_interval INTEGER DEFAULT 2,
          connection_mode TEXT DEFAULT 'auto',
          ping_mode TEXT DEFAULT 'tcp',
          auto_update TEXT DEFAULT '0',
          custom_ct TEXT DEFAULT '',
          custom_cu TEXT DEFAULT '',
          custom_cm TEXT DEFAULT '',
          custom_bd TEXT DEFAULT '',
          node_1 TEXT DEFAULT '',
          node_2 TEXT DEFAULT '',
          node_3 TEXT DEFAULT '',
          node_4 TEXT DEFAULT '',
          rx_correction REAL DEFAULT NULL,
          tx_correction REAL DEFAULT NULL,
          offline_notify_disabled TEXT DEFAULT '0',
          is_hidden TEXT DEFAULT '0',
          sort_order INTEGER DEFAULT 0,
          history_partition_id INTEGER DEFAULT 0,
          timestamp INTEGER DEFAULT 0
        )
      `).run();
      await db.prepare(SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL).run();
    } else {
      debug('检查servers表优化状态');
      await ensureServerOptimization(db);
      try {
        await db.prepare(SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL).run();
      } catch (idxErr) {
        debug('创建 history_partition_id 唯一索引失败:', idxErr?.message || idxErr);
      }
    }

    // 确保 metrics_history 表存在（主键 id 已编码分区与时间，无需二级索引）
    await db.prepare(createHistoryTableSql('metrics_history')).run();

    debug('✅ 数据库初始化完成');
    setDbInitialized(db, true);
  } catch (e) {
    console.error('❌ 数据库初始化失败:', e);
  }
}

export async function clearHistory(db) {
  debug('开始清空历史数据...');
  
  try {
    const rebuildStatements = [
      db.prepare(`DROP TABLE IF EXISTS metrics_history`),
      db.prepare(`DROP TABLE IF EXISTS metrics_history_old`),
      db.prepare(createHistoryTableSql('metrics_history'))
    ];
    if (typeof db.batch === 'function') {
      await db.batch(rebuildStatements);
    } else {
      for (const stmt of rebuildStatements) {
        await stmt.run();
      }
    }
    debug('✅ 已原子重建 metrics_history 表并清理 metrics_history_old 表');
    
    setDbInitialized(db, false);
    
    await initDatabase(db);

    await clearAllCaches(db);
    clearDashboardLatencyHistoryCache();
    
    debug('✅ 数据库重建完成');
    
    return {
      success: true,
      message: 'databaseRebuiltSuccess'
    };
  } catch (e) {
    console.error('❌ 数据库清理失败:', e);
    return {
      success: false,
      message: 'databaseRebuiltFailed',
      error: e.message
    };
  }
}

function buildHistorySourceQuery(tableName, columns) {
  return `
    SELECT timestamp, ${columns} FROM ${tableName}
    WHERE id >= ?
      AND id <= ?
      AND server_id = ?
  `;
}

export async function getMetricsHistory(
  db,
  serverId,
  hours,
  columns,
  server = null,
  longHistoryPoints = DEFAULT_LONG_HISTORY_POINTS
) {
  const now = Date.now();
  const cacheDuration = getCacheDuration(hours);
  const queryHours = Math.min(hours, 168);
  const configuredLongHistoryPoints = queryHours > 1
    ? Number(normalizeLongHistoryPoints(longHistoryPoints))
    : null;
  
  const cached = getMetricsHistoryCache(serverId, hours, columns, configuredLongHistoryPoints);
  if (cached && now - cached.timestamp < cacheDuration) {
    debug(`[History] CACHE HIT: ${serverId}, hours: ${hours}`);
    return cached.data;
  }
  
  const totalMs = queryHours * 60 * 60 * 1000;

  const cutoff = now - queryHours * 60 * 60 * 1000;
  const historyInfo = await getServerHistoryInfo(db, serverId, server);
  const queryStart = Math.max(cutoff, historyInfo.startTimestamp);

  // 判断是否需要查询 metrics_history_old 表
  // 如果实际查询起点早于本周日 00:00 UTC（表轮换时间），说明需要查旧表
  const nowDate = new Date(now);
  const day = nowDate.getUTCDay();
  const thisSunday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() - day));
  const needOldTable = queryStart < thisSunday.getTime();
  
  const oldTableExists = needOldTable && !!await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
  ).first();

  if (!historyInfo.partitionId) {
    throw new Error('Invalid history partition id');
  }
  const idRange = getHistoryIdRange(historyInfo.partitionId, queryStart);

  const columnList = parseValidatedHistoryColumns(columns);
  const sourceColumns = columnList.join(', ');
  const lossColumns = columnList.filter(col => LOSS_AGG_COLUMNS.has(col));
  const lossWindowExpressions = lossColumns.map(col =>
    `MAX(${col}) OVER (PARTITION BY bucket) AS ${col}_bucket_max`
  );
  const selectColumns = columnList.map(col =>
    LOSS_AGG_COLUMNS.has(col) ? `${col}_bucket_max AS ${col}` : col
  );

  const useSparseSampling = shouldUseSparseHistorySampling(queryHours);
  const sparseQueryEnd = Math.floor(now / 1000) * 1000 + 1000;
  const maxPoints = queryHours > 1
    ? configuredLongHistoryPoints
    : DEFAULT_HISTORY_MAX_POINTS;
  const samplingDurationMs = useSparseSampling
    ? Math.max(0, sparseQueryEnd - queryStart)
    : totalMs;
  const intervalMs = Math.max(10_000, Math.ceil(samplingDurationMs / maxPoints));

  debug(
    '[History]',
    'server:', serverId,
    'hours:', hours,
    'queryHours:', queryHours,
    'maxPoints:', maxPoints,
    'interval:', intervalMs,
    'cutoff:', new Date(cutoff).toISOString(),
    'start:', new Date(queryStart).toISOString()
  );

  let rawResult;

  if (useSparseSampling) {
    // Long-range queries sample one complete row per time bucket via primary-key seeks.
    // Computing an exact maximum for loss columns would require scanning every row in the bucket.
    const queryEnd = sparseQueryEnd;
    const firstRangeEnd = Math.min(
      queryEnd,
      queryStart + intervalMs
    );
    const idPrefix = getHistoryIdRange(historyInfo.partitionId).startId;
    const sparseQuery = buildSparseHistoryQuery({
      columns: sourceColumns,
      queryStart,
      queryEnd,
      firstRangeEnd,
      intervalMs,
      idPrefix,
      oldTableExists,
      tableBoundary: thisSunday.getTime()
    });

    debug('[History] SPARSE ID SAMPLING:', sparseQuery.bindValues.length, 'bind values');
    const sparseResult = await db.prepare(sparseQuery.sql).bind(...sparseQuery.bindValues).all();
    rawResult = {
      ...sparseResult,
      results: (sparseResult.results || [])
        .map(row => safeParseJsonRow(row?.sample_json))
        .filter(Boolean)
    };
  } else {
    const sourceQueries = [];
    const bindValues = [];

    sourceQueries.push(buildHistorySourceQuery('metrics_history', sourceColumns));
    bindValues.push(idRange.startId, idRange.endId, String(serverId));

    if (oldTableExists) {
      debug('[History] 跨周查询，合并 metrics_history 和 metrics_history_old');
      sourceQueries.push(buildHistorySourceQuery('metrics_history_old', sourceColumns));
      bindValues.push(idRange.startId, idRange.endId, String(serverId));
    }

    bindValues.push(intervalMs);

    rawResult = await db.prepare(`
      WITH history_rows AS (
        ${sourceQueries.join('\n        UNION ALL\n')}
      ),
      bucketed AS (
        SELECT
          timestamp,
          ${sourceColumns},
          CAST(timestamp / ? AS INTEGER) AS bucket
        FROM history_rows
      ),
      sampled AS (
        SELECT
          timestamp,
          ${sourceColumns},
          ROW_NUMBER() OVER (
            PARTITION BY bucket
            ORDER BY timestamp
          ) AS rn
          ${lossWindowExpressions.length ? `,\n          ${lossWindowExpressions.join(',\n          ')}` : ''}
        FROM bucketed
      )
      SELECT timestamp, ${selectColumns.join(', ')}
      FROM sampled
      WHERE rn = 1
    `).bind(...bindValues).all();
  }

  const result = rawResult.results.map(row => attachDiskMetricsObject(normalizeProbeMetricRow({
    ...row,
    timestamp: Number(row.timestamp)
  })));

  result.sort((a, b) => a.timestamp - b.timestamp);

  setMetricsHistoryCache(serverId, hours, columns, result, configuredLongHistoryPoints);

  debug(`[History] FINAL: ${result.length}, interval: ${intervalMs}ms`);

  return result;
}

function normalizeLatencyHistoryValue(value, metricType) {
  if (isDisabledProbeMetric(value)) return false;
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || typeof value === 'object') {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  if (metricType === 'loss') {
    return Math.max(0, Math.min(100, Math.round(number)));
  }
  return number > 0 ? Math.min(MAX_PING_LATENCY_MS, Math.max(1, Math.round(number))) : null;
}

function buildLatencyHistoryPoint(row, metricType, { includeEmpty = false } = {}) {
  const timestamp = Number(row?.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const point = { ts: timestamp };
  for (const field of LATENCY_NODE_FIELDS) {
    const column = `${metricType}_${field}`;
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    const value = normalizeLatencyHistoryValue(row[column], metricType);
    if (value !== null) point[field] = value;
    else if (includeEmpty) point[field] = null;
  }

  return includeEmpty || Object.keys(point).length > 1 ? point : null;
}

function normalizeDashboardLatencyRows(rows, options = {}) {
  const ping = [];
  const loss = [];

  for (const row of rows || []) {
    const pingPoint = buildLatencyHistoryPoint(row, 'ping', options);
    if (pingPoint) ping.push(pingPoint);

    const lossPoint = buildLatencyHistoryPoint(row, 'loss', options);
    if (lossPoint) loss.push(lossPoint);
  }

  ping.sort((a, b) => a.ts - b.ts);
  loss.sort((a, b) => a.ts - b.ts);
  return { ping, loss };
}

function parseDashboardLatencySample(row) {
  if (!row?.sample_json) return null;
  try {
    return JSON.parse(row.sample_json);
  } catch (_) {
    return null;
  }
}

function normalizeDashboardLatencyWindow(sampleRows, { windowStart, intervalMs, points, firstActiveBucket = 0 }) {
  const rows = Array.from({ length: points }, (_, index) => {
    const bucketTimestamp = windowStart + index * intervalMs;
    if (index < firstActiveBucket) {
      return { timestamp: bucketTimestamp };
    }
    const sample = parseDashboardLatencySample(sampleRows?.[index - firstActiveBucket]);
    if (!sample || typeof sample !== 'object') {
      return { timestamp: bucketTimestamp };
    }

    return {
      ...sample,
      sample_timestamp: Number(sample.timestamp),
      timestamp: bucketTimestamp
    };
  });

  return normalizeDashboardLatencyRows(rows, { includeEmpty: true });
}

export async function getDashboardLatencyHistory(db, servers, options = {}) {
  const serverList = Array.isArray(servers) ? servers : [];
  const serverIds = serverList.map(server => String(server?.id || '').trim()).filter(Boolean);
  if (serverIds.length === 0) return new Map();

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const useCache = options.cache !== false;
  const result = new Map();
  const serversToFetch = [];

  if (useCache) {
    pruneDashboardLatencyHistoryCache(now);
  }

  for (const server of serverList) {
    const serverId = String(server?.id || '').trim();
    if (!serverId) continue;

    const cached = dashboardLatencyHistoryCache.get(serverId);
    if (useCache && cached && now - cached.cachedAt < DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) {
      result.set(serverId, cached.window);
      continue;
    }
    serversToFetch.push(server);
  }

  if (serversToFetch.length === 0) return result;

  const points = Number.isInteger(options.points) && options.points > 0
    ? options.points
    : DASHBOARD_LATENCY_WINDOW_POINTS;
  const queryEnd = Math.floor(now / 1000) * 1000 + 1000;
  const cutoff = now - DASHBOARD_LATENCY_WINDOW_HOURS * 60 * 60 * 1000;
  const columns = DASHBOARD_LATENCY_COLUMNS.join(', ');

  const nowDate = new Date(now);
  const day = nowDate.getUTCDay();
  const thisSunday = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() - day));
  const oldTableExists = cutoff < thisSunday.getTime() && !!await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history_old'`
  ).first();

  const fetchServerLatency = async server => {
    const serverId = String(server?.id || '').trim();
    if (!serverId) return;

    try {
      const historyInfo = await getServerHistoryInfo(db, serverId, server);
      if (!historyInfo.partitionId) {
        result.set(serverId, { ping: [], loss: [] });
        return;
      }

      const windowStart = cutoff;
      const queryStart = Math.max(cutoff, historyInfo.startTimestamp || 0);
      if (queryStart >= queryEnd) {
        result.set(serverId, { ping: [], loss: [] });
        return;
      }

      const intervalMs = Math.max(10_000, Math.ceil((queryEnd - windowStart) / points));
      const firstActiveBucket = Math.min(
        points - 1,
        Math.max(0, Math.floor((queryStart - windowStart) / intervalMs))
      );
      const effectiveQueryStart = Math.max(queryStart, windowStart + firstActiveBucket * intervalMs);
      const firstRangeEnd = Math.min(queryEnd, windowStart + (firstActiveBucket + 1) * intervalMs);
      const idPrefix = getHistoryIdRange(historyInfo.partitionId).startId;
      const querySparseHistory = async queryColumns => {
        const sparseQuery = buildSparseHistoryQuery({
          columns: queryColumns,
          queryStart: effectiveQueryStart,
          queryEnd,
          firstRangeEnd,
          intervalMs,
          idPrefix,
          oldTableExists,
          tableBoundary: thisSunday.getTime(),
          sampleOrder: 'DESC'
        });
        return db.prepare(sparseQuery.sql).bind(...sparseQuery.bindValues).all();
      };

      const rawResult = await querySparseHistory(columns);
      const window = normalizeDashboardLatencyWindow(rawResult.results, {
        windowStart,
        intervalMs,
        points,
        firstActiveBucket
      });
      result.set(serverId, window);
      if (useCache) {
        dashboardLatencyHistoryCache.set(serverId, { cachedAt: now, window });
      }
    } catch (e) {
      debug('[DashboardLatency] query failed:', serverId, e?.message || e);
      const empty = { ping: [], loss: [] };
      result.set(serverId, empty);
      if (useCache) {
        dashboardLatencyHistoryCache.set(serverId, { cachedAt: now, window: empty });
      }
    }
  };

  for (let offset = 0; offset < serversToFetch.length; offset += DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY) {
    await Promise.all(
      serversToFetch
        .slice(offset, offset + DASHBOARD_LATENCY_WINDOW_QUERY_CONCURRENCY)
        .map(fetchServerLatency)
    );
  }

  return result;
}


export async function weeklyCleanup(db) {
  try {
    debug('[Cleanup] 开始执行表轮换操作...');
    
    const currentTable = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_history'`
    ).first();

    const rotationStatements = [
      db.prepare(`DROP TABLE IF EXISTS metrics_history_old`),
      ...(currentTable ? [db.prepare(`ALTER TABLE metrics_history RENAME TO metrics_history_old`)] : []),
      db.prepare(createHistoryTableSql('metrics_history'))
    ];

    if (typeof db.batch === 'function') {
      await db.batch(rotationStatements);
    } else {
      for (const stmt of rotationStatements) {
        await stmt.run();
      }
    }
    debug('[Cleanup] 已原子完成 metrics_history 表轮换与重建');
  
    setDbInitialized(db, false);
    await initDatabase(db);
    clearDashboardLatencyHistoryCache();
    
    return {
      success: true,
      message: '表轮换成功'
    };
  } catch (e) {
    console.error('[Cleanup] 表轮换失败:', e);
    return { success: false, error: e.message };
  }
}

export async function saveMetricsHistory(db, serverId, historyPartitionId, metrics, regionCode = '', timestamp = null, agentVersion = '') {
  const safeMetrics = metrics && typeof metrics === 'object' && !Array.isArray(metrics) ? metrics : {};
  const DISABLED_PROBE_VALUE = 'false';

  const parsePing = (val) => {
    if (isDisabledProbeMetric(val)) return DISABLED_PROBE_VALUE;
    if (val === null || val === undefined || val === '' || typeof val === 'boolean' || typeof val === 'object') {
      return null;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.min(MAX_PING_LATENCY_MS, Math.max(1, Math.round(num)));
  };

  const parseLoss = (val) => {
    if (isDisabledProbeMetric(val)) return DISABLED_PROBE_VALUE;
    if (val === null || val === undefined || val === '' || typeof val === 'boolean' || typeof val === 'object') {
      return null;
    }
    const num = Number(val);
    if (!Number.isFinite(num)) return null;
    return Math.max(0, Math.min(100, Math.round(num)));
  };

  try {
    const now = clampMetricTimestamp(timestamp, Date.now());
    const historyId = buildHistoryId(historyPartitionId, now);

    const insertHistoryRow = async () => {
      const diskMetrics = flattenDiskMetrics(safeMetrics);

      // 同一服务器同一秒的上报（如客户端超时重试撞车）会命中 id 唯一约束，
      // 普通 INSERT 会静默丢样本：改为 upsert，同秒重复上报时以最新数据覆盖。
      const upsertColumns = HISTORY_INSERT_COLUMNS.filter(column => column !== 'id');
      await db.prepare(`
      INSERT INTO metrics_history (
        ${HISTORY_INSERT_COLUMNS.join(', ')}
      ) VALUES (
        ${HISTORY_INSERT_COLUMNS.map(() => '?').join(', ')}
      )
      ON CONFLICT(id) DO UPDATE SET
        ${upsertColumns.map(column => `${column} = excluded.${column}`).join(', ')}
    `).bind(
      historyId,
      toSafeMetricString(serverId, 64, ''),
      now,
      toSafeMetricString(agentVersion, 64, ''),
      toSafeMetricFloat(safeMetrics.cpu, { min: 0, max: 100, fallback: 0 }),
      toSafeMetricString(safeMetrics.load ?? safeMetrics.load_avg, 64, '0 0 0'),
      toSafeMetricFloat(safeMetrics.net_in_speed),
      toSafeMetricFloat(safeMetrics.net_out_speed),
      toSafeMetricFloat(safeMetrics.net_rx),
      toSafeMetricFloat(safeMetrics.net_tx),
      toSafeMetricInt(safeMetrics.processes),
      toSafeMetricInt(safeMetrics.tcp_conn),
      toSafeMetricInt(safeMetrics.udp_conn),
      parsePing(safeMetrics.ping_ct),
      parsePing(safeMetrics.ping_cu),
      parsePing(safeMetrics.ping_cm),
      parsePing(safeMetrics.ping_bd),
      parsePing(safeMetrics.ping_node_1),
      parsePing(safeMetrics.ping_node_2),
      parsePing(safeMetrics.ping_node_3),
      parsePing(safeMetrics.ping_node_4),
      parseLoss(safeMetrics.loss_ct),
      parseLoss(safeMetrics.loss_cu),
      parseLoss(safeMetrics.loss_cm),
      parseLoss(safeMetrics.loss_bd),
      parseLoss(safeMetrics.loss_node_1),
      parseLoss(safeMetrics.loss_node_2),
      parseLoss(safeMetrics.loss_node_3),
      parseLoss(safeMetrics.loss_node_4),
      toSafeMetricFloat(safeMetrics.ram_total),
      toSafeMetricFloat(safeMetrics.ram_used),
      toSafeMetricFloat(safeMetrics.swap_total),
      toSafeMetricFloat(safeMetrics.swap_used),
      toSafeMetricFloat(safeMetrics.disk_total),
      toSafeMetricFloat(safeMetrics.disk_used),
      diskMetrics.disk_read_bps,
      diskMetrics.disk_write_bps,
      diskMetrics.disk_read_iops,
      diskMetrics.disk_write_iops,
      diskMetrics.disk_await_ms,
      diskMetrics.disk_util,
      toSafeMetricInt(safeMetrics.cpu_cores, { min: 0, max: 65535, fallback: 0 }),
      toSafeMetricString(safeMetrics.cpu_info, 256, ''),
      sanitizeGpuInfo(safeMetrics.gpu_info, 4096),
      toSafeMetricString(safeMetrics.arch, 64, ''),
      toSafeMetricString(safeMetrics.os, 128, ''),
      toSafeMetricString(safeMetrics.kernel_version, 128, ''),
      toSafeMetricString(regionCode, 32, ''),
      toSafeMetricString(safeMetrics.ip_v4, 64, '0'),
      toSafeMetricString(safeMetrics.ip_v6, 128, '0'),
      toSafeMetricString(safeMetrics.boot_time, 64, ''),
      toSafeMetricFloat(safeMetrics.net_rx_monthly),
      toSafeMetricFloat(safeMetrics.net_tx_monthly)
      ).run();
    };

    try {
      await insertHistoryRow();
      return { ok: true };
    } catch (e) {
      if (e?.message && /has no column/i.test(e.message)) {
        console.warn('检测到数据库字段缺失，尝试添加缺失字段...');
        await addHistoryColumns(db);
        try {
          await insertHistoryRow();
          return { ok: true };
        } catch (retryError) {
          console.error('保存历史数据失败:', retryError);
          return { ok: false, error: retryError?.message || String(retryError) };
        }
      }
      console.error('保存历史数据失败:', e);
      return { ok: false, error: e?.message || String(e) };
    }
  } catch (outerError) {
    console.error('保存历史数据失败:', outerError);
    return { ok: false, error: outerError?.message || String(outerError) };
  }
}

export async function getLatestMetrics(db, serverId, server = null) {
  try {
    const historyInfo = await getServerHistoryInfo(db, serverId, server);
    if (!historyInfo.partitionId) {
      throw new Error('Invalid history partition id');
    }

    const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
    const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
    debug(`Server ${serverId} history_id_range: ${startId} - ${endId}`);
  
    const result = await db.prepare(`
      SELECT * FROM metrics_history
      WHERE id >= ?
        AND id <= ?
        AND server_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(startId, endId, String(serverId)).first();
    return result ? normalizeProbeMetricRow(result) : null;
  } catch (e) {
    console.error('获取最新指标数据失败:', e);
    return null;
  }
}

// 每批合并的服务器数量：通过 db.batch() 一次发送多条语句，减少 D1 往返次数
const LATEST_QUERY_CHUNK_SIZE = 30;

/**
 * 获取所有服务器的最新完整指标行（供仪表盘/管理端合并展示）。
 * 命中"完整指标"缓存时直接返回；未命中时每台服务器在主键 rowid 范围内取最新一行，
 * 每批最多 LATEST_QUERY_CHUNK_SIZE 台，通过 db.batch() 合并成一次 D1 往返，
 * 避免逐台 N 次查询与 N 次往返。单台 history 范围异常只跳过该台，与 getLatestMetrics 行为一致。
 */
export async function getLatestMetricsForAllServers(db) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return cacheInfo.cache;
  }

  const result = new Map();
  try {
    const servers = await getAllServers(db);
    if (servers.length === 0) {
      setLatestMetricsCache(result);
      return result;
    }

    // 先逐台计算 history rowid 范围：单台异常只跳过该台（与 getLatestMetrics 逐台失败一致）
    const items = [];
    for (const server of servers) {
      try {
        // 传入 server 对象时 getServerHistoryInfo 不会触发额外查询
        const historyInfo = await getServerHistoryInfo(db, server.id, server);
        if (!historyInfo.partitionId) continue;
        const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
        const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
        items.push({ server, startId, endId });
      } catch (err) {
        debug(`Server ${server.id} history 范围计算失败，跳过: ${err.message}`);
      }
    }

    for (let offset = 0; offset < items.length; offset += LATEST_QUERY_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + LATEST_QUERY_CHUNK_SIZE);
      let batchResults;
      try {
        batchResults = await db.batch(chunk.map(item =>
          db.prepare(
            'SELECT * FROM metrics_history WHERE id >= ? AND id <= ? AND server_id = ? ORDER BY id DESC LIMIT 1'
          ).bind(item.startId, item.endId, String(item.server.id))
        ));
      } catch (batchError) {
        // 整批失败时回退逐台查询，保持"单台异常不影响其它台"的既有语义
        debug(`批量获取最新指标失败，回退逐台查询: ${batchError.message}`);
        for (const item of chunk) {
          const metrics = await getLatestMetrics(db, item.server.id, item.server);
          if (metrics) result.set(item.server.id, metrics);
        }
        continue;
      }
      for (let index = 0; index < chunk.length; index++) {
        const rows = batchResults[index] && batchResults[index].results;
        if (rows && rows.length > 0) {
          result.set(chunk[index].server.id, normalizeProbeMetricRow(rows[0]));
        }
      }
    }

    setLatestMetricsCache(result);
    return result;
  } catch (e) {
    console.error('获取所有服务器最新指标数据失败:', e);
    const fallback = getLatestMetricsCache();
    return fallback.cache || new Map();
  }
}

// 从"完整指标"缓存中抽取每台服务器的最新上报时间戳（完整行是轻量结果的超集）
function extractTimestampsFromMetricsCache(cache, servers = null) {
  const map = new Map();
  if (!cache) return map;
  if (servers) {
    for (const server of servers) {
      const metrics = cache.get(server.id);
      if (metrics) map.set(server.id, metrics.timestamp);
    }
    return map;
  }
  for (const [id, metrics] of cache) {
    if (metrics) map.set(id, metrics.timestamp);
  }
  return map;
}

/**
 * 获取所有服务器的最新上报时间戳（只查 timestamp 一列）。
 * 供离线检测等只需时间戳的场景使用，避免拉取整行 52 列带来的序列化 CPU 开销。
 * 命中"完整指标"缓存时直接复用；未命中才轻量查询，且不写回共享缓存，避免用残缺行污染它。
 * 每台服务器用 rowid 范围在主键索引上定位最新一行，每批最多 LATEST_QUERY_CHUNK_SIZE 台，
 * 通过 db.batch() 合并成一次 D1 往返（注意：D1 的 compound SELECT 项数上限极低，不能用 UNION ALL）。
 * 可传入已筛选的 servers，复用调用方列表并只读取这些节点（包括缓存回退）。
 *
 * @returns {Promise<Map|null>} 成功返回 Map<serverId, timestamp>（可能为空 Map）；
 *   查询失败且无可回退缓存时返回 null，调用方应跳过本次检测，避免误判为全部离线。
 */
export async function getLatestTimestampsForAllServers(db, { servers = null } = {}) {
  const now = Date.now();
  const cacheInfo = getLatestMetricsCache();
  if (cacheInfo.cache && now - cacheInfo.time < cacheInfo.ttl) {
    return extractTimestampsFromMetricsCache(cacheInfo.cache, servers);
  }

  const collected = new Map();
  try {
    const targetServers = servers ?? await getAllServers(db);
    if (targetServers.length === 0) return collected;

    const items = [];
    for (const server of targetServers) {
      try {
        // 传入 server 对象时 getServerHistoryInfo 不会触发额外查询
        const historyInfo = await getServerHistoryInfo(db, server.id, server);
        if (!historyInfo.partitionId) continue; // 无效分区，跳过（与 getLatestMetrics 行为一致）
        const rangeStart = historyInfo.startTimestamp > 0 ? historyInfo.startTimestamp : null;
        const { startId, endId } = getHistoryIdRange(historyInfo.partitionId, rangeStart);
        items.push({ serverId: server.id, startId, endId });
      } catch (err) {
        // 单台服务器 history 范围异常不影响其它服务器（与 getLatestMetrics 逐台失败一致）
        debug(`Server ${server.id} history 范围计算失败，跳过: ${err.message}`);
      }
    }

    for (let offset = 0; offset < items.length; offset += LATEST_QUERY_CHUNK_SIZE) {
      const chunk = items.slice(offset, offset + LATEST_QUERY_CHUNK_SIZE);
      const batchResults = await db.batch(chunk.map(item =>
        db.prepare(
          'SELECT timestamp FROM metrics_history WHERE id >= ? AND id <= ? AND server_id = ? ORDER BY id DESC LIMIT 1'
        ).bind(item.startId, item.endId, String(item.serverId))
      ));
      for (let index = 0; index < chunk.length; index++) {
        const rows = batchResults[index] && batchResults[index].results;
        if (rows && rows.length > 0) {
          collected.set(chunk[index].serverId, rows[0].timestamp);
        }
      }
    }
    return collected;
  } catch (e) {
    console.error('获取所有服务器最新时间戳失败:', e);
    // 查询失败时回退到（可能已过期的）完整缓存；无缓存则返回 null 让调用方跳过本次检测，
    // 避免把查询失败误判为全部服务器离线而误发告警
    return cacheInfo.cache ? extractTimestampsFromMetricsCache(cacheInfo.cache, servers) : null;
  }
}
