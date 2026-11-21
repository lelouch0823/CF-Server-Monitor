<template>
  <div class="container">
    <TerminalHeader :title="server.name || trans.loading || 'Loading...'" />
    
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">$ {{ trans.loading || 'Loading...' }}</div>
    </div>

    <div v-else-if="loadError" class="loading-state">
      <div class="loading-text">$ {{ trans.loadFailed }}</div>
      <button type="button" class="retry-btn" @click="retryInitialLoad">{{ trans.retry }}</button>
    </div>

    <template v-else>
    
    <div class="nav-bar">
      <router-link to="/" class="back-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        {{ trans.back }}
      </router-link>
      <div class="time-selector" v-show="historyLoaded" id="time-selector">
        <button 
          v-for="option in timeOptions" 
          :key="option.hours"
          class="time-btn"
          :class="{ active: currentHours === option.hours }"
          @click="setTimeRange(option.hours)"
        >{{ option.label }}</button>
      </div>
    </div>

    <div class="host-card">
      <div class="host-card-header">
        <div class="host-name">
          <span class="prompt">root@</span>
          <span class="country-os-icons">
            <RegionFlag :region="server.region" />
            <OsIcon :os="server.os" />
          </span>
          <span class="host-server-title" :title="server.name">{{ server.name || trans.loading || 'Loading...' }}</span>
          <span style="color: var(--text-muted);">:~#</span>
        </div>
        <span class="status-badge" :class="{ online: isOnline, offline: !isOnline }">
          <span class="pulse-dot" :class="{ online: isOnline, offline: !isOnline }"></span>
          <span>{{ isOnline ? trans.online : trans.offline }}</span>
        </span>
      </div>
      <div class="sysinfo-grid" id="info-panel">
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏱ {{ trans.uptime }}</span>
          <span class="sysinfo-value">{{ formatUptime(server.boot_time) }}</span>
        </div>
        <div class="sysinfo-item" v-if="server.expire_date">
          <span class="sysinfo-label">📅 {{ trans.expire }}</span>
          <span class="sysinfo-value" :class="{ 'expired': isExpired }">{{ expireDaysText }}<template v-if="expireDateFormatted"> ({{ expireDateFormatted }})</template></span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💻 {{ trans.os }} / {{ trans.architecture }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.os || 'N/A' }} / {{ server.arch || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item" v-if="server.kernel_version">
          <span class="sysinfo-label">🧩 {{ trans.kernelVersion || 'Kernel' }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.kernel_version }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🔧 {{ trans.cpuInfo }}</span>
          <span class="sysinfo-value sysinfo-small">{{ server.cpu_info || 'N/A' }} x {{ server.cpu_cores || 'N/A' }}</span>
        </div>
        <div class="sysinfo-item" v-if="hasGpuData">
          <span class="sysinfo-label">🎮 {{ trans.gpuInfo || 'GPU Info' }}</span>
          <span class="sysinfo-value sysinfo-small gpu-summary-ellipsis" :title="gpuInfoFullTitle || gpuInfoText">{{ gpuInfoText }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">💾 {{ trans.totalDiskRam }}</span>
          <span class="sysinfo-value">{{ formatBytes(mibToBytes(server.disk_total)) }} / {{ formatBytes(mibToBytes(server.ram_total)) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">📊 {{ trans.loadAvg }}</span>
          <span class="sysinfo-value highlight">{{ formattedLoadAvgText }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🌐 {{ trans.totalTraffic }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_rx) }} / ↑ {{ formatBytes(server.net_tx) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⚡ {{ trans.realtimeSpeed }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_in_speed) }}/s / ↑ {{ formatBytes(server.net_out_speed) }}/s</span>
        </div>
        <div class="sysinfo-item" v-if="hasMonthlyTrafficPanel">
          <span class="sysinfo-label">📊 {{ trans.monthlyTraffic }}</span>
          <span class="sysinfo-value sysinfo-small">↓ {{ formatBytes(server.net_rx_monthly) }} / ↑ {{ formatBytes(server.net_tx_monthly) }}</span>
        </div>
        <div class="sysinfo-item" v-if="hasMonthlyTrafficPanel">
          <span class="sysinfo-label">📦 {{ trans.monthlyTrafficLimit }}</span>
          <span class="sysinfo-value sysinfo-small">
            {{ formatBytes(trafficUsageBytes) }}
            /
            {{ Number(server.traffic_limit) > 0 ? formatBytes(gbToBytes(server.traffic_limit)) : (trans.unlimited || '∞') }}
          </span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">🕐 {{ trans.bootTime }}</span>
          <span class="sysinfo-value sysinfo-small">{{ formatTimestamp(server.boot_time) }}</span>
        </div>
        <div class="sysinfo-item">
          <span class="sysinfo-label">⏰ {{ trans.lastUpdate }}</span>
          <span class="sysinfo-value sysinfo-small">{{ lastUpdateText }}</span>
        </div>
      </div>
    </div>

    <div class="charts-container">
      <div class="chart-card" :class="{ 'full-width': isChartExpanded('cpu') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.cpuUsage }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value">{{ cpuPercent }}%</span>
            <ChartExpandButton :expanded="isChartExpanded('cpu')" @toggle="toggleChartExpanded('cpu')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="cpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('ram') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.memoryUsage }}
          </span>
          <div class="chart-header-actions">
            <div class="chart-current-value-container">
              <span class="chart-current-value">{{ ramPercent }}%</span>
              <div class="chart-subtitle">{{ trans.swap }}: {{ formatBytes(mibToBytes(server.swap_used)) }} / {{ formatBytes(mibToBytes(server.swap_total)) }}</div>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('ram')" @toggle="toggleChartExpanded('ram')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="ramChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('net') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.networkTraffic }}
          </span>
          <div class="chart-header-actions">
            <div class="net-indicator">
              <span class="net-down">▼ {{ formatBytes(server.net_in_speed) }}/s</span>
              <span class="net-up">▲ {{ formatBytes(server.net_out_speed) }}/s</span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('net')" @toggle="toggleChartExpanded('net')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="netChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('load') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.loadAvgMonitor }}
          </span>
          <div class="chart-header-actions">
            <div class="load-avg-row">
              <span class="load-1m">{{ trans.load1m }} <b>{{ (parseLoadAvg(server.load_avg)[0] || 0).toFixed(2) }}</b></span>
              <span class="load-5m">{{ trans.load5m }} <b>{{ (parseLoadAvg(server.load_avg)[1] || 0).toFixed(2) }}</b></span>
              <span class="load-15m">{{ trans.load15m }} <b>{{ (parseLoadAvg(server.load_avg)[2] || 0).toFixed(2) }}</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('load')" @toggle="toggleChartExpanded('load')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="loadChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('disk') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.diskUsage }}
          </span>
          <div class="chart-header-actions">
            <div class="chart-current-value-container">
              <span class="chart-current-value">{{ diskPercent }}%</span>
              <div class="chart-subtitle">{{ trans.used }} {{ formatBytes(mibToBytes(server.disk_used)) }} / {{ formatBytes(mibToBytes(server.disk_total)) }}</div>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('disk')" @toggle="toggleChartExpanded('disk')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('diskIo') }" v-show="hasDiskIoData">
        <div class="chart-card-header disk-io-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.diskIo || 'Disk IO' }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span class="net-down">R <b>{{ formatBytes(diskIo.read_bps) }}/s</b></span>
              <span class="net-up">W <b>{{ formatBytes(diskIo.write_bps) }}/s</b></span>
              <span class="conn-tcp">IOPS <b>{{ formatDiskIoNumber(diskIo.read_iops) }}/{{ formatDiskIoNumber(diskIo.write_iops) }}</b></span>
              <span class="conn-udp">await <b>{{ formatDiskIoNumber(diskIo.await_ms) }}ms</b></span>
              <span>util <b>{{ formatDiskIoNumber(diskIo.util) }}%</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('diskIo')" @toggle="toggleChartExpanded('diskIo')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="diskIoChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('gpu') }" v-show="hasGpuData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuUsage || 'GPU Usage' }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value gpu-header-value" :title="gpuPercentFullTitle || undefined">{{ gpuPercentText }}</span>
            <ChartExpandButton :expanded="isChartExpanded('gpu')" @toggle="toggleChartExpanded('gpu')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="gpuChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('gpuMem') }" v-show="hasGpuMemData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuMemory || 'GPU Memory' }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value gpu-header-value" :title="gpuMemFullTitle || undefined">{{ gpuMemText }}</span>
            <ChartExpandButton :expanded="isChartExpanded('gpuMem')" @toggle="toggleChartExpanded('gpuMem')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="gpuMemChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('gpuClock') }" v-show="hasGpuClockData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuClock || 'GPU SM Clock' }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value gpu-header-value" :title="gpuClockFullTitle || undefined">{{ gpuClockText }}</span>
            <ChartExpandButton :expanded="isChartExpanded('gpuClock')" @toggle="toggleChartExpanded('gpuClock')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="gpuClockChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('gpuPower') }" v-show="hasGpuPowerData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.gpuPower || 'GPU Power' }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value gpu-header-value" :title="gpuPowerFullTitle || undefined">{{ gpuPowerText }}</span>
            <ChartExpandButton :expanded="isChartExpanded('gpuPower')" @toggle="toggleChartExpanded('gpuPower')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="gpuPowerChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('proc') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.processes }}
          </span>
          <div class="chart-header-actions">
            <span class="chart-current-value">{{ safeIntDisplay(server.processes) }}</span>
            <ChartExpandButton :expanded="isChartExpanded('proc')" @toggle="toggleChartExpanded('proc')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="procChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('conn') }">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.connections }}
          </span>
          <div class="chart-header-actions">
            <div class="net-indicator">
              <span class="conn-tcp">TCP <b>{{ safeIntDisplay(server.tcp_conn) }}</b></span>
              <span class="conn-udp">UDP <b>{{ safeIntDisplay(server.udp_conn) }}</b></span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('conn')" @toggle="toggleChartExpanded('conn')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="connChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('ping') }" v-show="hasPingData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.latencyMonitor }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span v-for="item in visiblePingStats" :key="item.field" :class="item.className" :title="item.label">
                <span class="probe-stat-label">{{ item.label }}</span> <b>{{ item.value !== null ? item.value + 'ms' : trans.timeout }}</b>
              </span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('ping')" @toggle="toggleChartExpanded('ping')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="pingChartRef"></canvas>
        </div>
      </div>

      <div class="chart-card" :class="{ 'full-width': isChartExpanded('loss') }" v-show="hasLossData">
        <div class="chart-card-header">
          <span class="chart-title">
            <span class="chart-title-icon">▸</span>
            {{ trans.packetLoss || 'Packet Loss' }}
          </span>
          <div class="chart-header-actions">
            <div class="ping-indicator">
              <span v-for="item in visibleLossStats" :key="item.field" :class="item.className" :title="item.label">
                <span class="probe-stat-label">{{ item.label }}</span> <b>{{ item.value }}%</b>
              </span>
            </div>
            <ChartExpandButton :expanded="isChartExpanded('loss')" @toggle="toggleChartExpanded('loss')" />
          </div>
        </div>
        <div class="chart-body">
          <canvas ref="lossChartRef"></canvas>
        </div>
      </div>
    </div>
    </template>

    <Footer />

    <div id="loginRequiredModal" class="modal-overlay" :class="{ active: showLoginModal }" role="dialog" aria-modal="true" aria-label="login required" @click.self="showLoginModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ sudo login</div>
          <button type="button" class="modal-close" @click="showLoginModal = false">✕</button>
        </div>
        <div class="modal-body-content">
          <p class="modal-body-text">{{ trans.loginRequired }}</p>
        </div>
        <div class="modal-footer flex-justify-between">
          <button type="button" @click="goToLogin" class="btn btn-primary">{{ trans.login }}</button>
          <button type="button" @click="showLoginModal = false" class="btn">{{ trans.cancel }}</button>
        </div>
      </div>
    </div>

    <div
      v-if="noticeModalMessage"
      id="noticeAlertModal"
      class="modal-overlay modal-overlay-top active"
      role="alertdialog"
      aria-modal="true"
      @click.self="noticeModalMessage = ''"
    >
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ system --notice</div>
          <button class="modal-close" type="button" @click="noticeModalMessage = ''">✕</button>
        </div>
        <div class="modal-body-content">
          <p class="modal-body-text">{{ noticeModalMessage }}</p>
        </div>
        <div class="modal-footer flex-justify-end">
          <button type="button" class="btn btn-primary" @click="noticeModalMessage = ''">OK</button>
        </div>
      </div>
    </div>

    <LiveConnectionTimeoutModal
      :show="showLiveTimeoutModal"
      :trans="trans"
      @close="closeLiveConnection"
      @continue="continueLiveConnection"
    />
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import Footer from '../components/Footer.vue'
import OsIcon from '../components/OsIcon.vue'
import RegionFlag from '../components/RegionFlag.vue'
import LiveConnectionTimeoutModal from '../components/LiveConnectionTimeoutModal.vue'
import { fetchServerDetail, fetchAllHistory, fetchConfig, formatBytes, gbToBytes, mibToBytes, createLiveSocket, isServerOnline, normalizeLiveSocketTimeoutMinutes } from '../utils/api.js'
import { isAdminLoggedIn } from '../utils/http'
import { clampPercent, getTrafficUsageBytes, safeUsagePercent } from '../composables/useServerCardData'
import Chart from 'chart.js/auto'
import { currentLang, t, useTranslation } from '../utils/i18n'
import { CHART, HISTORY } from '../utils/constants'
import { formatDateTime, normalizeTimestamp as normalizeMetricTimestamp } from '../utils/time.js'
import useTheme from '../composables/useTheme'
import { useModal } from '../composables/useModal.js'
import { isDisabledProbeMetric, resolveCustomPingNodeName } from '../utils/server.js'
import { resolvePlaybackCursor } from '../utils/playback.js'
import { applyMikusThemeOptions } from '../utils/themeOptions.js'
import { BUILTIN_PING_NODE_DEFAULTS, resolveLocalizedPingName } from '../utils/pingNode.js'

