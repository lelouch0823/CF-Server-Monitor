import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

process.env.VITE_DISABLE_MKCERT = '1'

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.listeners = new Map()
    this.sent = []
    this.closeCalls = []
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(handler)
  }

  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      handler(event)
    }
  }

  send(message) {
    this.sent.push(message)
  }

  close(code, reason = '') {
    this.closeCalls.push({ code, reason })
    this.emit('close', { code, reason })
  }
}

let vite = null

test.before(async () => {
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, val) {
      this.store.set(key, String(val))
    },
    removeItem(key) {
      this.store.delete(key)
    },
    clear() {
      this.store.clear()
    }
  }
  globalThis.sessionStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.has(key) ? this.store.get(key) : null
    },
    setItem(key, val) {
      this.store.set(key, String(val))
    },
    removeItem(key) {
      this.store.delete(key)
    },
    clear() {
      this.store.clear()
    }
  }
  globalThis.window = {
    location: {
      origin: 'https://monitor.example',
      protocol: 'https:',
      host: 'monitor.example',
      pathname: '/',
      search: '',
      hash: '#/'
    },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  }
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }

  vite = await createServer({
    appType: 'custom',
    logLevel: 'silent',
    server: {
      middlewareMode: true,
      https: false
    }
  })
})

test.after(async () => {
  if (vite) {
    await vite.close()
  }
})

test('formatBytes handles carry boundaries, YB units, extreme values, and gbToBytes overflow safety', async () => {
  const { formatBytes, gbToBytes, mibToBytes } = await vite.ssrLoadModule('/src/frontend/utils/api.js')

  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-1024), '0 B')
  assert.equal(formatBytes(NaN), '0 B')
  assert.equal(formatBytes(Infinity), '0 B')
  assert.equal(formatBytes(-Infinity), '0 B')
  assert.equal(formatBytes('Infinity'), '0 B')
  assert.equal(formatBytes(null), '0 B')
  assert.equal(formatBytes(undefined), '0 B')
  assert.equal(formatBytes(''), '0 B')
  assert.equal(formatBytes(false), '0 B')

  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1023.99), '1.0 KB')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1048575.99), '1.0 MB')
  assert.equal(formatBytes(1024 ** 3 - 0.01), '1.0 GB')

  assert.equal(formatBytes(1024 ** 4), '1.0 TB')
  assert.equal(formatBytes(1024 ** 5), '1.0 PB')
  assert.equal(formatBytes(1024 ** 6), '1.0 EB')
  assert.equal(formatBytes(1024 ** 7), '1.0 ZB')
  assert.equal(formatBytes(1024 ** 8), '1.0 YB')
  assert.equal(formatBytes(9999 * (1024 ** 8)), '9999.0 YB')
  assert.equal(formatBytes(10000 * (1024 ** 8)), '>9999 YB')
  assert.equal(formatBytes(Number.MAX_VALUE), '>9999 YB')

  // Huge traffic_limit (in GB) or disk_total (in MiB) must not overflow to Infinity -> '0 B'
  assert.equal(formatBytes(gbToBytes(1e305)), '>9999 YB')
  assert.equal(formatBytes(mibToBytes(1e306)), '>9999 YB')
  assert.equal(gbToBytes(-10), 0)
  assert.equal(mibToBytes('invalid'), 0)
})

