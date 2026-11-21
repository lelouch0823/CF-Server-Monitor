<template>
  <div>
    <AdminLogin
      v-if="!isLoggedIn"
      :trans="trans"
      :is-multiple-mode="isMultipleMode"
      :api-bases="apiBases"
      :selected-api-index="selectedApiIndex"
      :login-form="loginForm"
      :password-visible="passwordVisible"
      :login-error="loginError"
      :login-loading="loginLoading"
      :turnstile-site-key="turnstileSiteKey"
      :turnstile-login-enabled="turnstileLoginEnabled"
      :turnstile-enabled="turnstileEnabled"
      :turnstile-verified="turnstileVerified"
      @login="handleLogin"
      @toggle-password="togglePassword"
      @api-index-change="handleApiIndexChange"
    />

    <div v-else class="container admin-container" id="admin-content">
      <TerminalHeader :title="trans.adminPanel" />
      <div v-if="adminSiteLoading" class="admin-loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">$ {{ trans.switchingSite }}</div>
        </div>
      </div>

      <div class="main-panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="prompt">$</span> {{ trans.sudoStatus }}
          </div>
          <div class="header-actions">
            <button type="button" @click="refreshServers" class="btn" :disabled="adminSiteLoading || refreshingServers">{{ refreshingServers ? '⏳' : '↻' }} {{ trans.refresh }}</button>
            <select
              v-if="isMultipleMode"
              v-model.number="selectedApiIndex"
              class="form-select admin-site-select"
              :disabled="adminSiteLoading"
              @change="handleAdminApiIndexChange"
            >
              <option
                v-for="(base, index) in apiBases"
                :key="index"
                :value="index"
              >
                [{{ index }}] {{ base }}
              </option>
            </select>
            <HelpTooltip v-if="isMultipleMode" :text="trans.apiEndpoint" />
            <button @click="logout" class="btn btn-red">🚪 {{ trans.logout }}</button>
          </div>
        </div>

        <div class="stats-grid" id="stats-panel">
          <div class="stat-card">
            <div class="stat-main-value" id="stat-total">{{ stats.total }}</div>
            <div class="stat-label">{{ trans.totalServers }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-online">{{ stats.online }}</div>
            <div class="stat-label">{{ trans.online }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-offline">{{ stats.offline }}</div>
            <div class="stat-label">{{ trans.offline }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-main-value" id="stat-avg-cpu">{{ stats.avg_cpu }}%</div>
            <div class="stat-label">{{ trans.avgCpu }}</div>
          </div>
        </div>
      </div>

      <div class="main-panel">
        <div class="tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'servers' }"
            @click="activeTab = 'servers'"
          >{{ trans.servers }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'settings' }"
            @click="activeTab = 'settings'"
          >{{ trans.settings }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'database' }"
            @click="activeTab = 'database'"
          >{{ trans.dbManagement }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'themeStore' }"
            @click="activeTab = 'themeStore'"
          >{{ trans.themeStore }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'donation' }"
            @click="activeTab = 'donation'"
          >{{ trans.donation }}</button>
        </div>

        <ServerTable
          v-model:new-server-name="newServerName"
          v-model:new-server-group="newServerGroup"
          :trans="trans"
          :servers="servers"
          :selected-servers="selectedServers"
          :groups="groups"
          :active-tab="activeTab"
          :selected-api-index="selectedApiIndex"
          :latest-agent-version="latestAgentVersion"
          :cache-refreshing="cacheRefreshing"
          :adding-server="addingServer"
          :deleting-server="deletingServer"
          :copied-server-id="copiedServerId"
          :copied-note-server-id="copiedNoteServerId"
          :copied-spec-key="copiedSpecKey"
          @add-server="addServer"
          @auto-discovery-cmd="openAutoDiscoveryModal"
          @batch-edit="openBatchEditModal"
          @batch-delete="batchDelete"
          @toggle-select-all="toggleSelectAll"
          @refresh-cache="refreshServersCache"
          @select-all="handleSelectAll"
          @drag-start="handleDragStart"
          @drop="handleDrop"
          @toggle-server="toggleServer"
          @copy-note="copyServerNote"
          @copy-spec="copyServerSpec"
          @copy-cmd="copyCmd"
          @edit="openEditModal"
          @delete="openDeleteModal"
        />

        <SettingsPanel
          ref="settingsPanelRef"
          :trans="trans"
          :settings="settings"
          :servers="servers"
          :password-visible="passwordVisible"
          :active-tab="activeTab"
          :selected-api-base="selectedApiBase"
          :current-origin="currentOrigin"
          :saving="saving"
          :change-admin-password="changeAdminPassword"
          :test-notification-loading="testNotificationLoading"
          :d1-usage-loading="d1UsageLoading"
          @toggle-password="togglePassword"
          @toggle-admin-password-change="toggleAdminPasswordChange"
          @save-settings="saveSettings"
          @upload-bg="uploadBg"
          @upload-bg-mobile="uploadBgMobile"
          @upload-favicon="uploadFavicon"
          @send-test-notification="sendTestNotification"
          @query-d1-usage="queryD1Usage"
          @alert-message="alertMessage = $event"
        />

        <DatabasePanel
          :trans="trans"
          :active-tab="activeTab"
          :db-loading="dbLoading"
          :selected-api-index="selectedApiIndex"
          @open-db-modal="openDbModal"
          @servers-imported="loadServers"
          @alert-message="alertMessage = $event"
        />

        <ThemeStorePanel
          :trans="trans"
          :active-tab="activeTab"
          :selected-api-index="selectedApiIndex"
          :current-theme-url="settings.theme_url"
          :settings="settings"
          @theme-applied="settings.theme_url = $event"
          @theme-options-applied="handleThemeOptionsApplied"
          @alert-message="alertMessage = $event"
        />

        <DonationPanel
          :trans="trans"
          :active-tab="activeTab"
        />
      </div>

      <EditServerModal
        :trans="trans"
        :show="showEditModal"
        v-model:edit-form="editForm"
        :current-server-name="currentServerName"
        :settings="settings"
        :saving="editSaving"
        @save="saveEdit"
        @close="closeEditModal"
        @toggle-auto-update="handleAutoUpdateToggle"
      />

      <BatchEditServersModal
        v-model:form="batchEditForm"
        v-model:enabled="batchEditEnabled"
        :trans="trans"
        :show="showBatchEditModal"
        :selected-count="selectedServers.length"
        :settings="settings"
        :is-wss-report-enabled="isWssReportEnabled"
        :saving="batchEditing"
        @save="saveBatchEdit"
        @close="closeBatchEditModal"
      />

      <div v-if="showAutoUpdateWarning" id="autoUpdateWarningModal" class="modal-overlay auto-update-warning-modal active" role="dialog" aria-modal="true" :aria-label="trans.autoUpdateRiskTitle">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">{{ trans.autoUpdateRiskTitle }}</div>
            <button type="button" class="modal-close" @click="cancelAutoUpdateWarning">✕</button>
          </div>

          <div class="danger-box mb-4">
            <div class="flex-center-gap-sm mb-2">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ trans.autoUpdateRiskTitle }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.autoUpdateRiskDesc }}
            </p>
          </div>

          <div class="modal-footer flex-justify-between">
            <button type="button" @click="confirmAutoUpdateWarning" class="btn btn-primary">{{ trans.autoUpdateRiskConfirm }}</button>
            <button type="button" @click="cancelAutoUpdateWarning" class="btn">{{ trans.autoUpdateRiskCancel }}</button>
          </div>
        </div>
      </div>

      <div v-if="showBatchDeleteConfirm" id="batchDeleteConfirmModal" class="modal-overlay confirm-modal-overlay active" role="dialog" aria-modal="true" :aria-label="trans.batchDelete">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ {{ trans.batchDelete }} [{{ selectedServers.length }}]</div>
            <button type="button" class="modal-close" :disabled="deletingServer" @click="cancelBatchDeleteConfirm">✕</button>
          </div>

          <div class="danger-box mb-4">
            <div class="flex-center-gap-sm mb-2">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ trans.dangerWarning }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.confirmDeleteServers }}{{ selectedServers.length }}{{ trans.irreversible }}
            </p>
          </div>

          <div class="modal-footer flex-justify-between">
            <button type="button" @click="executeBatchDelete" class="btn btn-red" :disabled="deletingServer">{{ deletingServer ? trans.deleting : trans.confirmDelete }}</button>
            <button type="button" @click="cancelBatchDeleteConfirm" class="btn" :disabled="deletingServer">{{ trans.cancel }}</button>
          </div>
        </div>
      </div>

      <DeleteServerModal
        :trans="trans"
        :show="showDeleteModal"
        :delete-server-id="deleteServerId"
        :current-server-name="currentServerName"
        :delete-target-os="deleteTargetOs"
        :delete-version="deleteVersion"
        :delete-install-mode="deleteInstallMode"
        :delete-gh-proxy="deleteGhProxy"
        :uninstall-command="getUninstallCommand()"
        :uninstall-copied="uninstallCopied"
        :deleting="deletingServer"
        @close="closeDeleteModal"
        @confirm-delete="confirmDelete"
        @copy-uninstall="copyUninstallCmd"
        @update:delete-target-os="deleteTargetOs = $event"
        @update:delete-version="deleteVersion = $event"
        @update:delete-install-mode="deleteInstallMode = $event"
        @update:delete-gh-proxy="deleteGhProxy = $event"
      />

      <CopyCommandModal
        :trans="trans"
        :settings="settings"
        :show="showCopyModal"
        :current-server-name="currentServerName"
        :target-os="targetOs"
        :install-mode="installMode"
        :install-gh-proxy="installGhProxy"
        :install-version="installVersion"
        :collect-interval="collectInterval"
        :report-interval="reportInterval"
        :wss-report-interval="wssReportInterval"
        :connection-mode="connectionMode"
        :ping-mode="pingMode"
        :custom-ct="customCt"
        :custom-cu="customCu"
        :custom-cm="customCm"
        :custom-bd="customBd"
        :node-1="node1"
        :node-2="node2"
        :node-3="node3"
        :node-4="node4"
        :network-interface="networkInterface"
        :reset-day="resetDay"
        :rx-correction="rxCorrection"
        :tx-correction="txCorrection"
        :auto-update="autoUpdate"
        :install-command="getCustomInstallCommand()"
        :copied-cmd="copiedCmd"
        @close="closeCopyModal"
        @copy-cmd="copyCustomCmd"
        @update:target-os="targetOs = $event"
        @update:install-mode="installMode = $event"
        @update:install-gh-proxy="installGhProxy = $event"
        @update:install-version="installVersion = $event"
        @open-edit-from-copy="openEditModalFromCopy"
      />

      <AutoDiscoveryCommandModal
        :trans="trans"
        :show="showAutoDiscoveryModal"
        :target-os="autoDiscoveryTargetOs"
        :install-mode="autoDiscoveryInstallMode"
        :name="autoDiscoveryName"
        :version="autoDiscoveryVersion"
        :auto-update="autoDiscoveryAutoUpdate"
        :gh-proxy="autoDiscoveryGhProxy"
        :install-command="getAutoDiscoveryInstallCommand()"
        :copied="autoDiscoveryCopied"
        @close="closeAutoDiscoveryModal"
        @copy-cmd="copyAutoDiscoveryCmd"
        @update:target-os="autoDiscoveryTargetOs = $event"
        @update:install-mode="autoDiscoveryInstallMode = $event"
        @update:name="autoDiscoveryName = $event"
        @update:version="autoDiscoveryVersion = $event"
        @update:auto-update="autoDiscoveryAutoUpdate = $event"
        @update:gh-proxy="autoDiscoveryGhProxy = $event"
      />

      <div id="dbModal" class="modal-overlay" :class="{ active: showDbModal }" role="dialog" aria-modal="true" :aria-label="dbOperation === 'clearHistory' ? trans.clearHistory : trans.upgradeDatabase">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ {{ dbOperation === 'clearHistory' ? 'CLEAR HISTORY' : 'ALTER DATABASE' }}</div>
            <button type="button" class="modal-close" @click="closeDbModal" :disabled="dbLoading">✕</button>
          </div>

          <div v-if="dbOperation === 'clearHistory'" class="mb-4">
            <div class="flex-center-gap-sm mb-3">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ trans.dangerOperation }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.clearHistoryWarning }}
            </p>
          </div>

          <div v-if="dbOperation === 'upgrade'" class="mb-4">
            <div class="flex-center-gap-sm mb-3">
              <span class="warning-icon text-xl">ℹ️</span>
              <span style="color: var(--accent-yellow); font-weight: 600;">{{ trans.upgradeDatabase }}</span>
            </div>
            <p class="text-secondary text-sm line-height-1-6">
              {{ trans.upgradeDesc }}
            </p>
          </div>

          <div v-if="dbResult" :class="dbResult.success ? 'success-box' : 'danger-box'" class="mb-4">
            <div class="flex-center-gap-sm">
              <span :style="{ color: dbResult.success ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: '600' }">
                {{ dbResult.success ? '✅' : '❌' }} {{ getMessage(dbResult.message) || (dbResult.success ? trans.operationSuccess : trans.operationFailed) }}
              </span>
            </div>
            <div v-if="dbResult.error" class="text-red mt-2">
              {{ getMessage(dbResult.error) }}
            </div>
          </div>

          <div v-if="!(dbResult && dbResult.success)" class="modal-footer flex-justify-between">
            <button
              v-if="!dbResult"
              type="button"
              @click="dbOperation === 'clearHistory' ? handleClearHistory() : handleUpgradeDatabase()"
              class="btn btn-red"
              :disabled="dbLoading"
            >
              {{ dbLoading ? (dbOperation === 'clearHistory' ? trans.clearing : trans.upgrading) : (dbOperation === 'clearHistory' ? trans.confirmClear : trans.upgradeDatabase) }}
            </button>
            <button type="button" @click="closeDbModal" class="btn" :disabled="dbLoading">{{ trans.cancel }}</button>
          </div>
        </div>
      </div>

      <div v-if="d1UsageResult" id="d1UsageModal" class="modal-overlay active" role="dialog" aria-modal="true" :aria-label="trans.queryD1Quota">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ D1, Workers & Durable Objects quota --utc</div>
            <button type="button" class="modal-close" @click="d1UsageResult = null">✕</button>
          </div>

          <div v-if="d1UsageResult.success" class="mb-4">
            <div class="success-box mb-4">
              {{ getMessage(d1UsageResult.message) || trans.d1UsageQueried }}
            </div>
            <div class="quota-section">
              <div class="quota-section-title">{{ trans.todayUsage }}</div>
              <div class="quota-progress-list">
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsRead }}: {{ formatNumber(d1UsageResult.usage.today.rowsRead) }} / {{ formatNumber(5000000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.rowsRead, 5000000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.today.rowsRead, 5000000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsWritten }}: {{ formatNumber(d1UsageResult.usage.today.rowsWritten) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.rowsWritten, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.today.rowsWritten, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.workersRequests }}: {{ formatNumber(d1UsageResult.usage.today.workersRequests) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.workersRequests, 100000) }}%</span>
                  </div>
                  <div v-if="d1UsageResult.usage.today.workersRequests" class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.today.workersRequests, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span class="quota-label-with-help">
                      <span>{{ trans.durableObjectsRequests }}: {{ formatNumber(d1UsageResult.usage.today.durableObjectsRequests) }} / {{ formatNumber(100000) }}</span>
                      <HelpTooltip>
                        <template #default>
                          <span v-for="row in getDurableObjectsUsageRows(d1UsageResult.usage.today)" :key="row.key" class="quota-help-row">
                            <span class="quota-help-label">{{ row.label }}</span>
                            <span class="quota-help-value">{{ row.value }}</span>
                          </span>
                        </template>
                      </HelpTooltip>
                    </span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.durableObjectsRequests, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.today.durableObjectsRequests, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span class="quota-label-with-help">
                      <span>{{ trans.durableObjectsDuration }}: {{ formatNumber(d1UsageResult.usage.today.durableObjectsDuration, 2) }} / {{ formatNumber(13000) }}</span>
                      <HelpTooltip :text="trans.durableObjectsDurationTip">
                        <template #default>
                          <span class="quota-help-row">{{ trans.durableObjectsDurationTip }}</span>
                        </template>
                      </HelpTooltip>
                    </span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.today.durableObjectsDuration, 13000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.today.durableObjectsDuration, 13000) + '%' }"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="quota-section mt-4">
              <div class="quota-section-title">{{ trans.yesterdayUsage }}</div>
              <div class="quota-progress-list">
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsRead }}: {{ formatNumber(d1UsageResult.usage.yesterday.rowsRead) }} / {{ formatNumber(5000000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.yesterday.rowsRead, 5000000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.yesterday.rowsRead, 5000000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.d1RowsWritten }}: {{ formatNumber(d1UsageResult.usage.yesterday.rowsWritten) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.yesterday.rowsWritten, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.yesterday.rowsWritten, 100000) + '%' }"></div>
                  </div>
                </div>
                <div v-if="d1UsageResult.usage.yesterday.workersRequests" class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span>{{ trans.workersRequests }}: {{ formatNumber(d1UsageResult.usage.yesterday.workersRequests) }} / {{ formatNumber(100000) }}</span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.yesterday.workersRequests, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.yesterday.workersRequests, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span class="quota-label-with-help">
                      <span>{{ trans.durableObjectsRequests }}: {{ formatNumber(d1UsageResult.usage.yesterday.durableObjectsRequests) }} / {{ formatNumber(100000) }}</span>
                      <HelpTooltip>
                        <template #default>
                          <span v-for="row in getDurableObjectsUsageRows(d1UsageResult.usage.yesterday)" :key="row.key" class="quota-help-row">
                            <span class="quota-help-label">{{ row.label }}</span>
                            <span class="quota-help-value">{{ row.value }}</span>
                          </span>
                        </template>
                      </HelpTooltip>
                    </span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.yesterday.durableObjectsRequests, 100000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.yesterday.durableObjectsRequests, 100000) + '%' }"></div>
                  </div>
                </div>
                <div class="quota-progress-item">
                  <div class="flex-justify-between text-sm mb-1">
                    <span class="quota-label-with-help">
                      <span>{{ trans.durableObjectsDuration }}: {{ formatNumber(d1UsageResult.usage.yesterday.durableObjectsDuration, 2) }} / {{ formatNumber(13000) }}</span>
                      <HelpTooltip :text="trans.durableObjectsDurationTip">
                        <template #default>
                          <span class="quota-help-row">{{ trans.durableObjectsDurationTip }}</span>
                        </template>
                      </HelpTooltip>
                    </span>
                    <span>{{ getUsagePercent(d1UsageResult.usage.yesterday.durableObjectsDuration, 13000) }}%</span>
                  </div>
                  <div class="quota-progress-bar">
                    <div class="quota-progress-fill" :style="{ width: getUsageBarPercent(d1UsageResult.usage.yesterday.durableObjectsDuration, 13000) + '%' }"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="danger-box mb-4">
            {{ getMessage(d1UsageResult.error) }}
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button type="button" @click="d1UsageResult = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="validationError" id="validationErrorModal" class="modal-overlay modal-overlay-top active" role="dialog" aria-modal="true" :aria-label="trans.validationError">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ {{ trans.validationError }}</div>
            <button type="button" class="modal-close" @click="validationError = null">✕</button>
          </div>

          <div class="danger-box mb-4">
            <div class="flex-center-gap-sm">
              <span class="danger-icon text-xl">⚠️</span>
              <span class="danger-label">{{ validationError }}</span>
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button type="button" @click="validationError = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="saveResult" class="modal-overlay modal-overlay-top active" role="dialog" aria-modal="true" aria-label="save result">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ save --result</div>
            <button type="button" class="modal-close" @click="saveResult = null">✕</button>
          </div>

          <div v-if="saveResult.success" class="success-box mb-4">
            <div class="flex-center-gap-sm">
              <span style="color: var(--accent-green); font-weight: 600;">
                ✅ {{ saveResult.message || trans.saveSuccess }}
              </span>
            </div>
          </div>

          <div v-else class="danger-box mb-4">
            <div class="flex-center-gap-sm">
              <span class="danger-label">❌ {{ saveResult.error }}</span>
            </div>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button type="button" @click="saveResult = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <div v-if="alertMessage" class="modal-overlay modal-overlay-top active" role="dialog" aria-modal="true" aria-label="alert">
        <div class="modal-dialog">
          <div class="modal-header">
            <div class="modal-title">$ alert</div>
            <button type="button" class="modal-close" @click="alertMessage = null">✕</button>
          </div>

          <div class="mb-4">
            <p class="text-secondary text-sm">{{ alertMessage }}</p>
          </div>

          <div class="modal-footer flex-justify-between">
            <div></div>
            <button type="button" @click="alertMessage = null" class="btn">{{ trans.close }}</button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TerminalHeader from '../../components/TerminalHeader.vue'
