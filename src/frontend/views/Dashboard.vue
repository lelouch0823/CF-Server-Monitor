<template>
  <div class="container" :class="{ 'mikus-dashboard': isMikusTheme }">
    <TerminalHeader :title="sysConfig.site_title || DEFAULT_SITE_TITLE" />
    
    <div v-if="isLoading" class="loading-state" :class="{ 'mikus-loading-state': isMikusTheme }">
      <template v-if="isMikusTheme">
        <div class="mikus-loading-inner">
          <img class="mikus-loading-gif" :src="mikusAsset('loli.gif')" alt="Loading">
          <div class="mikus-loading-brand">
            <img class="mikus-loading-logo" :src="mikusAsset('miku.png')" alt="">
            <span>{{ sysConfig.site_title || 'Komari' }}</span>
          </div>
          <div class="mikus-loading-progress" aria-hidden="true">
            <div class="mikus-loading-progress-fill"></div>
          </div>
          <div class="mikus-loading-status">$ {{ trans.loading }}</div>
        </div>
      </template>
      <template v-else>
        <div class="loading-spinner"></div>
        <div class="loading-text">$ {{ trans.loading }}</div>
      </template>
    </div>

    <template v-else>
    <div class="nav-area">
      <div class="header-row">
        <div class="site-title">$ {{ sysConfig.site_title || DEFAULT_SITE_TITLE }}</div>
        <div class="controls-group">
          <div class="view-toggle">
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'bar' }"
              @click="switchView('bar')"
            >▤ {{ trans.barChart }}</button>
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'ring' }"
              @click="switchView('ring')"
            >◌ {{ trans.ringChart }}</button>
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'table' }"
              @click="switchView('table')"
            >≡ {{ trans.table }}</button>
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'map' }"
              @click="switchView('map')"
            >◉ {{ trans.map }}</button>
          </div>
        </div>
      </div>
      <div class="filter-wrap" ref="filterWrap">
        <div class="filter-bar" id="ajax-filters">
          <button
            v-for="item in visibleFilterOptions"
            :key="item.code"
            type="button"
            class="filter-tag"
            :class="{ active: currentFilter === item.code, 'filter-tag-unknown': item.code === 'unknown' }"
            :data-filter="item.code"
            @click="setFilter(item.code)"
          >
            <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
            <RegionFlag v-else-if="item.flagCode" :region="item.code" :alt="item.code" />
            <span class="filter-tag-label">{{ item.label }}</span>
            <span class="filter-tag-count">{{ item.count }}</span>
          </button>
          <div v-if="overflowFilterOptions.length > 0" class="filter-more" :class="{ active: isOverflowFilterActive }">
            <button
              type="button"
              class="filter-tag filter-more-btn"
              :class="{ active: isOverflowFilterActive }"
              @click.stop="toggleFilterMore"
            >
              <span class="filter-tag-label">{{ filterMoreLabel }}</span>
              <span class="filter-tag-count">{{ overflowFilterOptions.length }}</span>
            </button>
            <div v-if="filterMoreOpen" class="filter-more-menu">
              <button
                v-for="item in overflowFilterOptions"
                :key="item.code"
                type="button"
                class="filter-tag filter-more-item"
                :class="{ active: currentFilter === item.code, 'filter-tag-unknown': item.code === 'unknown' }"
                :data-filter="item.code"
                @click="setFilter(item.code)"
              >
                <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
                <RegionFlag v-else-if="item.flagCode" :region="item.code" :alt="item.code" />
                <span class="filter-tag-label">{{ item.label }}</span>
                <span class="filter-tag-count">{{ item.count }}</span>
              </button>
            </div>
          </div>
        </div>
        <div ref="filterMeasure" class="filter-measure" aria-hidden="true">
          <button
            v-for="item in filterOptionEntries"
            :key="item.code"
            type="button"
            class="filter-tag filter-measure-tag"
          >
            <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
            <RegionFlag v-else-if="item.flagCode" :region="item.code" :alt="item.code" />
            <span class="filter-tag-label">{{ item.label }}</span>
            <span class="filter-tag-count">{{ item.count }}</span>
          </button>
          <button ref="filterMoreMeasure" type="button" class="filter-tag filter-more-btn">
            <span class="filter-tag-label">{{ filterMoreLabel }}</span>
            <span class="filter-tag-count">{{ filterOptionEntries.length }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="global-stats" :class="{ 'mikus-global-stats': isMikusTheme }">
      <div v-if="isMikusTheme" class="mikus-stats-mascot" aria-hidden="true">
        <img class="mikus-stats-mascot-img" :src="mikusAsset('QWQ.webp')" alt="">
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.servers }}</div>
        <div class="stat-main-value stat-main-value-sm stat-sub-info">
          <span class="stat-online-color">{{ trans.online }}:{{ stats.online }}</span> |
          <span class="stat-offline-color">{{ trans.offline }}:{{ stats.offline }}</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalTraffic }}</div>
        <div class="stat-main-value stat-main-value-sm">{{ formatBytes(stats.globalNetRx) }} ↓ | ↑ {{ formatBytes(stats.globalNetTx) }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.realtimeSpeed }}</div>
        <div class="stat-main-value stat-main-value-sm">
          <span class="stat-net-down-color">↓ {{ formatBytes(stats.globalSpeedIn) }}/s</span> |
          <span class="stat-net-up-color">↑ {{ formatBytes(stats.globalSpeedOut) }}/s</span>
        </div>
      </div>
      <div
        v-if="sysConfig.show_price"
        class="stat-item stat-action-item"
        @click="financeModalOpen = true"
      >
        <div class="stat-label">{{ trans.remainingValue }}</div>
        <div class="stat-main-value stat-main-value-sm">
          {{ formattedRemainingValue.symbol }}{{ formattedRemainingValue.value }}
          <span class="finance-currency-code">{{ formattedRemainingValue.currency }}</span>
        </div>
      </div>
    </div>

    <div id="view-card" class="view-panel" :class="{ active: isCardView, 'high-density': filteredServers.length > 12 }">
      <div v-if="groupedServers.length === 0" class="empty-state">
        [!] {{ trans.noServer }} <a href="/admin#/admin" class="admin-link-color">{{ trans.backToAdmin }}</a>{{ trans.noServerSuffix }}
      </div>
      <div v-else>
        <div v-for="group in groupedServers" :key="group.name" class="group-section">
          <div class="group-header" :data-group="group.name">
            <span class="prompt-sign">#</span> {{ group.name }} <span class="group-count">[{{ group.servers.length }}]</span>
          </div>
          <div class="servers-grid">
            <component
              :is="currentCardComponent"
              v-for="server in group.servers"
              :key="server.id + '-' + currentView"
              :server="server"
              :sys-config="localizedSysConfig"
              :to="getServerLink(server)"
            />
          </div>
        </div>
      </div>
    </div>

    <div id="view-table" class="view-panel" :class="{ active: currentView === 'table' }">
      <div class="table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th></th>
              <th>{{ trans.hostname }}</th>
              <th>{{ trans.region }}</th>
              <th>{{ trans.osArch }}</th>
              <th>{{ trans.cpu }}</th>
              <th>{{ trans.ram }}</th>
              <th>{{ trans.disk }}</th>
              <th>{{ trans.use }}</th>
              <th class="table-col-conn">TCP/UDP</th>
              <th width="95">{{ trans.dl }}</th>
              <th width="95">{{ trans.ul }}</th>
              <th width="70">{{ trans.update }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td class="table-empty-state" colspan="12">
                <div class="loading-spinner-small"></div>
                <span>$ {{ trans.loading }}</span>
              </td>
            </tr>
            <tr v-else-if="filteredServers.length === 0">
              <td class="table-empty-state" colspan="12">[*] {{ trans.noData }}</td>
            </tr>
            <tr 
              v-for="server in filteredServers" 
              :key="server.id"
              @click="goToServer(server)"
              class="table-cursor-pointer"
              :data-region="(server.region || 'xx').toLowerCase()"
            >
              <td class="table-center-cell">
                <div class="status-indicator table-status-indicator-inline" :style="{ background: getStatusColor(server) }"></div>
              </td>
              <td><b class="table-server-name" :title="server.name">{{ server.name }}</b></td>
              <td>
                <span class="country-os-icons">
                  <RegionFlag :region="server.region" />
                </span>
                {{ (server.region || 'XX').toUpperCase() }}
              </td>
              <td>
                <span class="table-system-info">
                  <OsIcon :os="server.os" />
                  <span class="os-label">{{ formatSystemOs(server.os) }} / {{ server.arch || 'N/A' }} </span>
                </span>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container stat-bar-small table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: getTableCpuPercent(server) + '%', background: getUsageColor(getTableCpuPercent(server)) }"></div>
                  </div>
                  <span>{{ getTableCpuPercent(server).toFixed(1) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: getTableRamPercent(server) + '%', background: getUsageColor(getTableRamPercent(server)) }"></div>
                  </div>
                  <span>{{ getTableRamPercent(server).toFixed(2) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: getTableDiskPercent(server) + '%', background: getUsageColor(getTableDiskPercent(server)) }"></div>
                  </div>
                  <span>{{ getTableDiskPercent(server).toFixed(2) }}%</span>
                </div>
              </td>
              <td v-if="sysConfig.show_tf && Number(server.traffic_limit) > 0">
                <div class="table-stat">
                  <div class="stat-bar-container stat-bar-small table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: clampPercent(calcTrafficUsagePercent(server)) + '%', background: getUsageColor(calcTrafficUsagePercent(server)) }"></div>
                  </div>
                  <span :title="formatTrafficPercentFullTitle(calcTrafficUsagePercent(server), 1) || undefined">{{ formatTrafficPercentNumber(calcTrafficUsagePercent(server), 1) }}%</span>
                </div>
              </td>
              <td v-else>-</td>
              <td class="table-conn-cell">
                <span class="conn-pair">{{ formatConnPair(server) }}</span>
              </td>
              <td>{{ formatBytes(server.net_in_speed) }}/s</td>
              <td>{{ formatBytes(server.net_out_speed) }}/s</td>
              <td class="update-time label-small">{{ getUpdateTime(server.last_updated) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div id="view-map" class="view-panel" :class="{ active: currentView === 'map' }">
      <div class="map-wrapper">
        <div ref="mapContainer" id="map-container"></div>
      </div>
    </div>
    </template>

    <div v-if="!isLoading && sitesRemaining > 0" class="loading-more">
      <div class="loading-spinner-small"></div>
      <span>{{ trans.loadingRemainingSites }} ({{ sitesRemaining }})</span>
    </div>

    <div v-if="hasCorsError" class="modal-overlay active" role="dialog" aria-modal="true" aria-label="cors error">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ cors --error</div>
          <button type="button" class="modal-close" @click="hasCorsError = null">✕</button>
        </div>
        <div v-for="site in hasCorsError" :key="site" class="danger-box mb-4">
          <div class="flex-center-gap-sm">
            <span class="danger-label">❌ {{ site }} {{ trans.corsBlocked }}</span>
          </div>
        </div>
        <div class="modal-footer flex-justify-end">
          <button type="button" @click="hasCorsError = null" class="btn">OK</button>
        </div>
      </div>
    </div>

    <div v-if="financeModalOpen" class="modal-overlay active" role="dialog" aria-modal="true" aria-label="finance summary" @click.self="financeModalOpen = false">
      <div class="modal-dialog finance-modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ finance --summary</div>
          <button type="button" class="modal-close" @click="financeModalOpen = false">✕</button>
        </div>

        <div class="finance-summary-grid">
          <div v-for="item in financeSummaryItems" :key="item.label" class="finance-summary-card">
            <div class="finance-summary-label">{{ item.label }}</div>
            <div class="finance-summary-value">
              <span class="finance-summary-symbol">{{ item.symbol }}</span>{{ item.value }}
            </div>
          </div>
        </div>

        <div class="finance-rate-toolbar">
          <div>
            <div class="finance-section-label">{{ trans.todayExchangeRates }}</div>
            <div class="finance-source-text">{{ trans.exchangeRateSource }}: {{ financeRateSourceText }}</div>
          </div>
          <label class="finance-currency-picker">
            <span>{{ trans.exchangeRateBase }}</span>
            <select :value="financeCurrency" class="form-select" @change="setFinanceCurrency">
              <option v-for="currency in financeRateCurrencies" :key="currency" :value="currency">
                {{ currency }}
              </option>
            </select>
          </label>
        </div>

        <div class="finance-rate-grid">
          <div v-for="row in exchangeRateRows" :key="row.currency" class="finance-rate-row">
            <span>{{ row.currency }}</span>
            <b>{{ row.targetSymbol }}{{ row.rate }}</b>
          </div>
        </div>

        <div class="finance-modal-meta">
          <span>{{ trans.configuredPrices }}: {{ financeSummary.configuredCount }}</span>
          <span>{{ trans.expired }}: {{ financeSummary.expiredCount }}</span>
          <span>{{ trans.financeMissingExpire }}: {{ financeSummary.missingExpireCount }}</span>
        </div>

        <div class="modal-footer flex-justify-end">
          <button @click="financeModalOpen = false" class="btn">OK</button>
        </div>
      </div>
    </div>

    <LiveConnectionTimeoutModal
      :show="showLiveTimeoutModal"
      :trans="trans"
      @close="closeLiveConnection"
      @continue="continueLiveConnection"
    />

    <Footer />
  </div>
</template>

<script setup>
import { ref, computed, inject, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import ServerBarCard from '../components/ServerBarCard.vue'
import ServerRingCard from '../components/ServerRingCard.vue'
import Footer from '../components/Footer.vue'
import OsIcon from '../components/OsIcon.vue'
import RegionFlag from '../components/RegionFlag.vue'
import LiveConnectionTimeoutModal from '../components/LiveConnectionTimeoutModal.vue'
import { fetchConfig, fetchServersAll, fetchServersAllWithProgress, formatBytes, createLiveSocket, getFlagRegionCode, isServerOnline, normalizeLiveSocketTimeoutMinutes } from '../utils/api.js'
import {
  calcTrafficUsagePercent,
  clampPercent,
  formatTrafficPercentFullTitle,
  formatTrafficPercentNumber,
  getUsageColor,
  safeUsagePercent
} from '../composables/useServerCardData'
import { getTitle, hasMultipleApiBases, getApiBases, getPublicAssetUrl } from '../utils/config'
import { currentLang, useTranslation } from '../utils/i18n.js'
import { TIME, DEFAULT_SITE_TITLE, STORAGE, LATENCY_WINDOW } from '../utils/constants'
import { normalizeTimestamp as normalizeMetricTimestamp } from '../utils/time.js'
import { normalizeDashboardView, normalizeDisplayMode, resolveDisplayMode } from '../utils/displayMode.js'
import { getPlaybackElapsedMs, resolvePlaybackCursor } from '../utils/playback.js'
import { getMikusAssetUrl, isMikusThemeEnabled, normalizeThemeOptions, setMikusThemeClass } from '../utils/themeOptions.js'
import { BUILTIN_PING_NODE_DEFAULTS, resolveLocalizedPingName } from '../utils/pingNode.js'
import { getActiveModalCount, useModal } from '../composables/useModal.js'
import { safeLocalStorage, safeSessionStorage } from '../utils/storage.js'
import {
  CURRENCY_SYMBOLS,
  DEFAULT_EXCHANGE_RATES,
  DISPLAY_FINANCE_CURRENCIES,
  calculateFinanceSummary,
  convertCnyAmount,
  formatFinanceAmount,
  getDailyExchangeRates,
  getStoredFinanceCurrency,
  normalizeFinanceCurrency,
  resolveFinanceNumberLocale,
  setStoredFinanceCurrency
} from '../utils/finance.js'

const DASHBOARD_FILTER_SESSION_KEY = 'cfsm_dashboard_region_filter'

const readInitialFilter = () => {
  const saved = String(safeSessionStorage.getItem(DASHBOARD_FILTER_SESSION_KEY) || '').trim().toLowerCase()
  return saved || 'all'
}

const servers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 })
const unknownStats = ref(0)
const appConfig = inject('appConfig', null)
const sysConfig = ref({
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_three_net_details: true,
  custom_ct_name: appConfig?.custom_ct_name || '电信',
  custom_cu_name: appConfig?.custom_cu_name || '联通',
  custom_cm_name: appConfig?.custom_cm_name || '移动',
  custom_bd_name: appConfig?.custom_bd_name || 'BGP',
  node_1_name: appConfig?.node_1_name || 'Node 1',
  node_2_name: appConfig?.node_2_name || 'Node 2',
  node_3_name: appConfig?.node_3_name || 'Node 3',
  node_4_name: appConfig?.node_4_name || 'Node 4',
  frontend_ws_timeout_minutes: normalizeLiveSocketTimeoutMinutes(appConfig?.frontend_ws_timeout_minutes),
  display_mode: 'bar',
  site_title: DEFAULT_SITE_TITLE,
  theme_options: normalizeThemeOptions(appConfig?.theme_options),
  latency_window: appConfig?.latency_window || {
    points: LATENCY_WINDOW.POINTS,
    hours: LATENCY_WINDOW.HOURS
  }
})
const regionStats = ref({})
const currentView = ref('bar')
const currentFilter = ref(readInitialFilter())
const filterWrap = ref(null)
const filterMeasure = ref(null)
const filterMoreMeasure = ref(null)
const filterVisibleCount = ref(Number.POSITIVE_INFINITY)
const filterMoreOpen = ref(false)
const mapInitialized = ref(false)
const liveConnected = ref(false)
const isLoading = ref(true)
const sitesRemaining = ref(0)
const hasCorsError = ref(null)
const financeModalOpen = ref(false)
const showLiveTimeoutModal = ref(false)
const financeCurrency = ref('CNY')
const exchangeRates = ref(DEFAULT_EXCHANGE_RATES)
const exchangeRateSource = ref('default')
const now = ref(Date.now())
const router = useRouter()

const trans = useTranslation()
const financeRateCurrencies = DISPLAY_FINANCE_CURRENCIES
const isMikusTheme = computed(() => isMikusThemeEnabled(sysConfig.value.theme_options))

const localizedSysConfig = computed(() => ({
  ...sysConfig.value,
  custom_ct_name: resolveLocalizedPingName(sysConfig.value.custom_ct_name, BUILTIN_PING_NODE_DEFAULTS.ct, trans.value.pingCt || 'CT'),
  custom_cu_name: resolveLocalizedPingName(sysConfig.value.custom_cu_name, BUILTIN_PING_NODE_DEFAULTS.cu, trans.value.pingCu || 'CU'),
  custom_cm_name: resolveLocalizedPingName(sysConfig.value.custom_cm_name, BUILTIN_PING_NODE_DEFAULTS.cm, trans.value.pingCm || 'CM'),
  custom_bd_name: resolveLocalizedPingName(sysConfig.value.custom_bd_name, BUILTIN_PING_NODE_DEFAULTS.bd, trans.value.pingBd || 'BGP'),
  node_1_name: resolveLocalizedPingName(sysConfig.value.node_1_name, BUILTIN_PING_NODE_DEFAULTS.node_1, trans.value.pingNode_1 || 'Node 1'),
  node_2_name: resolveLocalizedPingName(sysConfig.value.node_2_name, BUILTIN_PING_NODE_DEFAULTS.node_2, trans.value.pingNode_2 || 'Node 2'),
  node_3_name: resolveLocalizedPingName(sysConfig.value.node_3_name, BUILTIN_PING_NODE_DEFAULTS.node_3, trans.value.pingNode_3 || 'Node 3'),
  node_4_name: resolveLocalizedPingName(sysConfig.value.node_4_name, BUILTIN_PING_NODE_DEFAULTS.node_4, trans.value.pingNode_4 || 'Node 4')
}))

const getTableCpuPercent = (server) => clampPercent(server?.cpu)
const getTableRamPercent = (server) => safeUsagePercent(server?.ram_used, server?.ram_total, true)
const getTableDiskPercent = (server) => safeUsagePercent(server?.disk_used, server?.disk_total, true)

const mikusAsset = (filename) => getMikusAssetUrl(filename)

watch(isMikusTheme, (enabled) => {
  setMikusThemeClass(enabled)
}, { immediate: true })

const financeSummary = computed(() => calculateFinanceSummary(servers.value, exchangeRates.value, now.value))
const formattedRemainingValue = computed(() => formatFinanceMetric(financeSummary.value.remainingValueCNY))
const formattedTotalValue = computed(() => formatFinanceMetric(financeSummary.value.totalValueCNY))
const formattedMonthlyAverageCost = computed(() => formatFinanceMetric(financeSummary.value.monthlyAverageCostCNY))

const createFinanceSummaryItem = (label, metric) => ({
  label,
  symbol: metric.symbol,
  value: metric.value
})

const financeSummaryItems = computed(() => [
  createFinanceSummaryItem(trans.value.totalValue, formattedTotalValue.value),
  createFinanceSummaryItem(trans.value.remainingValue, formattedRemainingValue.value),
  createFinanceSummaryItem(trans.value.monthlyAverageCost, formattedMonthlyAverageCost.value)
])

const exchangeRateRows = computed(() => {
  const rawBase = Number(exchangeRates.value[financeCurrency.value] ?? DEFAULT_EXCHANGE_RATES[financeCurrency.value] ?? 1)
  const baseRate = Number.isFinite(rawBase) && rawBase > 0 ? rawBase : 1
  const locale = resolveFinanceNumberLocale(currentLang.value)
  return financeRateCurrencies.map(currency => {
    const rawTarget = Number(exchangeRates.value[currency] ?? DEFAULT_EXCHANGE_RATES[currency] ?? 1)
    const targetRate = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 1
    const rawRatio = targetRate / baseRate
    const safeRate = Number.isFinite(rawRatio) && rawRatio >= 0 ? rawRatio : 0
    return {
      currency,
      targetSymbol: CURRENCY_SYMBOLS[currency] || '',
      rate: new Intl.NumberFormat(locale, {
        maximumFractionDigits: 6,
        minimumFractionDigits: 6
      }).format(safeRate)
    }
  })
})

const financeRateSourceText = computed(() => {
  const sourceText = {
    network: trans.value.financeRateNetwork,
    cache: trans.value.financeRateCache,
    'stale-cache': trans.value.financeRateStaleCache,
    default: trans.value.financeRateDefault
  }
  return sourceText[exchangeRateSource.value] || sourceText.default
})

const formatFinanceMetric = (amountCNY) => {
  return formatFinanceAmount(
    convertCnyAmount(amountCNY, financeCurrency.value, exchangeRates.value),
    financeCurrency.value,
    currentLang.value
  )
}

const setFinanceCurrency = (event) => {
  const currency = normalizeFinanceCurrency(event?.target?.value)
  financeCurrency.value = currency
  setStoredFinanceCurrency(currency)
}

const loadFinanceRates = async () => {
  try {
    const { rates, source } = await getDailyExchangeRates()
    exchangeRates.value = rates
    exchangeRateSource.value = source
  } catch (e) {
    console.log('[INFO] Finance rates fallback:', e)
    exchangeRates.value = DEFAULT_EXCHANGE_RATES
    exchangeRateSource.value = 'default'
  }
}

const filterOptions = computed(() => {
  const normalizedStats = {}
  for (const code in regionStats.value) {
    const lower = code.toLowerCase()
    if (lower === 'xx') continue
    normalizedStats[lower] = regionStats.value[code]
  }
  const sortedRegionStats = Object.fromEntries(
    Object.entries(normalizedStats).sort(([codeA, countA], [codeB, countB]) => {
      if (countB !== countA) return countB - countA
      return codeA.localeCompare(codeB)
    })
  )
  const opts = { ...sortedRegionStats }
  if (unknownStats.value > 0) opts.unknown = unknownStats.value
  return opts
})

const getFilterLabel = (code) => {
  if (code === 'unknown') return '?'
  return code.toUpperCase()
}

const filterOptionEntries = computed(() => Object.entries(filterOptions.value).map(([code, count]) => ({
  code,
  count,
  label: getFilterLabel(code),
  flagCode: code !== 'all' && code !== 'unknown' ? getFlagRegionCode(code) : ''
})))

const filterMoreLabel = computed(() => trans.value.filterMore)
const visibleFilterOptions = computed(() => filterOptionEntries.value.slice(0, filterVisibleCount.value))
const overflowFilterOptions = computed(() => filterOptionEntries.value.slice(filterVisibleCount.value))
const isOverflowFilterActive = computed(() => overflowFilterOptions.value.some(item => item.code === currentFilter.value))

let filterResizeObserver = null
let filterMeasureTimer = null

const getFilterMaxRows = () => window.matchMedia('(max-width: 768px)').matches ? 2 : 1

const getWrappedRowCount = (widths, wrapWidth, gap) => {
  if (widths.length === 0) return 0

  let rows = 1
  let rowWidth = 0

  for (const width of widths) {
    const nextWidth = rowWidth > 0 ? rowWidth + gap + width : width
    if (nextWidth <= wrapWidth || rowWidth === 0) {
      rowWidth = nextWidth
    } else {
      rows += 1
      rowWidth = width
    }
  }

  return rows
}

const updateFilterVisibleCount = () => {
  const entries = filterOptionEntries.value
  const wrapEl = filterWrap.value
  const measureEl = filterMeasure.value
  if (!wrapEl || !measureEl || entries.length === 0) {
    filterVisibleCount.value = entries.length
    return
  }

  const wrapWidth = wrapEl.clientWidth
  const itemEls = Array.from(measureEl.querySelectorAll('.filter-measure-tag'))
  if (wrapWidth <= 0 || itemEls.length === 0) return

  const gap = Number.parseFloat(window.getComputedStyle(measureEl).columnGap) || 0
  const itemWidths = itemEls.map(el => el.offsetWidth)
  const maxRows = getFilterMaxRows()

  if (getWrappedRowCount(itemWidths, wrapWidth, gap) <= maxRows) {
    filterVisibleCount.value = entries.length
    filterMoreOpen.value = false
    return
  }

  const moreWidth = filterMoreMeasure.value?.offsetWidth || 70
  let visibleCount = 0

  for (let index = 0; index < itemWidths.length; index += 1) {
    const nextVisibleCount = index + 1
    const testWidths = [...itemWidths.slice(0, nextVisibleCount), moreWidth]
    if (getWrappedRowCount(testWidths, wrapWidth, gap) > maxRows) break
    visibleCount = nextVisibleCount
  }

  filterVisibleCount.value = Math.max(1, Math.min(visibleCount, entries.length - 1))
}

const scheduleFilterMeasurement = () => {
  if (filterMeasureTimer) clearTimeout(filterMeasureTimer)
  filterMeasureTimer = setTimeout(async () => {
    filterMeasureTimer = null
    await nextTick()
    updateFilterVisibleCount()
  }, 0)
}

const toggleFilterMore = () => {
  filterMoreOpen.value = !filterMoreOpen.value
}

const closeFilterMoreOnOutsideClick = (event) => {
  if (!filterWrap.value?.contains(event.target)) filterMoreOpen.value = false
}

watch(
  () => filterOptionEntries.value.map(item => `${item.code}:${item.count}:${item.label}`).join('|'),
  scheduleFilterMeasurement,
  { flush: 'post' }
)

watch(filterMoreLabel, scheduleFilterMeasurement, { flush: 'post' })

const filteredServers = computed(() => {
  if (currentFilter.value === 'all') return servers.value
  if (currentFilter.value === 'unknown') return servers.value.filter(s => !s.region)
  return servers.value.filter(s => (s.region || 'xx').toLowerCase() === currentFilter.value)
})

const groupedServers = computed(() => {
  const groups = {}
  const order = []
  filteredServers.value.forEach(server => {
    const groupName = server.server_group || 'Default'
    if (!groups[groupName]) {
      groups[groupName] = []
      order.push(groupName)
    }
    groups[groupName].push(server)
  })
  return order.map(name => ({ name, servers: groups[name] }))
})

const isCardView = computed(() => currentView.value === 'bar' || currentView.value === 'ring')
const currentCardComponent = computed(() => currentView.value === 'ring' ? ServerRingCard : ServerBarCard)

const switchView = (viewName) => {
  const normalizedView = normalizeDashboardView(viewName, sysConfig.value.display_mode)
  currentView.value = normalizedView
  safeLocalStorage.setItem(STORAGE.VIEW_PREFERENCE, normalizedView)
  if (normalizedView === 'map') {
    if (window.myMap) {
      setTimeout(() => window.myMap?.invalidateSize(), 100)
    } else if (!mapInitialized.value) {
      initMap()
    }
  }
}

const setFilter = (code) => {
  const nextFilter = String(code || 'all').toLowerCase()
  currentFilter.value = currentFilter.value === nextFilter ? 'all' : nextFilter
  safeSessionStorage.setItem(DASHBOARD_FILTER_SESSION_KEY, currentFilter.value)
  filterMoreOpen.value = false
}

const reconcileSavedFilter = () => {
  if (currentFilter.value === 'all' || servers.value.length === 0) return
  if (filteredServers.value.length === 0) {
    currentFilter.value = 'all'
    safeSessionStorage.setItem(DASHBOARD_FILTER_SESSION_KEY, 'all')
  }
}

const getStatusColor = (server) => {
  return isServerOnline(server) ? 'var(--accent-green)' : 'var(--accent-red)'
}

const formatConnCount = (value) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number) || number < 0) return '0'
  return number.toLocaleString('en-US')
}