test('resolveLocalizedPingName localizes default node names while preserving custom names', async () => {
  const { resolveLocalizedPingName, BUILTIN_PING_NODE_DEFAULTS } = await vite.ssrLoadModule('/src/frontend/utils/pingNode.js')
  const i18n = await vite.ssrLoadModule('/src/frontend/utils/i18n.js')
  const { useServerCardData } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js')

  assert.equal(resolveLocalizedPingName('电信', BUILTIN_PING_NODE_DEFAULTS.ct, 'CT'), 'CT')
  assert.equal(resolveLocalizedPingName('  ', BUILTIN_PING_NODE_DEFAULTS.cu, 'CU'), 'CU')
  assert.equal(resolveLocalizedPingName(null, BUILTIN_PING_NODE_DEFAULTS.node_1, '节点 1'), '节点 1')
  assert.equal(resolveLocalizedPingName('上海电信 CN2', BUILTIN_PING_NODE_DEFAULTS.ct, 'CT'), '上海电信 CN2')
  assert.equal(resolveLocalizedPingName('Tokyo GIA', BUILTIN_PING_NODE_DEFAULTS.node_1, 'Node 1'), 'Tokyo GIA')

  await i18n.setLanguage('en')
  const cardEn = useServerCardData({
    server: {
      name: 'Node-A',
      ping_ct: 32,
      ping_cu: 45,
      ping_cm: 50,
      ping_node_1: 18,
      node_1_name: 'WRONG_SERVER_FIELD'
    },
    sysConfig: {
      custom_ct_name: '电信',
      custom_cu_name: '广州联通',
      custom_cm_name: '',
      node_1_name: '新加坡探针'
    }
  })

  assert.equal(cardEn.threeNetDetails.value[0].label, 'CT')
  assert.equal(cardEn.threeNetDetails.value[1].label, '广州联通')
  assert.equal(cardEn.threeNetDetails.value[2].label, 'CM')
  const node1PingItem = cardEn.pingList.value.find(item => item.key === 'node_1')
  assert.equal(node1PingItem?.label, '新加坡探针')

  await i18n.setLanguage('zh')
  assert.equal(cardEn.threeNetDetails.value[0].label, '电信')
  assert.equal(cardEn.threeNetDetails.value[2].label, '移动')
})