const route = useRoute()
const router = useRouter()
const appConfig = inject('appConfig', null)

let serverId = route.params.id
if (!serverId) {
  const urlParams = new URLSearchParams(window.location.search)
  serverId = urlParams.get('id')
}

const apiIndex = ref(0)
const indexParam = route.query.apiIndex
if (indexParam !== undefined && indexParam !== null && !isNaN(parseInt(indexParam))) {
  apiIndex.value = parseInt(indexParam)
}

const server = ref({})
const REALTIME_HISTORY_HOURS = 0.167
const LATEST_REPORT_MAX_REPLAY_DELAY = 120000
const REPORT_CHART_UPDATE_INTERVAL_MS = 30000
const currentHours = ref(REALTIME_HISTORY_HOURS)
const lastUpdateText = ref('')
const config = ref(null)
const runtimeConfigRef = ref(null)
const showLoginModal = ref(false)
const showLiveTimeoutModal = ref(false)
const noticeModalMessage = ref('')
const frontendWsTimeoutMinutes = ref(0)
const loading = ref(true)
const loadError = ref(false)

const trans = useTranslation()

const ChartExpandButton = {
  props: {
    expanded: { type: Boolean, default: false }
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    const getLabel = () => props.expanded ? trans.value.collapseChart : trans.value.expandChart

    return () => h('button', {
      type: 'button',
      class: ['chart-expand-btn', { active: props.expanded }],
      title: getLabel(),
      'aria-label': getLabel(),
      'aria-pressed': props.expanded ? 'true' : 'false',
      onClick: () => emit('toggle')
    }, [
      h('svg', {
        viewBox: '0 0 24 24',
        width: '16',
        height: '16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      }, props.expanded
        ? [
            h('polyline', { points: '4 14 10 14 10 20' }),
            h('polyline', { points: '20 10 14 10 14 4' })
          ]
        : [
            h('polyline', { points: '15 3 21 3 21 9' }),
            h('polyline', { points: '9 21 3 21 3 15' }),
            h('line', { x1: '21', y1: '3', x2: '14', y2: '10' }),
            h('line', { x1: '3', y1: '21', x2: '10', y2: '14' })
          ])
    ])
  }
}

const PING_FIELD_DEFS = [
  { key: 'ct', field: 'ping_ct', lossField: 'loss_ct', nameKey: 'custom_ct_name', labelKey: 'pingCt', fallback: 'CT', className: 'ping-ct', datasetIndex: 0 },
  { key: 'cu', field: 'ping_cu', lossField: 'loss_cu', nameKey: 'custom_cu_name', labelKey: 'pingCu', fallback: 'CU', className: 'ping-cu', datasetIndex: 1 },
  { key: 'cm', field: 'ping_cm', lossField: 'loss_cm', nameKey: 'custom_cm_name', labelKey: 'pingCm', fallback: 'CM', className: 'ping-cm', datasetIndex: 2 },
  { key: 'bd', field: 'ping_bd', lossField: 'loss_bd', nameKey: 'custom_bd_name', labelKey: 'pingBd', fallback: 'BGP', className: 'ping-bd', datasetIndex: 3 },
  { key: 'node_1', field: 'ping_node_1', lossField: 'loss_node_1', nameKey: 'node_1_name', labelKey: 'pingNode_1', fallback: 'Node 1', className: 'ping-node-1', datasetIndex: 4 },
  { key: 'node_2', field: 'ping_node_2', lossField: 'loss_node_2', nameKey: 'node_2_name', labelKey: 'pingNode_2', fallback: 'Node 2', className: 'ping-node-2', datasetIndex: 5 },
  { key: 'node_3', field: 'ping_node_3', lossField: 'loss_node_3', nameKey: 'node_3_name', labelKey: 'pingNode_3', fallback: 'Node 3', className: 'ping-node-3', datasetIndex: 6 },
  { key: 'node_4', field: 'ping_node_4', lossField: 'loss_node_4', nameKey: 'node_4_name', labelKey: 'pingNode_4', fallback: 'Node 4', className: 'ping-node-4', datasetIndex: 7 }
]

const resolveEffectiveCustomPingName = (nameKey, key) => {
  const authoritative = runtimeConfigRef.value?.__updatedByAdminAt
    ? runtimeConfigRef.value
    : (apiIndex.value === 0 && appConfig?.__updatedByAdminAt ? appConfig : null)
  if (authoritative && Object.hasOwn(authoritative, nameKey)) {
    return resolveCustomPingNodeName(key, authoritative[nameKey])
  }
  for (const src of [config.value, runtimeConfigRef.value, appConfig]) {
    const custom = resolveCustomPingNodeName(key, src?.[nameKey])
    if (custom) return custom
  }
  return ''
}

const pingLabel = (key) => {
  const def = PING_FIELD_DEFS.find(item => item.key === key)
  const nameKey = def?.nameKey || (key.startsWith('node_') ? `${key}_name` : `custom_${key}_name`)
  const customName = resolveEffectiveCustomPingName(nameKey, key)
  const builtinDefault = BUILTIN_PING_NODE_DEFAULTS[key] || def?.fallback || key.toUpperCase()
  const localizedFallback = (def?.labelKey && trans.value[def.labelKey]) || def?.fallback || key.toUpperCase()
  return resolveLocalizedPingName(customName, builtinDefault, localizedFallback)
}

const MAX_LEGEND_LABEL_LENGTH = 24
const truncateChartLegendLabel = (value, maxLen = MAX_LEGEND_LABEL_LENGTH) => {
  const text = String(value ?? '').trim()
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}…`
}

const DISK_IO_FIELDS = ['read_bps', 'write_bps', 'read_iops', 'write_iops', 'await_ms', 'util']
const EMPTY_DISK_IO = Object.freeze(Object.fromEntries(DISK_IO_FIELDS.map(field => [field, 0])))
const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key)
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
const parseDiskIoValue = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : null
}

const isValidDiskIoObject = (disk) => {
  if (!isPlainObject(disk)) return false
  return DISK_IO_FIELDS.some(field => hasOwn(disk, field) && parseDiskIoValue(disk[field]) !== null)
}

const hasValidDiskIoPayload = (source) => {
  if (!isPlainObject(source)) return false
  return isValidDiskIoObject(source.disk)
}

const isDiskIoField = (key) => key === 'disk'

const getDiskIoNumber = (source, field) => {
  if (!source || typeof source !== 'object' || !isValidDiskIoObject(source.disk)) return 0
  const raw = hasOwn(source.disk, field) ? source.disk[field] : null
  return parseDiskIoValue(raw) ?? 0
}

const normalizeDiskIo = (source) => Object.fromEntries(
  DISK_IO_FIELDS.map(field => [field, getDiskIoNumber(source, field)])
)

const diskIoAccessor = (field) => (row) => getDiskIoNumber(row, field)
const formatDiskIoNumber = (value) => {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number.toFixed(1) : '0.0'
}
const formatDiskIoAxisTick = (value) => {
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return '0'
  const abs = Math.abs(number)
  if (abs >= 10000) return `${(number / 1000).toFixed(0)}k`
  if (abs >= 1000) return `${(number / 1000).toFixed(1)}k`
  if (abs >= 100) return number.toFixed(0)
  return number.toFixed(1)
}

const timeOptions = computed(() => {
  return [
    { hours: REALTIME_HISTORY_HOURS, label: '10m' },
    { hours: 0.5, label: '30m' },
    { hours: 1, label: '1h' },
    { hours: 6, label: '6h' },
    { hours: 12, label: '12h' },
    { hours: 24, label: '24h' },
    { hours: 48, label: '2d' },
    { hours: 96, label: '4d' },
    { hours: 168, label: '7d' },
  ]
})

const isOnline = computed(() => isServerOnline(server.value))

const cpuPercent = computed(() => clampPercent(server.value.cpu).toFixed(1))

const safeIntDisplay = (value) => {
  const num = Number.parseInt(value, 10)
  return Number.isFinite(num) && num >= 0 ? String(num) : '0'
}

const hasMonthlyTrafficPanel = computed(() => (
  server.value.net_rx_monthly != null ||
  server.value.net_tx_monthly != null ||
  Number(server.value.traffic_limit) > 0
))

const parseGpuInfo = (raw) => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

const gpuInfoList = computed(() => parseGpuInfo(server.value.gpu_info))

const gpuInfoFullTitle = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return ''
  return list.map((g, i) => g.name || g.id || `GPU ${i}`).join(' / ')
})

const gpuInfoText = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return server.value.gpu_info || 'N/A'
  if (list.length <= 2) {
    return list.map(g => g.name || g.id || 'GPU').join(' / ')
  }
  const counts = new Map()
  for (const g of list) {
    const name = String(g.name || g.id || 'GPU').trim() || 'GPU'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  const grouped = Array.from(counts.entries()).map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
  if (grouped.length <= 2) return grouped.join(' / ')
  return `${grouped.slice(0, 2).join(' / ')} (+${grouped.length - 2})`
})

const formatCompactMultiGpuSummary = (items) => {
  if (items.length === 0) return { text: 'N/A', title: '' }
  if (items.length <= 2) return { text: items.join(' / '), title: '' }
  return {
    text: `${items.slice(0, 2).join(' / ')} (+${items.length - 2})`,
    title: items.join(' / ')
  }
}

const gpuPercentSummary = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return { text: '0.0%', title: '' }
  const formatUtil = (info) => {
    if (info === null || info === undefined || info === '') return 'N/A'
    const v = Number(info)
    return Number.isFinite(v) ? `${clampPercent(v).toFixed(1)}%` : 'N/A'
  }
  return formatCompactMultiGpuSummary(list.map(g => formatUtil(g.info)))
})
const gpuPercentText = computed(() => gpuPercentSummary.value.text)
const gpuPercentFullTitle = computed(() => gpuPercentSummary.value.title)

const gpuDetailValue = (g, field) => {
  if (!g || g[field] === null || g[field] === undefined || g[field] === '') return null
  const v = Number(g[field])
  return Number.isFinite(v) && v >= 0 ? v : null
}

// 旧版 Agent 不上报这些扩展字段，缺失时隐藏对应图表
const hasGpuMemData = computed(() => gpuInfoList.value.some(g => gpuDetailValue(g, 'mem_used') !== null))
const hasGpuClockData = computed(() => gpuInfoList.value.some(g => gpuDetailValue(g, 'sm_clock') !== null))
const hasGpuPowerData = computed(() => gpuInfoList.value.some(g => gpuDetailValue(g, 'power') !== null))

const gpuMemSummary = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return { text: 'N/A', title: '' }
  const items = list.map(g => {
    const used = gpuDetailValue(g, 'mem_used')
    if (used === null) return 'N/A'
    const total = gpuDetailValue(g, 'mem_total')
    return total !== null ? `${formatBytes(mibToBytes(used))} / ${formatBytes(mibToBytes(total))}` : formatBytes(mibToBytes(used))
  })
  return formatCompactMultiGpuSummary(items)
})
const gpuMemText = computed(() => gpuMemSummary.value.text)
const gpuMemFullTitle = computed(() => gpuMemSummary.value.title)

const gpuClockSummary = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return { text: 'N/A', title: '' }
  const items = list.map(g => {
    const v = gpuDetailValue(g, 'sm_clock')
    return v === null ? 'N/A' : `${Math.round(v)} MHz`
  })
  return formatCompactMultiGpuSummary(items)
})
const gpuClockText = computed(() => gpuClockSummary.value.text)
const gpuClockFullTitle = computed(() => gpuClockSummary.value.title)

const gpuPowerSummary = computed(() => {
  const list = gpuInfoList.value
  if (list.length === 0) return { text: 'N/A', title: '' }
  const items = list.map(g => {
    const v = gpuDetailValue(g, 'power')
    return v === null ? 'N/A' : `${v.toFixed(1)} W`
  })
  return formatCompactMultiGpuSummary(items)
})
const gpuPowerText = computed(() => gpuPowerSummary.value.text)
const gpuPowerFullTitle = computed(() => gpuPowerSummary.value.title)

const ramPercent = computed(() => safeUsagePercent(server.value.ram_used, server.value.ram_total, true).toFixed(2))
const diskPercent = computed(() => safeUsagePercent(server.value.disk_used, server.value.disk_total, true).toFixed(2))
const diskIo = computed(() => hasValidDiskIoPayload(server.value) ? normalizeDiskIo(server.value) : EMPTY_DISK_IO)
const hasGpuData = computed(() => gpuInfoList.value.length > 0)

const formatDateOnly = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  if (dateOnly) return dateOnly
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

const expireDateFormatted = computed(() => formatDateOnly(server.value.expire_date))

// date-only 字符串（YYYY-MM-DD）按本地零点解析并以当天结束作为到期时刻，
// 避免 `new Date('YYYY-MM-DD')` 按 UTC 零点解析导致 UTC- 时区提前一天显示"已到期"
const parseExpireTimestamp = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).getTime()
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? NaN : time
}

const isExpired = computed(() => {
  if (!server.value.expire_date) return false
  const expTime = parseExpireTimestamp(server.value.expire_date)
  return Number.isNaN(expTime) ? false : expTime < Date.now()
})

const expireDaysText = computed(() => {
  if (!server.value.expire_date) return ''
  const expTime = parseExpireTimestamp(server.value.expire_date)
  if (Number.isNaN(expTime)) return ''
  const diff = expTime - Date.now()
  const days = Math.ceil(diff / (1000 * 3600 * 24))
  return days > 0 ? `${days}${days === 1 ? trans.value.day : trans.value.days}` : trans.value.expired
})

const cpuChartRef = ref(null)
const gpuChartRef = ref(null)
const gpuMemChartRef = ref(null)
const gpuClockChartRef = ref(null)
const gpuPowerChartRef = ref(null)
const ramChartRef = ref(null)
const diskChartRef = ref(null)
const diskIoChartRef = ref(null)
const netChartRef = ref(null)
const procChartRef = ref(null)
const connChartRef = ref(null)
const pingChartRef = ref(null)
const lossChartRef = ref(null)
const loadChartRef = ref(null)
const historyLoaded = ref(false)
const hasDiskIoData = ref(false)

const charts = {}
const chartsReady = ref(false)
const expandedCharts = ref({})
const lossHistoryFields = ref({})
const avgPingCt = ref(null)
const avgPingCu = ref(null)
const avgPingCm = ref(null)
const avgPingBd = ref(null)
const avgPingNode1 = ref(null)
const avgPingNode2 = ref(null)
const avgPingNode3 = ref(null)
const avgPingNode4 = ref(null)
const avgLossCt = ref(null)
const avgLossCu = ref(null)
const avgLossCm = ref(null)
const avgLossBd = ref(null)
const avgLossNode1 = ref(null)
const avgLossNode2 = ref(null)
const avgLossNode3 = ref(null)
const avgLossNode4 = ref(null)
let chartInitPromise = null
let databaseUpgradeAlertShown = false
let lastReportChartUpdateTime = 0

const isChartExpanded = (key) => !!expandedCharts.value[key]

const resizeChartAfterLayout = (key) => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const chart = charts[key]
      if (!chart) return
      if (typeof chart.resize === 'function') chart.resize()
      chart.update('none')
    })
  })
}

const toggleChartExpanded = (key) => {
  expandedCharts.value = {
    ...expandedCharts.value,
    [key]: !expandedCharts.value[key]
  }
  resizeChartAfterLayout(key)
}

const showDiskIoChart = () => {
  if (hasDiskIoData.value) return
  hasDiskIoData.value = true
  nextTick(() => {
    if (!charts.diskIo) return
    if (typeof charts.diskIo.resize === 'function') charts.diskIo.resize()
    charts.diskIo.update('none')
  })
}

const markDiskIoDataAvailable = (source) => {
  const hasReadableData = hasValidDiskIoPayload(source)
  if (hasReadableData) showDiskIoChart()
  return hasReadableData
}

const avgPingRefs = {
  ping_ct: avgPingCt,
  ping_cu: avgPingCu,
  ping_cm: avgPingCm,
  ping_bd: avgPingBd,
  ping_node_1: avgPingNode1,
  ping_node_2: avgPingNode2,
  ping_node_3: avgPingNode3,
  ping_node_4: avgPingNode4
}

const avgLossRefs = {
  loss_ct: avgLossCt,
  loss_cu: avgLossCu,
  loss_cm: avgLossCm,
  loss_bd: avgLossBd,
  loss_node_1: avgLossNode1,
  loss_node_2: avgLossNode2,
  loss_node_3: avgLossNode3,
  loss_node_4: avgLossNode4
}

const visiblePingFields = computed(() => PING_FIELD_DEFS.filter(item => {
  const value = server.value[item.field]
  return value !== undefined && !isDisabledProbeMetric(value)
}))
const hasPingData = computed(() => visiblePingFields.value.length > 0)
const visiblePingStats = computed(() => visiblePingFields.value.map(item => ({
  ...item,
  label: pingLabel(item.field.replace('ping_', '')),
  value: avgPingRefs[item.field].value
})))
const visibleLossFields = computed(() => PING_FIELD_DEFS.filter(item => (
  server.value[item.field] !== undefined &&
  !isDisabledProbeMetric(server.value[item.field]) &&
  (lossHistoryFields.value[item.lossField] || isLossValid(server.value[item.lossField]))
)))
const visibleLossStats = computed(() => visibleLossFields.value.map(item => ({
  ...item,
  field: item.lossField,
  label: pingLabel(item.field.replace('ping_', '')),
  value: avgLossRefs[item.lossField].value
})).filter(item => item.value !== null))

const trafficUsageBytes = computed(() => getTrafficUsageBytes(server.value))

const safeDestroyCharts = () => {
  try {
    for (const key of Object.keys(charts)) {
      if (charts[key]) { charts[key].destroy(); charts[key] = null }
    }
  } catch (e) { /* ignore */ }
}

const parseLoadAvg = (loadAvgStr) => {
  if (!loadAvgStr) return [0, 0, 0]
  const parts = String(loadAvgStr).trim().split(/\s+/)
  const toSafeLoad = (raw) => {
    const val = Number(raw)
    return Number.isFinite(val) && val >= 0 ? val : 0
  }
  return [toSafeLoad(parts[0]), toSafeLoad(parts[1]), toSafeLoad(parts[2])]
}

const formattedLoadAvgText = computed(() => {
  const [l1, l5, l15] = parseLoadAvg(server.value.load_avg)
  return `${l1.toFixed(2)} ${l5.toFixed(2)} ${l15.toFixed(2)}`
})

const isLossValid = (value) => {
  if (isDisabledProbeMetric(value) || value === null || value === undefined || value === '') return false
  return Number.isFinite(Number(value))
}
const formatLoss = (value) => isLossValid(value) ? `${Math.max(0, Math.min(100, Number(value))).toFixed(0)}%` : ''
const hasLossData = computed(() => visibleLossFields.value.length > 0)
const formatPing = (value) => {
  const num = Number(value)
  if (value === null || value === undefined || value === '' || value === 'null' || !Number.isFinite(num) || num <= 0) {
    return trans.value.timeout
  }
  return `${Math.round(num)}ms`
}

const parseBootTimeToMs = (bootTime) => {
  if (!bootTime) return null
  
  if (typeof bootTime === 'string' && !/^\d+$/.test(bootTime)) {
    const date = new Date(bootTime)
    if (isNaN(date.getTime())) return null
    return date.getTime()
  } else {
    let timestamp = parseInt(bootTime)
    if (isNaN(timestamp)) return null
    if (timestamp < 1000000000000) {
      timestamp *= 1000
    }
    return timestamp
  }
}

const formatUptime = (bootTime) => {
  const bootTimeMs = parseBootTimeToMs(bootTime)
  if (!bootTimeMs) return 'N/A'
  
  const diffMs = Date.now() - bootTimeMs
  
  if (diffMs < 0) return 'N/A'
  
  const seconds = Math.floor(diffMs / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  const hoursStr = String(hours).padStart(2, '0')
  const minutesStr = String(minutes).padStart(2, '0')
  
  if (days > 0) {
    return `${days}${days === 1 ? trans.value.day : trans.value.days}, ${hoursStr}:${minutesStr}`
  } else {
    return `${hoursStr}:${minutesStr}`
  }
}

const formatTimestamp = (bootTime) => {
  const bootTimeMs = parseBootTimeToMs(bootTime)
  if (!bootTimeMs) return 'N/A'
  return formatDateTime(bootTimeMs)
}

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const getChartTimestamp = (point) => {
  return normalizeMetricTimestamp(point?.x ?? point, 0) || 0
}

const createChartPoint = (timestamp, y) => ({
  x: String(timestamp),
  y
})

const formatChartAxisTime = (value) => {
  const ts = normalizeMetricTimestamp(value, null)
  if (!ts) return ''
  const date = new Date(ts)
  const pad = (num) => String(num).padStart(2, '0')
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (currentHours.value <= 1) return `${time}:${pad(date.getSeconds())}`
  if (currentHours.value <= 3) return time
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

const syncChartLabels = (chart) => {
  if (!chart) return
  const seen = new Set()
  const timestamps = []
  for (const dataset of chart.data.datasets || []) {
    for (const point of dataset.data || []) {
      const ts = normalizeMetricTimestamp(point?.x ?? point, null)
      if (!ts) continue
      if (!seen.has(ts)) {
        seen.add(ts)
        timestamps.push(ts)
      }
    }
  }
  timestamps.sort((a, b) => a - b)
  chart.data.labels = timestamps.map(ts => String(ts))
}

const ds = (label, color, opts = {}) => ({
  label: truncateChartLegendLabel(label),
  fullLabel: String(label ?? ''),
  data: [],
  borderColor: color,
  backgroundColor: opts.fill ? hexToRgba(color, 0.05) : 'transparent',
  fill: !!opts.fill,
  tension: opts.tension ?? 0.4,
  borderWidth: 1.5,
  pointRadius: 0,
  hoverRadius: 5,
  spanGaps: false,
  ...opts
})

const GPU_COLORS = [
  '#ff7b72', '#79c0ff', '#d2a8ff', '#7ee787',
  '#ffa657', '#f778ba', '#56d4dd', '#e3b341',
  '#39d2c0', '#a5d6ff', '#ff9bce', '#b392f0',
  '#ffd33d', '#58a6ff', '#3fb950', '#f0883e'
]

const GPU_DETAIL_CHART_KEYS = ['gpu', 'gpuMem', 'gpuClock', 'gpuPower']

const GPU_CHART_FIELD = {
  gpu: 'info',
  gpuMem: 'mem_used',
  gpuClock: 'sm_clock',
  gpuPower: 'power'
}

const gpuFieldAccessor = (gpuId, chartKey) => (d) => {
  const list = parseGpuInfo(d?.gpu_info)
  const found = list.find(g => String(g.id) === String(gpuId))
  if (!found) return null
  const val = gpuDetailValue(found, GPU_CHART_FIELD[chartKey])
  if (val === null) return null
  return chartKey === 'gpu' ? clampPercent(val) : val
}

const CHART_DEFS = [
  { key: 'cpu', ref: () => cpuChartRef.value, datasets: () => [ds(trans.value.cpu || 'CPU', '#00d4aa', { fill: true })], unit: '%', percentScale: true },
  { key: 'gpu', ref: () => gpuChartRef.value, datasets: () => [], unit: '%', legend: true, percentScale: true },
  { key: 'gpuMem', ref: () => gpuMemChartRef.value, datasets: () => [], legend: true, tickFormat: (v) => formatBytes(mibToBytes(v)) },
  { key: 'gpuClock', ref: () => gpuClockChartRef.value, datasets: () => [], unit: ' MHz', legend: true },
  { key: 'gpuPower', ref: () => gpuPowerChartRef.value, datasets: () => [], unit: ' W', legend: true },
  { key: 'ram', ref: () => ramChartRef.value, datasets: () => [ds(trans.value.ram || 'Memory', '#b392f0', { fill: true }), ds(trans.value.swap || 'Swap', '#ffb870', { fill: true })], unit: '%', legend: true, percentScale: true },
  { key: 'disk', ref: () => diskChartRef.value, datasets: () => [ds(trans.value.disk || 'Disk', '#39d2c0', { fill: true })], unit: '%', percentScale: true },
  {
    key: 'diskIo',
    ref: () => diskIoChartRef.value,
    datasets: () => [
      ds('Read', '#00d4aa', { fill: true, yAxisID: 'y', formatValue: (v) => formatBytes(v) + '/s' }),
      ds('Write', '#ffb870', { fill: true, yAxisID: 'y', formatValue: (v) => formatBytes(v) + '/s' }),
      ds('Read IOPS', '#4da6ff', { yAxisID: 'y1', borderDash: [5, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ops/s` }),
      ds('Write IOPS', '#b392f0', { yAxisID: 'y1', borderDash: [5, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ops/s` }),
      ds('await', '#f778ba', { yAxisID: 'y1', borderDash: [2, 4], formatValue: (v) => `${formatDiskIoNumber(v)} ms` }),
      ds('util', '#ff7b72', { yAxisID: 'y1', borderDash: [8, 4], formatValue: (v) => `${formatDiskIoNumber(v)}%` })
    ],
    legend: true,
    tickFormat: (v) => formatBytes(v),
    extraScales: (chartTheme) => ({
      y1: {
        beginAtZero: true,
        position: 'right',
        grid: { color: chartTheme.grid, drawBorder: false, drawOnChartArea: false, tickLength: 0 },
        ticks: {
          color: chartTheme.axis,
          font: { size: 9, family: "'JetBrains Mono', monospace" },
          padding: 8,
          callback: formatDiskIoAxisTick
        }
      }
    })
  },
  { key: 'proc', ref: () => procChartRef.value, datasets: () => [ds(trans.value.processes || 'Processes', '#f778ba', { fill: true })] },
  { key: 'net', ref: () => netChartRef.value, datasets: () => [ds(trans.value.dl || 'Download', '#00d4aa', { fill: true }), ds(trans.value.ul || 'Upload', '#4da6ff', { fill: true })], legend: true, formatValue: (v) => formatBytes(v) + '/s', tickFormat: (v) => formatBytes(v) },
  { key: 'conn', ref: () => connChartRef.value, datasets: () => [ds('TCP', '#b392f0'), ds('UDP', '#f778ba')], legend: true },
  { key: 'ping', ref: () => pingChartRef.value, datasets: () => ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'].map((key, i) => ds(pingLabel(key), ['#00d4aa', '#ffb870', '#4da6ff', '#b392f0', '#ff7b72', '#79c0ff', '#7ee787', '#ffa657'][i], { tension: 0.3 })), unit: ' ms', legend: true },
  { key: 'loss', ref: () => lossChartRef.value, datasets: () => ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'].map((key, i) => ds(pingLabel(key), ['#00d4aa', '#ffb870', '#4da6ff', '#b392f0', '#ff7b72', '#79c0ff', '#7ee787', '#ffa657'][i], { tension: 0.3 })), unit: '%', legend: true, percentScale: true },
  { key: 'load', ref: () => loadChartRef.value, datasets: () => [ds(trans.value.load1m || '1 Min', '#00d4aa', { tension: 0.3 }), ds(trans.value.load5m || '5 Min', '#ffb870', { tension: 0.3 }), ds(trans.value.load15m || '15 Min', '#4da6ff', { tension: 0.3 })], legend: true }
]

const syncProbeChartVisibility = () => {
  for (const chartKey of ['ping', 'loss']) {
    const chart = charts[chartKey]
    if (!chart) continue

    for (const item of PING_FIELD_DEFS) {
      const dataset = chart.data.datasets[item.datasetIndex]
      if (!dataset) continue
      const value = server.value[item.field]
      const disabled = isDisabledProbeMetric(value)
      // 与 WSS 保持一致：字段不存在(undefined)或为 false 时不显示；
      // null 表示超时，仍需保留在图表中，不能当作“无数据”隐藏。
      const noReport = value === undefined
      dataset.disabledProbe = disabled
      dataset.noDataProbe = noReport
      // Only force hide if disabled by config; otherwise preserve user's legend toggle
      if (disabled || noReport) {
        dataset.hidden = true
        if (typeof chart.setDatasetVisibility === 'function') {
          chart.setDatasetVisibility(item.datasetIndex, false)
        }
      }
    }
    chart.update('none')
  }
}

let lastGpuSignature = ''

const rebuildGpuChartDatasets = () => {
  const list = gpuInfoList.value
  const signature = list.map((g, i) => `${g.id ?? i}:${g.name ?? ''}`).join(',')
  if (signature === lastGpuSignature) return
  lastGpuSignature = signature

  for (const chartKey of GPU_DETAIL_CHART_KEYS) {
    const chart = charts[chartKey]
    if (!chart) continue
    const newDatasets = list.map((g, i) => {
      const opts = chartKey === 'gpuMem'
        ? { fill: true, formatValue: (v) => formatBytes(mibToBytes(v)) }
        : { fill: true }
      const rawName = g.name ? (list.length > 4 ? `#${i} ${g.name}` : g.name) : `GPU ${i}`
      const dataset = ds(rawName, GPU_COLORS[i % GPU_COLORS.length], opts)
      dataset.gpuId = String(g.id ?? i)
      return dataset
    })
    if (newDatasets.length === 0) {
      newDatasets.push(ds('GPU', '#ff7b72', { fill: true }))
    }
    if (chart.options?.plugins?.legend) {
      chart.options.plugins.legend.maxHeight = list.length > 4 ? 52 : undefined
      if (chart.options.plugins.legend.labels) {
        chart.options.plugins.legend.labels.padding = list.length > 4 ? 6 : 12
        chart.options.plugins.legend.labels.boxWidth = list.length > 4 ? 8 : 10
      }
    }
    chart.data.datasets = newDatasets
    chart.update('none')
  }
}