const formatConnPair = (server) => `${formatConnCount(server.tcp_conn)} / ${formatConnCount(server.udp_conn)}`

const formatSystemOs = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return 'N/A'
  return raw
    .replace(/\s+gnu\/linux(?=\s|$)/gi, '')
    .replace(/\s+linux(?=\s|$)/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || raw
}

const getUpdateTime = (lastUpdated) => {
  if (!lastUpdated) return '-'
  const date = new Date(lastUpdated)
  const diff = now.value - date.getTime()

  const lang = currentLang.value
  // 时间差为负或小于1秒时，显示0秒前
  if (diff < 1000) {
    return lang === 'zh' ? `0${trans.value.secondsAgo}` : `0 ${trans.value.secondsAgo}`
  }

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) {
    return lang === 'zh' ? `${seconds}${trans.value.secondsAgo}` : `${seconds} ${trans.value.secondsAgo}`
  } else if (minutes < 60) {
    return lang === 'zh' ? `${minutes}${trans.value.minutesAgo}` : `${minutes} ${trans.value.minutesAgo}`
  } else if (hours < 24) {
    return lang === 'zh' ? `${hours}${trans.value.hoursAgo}` : `${hours} ${trans.value.hoursAgo}`
  } else if (days < 30) {
    return lang === 'zh' ? `${days}${trans.value.daysAgo}` : `${days} ${trans.value.daysAgo}`
  } else {
    return date.toLocaleString(undefined, { hour12: false })
  }
}