test('three-net latency buckets enforce 60-cap, timestamp alignment, right-aligned unmeasured slots vs offline red bars, and tooltip shifts', async () => {
  const {
    MAX_LATENCY_RENDER_BUCKETS,
    UNMEASURED_BUCKET_COLOR,
    useServerCardData
  } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js')

  assert.equal(MAX_LATENCY_RENDER_BUCKETS, 60)

  // 1) 300 buckets cap and compact flag
  const baseTs = 1720000000000
  const hugePing = Array.from({ length: 300 }, (_, i) => ({
    ts: baseTs + i * 60_000,
    ct: 10 + (i % 50)
  }))
  const hugeLoss = Array.from({ length: 300 }, (_, i) => ({
    ts: baseTs + i * 60_000,
    ct: 0
  }))
  const cappedCard = useServerCardData({
    server: { ping: hugePing, loss: hugeLoss, ping_ct: 35, loss_ct: 0 },
    sysConfig: { latency_window: { points: 300, hours: 2 } }
  })
  const cappedRow = cappedCard.threeNetDetails.value[0]
  assert.equal(cappedRow.points.length, 60)
  assert.equal(cappedRow.isCompact, true)
  assert.equal(cappedRow.points.at(-1).timestamp, baseTs + 299 * 60_000)
  assert.equal(cappedRow.points[0].tooltipShift, '+36px')
  assert.equal(cappedRow.points[1].tooltipShift, '+24px')
  assert.equal(cappedRow.points[2].tooltipShift, '+12px')
  assert.equal(cappedRow.points[57].tooltipShift, '-12px')
  assert.equal(cappedRow.points[58].tooltipShift, '-24px')
  assert.equal(cappedRow.points[59].tooltipShift, '-36px')
  assert.equal(cappedRow.points[30].tooltipShift, '0px')

  // 2) Timestamp merge alignment + unmeasured left gray slots + genuine offline red slot
  const t1 = 1720000060000
  const t2 = 1720000120000
  const t3 = 1720000180000
  const t4 = 1720000240000
  const sparseCard = useServerCardData({
    server: {
      // Backend leading empty placeholder { ts } before t1 must also stay unmeasured
      ping: [
        { ts: t1 - 60_000 },
        { ts: t1, ct: 25 },
        { ts: t3, ct: null }, // Measured timeout at t3
        { ts: t4, ct: 42 }
      ],
      loss: [
        { ts: t1 - 60_000 },
        { ts: t2, ct: 5 }, // Only loss at t2 (disjoint timestamp from ping!)
        { ts: t3, ct: null }, // Both ping and loss null -> offline fault!
        { ts: t4, ct: 0 }
      ]
    },
    sysConfig: { latency_window: { points: 10, hours: 2 } }
  })

  const row = sparseCard.threeNetDetails.value[0]
  assert.equal(row.points.length, 10)
  assert.equal(row.isCompact, false)

  // First 6 slots (10 - 4) must be unmeasured neutral gray, NOT offline red!
  for (let i = 0; i < 6; i++) {
    assert.equal(row.points[i].unmeasured, true)
    assert.equal(row.points[i].offline, false)
    assert.equal(row.points[i].pingColor, UNMEASURED_BUCKET_COLOR)
    assert.equal(row.points[i].lossColor, UNMEASURED_BUCKET_COLOR)
  }

  // Slot 6 -> t1 (ping 25, loss null)
  assert.equal(row.points[6].timestamp, t1)
  assert.equal(row.points[6].unmeasured, false)
  assert.equal(row.points[6].offline, false)
  assert.equal(row.points[6].ping, 25)
  assert.equal(row.points[6].loss, null)

  // Slot 7 -> t2 (ping null, loss 5)
  assert.equal(row.points[7].timestamp, t2)
  assert.equal(row.points[7].offline, false)
  assert.equal(row.points[7].ping, null)
  assert.equal(row.points[7].loss, 5)

  // Slot 8 -> t3 (sampled timeout: both ping & loss null -> offline = true, red!)
  assert.equal(row.points[8].timestamp, t3)
  assert.equal(row.points[8].unmeasured, false)
  assert.equal(row.points[8].offline, true)
  assert.equal(row.points[8].pingColor, 'var(--accent-red)')
  assert.equal(row.points[8].lossColor, 'var(--accent-red)')

  // Latest sample t4 fixed at rightmost slot 9
  assert.equal(row.points[9].timestamp, t4)
  assert.equal(row.points[9].ping, 42)
  assert.equal(row.points[9].loss, 0)

  // 3) Backend fixed 8-key buckets with unconfigured null nodes:
  //    - Active nodes (ct, node_1) sort ahead of unconfigured null nodes (cu, cm, bd)
  //    - Unconfigured 3rd fallback row (cu) stays 100% unmeasured gray (isUnmeasuredRow = true), NOT 20 red bars!
  //    - Newly added node_2 (null at t1..t2, 33ms at t3..t4) marks t1..t2 as unmeasured gray, NOT offline red!
  //    - Simplified pingList drops all-null unconfigured nodes without squeezing out node_1 / node_2!
  const eightKeyCard = useServerCardData({
    server: {
      ping_ct: 28,
      loss_ct: 0,
      ping_cu: null,
      loss_cu: null,
      ping_cm: null,
      loss_cm: null,
      ping_bd: null,
      loss_bd: null,
      ping_node_1: 18,
      loss_node_1: 0,
      ping_node_2: 33,
      loss_node_2: 0,
      ping: [
        { ts: t1, ct: 28, cu: null, cm: null, bd: null, node_1: 18, node_2: null, node_3: null, node_4: null },
        { ts: t2, ct: 27, cu: null, cm: null, bd: null, node_1: 19, node_2: null, node_3: null, node_4: null },
        { ts: t3, ct: 29, cu: null, cm: null, bd: null, node_1: 17, node_2: 31, node_3: null, node_4: null },
        { ts: t4, ct: 28, cu: null, cm: null, bd: null, node_1: 18, node_2: 33, node_3: null, node_4: null }
      ],
      loss: [
        { ts: t1, ct: 0, cu: null, cm: null, bd: null, node_1: 0, node_2: null, node_3: null, node_4: null },
        { ts: t2, ct: 0, cu: null, cm: null, bd: null, node_1: 0, node_2: null, node_3: null, node_4: null },
        { ts: t3, ct: 0, cu: null, cm: null, bd: null, node_1: 0, node_2: 0, node_3: null, node_4: null },
        { ts: t4, ct: 0, cu: null, cm: null, bd: null, node_1: 0, node_2: 0, node_3: null, node_4: null }
      ]
    },
    sysConfig: { latency_window: { points: 10, hours: 2 } }
  })

  assert.deepEqual(
    eightKeyCard.threeNetDetails.value.map(item => item.key),
    ['ct', 'node_1', 'node_2']
  )
  const node2Row = eightKeyCard.threeNetDetails.value[2]
  // Leading 8 slots (10 - 2 samples at t3..t4) must all be unmeasured gray, NOT offline red!
  for (let i = 0; i < 8; i++) {
    assert.equal(node2Row.points[i].unmeasured, true)
    assert.equal(node2Row.points[i].offline, false)
    assert.equal(node2Row.points[i].pingColor, UNMEASURED_BUCKET_COLOR)
  }
  assert.equal(node2Row.points[8].ping, 31)
  assert.equal(node2Row.points[9].ping, 33)
  assert.deepEqual(
    eightKeyCard.pingList.value.map(item => item.key),
    ['ct', 'node_1', 'node_2']
  )

  // Only 1 configured node (ct) -> rows 1 & 2 (cu, cm) are unmeasured fallback rows with neutral color
  const oneNodeCard = useServerCardData({
    server: {
      ping_ct: 20,
      loss_ct: 0,
      ping: [{ ts: t1, ct: 20, cu: null, cm: null, bd: null, node_1: null, node_2: null, node_3: null, node_4: null }],
      loss: [{ ts: t1, ct: 0, cu: null, cm: null, bd: null, node_1: null, node_2: null, node_3: null, node_4: null }]
    },
    sysConfig: { latency_window: { points: 20, hours: 2 } }
  })
  const unconfiguredCuRow = oneNodeCard.threeNetDetails.value[1]
  assert.equal(unconfiguredCuRow.key, 'cu')
  assert.equal(unconfiguredCuRow.isUnmeasuredRow, true)
  assert.equal(unconfiguredCuRow.points.every(p => p.unmeasured && !p.offline), true)
  assert.equal(oneNodeCard.getLossColor(null), 'var(--text-secondary)')
})