import Footer from '../../components/Footer.vue'
import HelpTooltip from '../../components/HelpTooltip.vue'
import AdminLogin from './components/AdminLogin.vue'
import ServerTable from './components/ServerTable.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import DatabasePanel from './components/DatabasePanel.vue'
import ThemeStorePanel from './components/ThemeStorePanel.vue'
import DonationPanel from './components/DonationPanel.vue'
import EditServerModal from './components/EditServerModal.vue'
import BatchEditServersModal from './components/BatchEditServersModal.vue'
import DeleteServerModal from './components/DeleteServerModal.vue'
import CopyCommandModal from './components/CopyCommandModal.vue'
import AutoDiscoveryCommandModal from './components/AutoDiscoveryCommandModal.vue'
import { adminApi, login, logout as apiLogout, upgradeDatabase, clearHistory, fetchConfig } from '../../utils/api'
import { hasMultipleApiBases, getApiBases } from '../../utils/config.js'
import { copyTextToClipboard } from '../../utils/clipboard.js'
import { normalizeLanguagePreference, normalizeNotificationLanguagePreference, t, useTranslation } from '../../utils/i18n'
import { PING_NODE_FIELDS, validatePingNode } from '../../utils/pingNode.js'
import { normalizeDisplayMode, resolveDisplayMode } from '../../utils/displayMode.js'
import { applyMikusThemeOptions } from '../../utils/themeOptions.js'
import { FRONTEND_WS_TIMEOUT_MINUTES_MAX, HISTORY, STORAGE } from '../../utils/constants.js'
import { safeLocalStorage } from '../../utils/storage.js'
import { useModal } from '../../composables/useModal.js'
import { usePasswordVisibility } from '../../composables/usePasswordVisibility'
import { useTurnstile } from './composables/useTurnstile'
import {
  detectBillingCycle,
  detectCurrencySymbol,
  getLocalizedPingNodeLabel,
  normalizeBillingCycle,
  normalizeCurrency,
  normalizePrice,
  renewExpireDateIfNeeded,
  resolveCustomPingNodeName,
  resolveSafeLoginRedirect,
  validateNetworkInterfaceInput,
  validatePriceInput,
  validateResourceAlertThresholdInput,
  validateServerNameInput,
  validateTrafficAlertPercentInput,
  validateTrafficCorrectionInput,
  validateTrafficLimitInput
} from '../../utils/server.js'

const trans = useTranslation()
const route = useRoute()
const router = useRouter()
const appConfig = inject('appConfig', {})
let startupConfigConsumed = false
const AGENT_RELEASE_URL = 'https://api.github.com/repos/huilang-me/cfsm-agent/releases/latest'
const AGENT_RELEASE_FAILURE_TTL = 30 * 1000

let cachedAgentReleaseVersion = ''
let cachedAgentReleaseFailureAt = 0
let agentReleasePromise = null

const normalizeVersion = (version) => String(version || '').trim()

const fetchLatestAgentReleaseVersion = async () => {
  if (cachedAgentReleaseVersion) return cachedAgentReleaseVersion
  if (cachedAgentReleaseFailureAt && Date.now() - cachedAgentReleaseFailureAt < AGENT_RELEASE_FAILURE_TTL) return ''
  if (agentReleasePromise) return agentReleasePromise

  agentReleasePromise = fetch(AGENT_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' }
  }).then(async (res) => {
    if (!res.ok) throw new Error(`GitHub release request failed: ${res.status}`)
    const release = await res.json()
    const version = normalizeVersion(release?.tag_name)
    if (version) {
      cachedAgentReleaseVersion = version
      cachedAgentReleaseFailureAt = 0
    } else {
      cachedAgentReleaseFailureAt = Date.now()
    }
    return version
  }).catch((e) => {
    cachedAgentReleaseFailureAt = Date.now()
    console.error('[ERROR] Load latest agent release failed:', e)
    return ''
  }).finally(() => {
    agentReleasePromise = null
  })

  return agentReleasePromise
}

const getMessage = (msg) => {
  if (typeof msg === 'string') {
    const translated = t(msg)
    return translated !== msg ? translated : msg
  }
  return ''
}

const normalizeTgNotifySetting = (value) => {
  if (value === true || value === 'true') return '5'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const minutes = Number(value)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 30) return '0'
  if (minutes === 0) return '0'
  // 最小 5 分钟：低于 5 的历史值（如 2、3、4）统一提升到 5
  return String(Math.max(minutes, 5))
}

const isTgNotifyEnabled = (value) => normalizeTgNotifySetting(value) !== '0'

const EXPIRE_REMINDER_DAYS_MAX = 365
const normalizeExpireReminderSetting = (value) => {
  if (value === true || value === 'true') return '7'
  if (value === false || value === 'false' || value === undefined || value === null || value === '') return '0'

  const days = Number(value)
  if (Number.isInteger(days) && days >= 0 && days <= EXPIRE_REMINDER_DAYS_MAX) {
    return String(days)
  }

  return '0'
}

const isExpireReminderEnabled = (value) => normalizeExpireReminderSetting(value) !== '0'

const isValidNotificationTimezone = (value) => {
  const timezone = String(value || '').trim()
  if (!timezone || timezone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0))
    return true
  } catch (_) {
    return false
  }
}

const normalizeNotificationTimezoneSetting = (value) => {
  const timezone = String(value || '').trim()
  return isValidNotificationTimezone(timezone) ? timezone : 'UTC'
}