const refreshLocalizedChartLabels = () => {
  for (const def of CHART_DEFS) {
    if (GPU_DETAIL_CHART_KEYS.includes(def.key)) continue
    const chart = charts[def.key]
    if (!chart) continue
    const freshDatasets = def.datasets()
    freshDatasets.forEach((fresh, index) => {
      const target = chart.data.datasets[index]
      if (!target) return
      target.label = fresh.label
      target.fullLabel = fresh.fullLabel
    })
    chart.update('none')
  }
}

const getCssVar = (name, fallback) => {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.body).getPropertyValue(name).trim()
  return value || fallback
}

const isLightBodyTheme = () => typeof document !== 'undefined' && document.body.classList.contains('light')

const getChartThemeColors = () => ({
  axis: getCssVar('--text-muted', isLightBodyTheme() ? 'rgba(10, 14, 20, 0.8)' : 'rgba(211, 218, 227, 0.8)'),
  grid: getCssVar('--border-color', 'rgba(30, 42, 58, 0.5)'),
  tooltipBg: getCssVar('--bg-primary', 'rgba(10, 14, 20, 0.95)'),
  tooltipTitle: getCssVar('--accent-green', '#00d4aa'),
  tooltipBody: getCssVar('--text-primary', '#d3dae3'),
  tooltipBorder: getCssVar('--border-color', '#1e2a3a')
})

