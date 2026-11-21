import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import {
  AGENT_WSS_AUTH_TIMEOUT_MS,
  MetricsBroadcaster
} from '../src/durable/MetricsBroadcaster.js';
import { serveFrontend } from '../src/handlers/frontend.js';
import { handleTheme } from '../src/handlers/theme.js';
import {
  AUTH_COOKIE_NAME,
  buildAuthCookie,
  checkAuth,
  generateToken,
  getVerifiedAuthToken,
  validateCredentials
} from '../src/middleware/auth.js';
import { hashPassword, timingSafeEqualString } from '../src/utils/common.js';
import { buildBackgroundStyle, escapeCssUrl } from '../src/utils/csp.js';
import {
  hasRecentFrontendRealtimeActivity,
  markFrontendRealtimeActive,
  resetFrontendRealtimeActivity
} from '../src/utils/realtimeBroadcastGate.js';
import { clearAppearanceSettingsCache, clearSiteSettingsCache } from '../src/utils/settings.js';

if (typeof globalThis.WebSocketRequestResponsePair === 'undefined') {
  globalThis.WebSocketRequestResponsePair = class WebSocketRequestResponsePair {
    constructor(request, response) {
      this.request = request;
      this.response = response;
    }
  };
}

class MockWebSocketEndpoint {
  constructor() {
    this.peer = null;
    this.accepted = false;
    this.closed = false;
    this.closeCode = null;
    this.closeReason = '';
    this.sent = [];
    this.attachment = null;
    this.listeners = new Map();
  }

  accept() {
    this.accepted = true;
  }

  send(data) {
    this.sent.push(data);
    if (this.peer) {
      const peerListeners = this.peer.listeners.get('message') || [];
      for (const fn of peerListeners) {
        fn({ data });
      }
    }
  }

  close(code = 1000, reason = '') {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    const closeListeners = this.listeners.get('close') || [];
    for (const fn of closeListeners) {
      fn({ code, reason });
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return this.attachment ? structuredClone(this.attachment) : null;
  }

  dispatchMessage(data) {
    const handlers = this.listeners.get('message') || [];
    for (const fn of handlers) {
      fn({ data });
    }
  }
}

function createMockWebSocketPair() {
  const client = new MockWebSocketEndpoint();
  const server = new MockWebSocketEndpoint();
  client.peer = server;
  server.peer = client;
  return { 0: client, 1: server };
}

function withMockWebSocketPair(fn) {
  const previous = globalThis.WebSocketPair;
  const createdPairs = [];
  globalThis.WebSocketPair = function WebSocketPair() {
    const pair = createMockWebSocketPair();
    createdPairs.push(pair);
    return pair;
  };
  return Promise.resolve()
    .then(() => fn(createdPairs))
    .finally(() => {
      globalThis.WebSocketPair = previous;
    });
}

function makeMemoryStorage(backingMap = new Map()) {
  return {
    backingMap,
    puts: 0,
    async get(key) {
      const val = backingMap.get(key);
      return val === undefined ? undefined : structuredClone(val);
    },
    async put(key, value) {
      this.puts += 1;
      backingMap.set(key, structuredClone(value));
    },
    async setAlarm() {}
  };
}

function makeDoState({ webSockets = [], storage = makeMemoryStorage() } = {}) {
  const hibernatedSockets = [...webSockets];
  return {
    storage,
    setWebSocketAutoResponse() {},
    acceptWebSocket(ws) {
      ws.accept();
      hibernatedSockets.push(ws);
    },
    getWebSockets() {
      return hibernatedSockets.filter(ws => !ws.closed);
    }
  };
}

function makeMockDb({ settings = {}, servers = [] } = {}) {
  const serverMap = new Map(servers.map(s => [String(s.id), { ...s }]));
  const dbObj = {
    serverMap,
    settingsQueries: 0,
    appearanceQueries: 0,
    prepare(sql) {
      const normalizedSql = String(sql || '');
      const buildStmt = (boundArgs = []) => ({
        bind(...args) {
          return buildStmt(args);
        },
        async first() {
          if (normalizedSql.includes('FROM settings')) {
            return {
              value: JSON.stringify({
                jwt_secret: 'j'.repeat(32),
                wss_report_enabled: 'true',
                ...settings
              })
            };
          }
          if (normalizedSql.includes('FROM servers')) {
            const id = String(boundArgs[0] || '');
            return serverMap.get(id) || null;
          }
          return null;
        },
        async all() {
          if (normalizedSql.includes('FROM settings')) {
            return {
              results: [{
                key: 'site_settings',
                value: JSON.stringify({
                  jwt_secret: 'j'.repeat(32),
                  wss_report_enabled: 'true',
                  ...settings
                })
              }]
            };
          }
          if (normalizedSql.includes('FROM servers') && normalizedSql.includes('is_hidden')) {
            const hiddenRows = Array.from(serverMap.values())
              .filter(s => Number(s.is_hidden || 0) === 1)
              .map(s => ({ id: s.id }));
            return { results: hiddenRows };
          }
          return { results: [] };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        }
      });
      if (normalizedSql.includes('FROM settings')) {
        dbObj.settingsQueries += 1;
      }
      if (normalizedSql.includes('appearance_options')) {
        dbObj.appearanceQueries += 1;
      }
      return buildStmt();
    }
  };
  return dbObj;
}

async function signLegacyBase64Jwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  // 保留标准 Base64 中的 + 和 /（旧版实现）
  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '');
  return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
}

test('timingSafeEqualString stays synchronous and resists length/null-padding collisions', () => {
  assert.equal(timingSafeEqualString('alpha-secret-123', 'alpha-secret-123'), true);
  assert.equal(timingSafeEqualString('alpha-secret-123', 'alpha-secret-124'), false);
  assert.equal(timingSafeEqualString('short', 'longer-secret-value'), false);
  assert.equal(timingSafeEqualString('abc', 'abc\0'), false);
  assert.equal(timingSafeEqualString('', ''), true);
  assert.equal(timingSafeEqualString(null, ''), false);
  assert.equal(timingSafeEqualString(undefined, undefined), false);

  const longA = 'k'.repeat(150) + '1';
  const longB = 'k'.repeat(150) + '2';
  assert.equal(timingSafeEqualString(longA, longA), true);
  assert.equal(timingSafeEqualString(longA, longB), false);
});