const normalizeExpireNotificationTimeSetting = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return '12'
  const legacyTimeMatch = raw.match(/^([01]?\d|2[0-3]):[0-5]\d$/)
  const hour = Number(legacyTimeMatch ? legacyTimeMatch[1] : raw)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? String(hour) : '12'
}

const normalizeLongHistoryPointsSetting = (value) => {
  const points = Number(value)
  return String(
    HISTORY.LONG_RANGE_POINT_OPTIONS.includes(points)
      ? points
      : HISTORY.DEFAULT_LONG_RANGE_POINTS
  )
}

const normalizeFrontendWsTimeoutMinutesSetting = (value) => {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= FRONTEND_WS_TIMEOUT_MINUTES_MAX
    ? minutes
    : 0
}

const normalizeWssReportHoursSetting = (value) => {
  if (value === undefined || value === null || value === '') {
    return Array.from({ length: 24 }, (_, hour) => hour)
  }

  let source = value
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch (_) {
      source = source.split(',').map(item => item.trim()).filter(Boolean)
    }
  }
  if (!Array.isArray(source)) return Array.from({ length: 24 }, (_, hour) => hour)

  return Array.from(new Set(source
    .map(hour => {
      if (typeof hour === 'number') return hour
      if (typeof hour === 'string' && /^\d{1,2}$/.test(hour.trim())) return Number(hour)
      return NaN
    })
    .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)))
    .sort((a, b) => a - b)
}

const normalizeResourceAlertModeSetting = (value) => {
  const mode = String(value || '').trim().toLowerCase()
  return mode === 'continuous' ? 'continuous' : 'average'
}

const normalizeResourceAlertIntervalSetting = (value) => {
  const minutes = Number(value)
  if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 10) {
    return String(minutes)
  }
  return '5'
}

const normalizeResourceAlertMetricSetting = (value) => {
  const metric = String(value || '').trim()
  return ['cpu', 'ram', 'disk', 'netIn', 'netOut'].includes(metric) ? metric : 'cpu'
}

const defaultResourceAlertThreshold = (metric) => (
  metric === 'netIn' || metric === 'netOut' ? '100' : '80'
)

const normalizeResourceAlertThresholdSetting = (value, metric) => {
  if (value === undefined || value === null || value === '') return defaultResourceAlertThreshold(metric)
  const number = Number(value)
  const max = metric === 'netIn' || metric === 'netOut' ? 100000 : 100
  if (!Number.isFinite(number) || number <= 0 || number > max) return defaultResourceAlertThreshold(metric)
  return String(Math.round(number * 100) / 100)
}

const normalizeResourceAlertServersSetting = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.map(item => String(item || '').trim()).filter(id => {
    if (!id || id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const normalizeResourceAlertRulesSetting = (value) => {
  let rules = Array.isArray(value) ? value : []
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      rules = Array.isArray(parsed) ? parsed : []
    } catch (_) {
      rules = []
    }
  }
  return rules.map((rule, index) => {
    const metric = normalizeResourceAlertMetricSetting(rule?.metric)
    return {
      id: String(rule?.id || `rule_${index + 1}`).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64) || `rule_${index + 1}`,
      name: String(rule?.name || '').trim().slice(0, 80) || `Resource Alert ${index + 1}`,
      metric,
      threshold: normalizeResourceAlertThresholdSetting(rule?.threshold, metric),
      servers: normalizeResourceAlertServersSetting(rule?.servers || rule?.serverIds),
      intervalMinutes: normalizeResourceAlertIntervalSetting(rule?.intervalMinutes || rule?.windowMinutes),
      mode: normalizeResourceAlertModeSetting(rule?.mode)
    }
  }).slice(0, 20)
}

const isResourceAlertEnabled = (rules) => normalizeResourceAlertRulesSetting(rules).length > 0

const isNotificationWebhookEnabled = () => settings.value.notification_webhook_enabled === true

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizePreferredThemeSetting = (value) => {
  const theme = String(value || '').trim().toLowerCase()
  return ['dark', 'light', 'auto'].includes(theme) ? theme : 'auto'
}

const normalizeDefaultLanguageSetting = (value) => normalizeLanguagePreference(value)

const normalizeNotificationLanguageSetting = (value) => normalizeNotificationLanguagePreference(value)

const formatThemeOptions = (value) => {
  const normalized = value === undefined || value === null ? {} : value
  try {
    return JSON.stringify(normalized, null, 2)
  } catch (_) {
    return '{}'
  }
}

const parseThemeOptions = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return { valid: true, value: {} }
  try {
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) {
      return { valid: false }
    }
    return { valid: true, value: parsed }
  } catch (_) {
    return { valid: false }
  }
}

const formatNumber = (value, maximumFractionDigits = 0) => (
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits })
)
const getDurableObjectsUsageRows = (usage = {}) => ([
  {
    key: 'http',
    label: trans.value.durableObjectsHttpRequests,
    value: `${formatNumber(usage.durableObjectsHttpRequests)} · ${trans.value.billingRatioOneToOne}`
  },
  {
    key: 'hibernation',
    label: trans.value.durableObjectsHibernationWakeups,
    value: `${formatNumber(usage.durableObjectsHibernationWakeups)} · ${trans.value.billingRatioOneToOne}`
  },
  {
    key: 'inbound-ws',
    label: trans.value.durableObjectsInboundWebSocketMessages,
    value: `${formatNumber(usage.durableObjectsInboundWebSocketMessages)} · ${trans.value.billingRatioWebSocketIncoming}`
  },
  {
    key: 'outbound-ws',
    label: trans.value.durableObjectsOutboundWebSocketMessages,
    value: `${formatNumber(usage.durableObjectsOutboundWebSocketMessages)} · ${trans.value.billingRatioNotBilled}`
  }
])
const getUsagePercent = (used, limit) => {
  if (!limit) return 0
  return Number(((Number(used || 0) / Number(limit)) * 100).toFixed(2))
}
const getUsageBarPercent = (used, limit) => {
  return Math.min(100, Math.max(0, getUsagePercent(used, limit)))
}

const isMultipleMode = computed(() => hasMultipleApiBases())
const apiBases = getApiBases()
const normalizeApiIndex = (value) => {
  const index = parseInt(value, 10)
  if (Number.isNaN(index) || index < 0 || index >= apiBases.length) return 0
  return index
}
const selectedApiIndex = ref(normalizeApiIndex(route.query.apiIndex))
const selectedApiBase = computed(() => apiBases[selectedApiIndex.value] || apiBases[0])
const currentOrigin = computed(() => window.location.origin)

const syncApiIndexQuery = () => {
  if (!isMultipleMode.value) return
  if (String(route.query.apiIndex ?? '') === String(selectedApiIndex.value)) return
  router.replace({
    path: '/admin',
    query: {
      ...route.query,
      apiIndex: String(selectedApiIndex.value)
    }
  })
}

const adminApiForSite = (data) => adminApi(data, selectedApiIndex.value)

const isLoggedIn = ref(false)
const loginForm = ref({ username: '', password: '' })
const loginError = ref('')
const loginLoading = ref(false)
const adminSiteLoading = ref(false)
const activeTab = ref('servers')
const servers = ref([])
const selectedServers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, avg_cpu: 0 })
const groups = ref(['Default'])
const latestAgentVersion = ref('')
const newServerName = ref('')
const newServerGroup = ref('')

const settings = ref({
  site_title: '',
  custom_bg: '',
  custom_bg_mobile: '',
  favicon: '',
  custom_head: '',
  custom_script: '',
  display_mode: 'bar',
  preferred_theme: 'auto',
  default_language: 'auto',
  theme_options: '{}',
  auto_discovery: false,
  is_public: false,
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_three_net_details: true,
  wss_report_enabled: true,
  wss_report_hours: Array.from({ length: 24 }, (_, hour) => hour),
  frontend_ws_timeout_minutes: 0,
  long_history_points: String(HISTORY.DEFAULT_LONG_RANGE_POINTS),
  tg_notify: '0',
  expire_reminder: '0',
  resource_alert_rules: [],
  traffic_alert_threshold: 0,
  tg_bot_token: '',
  tg_chat_id: '',
  notification_timezone: 'UTC',
  notification_language: 'zh',
  expire_notification_time: '12',
  notification_webhook_enabled: false,
  notification_webhook_url: '',
  notification_webhook_method: 'POST',
  notification_webhook_format: 'json',
  notification_webhook_headers: '',
  notification_webhook_body: '{\n  "title": "{{emoji}} {{event}}",\n  "content": "{{notification}}"\n}',
  notification_template: '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n{{time}}',
  turnstile_enabled: false,
  turnstile_login_enabled: false,
  turnstile_site_key: '',
  turnstile_secret_key: '',
  cloudflare_account_id: '',
  cloudflare_token: '',
  jwt_secret: '',
  username: '',
  password_configured: false,
  password: '',
  confirm_password: '',
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  node_1: '',
  node_2: '',
  node_3: '',
  node_4: '',
  custom_ct_name: '',
  custom_cu_name: '',
  custom_cm_name: '',
  custom_bd_name: '',
  node_1_name: '',
  node_2_name: '',
  node_3_name: '',
  node_4_name: '',
  theme_url: '',
  csp_static: '',
  csp_api: '',
  ua: 'cfsm'
})
const apiSecret = ref('')
const cacheRefreshing = ref(false)
const savedAutoDiscovery = ref(false)
const changeAdminPassword = ref(false)

const clearAdminPasswordInputs = () => {
  settings.value.password = ''
  settings.value.confirm_password = ''
}

const isAdminUsernameEmpty = () => !String(settings.value.username || '').trim()

const toggleAdminPasswordChange = () => {
  if (isAdminUsernameEmpty()) {
    changeAdminPassword.value = true
    return
  }
  changeAdminPassword.value = !changeAdminPassword.value
  if (!changeAdminPassword.value) {
    clearAdminPasswordInputs()
  }
}

const { visibility: passwordVisible, toggle: togglePassword } = usePasswordVisibility([
  'login', 'tgBotToken', 'tgChatId', 'notificationWebhookUrl', 'smtpPassword', 'turnstileSecret', 'cloudflareToken', 'jwtSecret', 'ua', 'password', 'confirmPassword'
])

const {
  turnstileEnabled, turnstileLoginEnabled, turnstileSiteKey,
  turnstileToken, turnstileVerified,
  hasSharedTurnstileVerified, loadTurnstileConfig: loadTurnstileConfigBase,
  renderTurnstile, resetTurnstile, clearTurnstile
} = useTurnstile()

const showEditModal = ref(false)
const showBatchEditModal = ref(false)
const batchEditing = ref(false)
const editForm = ref({
  id: '',
  name: '',
  server_group: '',
  region: '',
  tags: '',
  note: '',
  price: '',
  billing_cycle: 'month',
  auto_renewal: false,
  currency: '¥',
  expire_date: '',
  traffic_limit: '',
  traffic_calc_type: 'total',
  traffic_alert_percent: null,
  interface: '',
  reset_day: 1,
  collect_interval: 0,
  report_interval: 60,
  wss_report_interval: 2,
  connection_mode: 'auto',
  ping_mode: 'tcp',
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  node_1: '', node_2: '', node_3: '', node_4: '',
  rx_correction: '',
  tx_correction: '',
  auto_update: false,
  is_hidden: false,
  offline_notify_disabled: false
})

const createBatchEditDefaults = () => ({
  server_group: '',
  region: '',
  tags: '',
  price: '',
  billing_cycle: 'month',
  auto_renewal: false,
  currency: '¥',
  expire_date: '',
  traffic_limit: '',
  traffic_calc_type: 'total',
  traffic_alert_percent: null,
  interface: '',
  reset_day: 1,
  collect_interval: 0,
  report_interval: 60,
  wss_report_interval: 2,
  connection_mode: 'auto',
  ping_mode: 'tcp',
  custom_ct: '',
  custom_cu: '',
  custom_cm: '',
  custom_bd: '',
  node_1: '', node_2: '', node_3: '', node_4: '',
  rx_correction: '',
  tx_correction: '',
  auto_update: false,
  is_hidden: false,
  offline_notify_disabled: false
})

const batchEditForm = ref(createBatchEditDefaults())
const batchEditEnabled = ref(Object.fromEntries(Object.keys(createBatchEditDefaults()).map(field => [field, false])))

const showDeleteModal = ref(false)
const deleteServerId = ref('')

const copiedServerId = ref(null)
const copiedNoteServerId = ref(null)
const copiedSpecKey = ref(null)
const deleteTargetOs = ref('linux')
const deleteVersion = ref('go')
const deleteInstallMode = ref('current-user')
const deleteGhProxy = ref('')
const uninstallCopied = ref(false)
const saving = ref(false)
const addingServer = ref(false)
const editSaving = ref(false)
const deletingServer = ref(false)
const refreshingServers = ref(false)


const showDbModal = ref(false)
const dbOperation = ref('')
const dbLoading = ref(false)
const dbResult = ref(null)
const d1UsageLoading = ref(false)
const d1UsageResult = ref(null)
const validationError = ref(null)
const alertMessage = ref(null)
const showAutoUpdateWarning = ref(false)
const autoUpdatePendingEnable = ref(false)
const autoUpdateWarningSource = ref('edit')
const pendingBatchTasks = ref([])
const showBatchDeleteConfirm = ref(false)