const initCharts = () => {
  safeDestroyCharts()

  const chartTheme = getChartThemeColors()

  Chart.defaults.font.family = "'JetBrains Mono', 'Courier New', monospace"
  Chart.defaults.font.size = 10
  Chart.defaults.color = chartTheme.axis
  Chart.defaults.plugins.tooltip.backgroundColor = chartTheme.tooltipBg
  Chart.defaults.plugins.tooltip.titleColor = chartTheme.tooltipTitle
  Chart.defaults.plugins.tooltip.bodyColor = chartTheme.tooltipBody
  Chart.defaults.plugins.tooltip.borderColor = chartTheme.tooltipBorder
  Chart.defaults.plugins.tooltip.borderWidth = 1
  Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: 'bold', family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.bodyFont = { size: 11, family: "'JetBrains Mono', monospace" }
  Chart.defaults.plugins.tooltip.padding = 12
  Chart.defaults.plugins.tooltip.cornerRadius = 2

  const createChartOptions = (unit = '', showLegend = false, formatCallback = null, tickFormat = null, extraScales = null, percentScale = false) => {
    const resolvedExtraScales = typeof extraScales === 'function'
      ? extraScales(chartTheme)
      : (extraScales || {})

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: CHART.ANIMATION_DURATION, easing: 'easeOutCubic' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: showLegend,
          position: 'top',
          maxHeight: 54,
          labels: {
            boxWidth: 10,
            padding: 10,
            font: { size: 10, family: "'JetBrains Mono', monospace" },
            usePointStyle: true,
            color: chartTheme.axis,
            filter: (legendItem, chartData) => {
              const dataset = chartData.datasets[legendItem.datasetIndex]
              return !dataset?.disabledProbe && !dataset?.noDataProbe
            }
          }
        },
        tooltip: {
          callbacks: {
            title: function(items) {
              if (items.length > 0 && items[0]) {
                const rawLabel = items[0].raw?.x ?? items[0].chart?.data?.labels?.[items[0].dataIndex]
                const ts = normalizeMetricTimestamp(rawLabel, null)
                if (!ts) return ''
                const date = new Date(ts)
                return '> ' + date.toLocaleString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false
                })
              }
              return ''
            },
            label: function(context) {
              let label = context.dataset.fullLabel || context.dataset.label || ''
              if (label) label += ': '
              const value = context.parsed.y
              const datasetFormatter = context.dataset.formatValue
              if (value === null || value === undefined || !Number.isFinite(Number(value))) {
                label += trans.value.timeout
              } else if (typeof datasetFormatter === 'function') {
                label += datasetFormatter(value)
              } else if (formatCallback) {
                label += formatCallback(value)
              } else {
                label += typeof value === 'number' ? value.toFixed(2) : value
                label += unit
              }
              return '$ ' + label
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          title: {
            display: false,
            text: '',
            color: chartTheme.axis,
            font: { size: 10, family: "'JetBrains Mono', monospace" }
          },
          ticks: {
            maxTicksLimit: CHART.MAX_TICKS,
            color: chartTheme.axis,
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            maxRotation: 0,
            padding: 8,
            callback: function(value) {
              return formatChartAxisTime(this.getLabelForValue(value))
            }
          },
          grid: { color: chartTheme.grid, drawBorder: false, tickLength: 0 }
        },
        y: {
          beginAtZero: true,
          ...(percentScale ? { min: 0, suggestedMax: 100 } : {}),
          grid: { color: chartTheme.grid, drawBorder: false, tickLength: 0 },
          ticks: {
            color: chartTheme.axis,
            font: { size: 9, family: "'JetBrains Mono', monospace" },
            padding: 8,
            callback: tickFormat || function(value) { return value + unit; }
          }
        },
        ...resolvedExtraScales
      },
      elements: {
        point: { radius: 0, hoverRadius: 5, hitRadius: 10, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: '#fff' },
        line: { tension: 0.4, borderWidth: 1.5, fill: false, spanGaps: false }
      }
    }
  }

  for (const def of CHART_DEFS) {
    const refEl = def.ref()
    if (!refEl) continue
    const initialDatasets = typeof def.datasets === 'function' ? def.datasets() : def.datasets
    charts[def.key] = new Chart(refEl.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: initialDatasets.map(d => ({ ...d })) },
      options: createChartOptions(def.unit || '', def.legend, def.formatValue, def.tickFormat, def.extraScales, !!def.percentScale)
    })
  }

  rebuildGpuChartDatasets()
  syncProbeChartVisibility()
}

