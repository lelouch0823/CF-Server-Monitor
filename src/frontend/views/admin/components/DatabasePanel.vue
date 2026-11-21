<template>
  <div id="tab-database" class="tab-content" :class="{ active: activeTab === 'database' }">
    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.dbManagement }}</div>

      <div class="settings-grid">
        <div class="form-group">
          <label class="form-label">{{ trans.upgradeDatabase }}</label>
          <p class="text-muted mb-2">{{ trans.upgradeDesc }}</p>
          <button type="button" @click="$emit('open-db-modal', 'upgrade')" class="btn btn-primary btn-lg" :disabled="dbLoading">⬆️ {{ trans.upgradeDatabase }}</button>
        </div>

        <div class="form-group">
          <label class="form-label danger-label">⚠️ {{ trans.clearHistory }}</label>
          <p class="text-muted mb-2">{{ trans.clearHistoryDesc }}</p>
          <button type="button" @click="$emit('open-db-modal', 'clearHistory')" class="btn btn-red btn-lg" :disabled="dbLoading">🗑️ {{ trans.clearHistory }}</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.exportServers }} / {{ trans.importServers }}</div>

      <div class="settings-grid">
        <div class="form-group">
          <label class="form-label">{{ trans.exportServers }}</label>
          <p class="text-muted mb-2">{{ trans.exportServersDesc }}</p>
          <button type="button" @click="handleExport" class="btn btn-primary btn-lg" :disabled="dbLoading || exporting">
            {{ exporting ? trans.exporting : '📤 ' + trans.exportServers }}
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">{{ trans.importServers }}</label>
          <p class="text-muted mb-2">{{ trans.importServersDesc }}</p>
          <input
            ref="fileInput"
            type="file"
            accept=".json"
            style="display: none"
            @change="handleFileSelect"
          />
          <button type="button" @click="$refs.fileInput.click()" class="btn btn-lg" :disabled="dbLoading || importing">
            {{ importing ? trans.importing : '📥 ' + trans.importServers }}
          </button>
        </div>
      </div>

      <div v-if="importResult" class="mt-3">
        <div :class="importResult.success ? 'success-box' : 'danger-box'" class="mb-2">
          <div class="flex-center-gap-sm">
            <span :style="{ color: importResult.success ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: '600' }">
              {{ importResult.success ? '✅' : '❌' }} {{ trans.importResult }}
            </span>
          </div>
          <div v-if="importResult.error" class="mt-2 text-sm text-red">
            {{ importResult.error }}
          </div>
          <div class="mt-2 text-sm">
            <span style="color: var(--accent-green)">{{ trans.importedCount }}: {{ importResult.imported }}</span>
            <span class="ml-3" style="color: var(--accent-yellow)">{{ trans.skippedCount }}: {{ importResult.skipped }}</span>
          </div>
          <div v-if="importResult.skippedIds && importResult.skippedIds.length > 0" class="mt-2 text-sm text-muted">
            {{ trans.skippedIds }}: {{ importResult.skippedIds.join(', ') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { adminApi } from '../../../utils/api'

const props = defineProps({
  trans: { type: Object, required: true },
  activeTab: { type: String, default: 'database' },
  dbLoading: { type: Boolean, default: false },
  selectedApiIndex: { type: Number, default: 0 }
})

const emit = defineEmits(['open-db-modal', 'servers-imported', 'alert-message'])

const fileInput = ref(null)
const exporting = ref(false)
const importing = ref(false)
const importResult = ref(null)

const resolveErrorText = (rawError, fallback) => {
  if (typeof rawError === 'string' && rawError.trim()) {
    return props.trans[rawError] || rawError
  }
  return fallback
}

const handleExport = async () => {
  if (exporting.value) return
  exporting.value = true
  importResult.value = null
  try {
    const result = await adminApi({ action: 'export_servers' }, props.selectedApiIndex)
    if (!result.error && result.data && Array.isArray(result.data.servers)) {
      const blob = new Blob([JSON.stringify(result.data.servers, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `servers-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      emit('alert-message', resolveErrorText(result.error, props.trans.serversExportFailed))
    }
  } catch (e) {
    console.error('Export failed:', e)
    emit('alert-message', `${props.trans.serversExportFailed}: ${e.message || props.trans.operationFailed}`)
  } finally {
    exporting.value = false
  }
}

const handleFileSelect = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  importing.value = true
  importResult.value = null

  try {
    const text = await file.text()
    let servers
    try {
      servers = JSON.parse(text)
    } catch (parseErr) {
      importResult.value = {
        success: false,
        imported: 0,
        skipped: 0,
        skippedIds: [],
        error: `${props.trans.invalidJsonFormat}: ${parseErr.message}`
      }
      return
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      importResult.value = {
        success: false,
        imported: 0,
        skipped: 0,
        skippedIds: [],
        error: props.trans.noServersToImport
      }
      return
    }

    const result = await adminApi({ action: 'import_servers', servers }, props.selectedApiIndex)
    if (!result.error && result.data) {
      importResult.value = {
        success: result.data.success !== false,
        imported: result.data.imported || 0,
        skipped: result.data.skipped || 0,
        skippedIds: result.data.skippedIds || [],
        error: result.data.error ? resolveErrorText(result.data.error, props.trans.operationFailed) : ''
      }
      if ((result.data.imported || 0) > 0) {
        emit('servers-imported')
      }
    } else {
      importResult.value = {
        success: false,
        imported: 0,
        skipped: 0,
        skippedIds: [],
        error: resolveErrorText(result.error, props.trans.operationFailed)
      }
    }
  } catch (e) {
    console.error('Import failed:', e)
    importResult.value = {
      success: false,
      imported: 0,
      skipped: 0,
      skippedIds: [],
      error: e.message || props.trans.operationFailed
    }
  } finally {
    importing.value = false
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  }
}
</script>