test('degraded cold-start failure fails closed in JWT and credential validation without API_SECRET fallback', async () => {
  const env = { API_SECRET: 'fallback-api-secret-should-not-be-used' };
  const degradedSys = { username: 'admin', password: '' };
  Object.defineProperty(degradedSys, '_degradedColdFailure', {
    value: true,
    enumerable: false
  });

  await assert.rejects(() => generateToken(env, degradedSys), /degraded cold failure/i);

  const normalToken = await generateToken(env, {});
  const reqWithBearer = new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: { Authorization: `Bearer ${normalToken}` }
  });
  assert.equal(await checkAuth(reqWithBearer, env, degradedSys), false);
  assert.equal(await getVerifiedAuthToken(reqWithBearer, env, degradedSys), '');

  const credResult = await validateCredentials('admin', env.API_SECRET, env, degradedSys);
  assert.deepEqual(credResult, { valid: false, needsPasswordUpgrade: false });
});

test('Base64URL JWT signing, legacy Base64 compatibility, strict exp validation, and getVerifiedAuthToken contract', async () => {
  const secret = 's'.repeat(32);
  const env = { API_SECRET: 'api-secret' };
  const sys = { jwt_secret: secret };

  const token = await generateToken(env, sys);
  assert.equal(/[+/=]/.test(token), false, 'new JWT must be strict Base64URL');

  const bearerReq = new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(await getVerifiedAuthToken(bearerReq, env, sys), token);
  assert.equal(await checkAuth(bearerReq, env, sys), true);

  const cookieHeader = buildAuthCookie(new Request('https://panel.example/'), token);
  const cookieReq = new Request('https://panel.example/admin/api', {
    method: 'GET',
    headers: { Cookie: cookieHeader }
  });
  assert.equal(await getVerifiedAuthToken(cookieReq, env, sys), token);

  // 兼容旧版标准 Base64 编码且包含有效数字 exp 的 token
  const legacyValidToken = await signLegacyBase64Jwt({
    sub: 'admin?legacy=true>>',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300
  }, secret);
  const legacyReq = new Request('https://panel.example/api/config', {
    headers: { Authorization: `Bearer ${legacyValidToken}` }
  });
  assert.equal(await checkAuth(legacyReq, env, sys), true);

  // 缺失 exp、非数字 exp、过期 exp 一律拒绝
  for (const badPayload of [
    { sub: 'admin' },
    { sub: 'admin', exp: '9999999999' },
    { sub: 'admin', exp: null },
    { sub: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }
  ]) {
    const badToken = await signLegacyBase64Jwt(badPayload, secret);
    const badReq = new Request('https://panel.example/api/config', {
      headers: { Authorization: `Bearer ${badToken}` }
    });
    assert.equal(await checkAuth(badReq, env, sys), false);
  }
});