const PLAYBACK_TICK_MS = 1000
const MAX_BUFFER_SAMPLES_PER_SERVER = 600
const playbackBuffers = new Map()

const getServerReportTimestamp = (server, fallback = null) => {
  return normalizeMetricTimestamp(server?.report_timestamp ?? server?.last_updated, fallback)
}

const getServerSampleTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.sample_timestamp ?? server?.timestamp ?? server?.last_updated, null)
}

const getServerDisplayTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.display_timestamp, null)
}

const withDisplayTiming = (server, displayTs = null, currentTs = Date.now()) => {
  const reportTs = getServerReportTimestamp(server, null)
  const sampleTs = getServerSampleTimestamp(server) || displayTs || reportTs
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server) || sampleTs || reportTs)
  const timed = {
    ...server,
    current_timestamp: currentTs
  }
  if (reportTs) {
    timed.report_timestamp = reportTs
    timed.last_updated = reportTs
  }
  if (!sampleTs || !ownTs) return timed
  return {
    ...timed,
    sample_timestamp: sampleTs,
    display_timestamp: ownTs,
    sample_lag_seconds: Math.max(0, Math.floor((ownTs - sampleTs) / 1000))
  }
}

const toLiveSample = (serverId, data, timestamp, reportTs) => {
  if (!serverId || !data) return
  const ts = normalizeMetricTimestamp(timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp, null)
  if (!ts) return null
  return {
    serverId,
    ts,
    data,
    reportTs
  }
}

