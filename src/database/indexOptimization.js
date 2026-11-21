import { saveSiteOptions, debug, getSettingByKey } from '../utils/settings.js';
import { getAllServers, clearServersListCache, clearServerDetailCache } from '../utils/cache.js';

export const HISTORY_PARTITION_MULTIPLIER = 10000000000000;
export const HISTORY_MAX_PARTITION_ID = 900;
export const HISTORY_MAX_TIME_KEY = 991231235959;
export const SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_history_partition_unique ON servers(history_partition_id) WHERE history_partition_id > 0';

export function isHistoryPartitionUniqueError(error) {
  const message = error?.message || String(error || '');
  return /UNIQUE constraint failed:\s*servers\.history_partition_id/i.test(message) ||
    /idx_servers_history_partition_unique/i.test(message);
}

async function ensureHistoryPartitionUniqueIndex(db) {
  try {
    await db.prepare(SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL).run();
  } catch (e) {
    debug(`Failed to create history_partition_id unique index: ${e?.message || e}`);
  }
}

// 确保servers历史记录分区优化
export async function ensureServerOptimization(db, options = {}) {
  const forceServerId = typeof options === 'string'
    ? options.trim()
    : String(options?.forceServerId || '').trim();
  const optimized = await getSettingByKey(db, 'servers_optimized', true);
  const { results: columns = [] } = await db.prepare(`PRAGMA table_info(servers)`).all();
  const existingColumns = new Set(columns.map(column => column.name));
  let addedColumns = 0;

  if (!existingColumns.has('history_partition_id')) {
    await db.prepare(`ALTER TABLE servers ADD COLUMN history_partition_id INTEGER DEFAULT 0`).run();
    addedColumns++;
    debug('history_partition_id 字段已添加');
  }

  if (!existingColumns.has('timestamp')) {
    await db.prepare(`ALTER TABLE servers ADD COLUMN timestamp INTEGER DEFAULT 0`).run();
    addedColumns++;
    debug('timestamp 字段已添加');
  }

  if (addedColumns > 0) {
    clearServersListCache();
    clearServerDetailCache();
  }

  if (optimized && addedColumns === 0 && !forceServerId) {
    try {
      await db.prepare(SERVERS_HISTORY_PARTITION_UNIQUE_INDEX_SQL).run();
      debug('服务器历史记录分区已优化');
      return { success: true, assigned: 0 };
    } catch (indexErr) {
      if (!isHistoryPartitionUniqueError(indexErr)) {
        debug(`Failed to verify history_partition_id unique index: ${indexErr?.message || indexErr}`);
        return { success: true, assigned: 0 };
      }
      debug('检测到存量重复 history_partition_id，继续执行去重重分配自愈');
    }
  }

  const { results: servers = [] } = await db.prepare(`
    SELECT id, history_partition_id
    FROM servers
    ORDER BY id ASC
  `).all();

  if (servers.length === 0) {
    debug('没有服务器需要优化');
    await ensureHistoryPartitionUniqueIndex(db);
    await saveSiteOptions(db, { servers_optimized: 'true' });
    return { success: true, assigned: 0 };
  }

  if (servers.length > HISTORY_MAX_PARTITION_ID) {
    throw new Error(`No available history partition id; max is ${HISTORY_MAX_PARTITION_ID}`);
  }

  // 只给尚未分配有效唯一分区 ID 的服务器补分配，已有唯一有效 ID 一律保留：
  // 历史行主键前缀就是分区 ID（buildHistoryId），按行号重排会让旧历史无法命中，
  // 且删除节点释放的前缀被后续服务器复用后会读到别的服务器的旧数据。
  const usedIds = new Set();
  const unassignedServers = [];
  for (const server of servers) {
    const pid = Number(server.history_partition_id);
    if (Number.isInteger(pid) && pid > 0 && pid <= HISTORY_MAX_PARTITION_ID && !usedIds.has(pid)) {
      usedIds.add(pid);
    } else {
      unassignedServers.push(server);
    }
  }

  if (unassignedServers.length === 0) {
    debug('所有服务器均已分配历史分区 ID');
    await ensureHistoryPartitionUniqueIndex(db);
    clearServersListCache();
    clearServerDetailCache();
    await saveSiteOptions(db, { servers_optimized: 'true' });
    return { success: true, assigned: 0 };
  }

  let nextId = 1;
  let updated = 0;
  let failedCount = 0;

  for (const server of unassignedServers) {
    let assigned = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      while (nextId <= HISTORY_MAX_PARTITION_ID && usedIds.has(nextId)) {
        nextId++;
      }
      if (nextId > HISTORY_MAX_PARTITION_ID) {
        throw new Error(`No available history partition id; max is ${HISTORY_MAX_PARTITION_ID}`);
      }
      const candidateId = nextId;
      usedIds.add(candidateId);

      try {
        await db.prepare(
          `UPDATE servers SET history_partition_id = ? WHERE id = ?`
        ).bind(candidateId, server.id).run();
        updated++;
        assigned = true;
        break;
      } catch (e) {
        if (isHistoryPartitionUniqueError(e) && attempt < 2) {
          continue;
        }
        debug(`Failed to update server ${server.id} history_partition_id: ${e.message}`);
        break;
      }
    }
    if (!assigned) {
      failedCount++;
    }
  }

  // 清空服务器列表与详情缓存
  clearServersListCache();
  clearServerDetailCache();

  debug(`服务器历史记录分区优化完成，更新了 ${updated} 条记录，失败 ${failedCount} 条`);

  if (failedCount > 0) {
    return { success: false, assigned: updated, failed: failedCount };
  }

  await ensureHistoryPartitionUniqueIndex(db);

  // 全部成功才标记为已优化
  await saveSiteOptions(db, { servers_optimized: 'true' });

  return { success: true, assigned: updated };
}

