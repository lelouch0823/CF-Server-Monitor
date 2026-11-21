import {
  NUMERIC_METRIC_FIELDS,
  PROBE_METRIC_FIELDS
} from './historyFields.js';

export const DISK_IO_METRIC_FIELDS = [
  'read_bps',
  'write_bps',
  'read_iops',
  'write_iops',
  'await_ms',
  'util'
];

export const DISK_IO_FIELD_TO_COLUMN = {
  read_bps: 'disk_read_bps',
  write_bps: 'disk_write_bps',
  read_iops: 'disk_read_iops',
  write_iops: 'disk_write_iops',
  await_ms: 'disk_await_ms',
  util: 'disk_util'
};

const MAX_PING_LATENCY_MS = 600000;
const GPU_INFO_MAX_LENGTH = 4096;
const GPU_ARRAY_MAX_ITEMS = 32;
const INTEGER_METRIC_FIELD_SET = new Set(['processes', 'tcp_conn', 'udp_conn', 'cpu_cores']);

function isNonScalarMetricValue(value) {
  const type = typeof value;
  return value === null || value === undefined || type === 'object' || type === 'boolean' || type === 'function' || type === 'symbol';
}

export function toSafeMetricFloat(val, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  if (isNonScalarMetricValue(val) || val === '') return fallback;
  const number = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function toSafeMetricInt(val, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  if (isNonScalarMetricValue(val) || val === '') return fallback;
  const number = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function toSafeMetricString(val, maxLen = 256, fallback = '') {
  if (val === null || val === undefined) return fallback;
  const type = typeof val;
  if (type === 'object' || type === 'function' || type === 'symbol') return fallback;
  const str = String(val);
  if (!str) return fallback;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeGpuElement(item) {
  if (item === null || item === undefined) return null;
  if (typeof item === 'string' || typeof item === 'number') {
    const str = String(item).trim();
    return str ? str.slice(0, 256) : null;
  }
  if (typeof item === 'object' && !Array.isArray(item)) {
    const cleaned = {};
    for (const [key, val] of Object.entries(item).slice(0, 12)) {
      const safeKey = String(key).slice(0, 32);
      if (typeof val === 'number') {
        if (Number.isFinite(val)) cleaned[safeKey] = val;
      } else if (typeof val === 'string') {
        cleaned[safeKey] = val.slice(0, 128);
      } else if (typeof val === 'boolean') {
        cleaned[safeKey] = val;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  }
  return null;
}

export function sanitizeGpuInfo(val, maxLen = GPU_INFO_MAX_LENGTH) {
  if (val === null || val === undefined || val === '') return '';
  if (Array.isArray(val)) {
    const sanitizedItems = val
      .slice(0, GPU_ARRAY_MAX_ITEMS)
      .map(sanitizeGpuElement)
      .filter(item => item !== null);
    let serialized = JSON.stringify(sanitizedItems);
    if (serialized.length <= maxLen) return serialized;

    const trimmed = [...sanitizedItems];
    while (trimmed.length > 0) {
      trimmed.pop();
      serialized = JSON.stringify(trimmed);
      if (serialized.length <= maxLen) return serialized;
    }
    return '[]';
  }
  if (typeof val === 'string') {
    if (val.length <= maxLen) return val;
    const trimmedStr = val.trim();
    if (trimmedStr.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmedStr);
        if (Array.isArray(parsed)) {
          return sanitizeGpuInfo(parsed, maxLen);
        }
      } catch (_) {
        return '[]';
      }
    }
    return val.slice(0, maxLen);
  }
  return '';
}

function toFiniteMetricNumber(value, fallback = 0) {
  if (isNonScalarMetricValue(value) || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwnMetric(source, field) {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function isPlainMetricObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function hasDiskMetricsPayload(metrics) {
  const source = isPlainMetricObject(metrics) ? metrics : {};

  if (hasOwnMetric(source, 'disk')) {
    const disk = isPlainMetricObject(source.disk) ? source.disk : {};
    return DISK_IO_METRIC_FIELDS.some(field => {
      const value = hasOwnMetric(disk, field)
        ? toFiniteMetricNumber(disk[field], null)
        : null;
      return value !== null && value !== 0;
    });
  }

  return DISK_IO_METRIC_FIELDS.some(field => {
    const column = DISK_IO_FIELD_TO_COLUMN[field];
    const value = hasOwnMetric(source, column)
      ? toFiniteMetricNumber(source[column], null)
      : null;
    return value !== null && value !== 0;
  });
}

export function normalizeDiskMetrics(metrics) {
  const source = isPlainMetricObject(metrics) ? metrics : {};
  const hasDiskObject = hasOwnMetric(source, 'disk');
  const disk = isPlainMetricObject(source.disk)
    ? source.disk
    : {};

  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => {
    const column = DISK_IO_FIELD_TO_COLUMN[field];
    const value = hasDiskObject
      ? disk[field]
      : source[column];
    return [field, toSafeMetricFloat(value, { min: 0, fallback: 0 })];
  }));
}

function createEmptyDiskMetricColumns(value = null) {
  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => [
    DISK_IO_FIELD_TO_COLUMN[field],
    value
  ]));
}

export function flattenDiskMetrics(metrics) {
  if (!hasDiskMetricsPayload(metrics)) {
    return createEmptyDiskMetricColumns(null);
  }

  const disk = normalizeDiskMetrics(metrics);
  return Object.fromEntries(DISK_IO_METRIC_FIELDS.map(field => [
    DISK_IO_FIELD_TO_COLUMN[field],
    disk[field]
  ]));
}

export function attachDiskMetricsObject(metrics) {
  if (!metrics || typeof metrics !== 'object') return metrics;
  const result = { ...metrics };
  delete result.disk;
  if (!hasDiskMetricsPayload(metrics)) {
    return result;
  }
  return {
    ...result,
    disk: normalizeDiskMetrics(metrics)
  };
}

export function isDisabledProbeMetric(value) {
  return value === false || value === 'false';
}

// 将探针上报的指标字段统一转换为数字类型，与 /api/servers 的 servers[] 字段类型保持一致。
// 数据库 D1 对 REAL/INTEGER 列返回 JS number，而探针 POST 的原始字段可能是字符串，
// latestReportUpdates 和 WebSocket 推送直接透传探针数据，需要在此统一类型。
export function coerceNumericMetricFields(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const result = { ...payload };

  for (const field of NUMERIC_METRIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const value = result[field];
    if (value === null || value === undefined) continue;
    if (field === 'cpu') {
      result[field] = toSafeMetricFloat(value, { min: 0, max: 100, fallback: 0 });
    } else if (INTEGER_METRIC_FIELD_SET.has(field)) {
      result[field] = toSafeMetricInt(value, { min: 0, fallback: 0 });
    } else {
      result[field] = toSafeMetricFloat(value, { min: 0, fallback: 0 });
    }
  }

  for (const field of PROBE_METRIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const value = result[field];
    if (value === false || value === 'false') {
      result[field] = false;
    } else if (value === null || value === undefined) {
      continue;
    } else if (isNonScalarMetricValue(value) || value === '') {
      result[field] = null;
    } else {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        result[field] = null;
      } else if (field.startsWith('loss_')) {
        result[field] = Math.max(0, Math.min(100, Math.round(num)));
      } else {
        result[field] = num > 0 ? Math.min(MAX_PING_LATENCY_MS, Math.max(1, Math.round(num))) : null;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, 'disk')) {
    if (!hasDiskMetricsPayload(result)) {
      delete result.disk;
      return result;
    }
    result.disk = normalizeDiskMetrics(result);
  }

  return result;
}

function normalizeProbeMetric(value, field = '') {
  if (isDisabledProbeMetric(value)) return false;
  if (value === null || value === undefined || value === '' || isNonScalarMetricValue(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (field.startsWith('loss_')) {
    return Math.max(0, Math.min(100, Math.round(num)));
  }
  if (field.startsWith('ping_')) {
    return num > 0 ? Math.min(MAX_PING_LATENCY_MS, Math.max(1, Math.round(num))) : null;
  }
  return num;
}

export function normalizeProbeMetricRow(metrics) {
  if (!metrics) return metrics;

  const normalized = { ...metrics };
  for (const field of PROBE_METRIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeProbeMetric(normalized[field], field);
    }
  }
  return normalized;
}

export function mergeMetricsIntoServer(server, metrics) {
  if (!metrics) return;

  server.cpu = toSafeMetricFloat(metrics.cpu, { min: 0, max: 100, fallback: 0 });
  server.load_avg = toSafeMetricString(metrics.load ?? metrics.load_avg, 64, '0 0 0');
  server.net_in_speed = toSafeMetricFloat(metrics.net_in_speed);
  server.net_out_speed = toSafeMetricFloat(metrics.net_out_speed);
  server.net_rx = toSafeMetricFloat(metrics.net_rx);
  server.net_tx = toSafeMetricFloat(metrics.net_tx);
  server.net_rx_monthly = toSafeMetricFloat(metrics.net_rx_monthly);
  server.net_tx_monthly = toSafeMetricFloat(metrics.net_tx_monthly);
  server.processes = toSafeMetricInt(metrics.processes);
  server.tcp_conn = toSafeMetricInt(metrics.tcp_conn);
  server.udp_conn = toSafeMetricInt(metrics.udp_conn);
  server.ping_ct = normalizeProbeMetric(metrics.ping_ct, 'ping_ct');
  server.ping_cu = normalizeProbeMetric(metrics.ping_cu, 'ping_cu');
  server.ping_cm = normalizeProbeMetric(metrics.ping_cm, 'ping_cm');
  server.ping_bd = normalizeProbeMetric(metrics.ping_bd, 'ping_bd');
  server.loss_ct = normalizeProbeMetric(metrics.loss_ct, 'loss_ct');
  server.loss_cu = normalizeProbeMetric(metrics.loss_cu, 'loss_cu');
  server.loss_cm = normalizeProbeMetric(metrics.loss_cm, 'loss_cm');
  server.loss_bd = normalizeProbeMetric(metrics.loss_bd, 'loss_bd');
  server.ping_node_1 = normalizeProbeMetric(metrics.ping_node_1, 'ping_node_1');
  server.ping_node_2 = normalizeProbeMetric(metrics.ping_node_2, 'ping_node_2');
  server.ping_node_3 = normalizeProbeMetric(metrics.ping_node_3, 'ping_node_3');
  server.ping_node_4 = normalizeProbeMetric(metrics.ping_node_4, 'ping_node_4');
  server.loss_node_1 = normalizeProbeMetric(metrics.loss_node_1, 'loss_node_1');
  server.loss_node_2 = normalizeProbeMetric(metrics.loss_node_2, 'loss_node_2');
  server.loss_node_3 = normalizeProbeMetric(metrics.loss_node_3, 'loss_node_3');
  server.loss_node_4 = normalizeProbeMetric(metrics.loss_node_4, 'loss_node_4');
  server.ram_total = toSafeMetricFloat(metrics.ram_total);
  server.ram_used = toSafeMetricFloat(metrics.ram_used);
  server.swap_total = toSafeMetricFloat(metrics.swap_total);
  server.swap_used = toSafeMetricFloat(metrics.swap_used);
  server.disk_total = toSafeMetricFloat(metrics.disk_total);
  server.disk_used = toSafeMetricFloat(metrics.disk_used);
  if (hasDiskMetricsPayload(metrics)) {
    server.disk = normalizeDiskMetrics(metrics);
  } else {
    delete server.disk;
  }
  server.cpu_cores = toSafeMetricInt(metrics.cpu_cores, { min: 0, max: 65535, fallback: 0 });
  server.cpu_info = toSafeMetricString(metrics.cpu_info, 256, '');
  server.gpu_info = sanitizeGpuInfo(metrics.gpu_info);
  server.arch = toSafeMetricString(metrics.arch, 64, '');
  server.os = toSafeMetricString(metrics.os, 128, '');
  server.kernel_version = toSafeMetricString(metrics.kernel_version, 128, '');
  server.agent_version = toSafeMetricString(metrics.agent_version, 64, '');
  server.region = toSafeMetricString(server.region || metrics.region, 32, '');
  server.ip_v4 = toSafeMetricString(metrics.ip_v4, 64, '0');
  server.ip_v6 = toSafeMetricString(metrics.ip_v6, 128, '0');
  server.boot_time = toSafeMetricString(metrics.boot_time, 64, '');
  server.last_updated = toSafeMetricInt(metrics.timestamp, { min: 0, fallback: 0 });
}