const queueLiveSamples = (serverId, samples, reportTs, { replayCachedReport = false, reportAgeMs = 0 } = {}) => {
  if (!serverId || !Array.isArray(samples) || samples.length === 0) return

  const normalized = samples
    .map(sample => toLiveSample(serverId, sample.data, sample.ts, reportTs))
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)

  if (normalized.length === 0) return

  const current = servers.value.find(s => s.id === serverId)
  const currentTs = getServerSampleTimestamp(current)
  const currentDisplayTs = getServerDisplayTimestamp(current)
  const incoming = replayCachedReport
    ? normalized
    : normalized.filter(sample => !currentTs || sample.ts > currentTs)
  if (incoming.length === 0) return

  const playbackStartTs = resolvePlaybackCursor(incoming[0].ts, currentDisplayTs, {
    replayCachedReport,
    reportAgeMs
  })
  if (playbackStartTs === null) return

  if (incoming.length === 1) {
    playbackBuffers.delete(serverId)
    const sample = incoming[0]
    applyServerSample(serverId, sample.data, sample.ts, playbackStartTs, reportTs)
    return
  }

  const unique = []
  const seen = new Set()
  for (const sample of incoming) {
    if (seen.has(sample.ts)) continue
    seen.add(sample.ts)
    unique.push(sample)
  }
  playbackBuffers.set(serverId, unique.slice(-MAX_BUFFER_SAMPLES_PER_SERVER))
  applyPlaybackSamplesForServer(serverId, playbackStartTs)
}