test('Cookie CSRF guard blocks cross-site state-changing requests while preserving same-origin, allowlist, and synthetic calls', async () => {
  const env = {
    API_SECRET: 'api-secret',
    CORS_ALLOWED_ORIGINS: 'https://trusted-admin.example'
  };
  const sys = { jwt_secret: 'z'.repeat(32) };
  const token = await generateToken(env, sys);
  const cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`;

  // 1) Sec-Fetch-Site: cross-site POST -> 拒绝
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Sec-Fetch-Site': 'cross-site',
      Origin: 'https://trusted-admin.example'
    }
  }), env, sys), false);

  // 2) 异源 Origin POST -> 拒绝
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://evil.example'
    }
  }), env, sys), false);

  // 3) Origin: null (sandboxed iframe CSRF) -> 拒绝
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'null'
    }
  }), env, sys), false);

  // 4) 同源 Origin POST -> 放行
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://panel.example',
      'Sec-Fetch-Site': 'same-origin'
    }
  }), env, sys), true);

  // 5) 反向代理 X-Forwarded-Host 同源 POST -> 放行
  assert.equal(await checkAuth(new Request('http://internal/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'proxy-panel.example',
      Origin: 'https://proxy-panel.example'
    }
  }), env, sys), true);

  // 6) CORS 白名单 Origin POST -> 放行
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'https://trusted-admin.example'
    }
  }), env, sys), true);

  // 7) 无 Origin 且非 cross-site 的合成单测 POST -> 保持兼容放行
  assert.equal(await checkAuth(new Request('https://panel.example/admin/api', {
    method: 'POST',
    headers: { Cookie: cookie }
  }), env, sys), true);
});

test('validateCredentials runs PBKDF2 verification even when username mismatches', async (t) => {
  const passwordHash = await hashPassword('correct-horse-battery-staple');
  const sys = {
    username: 'real-admin',
    password: passwordHash
  };
  const env = { API_SECRET: 'unused-api-secret' };

  let deriveBitsCalls = 0;
  const origDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'deriveBits', async (...args) => {
    deriveBitsCalls += 1;
    return origDeriveBits(...args);
  });

  const wrongUser = await validateCredentials('wrong-user', 'correct-horse-battery-staple', env, sys);
  assert.deepEqual(wrongUser, { valid: false, needsPasswordUpgrade: false });
  assert.equal(deriveBitsCalls, 1, 'must execute PBKDF2 even when username does not match');

  const rightUser = await validateCredentials('real-admin', 'correct-horse-battery-staple', env, sys);
  assert.deepEqual(rightUser, { valid: true, needsPasswordUpgrade: false });
  assert.equal(deriveBitsCalls, 2);
});

test('escapeCssUrl and buildBackgroundStyle neutralize </style><script> breakouts and url() injection', () => {
  const malicious = "https://img.example/a.png\r\n\0');}</style><script>alert(\"xss\")</script>";
  const escaped = escapeCssUrl(malicious);

  assert.equal(/[\u0000-\u001f\u007f<>'"()\\]/.test(escaped.replace(/\\(5c|27|22|28|29|3c|3e) /g, '')), false);
  assert.match(escaped, /\\3c \/style\\3e \\3c script\\3e /);
  assert.match(escaped, /\\27 \\29 /);

  const styleBlock = buildBackgroundStyle(malicious, malicious);
  const innerCss = styleBlock.replace(/^<style>/, '').replace(/<\/style>$/, '');
  assert.equal(/<\/style/i.test(innerCss), false);
  assert.equal(/<script/i.test(innerCss), false);
});

test('Worker routes: /dashboard.html redirect, single /assets/* lookup, /__do/health auth+redaction, and /api/ws Turnstile gate', async (t) => {
  clearSiteSettingsCache();
  const db = makeMockDb({
    settings: {
      is_public: 'true',
      turnstile_enabled: 'true',
      turnstile_secret_key: 'ts-secret',
      jwt_secret: 'k'.repeat(32)
    }
  });

  const env = {
    API_SECRET: 'worker-api-secret',
    DB: db,
    METRICS_BROADCASTER: {
      idFromName: () => 'global',
      get: () => ({
        async fetch(input) {
          const url = typeof input === 'string' ? input : input.url;
          if (url.endsWith('/health')) {
            throw new Error('SENSITIVE_INTERNAL_DO_STACK_TRACE');
          }
          return { status: 101, headers: new Headers() };
        }
      })
    }
  };

  // 1) /dashboard.html 重定向至 /
  const dashRes = await worker.fetch(new Request('https://monitor.example/dashboard.html?view=grid'), env, {});
  assert.equal(dashRes.status, 302);
  assert.equal(dashRes.headers.get('Location'), 'https://monitor.example/?view=grid');

  // 2) 未配置远程主题时 /assets/* 404 不触发二次 loadSettings + serveFrontend
  clearSiteSettingsCache();
  clearAppearanceSettingsCache();
  db.appearanceQueries = 0;
  const assetRes = await worker.fetch(new Request('https://monitor.example/assets/app.js'), env, {});
  assert.equal(assetRes.status, 404);
  assert.equal(db.appearanceQueries, 1, 'should only execute loadSettings once for missing theme asset');

  // 3) /__do/health 未授权拒绝，授权后不泄露异常原文
  const unauthHealth = await worker.fetch(new Request('https://monitor.example/__do/health'), env, {});
  assert.equal(unauthHealth.status, 401);

  const adminToken = await generateToken(env, { jwt_secret: 'k'.repeat(32) });
  const authHealth = await worker.fetch(new Request('https://monitor.example/__do/health', {
    headers: { Authorization: `Bearer ${adminToken}` }
  }), env, {});
  assert.equal(authHealth.status, 200);
  const healthJson = await authHealth.json();
  assert.equal(healthJson.ok, false);
  assert.equal(String(healthJson.reason).includes('SENSITIVE_INTERNAL_DO_STACK_TRACE'), false);

  // 4) 开启全局 Turnstile 时未验证客户端访问 /api/ws 被拦截返回 403
  clearSiteSettingsCache();
  const blockedWs = await worker.fetch(new Request('https://monitor.example/api/ws?subscribe=all', {
    headers: { Upgrade: 'websocket' }
  }), env, {});
  assert.equal(blockedWs.status, 403);

  // 通过 /api/config 完成 Turnstile 验证后携带 turnstile_verified Cookie 可正常升级 /api/ws
  const origFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('challenges.cloudflare.com/turnstile')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (String(input).includes('api.github.com')) {
      return new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 });
    }
    return origFetch(input, init);
  });

  const configRes = await worker.fetch(new Request('https://monitor.example/api/config', {
    headers: { 'X-Turnstile-Token': 'valid-turnstile-token' }
  }), env, {});
  assert.equal(configRes.status, 200);
  const setCookie = configRes.headers.get('Set-Cookie') || '';
  assert.match(setCookie, /turnstile_verified=/);
  const cookiePair = setCookie.split(';')[0];

  const verifiedWs = await worker.fetch(new Request('https://monitor.example/api/ws?subscribe=all', {
    headers: {
      Upgrade: 'websocket',
      Cookie: cookiePair
    }
  }), env, {});
  assert.equal(verifiedWs.status, 101);

  // 已认证管理员无须 turnstile_verified 也可升级 /api/ws
  const adminWs = await worker.fetch(new Request('https://monitor.example/api/ws?subscribe=all', {
    headers: {
      Upgrade: 'websocket',
      Cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(adminToken)}`
    }
  }), env, {});
  assert.equal(adminWs.status, 101);
});

test('Upstream GitHub fetches in theme.js and frontend.js enforce 8000ms abort timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.timers.setTime(Date.UTC(2026, 5, 1, 0, 0, 0));

  let signalsObserved = 0;
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise((_resolve, reject) => {
    assert.ok(init?.signal, 'fetch must pass AbortSignal');
    signalsObserved += 1;
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    });
  }));

  const themePromise = handleTheme();
  t.mock.timers.tick(8000);
  const themeRes = await themePromise;
  assert.equal(themeRes.ok, false);

  const frontendPromise = serveFrontend(
    new Request('https://monitor.example/'),
    {},
    {
      site_title: 'CFSM',
      theme_url: 'https://github.com/owner/repo/tree/main/dist'
    }
  );
  t.mock.timers.tick(8000);
  const frontendRes = await frontendPromise;
  assert.equal(frontendRes.status, 502);
  assert.equal(signalsObserved, 2);
});