// 获取下一个可用的历史记录分区ID（直查 D1，避免读取 120s 过期缓存导致并发分配冲突）
export async function getNextServerHistoryPartitionId(db) {
  const { results = [] } = await db.prepare(
    'SELECT history_partition_id FROM servers WHERE history_partition_id > 0'
  ).all();
  const usedIds = new Set(
    results
      .map(s => Number(s.history_partition_id))
      .filter(id => Number.isInteger(id) && id > 0 && id <= HISTORY_MAX_PARTITION_ID)
  );
  
  for (let id = 1; id <= HISTORY_MAX_PARTITION_ID; id++) {
    if (!usedIds.has(id)) return id;
  }
  debug(`No available history partition id`);
  throw new Error(`No available history partition id`);
}

function padHistoryTimePart(value) {
  return String(value).padStart(2, '0');
}

// 格式化历史记录时间戳
export function normalizeHistoryTimestamp(value, fallback = Date.now()) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return ts < 10000000000 ? ts * 1000 : ts;
}

export function formatHistoryTimeKey(timestamp) {
  const normalized = normalizeHistoryTimestamp(timestamp);

  const date = new Date(normalized);
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2099) {
    debug(`Invalid year ${year} for history time key`);
    throw new Error(`Invalid year ${year} for history time key`);
  };

  return Number([
    padHistoryTimePart(year % 100),
    padHistoryTimePart(date.getUTCMonth() + 1),
    padHistoryTimePart(date.getUTCDate()),
    padHistoryTimePart(date.getUTCHours()),
    padHistoryTimePart(date.getUTCMinutes()),
    padHistoryTimePart(date.getUTCSeconds())
  ].join(''));
}

export function normalizeHistoryPartitionId(value) {
  const partitionId = Number(value);
  if (!Number.isInteger(partitionId) || partitionId <= 0 || partitionId > HISTORY_MAX_PARTITION_ID) {
    return null;
  }
  return partitionId;
}

export function buildHistoryId(partitionId, timestamp) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }
  return normalizedPartitionId * HISTORY_PARTITION_MULTIPLIER + formatHistoryTimeKey(timestamp);
}

export async function getServerHistoryInfo(db, serverId, server = null) {
  const target = server && server.id === serverId
    ? server
    : (await getAllServers(db, true)).find(s => s.id === serverId);

  if (!target) {
    debug(`Server ${serverId} not found`);
    throw new Error(`Server ${serverId} not found`);
  }

  return {
    partitionId: normalizeHistoryPartitionId(target.history_partition_id),
    startTimestamp: normalizeHistoryTimestamp(target.timestamp, 0)
  };
}

export function getHistoryIdRange(partitionId, startTimestamp = null, endTimestamp = null) {
  const normalizedPartitionId = normalizeHistoryPartitionId(partitionId);
  if (!normalizedPartitionId) {
    throw new Error('Invalid history partition id');
  }

  const prefix = normalizedPartitionId * HISTORY_PARTITION_MULTIPLIER;
  return {
    startId: prefix + (startTimestamp === null || startTimestamp === undefined
      ? 0
      : formatHistoryTimeKey(startTimestamp)),
    endId: prefix + (endTimestamp === null || endTimestamp === undefined
      ? HISTORY_MAX_TIME_KEY
      : formatHistoryTimeKey(endTimestamp))
  };
}