const queueLiveMessage = (msg, { replayCachedReport = false } = {}) => {
  if (!msg || msg.type !== 'batchUpdate') return

  const messageReportTs = normalizeMetricTimestamp(msg.ts, Date.now())

  const updates = Array.isArray(msg.updates) ? msg.updates : []

  for (const update of updates) {
    if (!update || !update.serverId) continue
    const samples = Array.isArray(update.samples) ? update.samples : []
    const reportTs = normalizeMetricTimestamp(update.reportTs ?? update.report_timestamp, messageReportTs)
    const reportAgeMs = replayCachedReport ? update.reportAgeMs : 0

    const liveSamples = []
    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') continue
      const data = sample.data || sample.payload || sample.metrics
      if (!data) continue
      liveSamples.push({
        ts: sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? update.ts ?? msg.ts,
        data
      })
    }
    queueLiveSamples(update.serverId, liveSamples, reportTs, { replayCachedReport, reportAgeMs })
  }
}

const replayLatestReportUpdates = (data) => {
  const updates = Array.isArray(data?.latestReportUpdates) ? data.latestReportUpdates : []
  if (updates.length === 0) return
  queueLiveMessage({ type: 'batchUpdate', ts: Date.now(), updates }, { replayCachedReport: true })
}

const applyServerSample = (serverId, data, sampleTs, displayTs, reportTs = null) => {
  if (!serverId || !data) return
  const idx = servers.value.findIndex(s => s.id === serverId)
  const existing = idx >= 0 ? servers.value[idx] : null
  const currentReportTs = getServerReportTimestamp(existing, null)
  const nextReportTs = normalizeMetricTimestamp(reportTs, currentReportTs || now.value)
  const merged = withDisplayTiming({
    ...data,
    id: serverId,
    report_timestamp: nextReportTs,
    last_updated: nextReportTs,
    sample_timestamp: sampleTs,
    timestamp: sampleTs
  }, displayTs, now.value)

  if (idx >= 0) {
    servers.value[idx] = { ...servers.value[idx], ...merged }
  } else {
    servers.value.push({ ...merged, name: serverId })
  }
}

const applyPlaybackSamplesForServer = (serverId, displayTs = null) => {
  const samples = playbackBuffers.get(serverId)
  if (!samples || samples.length === 0) return
  const server = servers.value.find(s => s.id === serverId)
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server))
  if (!ownTs) return

  let selected = null
  while (samples.length > 0 && samples[0].ts <= ownTs) {
    selected = samples.shift()
  }
  if (selected) {
    applyServerSample(serverId, selected.data, selected.ts, ownTs, selected.reportTs)
  }
  if (samples.length === 0) playbackBuffers.delete(serverId)
}

const applyPlaybackSamples = () => {
  for (const serverId of Array.from(playbackBuffers.keys())) {
    applyPlaybackSamplesForServer(serverId)
  }
}