const updateChartsTheme = () => {
  const chartTheme = getChartThemeColors()

  Chart.defaults.color = chartTheme.axis
  Chart.defaults.plugins.tooltip.backgroundColor = chartTheme.tooltipBg
  Chart.defaults.plugins.tooltip.titleColor = chartTheme.tooltipTitle
  Chart.defaults.plugins.tooltip.bodyColor = chartTheme.tooltipBody
  Chart.defaults.plugins.tooltip.borderColor = chartTheme.tooltipBorder

  Object.values(charts).forEach(chart => {
    if (!chart) return

    if (chart.options.plugins.legend.labels) {
      chart.options.plugins.legend.labels.color = chartTheme.axis
    }

    for (const scale of Object.values(chart.options.scales || {})) {
      if (scale.title) {
        scale.title.color = chartTheme.axis
      }
      if (scale.ticks) {
        scale.ticks.color = chartTheme.axis
      }
      if (scale.grid) {
        scale.grid.color = chartTheme.grid
      }
    }

    chart.update('none')
  })
}

const { onThemeChange } = useTheme()
const unsubscribeThemeChange = onThemeChange(updateChartsTheme)

// ≤1h: gap超过5分钟断线; >1h: 按 long_history_points 计算采样间隔，允许点落在桶内不同位置造成的正常漂移
const getHistoryGapBreakMs = (hours = currentHours.value) => {
  if (hours <= 1) return 5 * 60 * 1000
  const configuredPoints = Number(config.value?.long_history_points)
  const samplePoints = HISTORY.LONG_RANGE_POINT_OPTIONS.includes(configuredPoints)
    ? configuredPoints
    : HISTORY.DEFAULT_LONG_RANGE_POINTS
  const expectedIntervalMs = Math.ceil(hours * 60 * 60 * 1000 / samplePoints)
  return Math.max(5 * 60 * 1000, expectedIntervalMs * 1.9)
}

const shouldBreakGap = (prevPoint, nextPoint) => {
  if (!prevPoint || !nextPoint) return false
  const prevTime = Number(prevPoint.x)
  const nextTime = Number(nextPoint.x)
  if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime)) return false
  const gap = nextTime - prevTime
  const breakThreshold = getHistoryGapBreakMs()
  return gap > breakThreshold
}

const applyGapBreak = (data) => {
  if (!data || data.length < 2) return data
  
  const result = []
  for (let i = 0; i < data.length; i++) {
    result.push(data[i])
    if (i < data.length - 1) {
      if (shouldBreakGap(data[i], data[i + 1])) {
        const currentTime = getChartTimestamp(data[i])
        const nextTime = getChartTimestamp(data[i + 1])
        const gap = nextTime - currentTime
        result.push(createChartPoint(currentTime + gap / 2, null))
      }
    }
  }
  return result
}

