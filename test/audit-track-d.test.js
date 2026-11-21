import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref, nextTick } from 'vue'

import {
  BILLING_CYCLES,
  CURRENCY_OPTIONS,
  FREE_PRICE_LABELS,
  formatBillingPrice,
  getLocalizedOptionField,
  getLocalizedPingNodeLabel,
  maskCommandSecret,
  normalizeCurrency,
  normalizePrice,
  resolveCustomPingNodeName,
  resolveSafeLoginRedirect,
  validateNetworkInterfaceInput,
  validatePriceInput,
  validateResourceAlertThresholdInput,
  validateServerNameInput,
  validateTrafficAlertPercentInput,
  validateTrafficCorrectionInput,
  validateTrafficLimitInput
} from '../src/frontend/utils/server.js'
import {
  getActiveModalCount,
  handleModalEscapeKeydown,
  resetModalStack,
  useModal
} from '../src/frontend/composables/useModal.js'
import en from '../src/frontend/locales/en.js'
import es from '../src/frontend/locales/es.js'
import fr from '../src/frontend/locales/fr.js'
import zh from '../src/frontend/locales/zh.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const readWorkspaceFile = (relPath) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8')

test('normalizePrice and validatePriceInput support European comma decimals and reject invalid inputs', () => {
  assert.equal(normalizePrice('40,50'), '40.50')
  assert.equal(normalizePrice('€ 12,9'), '12.90')
  assert.equal(normalizePrice('1.234,56'), '1234.56')
  assert.equal(normalizePrice('1,234.56'), '1234.56')
  assert.equal(normalizePrice('1,000'), '1000.00')
  assert.equal(normalizePrice('Rp. 50000'), '50000.00')
  assert.equal(normalizePrice('-1'), '-1')
  assert.equal(normalizePrice('0,50'), '0.50')
  assert.equal(normalizePrice('0'), '0.00')
  assert.equal(normalizePrice('.50'), '0.50')
  assert.equal(normalizePrice('1e5'), '')
  assert.equal(normalizePrice('1000000001'), '')
  assert.equal(normalizePrice('0,009'), '')
  assert.equal(normalizePrice('0,500'), '')
  assert.equal(normalizePrice('00,100'), '')
  assert.equal(normalizePrice(',50'), '')
  assert.equal(normalizePrice('€,50'), '')
  assert.equal(normalizePrice(',,50'), '')

  assert.deepEqual(validatePriceInput(''), { valid: true, value: '' })
  assert.deepEqual(validatePriceInput('40,50'), { valid: true, value: '40.50' })
  assert.deepEqual(validatePriceInput('0,50'), { valid: true, value: '0.50' })
  assert.deepEqual(validatePriceInput('€ 12,9'), { valid: true, value: '12.90' })
  assert.deepEqual(validatePriceInput('Rp. 50000'), { valid: true, value: '50000.00' })
  assert.deepEqual(validatePriceInput('-1'), { valid: true, value: '-1' })

  for (const invalid of [
    '12.3.4', '-20', 'abc', '12abc', '1e5', '1000000001', '12,345,67',
    '0,009', '0,500', '00,100', '0,123.45', '0.500,12', ',50', '€,50', ',,50'
  ]) {
    assert.equal(validatePriceInput(invalid).valid, false, `expected "${invalid}" to be rejected`)
  }
})

