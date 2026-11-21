<template>
  <div id="editModal" class="modal-overlay" :class="{ active: show }" role="dialog" aria-modal="true" :aria-label="currentServerName || trans.editConf">
    <div class="modal-dialog edit-server-modal">
      <div class="modal-header">
        <div class="modal-title">{{ currentServerName }}</div>
        <button type="button" class="modal-close" :disabled="saving" @click="$emit('close')">✕</button>
      </div>
      <input type="hidden" v-model="editForm.id">

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.hostnameLabel }} <span class="required">*</span></label>
          <input type="text" name="edit_name" autocomplete="off" maxlength="100" v-model="editForm.name" :class="['form-input', { 'input-invalid': fieldErrors.name }]" placeholder="e.g. My Server">
          <p v-if="fieldErrors.name" class="text-red text-sm mt-1">{{ fieldErrors.name }}</p>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.groupName }}</label>
          <input type="text" name="edit_server_group" autocomplete="off" v-model="editForm.server_group" class="form-input" placeholder="e.g. US VPS">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.tags }}</label>
          <input type="text" name="edit_tags" autocomplete="off" v-model="editForm.tags" class="form-input" :placeholder="trans.tagsPlaceholder">
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.region }} CN/US/GB</label>
          <input type="text" name="edit_region" autocomplete="off" v-model.trim="editForm.region" class="form-input" :placeholder="trans.regionPlaceholder">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">{{ trans.note }}</label>
        <textarea name="edit_note" autocomplete="off" v-model="editForm.note" class="form-textarea" rows="2" :placeholder="trans.notePlaceholder"></textarea>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.currency }}</label>
          <select v-model="editForm.currency" class="form-select">
            <option v-for="item in currencySelectOptions" :key="item.symbol" :value="item.symbol">{{ currencyLabel(item) }}</option>
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.price }}</label>
          <input type="text" name="edit_price" autocomplete="off" inputmode="decimal" v-model="editForm.price" :class="['form-input', { 'input-invalid': fieldErrors.price }]" placeholder="40.00" @blur="normalizePriceInput">
          <p v-if="fieldErrors.price" class="text-red text-sm mt-1">{{ fieldErrors.price }}</p>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.billingCycle }}</label>
          <select v-model="editForm.billing_cycle" class="form-select">
            <option v-for="item in billingCycleOptions" :key="item.value" :value="item.value">{{ cycleLabel(item) }}</option>
          </select>
        </div>

        <div class="form-group flex-1">
          <label class="form-label">{{ trans.expirationDate }}</label>
          <input type="date" name="edit_expire_date" autocomplete="off" v-model="editForm.expire_date" class="form-input" @click="openDatePicker">
        </div>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.trafficLimit }} (GB)</label>
          <input type="text" inputmode="decimal" name="edit_traffic_limit" autocomplete="off" v-model="editForm.traffic_limit" :class="['form-input', { 'input-invalid': fieldErrors.traffic_limit }]" placeholder="e.g. 1000">
          <p v-if="fieldErrors.traffic_limit" class="text-red text-sm mt-1">{{ fieldErrors.traffic_limit }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.trafficCalcType }}</label>
          <select v-model="editForm.traffic_calc_type" class="form-select">
            <option value="total">{{ trans.trafficCalcTotal }}</option>
            <option value="ul">{{ trans.trafficCalcUl }}</option>
            <option value="dl">{{ trans.trafficCalcDl }}</option>
            <option value="max">{{ trans.trafficCalcMax }}</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.trafficResetDay }}
            <HelpTooltip :text="trans.trafficResetDayTip" />
          </label>
          <select ref="editResetDayRef" name="edit_reset_day" v-model="editForm.reset_day" class="form-select">
            <option :value="0">0</option>
            <option v-for="day in 31" :key="day" :value="day">{{ day }}</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.trafficAlertPercent }} (%)
            <HelpTooltip :text="trans.trafficAlertPercentTip" />
          </label>
          <input type="text" inputmode="numeric" name="edit_traffic_alert_percent" autocomplete="off" v-model="editForm.traffic_alert_percent" :class="['form-input', { 'input-invalid': fieldErrors.traffic_alert_percent }]">
          <p v-if="fieldErrors.traffic_alert_percent" class="text-red text-sm mt-1">{{ fieldErrors.traffic_alert_percent }}</p>
        </div>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.collectInterval }}
            <HelpTooltip :text="trans.collectIntervalHint" />
          </label>
          <select v-model="editForm.collect_interval" class="form-select">
            <option :value="0">0</option>
            <option :value="1">1</option>
            <option :value="2">2</option>
            <option :value="5">5</option>
            <option :value="10">10</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">{{ trans.reportInterval }}</label>
          <select v-model="editForm.report_interval" class="form-select">
            <option :value="30">30</option>
            <option :value="60">60</option>
            <option :value="120">120</option>
            <option :value="180">180</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.connectionMode }}
            <HelpTooltip v-if="!isWssReportEnabled" :text="trans.wssReportDisabledConnectionHint" />
          </label>
          <select v-model="editForm.connection_mode" class="form-select" :disabled="!isWssReportEnabled">
            <option value="auto">{{ trans.connectionModeAuto }}</option>
            <option value="http">{{ trans.connectionModeHttp }}</option>
          </select>
        </div>
        <div v-if="isWssReportEnabled && editForm.connection_mode === 'auto'" class="form-group flex-1">
          <label class="form-label">{{ trans.wssReportInterval }}</label>
          <select v-model="editForm.wss_report_interval" class="form-select">
            <option v-for="second in 5" :key="second" :value="second">{{ second }}</option>
          </select>
        </div>
      </div>

      <div class="form-row mobile-two-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.pingMode }}
            <HelpTooltip :text="trans.pingModeIcmpRootHint" />
          </label>
          <select v-model="editForm.ping_mode" class="form-select">
            <option value="tcp">TCP</option>
            <option value="icmp">ICMP (root)</option>
          </select>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.networkInterface }}
            <HelpTooltip :text="trans.networkInterfaceHint" />
          </label>
          <input type="text" name="edit_interface" autocomplete="off" v-model.trim="editForm.interface" :class="['form-input', { 'input-invalid': fieldErrors.interface }]" placeholder="eth0">
          <p v-if="fieldErrors.interface" class="text-red text-sm mt-1">{{ fieldErrors.interface }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.rxCorrection }} (GB)
            <HelpTooltip :text="trans.correctionHint" />
          </label>
          <input type="text" inputmode="decimal" name="edit_rx_correction" autocomplete="off" v-model="editForm.rx_correction" :class="['form-input', { 'input-invalid': fieldErrors.rx_correction }]" placeholder="0">
          <p v-if="fieldErrors.rx_correction" class="text-red text-sm mt-1">{{ fieldErrors.rx_correction }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ trans.txCorrection }} (GB)
            <HelpTooltip :text="trans.correctionHint" />
          </label>
          <input type="text" inputmode="decimal" name="edit_tx_correction" autocomplete="off" v-model="editForm.tx_correction" :class="['form-input', { 'input-invalid': fieldErrors.tx_correction }]" placeholder="0">
          <p v-if="fieldErrors.tx_correction" class="text-red text-sm mt-1">{{ fieldErrors.tx_correction }}</p>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel('custom_ct') }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_ct" autocomplete="off" v-model.trim="editForm.custom_ct" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_ct }]" :placeholder="settings.custom_ct || 'gd-ct-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_ct" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_ct }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel('custom_cu') }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_cu" autocomplete="off" v-model.trim="editForm.custom_cu" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cu }]" :placeholder="settings.custom_cu || 'gd-cu-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cu" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cu }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel('custom_cm') }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_cm" autocomplete="off" v-model.trim="editForm.custom_cm" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_cm }]" :placeholder="settings.custom_cm || 'gd-cm-dualstack.ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_cm" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_cm }}</p>
        </div>
        <div class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel('custom_bd') }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" name="edit_custom_bd" autocomplete="off" v-model.trim="editForm.custom_bd" :class="['form-input', { 'input-invalid': pingNodeErrors.custom_bd }]" :placeholder="settings.custom_bd || 'ip.zstaticcdn.com'">
          <p v-if="pingNodeErrors.custom_bd" class="text-red text-sm mt-1">{{ pingNodeErrors.custom_bd }}</p>
        </div>
      </div>
      <div class="form-row">
        <div v-for="field in ['node_1', 'node_2']" :key="field" class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel(field) }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" :name="`edit_${field}`" autocomplete="off" v-model.trim="editForm[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" :placeholder="settings[field] || 'host[:port] / [IPv6]:port'">
          <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
        </div>
      </div>
      <div class="form-row">
        <div v-for="field in ['node_3', 'node_4']" :key="field" class="form-group flex-1">
          <label class="form-label">
            {{ pingNodeLabel(field) }}
            <HelpTooltip :text="trans.pingNodeTip" />
          </label>
          <input type="text" :name="`edit_${field}`" autocomplete="off" v-model.trim="editForm[field]" :class="['form-input', { 'input-invalid': pingNodeErrors[field] }]" :placeholder="settings[field] || 'host[:port] / [IPv6]:port'">
          <p v-if="pingNodeErrors[field]" class="text-red text-sm mt-1">{{ pingNodeErrors[field] }}</p>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group flex-1">
          <div class="checkbox-item no-margin">
            <input id="edit_auto_renewal" type="checkbox" v-model="editForm.auto_renewal">
            <label for="edit_auto_renewal">
              <b>{{ trans.autoRenewal }}</b>
            </label>
          </div>
        </div>

        <div class="form-group">
          <div class="checkbox-item no-margin">
            <input id="edit_auto_update" type="checkbox" :checked="editForm.auto_update" @change="handleAutoUpdateChange">
            <label for="edit_auto_update">
              <b>{{ trans.autoUpdate }}</b>
            </label>
          </div>
        </div>

        <div class="form-group">
          <div class="checkbox-item no-margin">
            <input id="edit_is_hidden" type="checkbox" v-model="editForm.is_hidden">
            <label for="edit_is_hidden">
              <b>{{ trans.hideFromPublic }}</b>
            </label>
          </div>
        </div>

        <div v-if="hasNodeNotificationOptions" class="form-group">
          <div class="checkbox-item no-margin">
            <input id="edit_offline_notify_disabled" type="checkbox" v-model="editForm.offline_notify_disabled">
            <label for="edit_offline_notify_disabled">
              <b>{{ trans.disableOfflineNotify }}</b>
            </label>
          </div>
        </div>
      </div>
      <div class="modal-footer flex-justify-between">
        <button type="button" @click="$emit('save')" class="btn btn-primary" :disabled="saving || hasValidationErrors">{{ saving ? trans.saving : trans.save }}</button>
        <button type="button" @click="$emit('close')" class="btn" :disabled="saving">{{ trans.cancel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch } from 'vue'
import HelpTooltip from '../../../components/HelpTooltip.vue'
import { useModal } from '../../../composables/useModal.js'
import { PING_NODE_FIELDS, validatePingNode } from '../../../utils/pingNode.js'
import { currentLang } from '../../../utils/i18n.js'
import {
  BILLING_CYCLES,
  CURRENCY_OPTIONS,
  getLocalizedOptionField,
  getLocalizedPingNodeLabel,
  renewExpireDateIfNeeded,
  validateNetworkInterfaceInput,
  validatePriceInput,
  validateServerNameInput,
  validateTrafficAlertPercentInput,
  validateTrafficCorrectionInput,
  validateTrafficLimitInput
} from '../../../utils/server.js'

const editForm = defineModel('editForm', { type: Object, required: true })

const props = defineProps({
  trans: { type: Object, required: true },
  show: { type: Boolean, default: false },
  currentServerName: { type: String, default: '' },
  settings: { type: Object, required: true },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['save', 'close', 'toggle-auto-update'])

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
    validatePingNode(editForm.value[field]).valid ? '' : pingNodeErrorMessage.value
  ])
))

