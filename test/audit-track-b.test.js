import assert from 'node:assert/strict';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  clearDashboardLatencyHistoryCache,
  clearHistory,
  clampMetricTimestamp,
  getDashboardLatencyHistory,
  getLatestMetrics,
  getLatestMetricsForAllServers,
  getMetricsHistory,
  initDatabase,
  saveMetricsHistory,
  weeklyCleanup
} from '../src/database/schema.js';
import {
  buildHistoryId,
  ensureServerOptimization
} from '../src/database/indexOptimization.js';
import { buildSparseHistoryQuery } from '../src/database/historySampling.js';
import { addServerColumns } from '../src/database/updateDatabase.js';
import { handleAdminAPI, resetLoginFailureStateForTests } from '../src/handlers/admin.js';
import { handleServersAPI } from '../src/handlers/dashboard.js';
import {
  handleUpdate,
  handleWebSocketUpgrade,
  readBoundedJsonObject
} from '../src/handlers/update.js';
import {
  checkExpiringServers,
  checkOfflineNodes,
  checkResourceAlerts,
  evaluateTrafficAlert,
  isBlockedNotificationHost,
  sendNotification,
  splitNotificationEntries,
  validateSafeNotificationUrl
} from '../src/services/notification.js';
import { checkAuth, generateToken } from '../src/middleware/auth.js';
import { discoverServer } from '../src/utils/autoDiscovery.js';
import { clearAllCaches, setLatestMetricsCache } from '../src/utils/cache.js';
import { hashPassword } from '../src/utils/common.js';
import { UPDATE_MAX_REQUEST_BYTES } from '../src/utils/config.js';
import {
  cacheLatestReportUpdate,
  clearLatestReportCache,
  getWorkerLatestReportUpdates
} from '../src/utils/latestReportCache.js';
import {
  coerceNumericMetricFields,
  sanitizeGpuInfo,
  toSafeMetricFloat,
  toSafeMetricInt,
  toSafeMetricString
} from '../src/utils/metrics.js';
import { hasRecentFrontendRealtimeActivity } from '../src/utils/realtimeBroadcastGate.js';
import {
  detectCurrencySymbol,
  normalizeCurrency,
  normalizePrice,
  parseDateOnly,
  renewExpireDateIfNeeded
} from '../src/utils/serverBilling.js';
import {
  clearAppearanceSettingsCache,
  clearSiteSettingsCache,
  loadAppearanceOptions,
  loadSettings,
  loadSiteSettings,
  saveSiteOptions
} from '../src/utils/settings.js';
import { GB, getTrafficUsageBytes } from '../src/utils/traffic.js';

function createMiniflare(name = 'audit-track-b') {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK"); } }',
    d1Databases: { DB: name }
  });
}

test('Contract 1: cold settings failure attaches non-enumerable _degradedColdFailure without mutating enumerable keys', async (t) => {
  clearSiteSettingsCache();
  t.after(clearSiteSettingsCache);
  t.mock.method(console, 'error', () => {});

  const failingDb = {
    prepare() {
      return {
        async first() {
          throw new Error('D1 cold start failure');
        }
      };
    }
  };

  const fallback = await loadSiteSettings(failingDb);
  assert.equal(fallback._degradedColdFailure, true);
  assert.equal(Object.keys(fallback).includes('_degradedColdFailure'), false);
  assert.equal(Object.prototype.propertyIsEnumerable.call(fallback, '_degradedColdFailure'), false);
  assert.equal(fallback.is_public, 'true');
  assert.equal(fallback.jwt_secret, '');
});

test('Contract 1b: start_theme_preview rejects forged Bearer header even when valid auth cookie is present', async (t) => {
  const env = { API_SECRET: 'super-secret-api-key' };
  const sys = { password: 'hashed-password', jwt_secret: 'k'.repeat(64) };
  const validCookieToken = await generateToken(env, sys);

  t.mock.method(globalThis, 'fetch', async () => new Response('<html></html>', { status: 200 }));

  // Forged bearer + valid cookie: cookie auth passes handleAdminAPI gate,
  // start_theme_preview must set the verified cookie token, NOT the forged bearer token.
  const mixedRequest = new Request('https://monitor.example.com/admin/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer forged.attacker.token',
      Cookie: `cfsm_auth=${encodeURIComponent(validCookieToken)}`
    },
    body: JSON.stringify({
      action: 'start_theme_preview',
      theme_url: 'https://github.com/owner/repo/tree/main'
    })
  });

  const mixedRes = await handleAdminAPI(mixedRequest, env, sys);
  assert.equal(mixedRes.status, 200);
  const setCookie = mixedRes.headers.get('Set-Cookie') || '';
  assert.ok(!setCookie.includes('forged.attacker.token'), 'must never persist unverified Bearer token');
  assert.ok(setCookie.includes(encodeURIComponent(validCookieToken)), 'must persist verified cookie token');

  // Unauthenticated forged bearer alone is rejected with 401
  const forgedOnlyRequest = new Request('https://monitor.example.com/admin/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer forged.attacker.token'
    },
    body: JSON.stringify({
      action: 'start_theme_preview',
      theme_url: 'https://github.com/owner/repo/tree/main'
    })
  });
  const forgedRes = await handleAdminAPI(forgedOnlyRequest, env, sys);
  assert.equal(forgedRes.status, 401);
});