test('explicit admin form validators enforce strict boundaries without silent coercion', () => {
  assert.deepEqual(validateServerNameInput('  Tokyo-01  '), { valid: true, value: 'Tokyo-01' })
  assert.equal(validateServerNameInput('   ').valid, false)
  assert.equal(validateServerNameInput('x'.repeat(101)).valid, false)

  assert.deepEqual(validateTrafficLimitInput(''), { valid: true, value: '' })
  assert.deepEqual(validateTrafficLimitInput('0'), { valid: true, value: '' })
  assert.deepEqual(validateTrafficLimitInput('1024.5'), { valid: true, value: '1024.5' })
  assert.equal(validateTrafficLimitInput('-10').valid, false)
  assert.equal(validateTrafficLimitInput('abc').valid, false)
  assert.equal(validateTrafficLimitInput('1e6').valid, false)

  assert.deepEqual(validateTrafficCorrectionInput(''), { valid: true, value: '' })
  assert.deepEqual(validateTrafficCorrectionInput('0'), { valid: true, value: 0 })
  assert.deepEqual(validateTrafficCorrectionInput('1000000'), { valid: true, value: 1000000 })
  assert.equal(validateTrafficCorrectionInput('-1').valid, false)
  assert.equal(validateTrafficCorrectionInput('1000001').valid, false)
  assert.equal(validateTrafficCorrectionInput('12.3.4').valid, false)

  assert.deepEqual(validateTrafficAlertPercentInput(''), { valid: true, value: null })
  assert.equal(validateTrafficAlertPercentInput('', { allowEmpty: false }).valid, false)
  assert.deepEqual(validateTrafficAlertPercentInput('80'), { valid: true, value: 80 })
  assert.deepEqual(validateTrafficAlertPercentInput('0'), { valid: true, value: 0 })
  assert.deepEqual(validateTrafficAlertPercentInput('100'), { valid: true, value: 100 })
  assert.equal(validateTrafficAlertPercentInput('101').valid, false)
  assert.equal(validateTrafficAlertPercentInput('-1').valid, false)
  assert.equal(validateTrafficAlertPercentInput('80.5').valid, false)

  assert.deepEqual(validateNetworkInterfaceInput(''), { valid: true, value: '' })
  assert.deepEqual(validateNetworkInterfaceInput('eth0, ens3, br-lan.10'), { valid: true, value: 'eth0,ens3,br-lan.10' })
  assert.equal(validateNetworkInterfaceInput('eth0 ens3').valid, false)
  assert.equal(validateNetworkInterfaceInput('eth0;whoami').valid, false)
  assert.equal(validateNetworkInterfaceInput('eth0/1').valid, false)
  assert.equal(validateNetworkInterfaceInput('eth0,,ens3').valid, false)

  assert.deepEqual(validateResourceAlertThresholdInput('85.5', 'cpu'), { valid: true, value: '85.5' })
  assert.equal(validateResourceAlertThresholdInput('0', 'cpu').valid, false)
  assert.equal(validateResourceAlertThresholdInput('101', 'ram').valid, false)
  assert.deepEqual(validateResourceAlertThresholdInput('5000', 'netIn'), { valid: true, value: '5000' })
  assert.equal(validateResourceAlertThresholdInput('100001', 'netOut').valid, false)
})

test('billing cycles, free labels, and currencies localize cleanly across all 7 languages', () => {
  const langs = ['zh', 'zh-TW', 'en', 'ja', 'es', 'fr', 'id']
  for (const lang of langs) {
    assert.ok(FREE_PRICE_LABELS[lang], `missing free price label for ${lang}`)
    for (const cycle of BILLING_CYCLES) {
      assert.ok(getLocalizedOptionField(cycle, 'label', lang), `missing cycle label for ${cycle.value} in ${lang}`)
      assert.ok(getLocalizedOptionField(cycle, 'shortLabel', lang), `missing cycle shortLabel for ${cycle.value} in ${lang}`)
    }
    for (const currency of CURRENCY_OPTIONS) {
      assert.ok(getLocalizedOptionField(currency, 'name', lang), `missing currency name for ${currency.symbol} in ${lang}`)
    }
  }

  assert.equal(normalizeCurrency('Rp.'), 'Rp')
  assert.equal(formatBillingPrice({ price: '40,50', currency: '€', billing_cycle: 'year' }, 'fr'), '€40.50/an')
  assert.equal(formatBillingPrice({ price: '40,50', currency: '€', billing_cycle: 'year' }, 'es'), '€40.50/año')
  assert.equal(formatBillingPrice({ price: 'Rp. 50000', currency: 'Rp', billing_cycle: 'month' }, 'id'), 'Rp50000.00/bln')
  assert.equal(formatBillingPrice({ price: '-1', currency: '$' }, 'fr'), 'Gratuit')
  assert.equal(formatBillingPrice({ price: '0', currency: '$' }, 'ja'), '無料')
})