const fieldErrors = computed(() => ({
  name: validateServerNameInput(editForm.value.name).valid ? '' : (props.trans.invalidServerName || 'Invalid server name'),
  price: validatePriceInput(editForm.value.price).valid ? '' : (props.trans.invalidPrice || 'Invalid price'),
  traffic_limit: validateTrafficLimitInput(editForm.value.traffic_limit).valid ? '' : (props.trans.invalidTrafficLimit || 'Invalid traffic limit'),
  traffic_alert_percent: validateTrafficAlertPercentInput(editForm.value.traffic_alert_percent).valid ? '' : (props.trans.invalidTrafficAlertPercent || 'Invalid threshold'),
  interface: validateNetworkInterfaceInput(editForm.value.interface).valid ? '' : (props.trans.invalidNetworkInterface || 'Invalid network interface'),
  rx_correction: validateTrafficCorrectionInput(editForm.value.rx_correction).valid ? '' : (props.trans.invalidTrafficCorrection || 'Invalid traffic correction'),
  tx_correction: validateTrafficCorrectionInput(editForm.value.tx_correction).valid ? '' : (props.trans.invalidTrafficCorrection || 'Invalid traffic correction')
}))

const hasPingNodeErrors = computed(() => Object.values(pingNodeErrors.value).some(Boolean))
const hasValidationErrors = computed(() => (
  hasPingNodeErrors.value || Object.values(fieldErrors.value).some(Boolean)
))