const advanceServerClocks = () => {
  const currentTs = now.value
  // 就地更新计时字段而非每秒 map 重建全部对象：数组与对象引用保持稳定，
  // filter/group 等依赖数组身份的 computed 不会每秒失效，
  // 卡片组件的依赖精确跟踪到 display_timestamp 等具体字段
  for (const server of servers.value) {
    const reportTs = getServerReportTimestamp(server, null)
    const isOnline = reportTs && (currentTs - reportTs) < TIME.ONLINE_THRESHOLD_MS
    const currentDisplayTs = getServerDisplayTimestamp(server) || getServerSampleTimestamp(server) || reportTs
    const elapsedMs = getPlaybackElapsedMs(currentTs, server.current_timestamp, PLAYBACK_TICK_MS)
    const nextDisplayTs = isOnline && currentDisplayTs ? currentDisplayTs + elapsedMs : currentDisplayTs
    server.current_timestamp = currentTs
    if (reportTs) {
      server.report_timestamp = reportTs
      server.last_updated = reportTs
    }
    if (!nextDisplayTs) continue
    server.sample_timestamp = getServerSampleTimestamp(server) || nextDisplayTs || reportTs
    server.display_timestamp = nextDisplayTs
    server.sample_lag_seconds = Math.max(0, Math.floor((nextDisplayTs - (server.sample_timestamp || reportTs || nextDisplayTs)) / 1000))
  }
  applyPlaybackSamples()
}

const toSafePositiveNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

const recomputeStats = (currentTs = Date.now()) => {
  const list = servers.value || []
  let online = 0
  let speedIn = 0, speedOut = 0, netRx = 0, netTx = 0
  const regionCounts = {}
  let unknownCount = 0
  for (const s of list) {
    const ts = normalizeMetricTimestamp(s.report_timestamp ?? s.last_updated, 0)
    const isOnline = ts && (currentTs - ts) < TIME.ONLINE_THRESHOLD_MS
    if (isOnline) {
      online++
      speedIn += toSafePositiveNumber(s.net_in_speed)
      speedOut += toSafePositiveNumber(s.net_out_speed)
    }
    netRx += toSafePositiveNumber(s.net_rx)
    netTx += toSafePositiveNumber(s.net_tx)
    const validFlag = getFlagRegionCode(s.region)
    if (validFlag && validFlag !== 'xx') {
      const key = String(s.region).trim().toUpperCase()
      regionCounts[key] = (regionCounts[key] || 0) + 1
    } else {
      unknownCount++
    }
  }
  stats.value = {
    total: list.length,
    online,
    offline: list.length - online,
    globalNetRx: netRx,
    globalNetTx: netTx,
    globalSpeedIn: speedIn,
    globalSpeedOut: speedOut
  }
  regionStats.value = regionCounts
  unknownStats.value = unknownCount
}

const runDashboardTick = () => {
  now.value = Date.now()
  advanceServerClocks()
  recomputeStats(now.value)
  if (currentView.value === 'map') drawMarkers()
}

const mergeServersIntoList = (rawServers) => {
  const existingById = new Map(servers.value.map(s => [s.id, s]))
  return rawServers.map(s => {
    const prev = existingById.get(s.id)
    const sampleTs = normalizeMetricTimestamp(s.sample_timestamp ?? s.timestamp ?? s.last_updated, getServerSampleTimestamp(prev))
    const reportTs = normalizeMetricTimestamp(s.report_timestamp ?? s.last_updated, getServerReportTimestamp(prev, null))
    return withDisplayTiming({ ...prev, ...s, sample_timestamp: sampleTs, report_timestamp: reportTs }, sampleTs, now.value)
  })
}

const loadDashboardConfig = async () => {
  try {
    const localTitle = String(getTitle() || '').trim()
    const config = appConfig || await fetchConfig()
    const siteTitle = String(config?.site_title || '').trim()
    sysConfig.value = {
      ...sysConfig.value,
      site_title: hasMultipleApiBases() && localTitle ? localTitle : (siteTitle || sysConfig.value.site_title),
      custom_ct_name: config?.custom_ct_name ?? sysConfig.value.custom_ct_name,
      custom_cu_name: config?.custom_cu_name ?? sysConfig.value.custom_cu_name,
      custom_cm_name: config?.custom_cm_name ?? sysConfig.value.custom_cm_name,
      custom_bd_name: config?.custom_bd_name ?? sysConfig.value.custom_bd_name,
      node_1_name: config?.node_1_name ?? sysConfig.value.node_1_name,
      node_2_name: config?.node_2_name ?? sysConfig.value.node_2_name,
      node_3_name: config?.node_3_name ?? sysConfig.value.node_3_name,
      node_4_name: config?.node_4_name ?? sysConfig.value.node_4_name,
      display_mode: resolveDisplayMode(config),
      frontend_ws_timeout_minutes: normalizeLiveSocketTimeoutMinutes(config?.frontend_ws_timeout_minutes),
      theme_options: normalizeThemeOptions(config?.theme_options),
      latency_window: config?.latency_window || sysConfig.value.latency_window
    }
  } catch (e) {
    console.log('[INFO] Dashboard config pending...', e)
  }
}

const refreshData = async () => {
  const bases = getApiBases()
  const isMultiSite = bases.length > 1
  playbackBuffers.clear()

  if (isMultiSite) {
    sitesRemaining.value = bases.length
    hasCorsError.value = null

    try {
      const data = await fetchServersAllWithProgress((data) => {
        const rawServers = Array.isArray(data.servers)
          ? data.servers
          : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

        servers.value = mergeServersIntoList(rawServers)
        recomputeStats(now.value)

        sysConfig.value = {
          show_price: data.sysConfig?.show_price ?? true,
          show_expire: data.sysConfig?.show_expire ?? true,
          show_tf: data.sysConfig?.show_tf ?? true,
          show_three_net_details: data.sysConfig?.show_three_net_details ?? false,
          custom_ct_name: data.sysConfig?.custom_ct_name || sysConfig.value.custom_ct_name,
          custom_cu_name: data.sysConfig?.custom_cu_name || sysConfig.value.custom_cu_name,
          custom_cm_name: data.sysConfig?.custom_cm_name || sysConfig.value.custom_cm_name,
          custom_bd_name: data.sysConfig?.custom_bd_name || sysConfig.value.custom_bd_name,
          node_1_name: data.sysConfig?.node_1_name || sysConfig.value.node_1_name,
          node_2_name: data.sysConfig?.node_2_name || sysConfig.value.node_2_name,
          node_3_name: data.sysConfig?.node_3_name || sysConfig.value.node_3_name,
          node_4_name: data.sysConfig?.node_4_name || sysConfig.value.node_4_name,
          frontend_ws_timeout_minutes: sysConfig.value.frontend_ws_timeout_minutes,
          display_mode: normalizeDisplayMode(data.sysConfig?.display_mode),
          site_title: sysConfig.value.site_title || DEFAULT_SITE_TITLE,
          theme_options: sysConfig.value.theme_options,
          latency_window: data.sysConfig?.latency_window || sysConfig.value.latency_window
        }

        if (data.corsErrorSites?.length && !hasCorsError.value) hasCorsError.value = [...data.corsErrorSites]
        if (isLoading.value) isLoading.value = false
        drawMarkers()
        sitesRemaining.value = Math.max(0, sitesRemaining.value - 1)
      })
      replayLatestReportUpdates(data)
    } catch (e) {
      console.log('[INFO] Multi-site refresh error:', e)
    }

    isLoading.value = false
    return
  }

  // Single-site fallback
  try {
    const data = await fetchServersAll()
    if (!data) return

    const rawServers = Array.isArray(data.servers)
      ? data.servers
      : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

    servers.value = mergeServersIntoList(rawServers)
    replayLatestReportUpdates(data)
    recomputeStats(now.value)

    sysConfig.value = {
      show_price: data.sysConfig?.show_price ?? true,
      show_expire: data.sysConfig?.show_expire ?? true,
      show_tf: data.sysConfig?.show_tf ?? true,
      show_three_net_details: data.sysConfig?.show_three_net_details ?? false,
      custom_ct_name: data.sysConfig?.custom_ct_name || sysConfig.value.custom_ct_name,
      custom_cu_name: data.sysConfig?.custom_cu_name || sysConfig.value.custom_cu_name,
      custom_cm_name: data.sysConfig?.custom_cm_name || sysConfig.value.custom_cm_name,
      custom_bd_name: data.sysConfig?.custom_bd_name || sysConfig.value.custom_bd_name,
      node_1_name: data.sysConfig?.node_1_name || sysConfig.value.node_1_name,
      node_2_name: data.sysConfig?.node_2_name || sysConfig.value.node_2_name,
      node_3_name: data.sysConfig?.node_3_name || sysConfig.value.node_3_name,
      node_4_name: data.sysConfig?.node_4_name || sysConfig.value.node_4_name,
      frontend_ws_timeout_minutes: sysConfig.value.frontend_ws_timeout_minutes,
      display_mode: normalizeDisplayMode(data.sysConfig?.display_mode),
      site_title: sysConfig.value.site_title || DEFAULT_SITE_TITLE,
      theme_options: sysConfig.value.theme_options,
      latency_window: data.sysConfig?.latency_window || sysConfig.value.latency_window
    }

    drawMarkers()
    isLoading.value = false
  } catch (e) {
    console.log('[INFO] Full refresh pending...', e)
    isLoading.value = false
  }
}

