<template>
  <div class="modal-overlay" :class="{ active: show }" role="dialog" aria-modal="true" :aria-label="`${trans.batchEdit} [${selectedCount}]`">
    <div class="modal-dialog batch-edit-modal">
      <div class="modal-header">
        <div class="modal-title">{{ trans.batchEdit }} [{{ selectedCount }}]</div>
        <button type="button" class="modal-close" :disabled="saving" @click="$emit('close')">×</button>
      </div>

      <div class="batch-edit-grid">
        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.basicInfo || 'Basic' }}</div>
          <BatchEditField :enabled="enabled.server_group" :label="trans.groupName" @toggle="toggleField('server_group', $event)">
            <input type="text" v-model="form.server_group" class="form-input" :disabled="!enabled.server_group" placeholder="Default">
          </BatchEditField>
          <BatchEditField :enabled="enabled.region" :label="`${trans.region} CN/US/GB`" @toggle="toggleField('region', $event)">
            <input type="text" v-model.trim="form.region" class="form-input" :disabled="!enabled.region" :placeholder="trans.regionPlaceholder">
          </BatchEditField>
          <BatchEditField :enabled="enabled.tags" :label="trans.tags" @toggle="toggleField('tags', $event)">
            <input type="text" v-model="form.tags" class="form-input" :disabled="!enabled.tags" :placeholder="trans.tagsPlaceholder">
          </BatchEditField>
        </div>

        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.billing || 'Billing' }}</div>
          <BatchEditField :enabled="enabled.currency" :label="trans.currency" @toggle="toggleField('currency', $event)">
            <select v-model="form.currency" class="form-select" :disabled="!enabled.currency">
              <option v-for="item in currencySelectOptions" :key="item.symbol" :value="item.symbol">{{ currencyLabel(item) }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.price" :label="trans.price" @toggle="toggleField('price', $event)">
            <input type="text" inputmode="decimal" v-model="form.price" :class="['form-input', { 'input-invalid': fieldErrors.price }]" :disabled="!enabled.price" placeholder="40.00" @blur="normalizeBatchPriceInput">
            <p v-if="fieldErrors.price" class="text-red text-sm mt-1">{{ fieldErrors.price }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.billing_cycle" :label="trans.billingCycle" @toggle="toggleField('billing_cycle', $event)">
            <select v-model="form.billing_cycle" class="form-select" :disabled="!enabled.billing_cycle">
              <option v-for="item in billingCycleOptions" :key="item.value" :value="item.value">{{ cycleLabel(item) }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.expire_date" :label="trans.expirationDate" @toggle="toggleField('expire_date', $event)">
            <input type="date" v-model="form.expire_date" class="form-input" :disabled="!enabled.expire_date" @click="openDatePicker">
          </BatchEditField>
          <BatchEditField :enabled="enabled.auto_renewal" :label="trans.autoRenewal" @toggle="toggleField('auto_renewal', $event)">
            <select v-model="form.auto_renewal" class="form-select" :disabled="!enabled.auto_renewal">
              <option :value="true">{{ trans.enabled }}</option>
              <option :value="false">{{ trans.disabled }}</option>
            </select>
          </BatchEditField>
        </div>

        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.monthlyTraffic }}</div>
          <BatchEditField :enabled="enabled.traffic_limit" :label="`${trans.trafficLimit} (GB)`" @toggle="toggleField('traffic_limit', $event)">
            <input type="text" inputmode="decimal" v-model="form.traffic_limit" :class="['form-input', { 'input-invalid': fieldErrors.traffic_limit }]" :disabled="!enabled.traffic_limit">
            <p v-if="fieldErrors.traffic_limit" class="text-red text-sm mt-1">{{ fieldErrors.traffic_limit }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.traffic_calc_type" :label="trans.trafficCalcType" @toggle="toggleField('traffic_calc_type', $event)">
            <select v-model="form.traffic_calc_type" class="form-select" :disabled="!enabled.traffic_calc_type">
              <option value="total">{{ trans.trafficCalcTotal }}</option>
              <option value="ul">{{ trans.trafficCalcUl }}</option>
              <option value="dl">{{ trans.trafficCalcDl }}</option>
              <option value="max">{{ trans.trafficCalcMax }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.reset_day" :label="trans.trafficResetDay" @toggle="toggleField('reset_day', $event)">
            <select v-model="form.reset_day" class="form-select" :disabled="!enabled.reset_day">
              <option :value="0">0</option>
              <option v-for="day in 31" :key="day" :value="day">{{ day }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.traffic_alert_percent" :label="`${trans.trafficAlertPercent} (%)`" @toggle="toggleField('traffic_alert_percent', $event)">
            <input type="text" inputmode="numeric" v-model="form.traffic_alert_percent" :class="['form-input', { 'input-invalid': fieldErrors.traffic_alert_percent }]" :disabled="!enabled.traffic_alert_percent">
            <p v-if="fieldErrors.traffic_alert_percent" class="text-red text-sm mt-1">{{ fieldErrors.traffic_alert_percent }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.rx_correction" :label="`${trans.rxCorrection} (GB)`" @toggle="toggleField('rx_correction', $event)">
            <input type="text" inputmode="decimal" v-model="form.rx_correction" :class="['form-input', { 'input-invalid': fieldErrors.rx_correction }]" :disabled="!enabled.rx_correction">
            <p v-if="fieldErrors.rx_correction" class="text-red text-sm mt-1">{{ fieldErrors.rx_correction }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.tx_correction" :label="`${trans.txCorrection} (GB)`" @toggle="toggleField('tx_correction', $event)">
            <input type="text" inputmode="decimal" v-model="form.tx_correction" :class="['form-input', { 'input-invalid': fieldErrors.tx_correction }]" :disabled="!enabled.tx_correction">
            <p v-if="fieldErrors.tx_correction" class="text-red text-sm mt-1">{{ fieldErrors.tx_correction }}</p>
          </BatchEditField>
        </div>

        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.editConf }}</div>
          <BatchEditField :enabled="enabled.collect_interval" :label="trans.collectInterval" @toggle="toggleField('collect_interval', $event)">
            <select v-model="form.collect_interval" class="form-select" :disabled="!enabled.collect_interval">
              <option :value="0">0</option>
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="5">5</option>
              <option :value="10">10</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.report_interval" :label="trans.reportInterval" @toggle="toggleField('report_interval', $event)">
            <select v-model="form.report_interval" class="form-select" :disabled="!enabled.report_interval">
              <option :value="30">30</option>
              <option :value="60">60</option>
              <option :value="120">120</option>
              <option :value="180">180</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.connection_mode" :label="trans.connectionMode" @toggle="toggleField('connection_mode', $event)">
            <select v-model="form.connection_mode" class="form-select" :disabled="!enabled.connection_mode || !isWssReportEnabled">
              <option value="auto">{{ trans.connectionModeAuto }}</option>
              <option value="http">{{ trans.connectionModeHttp }}</option>
            </select>
          </BatchEditField>
          <BatchEditField v-if="isWssReportEnabled && form.connection_mode === 'auto'" :enabled="enabled.wss_report_interval" :label="trans.wssReportInterval" @toggle="toggleField('wss_report_interval', $event)">
            <select v-model="form.wss_report_interval" class="form-select" :disabled="!enabled.wss_report_interval">
              <option v-for="second in 5" :key="second" :value="second">{{ second }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.ping_mode" :label="trans.pingMode" @toggle="toggleField('ping_mode', $event)">
            <select v-model="form.ping_mode" class="form-select" :disabled="!enabled.ping_mode">
              <option value="tcp">TCP</option>
              <option value="icmp">ICMP (root)</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.interface" :label="trans.networkInterface" @toggle="toggleField('interface', $event)">
            <input type="text" v-model.trim="form.interface" :class="['form-input', { 'input-invalid': fieldErrors.interface }]" :disabled="!enabled.interface" placeholder="eth0">
            <p v-if="fieldErrors.interface" class="text-red text-sm mt-1">{{ fieldErrors.interface }}</p>
          </BatchEditField>
        </div>

        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.pingNodes }}</div>
          <BatchEditField :enabled="enabled.custom_ct" :label="pingNodeLabel('custom_ct')" @toggle="toggleField('custom_ct', $event)">
            <input type="text" v-model.trim="form.custom_ct" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_ct }]" :disabled="!enabled.custom_ct" :placeholder="settings.custom_ct || 'gd-ct-dualstack.ip.zstaticcdn.com'">
            <p v-if="pingNodeErrors.custom_ct" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_ct }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.custom_cu" :label="pingNodeLabel('custom_cu')" @toggle="toggleField('custom_cu', $event)">
            <input type="text" v-model.trim="form.custom_cu" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cu }]" :disabled="!enabled.custom_cu" :placeholder="settings.custom_cu || 'gd-cu-dualstack.ip.zstaticcdn.com'">
            <p v-if="pingNodeErrors.custom_cu" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cu }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.custom_cm" :label="pingNodeLabel('custom_cm')" @toggle="toggleField('custom_cm', $event)">
            <input type="text" v-model.trim="form.custom_cm" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cm }]" :disabled="!enabled.custom_cm" :placeholder="settings.custom_cm || 'gd-cm-dualstack.ip.zstaticcdn.com'">
            <p v-if="pingNodeErrors.custom_cm" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cm }}</p>
          </BatchEditField>
          <BatchEditField :enabled="enabled.custom_bd" :label="pingNodeLabel('custom_bd')" @toggle="toggleField('custom_bd', $event)">
            <input type="text" v-model.trim="form.custom_bd" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_bd }]" :disabled="!enabled.custom_bd" :placeholder="settings.custom_bd || 'ip.zstaticcdn.com'">
            <p v-if="pingNodeErrors.custom_bd" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_bd }}</p>
          </BatchEditField>
          <BatchEditField v-for="field in ['node_1', 'node_2', 'node_3', 'node_4']" :key="field" :enabled="enabled[field]" :label="pingNodeLabel(field)" @toggle="toggleField(field, $event)">
            <input type="text" v-model.trim="form[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" :disabled="!enabled[field]" :placeholder="settings[field] || 'host[:port] / [IPv6]:port'">
            <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
          </BatchEditField>
        </div>

        <div class="batch-edit-section">
          <div class="section-subtitle">{{ trans.displayOptions }}</div>
          <BatchEditField :enabled="enabled.auto_update" :label="trans.autoUpdate" @toggle="toggleField('auto_update', $event)">
            <select v-model="form.auto_update" class="form-select" :disabled="!enabled.auto_update">
              <option :value="true">{{ trans.enabled }}</option>
              <option :value="false">{{ trans.disabled }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.is_hidden" :label="trans.hideFromPublic" @toggle="toggleField('is_hidden', $event)">
            <select v-model="form.is_hidden" class="form-select" :disabled="!enabled.is_hidden">
              <option :value="true">{{ trans.enabled }}</option>
              <option :value="false">{{ trans.disabled }}</option>
            </select>
          </BatchEditField>
          <BatchEditField :enabled="enabled.offline_notify_disabled" :label="trans.disableOfflineNotify" @toggle="toggleField('offline_notify_disabled', $event)">
            <select v-model="form.offline_notify_disabled" class="form-select" :disabled="!enabled.offline_notify_disabled">
              <option :value="true">{{ trans.enabled }}</option>
              <option :value="false">{{ trans.disabled }}</option>
            </select>
          </BatchEditField>
        </div>
      </div>

      <div class="modal-footer flex-justify-between">
        <button type="button" @click="$emit('save')" class="btn btn-primary" :disabled="!hasEnabledFields || saving || hasValidationErrors">{{ saving ? trans.saving : trans.save }}</button>
        <button type="button" @click="$emit('close')" class="btn" :disabled="saving">{{ trans.cancel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import BatchEditField from './BatchEditField.vue'
import { useModal } from '../../../composables/useModal.js'
import { PING_NODE_FIELDS, validatePingNode } from '../../../utils/pingNode.js'
import { currentLang } from '../../../utils/i18n.js'
import {
  BILLING_CYCLES,
  CURRENCY_OPTIONS,
  getLocalizedOptionField,
  getLocalizedPingNodeLabel,
  validateNetworkInterfaceInput,
  validatePriceInput,
  validateTrafficAlertPercentInput,
  validateTrafficCorrectionInput,
  validateTrafficLimitInput
} from '../../../utils/server.js'

const form = defineModel('form', { type: Object, required: true })
const enabled = defineModel('enabled', { type: Object, required: true })

const props = defineProps({
  trans: { type: Object, required: true },
  show: { type: Boolean, default: false },
  selectedCount: { type: Number, default: 0 },
  settings: { type: Object, required: true },
  isWssReportEnabled: { type: Boolean, default: false },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['save', 'close'])

useModal(() => props.show, () => emit('close'), {
  canClose: () => !props.saving
})

const pingNodeLabel = (field) => getLocalizedPingNodeLabel(field, props.settings, props.trans)

const pingNodeErrorMessage = computed(() => (
  props.trans.invalidPingNodeFormat || 'Use domain, IPv4, or host:port. Port must be 1-65535.'
))

const pingNodeErrors = computed(() => Object.fromEntries(
  PING_NODE_FIELDS.map(field => [
    field,
    enabled.value[field] && !validatePingNode(form.value[field]).valid ? pingNodeErrorMessage.value : ''
  ])
))

const fieldErrors = computed(() => ({
  price: enabled.value.price && !validatePriceInput(form.value.price).valid ? (props.trans.invalidPrice || 'Invalid price') : '',
  traffic_limit: enabled.value.traffic_limit && !validateTrafficLimitInput(form.value.traffic_limit).valid ? (props.trans.invalidTrafficLimit || 'Invalid traffic limit') : '',
  traffic_alert_percent: enabled.value.traffic_alert_percent && !validateTrafficAlertPercentInput(form.value.traffic_alert_percent).valid ? (props.trans.invalidTrafficAlertPercent || 'Invalid threshold') : '',
  rx_correction: enabled.value.rx_correction && !validateTrafficCorrectionInput(form.value.rx_correction).valid ? (props.trans.invalidTrafficCorrection || 'Invalid traffic correction') : '',
  tx_correction: enabled.value.tx_correction && !validateTrafficCorrectionInput(form.value.tx_correction).valid ? (props.trans.invalidTrafficCorrection || 'Invalid traffic correction') : '',
  interface: enabled.value.interface && !validateNetworkInterfaceInput(form.value.interface).valid ? (props.trans.invalidNetworkInterface || 'Invalid network interface') : ''
}))

const hasValidationErrors = computed(() => (
  Object.values(pingNodeErrors.value).some(Boolean) ||
  Object.values(fieldErrors.value).some(Boolean)
))

const billingCycleOptions = BILLING_CYCLES
const currencyOptions = CURRENCY_OPTIONS
const currencySelectOptions = computed(() => {
  const currentCurrency = String(form.value.currency || '').trim()
  if (!currentCurrency || currencyOptions.some(item => item.symbol === currentCurrency)) {
    return currencyOptions
  }
  return [
    { symbol: currentCurrency, nameZh: currentCurrency, nameEn: currentCurrency },
    ...currencyOptions
  ]
})

const cycleLabel = (item) => getLocalizedOptionField(item, 'label', currentLang.value)
const currencyLabel = (item) => `${item.symbol} ${getLocalizedOptionField(item, 'name', currentLang.value)}`

const hasEnabledFields = computed(() => Object.values(enabled.value).some(Boolean))

const toggleField = (field, checked) => {
  enabled.value[field] = checked
}

const normalizeBatchPriceInput = () => {
  if (!enabled.value.price) return
  const check = validatePriceInput(form.value.price)
  if (check.valid) {
    form.value.price = check.value
  }
}

const openDatePicker = (event) => {
  const input = event?.currentTarget
  if (typeof input?.showPicker !== 'function') return
  try {
    input.showPicker()
  } catch (_) {}
}
</script>