const testNotificationLoading = ref(false)

const saveResult = ref(null)

const settingsPanelRef = ref(null)

const showCopyModal = ref(false)
const copyServerId = ref('')
const currentServerName = ref('')
const targetOs = ref('linux')
const installMode = ref('current-user')
const installGhProxy = ref('')
const installVersion = ref('')
const collectInterval = ref(0)
const reportInterval = ref(60)
const wssReportInterval = ref(2)
const connectionMode = ref('auto')
const pingMode = ref('tcp')
const customCt = ref('')
const customCu = ref('')
const customCm = ref('')
const customBd = ref('')
const node1 = ref('')
const node2 = ref('')
const node3 = ref('')
const node4 = ref('')
const explicitEmptyNodes = ref({})
const networkInterface = ref('')
const resetDay = ref(1)
const rxCorrection = ref('')
const txCorrection = ref('')
const autoUpdate = ref(false)
const copiedCmd = ref(false)
const showAutoDiscoveryModal = ref(false)
const autoDiscoveryTargetOs = ref('linux')
const autoDiscoveryInstallMode = ref('current-user')
const autoDiscoveryName = ref('')
const autoDiscoveryVersion = ref('')
const autoDiscoveryAutoUpdate = ref(false)
const autoDiscoveryGhProxy = ref('')
const autoDiscoveryCopied = ref(false)

const isWssReportEnabled = computed(() => settings.value.wss_report_enabled === true)
const getEffectiveConnectionMode = (value) => {
  const connectionMode = value === 'http' ? 'http' : 'auto'
  return isWssReportEnabled.value ? connectionMode : 'http'
}

const getEffectivePingMode = (value) => value === 'icmp' ? 'icmp' : 'tcp'

watch(isWssReportEnabled, (enabled) => {
  if (!enabled) {
    editForm.value.connection_mode = 'http'
    connectionMode.value = 'http'
  }
})

const getPingNodeLabel = (field) => getLocalizedPingNodeLabel(field, settings.value, trans.value)

const getPingNodeValidation = (source) => {
  const values = {}
  for (const field of PING_NODE_FIELDS) {
    const result = validatePingNode(source[field])
    if (!result.valid) {
      return { valid: false, field }
    }
    values[field] = result.value
  }
  return { valid: true, values }
}

const buildPingNodeError = (field) => `${getPingNodeLabel(field)}: ${trans.value.invalidPingNodeFormat}`

const copyServerNote = async (server) => {
  const note = String(server?.note || '')
  if (!note.trim()) return

  try {
    const copied = await copyTextToClipboard(note)
    if (!copied) {
      alertMessage.value = trans.value.httpsRequired
      return
    }
    copiedNoteServerId.value = server.id
    setTimeout(() => {
      if (copiedNoteServerId.value === server.id) {
        copiedNoteServerId.value = null
      }
    }, 1500)
  } catch (e) {
    console.error('[ERROR] Copy note failed:', e)
  }
}

const copyServerSpec = async ({ key, text } = {}) => {
  const value = String(text || '').trim()
  if (!key || !value || value === '-') return

  try {
    const copied = await copyTextToClipboard(value)
    if (!copied) {
      alertMessage.value = trans.value.httpsRequired
      return
    }
    copiedSpecKey.value = key
    setTimeout(() => {
      if (copiedSpecKey.value === key) {
        copiedSpecKey.value = null
      }
    }, 1500)
  } catch (e) {
    console.error('[ERROR] Copy spec failed:', e)
  }
}

const safeGetStorage = (key) => safeLocalStorage.getItem(key)

const safeSetStorage = (key, value) => {
  safeLocalStorage.setItem(key, value)
}

const handleLogin = async () => {
  if (loginLoading.value) return
  loginError.value = ''
  loginLoading.value = true

  try {
    if (turnstileLoginEnabled.value && !turnstileToken.value) {
      loginError.value = trans.value.pleaseCompleteVerification
      return
    }

    if (turnstileEnabled.value && !turnstileVerified.value && !turnstileToken.value) {
      loginError.value = trans.value.pleaseCompleteVerification
      return
    }

    const result = await login(loginForm.value.username, loginForm.value.password, turnstileToken.value, selectedApiIndex.value)
    if (!result.error) {
      isLoggedIn.value = true
      clearTurnstile()
      turnstileVerified.value = hasSharedTurnstileVerified()

      const safeRedirect = resolveSafeLoginRedirect(route.query.redirect)
      if (safeRedirect) {
        await router.push(safeRedirect)
        return
      }

      syncApiIndexQuery()
      await Promise.all([
        loadSettings(),
        loadServers(),
        loadLatestAgentVersion()
      ])
    } else {
      loginError.value = result.status === 403 ? trans.value.pleaseCompleteVerification : trans.value.errorInvalidUsername
      loginForm.value.password = ''
      clearTurnstile()
      resetTurnstile('#admin-turnstile-container')
    }
  } finally {
    loginLoading.value = false
  }
}

const logout = async () => {
  try {
    await adminApiForSite({ action: 'logout' })
  } catch (_) {
  }
  apiLogout()
  isLoggedIn.value = false
  latestAgentVersion.value = ''
  clearTurnstile()
  await loadTurnstileConfig()
  window.location.href = '/'
}

const checkLoginStatus = () => {
  const token = safeGetStorage(STORAGE.JWT_TOKEN)
  return !!token || appConfig?.authorization === true
}

const initAdmin = async () => {
  const hasCreds = checkLoginStatus()
  if (hasCreds) {
    isLoggedIn.value = true
    syncApiIndexQuery()
    const savedTurnstileToken = safeGetStorage(STORAGE.TURNSTILE_TOKEN)
    if (savedTurnstileToken) {
      turnstileToken.value = savedTurnstileToken
    }
    await Promise.all([
      loadSettings(),
      loadServers(),
      loadLatestAgentVersion()
    ])
  } else {
    await loadTurnstileConfig()
  }
}

const loadTurnstileConfig = async () => {
  await loadTurnstileConfigBase(selectedApiIndex.value, isMultipleMode.value, loginError)
  if (turnstileSiteKey.value && (turnstileLoginEnabled.value || (turnstileEnabled.value && !turnstileVerified.value))) {
    await nextTick()
    renderTurnstile('#admin-turnstile-container', turnstileSiteKey.value)
  }
}

const handleApiIndexChange = async (newIndex) => {
  selectedApiIndex.value = newIndex
  syncApiIndexQuery()
  await nextTick()
  await loadTurnstileConfig()
}

const resetAdminContext = () => {
  selectedServers.value = []
  showEditModal.value = false
  showBatchEditModal.value = false
  showAutoDiscoveryModal.value = false
  showAutoUpdateWarning.value = false
  showBatchDeleteConfirm.value = false
  pendingBatchTasks.value = []
  showDeleteModal.value = false
  showCopyModal.value = false
  showDbModal.value = false
  validationError.value = null
}

const switchAdminSite = async () => {
  resetAdminContext()
  adminSiteLoading.value = true
  try {
    await Promise.all([
      loadSettings(),
      loadServers(),
      loadLatestAgentVersion()
    ])
  } finally {
    adminSiteLoading.value = false
  }
}

const handleAdminApiIndexChange = async () => {
  syncApiIndexQuery()
  await switchAdminSite()
}

const getStartupConfigForCurrentSite = () => {
  if (startupConfigConsumed) return null
  if (selectedApiIndex.value !== 0) return null
  if (!appConfig || typeof appConfig !== 'object' || Object.keys(appConfig).length === 0) return null
  startupConfigConsumed = true
  return appConfig
}

const loadLatestAgentVersion = async () => {
  try {
    const startupConfig = getStartupConfigForCurrentSite()
    const config = startupConfig || await fetchConfig(selectedApiIndex.value)
    const configVersion = normalizeVersion(config?.last_agent_version)
    latestAgentVersion.value = configVersion || await fetchLatestAgentReleaseVersion()
  } catch (e) {
    console.error('[ERROR] Load latest agent version failed:', e)
    latestAgentVersion.value = await fetchLatestAgentReleaseVersion()
  }
}

const syncInjectedAppConfig = (settingsSource, themeOptions = undefined) => {
  if (!appConfig || typeof appConfig !== 'object' || !settingsSource) return
  const normalizedNames = {
    custom_ct_name: resolveCustomPingNodeName('custom_ct_name', settingsSource.custom_ct_name),
    custom_cu_name: resolveCustomPingNodeName('custom_cu_name', settingsSource.custom_cu_name),
    custom_cm_name: resolveCustomPingNodeName('custom_cm_name', settingsSource.custom_cm_name),
    custom_bd_name: resolveCustomPingNodeName('custom_bd_name', settingsSource.custom_bd_name),
    node_1_name: resolveCustomPingNodeName('node_1_name', settingsSource.node_1_name),
    node_2_name: resolveCustomPingNodeName('node_2_name', settingsSource.node_2_name),
    node_3_name: resolveCustomPingNodeName('node_3_name', settingsSource.node_3_name),
    node_4_name: resolveCustomPingNodeName('node_4_name', settingsSource.node_4_name)
  }
  const extraUpdates = {
    site_title: settingsSource.site_title ?? '',
    display_mode: normalizeDisplayMode(settingsSource.display_mode),
    frontend_ws_timeout_minutes: Number(settingsSource.frontend_ws_timeout_minutes) || 0
  }
  if (themeOptions !== undefined) {
    extraUpdates.theme_options = themeOptions
  }

  if (Array.isArray(appConfig.site_configs)) {
    const existing = appConfig.site_configs[selectedApiIndex.value]
    appConfig.site_configs[selectedApiIndex.value] = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...normalizedNames,
      ...extraUpdates,
      __updatedByAdminAt: Date.now()
    }
  }
  if (selectedApiIndex.value === 0) {
    Object.assign(appConfig, normalizedNames, extraUpdates, { __updatedByAdminAt: Date.now() })
  }
}