// -------------------------------------------------------------------------
// 实时推送：
//   - 订阅 "all"，收到任何服务器的更新都会合并对应 server 的指标
// -------------------------------------------------------------------------
let liveSockets = []
let liveConnectionClosedByUser = false
let themeObserver = null
let timeUpdateInterval = null

const stopLiveSockets = () => {
  if (liveSockets.length === 0) return
  liveSockets.forEach(socket => {
    if (socket) socket.close()
  })
  liveSockets = []
  liveConnected.value = false
}

const startLiveSocket = () => {
  if (typeof document !== 'undefined' && document.hidden) {
    stopLiveSockets()
    return
  }

  stopLiveSockets()
  const bases = getApiBases()

  // 按 source 分组，每个 apiBase 只传自己的 server IDs
  const idsByIndex = new Map()
  for (const s of servers.value) {
    if (!s.id || !s.source) continue
    const idx = bases.indexOf(s.source)
    if (idx === -1) continue
    if (!idsByIndex.has(idx)) idsByIndex.set(idx, [])
    idsByIndex.get(idx).push(s.id)
  }

  // 如果没有配置多个 API bases，使用原来的单连接方式
  if (bases.length === 0) {
    const allIds = servers.value.map(s => s.id).filter(Boolean)
    liveSockets = [createLiveSocket('all', {
      replay: false,
      timeoutMinutes: sysConfig.value.frontend_ws_timeout_minutes,
      onMessage: queueLiveMessage,
      onTimeout: () => {
        showLiveTimeoutModal.value = true
      },
      onStatus: ({ connected }) => {
        liveConnected.value = !!connected
      }
    }, 0, allIds)]
    return
  }

  // 为每个 API base 创建独立的 WebSocket 连接，跳过没有服务器的 base
  liveSockets = bases.map((_, index) => {
    const ids = idsByIndex.get(index)
    if (!ids || ids.length === 0) return null
    return createLiveSocket('all', {
      replay: false,
      timeoutMinutes: sysConfig.value.frontend_ws_timeout_minutes,
      onMessage: queueLiveMessage,
      onTimeout: () => {
        showLiveTimeoutModal.value = true
      },
      onStatus: ({ connected }) => {
        const anyConnected = liveSockets.some(s => s && s.isConnected)
        liveConnected.value = anyConnected
      }
    }, index, ids)
  }).filter(Boolean)
}

const closeLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = true
  stopLiveSockets()
}

const continueLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = false
  if (liveSockets.length === 0) {
    startLiveSocket()
    return
  }
  liveSockets.forEach(socket => socket?.reconnect())
}

const handleVisibility = () => {
  if (document.hidden) {
    stopLiveSockets()
  } else if (showLiveTimeoutModal.value || liveConnectionClosedByUser) {
    return
  } else if (liveSockets.length === 0) {
    startLiveSocket()
  } else {
    liveSockets.forEach(socket => {
      if (socket) socket.reconnect()
    })
  }
}

let mapLoading = false
let isDashboardUnmounted = false