test('percentage clamping, >999% over-quota traffic display, and tag deduplication/folding', async () => {
  const {
    clampPercent,
    safeUsagePercent,
    useServerCardData
  } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js')

  assert.equal(clampPercent(-25), 0)
  assert.equal(clampPercent(NaN), 0)
  assert.equal(clampPercent('Infinity'), 0)
  assert.equal(clampPercent(185), 100)
  assert.equal(safeUsagePercent(50, 0), 0)
  assert.equal(safeUsagePercent(-10, 100), 0)
  assert.equal(safeUsagePercent(250, 100, true), 100)

  const overQuotaCard = useServerCardData({
    server: {
      cpu: 'Infinity',
      ram_used: 4096,
      ram_total: 0,
      disk_used: -100,
      disk_total: 1000,
      net_rx_monthly: 2500 * 1024 * 1024 * 1024,
      net_tx_monthly: 0,
      traffic_limit: 100,
      tags: 'CN2, GIA, CN2, BGP, Tag4, Tag5, Tag6, Tag7, Tag8, Tag9, Tag10, Tag11'
    }
  })

  assert.equal(overQuotaCard.cpuPercent.value, 0)
  assert.equal(overQuotaCard.ramPercent.value, 0)
  assert.equal(overQuotaCard.diskPercent.value, 0)
  assert.equal(overQuotaCard.trafficUsageBarWidth.value, '100%')
  assert.equal(overQuotaCard.trafficUsagePercentText.value, '>999')
  assert.equal(overQuotaCard.trafficLimitPercentText.value, '>999')
  assert.equal(overQuotaCard.trafficUsageFullTitle.value, '2500.00%')

  // 11 unique tags -> 8 visible + 3 hidden
  assert.equal(overQuotaCard.tagList.value.length, 11)
  assert.equal(overQuotaCard.visibleTagList.value.length, 8)
  assert.equal(overQuotaCard.hiddenTagCount.value, 3)
})

test('finance.js uses locale-aware compact formatting, local end-of-day expiry, multilingual free tags, and finite rate guards', async () => {
  const {
    calculateFinanceSummary,
    convertCnyAmount,
    formatFinanceAmount,
    parseFinanceExpireTimestamp,
    resolveFinanceNumberLocale
  } = await vite.ssrLoadModule('/src/frontend/utils/finance.js')

  assert.equal(resolveFinanceNumberLocale('en'), 'en-US')
  assert.equal(resolveFinanceNumberLocale('zh'), 'zh-CN')
  assert.equal(resolveFinanceNumberLocale('zh-TW'), 'zh-TW')
  assert.equal(resolveFinanceNumberLocale('ja'), 'ja-JP')
  assert.equal(resolveFinanceNumberLocale('fr'), 'fr-FR')

  const enFormatted = formatFinanceAmount(150000, 'USD', 'en')
  assert.equal(enFormatted.symbol, '$')
  assert.doesNotMatch(enFormatted.value, /万|萬/)

  const zhFormatted = formatFinanceAmount(150000, 'CNY', 'zh')
  assert.match(zhFormatted.value, /万/)

  // Local end-of-day expiry consistency with cards
  const expectedLocalEnd = new Date(2026, 10, 19).getTime()
  assert.equal(parseFinanceExpireTimestamp('2026-11-18'), expectedLocalEnd)
  assert.equal(Number.isNaN(parseFinanceExpireTimestamp('2026-02-31')), true)

  // Multilingual free tags & non-finite exchange rate guards
  const midDay = new Date(2026, 10, 18, 12, 0, 0).getTime()
  const summary = calculateFinanceSummary([
    { price: '$10/mo', tags: 'Free, Dev', expire_date: '2026-12-18' },
    { price: '€20/mo', tags: 'Gratis', expire_date: '2026-12-18' },
    { price: '¥100/mo', tags: 'Prod', expire_date: '2026-11-18' } // Still valid at noon on 2026-11-18!
  ], { USD: Infinity, EUR: -1, CNY: 1 }, midDay)

  assert.equal(summary.configuredCount, 1)
  assert.equal(summary.expiredCount, 0)
  assert.ok(Number.isFinite(summary.remainingValueCNY) && summary.remainingValueCNY > 0)
  assert.equal(convertCnyAmount(Infinity, 'USD'), 0)
  assert.equal(Number.isFinite(convertCnyAmount(100, 'USD', { USD: Infinity })), true)
})