test('Agent WSS pre-auth headers, 5000ms unauthenticated timeout, pong rejection, connection cap, and duplicate eviction', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.mock.timers.setTime(Date.UTC(2026, 5, 1, 12, 0, 0));

  await withMockWebSocketPair(async (pairs) => {
    clearSiteSettingsCache();
    const db = makeMockDb({
      servers: [{ id: 'srv-1', history_partition_id: 1, report_interval: 60, wss_report_interval: 2 }]
    });
    const state = makeDoState();
    const broadcaster = new MetricsBroadcaster(state, {
      API_SECRET: 'agent-top-secret',
      DB: db
    });
    broadcaster.maxStandardAgentWebSockets = 2;

    // 1) 携带错误的 X-Agent-Secret 或 Authorization: Bearer 直接返回 401，不建连接
    const badHeaderRes = await broadcaster.fetch(new Request('http://internal/update', {
      headers: {
        Upgrade: 'websocket',
        'X-Agent-Secret': 'wrong-secret'
      }
    }));
    assert.equal(badHeaderRes.status, 401);
    assert.equal(broadcaster.standardAgentWebSockets.size, 0);

    const badBearerRes = await broadcaster.fetch(new Request('http://internal/update', {
      headers: {
        Upgrade: 'websocket',
        Authorization: 'Bearer wrong-secret'
      }
    }));
    assert.equal(badBearerRes.status, 401);
    assert.equal(broadcaster.standardAgentWebSockets.size, 0);

    // 2) 建立未认证连接 #1，5000ms 超时未认证自动以 1008 关闭并释放 DO 连接集
    const res1 = await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    assert.equal(res1.status, 101);
    const serverWs1 = pairs[0][1];
    assert.equal(broadcaster.standardAgentWebSockets.size, 1);

    t.mock.timers.tick(AGENT_WSS_AUTH_TIMEOUT_MS - 1);
    assert.equal(serverWs1.closed, false);
    t.mock.timers.tick(1);
    assert.equal(serverWs1.closed, true);
    assert.equal(serverWs1.closeCode, 1008);
    assert.equal(serverWs1.closeReason, 'Authentication timeout');
    assert.equal(broadcaster.standardAgentWebSockets.size, 0);

    // 3) 未认证前发送 pong 立即拒绝，禁止靠 pong 续命
    const resPong = await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    assert.equal(resPong.status, 101);
    const serverWsPong = pairs[1][1];
    serverWsPong.dispatchMessage(JSON.stringify({ type: 'pong' }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(serverWsPong.closed, true);
    assert.equal(serverWsPong.closeCode, 1008);
    assert.equal(broadcaster.standardAgentWebSockets.size, 0);

    // 4) 携带正确 X-Agent-Secret 的连接认证成为 srv-1，随后同 serverId 新连接认证时主动驱逐旧僵尸连接
    const resAuthOld = await broadcaster.fetch(new Request('http://internal/update', {
      headers: {
        Upgrade: 'websocket',
        'X-Agent-Secret': 'agent-top-secret'
      }
    }));
    assert.equal(resAuthOld.status, 101);
    const oldServerWs = pairs[2][1];
    oldServerWs.dispatchMessage(JSON.stringify({
      id: 'srv-1',
      metrics: { cpu: 15 }
    }));
    await new Promise(r => setImmediate(r));
    assert.equal(oldServerWs.closed, false);
    assert.equal(broadcaster.standardAgentWebSockets.size, 1);

    // 超过 5000ms 后已认证连接不会被认证超时误杀
    t.mock.timers.tick(AGENT_WSS_AUTH_TIMEOUT_MS + 1000);
    assert.equal(oldServerWs.closed, false);

    const resAuthNew = await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    assert.equal(resAuthNew.status, 101);
    const newServerWs = pairs[3][1];
    newServerWs.dispatchMessage(JSON.stringify({
      id: 'srv-1',
      secret: 'agent-top-secret',
      metrics: { cpu: 25 }
    }));
    await new Promise(r => setImmediate(r));
    assert.equal(oldServerWs.closed, true, 'old duplicate connection for srv-1 must be closed');
    assert.equal(oldServerWs.closeCode, 1008);
    assert.equal(newServerWs.closed, false);
    assert.equal(broadcaster.standardAgentWebSockets.size, 1);

    // 5) 连接上限保护：再加一条 srv-2 已认证连接填满上限 2，第 3 条请求返回 503
    db.serverMap.set('srv-2', { id: 'srv-2', history_partition_id: 2, report_interval: 60, wss_report_interval: 2 });
    await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    const srv2Ws = pairs[4][1];
    srv2Ws.dispatchMessage(JSON.stringify({
      id: 'srv-2',
      secret: 'agent-top-secret',
      metrics: { cpu: 30 }
    }));
    await new Promise(r => setImmediate(r));
    assert.equal(broadcaster.standardAgentWebSockets.size, 2);

    const overCapRes = await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    assert.equal(overCapRes.status, 503);
  });
});

test('Standard Agent WebSocket serializes concurrent messages to prevent attachment races', async () => {
  const broadcaster = new MetricsBroadcaster(makeDoState(), { DB: makeMockDb() });
  const endpoint = new MockWebSocketEndpoint();
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  const observedAttachments = [];

  broadcaster._handleAgentReportMessage = async (ws, rawMessage, attachment) => {
    const parsed = JSON.parse(rawMessage);
    observedAttachments.push({ seq: parsed.seq, seenStep: attachment.step || 0 });
    if (parsed.seq === 1) {
      await firstGate;
    }
    ws.serializeAttachment({ ...attachment, authenticated: true, step: parsed.seq });
  };

  const wrappedWs = broadcaster._acceptStandardAgentWebSocket(endpoint, {
    kind: 'agent-report',
    authenticated: false,
    step: 0
  });

  endpoint.dispatchMessage(JSON.stringify({ seq: 1 }));
  endpoint.dispatchMessage(JSON.stringify({ seq: 2 }));

  await Promise.resolve();
  assert.equal(observedAttachments.length, 1, 'second message must wait for first message promise');

  releaseFirst();
  await new Promise(r => setImmediate(r));

  assert.deepEqual(observedAttachments, [
    { seq: 1, seenStep: 0 },
    { seq: 2, seenStep: 1 }
  ]);
  assert.equal(wrappedWs.deserializeAttachment().step, 2);
  wrappedWs.close(1000, 'done');
});

test('WebSocket Origin validation blocks cross-origin requests even when CORS_ALLOWED_ORIGINS is empty', async () => {
  await withMockWebSocketPair(async () => {
    clearSiteSettingsCache();
    const broadcaster = new MetricsBroadcaster(makeDoState(), {
      API_SECRET: 'secret',
      CORS_ALLOWED_ORIGINS: '',
      DB: makeMockDb()
    });

    // 异源 Origin 访问 /ws -> 403
    const evilWs = await broadcaster.fetch(new Request('http://internal/ws?subscribe=all', {
      headers: {
        Upgrade: 'websocket',
        'X-Real-Origin': 'https://monitor.example',
        Origin: 'https://attacker.example'
      }
    }));
    assert.equal(evilWs.status, 403);

    // 异源 Origin 访问 /update -> 403
    const evilAgentWs = await broadcaster.fetch(new Request('http://internal/update', {
      headers: {
        Upgrade: 'websocket',
        'X-Real-Origin': 'https://monitor.example',
        Origin: 'https://attacker.example'
      }
    }));
    assert.equal(evilAgentWs.status, 403);

    // 同源 Origin 访问 /ws -> 101，且绝不返回 Access-Control-Allow-Origin: *
    const sameOriginWs = await broadcaster.fetch(new Request('http://internal/ws?subscribe=all', {
      headers: {
        Upgrade: 'websocket',
        'X-Real-Origin': 'https://monitor.example',
        Origin: 'https://monitor.example'
      }
    }));
    assert.equal(sameOriginWs.status, 101);
    assert.notEqual(sameOriginWs.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(sameOriginWs.headers.get('Access-Control-Allow-Origin'), 'https://monitor.example');
  });
});

test('Hidden server isolation in subscribe replay and realtime _broadcastBatch between public and admin subscribers', async () => {
  await withMockWebSocketPair(async (pairs) => {
    const db = makeMockDb({
      servers: [
        { id: 'pub-1', is_hidden: 0, history_partition_id: 1 },
        { id: 'hid-1', is_hidden: 1, history_partition_id: 2 }
      ]
    });
    const state = makeDoState();
    const broadcaster = new MetricsBroadcaster(state, {
      API_SECRET: 'secret',
      DB: db
    });

    // 预注入最新上报缓存（包含公网 IPv4 的公开节点与隐藏节点）
    broadcaster._cacheLatestReportUpdates([
      { serverId: 'pub-1', samples: [{ ts: 1000, data: { cpu: 11, ip_v4: '203.0.113.5' } }] },
      { serverId: 'hid-1', samples: [{ ts: 1000, data: { cpu: 99, ip_v4: '198.51.100.8' } }] }
    ], Date.now());

    // 1) 普通访客连接 (X-CFSM-Admin: 0)
    await broadcaster.fetch(new Request('http://internal/ws?subscribe=all', {
      headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '0' }
    }));
    const publicSocket = pairs[0][1];

    // 2) 管理员连接 (X-CFSM-Admin: 1)
    await broadcaster.fetch(new Request('http://internal/ws?subscribe=all', {
      headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '1' }
    }));
    const adminSocket = pairs[1][1];

    // 双方均尝试订阅 ['pub-1', 'hid-1']
    await broadcaster.webSocketMessage(publicSocket, JSON.stringify({
      type: 'subscribe',
      scope: 'all',
      ids: ['pub-1', 'hid-1']
    }));
    await broadcaster.webSocketMessage(adminSocket, JSON.stringify({
      type: 'subscribe',
      scope: 'all',
      ids: ['pub-1', 'hid-1']
    }));

    const publicSubscribed = JSON.parse(publicSocket.sent[1]);
    const publicReplay = JSON.parse(publicSocket.sent[2]);
    assert.equal(publicSubscribed.count, 1, 'public subscriber hidden id must be stripped');
    assert.deepEqual(publicReplay.updates.map(u => u.serverId), ['pub-1']);
    assert.equal(publicReplay.updates[0].samples[0].data.ip_v4, '1');

    const adminSubscribed = JSON.parse(adminSocket.sent[1]);
    const adminReplay = JSON.parse(adminSocket.sent[2]);
    assert.equal(adminSubscribed.count, 2);
    assert.deepEqual(adminReplay.updates.map(u => u.serverId), ['pub-1', 'hid-1']);
    assert.equal(adminReplay.updates[1].samples[0].data.ip_v4, '198.51.100.8');

    // 实时批量广播：公开订阅者收不到 hid-1，管理员正常收到
    publicSocket.sent.length = 0;
    adminSocket.sent.length = 0;

    const pushRes = await broadcaster.fetch(new Request('http://internal/batch-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { serverId: 'pub-1', isHidden: false, samples: [{ ts: 2000, data: { cpu: 22, ip_v4: '203.0.113.5' } }] },
          { serverId: 'hid-1', isHidden: true, samples: [{ ts: 2000, data: { cpu: 88, ip_v4: '198.51.100.8' } }] }
        ]
      })
    }));
    const pushBody = await pushRes.json();
    assert.equal(pushBody.ok, true);
    assert.equal(pushBody.subscribers, 2);

    assert.equal(publicSocket.sent.length, 1);
    const pubBatch = JSON.parse(publicSocket.sent[0]);
    assert.deepEqual(pubBatch.updates.map(u => u.serverId), ['pub-1']);
    assert.equal(pubBatch.updates[0].samples[0].data.ip_v4, '1');

    assert.equal(adminSocket.sent.length, 1);
    const admBatch = JSON.parse(adminSocket.sent[0]);
    assert.deepEqual(admBatch.updates.map(u => u.serverId), ['pub-1', 'hid-1']);
    assert.equal(admBatch.updates[1].samples[0].data.ip_v4, '198.51.100.8');
  });
});