test('Contract 1: builtin ping node names fall back to active locale while custom names persist across languages', () => {
  assert.equal(resolveCustomPingNodeName('custom_ct_name', '电信'), '')
  assert.equal(resolveCustomPingNodeName('custom_cu_name', '联通'), '')
  assert.equal(resolveCustomPingNodeName('custom_cm_name', '移动'), '')
  assert.equal(resolveCustomPingNodeName('custom_bd_name', 'BGP'), '')
  assert.equal(resolveCustomPingNodeName('node_1_name', 'Node 1'), '')
  assert.equal(resolveCustomPingNodeName('node_4_name', 'Node 4'), '')
  assert.equal(resolveCustomPingNodeName('custom_ct_name', '上海电信'), '上海电信')

  const defaultSettings = {
    custom_ct_name: '电信',
    node_1_name: 'Node 1'
  }
  assert.equal(getLocalizedPingNodeLabel('custom_ct', defaultSettings, en), en.customCt)
  assert.equal(getLocalizedPingNodeLabel('custom_ct', defaultSettings, en, true), en.pingCt)
  assert.equal(getLocalizedPingNodeLabel('node_1', defaultSettings, fr), fr.pingNode_1)

  const customSettings = {
    custom_ct_name: '上海电信',
    node_1_name: 'Tokyo IIJ'
  }
  assert.equal(getLocalizedPingNodeLabel('custom_ct', customSettings, en), '上海电信')
  assert.equal(getLocalizedPingNodeLabel('custom_ct', customSettings, zh, true), '上海电信')
  assert.equal(getLocalizedPingNodeLabel('node_1', customSettings, fr), 'Tokyo IIJ')
})

test('Contract 3: resolveSafeLoginRedirect allows safe internal paths and blocks open redirects or loops', () => {
  assert.equal(resolveSafeLoginRedirect('/server/hk-1?apiIndex=0'), '/server/hk-1?apiIndex=0')
  assert.equal(resolveSafeLoginRedirect('/'), '/')
  assert.equal(resolveSafeLoginRedirect('/server/us-2#latency'), '/server/us-2#latency')

  for (const unsafe of [
    '',
    null,
    undefined,
    '//evil.example.com',
    '/\\evil.example.com',
    'https://evil.example.com/server/1',
    'http://evil.example.com',
    'javascript:alert(1)',
    '/admin',
    '/admin?redirect=/',
    '/admin/settings',
    '/server/1\nSet-Cookie:x=1'
  ]) {
    assert.equal(resolveSafeLoginRedirect(unsafe), '', `expected redirect "${unsafe}" to be blocked`)
  }
})