const appendPointWithGapBreak = (data, point) => {
  if (!Array.isArray(data)) return [point]
  let lastPoint = null
  for (let i = data.length - 1; i >= 0; i--) {
    const item = data[i]
    if (item && item.y !== null && item.y !== undefined) {
      lastPoint = item
      break
    }
  }
  if (lastPoint && shouldBreakGap(lastPoint, point)) {
    const lastTime = getChartTimestamp(lastPoint)
    const pointTime = getChartTimestamp(point)
    data.push(createChartPoint(lastTime + (pointTime - lastTime) / 2, null))
  }
  data.push(point)
  return data
}

const getLastDatasetTimestamp = (data) => {
  if (!Array.isArray(data)) return 0
  for (let i = data.length - 1; i >= 0; i--) {
    const x = getChartTimestamp(data[i])
    if (Number.isFinite(x)) return x
  }
  return 0
}

const sanitizeHistoryRows = (dataPoints) => {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return []
  const byTs = new Map()
  for (const row of dataPoints) {
    if (!row || typeof row !== 'object') continue
    const ts = normalizeMetricTimestamp(row.timestamp, null)
    if (!ts) continue
    byTs.set(ts, { row, ts })
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts)
}

const updateChartDataset = (chart, datasetIndex, dataPoints, yAccessor) => {
  if (!chart) return

  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return

  let processedData = []
  const sanitized = sanitizeHistoryRows(dataPoints)
  if (sanitized.length > 0) {
    processedData = sanitized.map(({ row, ts }) => createChartPoint(ts, yAccessor(row)))
    processedData = applyGapBreak(processedData)
  }

  dataset.data = processedData
  syncChartLabels(chart)
  chart.update('none')
}

const percentAccessor = (usedField, totalField) => (d) => {
  return safeUsagePercent(d?.[usedField], d?.[totalField], true)
}

const clampedPercentFieldAccessor = (field) => (d) => {
  const val = Number(d?.[field])
  if (!Number.isFinite(val)) return null
  return clampPercent(val)
}

const fieldAccessor = (field, allowZero = false) => (d) => {
  if (d?.[field] === null || d?.[field] === undefined || d?.[field] === '' || isDisabledProbeMetric(d?.[field])) {
    return null
  }
  const val = Number(d[field])
  if (!Number.isFinite(val)) return null
  return allowZero ? (val >= 0 ? val : null) : (val > 0 ? val : null)
}

const pingAccessor = (field) => (d) => {
  if (d?.[field] === null || d?.[field] === undefined || d?.[field] === '' || isDisabledProbeMetric(d?.[field])) {
    return null
  }
  const val = Number(d[field])
  return Number.isFinite(val) && val > 0 ? val : null
}

const lossAccessor = (field) => (d) => {
  if (!isLossValid(d?.[field])) return null
  const val = Number(d[field])
  return Math.max(0, Math.min(100, val))
}

const updateLoadChart = (chart, dataPoints) => {
  if (!chart) return

  const sanitized = sanitizeHistoryRows(dataPoints)
  const processedData = sanitized.map(({ row, ts }) => {
    const loads = parseLoadAvg(row.load_avg)
    return {
      x: ts,
      load1: loads[0],
      load5: loads[1],
      load15: loads[2]
    }
  })

  const load1Data = processedData.map(d => createChartPoint(d.x, d.load1))
  const load5Data = processedData.map(d => createChartPoint(d.x, d.load5))
  const load15Data = processedData.map(d => createChartPoint(d.x, d.load15))
  
  chart.data.datasets[0].data = applyGapBreak(load1Data)
  chart.data.datasets[1].data = applyGapBreak(load5Data)
  chart.data.datasets[2].data = applyGapBreak(load15Data)
  syncChartLabels(chart)
  chart.update('none')
}

const clearDiskIoChart = () => {
  const chart = charts.diskIo
  if (!chart) return
  for (const dataset of chart.data.datasets || []) {
    dataset.data = []
  }
  chart.data.labels = []
  chart.update('none')
}

// 历史区间请求序号：快速切换时间范围时丢弃过期响应，避免慢请求覆盖新选择
let historyRequestId = 0

const loadAllHistory = async (hours) => {
  const requestId = ++historyRequestId
  try {
    const allData = await fetchAllHistory(serverId, hours, apiIndex.value)
    if (requestId !== historyRequestId) return
    lastReportChartUpdateTime = 0
    lossHistoryFields.value = Object.fromEntries(PING_FIELD_DEFS.map(item => [
      item.lossField,
      allData.some(row => isLossValid(row[item.lossField]))
    ]))

    if (allData.length > 0) {
      lastReportChartUpdateTime = allData.reduce((latest, row) => {
        const rowTime = normalizeMetricTimestamp(row?.timestamp, null)
        return rowTime ? Math.max(latest, rowTime) : latest
      }, 0)
      updateChartDataset(charts.cpu, 0, allData, clampedPercentFieldAccessor('cpu'))
      rebuildGpuChartDatasets()
      for (const chartKey of GPU_DETAIL_CHART_KEYS) {
        const chart = charts[chartKey]
        if (!chart) continue
        for (let i = 0; i < chart.data.datasets.length; i++) {
          const dataset = chart.data.datasets[i]
          const gpuId = dataset.gpuId
          const accessor = gpuId ? gpuFieldAccessor(gpuId, chartKey) : () => null
          updateChartDataset(chart, i, allData, accessor)
        }
      }
      updateChartDataset(charts.ram, 0, allData, percentAccessor('ram_used', 'ram_total'))
      updateChartDataset(charts.ram, 1, allData, percentAccessor('swap_used', 'swap_total'))
      updateChartDataset(charts.disk, 0, allData, percentAccessor('disk_used', 'disk_total'))
      const diskIoRows = allData.filter(hasValidDiskIoPayload)
      if (diskIoRows.length > 0) {
        markDiskIoDataAvailable(diskIoRows[0])
        DISK_IO_FIELDS.forEach((field, index) => {
          updateChartDataset(charts.diskIo, index, diskIoRows, diskIoAccessor(field))
        })
      } else {
        clearDiskIoChart()
        hasDiskIoData.value = false
        const fallbackTs = normalizeMetricTimestamp(server.value.last_updated, null)
        if (hasValidDiskIoPayload(server.value) && fallbackTs) {
          appendDiskIoChart(server.value, fallbackTs)
        }
      }
      updateChartDataset(charts.proc, 0, allData, fieldAccessor('processes'))
      updateChartDataset(charts.net, 0, allData, fieldAccessor('net_in_speed', true))
      updateChartDataset(charts.net, 1, allData, fieldAccessor('net_out_speed', true))
      updateChartDataset(charts.conn, 0, allData, fieldAccessor('tcp_conn', true))
      updateChartDataset(charts.conn, 1, allData, fieldAccessor('udp_conn', true))
      updateChartDataset(charts.ping, 0, allData, pingAccessor('ping_ct'))
      updateChartDataset(charts.ping, 1, allData, pingAccessor('ping_cu'))
      updateChartDataset(charts.ping, 2, allData, pingAccessor('ping_cm'))
      updateChartDataset(charts.ping, 3, allData, pingAccessor('ping_bd'))
      updateChartDataset(charts.ping, 4, allData, pingAccessor('ping_node_1'))
      updateChartDataset(charts.ping, 5, allData, pingAccessor('ping_node_2'))
      updateChartDataset(charts.ping, 6, allData, pingAccessor('ping_node_3'))
      updateChartDataset(charts.ping, 7, allData, pingAccessor('ping_node_4'))
      updateChartDataset(charts.loss, 0, allData, lossAccessor('loss_ct'))
      updateChartDataset(charts.loss, 1, allData, lossAccessor('loss_cu'))
      updateChartDataset(charts.loss, 2, allData, lossAccessor('loss_cm'))
      updateChartDataset(charts.loss, 3, allData, lossAccessor('loss_bd'))
      updateChartDataset(charts.loss, 4, allData, lossAccessor('loss_node_1'))
      updateChartDataset(charts.loss, 5, allData, lossAccessor('loss_node_2'))
      updateChartDataset(charts.loss, 6, allData, lossAccessor('loss_node_3'))
      updateChartDataset(charts.loss, 7, allData, lossAccessor('loss_node_4'))
      updateLoadChart(charts.load, allData)

      const avg = (arr, field, isPingMetric = true) => {
        const vals = []
        for (const d of arr) {
          if (!d || typeof d !== 'object') continue
          const raw = d[field]
          if (raw === null || raw === undefined || raw === '' || isDisabledProbeMetric(raw)) continue
          const v = Number(raw)
          if (!Number.isFinite(v)) continue
          if (isPingMetric) {
            if (v > 0) vals.push(v)
          } else {
            vals.push(Math.max(0, Math.min(100, v)))
          }
        }
        return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
      }
      avgPingCt.value = avg(allData, 'ping_ct', true)
      avgPingCu.value = avg(allData, 'ping_cu', true)
      avgPingCm.value = avg(allData, 'ping_cm', true)
      avgPingBd.value = avg(allData, 'ping_bd', true)
      avgPingNode1.value = avg(allData, 'ping_node_1', true)
      avgPingNode2.value = avg(allData, 'ping_node_2', true)
      avgPingNode3.value = avg(allData, 'ping_node_3', true)
      avgPingNode4.value = avg(allData, 'ping_node_4', true)
      avgLossCt.value = avg(allData, 'loss_ct', false)
      avgLossCu.value = avg(allData, 'loss_cu', false)
      avgLossCm.value = avg(allData, 'loss_cm', false)
      avgLossBd.value = avg(allData, 'loss_bd', false)
      avgLossNode1.value = avg(allData, 'loss_node_1', false)
      avgLossNode2.value = avg(allData, 'loss_node_2', false)
      avgLossNode3.value = avg(allData, 'loss_node_3', false)
      avgLossNode4.value = avg(allData, 'loss_node_4', false)
      syncProbeChartVisibility()
    }

    updateAllChartTimeUnits(hours)
    historyLoaded.value = true

    await nextTick()
    if (requestId !== historyRequestId) return

    requestAnimationFrame(() => {
      if (requestId !== historyRequestId || isUnmounted) return
      Object.values(charts).forEach(chart => {
        if (!chart) return
        chart.resize()
        chart.update('none')
      })
    })
  } catch (e) {
    if (e && e.status === 401) {
      showLoginModal.value = true
      currentHours.value = REALTIME_HISTORY_HOURS
      historyLoaded.value = true
      return
    }

    if (e && e.message === 'databaseUpgradeRequired') {
      if (!databaseUpgradeAlertShown) {
        databaseUpgradeAlertShown = true
        noticeModalMessage.value = t(e.message)
      }
      historyLoaded.value = true
      return
    }
    historyLoaded.value = true
    console.error('[ERROR] Load history failed:', e)
  }
}