const billingCycleOptions = BILLING_CYCLES
const currencyOptions = CURRENCY_OPTIONS
const currencySelectOptions = computed(() => {
  const currentCurrency = String(editForm.value.currency || '').trim()
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

const normalizeTgNotifySetting = (value) => {
  if (value === true || value === 'true') return '5'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const minutes = Number(value)
  if (Number.isInteger(minutes) && (minutes === 0 || (minutes >= 2 && minutes <= 30))) {
    return String(minutes)
  }

  return '0'
}

const isOfflineNotifyEnabled = computed(() => normalizeTgNotifySetting(props.settings.tg_notify) !== '0')
const hasNotificationTarget = computed(() => {
  if (props.settings.notification_webhook_enabled) {
    return Boolean(String(props.settings.notification_webhook_url || '').trim())
  }
  return Boolean(String(props.settings.tg_bot_token || '').trim())
})
const hasNodeNotificationOptions = computed(() => (
  isOfflineNotifyEnabled.value && hasNotificationTarget.value
))
const isWssReportEnabled = computed(() => props.settings.wss_report_enabled === true)

const normalizePriceInput = () => {
  const check = validatePriceInput(editForm.value.price)
  if (check.valid) {
    editForm.value.price = check.value
  }
}

const openDatePicker = (event) => {
  const input = event?.currentTarget
  if (typeof input?.showPicker !== 'function') return
  try {
    input.showPicker()
  } catch (_) {}
}

watch(
  () => [editForm.value.auto_renewal, editForm.value.billing_cycle, editForm.value.expire_date],
  () => {
    if (!editForm.value.auto_renewal) return
    const renewal = renewExpireDateIfNeeded(
      editForm.value.expire_date,
      editForm.value.billing_cycle,
      editForm.value.auto_renewal
    )
    if (renewal.renewed) {
      editForm.value.expire_date = renewal.expire_date
    }
  }
)

watch(
  isWssReportEnabled,
  (enabled) => {
    if (!enabled) {
      editForm.value.connection_mode = 'http'
    }
  },
  { immediate: true }
)

const handleAutoUpdateChange = (event) => {
  const nextValue = event.target.checked
  if (nextValue) {
    event.target.checked = false
  }
  emit('toggle-auto-update', nextValue)
}
</script>