test('maskCommandSecret masks secret literals across Linux, cfsm-user, PowerShell, and Docker commands', () => {
  const quotePosixShellArg = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`
  const quotePosixDoubleShellArg = (value) => `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`')}"`

  const secret = "my'Super$Secret123"
  const linuxCmd = `curl -fsSL 'https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh' | sh -s -- install -id=srv1 -secret=${quotePosixShellArg(secret)} -url=https://mon.example/update -auto_update=0`
  const maskedLinux = maskCommandSecret(linuxCmd)
  assert.ok(!maskedLinux.includes('Super$Secret123'))
  assert.ok(!maskedLinux.includes('Secret123'))
  assert.ok(maskedLinux.includes("-secret='********'"))
  assert.ok(maskedLinux.includes('-id=srv1'))

  // Realistic cfsm-user nested double-quoted command produced by buildInstallAsCfsmCommand
  const cfsmUserCmd = [
    '(',
    'set -e',
    `as_root runuser -u cfsm -- env HOME="\${CFSM_HOME}" sh -c ${quotePosixDoubleShellArg(linuxCmd)}`,
    ')'
  ].join('\n')
  const maskedCfsmUser = maskCommandSecret(cfsmUserCmd)
  assert.ok(!maskedCfsmUser.includes('Super'))
  assert.ok(!maskedCfsmUser.includes('Secret123'), 'cfsm-user single-quote secret tail must never leak')
  assert.ok(maskedCfsmUser.includes("-secret='********'"))

  // Short secrets like 'sh', '123', 'com' must ONLY mask -secret= / SECRET= and NEVER corrupt command body or URLs
  for (const shortSecret of ['sh', '123', 'com']) {
    const shortLinux = `curl -fsSL 'https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh' | sh -s -- install -id=srv123 -secret=${quotePosixShellArg(shortSecret)} -url=https://mon.example.com/update`
    const maskedShort = maskCommandSecret(shortLinux)
    assert.ok(maskedShort.includes('install.sh | sh -s -- install -id=srv123') || maskedShort.includes("install.sh' | sh -s -- install -id=srv123"))
    assert.ok(maskedShort.includes('https://raw.githubusercontent.com/huilang-me/cfsm-agent/main/install.sh'))
    assert.ok(maskedShort.includes('https://mon.example.com/update'))
    assert.ok(maskedShort.includes("-secret='********'"))
  }

  const psCmd = "$script = \"$env:TEMP\\install-cf-probe.ps1\"; PowerShell -File $script install -id='srv1' -secret='my''Super$Secret123' -url='https://mon.example/update'"
  const maskedPs = maskCommandSecret(psCmd)
  assert.ok(!maskedPs.includes('Super$Secret123'))
  assert.ok(maskedPs.includes("-secret='********'"))

  const dockerCmd = `docker run -d -e SERVER_ID='srv1' -e SECRET=${quotePosixShellArg(secret)} -e WORKER_URL='https://mon.example/update' ghcr.io/huilang-me/cfsm-agent:latest`
  const maskedDocker = maskCommandSecret(dockerCmd)
  assert.ok(!maskedDocker.includes('Super$Secret123'))
  assert.ok(maskedDocker.includes("-e SECRET='********'"))
})

test('useModal manages stacked Escape dismissal, saving lock guard, and body scroll lock', async () => {
  const listeners = new Map()
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document

  globalThis.window = {
    addEventListener(type, fn) {
      listeners.set(type, fn)
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type)
    },
    dispatchEvent() {}
  }
  globalThis.document = {
    documentElement: { lang: 'en' },
    body: { style: { overflow: 'auto' } }
  }

  try {
    resetModalStack()
    const parentOpen = ref(false)
    const childOpen = ref(false)
    const childSaving = ref(false)

    const parentModal = useModal(parentOpen, () => { parentOpen.value = false })
    const childModal = useModal(childOpen, () => { childOpen.value = false }, {
      canClose: () => !childSaving.value
    })

    assert.equal(getActiveModalCount(), 0)
    assert.equal(globalThis.document.body.style.overflow, 'auto')

    parentOpen.value = true
    await nextTick()
    assert.equal(getActiveModalCount(), 1)
    assert.equal(globalThis.document.body.style.overflow, 'hidden')

    childOpen.value = true
    childSaving.value = true
    await nextTick()
    assert.equal(getActiveModalCount(), 2)

    // Saving lock prevents Escape from closing top modal or leaking to parent modal
    const blocked = handleModalEscapeKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    assert.equal(blocked, false)
    assert.equal(childOpen.value, true)
    assert.equal(parentOpen.value, true)

    // Once saving completes, Escape closes ONLY the top child modal
    childSaving.value = false
    const closedChild = handleModalEscapeKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    assert.equal(closedChild, true)
    await nextTick()
    assert.equal(childOpen.value, false)
    assert.equal(parentOpen.value, true)
    assert.equal(globalThis.document.body.style.overflow, 'hidden')

    // Second Escape closes parent modal and restores body overflow
    const closedParent = handleModalEscapeKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    assert.equal(closedParent, true)
    await nextTick()
    assert.equal(parentOpen.value, false)
    assert.equal(getActiveModalCount(), 0)
    assert.equal(globalThis.document.body.style.overflow, 'auto')

    parentModal.dispose()
    childModal.dispose()
  } finally {
    resetModalStack()
    globalThis.window = prevWindow
    globalThis.document = prevDocument
  }
})

