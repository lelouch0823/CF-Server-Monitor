<template>
  <router-link :to="to" class="server-card" :data-region="regionCode">
    <div class="server-card-header">
      <div class="server-identity">
        <span class="country-os-icons">
          <RegionFlag :region="server.region" />
          <OsIcon :os="server.os" />
        </span>
        <span class="server-name" :title="server.name">{{ server.name }}</span>
      </div>
      <span class="status-label" :style="{ color: statusColor, borderColor: statusColor }">{{ statusText }}</span>
    </div>
    <div class="server-meta">
      <div class="card-meta">
        <div v-if="sysConfig.show_price && priceText" class="card-meta-item">💰 {{ priceText }}</div>
        <div v-if="sysConfig.show_expire && server.expire_date" class="card-meta-item card-meta-expire">
          📅 <span :class="{ 'expired': isExpired }">{{ expireText }}</span>
          <span v-if="expireDateTitle" class="card-meta-tooltip">{{ expireDateTitle }}</span>
        </div>
      </div>
      <div class="card-badges">
        <span
          v-for="(tag, index) in visibleTagList"
          :key="`${index}-${tag}`"
          :title="tag"
          :class="['badge', 'badge-tag', tagColorClass(index)]"
        >{{ tag }}</span>
        <span
          v-if="hiddenTagCount > 0"
          class="badge badge-tag badge-tag-more"
          :title="tagList.join(', ')"
        >+{{ hiddenTagCount }}</span>
        <span v-if="hasPublicIPv4 && hasPublicIPv6" class="badge badge-v4-v6">IPv4/6</span>
        <template v-else>
          <span v-if="hasPublicIPv4" class="badge badge-v4">IPv4</span>
          <span v-if="hasPublicIPv6" class="badge badge-v6">IPv6</span>
        </template>
      </div>
    </div>
    <div class="server-stats">
      <div class="stat-row">
        <span class="stat-key">CPU</span>
        <div class="stat-content stat-content-meter">
          <div class="stat-bar-container">
            <div class="stat-bar-fill" :style="{ width: Math.max(0, Math.min(100, cpuPercent)) + '%', background: getUsageColor(cpuPercent) }"></div>
          </div>
          <span class="stat-value">{{ cpuPercent.toFixed(2) }}%</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-key">RAM</span>
        <div class="stat-content stat-content-meter">
          <div class="stat-bar-container">
            <div class="stat-bar-fill" :style="{ width: Math.max(0, Math.min(100, ramPercent)) + '%', background: getUsageColor(ramPercent) }"></div>
          </div>
          <span class="stat-value">{{ ramPercent.toFixed(2) }}%</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-key">DISK</span>
        <div class="stat-content stat-content-meter">
          <div class="stat-bar-container">
            <div class="stat-bar-fill" :style="{ width: Math.max(0, Math.min(100, diskPercent)) + '%', background: getUsageColor(diskPercent) }"></div>
          </div>
          <span class="stat-value">{{ diskPercent.toFixed(2) }}%</span>
        </div>
      </div>
      <div class="stat-row" v-if="sysConfig.show_tf">
        <span class="stat-key">USE</span>
        <div class="stat-content stat-content-meter">
          <template v-if="trafficLimitSummary">
            <div class="stat-bar-container">
              <div class="stat-bar-fill" :style="{ width: trafficUsageBarWidth, background: getUsageColor(trafficUsagePercent) }"></div>
            </div>
            <span class="stat-value" :title="trafficUsageFullTitle || undefined">{{ trafficUsagePercentText }}%</span>
          </template>
          <template v-else>
            <div class="stat-bar-container">
              <div class="stat-bar-fill" style="width: 100%; background-image: linear-gradient(to right, #00d4aa, #4da6ff, #ffb870, #f85149);"></div>
            </div>
            <span class="stat-value" style="font-size: 2em; line-height: 0;">∞</span>
          </template>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-key">LOAD</span>
        <div class="stat-content">
          <span class="net-down">{{ loadAvg[0].toFixed(2) }}</span>
          <span>{{ loadAvg[1].toFixed(2) }}</span>
          <span class="net-up">{{ loadAvg[2].toFixed(2) }}</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-key">NET</span>
        <div class="stat-content">
          <span class="net-down">▼ {{ netInSpeed }}/s</span>
          <span class="net-up">▲ {{ netOutSpeed }}/s</span>
        </div>
      </div>
      <div class="stat-row">
        <span class="stat-key">TRF</span>
        <div class="stat-content">
          <span class="net-down">▼ {{ totalRxMonthly }}</span>
          <span class="net-up">▲ {{ totalTxMonthly }}</span>
          <span v-if="sysConfig.show_tf && trafficLimitSummary" class="stat-limit">/ 📦 {{ formatBytes(trafficLimitSummary.limitBytes) }}</span>
        </div>
      </div>
    </div>
    <div class="server-space"></div>
    <ServerLatencyPanel
      :show-three-net-details="sysConfig.show_three_net_details"
      :has-three-net-details="hasThreeNetDetails"
      :three-net-details="threeNetDetails"
      :has-ping-data="hasPingData"
      :ping-list="pingList"
      :timeout-text="trans.timeout"
      :get-ping-color="getPingColor"
      :get-loss-color="getLossColor"
      :format-ping-value="formatPingValue"
      :format-loss-value="formatLossValue"
      :is-ping-valid="isPingValid"
    />
  </router-link>
</template>

<script setup>
import OsIcon from './OsIcon.vue'
import RegionFlag from './RegionFlag.vue'
import ServerLatencyPanel from './ServerLatencyPanel.vue'
import { DEFAULT_SERVER_CARD_CONFIG, useServerCardData } from '../composables/useServerCardData'

const props = defineProps({
  server: {
    type: Object,
    required: true
  },
  sysConfig: {
    type: Object,
    default: () => ({ ...DEFAULT_SERVER_CARD_CONFIG })
  },
  to: {
    type: String,
    default: ''
  }
})

const {
  trans,
  regionCode,
  statusColor,
  statusText,
  cpuPercent,
  ramPercent,
  diskPercent,
  trafficLimitSummary,
  trafficUsagePercent,
  trafficUsageBarWidth,
  trafficUsagePercentText,
  trafficUsageFullTitle,
  getUsageColor,
  tagList,
  visibleTagList,
  hiddenTagCount,
  tagColorClass,
  hasPublicIPv4,
  hasPublicIPv6,
  netInSpeed,
  netOutSpeed,
  totalRxMonthly,
  totalTxMonthly,
  priceText,
  expireDateTitle,
  loadAvg,
  isExpired,
  expireText,
  isPingValid,
  getPingColor,
  getLossColor,
  formatPingValue,
  formatLossValue,
  pingList,
  hasPingData,
  threeNetDetails,
  hasThreeNetDetails,
  formatBytes
} = useServerCardData(props)
</script>

<style scoped>
.server-card {
  min-width: 0;
  max-width: 100%;
}

.server-card-header {
  gap: 8px;
  min-width: 0;
}

.server-identity {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.country-os-icons {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.server-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-label {
  flex-shrink: 0;
  white-space: nowrap;
}

.server-meta {
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.card-badges {
  min-width: 0;
  max-width: 100%;
}

.badge-tag {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge-tag-more {
  background: rgba(128, 128, 128, 0.28);
  color: var(--text-primary);
}
</style>