const initMap = () => {
  if (mapInitialized.value || mapLoading || isDashboardUnmounted) return
  mapLoading = true
  if (!window.L) {
    const existingScript = document.querySelector('script[data-leaflet-js]')
    if (existingScript) {
      existingScript.addEventListener('load', () => loadLeafletCSS(), { once: true })
      existingScript.addEventListener('error', () => {
        mapLoading = false
        mapInitialized.value = false
        existingScript.remove()
      }, { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = getPublicAssetUrl('files/leaflet.js')
    script.dataset.leafletJs = '1'
    script.onload = () => {
      loadLeafletCSS()
    }
    script.onerror = () => {
      mapLoading = false
      mapInitialized.value = false
      script.remove()
    }
    document.head.appendChild(script)
  } else {
    loadLeafletCSS()
  }
}

const loadLeafletCSS = () => {
  if (isDashboardUnmounted) {
    mapLoading = false
    return
  }
  // 防止重复进出地图视图时向 <head> 堆积重复的样式/脚本节点
  if (document.querySelector('link[data-leaflet-css]')) {
    createMap()
    return
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = getPublicAssetUrl('files/leaflet.css')
  link.dataset.leafletCss = '1'
  link.onload = () => {
    createMap()
  }
  link.onerror = () => {
    mapLoading = false
    mapInitialized.value = false
    link.remove()
  }
  document.head.appendChild(link)
}

const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768

// world geojson 体积较大：缓存到模块级变量，避免反复进出地图视图重复下载
let cachedWorldGeoJson = null

const createMap = () => {
  if (isDashboardUnmounted || !window.L) {
    mapLoading = false
    return
  }
  const containerEl = document.getElementById('map-container')
  if (!containerEl) {
    mapLoading = false
    return
  }
  if (window.myMap) {
    mapInitialized.value = true
    mapLoading = false
    drawMarkers()
    return
  }
  try {
    const mobileView = isMobile()
    window.myMap = window.L.map(containerEl, {
      zoomControl: false,
      attributionControl: false,
      minZoom: mobileView ? 1 : 1
    }).setView(mobileView ? [35, 105] : [30, 10], mobileView ? 1 : 2)

    window.L.control.zoom({ position: 'bottomright' }).addTo(window.myMap)
    mapInitialized.value = true
    mapLoading = false
    currentMapDataStr = ''
  } catch (e) {
    mapLoading = false
    mapInitialized.value = false
    console.error('[ERROR] Map init failed', e)
    return
  }

  if (cachedWorldGeoJson) {
    window.worldGeoJson = cachedWorldGeoJson
    drawMarkers()
    return
  }
  fetch(getPublicAssetUrl('files/world.zh.json'))
    .then(res => res.json())
    .then(worldGeoJson => {
      cachedWorldGeoJson = worldGeoJson
      window.worldGeoJson = worldGeoJson
      drawMarkers()
    })
    .catch(e => console.error('[ERROR] Map load failed', e))
}

const regionCoords = {
  'US': [37.09, -95.71], 'CN': [35.86, 104.19], 'JP': [36.20, 138.25], 'HK': [22.31, 114.16],
  'SG': [1.35, 103.81], 'KR': [35.90, 127.76], 'DE': [51.16, 10.45], 'GB': [55.37, -3.43],
  'NL': [52.13, 5.29], 'FR': [46.22, 2.21], 'CA': [56.13, -106.34], 'AU': [-25.27, 133.77],
  'IN': [20.59, 78.96], 'BR': [-14.23, -51.92], 'RU': [61.52, 105.31], 'ZA': [-30.55, 22.93],
  'TW': [23.69, 120.96], 'IT': [41.87, 12.56], 'SE': [60.12, 18.64], 'CH': [46.81, 8.22],
  'ES': [40.46, -3.74], 'PL': [51.91, 19.14], 'FI': [61.92, 25.74], 'NO': [60.47, 8.46],
  'DK': [56.26, 9.50], 'IE': [53.14, -7.69], 'AT': [47.51, 14.55], 'TR': [38.96, 35.24],
  'AE': [23.42, 53.84], 'MY': [4.21, 101.97], 'TH': [15.87, 100.99], 'VN': [14.05, 108.27],
  'PH': [12.87, 121.77], 'ID': [-0.78, 113.92]
}

let markersLayer, geoJsonLayer, currentMapDataStr = ""

const getThemeColors = () => {
  const isLight = typeof document !== 'undefined' && document.body.classList.contains('light')
  return {
    isLight,
    bgPrimary: isLight ? '#f5f5f0' : '#0a0e14',
    bgSecondary: isLight ? '#e8e8e0' : '#12171f',
    landFill: isLight ? '#d6d8ce' : '#1e2a3a',
    borderColor: isLight ? '#a8aca0' : '#0a0e14',
    accentGreen: isLight ? '#16a374' : '#00d4aa',
    markerText: isLight ? '#ffffff' : '#000000',
    colorBlack: isLight ? '#1f2937' : '#000000',
    colorWhite: '#ffffff'
  }
}

const drawMarkers = () => {
  if (!window.myMap || !window.worldGeoJson) return

  const newDataStr = JSON.stringify(regionStats.value)
  if (currentMapDataStr === newDataStr) return
  currentMapDataStr = newDataStr

  if (geoJsonLayer) window.myMap.removeLayer(geoJsonLayer)
  if (markersLayer) markersLayer.clearLayers()
  else markersLayer = window.L.layerGroup().addTo(window.myMap)

  const colors = getThemeColors()
  const activeIso2 = {}
  for (const code in regionStats.value) {
    const upperCode = code.toUpperCase()
    activeIso2[upperCode] = true
    if (upperCode === 'HK' || upperCode === 'TW' || upperCode === 'MO') {
      activeIso2['CN'] = true
    }
  }

  geoJsonLayer = window.L.geoJSON(window.worldGeoJson, {
    style: function(feature) {
      const isActive = activeIso2[feature.properties.iso_a2]
      return {
        fillColor: isActive ? colors.accentGreen : colors.landFill,
        weight: 1,
        opacity: 0.85,
        color: colors.borderColor,
        fillOpacity: isActive ? (colors.isLight ? 0.55 : 0.4) : (colors.isLight ? 0.65 : 0.2)
      }
    }
  }).addTo(window.myMap)

  for (const [code, count] of Object.entries(regionStats.value)) {
    const upperCode = code.toUpperCase()
    const safeCount = Math.max(0, Number.parseInt(count, 10) || 0)
    if (safeCount > 0 && regionCoords[upperCode]) {
      const icon = window.L.divIcon({
        className: 'custom-map-marker',
        html: `<div style="background:${colors.accentGreen}; color:${colors.markerText}; border-radius:999px; min-width:22px; height:22px; padding:0 5px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:bold; white-space:nowrap; border:2px solid ${colors.bgPrimary}; box-shadow:0 0 10px ${colors.accentGreen}80; font-family:JetBrains Mono,monospace;">${safeCount}</div>`,
        iconSize: null
      })
      window.L.marker(regionCoords[upperCode], { icon }).addTo(markersLayer)
    }
  }
}

const getServerLink = (server) => {
  // server.id 可能含路由特殊字符（?#& 等），统一 encodeURIComponent（与 admin 侧一致）
  const bases = getApiBases()
  if (bases.length === 0) return `/server/${encodeURIComponent(server.id)}`
  
  const apiIndex = bases.indexOf(server.source)
  if (apiIndex === -1 || apiIndex === 0) return `/server/${encodeURIComponent(server.id)}`
  
  return `/server/${encodeURIComponent(server.id)}?apiIndex=${apiIndex}`
}

const goToServer = (server) => {
  router.push(getServerLink(server))
}

useModal(() => Boolean(hasCorsError.value), () => { hasCorsError.value = null })
useModal(financeModalOpen, () => { financeModalOpen.value = false })

const handleGlobalKeydown = (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented || getActiveModalCount() > 0) return
  if (filterMoreOpen.value) {
    filterMoreOpen.value = false
  }
}

onMounted(async () => {
  isDashboardUnmounted = false
  financeCurrency.value = getStoredFinanceCurrency()
  loadFinanceRates()

  await loadDashboardConfig()
  const rawSavedView = safeLocalStorage.getItem(STORAGE.VIEW_PREFERENCE)
  const savedView = normalizeDashboardView(rawSavedView, sysConfig.value.display_mode)
  currentView.value = savedView
  if (rawSavedView && rawSavedView !== savedView) {
    safeLocalStorage.setItem(STORAGE.VIEW_PREFERENCE, savedView)
  }
  await refreshData()
  reconcileSavedFilter()
  await nextTick()
  scheduleFilterMeasurement()
  if (window.ResizeObserver && filterWrap.value) {
    filterResizeObserver = new ResizeObserver(scheduleFilterMeasurement)
    filterResizeObserver.observe(filterWrap.value)
  } else {
    window.addEventListener('resize', scheduleFilterMeasurement)
  }
  document.addEventListener('click', closeFilterMoreOnOutsideClick)
  window.addEventListener('keydown', handleGlobalKeydown)
  startLiveSocket()
  document.addEventListener('visibilitychange', handleVisibility)

  // 每秒更新 now 变量，使相对时间实时刷新
  runDashboardTick()
  timeUpdateInterval = setInterval(runDashboardTick, 1000)

  if (currentView.value === 'map') {
    switchView('map')
  }

  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class' && currentView.value === 'map') {
        currentMapDataStr = ''
        drawMarkers()
      }
    })
  })
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
})

onUnmounted(() => {
  isDashboardUnmounted = true
  mapLoading = false
  mapInitialized.value = false
  document.removeEventListener('visibilitychange', handleVisibility)
  document.removeEventListener('click', closeFilterMoreOnOutsideClick)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', scheduleFilterMeasurement)
  if (filterMeasureTimer) clearTimeout(filterMeasureTimer)
  if (filterResizeObserver) filterResizeObserver.disconnect()
  if (timeUpdateInterval) clearInterval(timeUpdateInterval)
  stopLiveSockets()
  if (themeObserver) themeObserver.disconnect()
  // 销毁 Leaflet 实例：不清除会泄漏挂载在 window/document 上的事件监听
  if (window.myMap) {
    window.myMap.remove()
    window.myMap = null
  }
})
</script>

<style scoped>
.filter-tag :deep(.flag-img) {
  width: 14px;
  height: 10px;
  object-fit: cover;
  border-radius: 1px;
}

.filter-tag :deep(.flag-fallback) {
  font-size: 12px;
  line-height: 1;
}
</style>