test('Contract 2: WebSocket X-CFSM-Admin header isolation, batch-push subscribers wakeup, and DO invalidation', async (t) => {
  clearAllCaches();
  clearLatestReportCache();
  t.after(() => {
    clearAllCaches();
    clearLatestReportCache();
  });

  const siteSettings = {
    is_public: 'true',
    jwt_secret: 's'.repeat(64),
    password: 'hashed-password'
  };
  const forwardedRequests = [];
  const invalidatedPayloads = [];

  const mf = createMiniflare('track-b-contract-2');
  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);
    await saveSiteOptions(db, siteSettings);

    const env = {
      API_SECRET: 'test-secret',
      DB: db,
      METRICS_BROADCASTER: {
        idFromName: () => 'global',
        get: () => ({
          async fetch(input, init) {
            const req = input instanceof Request ? input : new Request(input, init);
            const url = new URL(req.url);
            if (url.pathname === '/ws') {
              forwardedRequests.push(req);
              return new Response('Switching', { status: 200 });
            }
            if (url.pathname === '/internal/invalidate') {
              invalidatedPayloads.push(await req.json());
              return Response.json({ ok: true });
            }
            if (url.pathname === '/batch-push') {
              const payload = await req.json();
              forwardedRequests.push({ pathname: '/batch-push', payload });
              return Response.json({ ok: true, subscribers: 3 });
            }
            if (url.pathname === '/health') {
              return Response.json({ ok: true, subscribers: 3 });
            }
            return Response.json({ ok: true });
          }
        })
      }
    };

    // 1) Unauthenticated client spoofing X-CFSM-Admin: 1 must be downgraded to '0'
    const spoofedWsReq = new Request('https://monitor.example.com/api/ws', {
      headers: {
        Upgrade: 'websocket',
        'X-CFSM-Admin': '1'
      }
    });
    await handleWebSocketUpgrade(spoofedWsReq, env);
    assert.equal(forwardedRequests.length, 1);
    assert.equal(forwardedRequests[0].headers.get('X-CFSM-Admin'), '0');

    // 2) Authenticated admin gets X-CFSM-Admin: '1'
    const adminToken = await generateToken(env, siteSettings);
    const adminWsReq = new Request(`https://monitor.example.com/api/ws?token=${encodeURIComponent(adminToken)}`, {
      headers: { Upgrade: 'websocket' }
    });
    await handleWebSocketUpgrade(adminWsReq, env);
    assert.equal(forwardedRequests.length, 2);
    assert.equal(forwardedRequests[1].headers.get('X-CFSM-Admin'), '1');

    // 3) Admin delete triggers /internal/invalidate and clears latestReportCache
    const serverId = '11111111-1111-4111-8111-111111111111';
    await db.prepare(
      'INSERT INTO servers (id, name, history_partition_id, is_hidden, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).bind(serverId, 'HiddenBox', 5, '1', Date.now()).run();
    cacheLatestReportUpdate(serverId, [{ ts: Date.now(), payload: { cpu: 10 } }]);
    assert.equal(getWorkerLatestReportUpdates([serverId]).length, 1);

    // Report from hidden node -> batch-push carries isHidden: true and marks realtime active
    const waitPromises = [];
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
    const updateRes = await handleUpdate(
      new Request('https://monitor.example.com/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: serverId, secret: 'test-secret', metrics: { cpu: 25 } })
      }),
      env,
      { waitUntil: p => waitPromises.push(p) }
    );
    assert.equal(updateRes.status, 200);
    t.mock.timers.tick(6000);
    await Promise.all(waitPromises);
    t.mock.timers.reset();

    const batchPushCall = forwardedRequests.find(item => item.pathname === '/batch-push');
    assert.ok(batchPushCall, 'batch-push should be sent');
    assert.equal(batchPushCall.payload.updates[0].isHidden, true);
    assert.equal(hasRecentFrontendRealtimeActivity(), true);

    const delPromises = [];
    const delRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ action: 'delete', id: serverId })
      }),
      env,
      { ...siteSettings },
      null,
      { waitUntil: p => delPromises.push(p) }
    );
    assert.equal(delRes.status, 200);
    await Promise.all(delPromises);
    assert.equal(getWorkerLatestReportUpdates([serverId]).length, 0);
    assert.ok(invalidatedPayloads.some(p => Array.isArray(p.deletedServerIds) && p.deletedServerIds.includes(serverId)));
  } finally {
    await mf.dispose();
  }
});

test('Problem 1: streaming byte cap without Content-Length, non-object JSON rejection, prototype isolation, and IP-scoped login rate limit', async (t) => {
  resetLoginFailureStateForTests();
  t.after(resetLoginFailureStateForTests);

  // 1) Chunked stream without Content-Length exceeding UPDATE_MAX_REQUEST_BYTES cancels stream early with 413
  let extraChunksPulled = 0;
  let streamCancelled = false;
  const chunkBytes = new Uint8Array(200 * 1024).fill(97); // 200 KB per chunk
  let emitted = 0;
  const stream = new ReadableStream({
    pull(controller) {
      emitted++;
      if (emitted > 4) extraChunksPulled++;
      if (emitted <= 10) {
        controller.enqueue(chunkBytes);
      } else {
        controller.close();
      }
    },
    cancel() {
      streamCancelled = true;
    }
  });

  const chunkedReq = new Request('https://monitor.example.com/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half'
  });

  let dbTouched = false;
  const overLimitRes = await handleUpdate(
    chunkedReq,
    {
      API_SECRET: 'secret',
      DB: { prepare() { dbTouched = true; throw new Error('must not query DB'); } }
    },
    { waitUntil() {} }
  );
  assert.equal(overLimitRes.status, 413);
  assert.equal(overLimitRes.headers.get('X-CFSM-Agent-Status'), 'payload_too_large');
  assert.equal(streamCancelled, true);
  assert.equal(extraChunksPulled, 0, 'stream must be cancelled as soon as cumulative bytes exceed limit');
  assert.equal(dbTouched, false);

  // 2) JSON "null", array, primitive return 400 instead of 500 TypeError
  for (const invalidBody of ['null', '[1,2,3]', '123', '"hello"', '{bad']) {
    const uRes = await handleUpdate(
      new Request('https://monitor.example.com/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: invalidBody
      }),
      { API_SECRET: 'secret', DB: {} },
      { waitUntil() {} }
    );
    assert.equal(uRes.status, 400, `update body ${invalidBody} must return 400`);

    const aRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: invalidBody
      }),
      { API_SECRET: 'secret', DB: {} },
      { password: 'x', jwt_secret: 'z'.repeat(64) }
    );
    assert.equal(aRes.status, 400, `admin body ${invalidBody} must return 400`);
  }

  // 3) Prototype-chain action names ("toString", "constructor", "__proto__") never 500
  const env = { API_SECRET: 'admin-secret', DB: {} };
  const sys = { password: await hashPassword('correct-pass'), jwt_secret: 'j'.repeat(64) };
  const adminToken = await generateToken(env, sys);

  for (const protoAction of ['toString', 'constructor', '__proto__', 'valueOf']) {
    const unauthProto = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: protoAction })
      }),
      env,
      sys
    );
    assert.equal(unauthProto.status, 401);

    const authProto = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: protoAction })
      }),
      env,
      sys
    );
    assert.equal(authProto.status, 400);
  }

  // 4) Per-IP login rate limit + Turnstile checked before incrementing failure counter
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false }));
  const turnstileSys = {
    ...sys,
    turnstile_login_enabled: 'true',
    turnstile_secret_key: 'ts-secret'
  };
  for (let i = 0; i < 6; i++) {
    const res = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '203.0.113.10',
          'X-Turnstile-Token': 'invalid-ts'
        },
        body: JSON.stringify({ action: 'login', username: 'admin', password: 'wrong' })
      }),
      env,
      turnstileSys
    );
    assert.equal(res.status, 403, 'failed Turnstile must return 403 without locking IP');
  }

  // Attacker IP 198.51.100.99 fails 5 times -> locked with 429, while admin IP 203.0.113.10 logs in fine
  for (let i = 0; i < 5; i++) {
    const failRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.99' },
        body: JSON.stringify({ action: 'login', username: 'admin', password: 'wrong' })
      }),
      env,
      sys
    );
    assert.equal(failRes.status, 401);
  }
  const lockedRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.99' },
      body: JSON.stringify({ action: 'login', username: 'admin', password: 'correct-pass' })
    }),
    env,
    sys
  );
  assert.equal(lockedRes.status, 429);

  const realAdminRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify({ action: 'login', username: 'admin', password: 'correct-pass' })
    }),
    env,
    sys
  );
  assert.equal(realAdminRes.status, 200);

  // Oversized credentials rejected with 400
  const hugeCredRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username: 'a'.repeat(129), password: 'x' })
    }),
    env,
    sys
  );
  assert.equal(hugeCredRes.status, 400);
});