test('i18n survives throwing private-mode localStorage, syncs html[lang], and fixes locale strings', async () => {
  assert.equal(en.hoursAgo, 'hrs ago')
  assert.equal(fr.secondsAgo, 's auparavant')
  assert.equal(fr.minutesAgo, 'min auparavant')
  assert.equal(fr.hoursAgo, 'h auparavant')
  assert.equal(fr.daysAgo, 'j auparavant')

  // Verify cspWarning has no consecutive duplicate sentences in en/es/fr
  for (const [code, pack] of [['en', en], ['es', es], ['fr', fr]]) {
    const sentences = pack.cspWarning.split('. ').map(s => s.trim()).filter(Boolean)
    assert.equal(new Set(sentences).size, sentences.length, `${code}.cspWarning should not repeat sentences`)
  }

  const prevStorage = globalThis.localStorage
  const prevDocument = globalThis.document
  const prevWindow = globalThis.window
  const prevCustomEvent = globalThis.CustomEvent

  globalThis.localStorage = {
    getItem() {
      throw new Error('QuotaExceededError / Private Mode')
    },
    setItem() {
      throw new Error('QuotaExceededError / Private Mode')
    }
  }
  globalThis.document = { documentElement: { lang: '' } }
  globalThis.window = { dispatchEvent() {} }
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }

  try {
    const i18n = await import(`../src/frontend/utils/i18n.js?privateMode=${Date.now()}`)
    assert.equal(await i18n.setLanguage('zh'), true)
    assert.equal(globalThis.document.documentElement.lang, 'zh-CN')
    assert.equal(await i18n.setLanguage('zh-TW'), true)
    assert.equal(globalThis.document.documentElement.lang, 'zh-TW')
    assert.equal(await i18n.applyDefaultLanguage('id'), 'id')
    assert.equal(globalThis.document.documentElement.lang, 'id')
  } finally {
    globalThis.localStorage = prevStorage
    globalThis.document = prevDocument
    globalThis.window = prevWindow
    globalThis.CustomEvent = prevCustomEvent
  }
})