test('DO hibernation preserves resourceAlertCacheActiveUntil and flushes alert windows immediately when no standard Agent WSS exists', async () => {
  const sharedBacking = new Map();
  const storage1 = makeMemoryStorage(sharedBacking);
  const now = Date.now();
  const minute0 = Math.floor(now / 60_000) * 60_000 - 60_000;
  const minute1 = minute0 + 60_000;

  // 实例 1：无标准 Agent WSS，收到 maintainState: true 的 /batch-push
  const broadcaster1 = new MetricsBroadcaster(makeDoState({ storage: storage1 }), {
    DB: makeMockDb()
  });

  const push1 = await broadcaster1.fetch(new Request('http://internal/batch-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maintainState: true,
      updates: [{
        serverId: 'srv-alert',
        samples: [{
          ts: minute0,
          payload: { cpu: 95, ram_total: 100, ram_used: 50, disk_total: 100, disk_used: 30 }
        }]
      }]
    })
  }));
  const push1Json = await push1.json();
  assert.equal(push1Json.ok, true);
  assert.equal(push1Json.subscribers, 0);
  assert.ok(broadcaster1.resourceAlertCacheActiveUntil > now);
  assert.ok(storage1.puts >= 1, 'must persist immediately when standardAgentWebSockets.size === 0');

  // 实例 2：模拟 DO 休眠后唤醒（新实例读取同一持久化 storage），且第二包不带 maintainState 也能靠已恢复的 activeUntil 继续采样
  const storage2 = makeMemoryStorage(sharedBacking);
  const broadcaster2 = new MetricsBroadcaster(makeDoState({ storage: storage2 }), {
    DB: makeMockDb()
  });
  await broadcaster2._ensureResourceAlertSnapshotLoaded();
  assert.equal(broadcaster2.resourceAlertCacheActiveUntil, broadcaster1.resourceAlertCacheActiveUntil);
  assert.equal(broadcaster2.resourceAlertWindows.get('srv-alert')?.samples.length, 1);

  await broadcaster2._ingestRealtimeUpdates([{
    serverId: 'srv-alert',
    samples: [{
      ts: minute1,
      payload: { cpu: 96, ram_total: 100, ram_used: 50, disk_total: 100, disk_used: 30 }
    }]
  }], minute1);

  // 实例 3：再次模拟休眠唤醒后执行 Cron /evaluate-resource-alerts，验证两个分钟桶均完好并触发告警
  const broadcaster3 = new MetricsBroadcaster(makeDoState({ storage: makeMemoryStorage(sharedBacking) }), {
    DB: makeMockDb()
  });
  const evalRes = await broadcaster3.fetch(new Request('http://internal/evaluate-resource-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rules: [{
        ruleId: 'high-cpu',
        serverIds: ['srv-alert'],
        mode: 'average',
        windowMinutes: 5,
        thresholds: { cpuPercent: 80 }
      }]
    })
  }));
  const evalBody = await evalRes.json();
  assert.equal(evalBody.results[0].alerts.length, 1);
  assert.equal(evalBody.results[0].alerts[0].serverId, 'srv-alert');
});