const updateAllChartTimeUnits = (hours) => {
  const maxTicks = hours <= 3 ? CHART.MAX_TICKS : CHART.MAX_TICKS_HOUR

  Object.values(charts).forEach(chart => {
    if (chart?.options?.scales?.x) {
      chart.options.scales.x.ticks.maxTicksLimit = maxTicks
      delete chart.options.scales.x.min
      delete chart.options.scales.x.max
    }
    if (chart) {
      syncChartLabels(chart)
      chart.update('none')
    }
  })
}

const appendDataToChart = (chart, datasetIndex, timestamp, value, isPing = false, emptyAsNull = false, clampPct = false) => {
  if (!chart) return
  
  const dataset = chart.data.datasets[datasetIndex]
  if (!dataset) return
  
  const time = normalizeMetricTimestamp(timestamp, null)
  if (!time) return
  const lastTime = getLastDatasetTimestamp(dataset.data)
  if (lastTime && time <= lastTime) return

  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  let yVal
  if (isPing) {
    const val = Number(value)
    yVal = (Number.isFinite(val) && val > 0) ? val : null
  } else if (emptyAsNull) {
    if (!isLossValid(value)) {
      yVal = null
    } else {
      const val = Number(value)
      yVal = clampPct ? Math.max(0, Math.min(100, val)) : val
    }
  } else {
    const val = Number(value)
    const safeVal = Number.isFinite(val) && val >= 0 ? val : 0
    yVal = clampPct ? clampPercent(safeVal) : safeVal
  }
  
  dataset.data = appendPointWithGapBreak(dataset.data, createChartPoint(time, yVal))
  
  while (dataset.data.length > CHART.MAX_DATA_POINTS) {
    dataset.data.shift()
  }
  
  dataset.data = dataset.data.filter(d => getChartTimestamp(d) >= startTime)
  syncChartLabels(chart)
  
  chart.update('none')
}

const STATIC_FIELDS = ['id', 'name', 'region', 'arch', 'os', 'kernel_version', 'cpu_info', 'cpu_cores', 'gpu_info', 'expire_date', 'server_group', 'traffic_limit', 'net_rx_monthly', 'net_tx_monthly', 'boot_time', 'timestamp', 'ip_v4', 'ip_v6']
const REALTIME_SAMPLE_FIELDS = new Set([
  'cpu', 'ram_total', 'ram_used', 'swap_total', 'swap_used',
  'net_in_speed', 'net_out_speed', 'disk'
])
const TIMING_FIELDS = new Set(['last_updated', 'sample_timestamp'])

const appendLoadChartData = (timestamp, loadAvg) => {
  const chart = charts.load
  if (!chart) return

  const loads = parseLoadAvg(loadAvg)
  const time = normalizeMetricTimestamp(timestamp, null)
  if (!time) return
  const lastTime = getLastDatasetTimestamp(chart.data.datasets[0]?.data)
  if (lastTime && time <= lastTime) return

  const startTime = Date.now() - currentHours.value * 60 * 60 * 1000

  for (let i = 0; i < 3; i++) {
    chart.data.datasets[i].data = appendPointWithGapBreak(chart.data.datasets[i].data, createChartPoint(time, loads[i]))
    while (chart.data.datasets[i].data.length > CHART.MAX_DATA_POINTS) {
      chart.data.datasets[i].data.shift()
    }
    chart.data.datasets[i].data = chart.data.datasets[i].data.filter(d => getChartTimestamp(d) >= startTime)
  }

  syncChartLabels(chart)
  chart.update('none')
}

const isRealtimeHistoryRange = () => Math.abs(Number(currentHours.value) - REALTIME_HISTORY_HOURS) < 0.001

let latestReportReplayTimers = new Set()

const clearLatestReportReplayTimers = () => {
  latestReportReplayTimers.forEach(timer => clearTimeout(timer))
  latestReportReplayTimers.clear()
}

const getReplaySampleData = (sample) => {
  if (!sample || typeof sample !== 'object') return null
  return sample.data || sample.payload || sample.metrics || null
}

const buildLiveStatusData = (event) => {
  const receiveTs = Date.now()
  // last_updated 必须使用上报方的时间戳，不能用浏览器接收时间，
  // 否则离线重放缓存上报时会把「最后更新」显示成当前时间。
  const reportTs = normalizeMetricTimestamp(
    event?.data?.last_updated ?? event?.data?.timestamp ?? event?.ts,
    receiveTs
  )
  return {
    ...event.data,
    sample_timestamp: reportTs,
    last_updated: reportTs,
    timestamp: receiveTs
  }
}

const scheduleLatestReportReplay = (event, delay) => {
  const timer = setTimeout(() => {
    latestReportReplayTimers.delete(timer)
    fetchCurrentStatus(buildLiveStatusData(event), {
      mergeMode: 'sample',
      chartMode: 'sample'
    })
  }, delay)
  latestReportReplayTimers.add(timer)
}