test('Problem 2: import_servers 37-column bind fix, full validation, boolean normalization, appearance merge, and JWT secret rotation', async () => {
  clearAllCaches();
  const mf = createMiniflare('track-b-problem-2');

  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);

    const initialSecret = 'initial-jwt-secret-'.padEnd(64, '0');
    const initialPasswordHash = await hashPassword('old-password');
    await saveSiteOptions(db, {
      username: 'admin',
      password: initialPasswordHash,
      jwt_secret: initialSecret,
      is_public: false,
      show_price: false
    });

    // Verify boolean normalization on load
    clearSiteSettingsCache();
    const loadedSettings = await loadSiteSettings(db, { forceRefresh: true });
    assert.equal(loadedSettings.is_public, 'false');
    assert.equal(loadedSettings.show_price, 'false');

    const env = { API_SECRET: 'secret', DB: db };
    const sys = { ...loadedSettings };
    const oldToken = await generateToken(env, sys);

    // Seed appearance_options with existing keys, then update only display_mode via save_settings
    await db.prepare(
      "INSERT INTO settings (key, value) VALUES ('appearance_options', ?)"
    ).bind(JSON.stringify({ site_title: 'Preserved Site', theme_options: { accent: 'blue' } })).run();
    clearAppearanceSettingsCache();

    // Change password + boolean true/false + partial appearance field + spoofed jwt_secret
    const saveRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oldToken}` },
        body: JSON.stringify({
          action: 'save_settings',
          settings: {
            password: 'new-strong-password',
            is_public: true,
            show_price: true,
            display_mode: 'table',
            jwt_secret: 'attacker-controlled-jwt-secret-should-be-ignored-1234567890'
          }
        })
      }),
      env,
      sys
    );
    assert.equal(saveRes.status, 200);
    const saveBody = await saveRes.json();
    assert.ok(saveBody.token, 'password change must issue a new token');
    assert.ok((saveRes.headers.get('Set-Cookie') || '').includes('cfsm_auth='));

    const updatedSite = await loadSiteSettings(db, { forceRefresh: true });
    assert.notEqual(updatedSite.jwt_secret, initialSecret, 'jwt_secret must rotate on password change');
    assert.notEqual(
      updatedSite.jwt_secret,
      'attacker-controlled-jwt-secret-should-be-ignored-1234567890',
      'client-supplied jwt_secret must be ignored'
    );
    assert.equal(updatedSite.is_public, 'true');
    assert.equal(updatedSite.show_price, 'true');

    // Old token is immediately invalidated; new token works
    const oldAuthReq = new Request('https://monitor.example.com/admin/api', {
      headers: { Authorization: `Bearer ${oldToken}` }
    });
    const newAuthReq = new Request('https://monitor.example.com/admin/api', {
      headers: { Authorization: `Bearer ${saveBody.token}` }
    });
    assert.equal(await checkAuth(oldAuthReq, env, updatedSite), false);
    assert.equal(await checkAuth(newAuthReq, env, updatedSite), true);

    // Appearance merge preserved site_title and theme_options
    const mergedAppearance = await loadAppearanceOptions(db);
    assert.equal(mergedAppearance.display_mode, 'table');
    assert.equal(mergedAppearance.site_title, 'Preserved Site');
    assert.deepEqual(mergedAppearance.theme_options, { accent: 'blue' });

    // import_servers: valid server succeeds in real D1 (37 columns == 37 placeholders), invalid rows skipped
    const validId = '22222222-2222-4222-8222-222222222222';
    const badOrderId = '33333333-3333-4333-8333-333333333333';
    const badTsId = '44444444-4444-4444-8444-444444444444';
    const badPingId = '55555555-5555-4555-8555-555555555555';
    const importRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saveBody.token}` },
        body: JSON.stringify({
          action: 'import_servers',
          servers: [
            null,
            {
              id: validId,
              name: 'Imported Tokyo Node',
              server_group: 'Asia',
              region: 'jp',
              price: 'Rp. 50000',
              expire_date: '2027-05-31',
              sort_order: 3,
              reset_day: 15,
              collect_interval: 1,
              report_interval: 60,
              custom_ct: '1.1.1.1:80',
              timestamp: Date.UTC(2026, 0, 15)
            },
            { id: badOrderId, name: 'Bad Order', sort_order: 'abc' },
            { id: badTsId, name: 'Epoch 1970', timestamp: 1000 },
            { id: badPingId, name: 'Bad Ping', custom_ct: 'http://evil.com/path' }
          ]
        })
      }),
      env,
      updatedSite
    );
    assert.equal(importRes.status, 200);
    const importJson = await importRes.json();
    assert.equal(importJson.imported, 1);
    assert.equal(importJson.skipped, 4);

    const importedRow = await db.prepare('SELECT * FROM servers WHERE id = ?').bind(validId).first();
    assert.equal(importedRow.name, 'Imported Tokyo Node');
    assert.equal(importedRow.price, '50000.00');
    assert.equal(importedRow.currency, 'Rp');
    assert.equal(importedRow.sort_order, 3);

    // edit rejects invalid expire_date and oversized server_group
    const invalidDateEdit = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saveBody.token}` },
        body: JSON.stringify({
          action: 'edit',
          id: validId,
          name: 'Imported Tokyo Node',
          expire_date: '2026-02-30',
          collect_interval: 1,
          report_interval: 60,
          reset_day: 1
        })
      }),
      env,
      updatedSite
    );
    assert.equal(invalidDateEdit.status, 400);
    assert.equal((await invalidDateEdit.json()).error, 'invalidExpireDate');
  } finally {
    clearAllCaches();
    await mf.dispose();
  }
});

test('Problem 3: history_partition_id unique index, conflict retry, forceServerId healing, and primary-key range deletion on delete/batch_delete', async () => {
  clearAllCaches();
  const mf = createMiniflare('track-b-problem-3');

  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);

    // Unique index rejects duplicate positive history_partition_id, while allowing multiple 0s
    await db.prepare('INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, ?, ?, ?)')
      .bind('66666666-6666-4666-8666-666666666661', 'Zero-A', 0, Date.now()).run();
    await db.prepare('INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, ?, ?, ?)')
      .bind('66666666-6666-4666-8666-666666666662', 'Zero-B', 0, Date.now()).run();

    // Even when servers_optimized === 'true', ensureServerOptimization with forceServerId heals unassigned rows
    await saveSiteOptions(db, { servers_optimized: 'true' });
    const healResult = await ensureServerOptimization(db, {
      forceServerId: '66666666-6666-4666-8666-666666666661'
    });
    assert.equal(healResult.success, true);
    assert.equal(healResult.assigned, 2);

    const healedRows = (await db.prepare('SELECT id, history_partition_id FROM servers ORDER BY id').all()).results;
    assert.deepEqual(healedRows.map(r => r.history_partition_id), [1, 2]);

    await assert.rejects(
      () => db.prepare('INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, ?, ?, ?)')
        .bind('66666666-6666-4666-8666-666666666663', 'Dup', 1, Date.now()).run(),
      /UNIQUE constraint failed/i
    );

    // Auto-discovery retries on UNIQUE constraint collision
    let selectCount = 0;
    const collidingDb = {
      prepare(sql) {
        return {
          args: [],
          bind(...vals) { this.args = vals; return this; },
          async first() {
            if (sql.includes('MAX(sort_order)')) return { max_order: 1 };
            return null;
          },
          async all() {
            selectCount++;
            // First allocation sees partition 1 free (stale race), second sees 1 occupied
            return { results: selectCount === 1 ? [] : [{ history_partition_id: 1 }] };
          },
          async run() {
            const partitionId = this.args[6];
            if (partitionId === 1) {
              throw new Error('UNIQUE constraint failed: servers.history_partition_id');
            }
            return { success: true };
          }
        };
      }
    };
    const discovered = await discoverServer({ DB: collidingDb }, { name: 'race-node' });
    assert.equal(discovered.mode, 'created');
    assert.ok(discovered.id);

    // Seed metrics_history and metrics_history_old for partitions 1 and 2, then delete server 1
    const ts = Date.UTC(2026, 5, 1, 12, 0, 0);
    await saveMetricsHistory(db, healedRows[0].id, 1, { cpu: 55 }, 'US', ts);
    await saveMetricsHistory(db, healedRows[1].id, 2, { cpu: 77 }, 'JP', ts);
    await weeklyCleanup(db); // Rotates current rows into metrics_history_old and creates fresh metrics_history
    await saveMetricsHistory(db, healedRows[0].id, 1, { cpu: 65 }, 'US', ts + 60_000);
    await saveMetricsHistory(db, healedRows[1].id, 2, { cpu: 88 }, 'JP', ts + 60_000);

    const sys = { password: await hashPassword('pw'), jwt_secret: 'm'.repeat(64) };
    const env = { API_SECRET: 'sec', DB: db };
    const token = await generateToken(env, sys);

    const delRes = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', id: healedRows[0].id })
      }),
      env,
      sys
    );
    assert.equal(delRes.status, 200);

    const remainingCurrent = (await db.prepare('SELECT server_id FROM metrics_history').all()).results;
    const remainingOld = (await db.prepare('SELECT server_id FROM metrics_history_old').all()).results;
    assert.deepEqual(remainingCurrent.map(r => r.server_id), [healedRows[1].id]);
    assert.deepEqual(remainingOld.map(r => r.server_id), [healedRows[1].id]);

    // Partition reuse isolation: new server assigned partition 2 (after deleting server 2 manually without clearing history)
    // must NOT read rows with wrong server_id or timestamps before its own creation
    const staleServerId = healedRows[1].id;
    const newServer = { id: 'new-reused-srv', history_partition_id: 2, timestamp: ts + 300_000 };
    clearDashboardLatencyHistoryCache();
    const latencyMap = await getDashboardLatencyHistory(db, [newServer], {
      now: ts + 360_000,
      cache: false
    });
    const pingPoints = latencyMap.get('new-reused-srv').ping;
    assert.equal(pingPoints.every(p => p.ct === undefined), true, 'must exclude samples older than startTimestamp');
    assert.equal(await getLatestMetrics(db, 'new-reused-srv', { id: 'new-reused-srv', history_partition_id: 2, timestamp: ts }), null);
    assert.ok(await getLatestMetrics(db, staleServerId, { id: staleServerId, history_partition_id: 2, timestamp: ts }));
  } finally {
    clearAllCaches();
    await mf.dispose();
  }
});

test('Problem 4: clock drift clamping, extreme metric sanitization, sub-ms ping rounding, column whitelist, and COALESCE fallback', async () => {
  clearAllCaches();
  const mf = createMiniflare('track-b-problem-4');

  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);

    const serverNow = Date.UTC(2026, 7, 10, 12, 0, 0);
    assert.equal(clampMetricTimestamp(1000, serverNow), serverNow, '1970 timestamp clamped to serverNow');
    assert.equal(clampMetricTimestamp(serverNow + 600_000, serverNow), serverNow, 'far-future timestamp clamped');
    assert.equal(clampMetricTimestamp(serverNow - 30_000, serverNow), serverNow - 30_000, 'normal recent timestamp kept');

    // Extreme scalars / non-scalars / oversized gpu_info / sub-millisecond ping
    assert.equal(toSafeMetricFloat('Infinity'), 0);
    assert.equal(toSafeMetricFloat(-50), 0);
    assert.equal(toSafeMetricFloat(250, { min: 0, max: 100 }), 100);
    assert.equal(toSafeMetricInt([1, 2, 3]), 0);
    assert.equal(toSafeMetricString({ bad: true }, 64, '0 0 0'), '0 0 0');

    const hugeGpu = Array.from({ length: 100 }, (_, i) => ({ name: `GPU-${i}-${'X'.repeat(200)}`, util: 50 }));
    const sanitizedGpu = sanitizeGpuInfo(hugeGpu, 4096);
    assert.ok(sanitizedGpu.length <= 4096);
    assert.ok(Array.isArray(JSON.parse(sanitizedGpu)));
    assert.equal(sanitizeGpuInfo({ notAnArray: true }), '');

    const coerced = coerceNumericMetricFields({ cpu: 999, net_rx: -100, ping_ct: 0.4, ping_cu: 0 });
    assert.equal(coerced.cpu, 100);
    assert.equal(coerced.net_rx, 0);
    assert.equal(coerced.ping_ct, 1, '0.4ms sub-millisecond reachable ping must round to 1ms, not null');
    assert.equal(coerced.ping_cu, null);

    // saveMetricsHistory returns { ok: true } with extreme dirty payload, and { ok: false } on invalid partition
    const badSave = await saveMetricsHistory(db, 'srv-1', 0, { cpu: 10 }, 'US', 1000);
    assert.equal(badSave.ok, false);

    const serverId = '77777777-7777-4777-8777-777777777777';
    await db.prepare('INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, ?, ?, ?)')
      .bind(serverId, 'DirtyMetricBox', 3, Date.UTC(2026, 0, 1)).run();

    const dirtySave = await saveMetricsHistory(
      db,
      serverId,
      3,
      {
        cpu: '999.9',
        load: [1, 2, 3],
        gpu_info: hugeGpu,
        net_rx: '-999',
        ping_ct: '0.35',
        loss_ct: '0.2'
      },
      'SG',
      1000 // 1970 epoch -> must be clamped instead of throwing in buildHistoryId
    );
    assert.equal(dirtySave.ok, true);

    const stored = await getLatestMetrics(db, serverId, {
      id: serverId,
      history_partition_id: 3,
      timestamp: Date.UTC(2026, 0, 1)
    });
    assert.equal(stored.cpu, 100);
    assert.equal(stored.load_avg, '0 0 0');
    assert.equal(stored.net_rx, 0);
    assert.equal(stored.ping_ct, 1);
    assert.equal(stored.loss_ct, 0);
    assert.ok(stored.gpu_info.length <= 4096);

    // getTrafficUsageBytes filters negative and Infinity
    assert.equal(getTrafficUsageBytes(-500, 'Infinity', 'total'), 0);

    // dashboard.js handleServersAPI protects globalNetRx against corrupted non-numeric strings
    setLatestMetricsCache(new Map([[serverId, { timestamp: Date.now(), net_rx: 'corrupted', net_tx: -50, cpu: 10 }]]));
    const dashRes = await handleServersAPI(
      new Request('https://monitor.example.com/api/servers'),
      { DB: db },
      { is_public: 'true', show_three_net_details: 'false' }
    );
    const dashData = await dashRes.json();
    assert.equal(Number.isFinite(dashData.stats.globalNetRx), true);
    assert.equal(dashData.stats.globalNetRx, 0);

    // Column whitelist blocks SQL injection attempts in getMetricsHistory and buildSparseHistoryQuery
    await assert.rejects(
      () => getMetricsHistory(db, serverId, 6, 'cpu, (SELECT value FROM settings)', {
        id: serverId,
        history_partition_id: 3,
        timestamp: Date.UTC(2026, 0, 1)
      }),
      /Invalid history column/
    );

    // COALESCE fallback in buildSparseHistoryQuery finds rows in metrics_history even for pre-boundary buckets (missed rotation)
    const boundary = Date.UTC(2026, 7, 9, 0, 0, 0);
    const preBoundaryTs = boundary - 1800_000;
    await db.prepare('CREATE TABLE IF NOT EXISTS metrics_history_old AS SELECT * FROM metrics_history WHERE 0').run();
    await saveMetricsHistory(db, serverId, 3, { cpu: 42 }, 'SG', preBoundaryTs);
    const sparse = buildSparseHistoryQuery({
      columns: 'cpu',
      queryStart: preBoundaryTs - 60_000,
      firstRangeEnd: preBoundaryTs + 60_000,
      queryEnd: preBoundaryTs + 60_000,
      intervalMs: 120_000,
      idPrefix: buildHistoryId(3, Date.UTC(2020, 0, 1)) - 200101000000,
      oldTableExists: true,
      tableBoundary: boundary
    });
    const sparseRows = (await db.prepare(sparse.sql).bind(...sparse.bindValues).all()).results;
    assert.equal(JSON.parse(sparseRows[0].sample_json).cpu, 42);

    // clearHistory atomically recreates metrics_history
    const cleared = await clearHistory(db);
    assert.equal(cleared.success, true);
  } finally {
    clearAllCaches();
    await mf.dispose();
  }
});

test('Problem 5a: serverBilling end-of-month anchor preservation, European decimals, currency ISO mapping, and legacy price batch migration', async () => {
  // 1) End-of-month non-collapsing renewal: 2026-01-31 -> 02-28 -> 03-31 -> 04-30 -> 05-31
  const r1 = renewExpireDateIfNeeded('2026-01-31', 'month', '1', Date.UTC(2026, 1, 1));
  assert.equal(r1.expire_date, '2026-02-28');

  const r2 = renewExpireDateIfNeeded('2026-01-31', 'month', '1', Date.UTC(2026, 2, 1));
  assert.equal(r2.expire_date, '2026-03-31');

  const r3 = renewExpireDateIfNeeded('2026-01-31', 'month', '1', Date.UTC(2026, 3, 1));
  assert.equal(r3.expire_date, '2026-04-30');

  const r4 = renewExpireDateIfNeeded('2026-01-31', 'month', '1', Date.UTC(2026, 4, 1));
  assert.equal(r4.expire_date, '2026-05-31');

  // Timezone-aligned referenceDateStr
  const tzRenew = renewExpireDateIfNeeded('2026-06-10', 'month', '1', Date.UTC(2026, 5, 9, 18, 0), 0, {
    referenceDateStr: '2026-06-10'
  });
  assert.equal(tzRenew.renewed, true);
  assert.equal(tzRenew.expire_date, '2026-07-10');

  // 2) normalizePrice edge cases
  assert.equal(normalizePrice('40,50'), '40.50');
  assert.equal(normalizePrice('€1.234,56'), '1234.56');
  assert.equal(normalizePrice('$1,234.56'), '1234.56');
  assert.equal(normalizePrice('Rp. 50000'), '50000.00');
  assert.equal(normalizePrice('CHF. 15.00'), '15.00');
  assert.equal(normalizePrice('1e25'), '1000000000000.00');
  assert.doesNotMatch(normalizePrice(1e25), /e/i);
  assert.equal(parseDateOnly('2026-02-29'), null);
  assert.deepEqual(parseDateOnly('2024-02-29'), { year: 2024, month: 2, day: 29 });

  // 3) Currency normalization & detection without false-positive single letters
  assert.equal(normalizeCurrency('RMB'), '¥');
  assert.equal(normalizeCurrency('CNY'), '¥');
  assert.equal(normalizeCurrency('RUB'), '₽');
  assert.equal(normalizeCurrency('MYR'), 'RM');
  assert.equal(normalizeCurrency('Quarter'), '');
  assert.equal(detectCurrencySymbol('100 RUB/mo'), '₽');
  assert.equal(detectCurrencySymbol('RMB 35'), '¥');
  assert.equal(detectCurrencySymbol('10 / Quarter'), '');
  assert.equal(detectCurrencySymbol('R 150'), 'R');
  assert.equal(detectCurrencySymbol('Q50'), 'Q');

  // 4) addServerColumns batches legacy price migration in chunks of 50
  let batchCalls = 0;
  const legacyServers = Array.from({ length: 65 }, (_, i) => ({ id: `s-${i}`, price: 'CHF. 10,50 / yr' }));
  const migrationDb = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql.includes('PRAGMA table_info')) return { results: [{ name: 'id' }, { name: 'price' }] };
          if (sql.includes('SELECT id, price')) return { results: legacyServers };
          return { results: [] };
        },
        async run() { return { success: true }; }
      };
    },
    async batch(stmts) {
      assert.ok(stmts.length <= 50);
      batchCalls++;
      return [];
    }
  };
  const migRes = await addServerColumns(migrationDb);
  assert.equal(migRes.success, true);
  assert.equal(migRes.migratedPrices, 65);
  assert.equal(batchCalls, 2);
});

test('Problem 5b: notification SSRF defense, hostname matching, resource alert send-before-persist, auto-renew before sentToday, and 1800-char chunking', async (t) => {
  clearAllCaches();
  t.after(clearAllCaches);

  // 1) SSRF host & URL checks
  for (const blocked of [
    'http://127.0.0.1:8080/hook',
    'http://localhost/hook',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'http://10.0.0.5/hook',
    'http://192.168.1.1/hook',
    'ftp://example.com/hook'
  ]) {
    assert.throws(() => validateSafeNotificationUrl(blocked), `must block ${blocked}`);
  }
  assert.equal(isBlockedNotificationHost('api.telegram.org'), false);
  assert.doesNotThrow(() => validateSafeNotificationUrl('https://example.com/hook'));

  // 2) Substring spoof in bot URL must NOT match Feishu/DingTalk; Webhook URL encodes template params & stops retrying on 400
  let fetchAttempts = 0;
  const fetchedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetchAttempts++;
    fetchedUrls.push(String(url));
    if (String(url).includes('status400')) {
      return new Response('Bad Request', { status: 400 });
    }
    return new Response('{"ok":true}', { status: 200 });
  });

  const spoofErr = await sendNotification({
    tg_bot_token: 'https://evil.example.com/collect?spoof=open.feishu.cn'
  }, 'hello');
  assert.equal(spoofErr, '未知的通知方式');
  assert.equal(fetchAttempts, 0);

  const ssrfBotErr = await sendNotification({
    tg_bot_token: 'https://127.0.0.1/open.feishu.cn'
  }, 'hello');
  assert.match(ssrfBotErr, /校验失败/);
  assert.equal(fetchAttempts, 0);

  // 4xx fails immediately on first attempt without 3 retries
  const err400 = await sendNotification({
    notification_webhook_enabled: 'true',
    notification_webhook_url: 'https://example.com/status400/{{event}}',
    notification_webhook_method: 'POST',
    notification_webhook_format: 'text'
  }, 'line1\nline2', { event: 'A & B #1' });
  assert.match(err400, /HTTP 400/);
  assert.equal(fetchAttempts, 1, '400 must not retry');
  assert.ok(fetchedUrls[0].includes('A%20%26%20B%20%231'), 'URL template variables must be URI-encoded');

  // 3) evaluateTrafficAlert calls invalidateCache (NOT patchCache) when meta.changes === 0
  clearSiteSettingsCache();
  const patches = [];
  const invalidations = [];
  await evaluateTrafficAlert(
    {
      DB: {
        prepare(sql) {
          return {
            bind() { return this; },
            async first() {
              if (sql.includes('site_options')) {
                return {
                  value: JSON.stringify({
                    jwt_secret: 'a'.repeat(64),
                    notification_webhook_enabled: 'true',
                    notification_webhook_url: 'https://example.com/hook',
                    traffic_alert_threshold: '80'
                  })
                };
              }
              return null;
            },
            async all() { return { results: [] }; },
            async run() { return { success: true, meta: { changes: 0 } }; }
          };
        }
      }
    },
    { id: 'srv-race', name: 'RaceBox', traffic_limit: '100', traffic_calc_type: 'total' },
    { net_rx_monthly: 90 * GB, net_tx_monthly: 0 },
    {
      patchCache: (id, v) => patches.push({ id, v }),
      invalidateCache: (id) => invalidations.push(id)
    }
  );
  assert.equal(patches.length, 0);
  assert.deepEqual(invalidations, ['srv-race']);

  // 4) checkResourceAlerts: failed notification does NOT persist active state; next minute retry succeeds and persists
  const mf = createMiniflare('track-b-problem-5b');
  try {
    const db = await mf.getD1Database('DB');
    await initDatabase(db);
    const settings = {
      jwt_secret: 'z'.repeat(64),
      tg_notify: '5',
      tg_bot_token: 'valid_bot_token',
      tg_chat_id: '10001',
      expire_reminder: '7',
      expire_notification_time: '12',
      notification_timezone: 'UTC',
      resource_alert_rules: [{ id: 'cpu_hi', metric: 'cpu', threshold: '80', intervalMinutes: '5', mode: 'average' }]
    };
    await saveSiteOptions(db, settings);
    await db.prepare('INSERT INTO servers (id, name, history_partition_id, expire_date, billing_cycle, auto_renewal, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('srv-res-1', 'Prod-DB', 1, '2026-01-31', 'month', '1', Date.UTC(2026, 0, 1)).run();

    let shouldFailSend = true;
    t.mock.method(globalThis, 'fetch', async () => {
      if (shouldFailSend) return new Response('Bad Gateway', { status: 502 });
      return new Response('{"ok":true}', { status: 200 });
    });

    const env = {
      DB: db,
      METRICS_BROADCASTER: {
        idFromName: () => 'global',
        get: () => ({
          async fetch() {
            return Response.json({
              results: [{
                ruleId: 'cpu_hi',
                format: 'compact-v1',
                metricDefinitions: [{ metric: 'cpu', mode: 'average', threshold: 80 }],
                alerts: [{
                  serverId: 'srv-res-1',
                  metrics: [{ metric: 'cpu', mode: 'average', threshold: 80, triggerValue: 95, current: 95 }]
                }],
                evaluations: []
              }]
            });
          }
        })
      }
    };

    // First run: notification fails -> resource_alert_state must NOT be persisted as active
    await checkResourceAlerts(env, { siteSettings: await loadSiteSettings(db, { forceRefresh: true }) });
    const stateAfterFail = await db.prepare("SELECT value FROM settings WHERE key = 'resource_alert_state'").first();
    assert.equal(stateAfterFail, null, 'failed notification must not persist active alert state');

    // Second run: notification succeeds -> state is persisted
    shouldFailSend = false;
    await checkResourceAlerts(env, { siteSettings: await loadSiteSettings(db) });
    const stateAfterOk = await db.prepare("SELECT value FROM settings WHERE key = 'resource_alert_state'").first();
    assert.ok(stateAfterOk);
    assert.equal(JSON.parse(stateAfterOk.value).servers['cpu_hi:srv-res-1'].status, 'active');

    // 5) checkExpiringServers: auto-renewal still runs even when sentToday === true!
    const checkNow = Date.UTC(2026, 2, 1, 12, 5, 0); // 2026-03-01 12:05 UTC
    const todaySerial = String(Math.floor(Date.UTC(2026, 2, 1) / 86400000));
    await db.prepare("INSERT INTO settings (key, value) VALUES ('expire_reminder_state', ?)")
      .bind(JSON.stringify({ date: todaySerial, sent: true })).run();
    clearAllCaches();

    await checkExpiringServers(db, { scheduled: true, now: checkNow });
    const renewedRow = await db.prepare('SELECT expire_date FROM servers WHERE id = ?').bind('srv-res-1').first();
    assert.equal(renewedRow.expire_date, '2026-03-31', 'auto-renewal must advance even when sentToday is true and preserve 31st anchor');

    // 6) checkOfflineNodes: handles corrupted "null" alert_state, prunes deleted server keys, and splits >1800 chars
    await db.prepare("INSERT INTO settings (key, value) VALUES ('alert_state', 'null') ON CONFLICT(key) DO UPDATE SET value = 'null'").run();
    for (let i = 1; i <= 80; i++) {
      await db.prepare('INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, ?, ?, ?)')
        .bind(`bulk-${i}`, `Very-Long-Production-Server-Node-Name-Number-${String(i).padStart(3, '0')}`, i + 10, Date.UTC(2026, 0, 1)).run();
    }
    clearAllCaches();

    const sentPayloads = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      sentPayloads.push(JSON.parse(options.body));
      return new Response('{"ok":true}', { status: 200 });
    });

    await checkOfflineNodes(db, { siteSettings: await loadSiteSettings(db) });
    assert.ok(sentPayloads.length >= 2, `80 long offline nodes should be chunked into >=2 messages, got ${sentPayloads.length}`);
    for (const body of sentPayloads) {
      assert.ok(body.text.length <= 2000, `each Telegram message must stay well below 4096 limit, got ${body.text.length}`);
    }

    // Add a stale deleted server key into alert_state and verify checkOfflineNodes cleans it up
    const storedOffline = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'alert_state'").first()).value);
    storedOffline['deleted-ghost-server'] = true;
    await db.prepare("UPDATE settings SET value = ? WHERE key = 'alert_state'").bind(JSON.stringify(storedOffline)).run();
    await checkOfflineNodes(db, { siteSettings: await loadSiteSettings(db) });
    const cleanedOffline = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key = 'alert_state'").first()).value);
    assert.equal(Object.hasOwn(cleanedOffline, 'deleted-ghost-server'), false);
  } finally {
    await mf.dispose();
  }

  // Direct unit check on splitNotificationEntries
  const chunks = splitNotificationEntries(
    Array.from({ length: 50 }, (_, i) => ({
      text: `Node-${i}-${'X'.repeat(80)}`,
      client: `Node-${i}`,
      item: i
    })),
    1800
  );
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.every(c => c.text.length <= 1800), true);
  assert.equal(chunks.reduce((sum, c) => sum + c.count, 0), 50);
});

test('Additional coverage: follow-up batch flush stays inside waitUntil promise, partial optimization failure skips flag, batched mutations, and corrupted sample_json tolerance', async (t) => {
  clearAllCaches();
  t.after(clearAllCaches);

  // 1) ensureServerOptimization does NOT set servers_optimized = 'true' when a row update fails
  let savedOptimized = false;
  const partialFailDb = {
    prepare(sql) {
      return {
        args: [],
        bind(...vals) { this.args = vals; return this; },
        async first() {
          if (sql.includes("key = 'site_options'")) {
            return { value: JSON.stringify({ jwt_secret: 'a'.repeat(64), servers_optimized: 'false' }) };
          }
          return null;
        },
        async all() {
          if (sql.includes('PRAGMA table_info')) {
            return { results: [{ name: 'id' }, { name: 'history_partition_id' }, { name: 'timestamp' }] };
          }
          if (sql.includes('SELECT id, history_partition_id')) {
            return { results: [{ id: 'ok-srv', history_partition_id: 0 }, { id: 'fail-srv', history_partition_id: 0 }] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('UPDATE servers SET history_partition_id') && this.args[1] === 'fail-srv') {
            throw new Error('disk full');
          }
          if (sql.includes('INSERT INTO settings') && String(this.args[1] || '').includes('"servers_optimized":"true"')) {
            savedOptimized = true;
          }
          return { success: true };
        }
      };
    }
  };
  const optRes = await ensureServerOptimization(partialFailDb);
  assert.equal(optRes.success, false);
  assert.equal(optRes.assigned, 1);
  assert.equal(optRes.failed, 1);
  assert.equal(savedOptimized, false, 'must not mark servers_optimized=true when any server fails');

  // 2) getMetricsHistory ignores corrupted sample_json rows instead of throwing 500
  const corruptedSparseDb = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return null; },
        async all() {
          if (sql.includes('sample_json')) {
            return {
              results: [
                { sample_json: '{"timestamp":1750000000000,"cpu":22.5}' },
                { sample_json: '{corrupted-json' },
                { sample_json: null }
              ]
            };
          }
          return { results: [] };
        }
      };
    }
  };
  const historyRows = await getMetricsHistory(corruptedSparseDb, 'srv-corrupt', 6, 'cpu', {
    id: 'srv-corrupt',
    history_partition_id: 1,
    timestamp: 1749990000000
  });
  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].cpu, 22.5);

  // 3) save_order batches 60 servers into chunks of <= 50 and rejects > 1000 items
  const batchSizes = [];
  const orderDb = {
    prepare() {
      return {
        bind() { return this; },
        async run() { return { success: true }; }
      };
    },
    async batch(stmts) {
      batchSizes.push(stmts.length);
      return [];
    }
  };
  const env = { API_SECRET: 'sec', DB: orderDb };
  const sys = { password: 'hashed', jwt_secret: 'q'.repeat(64) };
  const token = await generateToken(env, sys);
  const sixtyIds = Array.from({ length: 60 }, (_, i) =>
    `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`
  );

  const orderRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'save_order', orders: sixtyIds })
    }),
    env,
    sys
  );
  assert.equal(orderRes.status, 200);
  assert.deepEqual(batchSizes, [50, 10]);

  const tooManyIds = Array.from({ length: 1001 }, (_, i) =>
    `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`
  );
  const tooManyRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'batch_delete', ids: tooManyIds })
    }),
    env,
    sys
  );
  assert.equal(tooManyRes.status, 400);

  // 4) Follow-up batch flush enqueued while first /batch-push is in-flight resolves ONLY after follow-up completes
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 8, 1, 0, 0, 0) });
  t.after(() => t.mock.timers.reset());
  let pushCount = 0;
  let releaseFirstPush = null;
  const firstPushStarted = new Promise(resolve => {
    releaseFirstPush = resolve;
  });
  let finishFirstPush = null;
  const firstPushGate = new Promise(resolve => {
    finishFirstPush = resolve;
  });

  const srv1 = { id: 'srv-flush-1', name: 'F1', history_partition_id: 1, timestamp: Date.UTC(2026, 0, 1) };
  const srv2 = { id: 'srv-flush-2', name: 'F2', history_partition_id: 2, timestamp: Date.UTC(2026, 0, 1) };
  const flushDb = {
    prepare(sql) {
      return {
        args: [],
        bind(...v) { this.args = v; return this; },
        async first() {
          if (sql.includes("key = 'site_options'")) return { value: JSON.stringify({ jwt_secret: 'w'.repeat(64) }) };
          if (sql.includes('WHERE id = ?')) return this.args[0] === srv1.id ? srv1 : srv2;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; }
      };
    }
  };
  const flushEnv = {
    API_SECRET: 'sec',
    DB: flushDb,
    METRICS_BROADCASTER: {
      idFromName: () => 'global',
      get: () => ({
        async fetch(url) {
          if (String(url).includes('/batch-push')) {
            pushCount++;
            if (pushCount === 1) {
              releaseFirstPush();
              await firstPushGate;
            }
            return Response.json({ ok: true, subscribers: 1 });
          }
          return Response.json({ ok: true, subscribers: 1 });
        }
      })
    }
  };

  let waitUntilSettled = false;
  let trackedFlushPromise = null;
  await handleUpdate(
    new Request('https://monitor.example.com/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: srv1.id, secret: 'sec', metrics: { cpu: 11 } })
    }),
    flushEnv,
    {
      waitUntil(p) {
        if (!trackedFlushPromise) {
          trackedFlushPromise = p.then(() => { waitUntilSettled = true; });
        }
      }
    }
  );

  // Advance timer to trigger first flush
  t.mock.timers.tick(5500);
  await firstPushStarted;
  assert.equal(pushCount, 1);

  // Enqueue second report while first flush is in-flight!
  await handleUpdate(
    new Request('https://monitor.example.com/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: srv2.id, secret: 'sec', metrics: { cpu: 22 } })
    }),
    flushEnv,
    { waitUntil() {} }
  );

  // Finish first push: waitUntil promise must NOT settle yet because srv2 is still queued!
  finishFirstPush();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waitUntilSettled, false, 'waitUntil promise must remain pending until follow-up flush drains');

  t.mock.timers.tick(5500);
  await trackedFlushPromise;
  assert.equal(waitUntilSettled, true);
  assert.equal(pushCount, 2, 'follow-up flush must complete within the tracked waitUntil promise');
  t.mock.timers.reset();
});

test('Cross-review regressions: loadSettings _degradedColdFailure, duplicate history_partition_id self-heal, SSRF IPv4/IPv6 variants, and admin DB edge cases', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});

  // Item #1: loadSettings(db) preserves non-enumerable _degradedColdFailure === true
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
  const coldFailDb = {
    prepare() {
      return {
        async first() {
          throw new Error('D1 unavailable');
        }
      };
    }
  };
  const mergedSettings = await loadSettings(coldFailDb);
  const desc = Object.getOwnPropertyDescriptor(mergedSettings, '_degradedColdFailure');
  assert.ok(desc, 'merged loadSettings object must carry _degradedColdFailure');
  assert.equal(desc.value, true);
  assert.equal(desc.enumerable, false);
  const envForAuth = { API_SECRET: 'fallback-secret' };
  const normalJwt = await generateToken(envForAuth, {});
  assert.equal(
    await checkAuth(
      new Request('https://panel.example/admin/api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${normalJwt}` }
      }),
      envForAuth,
      mergedSettings
    ),
    false,
    'checkAuth must fail closed when loadSettings returns degraded cold-start settings'
  );
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();

  // Item #3: ensureServerOptimization self-heals duplicate positive history_partition_id even when servers_optimized='true'
  const mf = createMiniflare('audit-track-b-cross-review');
  t.after(async () => {
    clearAllCaches();
    clearSiteSettingsCache();
    await mf.dispose();
  });
  const db = await mf.getD1Database('DB');
  await initDatabase(db);
  await db.prepare('DROP TABLE IF EXISTS metrics_history').run();
  await db.prepare('DROP TABLE IF EXISTS metrics_history_old').run();
  await db.prepare('DROP INDEX IF EXISTS idx_servers_history_partition_unique').run();
  await saveSiteOptions(db, {
    servers_optimized: 'true',
    jwt_secret: 'q'.repeat(64)
  });
  const dupAUuid = '11111111-1111-4111-8111-111111111111';
  const dupBUuid = '22222222-2222-4222-8222-222222222222';
  const dupCUuid = '33333333-3333-4333-8333-333333333333';
  await db.prepare(`
    INSERT INTO servers (id, name, history_partition_id, timestamp)
    VALUES (?, 'Dup A', 5, 1700000000000), (?, 'Dup B', 5, 1700000000000)
  `).bind(dupAUuid, dupBUuid).run();

  const optRes = await ensureServerOptimization(db);
  assert.equal(optRes.success, true);
  assert.equal(optRes.assigned, 1, 'duplicate second server must be reassigned');
  const { results: dedupedRows } = await db.prepare(
    'SELECT id, history_partition_id FROM servers ORDER BY id ASC'
  ).all();
  assert.equal(dedupedRows[0].history_partition_id, 5, 'first server retains original partition id');
  assert.notEqual(dedupedRows[1].history_partition_id, 5, 'second server receives a distinct partition id');
  assert.ok(dedupedRows[1].history_partition_id > 0);
  await assert.rejects(
    () => db.prepare(
      `INSERT INTO servers (id, name, history_partition_id, timestamp) VALUES (?, 'Dup C', 5, 1700000000000)`
    ).bind(dupCUuid).run(),
    /UNIQUE constraint failed/i,
    'unique partial index must be active after deduplication'
  );

  // Item #7: isBlockedNotificationHost normalizes octal/decimal/shorthand IPv4 and blocks multicast/6to4/SIIT/NAT64 IPv6
  for (const blockedHost of [
    '0177.0.0.1',
    '2130706433',
    '127.1',
    '0x7f000001',
    'ff02::1',
    '[ff05::2]',
    '2002:7f00:1::1',
    '2002:a9fe:a9fe::1',
    '::127.0.0.1',
    '::ffff:0:127.0.0.1',
    '64:ff9b::169.254.169.254',
    '64:ff9b::a00:1'
  ]) {
    assert.equal(isBlockedNotificationHost(blockedHost), true, `expected host to be blocked: ${blockedHost}`);
  }
  assert.equal(isBlockedNotificationHost('2001:4860:4860::8888'), false);
  assert.equal(isBlockedNotificationHost('2002:0808:0808::1'), false);

  // Item #8a: admin delete succeeds even when metrics_history / metrics_history_old tables do not exist
  const sys = { jwt_secret: 'q'.repeat(64) };
  const adminEnv = { API_SECRET: 'admin-sec', DB: db };
  const adminToken = await generateToken(adminEnv, sys);
  const delRes = await handleAdminAPI(
    new Request('https://panel.example/admin/api', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: 'delete', id: dupBUuid })
    }),
    adminEnv,
    sys
  );
  assert.equal(delRes.status, 200);
  const remainingDupB = await db.prepare(`SELECT id FROM servers WHERE id = ?`).bind(dupBUuid).first();
  assert.equal(remainingDupB, null);

  // Item #8b: admin import_servers trims UUID, invalidates broadcaster, and non-batch fallback never re-runs prior inserts on error
  const invalidationPayloads = [];
  const importEnvWithDo = {
    API_SECRET: 'admin-sec',
    DB: db,
    METRICS_BROADCASTER: {
      idFromName: () => 'global',
      get: () => ({
        async fetch(req, init) {
          const url = typeof req === 'string' ? req : req.url;
          if (url.includes('/internal/invalidate')) {
            const parsed = typeof req === 'string' ? JSON.parse(init?.body || '{}') : await req.json();
            invalidationPayloads.push(parsed);
          }
          return Response.json({ ok: true });
        }
      })
    }
  };
  const paddedUuid = '  11111111-2222-4333-8444-555555555555  ';
  const waitUntilPromises = [];
  const importRes = await handleAdminAPI(
    new Request('https://panel.example/admin/api', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'import_servers',
        servers: [{ id: paddedUuid, name: 'Trimmed Node' }]
      })
    }),
    importEnvWithDo,
    sys,
    { waitUntil(p) { waitUntilPromises.push(p); } }
  );
  assert.equal(importRes.status, 200);
  await Promise.all(waitUntilPromises);
  const trimmedRow = await db.prepare(`SELECT id, name FROM servers WHERE id = ?`).bind(paddedUuid.trim()).first();
  assert.equal(trimmedRow?.id, paddedUuid.trim());
  assert.ok(
    invalidationPayloads.some(p => Array.isArray(p.updatedServerIds) && p.updatedServerIds.includes(paddedUuid.trim())),
    'import_servers must notify broadcaster invalidate with trimmed server IDs'
  );

  // Non-batch DB fallback: row 1 succeeds once, row 2 fails -> row 1 must NOT be executed a second time
  const executedInsertIds = [];
  const nonBatchDb = {
    prepare(sql) {
      return {
        args: [],
        bind(...v) {
          const next = Object.create(this);
          next.args = v;
          return next;
        },
        async all() {
          if (sql.includes('PRAGMA table_info')) {
            return { results: [{ name: 'history_partition_id' }, { name: 'timestamp' }] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("key = 'servers_optimized'")) return { value: 'true' };
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO servers')) {
            const id = this.args[0];
            executedInsertIds.push(id);
            if (id === 'bbbbbbbb-2222-4333-8444-555555555555') {
              throw new Error('simulated second row failure');
            }
          }
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
  };
  const nonBatchRes = await handleAdminAPI(
    new Request('https://panel.example/admin/api', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'import_servers',
        servers: [
          { id: 'aaaaaaaa-2222-4333-8444-555555555555', name: 'Row 1' },
          { id: 'bbbbbbbb-2222-4333-8444-555555555555', name: 'Row 2' }
        ]
      })
    }),
    { API_SECRET: 'admin-sec', DB: nonBatchDb },
    sys
  );
  const nonBatchJson = await nonBatchRes.json();
  assert.equal(nonBatchJson.imported, 1);
  assert.equal(nonBatchJson.skipped, 1);
  assert.deepEqual(nonBatchJson.skippedIds, ['bbbbbbbb-2222-4333-8444-555555555555']);
  assert.deepEqual(
    executedInsertIds,
    ['aaaaaaaa-2222-4333-8444-555555555555', 'bbbbbbbb-2222-4333-8444-555555555555'],
    'first row statement must not be re-executed when second row fails in non-batch fallback'
  );
});