test('POST /internal/invalidate and saveMetricsHistory { ok: false } contract', async () => {
  await withMockWebSocketPair(async (pairs) => {
    clearSiteSettingsCache();
    const db = makeMockDb({
      servers: [
        { id: 'del-1', is_hidden: 1, history_partition_id: 1, report_interval: 60, wss_report_interval: 2 },
        { id: 'upd-1', is_hidden: 0, history_partition_id: 2, report_interval: 60, wss_report_interval: 2 }
      ]
    });
    const storage = makeMemoryStorage();
    const broadcaster = new MetricsBroadcaster(makeDoState({ storage }), {
      API_SECRET: 'secret',
      DB: db
    });

    // 建立 del-1 与 upd-1 的已认证 Agent WSS 连接
    await broadcaster.fetch(new Request('http://internal/update', { headers: { Upgrade: 'websocket' } }));
    const delWs = pairs[0][1];
    delWs.dispatchMessage(JSON.stringify({ id: 'del-1', secret: 'secret', config_schema: 7, config_md5: 'none', metrics: { cpu: 10 } }));

    await broadcaster.fetch(new Request('http://internal/update', { headers: { Upgrade: 'websocket' } }));
    const updWs = pairs[1][1];
    updWs.dispatchMessage(JSON.stringify({ id: 'upd-1', secret: 'secret', config_schema: 7, config_md5: 'none', metrics: { cpu: 20 } }));
    await new Promise(r => setImmediate(r));

    broadcaster.resourceAlertWindows.set('del-1', { samples: [{ ts: Date.now(), minuteTs: Math.floor(Date.now() / 60000) * 60000, cpu: 80 }] });
    broadcaster.latestReportUpdates.set('del-1', { serverId: 'del-1', reportTs: Date.now(), samples: [{ ts: 1, data: { cpu: 1 } }] });

    // 修改数据库：upd-1 变为隐藏节点，同时触发 /internal/invalidate
    db.serverMap.set('upd-1', {
      id: 'upd-1',
      is_hidden: 1,
      history_partition_id: 2,
      report_interval: 120,
      wss_report_interval: 4
    });

    const invRes = await broadcaster.fetch(new Request('http://internal/internal/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deletedServerIds: ['del-1'],
        updatedServerIds: ['upd-1'],
        refreshSettings: true
      })
    }));
    const invBody = await invRes.json();
    assert.equal(invBody.ok, true);
    assert.equal(invBody.deleted, 1);
    assert.equal(invBody.updated, 1);
    assert.equal(delWs.closed, true);
    assert.equal(delWs.closeCode, 1008);
    assert.equal(delWs.closeReason, 'Server deleted');
    assert.equal(broadcaster.agentServerDetails.has('del-1'), false);
    assert.equal(broadcaster.latestReportUpdates.has('del-1'), false);
    assert.equal(broadcaster.resourceAlertWindows.has('del-1'), false);
    assert.equal(broadcaster._isServerHidden('upd-1'), true);
    assert.ok(updWs.sent.some(raw => JSON.parse(raw).type === 'config'), 'refreshSettings should push updated config frame');
  });

  // 验证 saveMetricsHistory 返回 { ok: false, error } 时抛错并保留 pendingHistoryAggregate
  let failWrite = true;
  const savedArgs = [];
  const flakyDb = {
    prepare() {
      return {
        bind(...args) {
          return {
            async run() {
              savedArgs.push(args);
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  const broadcaster2 = new MetricsBroadcaster(makeDoState(), { DB: flakyDb });
  const origSaveHistory = broadcaster2._saveAgentMetricsHistory.bind(broadcaster2);
  broadcaster2._saveAgentMetricsHistory = async (...args) => {
    if (failWrite) {
      return { ok: false, error: 'D1_WRITE_FAILED' };
    }
    return origSaveHistory(...args);
  };
  let att = { reportIntervalMs: 60_000, lastD1WriteTs: 0 };
  const mockWs = {
    deserializeAttachment: () => att,
    serializeAttachment: (v) => { att = v; }
  };

  await assert.rejects(() => broadcaster2._persistAgentHistoryIfDue(mockWs, att, {
    serverId: 'srv-flaky',
    historyPartitionId: 1,
    metrics: { cpu: 80, net_in_speed: 99_000_000, net_out_speed: 1000 },
    regionCode: 'US',
    timestamp: Date.now(),
    agentVersion: '1.0.0',
    reportIntervalMs: 60_000
  }), /D1_WRITE_FAILED/);

  const retained = broadcaster2.agentHistoryWrites.get('srv-flaky')?.pendingHistoryAggregate;
  assert.ok(retained, 'pendingHistoryAggregate must be retained after failed write');
  assert.equal(retained.max.net_in_speed, 99_000_000);

  // 恢复 D1 写入后，先前失败保留的峰值样本一并合并写入
  failWrite = false;
  const retryRes = await broadcaster2._persistAgentHistoryIfDue(mockWs, att, {
    serverId: 'srv-flaky',
    historyPartitionId: 1,
    metrics: { cpu: 20, net_in_speed: 1000, net_out_speed: 2000 },
    regionCode: 'US',
    timestamp: Date.now() + 2000,
    agentVersion: '1.0.0',
    reportIntervalMs: 60_000
  });
  assert.equal(retryRes.persisted, true);
  assert.equal(savedArgs.length, 1);
  assert.equal(savedArgs[0][4], 50); // avg(80, 20) = 50
  assert.equal(savedArgs[0][6], 99_000_000); // max(99_000_000, 1000)
});

test('realtimeBroadcastGate handles non-finite timestamps and zero baseline safely', () => {
  resetFrontendRealtimeActivity();
  assert.equal(hasRecentFrontendRealtimeActivity(0), false);
  markFrontendRealtimeActive(10_000);
  assert.equal(hasRecentFrontendRealtimeActivity(10_500), true);
  markFrontendRealtimeActive(Number.NaN);
  assert.equal(hasRecentFrontendRealtimeActivity(10_500), true);
  resetFrontendRealtimeActivity();
  assert.equal(hasRecentFrontendRealtimeActivity(10_500), false);
});

test('Cross-review regressions: MetricsBroadcaster D1 write error isolation, clampMetricTimestamp, mixed-case/hidden single-scope guard, and traffic alert invalidateCache', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});

  await withMockWebSocketPair(async (pairs) => {
    clearSiteSettingsCache();
    const now = Date.now();
    const farFutureTs = now + 3600_000;
    const db = makeMockDb({
      servers: [
        { id: 'Pub-Mixed-1', is_hidden: 0, history_partition_id: 1, report_interval: 60, wss_report_interval: 2 },
        { id: 'Hid-Mixed-2', is_hidden: 1, history_partition_id: 2, report_interval: 60, wss_report_interval: 2 }
      ]
    });
    const waitUntilTasks = [];
    const baseState = makeDoState();
    baseState.waitUntil = (p) => { waitUntilTasks.push(p); };
    const broadcaster = new MetricsBroadcaster(baseState, {
      API_SECRET: 'secret',
      DB: db
    });

    // Item #2 & #4: Agent WSS survives D1 history write failure (persisted: false, no 1008 kick) and clamps future timestamps
    let failD1History = true;
    const origSave = broadcaster._saveAgentMetricsHistory.bind(broadcaster);
    broadcaster._saveAgentMetricsHistory = async (...args) => {
      if (failD1History) {
        return { ok: false, error: 'SIMULATED_D1_OUTAGE' };
      }
      return origSave(...args);
    };

    const wsUpgrade = await broadcaster.fetch(new Request('http://internal/update', {
      headers: { Upgrade: 'websocket' }
    }));
    assert.equal(wsUpgrade.status, 101);
    const agentWs = pairs[0][1];
    agentWs.dispatchMessage(JSON.stringify({
      id: 'Pub-Mixed-1',
      secret: 'secret',
      metrics: { cpu: 77, sample_timestamp: farFutureTs }
    }));
    await new Promise(r => setImmediate(r));

    assert.equal(agentWs.closed, false, 'Agent WSS must stay open when D1 history persistence fails');
    const ackFrame = agentWs.sent.map(raw => JSON.parse(raw)).find(f => f.type === 'ack');
    assert.ok(ackFrame, 'Agent WSS must still receive an ack frame');
    assert.equal(ackFrame.persisted, false);
    assert.ok(ackFrame.nextD1WriteAfterMs <= 10_000);
    assert.ok(broadcaster.agentHistoryWrites.get('Pub-Mixed-1')?.pendingHistoryAggregate);

    const cachedAgentLatest = broadcaster.latestReportUpdates.get('Pub-Mixed-1');
    assert.ok(cachedAgentLatest);
    assert.ok(
      cachedAgentLatest.samples[0].ts <= Date.now() + 5000,
      'future-drifted WSS sample timestamp must be clamped near server now'
    );
    failD1History = false;

    // Item #4: /batch-push + resourceAlertWindows clamp far-future sample timestamps
    const batchRes = await broadcaster.fetch(new Request('http://internal/batch-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maintainState: true,
        updates: [{
          serverId: 'Pub-Mixed-1',
          isHidden: false,
          samples: [{
            ts: farFutureTs,
            payload: { cpu: 88, ip_v4: '203.0.113.9', ram_total: 100, ram_used: 50, disk_total: 100, disk_used: 20 }
          }]
        }]
      })
    }));
    assert.equal(batchRes.status, 200);
    const clampedWindow = broadcaster.resourceAlertWindows.get('Pub-Mixed-1');
    assert.ok(clampedWindow && clampedWindow.samples.length >= 1);
    assert.ok(
      clampedWindow.samples[clampedWindow.samples.length - 1].ts <= Date.now() + 5000,
      'resourceAlertWindows sample ts must be clamped via clampMetricTimestamp'
    );

    // Item #5a: Mixed-case public single-server scope preserves case and receives replay + broadcast
    const pubSingleRes = await broadcaster.fetch(new Request('http://internal/ws?subscribe=Pub-Mixed-1', {
      headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '0' }
    }));
    assert.equal(pubSingleRes.status, 101);
    const pubSingleWs = pairs[1][1];
    const helloFrame = JSON.parse(pubSingleWs.sent[0]);
    assert.equal(helloFrame.subscribed, 'Pub-Mixed-1');

    await broadcaster.webSocketMessage(pubSingleWs, JSON.stringify({
      type: 'subscribe',
      scope: 'Pub-Mixed-1',
      ids: []
    }));
    const subscribedFrame = JSON.parse(pubSingleWs.sent[1]);
    const replayFrame = JSON.parse(pubSingleWs.sent[2]);
    assert.equal(subscribedFrame.subscribed, 'Pub-Mixed-1');
    assert.equal(replayFrame.updates[0].serverId, 'Pub-Mixed-1');
    assert.equal(replayFrame.updates[0].samples[0].data.ip_v4, '1');

    // Item #5b: Non-admin single-server handshake & subscribe block hidden servers (including case-variants)
    const hidHandshakeExact = await broadcaster.fetch(new Request('http://internal/ws?subscribe=Hid-Mixed-2', {
      headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '0' }
    }));
    assert.equal(hidHandshakeExact.status, 403);
    const hidHandshakeLower = await broadcaster.fetch(new Request('http://internal/ws?subscribe=hid-mixed-2', {
      headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '0' }
    }));
    assert.equal(hidHandshakeLower.status, 403);

    await broadcaster.webSocketMessage(pubSingleWs, JSON.stringify({
      type: 'subscribe',
      scope: 'Hid-Mixed-2',
      ids: []
    }));
    assert.equal(pubSingleWs.closed, true);
    assert.equal(pubSingleWs.closeCode, 1008);

    // Item #5c: Initial hidden-server DB failure fails closed for non-admin single-scope while allowing admin
    const brokenHiddenDb = {
      prepare() {
        return {
          async all() {
            throw new Error('D1 hidden query failed');
          }
        };
      }
    };
    const failClosedBroadcaster = new MetricsBroadcaster(makeDoState(), { DB: brokenHiddenDb });
    const nonAdminUnknownVis = await failClosedBroadcaster.fetch(
      new Request('http://internal/ws?subscribe=Pub-Mixed-1', {
        headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '0' }
      })
    );
    assert.equal(nonAdminUnknownVis.status, 403);
    const adminUnknownVis = await failClosedBroadcaster.fetch(
      new Request('http://internal/ws?subscribe=Pub-Mixed-1', {
        headers: { Upgrade: 'websocket', 'X-CFSM-Admin': '1' }
      })
    );
    assert.equal(adminUnknownVis.status, 101);

    // Item #6: MetricsBroadcaster passes invalidateCache to evaluateTrafficAlert when CAS meta.changes === 0
    clearSiteSettingsCache();
    t.mock.method(globalThis, 'fetch', async () => new Response('ok', { status: 200 }));
    const casZeroDb = {
      prepare(sql) {
        const s = String(sql || '');
        return {
          bind() { return this; },
          async first() {
            if (s.includes('FROM settings')) {
              return {
                value: JSON.stringify({
                  jwt_secret: 'a'.repeat(64),
                  notification_webhook_enabled: 'true',
                  notification_webhook_url: 'https://example.com/hook'
                })
              };
            }
            return null;
          },
          async all() { return { results: [] }; },
          async run() {
            if (s.includes('UPDATE servers') && s.includes('traffic_alert_state')) {
              return { success: true, meta: { changes: 0 } };
            }
            return { success: true, meta: { changes: 1 } };
          }
        };
      }
    };
    const casTasks = [];
    const casState = makeDoState();
    casState.waitUntil = (p) => { casTasks.push(p); };
    const casBroadcaster = new MetricsBroadcaster(casState, { DB: casZeroDb });
    casBroadcaster._saveAgentMetricsHistory = async () => ({ ok: true });
    casBroadcaster.agentServerDetails.set('srv-cas', {
      time: Date.now(),
      data: {
        id: 'srv-cas',
        name: 'CAS Node',
        traffic_limit: 10, // 10 GB
        traffic_alert_percent: 80,
        traffic_alert_state: null
      }
    });
    let casAtt = { reportIntervalMs: 60_000, lastD1WriteTs: 0 };
    const casWs = {
      deserializeAttachment: () => casAtt,
      serializeAttachment: (v) => { casAtt = v; }
    };
    await casBroadcaster._persistAgentHistoryIfDue(casWs, casAtt, {
      serverId: 'srv-cas',
      historyPartitionId: 1,
      metrics: { cpu: 10, net_rx_monthly: 9 * 1024 ** 3, net_tx_monthly: 0 },
      regionCode: 'US',
      timestamp: Date.now(),
      agentVersion: '1.0.0',
      reportIntervalMs: 60_000
    });
    await Promise.all(casTasks);
    assert.equal(
      casBroadcaster.agentServerDetails.has('srv-cas'),
      false,
      'invalidateCache must purge stale agentServerDetails when traffic_alert_state CAS returns changes === 0'
    );
  });
});