test('router, styles, and admin SFCs preserve critical Track D invariants', async () => {
  const prevWindow = globalThis.window
  const prevSelf = globalThis.self
  const prevLocation = globalThis.location
  const prevHistory = globalThis.history
  const prevDocument = globalThis.document
  const mockLocation = {
    protocol: 'https:',
    host: 'example.com',
    hostname: 'example.com',
    origin: 'https://example.com',
    pathname: '/',
    search: '',
    hash: '#/'
  }
  const mockHistory = {
    state: null,
    replaceState() {},
    pushState() {}
  }
  globalThis.location = mockLocation
  globalThis.history = mockHistory
  globalThis.document = {
    querySelector() {
      return null
    },
    addEventListener() {},
    removeEventListener() {}
  }
  globalThis.window = {
    location: mockLocation,
    history: mockHistory,
    addEventListener() {},
    removeEventListener() {}
  }
  globalThis.self = globalThis.window

  try {
    const { routes, scrollBehavior } = await import('../src/frontend/router/index.js')
    const catchAll = routes.find(r => r.path === '/:pathMatch(.*)*')
    assert.ok(catchAll, 'router must include 404 catch-all route')
    assert.equal(catchAll.redirect, '/')
    assert.deepEqual(scrollBehavior({}, {}, null), { top: 0, left: 0 })
    assert.deepEqual(scrollBehavior({}, {}, { top: 120, left: 0 }), { top: 120, left: 0 })
  } finally {
    globalThis.window = prevWindow
    globalThis.self = prevSelf
    globalThis.location = prevLocation
    globalThis.history = prevHistory
    globalThis.document = prevDocument
  }

  const mainCss = readWorkspaceFile('src/frontend/styles/main.css')
  const cmdWrapperBlock = mainCss.match(/\.cmd-output-wrapper\s*\{[^}]*\}/)?.[0] || ''
  assert.match(cmdWrapperBlock, /display:\s*flex/)
  assert.doesNotMatch(cmdWrapperBlock, /display:\s*none/)
  assert.match(mainCss, /\.modal-overlay-top[\s\S]{0,60}?\{[^}]*z-index:\s*1020/)
  const modalFooterBlock = mainCss.match(/\.modal-footer\s*\{[^}]*\}/)?.[0] || ''
  assert.match(modalFooterBlock, /margin-top:\s*20px/)
  assert.doesNotMatch(modalFooterBlock, /margin-top:\s*auto/)

  const adminIndex = readWorkspaceFile('src/frontend/views/admin/index.vue')
  assert.match(adminIndex, /uninstall\.sh'\s*\|\s*\$\{sudoPrefix\}sh -s -- -y/)
  assert.doesNotMatch(adminIndex, /uninstall\.sh'\s*\|\s*sh -s`/)
  assert.doesNotMatch(adminIndex, /\bconfirm\s*\(/)
  assert.match(adminIndex, /result\.data\?\.token\s*\|\|\s*result\.token/)
  assert.match(adminIndex, /resolveSafeLoginRedirect\(route\.query\.redirect\)/)
  assert.match(adminIndex, /traffic_limit:\s*limitCheck\.value/)
  assert.match(adminIndex, /rx_correction:\s*rxCheck\.value/)
  assert.match(adminIndex, /tx_correction:\s*txCheck\.value/)
  assert.match(adminIndex, /syncInjectedAppConfig/)

  const serverTable = readWorkspaceFile('src/frontend/views/admin/components/ServerTable.vue')
  assert.match(serverTable, /<RegionFlag\s+:region="server\.region"\s*\/>/)
  assert.doesNotMatch(serverTable, /<img[^>]*class="flag-img"/)
  assert.match(serverTable, /Number\(server\.traffic_limit\)\s*>\s*0\s*\?\s*formatBytes\(gbToBytes\(server\.traffic_limit\)\)\s*:\s*'-'/)

  const timeoutModal = readWorkspaceFile('src/frontend/components/LiveConnectionTimeoutModal.vue')
  assert.match(timeoutModal, /useModal\(/)
  assert.doesNotMatch(timeoutModal, /@keydown\.esc/)

  const turnstileUtil = readWorkspaceFile('src/frontend/utils/turnstile.js')
  assert.match(turnstileUtil, /safeLocalStorage/)
  assert.doesNotMatch(turnstileUtil, /\blocalStorage\./)

  const dbPanel = readWorkspaceFile('src/frontend/views/admin/components/DatabasePanel.vue')
  assert.doesNotMatch(dbPanel, /location\.reload/)
  assert.match(dbPanel, /emit\('servers-imported'\)/)

  const copyModal = readWorkspaceFile('src/frontend/views/admin/components/CopyCommandModal.vue')
  const autoModal = readWorkspaceFile('src/frontend/views/admin/components/AutoDiscoveryCommandModal.vue')
  assert.match(copyModal, /maskedInstallCommand/)
  assert.match(copyModal, /showCommandSecret/)
  assert.match(autoModal, /maskedInstallCommand/)
  assert.match(autoModal, /showCommandSecret/)

  const editModal = readWorkspaceFile('src/frontend/views/admin/components/EditServerModal.vue')
  assert.match(editModal, /if\s*\(props\.settings\.notification_webhook_enabled\)\s*\{\s*return\s+Boolean\(String\(props\.settings\.notification_webhook_url/)
})