test('storage.js falls back cleanly to in-memory Map when Web Storage throws or is missing', async () => {
  const { createSafeStorage } = await vite.ssrLoadModule('/src/frontend/utils/storage.js')

  const throwingStorage = createSafeStorage(() => ({
    getItem() {
      throw new Error('SecurityError: Access denied')
    },
    setItem() {
      throw new Error('QuotaExceededError')
    },
    removeItem() {
      throw new Error('SecurityError')
    },
    clear() {
      throw new Error('SecurityError')
    }
  }))

  assert.equal(throwingStorage.getItem('k1'), null)
  assert.equal(throwingStorage.setItem('k1', 'v1'), false)
  assert.equal(throwingStorage.getItem('k1'), 'v1')
  throwingStorage.removeItem('k1')
  assert.equal(throwingStorage.getItem('k1'), null)

  const missingStorage = createSafeStorage(() => {
    throw new Error('ReferenceError: localStorage is disabled')
  })
  missingStorage.setItem('alpha', 123)
  assert.equal(missingStorage.getItem('alpha'), '123')
  missingStorage.clear()
  assert.equal(missingStorage.getItem('alpha'), null)
})

test('getFlagRegionCode validation, URL encoding in fetchServerDetail/fetchAllHistory, and numeric regionStats aggregation', async () => {
  const {
    getFlagRegionCode,
    fetchServerDetail,
    fetchAllHistory,
    fetchServersAll
  } = await vite.ssrLoadModule('/src/frontend/utils/api.js')

  assert.equal(getFlagRegionCode('US'), 'us')
  assert.equal(getFlagRegionCode('hk'), 'hk')
  assert.equal(getFlagRegionCode('TW'), 'cn')
  assert.equal(getFlagRegionCode('../etc/passwd'), '')
  assert.equal(getFlagRegionCode('USA'), '')
  assert.equal(getFlagRegionCode('12'), '')
  assert.equal(getFlagRegionCode('<svg>'), '')
  assert.equal(getFlagRegionCode(null), '')

  const originalFetch = globalThis.fetch
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    if (String(url).includes('/api/servers')) {
      return new Response(JSON.stringify({
        servers: [],
        stats: { total: '2', online: '1', offline: '1' },
        regionStats: { US: '3', JP: 2 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    await fetchServerDetail('node/a?b=1&c=2#frag', 0)
    await fetchAllHistory('node#1?x=y', '24&inject=1', 0)
    assert.ok(requestedUrls[0].includes('id=node%2Fa%3Fb%3D1%26c%3D2%23frag'))
    assert.ok(requestedUrls[1].includes('id=node%231%3Fx%3Dy&hours=24%26inject%3D1'))

    const merged = await fetchServersAll()
    assert.equal(typeof merged.regionStats.US, 'number')
    assert.equal(merged.regionStats.US, 3)
    assert.equal(merged.stats.total, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createLiveSocket cancels single backoff timer on close() and prevents zombie WebSocket resurrection', async () => {
  const { createLiveSocket } = await vite.ssrLoadModule('/src/frontend/utils/api.js')
  const originalWebSocket = globalThis.WebSocket
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  globalThis.WebSocket = FakeWebSocket
  const scheduledTimers = []
  globalThis.setTimeout = (callback, delay) => {
    const handle = { callback, delay, cleared: false }
    scheduledTimers.push(handle)
    return handle
  }
  globalThis.clearTimeout = (handle) => {
    if (handle) handle.cleared = true
  }
  FakeWebSocket.instances = []

  try {
    const live = createLiveSocket('server-zombie-test')
    assert.equal(FakeWebSocket.instances.length, 1)

    const ws1 = FakeWebSocket.instances[0]
    ws1.emit('open')
    // Simulate unexpected network drop -> schedules a single backoff timer
    ws1.emit('close', { code: 1006, reason: 'network drop' })
    assert.equal(scheduledTimers.length, 1)
    assert.equal(scheduledTimers[0].cleared, false)

    // Component unmounts and calls close() before backoff fires
    live.close()
    assert.equal(scheduledTimers[0].cleared, true)

    // Even if a stale timer callback somehow runs, manualClose guard must block connect()
    scheduledTimers[0].callback()
    assert.equal(FakeWebSocket.instances.length, 1)

    // Explicit reconnect() must reset manualClose and establish a fresh socket
    live.reconnect()
    assert.equal(FakeWebSocket.instances.length, 2)
    live.close()
  } finally {
    globalThis.WebSocket = originalWebSocket
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

test('Vue components SSR render safely without stray markup, broken flags, or unencoded attributes', async () => {
  const { default: RegionFlag } = await vite.ssrLoadModule('/src/frontend/components/RegionFlag.vue')
  const { default: Footer } = await vite.ssrLoadModule('/src/frontend/components/Footer.vue')
  const { default: ServerRingCard } = await vite.ssrLoadModule('/src/frontend/components/ServerRingCard.vue')
  const { default: ServerBarCard } = await vite.ssrLoadModule('/src/frontend/components/ServerBarCard.vue')
  const { usePasswordVisibility } = await vite.ssrLoadModule('/src/frontend/composables/usePasswordVisibility.js')

  // Prototype-safe Object.hasOwn check (never throws when 'hasOwnProperty' is a field name or prototype key is passed)
  const pwd = usePasswordVisibility(['hasOwnProperty', 'apiSecret'])
  assert.doesNotThrow(() => {
    pwd.toggle('apiSecret')
    pwd.show('hasOwnProperty')
    pwd.hide('hasOwnProperty')
    pwd.addField('apiToken')
    pwd.toggle('toString')
    pwd.toggle('constructor')
  })
  assert.equal(pwd.visibility.apiSecret, true)
  assert.equal(pwd.getInputType('apiSecret'), 'text')
  assert.equal(Object.hasOwn(pwd.visibility, 'toString'), false)
  assert.equal(Object.hasOwn(pwd.visibility, 'constructor'), false)

  // RegionFlag valid vs invalid traversal code
  const validFlagHtml = await renderToString(createSSRApp({
    render: () => h(RegionFlag, { region: 'US' })
  }))
  assert.match(validFlagHtml, /flags\/us\.svg/)

  const invalidFlagHtml = await renderToString(createSSRApp({
    render: () => h(RegionFlag, { region: '../secret' })
  }))
  assert.doesNotMatch(invalidFlagHtml, /<img/)
  assert.match(invalidFlagHtml, /🌐/)

  // Footer rel="noopener noreferrer"
  const footerHtml = await renderToString(createSSRApp({
    render: () => h(Footer)
  }))
  assert.match(footerHtml, /rel="noopener noreferrer"/)

  // ServerRingCard & ServerBarCard unlimited gradient width: 100% and no stray '></div>'
  const routerLinkStub = {
    props: ['to'],
    setup(props, { slots }) {
      return () => h('a', { href: props.to }, slots.default?.())
    }
  }

  const unlimitedServer = {
    id: 'srv-1',
    name: 'Ultra-Long-Server-Hostname-For-Overflow-Protection-Check',
    region: 'XX',
    os: 'Ubuntu',
    cpu: 42,
    cpu_cores: 8,
    ram_used: 1024,
    ram_total: 2048,
    disk_used: 10240,
    disk_total: 20480,
    traffic_limit: 0
  }

  const ringApp = createSSRApp({
    render: () => h(ServerRingCard, { server: unlimitedServer, to: '/server/srv-1' })
  })
  ringApp.component('router-link', routerLinkStub)
  const ringHtml = await renderToString(ringApp)
  assert.doesNotMatch(ringHtml, />(&gt;|>)<\/div>/)
  assert.match(ringHtml, /width:\s*100%[^"]*linear-gradient/)
  assert.match(ringHtml, /🌐/)

  const barApp = createSSRApp({
    render: () => h(ServerBarCard, { server: unlimitedServer, to: '/server/srv-1' })
  })
  barApp.component('router-link', routerLinkStub)
  const barHtml = await renderToString(barApp)
  assert.match(barHtml, /width:\s*100%[^"]*linear-gradient/)

  // ServerLatencyPanel renders compact gap (>30 buckets) and --three-net-tooltip-shift
  const { default: ServerLatencyPanel } = await vite.ssrLoadModule('/src/frontend/components/ServerLatencyPanel.vue')
  const { useServerCardData } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js')
  const denseCard = useServerCardData({
    server: {
      ping: Array.from({ length: 45 }, (_, i) => ({ ts: 1720000000000 + i * 60_000, ct: 25 })),
      loss: Array.from({ length: 45 }, (_, i) => ({ ts: 1720000000000 + i * 60_000, ct: 0 }))
    },
    sysConfig: { show_three_net_details: true, latency_window: { points: 45, hours: 2 } }
  })
  const latencyHtml = await renderToString(createSSRApp({
    render: () => h(ServerLatencyPanel, {
      showThreeNetDetails: true,
      hasThreeNetDetails: true,
      threeNetDetails: denseCard.threeNetDetails.value,
      hasPingData: true,
      pingList: denseCard.pingList.value,
      timeoutText: 'TIMEOUT',
      getPingColor: denseCard.getPingColor,
      getLossColor: denseCard.getLossColor,
      formatPingValue: denseCard.formatPingValue,
      formatLossValue: denseCard.formatLossValue,
      isPingValid: denseCard.isPingValid
    })
  }))
  assert.match(latencyHtml, /is-compact/)
  assert.match(latencyHtml, /gap:\s*1px/)
  assert.match(latencyHtml, /--three-net-tooltip-shift:\s*\+36px/)
  assert.match(latencyHtml, /--three-net-tooltip-shift:\s*-36px/)

  // Ensure remaining modified SFCs compile and load cleanly via Vite SSR
  const [
    dashboardMod,
    detailMod,
    headerMod,
    timeoutModalMod,
    helpTooltipMod
  ] = await Promise.all([
    vite.ssrLoadModule('/src/frontend/views/Dashboard.vue'),
    vite.ssrLoadModule('/src/frontend/views/ServerDetail.vue'),
    vite.ssrLoadModule('/src/frontend/components/TerminalHeader.vue'),
    vite.ssrLoadModule('/src/frontend/components/LiveConnectionTimeoutModal.vue'),
    vite.ssrLoadModule('/src/frontend/components/HelpTooltip.vue')
  ])
  assert.ok(dashboardMod.default)
  assert.ok(detailMod.default)
  assert.ok(headerMod.default)
  assert.ok(timeoutModalMod.default)
  assert.ok(helpTooltipMod.default)

  // Verify ServerDetail.vue, Dashboard.vue, ServerLatencyPanel.vue, and turnstile.js invariants
  const detailSource = readFileSync(path.join(repoRoot, 'src/frontend/views/ServerDetail.vue'), 'utf8')
  assert.doesNotMatch(detailSource, /\balert\(/)
  assert.match(detailSource, /suggestedMax:\s*100/)
  assert.match(detailSource, /redirect:\s*route\.fullPath/)
  assert.match(detailSource, /applyMikusThemeOptions\(null\)/)
  assert.match(detailSource, /let\s+chartInitPromise\s*=\s*null/)
  assert.doesNotMatch(detailSource, /isInitializingCharts/)
  assert.match(detailSource, /useModal\(showLoginModal/)

  const gpuColorsMatch = detailSource.match(/const GPU_COLORS = \[([\s\S]*?)\]/)
  assert.ok(gpuColorsMatch, 'GPU_COLORS palette should exist')
  const palette = [...gpuColorsMatch[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map(m => m[1].toLowerCase())
  assert.equal(palette.length, 16)
  assert.equal(new Set(palette).size, 16, 'All 16 GPU_COLORS entries must be distinct')

  const dashboardSource = readFileSync(path.join(repoRoot, 'src/frontend/views/Dashboard.vue'), 'utf8')
  assert.doesNotMatch(dashboardSource, /\blocalStorage\./)
  assert.match(dashboardSource, /safeSessionStorage/)
  assert.match(dashboardSource, /useModal\(financeModalOpen/)

  const latencyPanelSource = readFileSync(path.join(repoRoot, 'src/frontend/components/ServerLatencyPanel.vue'), 'utf8')
  assert.doesNotMatch(latencyPanelSource, /\.three-net-bucket::after/)

  // SSR render unmeasured row: Ping and Loss headers both render neutral '--' with var(--text-secondary)
  const emptyCard = useServerCardData({
    server: {
      ping: [{ ts: 1720000000000, ct: 22, cu: null, cm: null }],
      loss: [{ ts: 1720000000000, ct: 0, cu: null, cm: null }]
    },
    sysConfig: { show_three_net_details: true, latency_window: { points: 5, hours: 2 } }
  })
  const emptyLatencyHtml = await renderToString(createSSRApp({
    render: () => h(ServerLatencyPanel, {
      showThreeNetDetails: true,
      hasThreeNetDetails: true,
      threeNetDetails: emptyCard.threeNetDetails.value,
      hasPingData: true,
      pingList: emptyCard.pingList.value,
      timeoutText: 'TIMEOUT',
      getPingColor: emptyCard.getPingColor,
      getLossColor: emptyCard.getLossColor,
      formatPingValue: emptyCard.formatPingValue,
      formatLossValue: emptyCard.formatLossValue,
      isPingValid: emptyCard.isPingValid
    })
  }))
  assert.doesNotMatch(emptyLatencyHtml, /TIMEOUT/)
  assert.doesNotMatch(emptyLatencyHtml, /rgba\(128,\s*128,\s*128,\s*0\.22\)[^>]*>--<\/strong>/)
  assert.match(emptyLatencyHtml, /color:var\(--text-secondary\)[^>]*>--<\/strong>/)
})

test('multi-site sysConfig merge preserves custom ping node names and turnstile survives restricted storage', async () => {
  const { initConfig } = await vite.ssrLoadModule('/src/frontend/utils/config.js')
  const { fetchServersAll } = await vite.ssrLoadModule('/src/frontend/utils/api.js')
  const turnstile = await vite.ssrLoadModule('/src/frontend/utils/turnstile.js')

  const originalFetch = globalThis.fetch
  const originalLocalStorage = globalThis.localStorage
  const originalDocument = globalThis.document

  globalThis.document = {
    title: 'Multi Monitor',
    querySelector(selector) {
      if (selector === 'meta[name="apiBase"]') {
        return { content: 'https://site-a.example,https://site-b.example' }
      }
      return null
    }
  }

  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.startsWith('https://site-a.example/api/servers')) {
      return new Response(JSON.stringify({
        servers: [{ id: 'a1', name: 'A1' }],
        sysConfig: {
          custom_ct_name: '上海电信',
          node_1_name: 'Node 1'
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.startsWith('https://site-b.example/api/servers')) {
      return new Response(JSON.stringify({
        servers: [{ id: 'b1', name: 'B1' }],
        sysConfig: {
          custom_ct_name: '电信',
          node_1_name: '东京 IIJ'
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    await initConfig()
    const merged = await fetchServersAll()
    // Site B's unmodified default '电信' must NOT overwrite Site A's custom '上海电信'
    assert.equal(merged.sysConfig.custom_ct_name, '上海电信')
    // Site A's unmodified default 'Node 1' yields to Site B's custom '东京 IIJ'
    assert.equal(merged.sysConfig.node_1_name, '东京 IIJ')

    // Turnstile helpers must fall back cleanly when localStorage throws SecurityError
    globalThis.localStorage = {
      getItem() { throw new Error('SecurityError') },
      setItem() { throw new Error('SecurityError') },
      removeItem() { throw new Error('SecurityError') }
    }
    assert.doesNotThrow(() => {
      turnstile.setTurnstileToken('tok_abc')
      assert.equal(turnstile.getTurnstileToken(), 'tok_abc')
      assert.equal(turnstile.hasSharedTurnstileVerified(), false)
      turnstile.clearTurnstileToken()
      assert.equal(turnstile.getTurnstileToken(), '')
    })
  } finally {
    globalThis.document = { title: '', querySelector: () => null }
    await initConfig()
    globalThis.document = originalDocument
    globalThis.fetch = originalFetch
    globalThis.localStorage = originalLocalStorage
  }
})