const toReplayEvents = (update, messageTs = Date.now()) => {
  if (!update || String(update.serverId) !== String(serverId)) return []
  const samples = Array.isArray(update.samples) ? update.samples : []
  return samples
    .map(sample => {
      const data = getReplaySampleData(sample)
      if (!data) return null
      const ts = normalizeMetricTimestamp(
        sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? update.ts ?? messageTs,
        null
      )
      return ts ? { ts, data } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)
}

const replayReportUpdate = (update, { messageTs = Date.now(), replayCachedReport = false, includeReportUpdate = true } = {}) => {
  const events = toReplayEvents(update, messageTs)
  if (events.length === 0) return

  const shouldReplaySamples = isRealtimeHistoryRange()
  if (includeReportUpdate) {
    const latestEvent = events[events.length - 1]
    fetchCurrentStatus(buildLiveStatusData(latestEvent), {
      mergeMode: shouldReplaySamples ? 'report' : 'all',
      chartMode: 'report'
    })
  }
  if (!shouldReplaySamples) return

  const reportTs = normalizeMetricTimestamp(update.reportTs ?? update.report_timestamp, messageTs)
  const reportAge = Number(update.reportAgeMs)
  const reportAgeMs = Math.max(0, Number.isFinite(reportAge)
    ? reportAge
    : (reportTs ? Date.now() - reportTs : 0))
  const playbackStartTs = replayCachedReport
    ? resolvePlaybackCursor(events[0].ts, null, { replayCachedReport: true, reportAgeMs })
    : events[0].ts
  if (playbackStartTs === null) return

  let immediateEvent = null
  const futureEvents = []
  for (const event of events) {
    if (event.ts <= playbackStartTs) {
      immediateEvent = event
    } else {
      futureEvents.push(event)
    }
  }

  if (immediateEvent) {
    scheduleLatestReportReplay(immediateEvent, 0)
  }

  for (const event of futureEvents) {
    const delay = Math.max(0, Math.min(event.ts - playbackStartTs, LATEST_REPORT_MAX_REPLAY_DELAY))
    scheduleLatestReportReplay(event, delay)
  }
}

const replayLatestReportUpdates = (detailData) => {
  clearLatestReportReplayTimers()
  const updates = Array.isArray(detailData?.latestReportUpdates) ? detailData.latestReportUpdates : []
  for (const update of updates) {
    replayReportUpdate(update, {
      messageTs: Date.now(),
      replayCachedReport: true,
      includeReportUpdate: false
    })
  }
}

const appendRealtimeSampleCharts = (data, dataTimestamp) => {
  appendDataToChart(charts.cpu, 0, dataTimestamp, data.cpu, false, false, true)
  const ramPct = safeUsagePercent(data.ram_used, data.ram_total, true)
  appendDataToChart(charts.ram, 0, dataTimestamp, ramPct, false, false, true)
  const swapPct = safeUsagePercent(data.swap_used, data.swap_total, true)
  appendDataToChart(charts.ram, 1, dataTimestamp, swapPct, false, false, true)
  appendDataToChart(charts.net, 0, dataTimestamp, data.net_in_speed)
  appendDataToChart(charts.net, 1, dataTimestamp, data.net_out_speed)
}

const appendDiskIoChart = (data, dataTimestamp) => {
  if (!markDiskIoDataAvailable(data)) return
  const io = normalizeDiskIo(data)
  DISK_IO_FIELDS.forEach((field, index) => {
    appendDataToChart(charts.diskIo, index, dataTimestamp, io[field])
  })
}

const appendReportCharts = (data, dataTimestamp) => {
  rebuildGpuChartDatasets()
  const latestGpuList = parseGpuInfo(data.gpu_info)
  for (const chartKey of GPU_DETAIL_CHART_KEYS) {
    const chart = charts[chartKey]
    if (!chart) continue
    for (let i = 0; i < chart.data.datasets.length; i++) {
      const dataset = chart.data.datasets[i]
      const gpuId = dataset.gpuId
      const found = latestGpuList.find(g => String(g.id) === String(gpuId))
      const gpuVal = found ? gpuDetailValue(found, GPU_CHART_FIELD[chartKey]) : null
      if (gpuVal === null || gpuVal === undefined) {
        appendDataToChart(chart, i, dataTimestamp, null, false, true)
      } else {
        appendDataToChart(chart, i, dataTimestamp, gpuVal, false, false, chartKey === 'gpu')
      }
    }
  }
  const diskPct = safeUsagePercent(data.disk_used, data.disk_total, true)
  appendDataToChart(charts.disk, 0, dataTimestamp, diskPct, false, false, true)
  appendDiskIoChart(data, dataTimestamp)
  appendDataToChart(charts.proc, 0, dataTimestamp, data.processes)
  appendDataToChart(charts.conn, 0, dataTimestamp, data.tcp_conn)
  appendDataToChart(charts.conn, 1, dataTimestamp, data.udp_conn)

  // 与 WSS 一致：字段不存在(undefined)或为 false 时不产生图表点，
  // null 表示超时，保留为断点/超时提示。
  for (const item of PING_FIELD_DEFS) {
    const appendProbe = (chart, field, isPing) => {
      if (!hasOwn(data, field)) return
      if (isDisabledProbeMetric(data[field])) return
      appendDataToChart(chart, item.datasetIndex, dataTimestamp, data[field], isPing, !isPing, !isPing)
    }
    appendProbe(charts.ping, item.field, true)
    appendProbe(charts.loss, item.lossField, false)
  }

  appendLoadChartData(dataTimestamp, data.load_avg)
}

const appendReportChartsThrottled = (data, dataTimestamp) => {
  if (!Number.isFinite(dataTimestamp)) return
  if (lastReportChartUpdateTime && dataTimestamp - lastReportChartUpdateTime < REPORT_CHART_UPDATE_INTERVAL_MS) {
    return
  }
  appendReportCharts(data, dataTimestamp)
  lastReportChartUpdateTime = dataTimestamp
}

const shouldMergeIncomingField = (key, mergeMode) => {
  if (STATIC_FIELDS.includes(key)) return false
  if (mergeMode === 'sample') return REALTIME_SAMPLE_FIELDS.has(key) || TIMING_FIELDS.has(key)
  if (mergeMode === 'report') return isDiskIoField(key) || !REALTIME_SAMPLE_FIELDS.has(key)
  return true
}

const fetchCurrentStatus = async (incomingData, options = {}) => {
  try {
    const {
      mergeMode = 'all',
      chartMode = 'all'
    } = options
    let data = incomingData
    if (!data) {
      data = await fetchServerDetail(serverId, apiIndex.value)
      if (!data) {
        // 首次加载失败：解除加载态并标记错误，避免页面永久转圈
        loading.value = false
        loadError.value = true
        return
      }
    }
    if (!data) return

    if (incomingData) {
      const newServer = { ...server.value }
      const hasValidIncomingDiskIo = markDiskIoDataAvailable(data)
      for (const key of Object.keys(data)) {
        if (!shouldMergeIncomingField(key, mergeMode)) {
          continue
        }
        if (isDiskIoField(key) && !hasValidIncomingDiskIo) {
          continue
        }
        newServer[key] = data[key]
      }
      server.value = newServer
    } else {
      config.value = data.sysConfig || null
      server.value = data
      markDiskIoDataAvailable(data)
      loading.value = false
      loadError.value = false
    }
    syncProbeChartVisibility()

    if (data.last_updated && chartsReady.value && isRealtimeHistoryRange()) {
      const dataTimestamp = normalizeMetricTimestamp(data.last_updated, null)
      if (dataTimestamp) {
        if (chartMode === 'sample' || chartMode === 'all') appendRealtimeSampleCharts(data, dataTimestamp)
        if (chartMode === 'report' || chartMode === 'all') appendReportChartsThrottled(data, dataTimestamp)
      }
    }

    if (data.last_updated) {
      lastUpdateText.value = formatTimestamp(data.last_updated)
    }
    return data
  } catch (e) {
    if (!incomingData) {
      loading.value = false
      loadError.value = true
    }
    console.error('[ERROR] Update status failed:', e)
    return null
  }
}

const setTimeRange = (hours) => {
  clearLatestReportReplayTimers()
  if (hours > 24 && !isAdminLoggedIn()) {
    showLoginModal.value = true
    return
  }
  currentHours.value = hours
  loadAllHistory(hours)
}

const goToLogin = () => {
  showLoginModal.value = false
  router.push({
    path: '/admin',
    query: {
      apiIndex: String(apiIndex.value),
      redirect: route.fullPath
    }
  })
}

let liveSocket = null
let liveConnectionClosedByUser = false
let visibilityListenerBound = false
// 卸载标记与图表挂载重试句柄：loadError、组件卸载或达到重试上限时立即终止
let isUnmounted = false
let chartInitTimer = null
let chartInitTimerResolve = null
const MAX_CHART_INIT_ATTEMPTS = 100

const clearChartInitTimer = () => {
  if (chartInitTimer) {
    clearTimeout(chartInitTimer)
    chartInitTimer = null
  }
  if (chartInitTimerResolve) {
    const resolve = chartInitTimerResolve
    chartInitTimerResolve = null
    resolve()
  }
}

const areAllChartRefsReady = () => Boolean(
  cpuChartRef.value &&
  gpuChartRef.value &&
  gpuMemChartRef.value &&
  gpuClockChartRef.value &&
  gpuPowerChartRef.value &&
  ramChartRef.value &&
  diskChartRef.value &&
  diskIoChartRef.value &&
  netChartRef.value &&
  procChartRef.value &&
  connChartRef.value &&
  pingChartRef.value &&
  lossChartRef.value &&
  loadChartRef.value
)

const initChartsOnMount = () => {
  if (isUnmounted || loadError.value || chartsReady.value) {
    return Promise.resolve()
  }
  if (chartInitPromise) {
    return chartInitPromise
  }

  chartInitPromise = (async () => {
    try {
      let attempts = 0
      while (!isUnmounted && !loadError.value && !chartsReady.value) {
        await nextTick()
        if (isUnmounted || loadError.value || chartsReady.value) break

        if (areAllChartRefsReady()) {
          initCharts()
          chartsReady.value = true
          break
        }

        attempts += 1
        if (attempts >= MAX_CHART_INIT_ATTEMPTS) {
          break
        }

        await new Promise((resolve) => {
          chartInitTimerResolve = resolve
          chartInitTimer = setTimeout(() => {
            chartInitTimer = null
            chartInitTimerResolve = null
            resolve()
          }, 30)
        })
      }
    } finally {
      clearChartInitTimer()
      chartInitPromise = null
    }
  })()

  return chartInitPromise
}

const handleVisibility = () => {
  if (!liveSocket) return
  if (document.hidden) {
    clearLatestReportReplayTimers()
    liveSocket.close()
  } else if (showLiveTimeoutModal.value || liveConnectionClosedByUser) {
    return
  } else {
    liveSocket.reconnect()
  }
}

const closeLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = true
  liveSocket?.close()
}

const continueLiveConnection = () => {
  showLiveTimeoutModal.value = false
  liveConnectionClosedByUser = false
  liveSocket?.reconnect()
}

const handleLiveMessage = (msg) => {
  if (!msg || msg.type !== 'batchUpdate') return
  const updates = Array.isArray(msg.updates) ? msg.updates : []
  const matchedUpdates = updates.filter(update => update && String(update.serverId) === String(serverId))
  if (matchedUpdates.length === 0) return

  clearLatestReportReplayTimers()
  const messageTs = normalizeMetricTimestamp(msg.ts, Date.now())
  for (const update of matchedUpdates) {
    replayReportUpdate(update, { messageTs })
  }
}

const getInjectedRuntimeConfig = () => {
  if (!appConfig) return null
  if (Array.isArray(appConfig.site_configs) && appConfig.site_configs[apiIndex.value]) {
    return appConfig.site_configs[apiIndex.value]
  }
  return apiIndex.value === 0 ? appConfig : null
}

const loadThemeOptionsFromConfig = async () => {
  try {
    const runtimeConfig = getInjectedRuntimeConfig() || await fetchConfig(apiIndex.value)
    runtimeConfigRef.value = runtimeConfig || null
    frontendWsTimeoutMinutes.value = normalizeLiveSocketTimeoutMinutes(runtimeConfig?.frontend_ws_timeout_minutes)
    if (runtimeConfig && Object.hasOwn(runtimeConfig, 'theme_options')) {
      applyMikusThemeOptions(runtimeConfig.theme_options)
    } else {
      applyMikusThemeOptions(null)
    }
  } catch (e) {
    applyMikusThemeOptions(null)
    console.log('[INFO] Detail theme config pending...', e)
  }
}

const ensureLiveSocketConnected = () => {
  if (isUnmounted) return
  if (!liveSocket) {
    liveSocket = createLiveSocket(String(serverId), {
      replay: false,
      timeoutMinutes: frontendWsTimeoutMinutes.value,
      onMessage: handleLiveMessage,
      onTimeout: () => {
        showLiveTimeoutModal.value = true
      },
      onStatus: () => {}
    }, apiIndex.value)
  }
  if (!visibilityListenerBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility)
    visibilityListenerBound = true
  }
}

const bootstrapDetailAfterStatus = async (initialData) => {
  if (isUnmounted || loadError.value || !initialData) return
  await initChartsOnMount()
  if (isUnmounted || loadError.value) return
  await loadAllHistory(currentHours.value)
  if (isUnmounted) return
  replayLatestReportUpdates(initialData)
  ensureLiveSocketConnected()
}

const init = async () => {
  const [initialData] = await Promise.all([
    fetchCurrentStatus(),
    loadThemeOptionsFromConfig()
  ])
  await bootstrapDetailAfterStatus(initialData)
}

// 首次加载失败后的重试入口：完整恢复状态、14 张图表、历史曲线与实时连接
const retryInitialLoad = async () => {
  if (loading.value) return
  clearChartInitTimer()
  loadError.value = false
  loading.value = true
  const [initialData] = await Promise.all([
    fetchCurrentStatus(),
    loadThemeOptionsFromConfig()
  ])
  await bootstrapDetailAfterStatus(initialData)
}

useModal(showLoginModal, () => { showLoginModal.value = false })
useModal(() => Boolean(noticeModalMessage.value), () => { noticeModalMessage.value = '' })

watch([currentLang, config, runtimeConfigRef], () => {
  if (chartsReady.value) {
    refreshLocalizedChartLabels()
  }
})

watch([cpuChartRef, gpuChartRef, gpuMemChartRef, gpuClockChartRef, gpuPowerChartRef, ramChartRef, diskChartRef, diskIoChartRef, netChartRef, procChartRef, connChartRef, pingChartRef, lossChartRef, loadChartRef], () => {
  if (!chartsReady.value && !loadError.value) {
    initChartsOnMount()
  }
})

onMounted(() => {
  if (!serverId) {
    // 无效路由参数：回首页并终止后续初始化，避免发起 id=undefined 的无效请求
    router.replace('/')
    return
  }
  init()
})

onUnmounted(() => {
  isUnmounted = true
  clearChartInitTimer()
  if (visibilityListenerBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibility)
    visibilityListenerBound = false
  }
  if (liveSocket) liveSocket.close()
  clearLatestReportReplayTimers()
  unsubscribeThemeChange()
  lastGpuSignature = ''
  safeDestroyCharts()
})
</script>

<style scoped>
.host-name {
  min-width: 0;
}

.host-server-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.country-os-icons {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.gpu-summary-ellipsis {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.chart-header-actions {
  min-width: 0;
}

.gpu-header-value {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: min(360px, 55vw);
  text-align: right;
  word-break: break-word;
}

.ping-indicator {
  flex-wrap: wrap;
  min-width: 0;
}

.probe-stat-label {
  display: inline-block;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}
</style>