const loadSettings = async () => {
  try {
    const result = await adminApiForSite({ action: 'get_settings' })
    if (!result.error) {
      const data = result.data
      const settingsData = data.settings || {}
      settings.value = {
        site_title: settingsData.site_title || '',
        custom_bg: settingsData.custom_bg || '',
        custom_bg_mobile: settingsData.custom_bg_mobile || '',
        favicon: settingsData.favicon || '',
        custom_head: settingsData.custom_head || '',
        custom_script: settingsData.custom_script || '',
        display_mode: resolveDisplayMode(settingsData),
        preferred_theme: normalizePreferredThemeSetting(settingsData.preferred_theme),
        default_language: normalizeDefaultLanguageSetting(settingsData.default_language),
        theme_options: formatThemeOptions(settingsData.theme_options),
        auto_discovery: settingsData.auto_discovery === 'true' || settingsData.auto_discovery === true,
        is_public: settingsData.is_public === 'true',
        show_price: settingsData.show_price === 'true',
        show_expire: settingsData.show_expire === 'true',
        show_tf: settingsData.show_tf === 'true',
        show_three_net_details: settingsData.show_three_net_details === 'true' || settingsData.show_three_net_details === true,
        wss_report_enabled: settingsData.wss_report_enabled === 'true' || settingsData.wss_report_enabled === true,
        wss_report_hours: normalizeWssReportHoursSetting(settingsData.wss_report_hours),
        frontend_ws_timeout_minutes: normalizeFrontendWsTimeoutMinutesSetting(settingsData.frontend_ws_timeout_minutes),
        long_history_points: normalizeLongHistoryPointsSetting(settingsData.long_history_points),
        tg_notify: normalizeTgNotifySetting(settingsData.tg_notify),
        expire_reminder: normalizeExpireReminderSetting(settingsData.expire_reminder),
        resource_alert_rules: normalizeResourceAlertRulesSetting(settingsData.resource_alert_rules),
        traffic_alert_threshold: Number(settingsData.traffic_alert_threshold) || 0,
        tg_bot_token: settingsData.tg_bot_token || '',
        tg_chat_id: settingsData.tg_chat_id || '',
        notification_timezone: normalizeNotificationTimezoneSetting(settingsData.notification_timezone),
        notification_language: normalizeNotificationLanguageSetting(settingsData.notification_language),
        expire_notification_time: normalizeExpireNotificationTimeSetting(settingsData.expire_notification_time),
        notification_webhook_enabled: settingsData.notification_webhook_enabled === 'true' || settingsData.notification_webhook_enabled === true,
        notification_webhook_url: settingsData.notification_webhook_url || '',
        notification_webhook_method: String(settingsData.notification_webhook_method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
        notification_webhook_format: ['json', 'form', 'text'].includes(String(settingsData.notification_webhook_format || '').toLowerCase()) ? String(settingsData.notification_webhook_format).toLowerCase() : 'json',
        notification_webhook_headers: settingsData.notification_webhook_headers || '',
        notification_webhook_body: settingsData.notification_webhook_body || '{\n  "title": "{{emoji}} {{event}}",\n  "content": "{{notification}}"\n}',
        notification_template: settingsData.notification_template || '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n{{time}}',
        turnstile_enabled: settingsData.turnstile_enabled === 'true',
        turnstile_login_enabled: settingsData.turnstile_login_enabled === 'true',
        turnstile_site_key: settingsData.turnstile_site_key || '',
        turnstile_secret_key: settingsData.turnstile_secret_key || '',
        cloudflare_account_id: settingsData.cloudflare_account_id || '',
        cloudflare_token: settingsData.cloudflare_token || '',
        jwt_secret: '',
        username: settingsData.username || '',
        password_configured: settingsData.password_configured === true,
        password: '',
        confirm_password: '',
        custom_ct: settingsData.custom_ct || '',
        custom_cu: settingsData.custom_cu || '',
        custom_cm: settingsData.custom_cm || '',
        custom_bd: settingsData.custom_bd || '',
        node_1: settingsData.node_1 || '', node_2: settingsData.node_2 || '', node_3: settingsData.node_3 || '', node_4: settingsData.node_4 || '',
        custom_ct_name: resolveCustomPingNodeName('custom_ct_name', settingsData.custom_ct_name),
        custom_cu_name: resolveCustomPingNodeName('custom_cu_name', settingsData.custom_cu_name),
        custom_cm_name: resolveCustomPingNodeName('custom_cm_name', settingsData.custom_cm_name),
        custom_bd_name: resolveCustomPingNodeName('custom_bd_name', settingsData.custom_bd_name),
        node_1_name: resolveCustomPingNodeName('node_1_name', settingsData.node_1_name),
        node_2_name: resolveCustomPingNodeName('node_2_name', settingsData.node_2_name),
        node_3_name: resolveCustomPingNodeName('node_3_name', settingsData.node_3_name),
        node_4_name: resolveCustomPingNodeName('node_4_name', settingsData.node_4_name),
        theme_url: settingsData.theme_url || '',
        csp_static: settingsData.csp_static || '',
        csp_api: settingsData.csp_api || '',
        ua: settingsData.ua || 'cfsm'
      }
      applyMikusThemeOptions(settingsData.theme_options)
      syncInjectedAppConfig(settings.value, settingsData.theme_options)
      changeAdminPassword.value = !settings.value.password_configured || !String(settings.value.username || '').trim()
      apiSecret.value = data.api_secret || ''
      // 只有已保存到服务端的自动发现开关才提供复制安装命令，避免复制出当前并未生效的命令
      savedAutoDiscovery.value = settings.value.auto_discovery
    }
  } catch (e) {
    console.error('[ERROR] Load settings failed:', e)
  }
}

const handleThemeOptionsApplied = (themeOptions) => {
  settings.value.theme_options = formatThemeOptions(themeOptions)
  applyMikusThemeOptions(themeOptions)
}

watch(
  () => settings.value.username,
  () => {
    if (isAdminUsernameEmpty()) {
      changeAdminPassword.value = true
    }
  }
)

const saveSettings = async () => {
  if (saving.value) return

  validationError.value = null

  const jwtSecret = settings.value.jwt_secret
  if (jwtSecret && jwtSecret.length > 0 && jwtSecret.length < 32) {
    validationError.value = trans.value.jwtSecretMinLength
    return
  }

  if (jwtSecret && /\s/.test(jwtSecret)) {
    validationError.value = trans.value.jwtSecretNoWhitespace
    return
  }

  if (!settings.value.username || settings.value.username.trim().length === 0) {
    validationError.value = trans.value.usernameRequired
    return
  }

  const frontendWsTimeoutMinutes = Number(settings.value.frontend_ws_timeout_minutes)
  if (!Number.isInteger(frontendWsTimeoutMinutes) || frontendWsTimeoutMinutes < 0 || frontendWsTimeoutMinutes > FRONTEND_WS_TIMEOUT_MINUTES_MAX) {
    validationError.value = trans.value.invalidFrontendWsTimeoutMinutes
    return
  }

  if (!isValidNotificationTimezone(settings.value.notification_timezone)) {
    validationError.value = trans.value.invalidNotificationTimezone || 'Notification timezone must be a valid IANA timezone, for example Asia/Shanghai'
    return
  }

  if (normalizeExpireNotificationTimeSetting(settings.value.expire_notification_time) !== String(settings.value.expire_notification_time)) {
    validationError.value = trans.value.invalidExpireNotificationTime || 'Expiration notification time must be an integer from 0 to 23'
    return
  }

  if (normalizeExpireReminderSetting(settings.value.expire_reminder) !== String(settings.value.expire_reminder)) {
    validationError.value = trans.value.invalidExpireReminder || `Expiration reminder must be an integer from 0 to ${EXPIRE_REMINDER_DAYS_MAX} days`
    return
  }

  const trafficAlertThresholdCheck = validateTrafficAlertPercentInput(settings.value.traffic_alert_threshold, { allowEmpty: true })
  if (!trafficAlertThresholdCheck.valid) {
    validationError.value = trans.value.invalidTrafficAlertPercent
    return
  }

  const rawRules = Array.isArray(settings.value.resource_alert_rules) ? settings.value.resource_alert_rules : []
  if (rawRules.length > 20) {
    validationError.value = trans.value.resourceAlertMaxRulesHint
    return
  }
  for (const rule of rawRules) {
    const metric = normalizeResourceAlertMetricSetting(rule?.metric)
    const thresholdCheck = validateResourceAlertThresholdInput(rule?.threshold, metric)
    if (!thresholdCheck.valid) {
      validationError.value = trans.value.invalidResourceAlertThreshold
      return
    }
  }

  if (!settings.value.password_configured) {
    changeAdminPassword.value = true
    if (!settings.value.password || settings.value.password.trim().length === 0) {
      validationError.value = trans.value.passwordRequired
      return
    }
  } else if (changeAdminPassword.value) {
    if (!settings.value.password || settings.value.password.trim().length === 0) {
      validationError.value = trans.value.newPasswordRequired
      return
    }
  }

  const shouldChangePassword = changeAdminPassword.value
  if (shouldChangePassword) {
    if (settings.value.password !== settings.value.confirm_password) {
      validationError.value = trans.value.passwordMismatch
      return
    }
  }

  if (settings.value.turnstile_enabled || settings.value.turnstile_login_enabled) {
    if (!settings.value.turnstile_site_key || settings.value.turnstile_site_key.trim().length === 0) {
      validationError.value = trans.value.turnstileSiteKeyRequired
      return
    }
    if (!settings.value.turnstile_secret_key || settings.value.turnstile_secret_key.trim().length === 0) {
      validationError.value = trans.value.turnstileSecretKeyRequired
      return
    }
  }

  if (isTgNotifyEnabled(settings.value.tg_notify) || isExpireReminderEnabled(settings.value.expire_reminder) || isResourceAlertEnabled(settings.value.resource_alert_rules)) {
    if (isNotificationWebhookEnabled()) {
      if (!settings.value.notification_webhook_url || settings.value.notification_webhook_url.trim().length === 0) {
        validationError.value = trans.value.notificationWebhookUrlRequired || 'Webhook URL is required'
        return
      }
    } else if (!settings.value.tg_bot_token || settings.value.tg_bot_token.trim().length === 0) {
      validationError.value = trans.value.tgBotTokenRequired
      return
    }
  }

  const pingNodeValidation = getPingNodeValidation(settings.value)
  if (!pingNodeValidation.valid) {
    validationError.value = buildPingNodeError(pingNodeValidation.field)
    return
  }

  const themeOptionsResult = parseThemeOptions(settings.value.theme_options)
  if (!themeOptionsResult.valid) {
    validationError.value = trans.value.invalidThemeOptionsFormat
    return
  }

  if (settingsPanelRef.value) {
    const cspStaticValid = settingsPanelRef.value.validateCspField('csp_static')
    const cspApiValid = settingsPanelRef.value.validateCspField('csp_api')
    if (!cspStaticValid || !cspApiValid) {
      return
    }
    if (!settingsPanelRef.value.validateSmtpFields()) {
      validationError.value = trans.value.smtpConfigInvalid || 'SMTP configuration is incomplete, please check the SMTP settings'
      return
    }
  }

  saving.value = true
  saveResult.value = null

  const data = {
    action: 'save_settings',
    settings: {
      site_title: settings.value.site_title,
      custom_bg: settings.value.custom_bg,
      custom_bg_mobile: settings.value.custom_bg_mobile,
      favicon: settings.value.favicon,
      custom_head: settings.value.custom_head,
      custom_script: settings.value.custom_script,
      display_mode: normalizeDisplayMode(settings.value.display_mode),
      preferred_theme: normalizePreferredThemeSetting(settings.value.preferred_theme),
      default_language: normalizeDefaultLanguageSetting(settings.value.default_language),
      appearance_options: {
        theme_options: themeOptionsResult.value
      },
      auto_discovery: settings.value.auto_discovery ? 'true' : 'false',
      is_public: settings.value.is_public ? 'true' : 'false',
      show_price: settings.value.show_price ? 'true' : 'false',
      show_expire: settings.value.show_expire ? 'true' : 'false',
      show_tf: settings.value.show_tf ? 'true' : 'false',
      show_three_net_details: settings.value.show_three_net_details ? 'true' : 'false',
      wss_report_enabled: settings.value.wss_report_enabled ? 'true' : 'false',
      wss_report_hours: normalizeWssReportHoursSetting(settings.value.wss_report_hours),
      frontend_ws_timeout_minutes: String(frontendWsTimeoutMinutes),
      long_history_points: normalizeLongHistoryPointsSetting(settings.value.long_history_points),
      tg_notify: normalizeTgNotifySetting(settings.value.tg_notify),
      expire_reminder: normalizeExpireReminderSetting(settings.value.expire_reminder),
      resource_alert_rules: normalizeResourceAlertRulesSetting(settings.value.resource_alert_rules),
      traffic_alert_threshold: String(trafficAlertThresholdCheck.value ?? 0),
      tg_bot_token: settings.value.tg_bot_token,
      tg_chat_id: settings.value.tg_chat_id,
      notification_timezone: normalizeNotificationTimezoneSetting(settings.value.notification_timezone),
      notification_language: normalizeNotificationLanguageSetting(settings.value.notification_language),
      expire_notification_time: normalizeExpireNotificationTimeSetting(settings.value.expire_notification_time),
      notification_webhook_enabled: settings.value.notification_webhook_enabled ? 'true' : 'false',
      notification_webhook_url: settings.value.notification_webhook_url,
      notification_webhook_method: settings.value.notification_webhook_method === 'GET' ? 'GET' : 'POST',
      notification_webhook_format: ['json', 'form', 'text'].includes(settings.value.notification_webhook_format) ? settings.value.notification_webhook_format : 'json',
      notification_webhook_headers: settings.value.notification_webhook_headers,
      notification_webhook_body: settings.value.notification_webhook_body,
      notification_template: settings.value.notification_template,
      turnstile_enabled: settings.value.turnstile_enabled ? 'true' : 'false',
      turnstile_login_enabled: settings.value.turnstile_login_enabled ? 'true' : 'false',
      turnstile_site_key: settings.value.turnstile_site_key,
      turnstile_secret_key: settings.value.turnstile_secret_key,
      cloudflare_account_id: settings.value.cloudflare_account_id,
      cloudflare_token: settings.value.cloudflare_token,
      username: settings.value.username,
      custom_ct: pingNodeValidation.values.custom_ct,
      custom_cu: pingNodeValidation.values.custom_cu,
      custom_cm: pingNodeValidation.values.custom_cm,
      custom_bd: pingNodeValidation.values.custom_bd,
      node_1: pingNodeValidation.values.node_1, node_2: pingNodeValidation.values.node_2, node_3: pingNodeValidation.values.node_3, node_4: pingNodeValidation.values.node_4,
      custom_ct_name: settings.value.custom_ct_name.trim(),
      custom_cu_name: settings.value.custom_cu_name.trim(),
      custom_cm_name: settings.value.custom_cm_name.trim(),
      custom_bd_name: settings.value.custom_bd_name.trim(),
      node_1_name: settings.value.node_1_name.trim(), node_2_name: settings.value.node_2_name.trim(), node_3_name: settings.value.node_3_name.trim(), node_4_name: settings.value.node_4_name.trim(),
      csp_static: settings.value.csp_static || '',
      csp_api: settings.value.csp_api || '',
      ua: String(settings.value.ua ?? '').trim()
    }
  }

  if (shouldChangePassword && settings.value.password.length > 0) {
    data.settings.password = settings.value.password
  }

  if (jwtSecret && jwtSecret.length > 0) {
    data.settings.jwt_secret = jwtSecret
  }

  try {
    const result = await adminApiForSite(data)
    if (!result.error) {
      const renewedToken = result.data?.token || result.token
      if (typeof renewedToken === 'string' && renewedToken.trim()) {
        safeSetStorage(STORAGE.JWT_TOKEN, renewedToken.trim())
      }
      saveResult.value = { success: true }
      applyMikusThemeOptions(themeOptionsResult.value)
      syncInjectedAppConfig(data.settings, themeOptionsResult.value)
      clearAdminPasswordInputs()
      changeAdminPassword.value = false
      settings.value.jwt_secret = ''
      await loadSettings()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  } finally {
    saving.value = false
  }
}


const loadServers = async (options = {}) => {
  try {
    const result = await adminApiForSite(options.refresh ? { action: 'list', refresh: true } : { action: 'list' })
    if (!result.error) {
      const data = result.data
      servers.value = data.servers || []
      stats.value = data.stats || { total: servers.value.length, online: 0, offline: servers.value.length, avg_cpu: 0 }

      const serverGroups = [...new Set(servers.value.map(s => s.server_group || trans.value.default))]
      groups.value = serverGroups
    }
    return result
  } catch (e) {
    console.error('[ERROR] Load servers failed:', e)
    return { error: e.message }
  }
}

// 清除 Workers 端服务器列表缓存并就地重新拉取（list 带 refresh 时服务端先清缓存再读 D1）
const refreshServersCache = async () => {
  if (cacheRefreshing.value) return
  cacheRefreshing.value = true
  try {
    const result = await loadServers({ refresh: true })
    if (result?.error) {
      alertMessage.value = getMessage(result.error) || result.error || trans.value.operationFailed
      return
    }
    alertMessage.value = trans.value.cacheCleared
  } finally {
    cacheRefreshing.value = false
  }
}

const refreshServers = async () => {
  if (refreshingServers.value) return
  refreshingServers.value = true
  try {
    await Promise.all([
      loadServers(),
      loadLatestAgentVersion()
    ])
  } finally {
    refreshingServers.value = false
  }
}

const addServer = async () => {
  if (addingServer.value) return
  const rawName = String(newServerName.value ?? '')
  if (!rawName.trim()) {
    validationError.value = trans.value.enterServerName
    return
  }
  const nameCheck = validateServerNameInput(rawName)
  if (!nameCheck.valid) {
    validationError.value = trans.value.invalidServerName
    return
  }

  addingServer.value = true
  try {
    const result = await adminApiForSite({ action: 'add', name: nameCheck.value, server_group: newServerGroup.value })
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverAdded }
      newServerName.value = ''
      newServerGroup.value = ''
      await loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  } finally {
    addingServer.value = false
  }
}

const getInstallCommand = (serverId) => {
  const HOST = selectedApiBase.value
  return `curl -sL ${HOST}/install.sh | bash -s install -id=${serverId} -secret='${apiSecret.value}' -url=${HOST}/update`
}

const resolveServerPingNode = (server, field) => {
  const value = server?.[field]
  const explicitEmpty = value === 0 || value === '0'
  return {
    value: explicitEmpty ? '' : (value || settings.value[field] || ''),
    explicitEmpty
  }
}

const getUninstallCommand = () => {
  const HOST = selectedApiBase.value
  const isGo = deleteVersion.value === 'go'
  const proxy = isGo ? deleteGhProxy.value.trim() : ''
  if (isGo) {
    if (deleteTargetOs.value === 'windows') {
      const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
      const proxyParam = proxy ? ` --install-ghproxy=${quotePowerShellArg(proxy)}` : ''
      return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script uninstall${proxyParam}`
    }
    const sudoPrefix = deleteTargetOs.value === 'mac' ? 'sudo ' : ''
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
    const proxyParam = proxy ? ` --install-ghproxy=${quotePosixShellArg(proxy)}` : ''
    const uninstallCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | ${sudoPrefix}sh -s -- uninstall${proxyParam}`
    if (deleteTargetOs.value === 'linux' && deleteInstallMode.value === 'cfsm-user') {
      return buildUninstallAsCfsmCommand(uninstallCommand)
    }
    return uninstallCommand
  }
  if (deleteTargetOs.value === 'windows') {
    return `$script = Join-Path (Get-Location) 'uninstall-cf-probe.ps1'; Invoke-WebRequest -Uri '${HOST}/uninstall.ps1' -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script`
  }
  const sudoPrefix = deleteTargetOs.value === 'mac' ? 'sudo ' : ''
  return `curl -fsSL '${HOST}/uninstall.sh' | ${sudoPrefix}sh -s -- -y`
}

const copyCmd = (serverId) => {
  const server = servers.value.find(s => s.id === serverId)
  copyServerId.value = serverId
  currentServerName.value = server?.name || ''
  targetOs.value = 'linux'
  installMode.value = 'current-user'
  installGhProxy.value = ''
  installVersion.value = ''
  collectInterval.value = server?.collect_interval ?? 0
  reportInterval.value = server?.report_interval || 60
  wssReportInterval.value = server?.wss_report_interval || 2
  connectionMode.value = getEffectiveConnectionMode(server?.connection_mode)
  pingMode.value = getEffectivePingMode(server?.ping_mode)
  const customCtNode = resolveServerPingNode(server, 'custom_ct')
  const customCuNode = resolveServerPingNode(server, 'custom_cu')
  const customCmNode = resolveServerPingNode(server, 'custom_cm')
  const customBdNode = resolveServerPingNode(server, 'custom_bd')
  const node1Value = resolveServerPingNode(server, 'node_1')
  const node2Value = resolveServerPingNode(server, 'node_2')
  const node3Value = resolveServerPingNode(server, 'node_3')
  const node4Value = resolveServerPingNode(server, 'node_4')
  explicitEmptyNodes.value = {
    custom_ct: customCtNode.explicitEmpty, custom_cu: customCuNode.explicitEmpty,
    custom_cm: customCmNode.explicitEmpty, custom_bd: customBdNode.explicitEmpty,
    node_1: node1Value.explicitEmpty, node_2: node2Value.explicitEmpty,
    node_3: node3Value.explicitEmpty, node_4: node4Value.explicitEmpty
  }
  customCt.value = customCtNode.value
  customCu.value = customCuNode.value
  customCm.value = customCmNode.value
  customBd.value = customBdNode.value
  node1.value = node1Value.value
  node2.value = node2Value.value
  node3.value = node3Value.value
  node4.value = node4Value.value
  networkInterface.value = server?.interface || ''
  resetDay.value = server?.reset_day ?? 1
  rxCorrection.value = server?.rx_correction ?? ''
  txCorrection.value = server?.tx_correction ?? ''
  autoUpdate.value = server?.auto_update === '1' || server?.auto_update === 1 || server?.auto_update === true
  copiedCmd.value = false
  showCopyModal.value = true
}

const buildGhRawUrl = (proxy, path) => {
  const base = 'https://raw.githubusercontent.com'
  if (!proxy) return `${base}${path}`
  const cleanProxy = proxy.replace(/\/$/, '')
  return `${cleanProxy}/${base}${path}`
}

const quotePosixShellArg = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`

const quotePowerShellArg = (value) => `'${String(value).replaceAll("'", "''")}'`

const quotePosixDoubleShellArg = (value) => `"${String(value)
  .replaceAll('\\', '\\\\')
  .replaceAll('"', '\\"')
  .replaceAll('$', '\\$')
  .replaceAll('`', '\\`')}"`

const buildUninstallAsCfsmCommand = (command) => {
  const runuserCommand = `runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`
  return [
    '(',
    'set -e',
    `if ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.value.dedicatedUserUninstallUnsupported)} >&2; exit 1; fi`,
    `id cfsm >/dev/null 2>&1 || { echo ${quotePosixDoubleShellArg(trans.value.nonRootUninstallUserMissing)} >&2; exit 1; }`,
    'CFSM_UID=$(id -u cfsm)',
    'CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    'if [ "$(id -u)" -eq 0 ]; then',
    `  ${runuserCommand}`,
    'elif command -v sudo >/dev/null 2>&1; then',
    `  sudo ${runuserCommand}`,
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.value.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi',
    ')'
  ].join('\n')
}

const buildInstallAsCfsmCommand = (command, runStep) => {
  const lines = [
    '(',
    'set -e',
    `if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1 || ! command -v loginctl >/dev/null 2>&1 || ! command -v useradd >/dev/null 2>&1 || ! command -v runuser >/dev/null 2>&1; then echo ${quotePosixDoubleShellArg(trans.value.dedicatedUserSystemdRequired)} >&2; exit 1; fi`,
    'if [ "$(id -u)" -eq 0 ]; then',
    '  as_root() { "$@"; }',
    'elif command -v sudo >/dev/null 2>&1; then',
    '  as_root() { sudo "$@"; }',
    'else',
    `  echo ${quotePosixDoubleShellArg(trans.value.nonRootInstallSudoRequired)} >&2; exit 1`,
    'fi'
  ]

  lines.push(
    'id cfsm >/dev/null 2>&1 || as_root useradd -m -s /bin/sh cfsm',
    'as_root loginctl enable-linger cfsm'
  )

  lines.push(
    'CFSM_UID=$(id -u cfsm)',
    'as_root systemctl start user@${CFSM_UID}.service',
    'if command -v getent >/dev/null 2>&1; then CFSM_HOME=$(getent passwd cfsm | cut -d: -f6); else CFSM_HOME=/home/cfsm; fi; [ -n "${CFSM_HOME}" ] || CFSM_HOME=/home/cfsm',
    '',
    `# ${runStep}`,
    `as_root runuser -u cfsm -- env HOME="\${CFSM_HOME}" XDG_RUNTIME_DIR="/run/user/\${CFSM_UID}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/\${CFSM_UID}/bus" sh -c ${quotePosixDoubleShellArg(command)}`,
    ')'
  )
  return lines.join('\n')
}

// 站点 UA 不是默认值时，安装命令必须带上：否则首次上报就会被 /update 的防火墙规则拦截，
// 连自动发现都无法完成。
const installUserAgent = () => {
  const ua = String(settings.value.ua ?? '').trim()
  return ua && ua !== 'cfsm' ? ua : ''
}

const getCustomInstallCommand = () => {
  const HOST = selectedApiBase.value
  const autoUpdateFlag = autoUpdate.value ? 1 : 0
  const proxy = installGhProxy.value.trim()
  const version = installVersion.value.trim()
  const isDedicatedUserInstall = targetOs.value === 'linux' && installMode.value === 'cfsm-user'
  // 安装命令只保留必须写入本地的参数：id / secret / url / auto_update，
  // 以及站点 UA 非默认值时的 -ua（否则首次上报就会被 /update 的防火墙规则拦下）。
  // collect_interval、interval、connection_mode、ping_mode、reset_day、ct/cu/cm/bd、node_1..4、interface、rx/tx_correction
  // 等属于后端 /api 动态下发的配置（见 agentConfig.buildAgentConfig），Agent 启动后会自动拉取，无需写进安装命令。
  if (targetOs.value === 'windows') {
    const params = [
      'install'
    ]
    if (proxy) params.push(`--install-ghproxy=${quotePowerShellArg(proxy)}`)
    if (version) params.push(`--install-version=${quotePowerShellArg(version)}`)
    params.push(
      `-id='${copyServerId.value}'`,
      `-secret=${quotePowerShellArg(apiSecret.value)}`,
      `-url='${HOST}/update'`,
      `-auto_update='${autoUpdateFlag}'`
    )
    const ua = installUserAgent()
    if (ua) params.push(`-ua=${quotePowerShellArg(ua)}`)
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
    return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script ${params.join(' ')}`
  }
  if (targetOs.value === 'docker') {
    const safeTag = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(version) ? version : 'latest'
    const image = `ghcr.io/huilang-me/cfsm-agent:${safeTag}`
    const ua = installUserAgent()
    const uaEnv = ua ? ` -e UA=${quotePosixShellArg(ua)}` : ''
    return [
      'docker run -d --name cf-probe --restart=unless-stopped --network=host \\',
      '  -v cf-probe-data:/data \\',
      `  -e SERVER_ID=${quotePosixShellArg(copyServerId.value)} -e SECRET=${quotePosixShellArg(apiSecret.value)} -e WORKER_URL=${quotePosixShellArg(`${HOST}/update`)}${uaEnv} \\`,
      `  ${image}`
    ].join('\n')
  }
  const params = ['install']
  if (proxy) params.push(`--install-ghproxy=${quotePosixShellArg(proxy)}`)
  if (version) params.push(`--install-version=${quotePosixShellArg(version)}`)
  params.push(
    `-id=${copyServerId.value}`,
    `-secret=${quotePosixShellArg(apiSecret.value)}`,
    `-url=${HOST}/update`,
    `-auto_update=${autoUpdateFlag}`
  )
  const ua = installUserAgent()
  if (ua) params.push(`-ua=${quotePosixShellArg(ua)}`)
  const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
  const installCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | sh -s -- ${params.join(' ')}`
  if (!isDedicatedUserInstall) return installCommand

  return buildInstallAsCfsmCommand(installCommand, trans.value.nonRootInstallRunStep)
}

// 自动发现模式下安装命令不带 -id：Agent 首次上报时由服务端自动创建服务器。
// name 留空时服务端回退到请求来源 IP；安装用户、代理、版本、名称与自动更新仅影响本次生成的命令。
const buildAutoDiscoveryCommand = ({ targetOs: os = 'linux', installMode: mode = 'current-user', ghProxy = '', name = '', version = '', autoUpdate = false } = {}) => {
  const HOST = selectedApiBase.value
  const proxy = String(ghProxy || '').trim()
  const agentVersion = String(version || '').trim()
  const autoUpdateFlag = autoUpdate ? 1 : 0
  const serverName = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100)

  if (os === 'windows') {
    const params = ['install']
    if (proxy) params.push(`--install-ghproxy=${quotePowerShellArg(proxy)}`)
    if (agentVersion) params.push(`--install-version=${quotePowerShellArg(agentVersion)}`)
    params.push(
      `-secret=${quotePowerShellArg(apiSecret.value)}`,
      `-url='${HOST}/update'`,
      `-auto_update='${autoUpdateFlag}'`
    )
    if (serverName) params.push(`-name=${quotePowerShellArg(serverName)}`)
    const ua = installUserAgent()
    if (ua) params.push(`-ua=${quotePowerShellArg(ua)}`)
    const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.ps1')
    return `$script = "$env:TEMP\\install-cf-probe.ps1"; Invoke-WebRequest -Uri ${quotePowerShellArg(ghUrl)} -OutFile $script -UseBasicParsing; PowerShell -ExecutionPolicy Bypass -File $script ${params.join(' ')}`
  }

  const params = ['install']
  if (proxy) params.push(`--install-ghproxy=${quotePosixShellArg(proxy)}`)
  if (agentVersion) params.push(`--install-version=${quotePosixShellArg(agentVersion)}`)
  params.push(
    `-secret=${quotePosixShellArg(apiSecret.value)}`,
    `-url=${HOST}/update`,
    `-auto_update=${autoUpdateFlag}`
  )
  if (serverName) params.push(`-name=${quotePosixShellArg(serverName)}`)
  const ua = installUserAgent()
  if (ua) params.push(`-ua=${quotePosixShellArg(ua)}`)
  const ghUrl = buildGhRawUrl(proxy, '/huilang-me/cfsm-agent/main/install.sh')
  const installCommand = `curl -fsSL ${quotePosixShellArg(ghUrl)} | sh -s -- ${params.join(' ')}`
  if (os !== 'linux' || mode !== 'cfsm-user') return installCommand

  return buildInstallAsCfsmCommand(installCommand, trans.value.nonRootInstallRunStep)
}

const getAutoDiscoveryInstallCommand = () => buildAutoDiscoveryCommand({
  targetOs: autoDiscoveryTargetOs.value,
  installMode: autoDiscoveryInstallMode.value,
  ghProxy: autoDiscoveryGhProxy.value,
  name: autoDiscoveryName.value,
  version: autoDiscoveryVersion.value,
  autoUpdate: autoDiscoveryAutoUpdate.value
})

const openAutoDiscoveryModal = () => {
  if (!savedAutoDiscovery.value) {
    alertMessage.value = trans.value.autoAddDisabledTip
    return
  }

  autoDiscoveryCopied.value = false
  showAutoDiscoveryModal.value = true
}

const closeAutoDiscoveryModal = () => {
  showAutoDiscoveryModal.value = false
}

const copyAutoDiscoveryCmd = async () => {
  const copied = await copyTextToClipboard(getAutoDiscoveryInstallCommand())
  if (!copied) {
    alertMessage.value = trans.value.httpsRequired
    return
  }

  autoDiscoveryCopied.value = true
  setTimeout(() => {
    autoDiscoveryCopied.value = false
  }, 1500)
}

const copyCustomCmd = async () => {
  const cmd = getCustomInstallCommand()
  const copied = await copyTextToClipboard(cmd)
  if (!copied) {
    alertMessage.value = trans.value.httpsRequired
    return
  }

  copiedCmd.value = true
  setTimeout(() => {
    copiedCmd.value = false
  }, 1500)
}

const closeCopyModal = () => {
  showCopyModal.value = false
}

const openEditModalFromCopy = () => {
  const server = servers.value.find(s => s.id === copyServerId.value)
  if (server) {
    showCopyModal.value = false
    openEditModal(server)
  }
}

const copyUninstallCmd = async () => {
  const cmd = getUninstallCommand()
  const copied = await copyTextToClipboard(cmd)
  if (!copied) {
    alertMessage.value = trans.value.httpsRequired
    return
  }

  uninstallCopied.value = true
  setTimeout(() => {
    uninstallCopied.value = false
  }, 1500)
}

// 逐台月流量告警阈值：空/未设置 → null（跟随全局）；否则夹取 0..100 整数（0 = 该服务器显式关闭）
const normalizeTrafficAlertPercentField = (value) => {
  if (value === '' || value === null || value === undefined) return null
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

const createEditFormFromServer = (server) => ({
    id: server.id,
    name: server.name || '',
    server_group: server.server_group || '',
    region: server.region_override ?? (server.region || ''),
    tags: server.tags || '',
    note: server.note || '',
    price: normalizePrice(server.price),
    billing_cycle: normalizeBillingCycle(detectBillingCycle(server.price) || server.billing_cycle),
    auto_renewal: server.auto_renewal === '1' || server.auto_renewal === 1 || server.auto_renewal === true,
    currency: normalizeCurrency(server.currency || detectCurrencySymbol(server.price) || '¥'),
    expire_date: server.expire_date || '',
    traffic_limit: server.traffic_limit || '',
    traffic_calc_type: server.traffic_calc_type || 'total',
    traffic_alert_percent: server.traffic_alert_percent ?? '',
    interface: server.interface || '',
    reset_day: server.reset_day ?? 1,
    collect_interval: server.collect_interval ?? 0,
    report_interval: server.report_interval || 60,
    wss_report_interval: server.wss_report_interval || 2,
    connection_mode: getEffectiveConnectionMode(server.connection_mode),
    ping_mode: server.ping_mode === 'icmp' ? 'icmp' : 'tcp',
    custom_ct: server.custom_ct ?? '',
    custom_cu: server.custom_cu ?? '',
    custom_cm: server.custom_cm ?? '',
    custom_bd: server.custom_bd ?? '',
    node_1: server.node_1 ?? '', node_2: server.node_2 ?? '', node_3: server.node_3 ?? '', node_4: server.node_4 ?? '',
    rx_correction: server.rx_correction ?? '',
    tx_correction: server.tx_correction ?? '',
    auto_update: server.auto_update === '1' || server.auto_update === 1 || server.auto_update === true,
    is_hidden: server.is_hidden === '1',
    offline_notify_disabled: server.offline_notify_disabled === '1'
})

const openEditModal = (server) => {
  editForm.value = createEditFormFromServer(server)
  currentServerName.value = server.name || ''
  showEditModal.value = true
}

const closeEditModal = () => {
  if (editSaving.value) return
  cancelAutoUpdateWarning()
  showEditModal.value = false
}

const handleAutoUpdateToggle = (nextValue) => {
  if (!nextValue) {
    editForm.value.auto_update = false
    cancelAutoUpdateWarning()
    return
  }
  autoUpdateWarningSource.value = 'edit'
  autoUpdatePendingEnable.value = true
  showAutoUpdateWarning.value = true
}

const confirmAutoUpdateWarning = async () => {
  const source = autoUpdateWarningSource.value
  if (source === 'edit' && autoUpdatePendingEnable.value) {
    editForm.value.auto_update = true
  }
  autoUpdatePendingEnable.value = false
  showAutoUpdateWarning.value = false

  if (source === 'batch' && pendingBatchTasks.value.length > 0) {
    const tasks = pendingBatchTasks.value
    pendingBatchTasks.value = []
    await executeBatchEditTasks(tasks)
  }
}

const cancelAutoUpdateWarning = () => {
  autoUpdatePendingEnable.value = false
  pendingBatchTasks.value = []
  showAutoUpdateWarning.value = false
}

const validateServerFormFields = (form, checkFields = null) => {
  const shouldCheck = (field) => !checkFields || checkFields.has(field)

  if (shouldCheck('name')) {
    const nameCheck = validateServerNameInput(form.name)
    if (!nameCheck.valid) {
      return { valid: false, error: trans.value.invalidServerName }
    }
  }

  if (shouldCheck('price')) {
    const priceCheck = validatePriceInput(form.price)
    if (!priceCheck.valid) {
      return { valid: false, error: trans.value.invalidPrice }
    }
  }

  if (shouldCheck('traffic_limit')) {
    const limitCheck = validateTrafficLimitInput(form.traffic_limit)
    if (!limitCheck.valid) {
      return { valid: false, error: trans.value.invalidTrafficLimit }
    }
  }

  if (shouldCheck('traffic_alert_percent')) {
    const alertCheck = validateTrafficAlertPercentInput(form.traffic_alert_percent, { allowEmpty: true })
    if (!alertCheck.valid) {
      return { valid: false, error: trans.value.invalidTrafficAlertPercent }
    }
  }

  if (shouldCheck('rx_correction')) {
    const rxCheck = validateTrafficCorrectionInput(form.rx_correction)
    if (!rxCheck.valid) {
      return { valid: false, error: trans.value.invalidTrafficCorrection }
    }
  }

  if (shouldCheck('tx_correction')) {
    const txCheck = validateTrafficCorrectionInput(form.tx_correction)
    if (!txCheck.valid) {
      return { valid: false, error: trans.value.invalidTrafficCorrection }
    }
  }

  if (shouldCheck('interface')) {
    const ifaceCheck = validateNetworkInterfaceInput(form.interface)
    if (!ifaceCheck.valid) {
      return { valid: false, error: trans.value.invalidNetworkInterface }
    }
  }

  for (const field of PING_NODE_FIELDS) {
    if (!shouldCheck(field)) continue
    const result = validatePingNode(form[field])
    if (!result.valid) {
      return { valid: false, error: buildPingNodeError(field) }
    }
  }

  return { valid: true }
}

const buildEditPayloadFromForm = (form) => {
  const fieldValidation = validateServerFormFields(form)
  if (!fieldValidation.valid) {
    return { error: fieldValidation.error }
  }

  const pingNodeValidation = getPingNodeValidation(form)
  if (!pingNodeValidation.valid) {
    return { error: buildPingNodeError(pingNodeValidation.field) }
  }

  const nameCheck = validateServerNameInput(form.name)
  const priceCheck = validatePriceInput(form.price)
  const limitCheck = validateTrafficLimitInput(form.traffic_limit)
  const alertCheck = validateTrafficAlertPercentInput(form.traffic_alert_percent, { allowEmpty: true })
  const ifaceCheck = validateNetworkInterfaceInput(form.interface)
  const rxCheck = validateTrafficCorrectionInput(form.rx_correction)
  const txCheck = validateTrafficCorrectionInput(form.tx_correction)
  const normalizedBillingCycle = normalizeBillingCycle(form.billing_cycle)
  const normalizedAutoRenewal = form.auto_renewal ? '1' : '0'
  const normalizedPrice = priceCheck.value
  const normalizedCurrency = normalizeCurrency(form.currency || detectCurrencySymbol(form.price) || '¥')
  const normalizedExpireDate = renewExpireDateIfNeeded(
    form.expire_date,
    normalizedBillingCycle,
    normalizedAutoRenewal
  ).expire_date

  return {
    payload: {
      action: 'edit',
      id: form.id,
      name: nameCheck.value,
      server_group: form.server_group,
      region: form.region,
      tags: form.tags,
      note: form.note,
      price: normalizedPrice,
      billing_cycle: normalizedBillingCycle,
      auto_renewal: normalizedAutoRenewal,
      currency: normalizedCurrency,
      expire_date: normalizedExpireDate,
      traffic_limit: limitCheck.value,
      traffic_calc_type: form.traffic_calc_type,
      traffic_alert_percent: alertCheck.value,
      interface: ifaceCheck.value,
      reset_day: form.reset_day,
      collect_interval: form.collect_interval,
      report_interval: form.report_interval,
      wss_report_interval: form.wss_report_interval,
      connection_mode: getEffectiveConnectionMode(form.connection_mode),
      ping_mode: form.ping_mode === 'icmp' ? 'icmp' : 'tcp',
      custom_ct: pingNodeValidation.values.custom_ct,
      custom_cu: pingNodeValidation.values.custom_cu,
      custom_cm: pingNodeValidation.values.custom_cm,
      custom_bd: pingNodeValidation.values.custom_bd,
      node_1: pingNodeValidation.values.node_1, node_2: pingNodeValidation.values.node_2, node_3: pingNodeValidation.values.node_3, node_4: pingNodeValidation.values.node_4,
      rx_correction: rxCheck.value,
      tx_correction: txCheck.value,
      auto_update: form.auto_update ? '1' : '0',
      is_hidden: form.is_hidden ? '1' : '0',
      offline_notify_disabled: form.offline_notify_disabled ? '1' : '0'
    },
    normalized: {
      price: normalizedPrice,
      currency: normalizedCurrency,
      billing_cycle: normalizedBillingCycle,
      expire_date: normalizedExpireDate
    }
  }
}

const saveEdit = async () => {
  if (editSaving.value) return
  validationError.value = null

  const built = buildEditPayloadFromForm(editForm.value)
  if (built.error) {
    validationError.value = built.error
    return
  }

  editForm.value.price = built.normalized.price
  editForm.value.currency = built.normalized.currency
  editForm.value.billing_cycle = built.normalized.billing_cycle
  editForm.value.expire_date = built.normalized.expire_date

  editSaving.value = true
  try {
    const result = await adminApiForSite(built.payload)
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverEdited }
      cancelAutoUpdateWarning()
      showEditModal.value = false
      await loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  } finally {
    editSaving.value = false
  }
}

const openDeleteModal = (id) => {
  deleteServerId.value = id
  const server = servers.value.find(s => s.id === id)
  currentServerName.value = server?.name || ''
  deleteTargetOs.value = 'linux'
  deleteVersion.value = 'go'
  deleteInstallMode.value = 'current-user'
  deleteGhProxy.value = ''
  uninstallCopied.value = false
  showDeleteModal.value = true
}

const closeDeleteModal = () => {
  if (deletingServer.value) return
  showDeleteModal.value = false
}

const confirmDelete = async () => {
  if (deletingServer.value) return
  deletingServer.value = true
  try {
    const result = await adminApiForSite({ action: 'delete', id: deleteServerId.value })
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serverDeleted }
      showDeleteModal.value = false
      selectedServers.value = selectedServers.value.filter(id => String(id) !== String(deleteServerId.value))
      await loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    saveResult.value = { success: false, error: e.message }
  } finally {
    deletingServer.value = false
  }
}

const batchDelete = () => {
  if (deletingServer.value) return
  if (selectedServers.value.length === 0) {
    alertMessage.value = trans.value.selectServers
    return
  }
  showBatchDeleteConfirm.value = true
}

const cancelBatchDeleteConfirm = () => {
  if (deletingServer.value) return
  showBatchDeleteConfirm.value = false
}

const executeBatchDelete = async () => {
  if (deletingServer.value) return
  if (selectedServers.value.length === 0) {
    showBatchDeleteConfirm.value = false
    return
  }

  deletingServer.value = true
  try {
    const result = await adminApiForSite({ action: 'batch_delete', ids: selectedServers.value })
    showBatchDeleteConfirm.value = false
    if (!result.error) {
      saveResult.value = { success: true, message: getMessage(result.data.message) || trans.value.serversDeleted }
      selectedServers.value = []
      await loadServers()
    } else {
      saveResult.value = { success: false, error: getMessage(result.error) || 'Fail' }
    }
  } catch (e) {
    showBatchDeleteConfirm.value = false
    saveResult.value = { success: false, error: e.message }
  } finally {
    deletingServer.value = false
  }
}

const getSelectedServerRows = () => {
  const selected = new Set(selectedServers.value.map(id => String(id)))
  return servers.value.filter(server => selected.has(String(server.id)))
}

const getCommonBatchValue = (forms, field, fallback) => {
  if (forms.length === 0) return fallback
  const first = forms[0][field]
  return forms.every(form => form[field] === first) ? first : fallback
}

const openBatchEditModal = () => {
  const selected = getSelectedServerRows()
  if (selected.length === 0) {
    alertMessage.value = trans.value.selectServersToEdit || trans.value.selectServers
    return
  }

  const defaults = createBatchEditDefaults()
  const forms = selected.map(createEditFormFromServer)
  batchEditForm.value = Object.fromEntries(
    Object.keys(defaults).map(field => [field, getCommonBatchValue(forms, field, defaults[field])])
  )
  batchEditEnabled.value = Object.fromEntries(Object.keys(defaults).map(field => [field, false]))
  showBatchEditModal.value = true
}

const closeBatchEditModal = () => {
  if (batchEditing.value) return
  pendingBatchTasks.value = []
  showBatchEditModal.value = false
}

const executeBatchEditTasks = async (tasks) => {
  if (batchEditing.value || !Array.isArray(tasks) || tasks.length === 0) return

  validationError.value = null
  batchEditing.value = true

  const succeededIds = []
  const failedItems = []

  try {
    for (const task of tasks) {
      try {
        const result = await adminApiForSite(task.payload)
        if (result.error) {
          failedItems.push({
            id: task.id,
            name: task.name,
            error: getMessage(result.error) || result.error || trans.value.operationFailed
          })
        } else {
          succeededIds.push(task.id)
        }
      } catch (e) {
        failedItems.push({
          id: task.id,
          name: task.name,
          error: e?.message || trans.value.operationFailed
        })
      }
    }

    if (succeededIds.length > 0) {
      await loadServers()
    }

    if (failedItems.length === 0) {
      selectedServers.value = []
      showBatchEditModal.value = false
      saveResult.value = {
        success: true,
        message: (trans.value.batchEditSuccess || 'Batch edit completed').replace('{count}', String(succeededIds.length))
      }
    } else {
      selectedServers.value = failedItems.map(item => item.id)
      const summary = (trans.value.batchEditPartialFailed || 'Succeeded: {success}, Failed: {failed}')
        .replace('{success}', String(succeededIds.length))
        .replace('{failed}', String(failedItems.length))
      const detail = failedItems.slice(0, 5).map(item => `${item.name}: ${item.error}`).join('; ')
      saveResult.value = {
        success: false,
        error: detail ? `${summary} (${detail})` : summary
      }
    }
  } finally {
    batchEditing.value = false
  }
}

const saveBatchEdit = async () => {
  if (batchEditing.value) return

  const enabledFields = Object.keys(batchEditEnabled.value).filter(field => batchEditEnabled.value[field])
  if (enabledFields.length === 0) {
    alertMessage.value = trans.value.noBatchEditFields || 'Please select fields to update'
    return
  }

  const selected = getSelectedServerRows()
  if (selected.length === 0) {
    alertMessage.value = trans.value.selectServersToEdit || trans.value.selectServers
    return
  }

  validationError.value = null
  const enabledValidation = validateServerFormFields(batchEditForm.value, new Set(enabledFields))
  if (!enabledValidation.valid) {
    validationError.value = enabledValidation.error
    return
  }

  // 第一阶段：在内存中遍历全部选中服务器生成并校验所有 payload（任一非法立即中止，零网络请求）
  const tasks = []
  for (const server of selected) {
    const form = createEditFormFromServer(server)
    for (const field of enabledFields) {
      form[field] = batchEditForm.value[field]
    }
    const built = buildEditPayloadFromForm(form)
    if (built.error) {
      const label = server.name || server.id
      validationError.value = `${label}: ${built.error}`
      return
    }
    tasks.push({
      id: server.id,
      name: server.name || server.id,
      payload: built.payload
    })
  }

  if (batchEditEnabled.value.auto_update && batchEditForm.value.auto_update) {
    pendingBatchTasks.value = tasks
    autoUpdateWarningSource.value = 'batch'
    showAutoUpdateWarning.value = true
    return
  }

  // 第二阶段：执行请求并汇总成功/失败项
  await executeBatchEditTasks(tasks)
}

const handleSelectAll = (e) => {
  const checked = e.target.checked
  selectedServers.value = checked ? servers.value.map(s => s.id) : []
}

const toggleSelectAll = () => {
  if (selectedServers.value.length === servers.value.length) {
    selectedServers.value = []
  } else {
    selectedServers.value = servers.value.map(s => s.id)
  }
}

const toggleServer = (id) => {
  const index = selectedServers.value.indexOf(id)
  if (index === -1) {
    selectedServers.value.push(id)
  } else {
    selectedServers.value.splice(index, 1)
  }
}

let draggedRow = null

const handleDragStart = (e, serverId = null) => {
  const row = e?.target?.closest?.('.server-row')
  draggedRow = String(serverId || row?.dataset?.serverId || '')
  if (e?.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

const handleDrop = async (e, targetId) => {
  e?.preventDefault?.()
  targetId = String(targetId || '')
  if (!draggedRow || draggedRow === targetId) {
    draggedRow = null
    return
  }

  const rows = Array.from(document.querySelectorAll('#tab-servers .table-wrapper .terminal-table tbody > .server-row[data-server-id]'))
  const draggedIndex = rows.findIndex(r => r.dataset.serverId === draggedRow)
  const targetIndex = rows.findIndex(r => r.dataset.serverId === targetId)
  if (draggedIndex < 0 || targetIndex < 0) {
    draggedRow = null
    return
  }

  const orders = rows.map(r => r.dataset.serverId)
  const [dragged] = orders.splice(draggedIndex, 1)
  orders.splice(targetIndex, 0, dragged)

  try {
    const result = await adminApiForSite({ action: 'save_order', orders })
    if (!result.error) {
      await loadServers()
    } else {
      alertMessage.value = getMessage(result.error) || result.error || trans.value.operationFailed
      await loadServers()
    }
  } catch (e) {
    console.error('[ERROR] Save order failed:', e)
    alertMessage.value = e?.message || trans.value.operationFailed
    await loadServers()
  } finally {
    draggedRow = null
  }
}

const uploadImageSetting = (e, field) => {
  const input = e?.target
  const file = input?.files?.[0]
  if (!file) return
  if (file.size > 800 * 1024) {
    alertMessage.value = trans.value.imageSizeWarning
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = function(event) {
    settings.value[field] = event.target.result
    input.value = ''
  }
  reader.onerror = function() {
    input.value = ''
  }
  reader.readAsDataURL(file)
}

const uploadBg = (e) => uploadImageSetting(e, 'custom_bg')

const uploadBgMobile = (e) => uploadImageSetting(e, 'custom_bg_mobile')

const uploadFavicon = (e) => uploadImageSetting(e, 'favicon')

const handleUpgradeDatabase = async () => {
  dbOperation.value = 'upgrade'
  dbLoading.value = true
  dbResult.value = null

  try {
    const result = await upgradeDatabase(selectedApiIndex.value)
    dbResult.value = result
  } catch (e) {
    dbResult.value = { success: false, error: e.message }
  } finally {
    dbLoading.value = false
  }
}

const handleClearHistory = async () => {
  dbOperation.value = 'clearHistory'
  dbLoading.value = true
  dbResult.value = null

  try {
    const result = await clearHistory(selectedApiIndex.value)
    dbResult.value = result
  } catch (e) {
    dbResult.value = { success: false, error: e.message }
  } finally {
    dbLoading.value = false
  }
}

const openDbModal = (operation) => {
  dbOperation.value = operation
  dbResult.value = null
  showDbModal.value = true
}

const closeDbModal = () => {
  if (!dbLoading.value) {
    showDbModal.value = false
  }
}

const queryD1Usage = async () => {
  if (d1UsageLoading.value) return
  d1UsageLoading.value = true
  d1UsageResult.value = null
  alertMessage.value = null

  try {
    const result = await adminApiForSite({
      action: 'd1_usage',
      cloudflare_account_id: settings.value.cloudflare_account_id,
      cloudflare_token: settings.value.cloudflare_token
    })
    if (!result.error) {
      d1UsageResult.value = result.data
    } else {
      alertMessage.value = getMessage(result.error) || result.error || trans.value.operationFailed
    }
  } catch (e) {
    alertMessage.value = getMessage(e.message) || e.message || trans.value.operationFailed
  } finally {
    d1UsageLoading.value = false
  }
}

const sendTestNotification = async () => {
  if (testNotificationLoading.value) return
  if (settingsPanelRef.value && !settingsPanelRef.value.validateSmtpFields()) {
    return
  }
  testNotificationLoading.value = true
  try {
    const result = await adminApiForSite({
      action: 'send_test_notification',
      tg_bot_token: settings.value.tg_bot_token,
      tg_chat_id: settings.value.tg_chat_id,
      notification_webhook_enabled: settings.value.notification_webhook_enabled ? 'true' : 'false',
      notification_webhook_url: settings.value.notification_webhook_url,
      notification_webhook_method: settings.value.notification_webhook_method,
      notification_webhook_format: settings.value.notification_webhook_format,
      notification_webhook_headers: settings.value.notification_webhook_headers,
      notification_webhook_body: settings.value.notification_webhook_body,
      notification_template: settings.value.notification_template,
      notification_timezone: normalizeNotificationTimezoneSetting(settings.value.notification_timezone),
      notification_language: normalizeNotificationLanguageSetting(settings.value.notification_language),
      expire_notification_time: normalizeExpireNotificationTimeSetting(settings.value.expire_notification_time)
    })
    if (!result.error) {
      alertMessage.value = getMessage(result.data.message) || trans.value.testNotificationSent
    } else {
      alertMessage.value = getMessage(result.error) || trans.value.testNotificationFailed
    }
  } catch (e) {
    alertMessage.value = trans.value.testNotificationFailed + ': ' + e.message
  } finally {
    testNotificationLoading.value = false
  }
}

watch(() => route.query.apiIndex, async (value) => {
  const nextIndex = normalizeApiIndex(value)
  if (nextIndex === selectedApiIndex.value) return

  selectedApiIndex.value = nextIndex

  if (isLoggedIn.value) {
    await switchAdminSite()
  } else {
    await loadTurnstileConfig()
  }
})

useModal(showAutoUpdateWarning, cancelAutoUpdateWarning)
useModal(showBatchDeleteConfirm, cancelBatchDeleteConfirm, { canClose: () => !deletingServer.value })
useModal(showDbModal, closeDbModal, { canClose: () => !dbLoading.value })
useModal(() => Boolean(d1UsageResult.value), () => { d1UsageResult.value = null })
useModal(() => Boolean(validationError.value), () => { validationError.value = null })
useModal(() => Boolean(saveResult.value), () => { saveResult.value = null })
useModal(() => Boolean(alertMessage.value), () => { alertMessage.value = null })

onMounted(() => {
  initAdmin()
})
</script>
