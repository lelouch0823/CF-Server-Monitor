import { computed } from 'vue'
import { formatBytes, gbToBytes, getFlagRegionCode, isServerOnline, mibToBytes } from '../utils/api'
import { getPublicAssetUrl } from '../utils/config'
import { currentLang, useTranslation } from '../utils/i18n'
import { LATENCY_WINDOW, PING } from '../utils/constants'
import { BUILTIN_PING_NODE_DEFAULTS, resolveLocalizedPingName } from '../utils/pingNode.js'
import { formatBillingPrice } from '../utils/server.js'

export const MAX_LATENCY_RENDER_BUCKETS = 60
export const MAX_VISIBLE_TAGS = 8
export const UNMEASURED_BUCKET_COLOR = 'rgba(128, 128, 128, 0.22)'

export const DEFAULT_SERVER_CARD_CONFIG = {
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_three_net_details: true,
  latency_window: {
    points: LATENCY_WINDOW.POINTS,
    hours: LATENCY_WINDOW.HOURS
  },
  display_mode: 'bar'
}

// 首页三网面板与延迟列表的候选节点，按展示优先级排列；loss 末条为 false（后台设为 0）时跳过。
const THREE_NET_DEFS = [
  { key: 'ct', pingField: 'ping_ct', lossField: 'loss_ct', nameKey: 'custom_ct_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.ct, labelKey: 'pingCt', fallbackLabel: 'CT' },
  { key: 'cu', pingField: 'ping_cu', lossField: 'loss_cu', nameKey: 'custom_cu_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.cu, labelKey: 'pingCu', fallbackLabel: 'CU' },
  { key: 'cm', pingField: 'ping_cm', lossField: 'loss_cm', nameKey: 'custom_cm_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.cm, labelKey: 'pingCm', fallbackLabel: 'CM' },
  { key: 'bd', pingField: 'ping_bd', lossField: 'loss_bd', nameKey: 'custom_bd_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.bd, labelKey: 'pingBd', fallbackLabel: 'BGP' },
  { key: 'node_1', pingField: 'ping_node_1', lossField: 'loss_node_1', nameKey: 'node_1_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.node_1, labelKey: 'pingNode_1', fallbackLabel: 'Node 1' },
  { key: 'node_2', pingField: 'ping_node_2', lossField: 'loss_node_2', nameKey: 'node_2_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.node_2, labelKey: 'pingNode_2', fallbackLabel: 'Node 2' },
  { key: 'node_3', pingField: 'ping_node_3', lossField: 'loss_node_3', nameKey: 'node_3_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.node_3, labelKey: 'pingNode_3', fallbackLabel: 'Node 3' },
  { key: 'node_4', pingField: 'ping_node_4', lossField: 'loss_node_4', nameKey: 'node_4_name', builtinDefault: BUILTIN_PING_NODE_DEFAULTS.node_4, labelKey: 'pingNode_4', fallbackLabel: 'Node 4' }
]

const DEFAULT_THREE_NET_POINT_COUNT = LATENCY_WINDOW.POINTS

const normalizeLatencyTimestamp = (value, fallback = 0) => {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback
  return timestamp < 10000000000 ? timestamp * 1000 : timestamp
}

const normalizeProbeMetricValue = (value) => {
  if (value === false || value === 'false') return false
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const hasMeasuredPayloadKeys = (point) => {
  if (!point || typeof point !== 'object') return false
  for (const k of Object.keys(point)) {
    if (k !== 'ts' && k !== 'timestamp' && point[k] !== undefined) {
      return true
    }
  }
  return false
}

export const computeTooltipShift = (index, total) => {
  if (total <= 1) return '0px'
  if (total < 6) {
    if (index === 0) return '+24px'
    if (index === total - 1) return '-24px'
    return '0px'
  }
  if (index === 0) return '+36px'
  if (index === 1) return '+24px'
  if (index === 2) return '+12px'
  if (index === total - 3) return '-12px'
  if (index === total - 2) return '-24px'
  if (index === total - 1) return '-36px'
  return '0px'
}

const formatPercentValue = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return '--'
  const clamped = Math.max(0, Math.min(100, number))
  return `${Number.isInteger(clamped) ? clamped : clamped.toFixed(1)}%`
}

const trimFixed = (value, digits = 1) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

const formatCount = (value) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number) || number < 0) return '0'
  return number.toLocaleString('en-US')
}

export const clampPercent = (value) => {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.min(100, num)
}

export const safeUsagePercent = (used, total, clampMax = true) => {
  const u = Number(used)
  const t = Number(total)
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0 || u <= 0) return 0
  const pct = (u / t) * 100
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return clampMax ? Math.min(100, pct) : pct
}

export const formatTrafficPercentNumber = (percent, digits = 1) => {
  const num = Number(percent)
  if (!Number.isFinite(num) || num <= 0) return (0).toFixed(digits)
  if (num > 999.9) return '>999'
  return num.toFixed(digits)
}

export const formatTrafficPercentFullTitle = (percent, digits = 2) => {
  const num = Number(percent)
  if (!Number.isFinite(num) || num <= 0) return ''
  if (num <= 999.9) return ''
  return `${num.toFixed(digits)}%`
}

export const getTrafficUsageBytes = (server) => {
  const rxRaw = Number(server?.net_rx_monthly)
  const txRaw = Number(server?.net_tx_monthly)
  const rx = Number.isFinite(rxRaw) && rxRaw > 0 ? rxRaw : 0
  const tx = Number.isFinite(txRaw) && txRaw > 0 ? txRaw : 0
  const calcType = server?.traffic_calc_type || 'total'
  if (calcType === 'dl') return rx
  if (calcType === 'ul') return tx
  if (calcType === 'max') return Math.max(rx, tx)
  return rx + tx
}

export const calcTrafficUsagePercent = (server) => {
  const limitGb = Number(server?.traffic_limit)
  if (!Number.isFinite(limitGb) || limitGb <= 0) return 0
  const usedBytes = getTrafficUsageBytes(server)
  if (!Number.isFinite(usedBytes) || usedBytes <= 0) return 0
  const usedGb = usedBytes / (1024 * 1024 * 1024)
  const pct = (usedGb / limitGb) * 100
  return Number.isFinite(pct) && pct > 0 ? pct : 0
}

export const getUsageColor = (percent) => {
  const p = clampPercent(percent)
  if (p >= 95) return 'var(--accent-red)'
  if (p >= 80) return 'var(--accent-yellow)'
  if (p >= 50) return 'var(--accent-blue)'
  return 'var(--accent-green)'
}

export function useServerCardData(props) {
  const trans = useTranslation()

  const currentTime = computed(() => {
    const ts = Number(props.server.current_timestamp)
    if (Number.isFinite(ts) && ts > 0) {
      return ts < 10000000000 ? ts * 1000 : ts
    }
    return Date.now()
  })

  const regionCode = computed(() => getFlagRegionCode(props.server.region))
  const isOnline = computed(() => isServerOnline(props.server, currentTime.value))
  const statusColor = computed(() => isOnline.value ? 'var(--accent-green)' : 'var(--accent-red)')
  const statusText = computed(() => isOnline.value ? trans.value.online : trans.value.offline)

  const cpuPercent = computed(() => clampPercent(props.server.cpu))
  const cpuCores = computed(() => {
    const cores = Number.parseInt(props.server.cpu_cores, 10)
    return Number.isFinite(cores) && cores > 0 ? cores : 0
  })
  const ramPercent = computed(() => safeUsagePercent(props.server.ram_used, props.server.ram_total, true))
  const swapTotal = computed(() => {
    const total = Number(props.server.swap_total)
    return Number.isFinite(total) && total > 0 ? total : 0
  })
  const swapUsed = computed(() => {
    const used = Number(props.server.swap_used)
    return Number.isFinite(used) && used > 0 ? used : 0
  })
  const hasSwapData = computed(() => swapTotal.value > 0)
  const swapPercent = computed(() => hasSwapData.value ? safeUsagePercent(swapUsed.value, swapTotal.value, true) : 0)
  const diskPercent = computed(() => safeUsagePercent(props.server.disk_used, props.server.disk_total, true))

  const trafficLimitSummary = computed(() => {
    const limitGb = Number(props.server.traffic_limit)
    if (!Number.isFinite(limitGb) || limitGb <= 0) return null
    const limitBytes = gbToBytes(limitGb)
    const usedBytes = getTrafficUsageBytes(props.server)
    const percent = calcTrafficUsagePercent(props.server)
    return {
      usedBytes,
      limitBytes,
      percent
    }
  })

  const trafficUsagePercent = computed(() => trafficLimitSummary.value ? trafficLimitSummary.value.percent : 0)
  const trafficUsageBarWidth = computed(() => `${clampPercent(trafficUsagePercent.value)}%`)
  const trafficUsagePercentText = computed(() => formatTrafficPercentNumber(trafficUsagePercent.value, 2))
  const trafficLimitPercentText = computed(() => {
    if (!trafficLimitSummary.value) return '0.0'
    return formatTrafficPercentNumber(trafficUsagePercent.value, 1)
  })
  const trafficUsageFullTitle = computed(() => formatTrafficPercentFullTitle(trafficUsagePercent.value, 2))
  const trafficLimitText = computed(() => {
    if (trafficLimitSummary.value) {
      return `${formatBytes(trafficLimitSummary.value.usedBytes)} / ${formatBytes(trafficLimitSummary.value.limitBytes)}`
    }
    return `↓ ${totalRxMonthly.value} ↑ ${totalTxMonthly.value}`
  })

  const tagList = computed(() => {
    const seen = new Set()
    const list = []
    for (const raw of String(props.server.tags || '').split(',')) {
      const tag = raw.trim()
      if (!tag || seen.has(tag)) continue
      seen.add(tag)
      list.push(tag)
    }
    return list
  })
  const visibleTagList = computed(() => tagList.value.slice(0, MAX_VISIBLE_TAGS))
  const hiddenTagCount = computed(() => Math.max(0, tagList.value.length - MAX_VISIBLE_TAGS))
  const hiddenTagsTitle = computed(() => hiddenTagCount.value > 0 ? tagList.value.slice(MAX_VISIBLE_TAGS).join(', ') : '')
  const tagColorClass = (index) => `tag-color-${index % 6}`
  const hasPublicIPv4 = computed(() => String(props.server.ip_v4 ?? '').trim() === '1')
  const hasPublicIPv6 = computed(() => String(props.server.ip_v6 ?? '').trim() === '1')

  const netInSpeed = computed(() => formatBytes(props.server.net_in_speed))
  const netOutSpeed = computed(() => formatBytes(props.server.net_out_speed))
  const tcpConn = computed(() => formatCount(props.server.tcp_conn))
  const udpConn = computed(() => formatCount(props.server.udp_conn))
  const connPair = computed(() => `${tcpConn.value} / ${udpConn.value}`)
  const totalRx = computed(() => formatBytes(props.server.net_rx))
  const totalTx = computed(() => formatBytes(props.server.net_tx))
  const totalRxMonthly = computed(() => formatBytes(props.server.net_rx_monthly))
  const totalTxMonthly = computed(() => formatBytes(props.server.net_tx_monthly))
  const priceText = computed(() => formatBillingPrice(props.server, currentLang.value))

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

  const expireDateTitle = computed(() => {
    const expireDate = formatDateOnly(props.server.expire_date)
    return expireDate ? `${trans.value.expirationDate || 'Expiration Date'}: ${expireDate}` : ''
  })

  const parseSafeLoadPart = (raw) => {
    const num = Number(raw)
    return Number.isFinite(num) && num >= 0 ? num : 0
  }

  const loadAvg = computed(() => {
    const raw = String(props.server.load_avg || '').trim()
    if (!raw) return [0, 0, 0]
    const parts = raw.split(/\s+/)
    return [parseSafeLoadPart(parts[0]), parseSafeLoadPart(parts[1]), parseSafeLoadPart(parts[2])]
  })

  const formatUptime = (bootTime, nowTs = Date.now()) => {
    if (!bootTime) return 'N/A'

    let bootTimeMs = null
    if (typeof bootTime === 'string' && !/^\d+$/.test(bootTime)) {
      const parsed = new Date(bootTime)
      if (!Number.isNaN(parsed.getTime())) {
        bootTimeMs = parsed.getTime()
      }
    } else {
      const timestamp = Number.parseInt(bootTime, 10)
      if (Number.isFinite(timestamp) && timestamp > 0) {
        bootTimeMs = timestamp < 1000000000000 ? timestamp * 1000 : timestamp
      }
    }

    if (!bootTimeMs) return 'N/A'

    const diffMs = nowTs - bootTimeMs
    if (diffMs < 0) return 'N/A'

    const totalSeconds = Math.floor(diffMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const zh = currentLang.value.startsWith('zh')
    const parts = []

    if (days > 0) parts.push(zh ? `${days}天` : `${days}d`)
    if (hours > 0) parts.push(zh ? `${hours}小时` : `${hours}h`)
    if (minutes > 0) parts.push(zh ? `${minutes}分` : `${minutes}m`)
    if (seconds > 0 || parts.length === 0) parts.push(zh ? `${seconds}秒` : `${seconds}s`)

    return parts.slice(0, 3).join(' ')
  }

  const uptimeText = computed(() => formatUptime(props.server.boot_time, currentTime.value))

  const formatMetricUsage = (used, total) => `${formatBytes(mibToBytes(used))} / ${formatBytes(mibToBytes(total))}`
  const ramUsageText = computed(() => formatMetricUsage(props.server.ram_used, props.server.ram_total))
  const diskUsageText = computed(() => formatMetricUsage(props.server.disk_used, props.server.disk_total))

  // date-only 字符串按本地零点解析并以当天结束作为到期时刻，避免 UTC 零点解析
  // 导致 UTC- 时区提前一天显示"已到期"
  const parseExpireTimestamp = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1).getTime()
    }
    const time = new Date(value).getTime()
    return Number.isNaN(time) ? NaN : time
  }

  const isExpired = computed(() => {
    const expTime = parseExpireTimestamp(props.server.expire_date)
    return !Number.isNaN(expTime) && expTime < currentTime.value
  })

  const expireText = computed(() => {
    const expTime = parseExpireTimestamp(props.server.expire_date)
    if (Number.isNaN(expTime)) return ''
    const diff = expTime - currentTime.value
    const days = Math.ceil(diff / (1000 * 3600 * 24))
    return days > 0 ? `${days}${trans.value.expireDays}` : trans.value.expired
  })

  const getRingStyle = (value, color) => ({
    '--ring-value': `${clampPercent(value)}`,
    '--ring-color': color
  })

  const getMemoryRingStyle = (ramValue, ramColor, swapValue, swapColor) => ({
    ...getRingStyle(ramValue, ramColor),
    '--swap-ring-value': `${clampPercent(swapValue)}`,
    '--swap-ring-color': swapColor
  })

  const roundedPercent = (value) => Math.round(clampPercent(value))

  const isPingDisabled = (ping) => ping === false || ping === 'false'

  const isPingValid = (ping) => {
    if (isPingDisabled(ping)) return false
    if (ping === null || ping === undefined || ping === '' || ping === '0') {
      return false
    }
    const val = Number(ping)
    return Number.isFinite(val) && val > 0
  }

  const getPingColor = (ping) => {
    if (!isPingValid(ping)) return 'var(--accent-red)'
    const val = Number(ping)
    if (val < PING.GOOD_THRESHOLD) return 'var(--accent-green)'
    if (val < PING.WARNING_THRESHOLD) return 'var(--accent-blue)'
    if (val < PING.CRITICAL_THRESHOLD) return 'var(--accent-yellow)'
    return 'var(--accent-red)'
  }

  const getLossColor = (loss) => {
    const value = normalizeProbeMetricValue(loss)
    if (value === null || value === false) return 'var(--text-secondary)'
    const clamped = Math.max(0, Math.min(100, value))
    if (clamped <= 0) return 'var(--accent-green)'
    if (clamped < 5) return 'var(--accent-blue)'
    if (clamped < 20) return 'var(--accent-yellow)'
    return 'var(--accent-red)'
  }

  const formatPingValue = (value) => isPingValid(value) ? `${Math.round(Number(value))}ms` : trans.value.timeout
  const formatLossValue = (value) => formatPercentValue(normalizeProbeMetricValue(value))
  const noSampleText = computed(() => trans.value.noSamples)

  const formatLatencyTimeText = (timestamp) => {
    const startTs = normalizeLatencyTimestamp(timestamp, 0)
    if (!startTs) return ''
    const date = new Date(startTs)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const formatBucketTooltip = (timestamp, summary) => {
    const timeText = formatLatencyTimeText(timestamp)
    return timeText ? `${timeText} · ${summary}` : summary
  }

  const formatPingBucketSummary = (hasPing, ping, offline, unmeasured) => {
    if (unmeasured) return noSampleText.value
    if (offline) return trans.value.offline
    if (hasPing) return `${trimFixed(ping, 1)} ms`
    return trans.value.timeout || noSampleText.value
  }

  const formatLossBucketSummary = (hasLoss, loss, offline, unmeasured) => {
    if (unmeasured) return noSampleText.value
    if (offline) return trans.value.offline
    if (hasLoss) return `${trimFixed(Math.max(0, Math.min(100, loss)), 1)}%`
    return noSampleText.value
  }

  const getLatencySeries = (seriesName, key) => {
    const source = Array.isArray(props.server[seriesName]) ? props.server[seriesName] : []
    const byTs = new Map()
    for (const point of source) {
      if (!point || typeof point !== 'object') continue
      const ts = normalizeLatencyTimestamp(point.ts ?? point.timestamp, 0)
      if (!ts) continue
      const sampled = hasMeasuredPayloadKeys(point)
      const value = normalizeProbeMetricValue(point[key])
      const prev = byTs.get(ts)
      byTs.set(ts, {
        ts,
        value,
        sampled: Boolean(sampled || prev?.sampled)
      })
    }
    return Array.from(byTs.values())
      .sort((a, b) => a.ts - b.ts)
      .slice(-MAX_LATENCY_RENDER_BUCKETS)
  }

  const isPositivePingNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
  const isNonNegativeLossNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

  const hasSingleNodeSample = (item) => (
    isPositivePingNumber(item?.ping) || isNonNegativeLossNumber(item?.loss)
  )

  // 按时间戳归并对齐单节点的 pingSeries 与 lossSeries：
  // 若该节点从未出现过非 null 有效数值，返回空数组（全部渲染为灰色 unmeasured，不误报红色故障）；
  // 首次出现非 null 有效样本之前的纯 null 桶同样归入左侧 unmeasured 槽位。
  const mergeAlignedLatencySamples = (pingSeries, lossSeries) => {
    const mergedMap = new Map()
    for (const item of pingSeries) {
      mergedMap.set(item.ts, {
        ts: item.ts,
        ping: item.value,
        loss: null,
        sampled: item.sampled
      })
    }
    for (const item of lossSeries) {
      const existing = mergedMap.get(item.ts)
      if (existing) {
        existing.loss = item.value
        existing.sampled = Boolean(existing.sampled || item.sampled)
      } else {
        mergedMap.set(item.ts, {
          ts: item.ts,
          ping: null,
          loss: item.value,
          sampled: item.sampled
        })
      }
    }

    const sorted = Array.from(mergedMap.values()).sort((a, b) => a.ts - b.ts)
    const firstNodeSampleIndex = sorted.findIndex(hasSingleNodeSample)
    if (firstNodeSampleIndex === -1) return []
    return sorted.slice(firstNodeSampleIndex).slice(-MAX_LATENCY_RENDER_BUCKETS)
  }

  const getLatestSeriesValue = (series, fallback, isPingMetric = false) => {
    for (let index = series.length - 1; index >= 0; index -= 1) {
      const val = series[index].value
      if (val !== null && val !== false && Number.isFinite(val)) {
        if (!isPingMetric || val > 0) return val
      }
    }
    const value = normalizeProbeMetricValue(fallback)
    if (value === false || value === null) return null
    if (isPingMetric && value <= 0) return null
    return value
  }

  const getAverageSeriesValue = (series, fallback) => {
    const values = series
      .map(point => normalizeProbeMetricValue(point.value))
      .filter(value => typeof value === 'number' && Number.isFinite(value))
      .map(value => Math.max(0, Math.min(100, value)))
    if (values.length > 0) {
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }
    const value = normalizeProbeMetricValue(fallback)
    return value === false || value === null ? null : Math.max(0, Math.min(100, value))
  }

  const getLatencyWindowConfigPointCount = () => {
    const points = Number(props.sysConfig?.latency_window?.points)
    const base = Number.isInteger(points) && points > 0 ? points : DEFAULT_THREE_NET_POINT_COUNT
    return Math.min(base, MAX_LATENCY_RENDER_BUCKETS)
  }

  // 判定“后台把该节点设成了 0（不使用该节点）”：优先用实时上报的 loss 标量（秒级生效），
  // 缺失时回退到 loss 窗口的最后一条（最多滞后一个缓存周期）。只认 false，数值 0 是合法的 0% 丢包。
  const isDisabledByLatestLoss = (key) => {
    const realtime = normalizeProbeMetricValue(props.server[`loss_${key}`])
    if (realtime === false) return true
    if (realtime !== null) return false

    const loss = Array.isArray(props.server.loss) ? props.server.loss : []
    if (loss.length === 0) return false
    const last = loss[loss.length - 1]
    if (!last || typeof last !== 'object') return false
    return normalizeProbeMetricValue(last[key]) === false
  }

  const resolveNodeLabel = (def) => {
    const rawName = props.sysConfig?.[def.nameKey]
    const localizedFallback = (def.labelKey && trans.value?.[def.labelKey]) || def.fallbackLabel
    return resolveLocalizedPingName(rawName, def.builtinDefault, localizedFallback)
  }

  const buildThreeNetRow = (def) => {
    const label = resolveNodeLabel(def)
    const pingSeries = getLatencySeries('ping', def.key)
    const lossSeries = getLatencySeries('loss', def.key)
    const alignedSamples = mergeAlignedLatencySamples(pingSeries, lossSeries)
    const actualCount = alignedSamples.length
    const targetPointCount = Math.min(
      MAX_LATENCY_RENDER_BUCKETS,
      Math.max(actualCount, getLatencyWindowConfigPointCount())
    )
    const unmeasuredCount = Math.max(0, targetPointCount - actualCount)

    const points = Array.from({ length: targetPointCount }, (_, index) => {
      const tooltipShift = computeTooltipShift(index, targetPointCount)
      if (index < unmeasuredCount) {
        return {
          unmeasured: true,
          offline: false,
          timestamp: null,
          ping: null,
          loss: null,
          pingHeight: 25,
          lossHeight: 25,
          pingColor: UNMEASURED_BUCKET_COLOR,
          lossColor: UNMEASURED_BUCKET_COLOR,
          pingOpacity: 1,
          lossOpacity: 1,
          tooltipShift,
          pingTooltip: formatPingBucketSummary(false, null, false, true),
          lossTooltip: formatLossBucketSummary(false, null, false, true)
        }
      }

      const sample = alignedSamples[index - unmeasuredCount]
      const rawPing = sample?.ping
      const rawLoss = sample?.loss
      const timestamp = sample?.ts ?? null
      const hasPing = typeof rawPing === 'number' && Number.isFinite(rawPing) && rawPing > 0
      const hasLoss = typeof rawLoss === 'number' && Number.isFinite(rawLoss) && rawLoss >= 0
      const ping = hasPing ? rawPing : null
      const loss = hasLoss ? Math.max(0, Math.min(100, rawLoss)) : null
      const offline = !hasPing && !hasLoss
      const pingSummary = formatPingBucketSummary(hasPing, ping, offline, false)
      const lossSummary = formatLossBucketSummary(hasLoss, loss, offline, false)

      return {
        unmeasured: false,
        offline,
        timestamp,
        ping,
        loss,
        pingHeight: hasPing ? 84 : 25,
        lossHeight: hasLoss ? 84 : 25,
        pingColor: hasPing ? getPingColor(ping) : 'var(--accent-red)',
        lossColor: offline ? 'var(--accent-red)' : (hasLoss ? getLossColor(loss) : UNMEASURED_BUCKET_COLOR),
        pingOpacity: hasPing ? 0.94 : 0.52,
        lossOpacity: hasLoss ? 0.94 : (offline ? 0.52 : 1),
        tooltipShift,
        pingTooltip: formatBucketTooltip(timestamp, pingSummary),
        lossTooltip: formatBucketTooltip(timestamp, lossSummary)
      }
    })

    const hasMeasuredPoint = points.some(point => !point.unmeasured && (point.ping !== null || point.loss !== null))
    const allUnmeasured = points.every(point => point.unmeasured)
    const latestPing = getLatestSeriesValue(pingSeries, props.server[def.pingField], true)
    const averageLoss = getAverageSeriesValue(lossSeries, props.server[def.lossField])
    const isUnmeasuredRow = allUnmeasured && latestPing === null && averageLoss === null

    return {
      ...def,
      label,
      isCompact: targetPointCount > 30,
      isUnmeasuredRow,
      latestPing,
      averageLoss,
      title: isUnmeasuredRow ? `${label} ${noSampleText.value}` : (hasMeasuredPoint ? '' : `${label} ${trans.value.offline}`),
      points
    }
  }

  const hasNodeRealtimeSample = (def) => {
    const rtPing = normalizeProbeMetricValue(props.server[def.pingField])
    const rtLoss = normalizeProbeMetricValue(props.server[def.lossField])
    return isPositivePingNumber(rtPing) || isNonNegativeLossNumber(rtLoss)
  }

  const hasNodeHistorySample = (def) => {
    const pingSeries = getLatencySeries('ping', def.key)
    const lossSeries = getLatencySeries('loss', def.key)
    return pingSeries.some(p => isPositivePingNumber(p.value)) || lossSeries.some(p => isNonNegativeLossNumber(p.value))
  }

  const threeNetDetails = computed(() => {
    const active = []
    const idle = []
    const disabled = []
    for (const def of THREE_NET_DEFS) {
      if (isDisabledByLatestLoss(def.key) || isPingDisabled(props.server[def.pingField])) {
        disabled.push(def)
      } else if (hasNodeRealtimeSample(def) || hasNodeHistorySample(def)) {
        active.push(def)
      } else {
        idle.push(def)
      }
    }
    // 有有效样本的节点排在全 null 未配置节点之前；不足 3 个时依次用未配置节点与禁用节点补位
    return [...active, ...idle, ...disabled].slice(0, 3).map(buildThreeNetRow)
  })

  const hasThreeNetDetails = computed(() => threeNetDetails.value.length > 0)

  const pingList = computed(() => THREE_NET_DEFS.filter(def => {
    if (isDisabledByLatestLoss(def.key) || isPingDisabled(props.server[def.pingField])) return false
    const rawPing = props.server[def.pingField]
    if (rawPing === 0 || rawPing === '0') return false
    return hasNodeRealtimeSample(def) || hasNodeHistorySample(def)
  }).map(def => {
    const pingSeries = getLatencySeries('ping', def.key)
    const latestPing = getLatestSeriesValue(pingSeries, props.server[def.pingField], true)
    return {
      key: def.key,
      label: resolveNodeLabel(def),
      value: latestPing !== null ? latestPing : props.server[def.pingField]
    }
  }))

  const hasPingData = computed(() => pingList.value.length > 0)

  return {
    trans,
    currentTime,
    regionCode,
    isOnline,
    statusColor,
    statusText,
    cpuPercent,
    cpuCores,
    ramPercent,
    swapPercent,
    hasSwapData,
    diskPercent,
    trafficLimitSummary,
    trafficUsagePercent,
    trafficUsageBarWidth,
    trafficUsagePercentText,
    trafficLimitPercentText,
    trafficUsageFullTitle,
    trafficLimitText,
    tagList,
    visibleTagList,
    hiddenTagCount,
    hiddenTagsTitle,
    tagColorClass,
    hasPublicIPv4,
    hasPublicIPv6,
    netInSpeed,
    netOutSpeed,
    tcpConn,
    udpConn,
    connPair,
    totalRx,
    totalTx,
    totalRxMonthly,
    totalTxMonthly,
    priceText,
    expireDateTitle,
    loadAvg,
    uptimeText,
    ramUsageText,
    diskUsageText,
    isExpired,
    expireText,
    getUsageColor,
    getRingStyle,
    getMemoryRingStyle,
    roundedPercent,
    isPingValid,
    isPingDisabled,
    getPingColor,
    getLossColor,
    formatPingValue,
    formatLossValue,
    pingList,
    hasPingData,
    threeNetDetails,
    hasThreeNetDetails,
    getPublicAssetUrl,
    formatBytes,
    gbToBytes
  }
}
