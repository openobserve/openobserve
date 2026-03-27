<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="full-width q-mx-lg q-pt-xs">

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- ANOMALY MODE: Keep original stepper layout                        -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <template v-if="isAnomalyMode">
      <div
        class="row items-center no-wrap card-container tw:mx-[0.625rem] tw:mb-[0.625rem]"
      >
        <div
          class="flex items-center justify-between tw:w-full card-container tw:h-[68px] tw:px-2 tw:py-3"
        >
          <div class="flex items-center">
            <div
              data-test="add-alert-back-btn"
              class="flex justify-center items-center q-mr-md cursor-pointer"
              style="border: 1.5px solid; border-radius: 50%; width: 22px; height: 22px;"
              title="Go Back"
              @click="router.back()"
            >
              <q-icon name="arrow_back_ios_new" size="14px" />
            </div>
            <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2" data-test="add-alert-title">
              <template v-if="anomalyEditMode">
                <span class="text-h6">{{ t("alerts.updateAnomalyDetection") }}</span>
                <span
                  :class="['text-subtitle2 tw:font-medium tw:px-2 tw:py-1 tw:rounded-md tw:max-w-xs tw:truncate tw:inline-block',
                    store.state.theme === 'dark' ? 'tw:text-blue-400 tw:bg-blue-900/50' : 'tw:text-blue-600 tw:bg-blue-50']"
                >
                  {{ anomalyConfig.name }}
                  <q-tooltip v-if="anomalyConfig.name?.length > 25" class="tw:text-sm">{{ anomalyConfig.name }}</q-tooltip>
                </span>
                <q-badge v-if="anomalyConfig.status" :color="anomalyStatusColor" :label="anomalyConfig.status" class="text-caption" />
                <span
                  v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                  class="text-caption"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  Last run: {{ anomalyFormatTs(anomalyConfig.last_detection_run) }}
                </span>
                <q-btn v-if="anomalyConfig.status === 'failed'" flat no-caps dense size="sm" color="negative" icon="replay" label="Retry Training" :loading="anomalyRetraining" @click="anomalyTriggerRetrain" />
                <span v-if="anomalyConfig.status === 'failed' && anomalyConfig.last_error" class="text-caption text-negative tw:max-w-xs tw:truncate tw:inline-block tw:cursor-default">
                  {{ anomalyConfig.last_error }}
                  <q-tooltip class="tw:text-sm" max-width="400px">{{ anomalyConfig.last_error }}</q-tooltip>
                </span>
              </template>
              <template v-else>
                <span class="text-h6">{{ t("alerts.newAnomalyDetection") }}</span>
              </template>
            </div>
          </div>
          <div class="flex items-center tw:gap-2">
            <q-btn outline class="pipeline-icons q-px-sm hideOnPrintMode" size="sm" no-caps icon="code" data-test="pipeline-json-edit-btn" @click="openJsonEditor">
              <q-tooltip>{{ t("alerts.editJson") }}</q-tooltip>
            </q-btn>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- STANDARD ALERTS: V3 "Single Pane of Glass" Layout                 -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="tw:flex tw:flex-col" style="height: calc(100vh - 50px);">
      <!-- TIER 1: Top Bar -->
      <div class="alert-v3-topbar card-container tw:mx-[0.625rem] tw:mb-2 tw:shrink-0">
        <div class="tw:flex tw:items-end tw:gap-3 tw:px-2 tw:py-2">

          <!-- Alert Name -->
          <div class="alert-v3-field-group" style="flex: 1 1 auto; min-width: 150px;">
            <label class="alert-v3-label">Alert Name <span class="tw:text-red-500">*</span></label>
            <q-input
              ref="step1Ref"
              data-test="add-alert-name-input"
              v-model="formData.name"
              dense
              borderless
              :readonly="beingUpdated"
              :disable="beingUpdated"
              hide-bottom-space
              class="alert-v3-field"
            />
          </div>

          <!-- Scheduled / Real-Time toggle -->
          <div class="alert-v3-field-group tw:shrink-0">
            <label class="alert-v3-label">{{ t("alerts.scheduled") }} / {{ t("alerts.realTime") }}</label>
            <q-btn-toggle
              v-model="formData.is_real_time"
              no-caps
              dense
              unelevated
              toggle-color="primary"
              :disable="beingUpdated"
              class="alert-v3-toggle"
              :options="[
                { label: t('alerts.scheduled'), value: 'false' },
                { label: t('alerts.realTime'), value: 'true' },
              ]"
            />
          </div>

          <!-- Stream Type -->
          <div class="alert-v3-field-group tw:shrink-0">
            <label class="alert-v3-label">{{ t("alerts.streamType") }} <span class="tw:text-red-500">*</span></label>
            <q-select
              data-test="add-alert-stream-type-select-dropdown"
              v-model="formData.stream_type"
              :options="streamTypes"
              :popup-content-style="{ textTransform: 'lowercase' }"
              class="no-case alert-v3-field"
              dense
              borderless
              use-input
              fill-input
              hide-selected
              hide-bottom-space
              :input-debounce="200"
              :readonly="beingUpdated"
              :disable="beingUpdated"
              @filter="(val, update) => update(() => {})"
              @update:model-value="updateStreams()"
              behavior="menu"
              style="width: 200px;"
            />
          </div>

          <!-- Stream Name -->
          <div class="alert-v3-field-group tw:shrink-0">
            <label class="alert-v3-label">{{ t("alerts.stream_name") }} <span class="tw:text-red-500">*</span></label>
            <q-select
              data-test="add-alert-stream-name-select-dropdown"
              v-model="formData.stream_name"
              :options="filteredStreams"
              :loading="isFetchingStreams"
              color="input-border"
              class="no-case alert-v3-field"
              dense
              borderless
              use-input
              hide-selected
              hide-bottom-space
              fill-input
              :input-debounce="400"
              :readonly="beingUpdated"
              :disable="beingUpdated"
              @filter="filterStreams"
              @update:model-value="updateStreamFields"
              behavior="menu"
              style="width: 200px;"
            />
          </div>

          <!-- Folder -->
          <div class="alert-v3-field-group tw:shrink-0" style="width: 200px;">
            <label class="alert-v3-label">Folder</label>
            <div class="tw:flex tw:items-center tw:gap-1">
              <div class="alert-v3-folder tw:flex-1">
                <SelectFolderDropDown
                  ref="folderDropdownRef"
                  :disableDropdown="beingUpdated"
                  type="alerts"
                  @folder-selected="updateActiveFolderId"
                  :activeFolderId="activeFolderId"
                />
              </div>
              <q-btn
                dense flat no-caps
                :disable="beingUpdated"
                class="alert-v3-add-folder-btn o2-secondary-button"
                @click="$refs.folderDropdownRef && ($refs.folderDropdownRef.showAddFolderDialog = true)"
              >
                <q-icon name="add" size="xs" />
              </q-btn>
            </div>
          </div>

        </div>
      </div>

      <!-- Main content: Splitter with Config (left) and Preview & Summary (right) -->
      <q-splitter
        v-model="splitterModel"
        :limits="[40, 100]"
        class="alert-v3-splitter tw:mx-[0.625rem]"
        style="flex: 1; min-height: 0;"
        @update:model-value="onSplitterUpdate"
      >
        <!-- LEFT: Configuration Tabs + Footer -->
        <template #before>
          <div class="tw:flex tw:flex-col tw:h-full">
            <!-- Tab Headers -->
            <div class="alert-v3-tabs card-container" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
              <div class="tw:flex tw:border-b tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'">
                <div
                  v-for="tab in [
                    { key: 'condition', label: t('alerts.steps.conditions'), required: true },
                    { key: 'rules', label: t('alerts.steps.alertSettings'), required: true },
                    { key: 'compare', label: t('alerts.steps.compareWithPast'), show: formData.is_real_time === 'false' },
                    { key: 'dedup', label: t('alerts.steps.deduplication'), show: formData.is_real_time === 'false' },
                    { key: 'advanced', label: t('alerts.steps.advanced') },
                  ].filter(t => t.show !== false)"
                  :key="tab.key"
                  class="tw:px-4 tw:py-2.5 tw:cursor-pointer tw:text-sm tw:font-medium tw:relative tw:select-none tw:transition-colors"
                  :class="[
                    activeTab === tab.key
                      ? (store.state.theme === 'dark' ? 'tw:text-blue-400 tw:border-b-2 tw:border-blue-400' : 'tw:text-blue-600 tw:border-b-2 tw:border-blue-600')
                      : (store.state.theme === 'dark' ? 'tw:text-gray-400 hover:tw:text-gray-200' : 'tw:text-gray-500 hover:tw:text-gray-800'),
                  ]"
                  @click="activeTab = tab.key"
                >
                  {{ tab.label }}{{ tab.required ? ' *' : '' }}
                  <span
                    v-if="tabErrors[tab.key]"
                    class="tw:absolute tw:top-1.5 tw:right-1 tw:w-2 tw:h-2 tw:rounded-full tw:bg-red-500"
                  />
                </div>
              </div>

              <!-- Tab Content -->
              <q-form ref="addAlertForm" class="tw:flex-1 tw:overflow-auto" @submit="onSubmit">
                <!-- Condition Tab -->
                <div v-show="activeTab === 'condition'" class="tw:p-3">
                  <QueryConfig
                    ref="step2Ref"
                    :tab="formData.query_condition.type || 'custom'"
                    :multiTimeRange="formData.query_condition.multi_time_range"
                    :columns="filteredColumns"
                    :streamFieldsMap="streamFieldsMap"
                    :generatedSqlQuery="generatedSqlQuery"
                    :inputData="formData.query_condition"
                    :streamType="formData.stream_type"
                    :isRealTime="formData.is_real_time"
                    :sqlQuery="formData.query_condition.sql"
                    :promqlQuery="formData.query_condition.promql"
                    :vrlFunction="decodedVrlFunction"
                    :streamName="formData.stream_name"
                    :sqlQueryErrorMsg="sqlQueryErrorMsg"
                    :isAggregationEnabled="isAggregationEnabled"
                    :promqlCondition="formData.query_condition.promql_condition"
                    @update:tab="updateTab"
                    @update-group="updateGroup"
                    @remove-group="removeConditionGroup"
                    @input:update="onInputUpdate"
                    @update:sqlQuery="(value) => (formData.query_condition.sql = value)"
                    @update:promqlQuery="(value) => (formData.query_condition.promql = value)"
                    @update:vrlFunction="(value) => (formData.query_condition.vrl_function = value)"
                    @validate-sql="validateSqlQuery"
                    @clear-multi-windows="clearMultiWindows"
                    @editor-closed="handleEditorClosed"
                    @editor-state-changed="handleEditorStateChanged"
                    @update:isAggregationEnabled="(value) => (isAggregationEnabled = value)"
                    @update:aggregation="(value) => (formData.query_condition.aggregation = value)"
                    @update:promqlCondition="(val) => (formData.query_condition.promql_condition = val)"
                  />
                </div>

                <!-- Rules & Routing Tab -->
                <div v-show="activeTab === 'rules'" class="tw:p-3">
                  <AlertSettings
                    ref="step4Ref"
                    :formData="formData"
                    :isRealTime="formData.is_real_time"
                    :columns="filteredColumns"
                    :isAggregationEnabled="isAggregationEnabled"
                    :destinations="formData.destinations"
                    :formattedDestinations="getFormattedDestinations"
                    :template="formData.template"
                    :templates="templates"
                    @update:trigger="(val) => (formData.trigger_condition = val)"
                    @update:aggregation="(val) => (formData.query_condition.aggregation = val)"
                    @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
                    @update:promqlCondition="(val) => (formData.query_condition.promql_condition = val)"
                    @update:destinations="updateDestinations"
                    @update:template="(val) => (formData.template = val)"
                    @refresh:destinations="refreshDestinations"
                    @refresh:templates="refreshTemplates"
                  />
                </div>

                <!-- Compare with Past Tab (Scheduled only) -->
                <div v-show="activeTab === 'compare'" class="tw:p-3">
                  <CompareWithPast
                    ref="step3Ref"
                    :multiTimeRange="formData.query_condition.multi_time_range"
                    :period="formData.trigger_condition.period"
                    :frequency="formData.trigger_condition.frequency"
                    :frequencyType="formData.trigger_condition.frequency_type"
                    :cron="formData.trigger_condition.cron"
                    :selectedTab="formData.query_condition.type || 'custom'"
                    @update:multiTimeRange="(val) => (formData.query_condition.multi_time_range = val)"
                    @goToSqlEditor="handleGoToSqlEditor"
                  />
                </div>

                <!-- Deduplication Tab (Scheduled only) -->
                <div v-show="activeTab === 'dedup'" class="tw:p-3">
                  <Deduplication
                    :deduplication="formData.deduplication"
                    :columns="filteredColumns"
                    @update:deduplication="(val) => (formData.deduplication = val)"
                  />
                </div>

                <!-- Advanced Tab -->
                <div v-show="activeTab === 'advanced'" class="tw:p-3">
                  <Advanced
                    :contextAttributes="formData.context_attributes"
                    :description="formData.description"
                    :rowTemplate="formData.row_template"
                    :rowTemplateType="formData.row_template_type"
                    @update:contextAttributes="(val) => (formData.context_attributes = val)"
                    @update:description="(val) => (formData.description = val)"
                    @update:rowTemplate="(val) => (formData.row_template = val)"
                    @update:rowTemplateType="(val) => (formData.row_template_type = val)"
                  />
                </div>
              </q-form>
            </div>

            <!-- Footer: Cancel / Save -->
            <div
              class="flex q-px-md tw:py-3 card-container tw:justify-end tw:mt-2 tw:shrink-0"
              style="position: sticky; bottom: 0px; z-index: 2"
            >
              <div class="tw:flex tw:items-center tw:gap-2 tw:mx-2">
                <q-btn
                  data-test="add-alert-cancel-btn"
                  class="o2-secondary-button tw:h-[36px]"
                  :label="t('alerts.cancel')"
                  no-caps
                  flat
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-secondary-button-dark'
                      : 'o2-secondary-button-light'
                  "
                  @click="$emit('cancel:hideform')"
                />
                <q-btn
                  data-test="add-alert-submit-btn"
                  class="o2-primary-button no-border tw:h-[36px]"
                  :label="t('alerts.save')"
                  no-caps
                  flat
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-primary-button-dark'
                      : 'o2-primary-button-light'
                  "
                  @click="handleSave"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Separator: Collapse/Expand button -->
        <template #separator>
          <q-btn
            :icon="rightPanelCollapsed ? 'chevron_left' : 'chevron_right'"
            :title="rightPanelCollapsed ? 'Show Preview & Summary' : 'Hide Preview & Summary'"
            :class="rightPanelCollapsed ? 'alert-v3-splitter-btn-collapsed' : 'alert-v3-splitter-btn-expanded'"
            color="primary"
            size="sm"
            dense
            round
            @click="toggleRightPanel"
          />
        </template>

        <!-- RIGHT: Preview & Summary -->
        <template #after>
          <div v-show="!rightPanelCollapsed" class="tw:flex tw:flex-col tw:h-full tw:pl-1">
            <!-- Preview -->
            <div class="alert-v3-chart card-container tw:mb-2" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
              <div
                class="tw:flex tw:items-center tw:px-3 tw:h-[36px] tw:shrink-0 tw:border-b"
                :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
              >
                <span class="tw:text-sm tw:font-medium">{{ t("alerts.preview") || "Preview" }}</span>
              </div>
              <div style="flex: 1; min-height: 0;">
                <preview-alert
                  ref="previewAlertRef"
                  style="height: 100%;"
                  :formData="formData"
                  :query="previewQuery"
                  :selectedTab="formData.query_condition.type || 'custom'"
                  :isAggregationEnabled="isAggregationEnabled"
                  :isUsingBackendSql="isUsingBackendSql"
                  :isEditorOpen="isEditorOpen"
                />
              </div>
            </div>

            <!-- Summary -->
            <div class="card-container" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
              <div
                class="tw:flex tw:items-center tw:px-3 tw:h-[36px] tw:shrink-0 tw:border-b"
                :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
              >
                <span class="tw:text-sm tw:font-medium">Summary</span>
              </div>
              <div style="flex: 1; min-height: 0; overflow: auto;">
                <alert-summary
                  style="height: 100%;"
                  :formData="formData"
                  :destinations="destinations"
                  :previewQuery="previewQuery"
                  :generatedSqlQuery="generatedSqlQuery"
                />
              </div>
            </div>
          </div>
        </template>
      </q-splitter>
      </div><!-- end flex column wrapper -->
    </template>

    <!-- WIZARD VIEW (Anomaly mode only) -->
    <div
      v-if="isAnomalyMode"
      class="wizard-view-container tw:mb-2"
      style="
        max-height: calc(100vh - 194px);
        overflow-y: auto;
        scroll-behavior: smooth;
      "
    >
      <div
        class="card-container tw:px-2 tw:mx-[0.675rem] tw:py-2"
        style="position: relative"
      >
        <!-- Stepper Header (Full Width) -->
        <q-form class="add-alert-form" ref="addAlertForm"
@submit="onSubmit">
          <q-stepper
            v-model="wizardStep"
            ref="wizardStepper"
            color="primary"
            flat
            class="alert-wizard-stepper"
            header-nav
            keep-alive
          >
            <!-- Persistent Step Caption (Between Header and Content) -->
            <template v-slot:message>
              <div
                v-if="currentStepCaption"
                class="persistent-step-caption tw:px-3 tw:py-1 tw:mb-1 tw:mt-2"
                :class="
                  store.state.theme === 'dark'
                    ? 'dark-mode-caption'
                    : 'light-mode-caption'
                "
              >
                {{ currentStepCaption }}
              </div>
            </template>

            <!-- Step 1: Alert Setup -->
            <q-step
              :name="1"
              :title="t('alerts.steps.alertSetup') + ' *'"
              caption=""
              icon="settings"
              :done="wizardStep > 1"
              :disable="1 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <AlertSetup
                      ref="step1Ref"
                      :formData="formData"
                      :beingUpdated="beingUpdated || anomalyEditMode"
                      :streamTypes="streamTypes"
                      :filteredStreams="filteredStreams"
                      :isFetchingStreams="isFetchingStreams"
                      :activeFolderId="
                        Array.isArray(activeFolderId)
                          ? activeFolderId[0]
                          : activeFolderId
                      "
                      :streamFieldRef="streamFieldRef"
                      :streamTypeFieldRef="streamTypeFieldRef"
                      @update:streams="updateStreams()"
                      @filter:streams="filterStreams"
                      @update:stream-name="updateStreamFields"
                      @update:active-folder-id="updateActiveFolderId"
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 2: Query Configuration (Scheduled / Real-Time alerts only) -->
            <q-step
              v-if="!isAnomalyMode"
              :name="2"
              :title="t('alerts.steps.conditions') + ' *'"
              caption=""
              icon="search"
              :done="wizardStep > 2"
              :disable="2 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <QueryConfig
                      ref="step2Ref"
                      :tab="formData.query_condition.type || 'custom'"
                      :multiTimeRange="
                        formData.query_condition.multi_time_range
                      "
                      :columns="filteredColumns"
                      :streamFieldsMap="streamFieldsMap"
                      :generatedSqlQuery="generatedSqlQuery"
                      :inputData="formData.query_condition"
                      :streamType="formData.stream_type"
                      :isRealTime="formData.is_real_time"
                      :sqlQuery="formData.query_condition.sql"
                      :promqlQuery="formData.query_condition.promql"
                      :vrlFunction="decodedVrlFunction"
                      :streamName="formData.stream_name"
                      :sqlQueryErrorMsg="sqlQueryErrorMsg"
                      :isAggregationEnabled="isAggregationEnabled"
                      :promqlCondition="
                        formData.query_condition.promql_condition
                      "
                      @update:tab="updateTab"
                      @update-group="updateGroup"
                      @remove-group="removeConditionGroup"
                      @input:update="onInputUpdate"
                      @update:sqlQuery="
                        (value) => (formData.query_condition.sql = value)
                      "
                      @update:promqlQuery="
                        (value) => (formData.query_condition.promql = value)
                      "
                      @update:vrlFunction="
                        (value) =>
                          (formData.query_condition.vrl_function = value)
                      "
                      @validate-sql="validateSqlQuery"
                      @clear-multi-windows="clearMultiWindows"
                      @editor-closed="handleEditorClosed"
                      @editor-state-changed="handleEditorStateChanged"
                      @update:isAggregationEnabled="
                        (value) => (isAggregationEnabled = value)
                      "
                      @update:aggregation="
                        (value) =>
                          (formData.query_condition.aggregation = value)
                      "
                      @update:promqlCondition="
                        (val) =>
                          (formData.query_condition.promql_condition = val)
                      "
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 3: Compare with Past (Scheduled only) -->
            <q-step
              v-if="formData.is_real_time === 'false'"
              :name="3"
              :title="t('alerts.steps.compareWithPast')"
              caption=""
              icon="compare_arrows"
              :done="wizardStep > 3"
              :disable="3 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <CompareWithPast
                      ref="step3Ref"
                      :multiTimeRange="
                        formData.query_condition.multi_time_range
                      "
                      :period="formData.trigger_condition.period"
                      :frequency="formData.trigger_condition.frequency"
                      :frequencyType="formData.trigger_condition.frequency_type"
                      :cron="formData.trigger_condition.cron"
                      :selectedTab="formData.query_condition.type || 'custom'"
                      @update:multiTimeRange="
                        (val) =>
                          (formData.query_condition.multi_time_range = val)
                      "
                      @goToSqlEditor="handleGoToSqlEditor"
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 4: Alert Settings (Scheduled / Real-Time alerts only) -->
            <q-step
              v-if="!isAnomalyMode"
              :name="4"
              :title="t('alerts.steps.alertSettings') + ' *'"
              caption=""
              icon="tune"
              :done="wizardStep > 4"
              :disable="4 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <AlertSettings
                      ref="step4Ref"
                      :formData="formData"
                      :isRealTime="formData.is_real_time"
                      :columns="filteredColumns"
                      :isAggregationEnabled="isAggregationEnabled"
                      :destinations="formData.destinations"
                      :formattedDestinations="getFormattedDestinations"
                      :template="formData.template"
                      :templates="templates"
                      @update:trigger="
                        (val) => (formData.trigger_condition = val)
                      "
                      @update:aggregation="
                        (val) => (formData.query_condition.aggregation = val)
                      "
                      @update:isAggregationEnabled="
                        (val) => (isAggregationEnabled = val)
                      "
                      @update:promqlCondition="
                        (val) =>
                          (formData.query_condition.promql_condition = val)
                      "
                      @update:destinations="updateDestinations"
                      @update:template="(val) => (formData.template = val)"
                      @refresh:destinations="refreshDestinations"
                      @refresh:templates="refreshTemplates"
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 5: Deduplication (Scheduled only) -->
            <q-step
              v-if="formData.is_real_time === 'false'"
              :name="5"
              :title="t('alerts.steps.deduplication')"
              caption=""
              icon="filter_list"
              :done="wizardStep > 5"
              :disable="5 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <Deduplication
                      :deduplication="formData.deduplication"
                      :columns="filteredColumns"
                      @update:deduplication="
                        (val) => (formData.deduplication = val)
                      "
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 6: Advanced Settings (Scheduled / Real-Time alerts only) -->
            <q-step
              v-if="!isAnomalyMode"
              :name="6"
              :title="t('alerts.steps.advanced')"
              caption=""
              icon="settings_applications"
              :done="false"
              :disable="6 > lastValidStep"
            >
              <!-- Wrapper with flex container -->
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <!-- Left Column Only: Step Content (60%) -->
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <Advanced
                      :contextAttributes="formData.context_attributes"
                      :description="formData.description"
                      :rowTemplate="formData.row_template"
                      :rowTemplateType="formData.row_template_type"
                      @update:contextAttributes="
                        (val) => (formData.context_attributes = val)
                      "
                      @update:description="
                        (val) => (formData.description = val)
                      "
                      @update:rowTemplate="
                        (val) => (formData.row_template = val)
                      "
                      @update:rowTemplateType="
                        (val) => (formData.row_template_type = val)
                      "
                    />
                  </div>
                </div>
                <!-- Right column space (40%) - empty but reserves space -->
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>
            <!-- Step 2: Anomaly Detection Config -->
            <q-step
              v-if="isAnomalyMode"
              :name="2"
              :title="t('alerts.anomalyDetectionConfig') + ' *'"
              caption=""
              icon="manage_search"
              :done="wizardStep > 2"
              :disable="2 > lastValidStep"
            >
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <AnomalyDetectionConfig
                      ref="anomalyStep2Ref"
                      :config="anomalyConfig"
                    />
                  </div>
                </div>
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>

            <!-- Step 3: Anomaly Alerting -->
            <q-step
              v-if="isAnomalyMode"
              :name="3"
              :title="t('alerts.alerting') + (anomalyConfig.alert_enabled ? ' *' : '')"
              caption=""
              icon="notifications"
              :done="false"
              :disable="3 > lastValidStep"
            >
              <div
                style="
                  display: flex;
                  gap: 0.625rem;
                  height: calc(100vh - 302px);
                "
              >
                <div
                  style="
                    flex: 0 0 62%;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                  "
                >
                  <div style="flex: 1; overflow: auto">
                    <AnomalyAlerting
                      :config="anomalyConfig"
                      :destinations="destinations"
                      @refresh:destinations="$emit('refresh:destinations')"
                    />
                  </div>
                </div>
                <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
              </div>
            </q-step>
          </q-stepper>

          <!-- Persistent Right Column (Outside Stepper) -->
          <div>
            <!-- Standard alert right column -->
            <div
              v-if="!isAnomalyMode"
              class="alert-wizard-right-column-persistent"
              style="
                position: absolute;
                top: 86px;
                right: 4px;
                width: calc(39% - 1.5rem);
                height: calc(100vh - 302px);
                pointer-events: auto;
                z-index: 10;
              "
            >
              <AlertWizardRightColumn
                ref="previewAlertRef"
                :formData="formData"
                :previewQuery="previewQuery"
                :generatedSqlQuery="generatedSqlQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :destinations="formData.destinations"
                :focusManager="focusManager"
                :wizardStep="wizardStep"
                :isUsingBackendSql="isUsingBackendSql"
                :isEditorOpen="isEditorOpen"
              />
            </div>

            <!-- Anomaly detection right column -->
            <div
              v-else
              class="anomaly-right-column"
              style="
                position: absolute;
                top: 86px;
                right: 4px;
                width: calc(39% - 1.5rem);
                height: calc(100vh - 302px);
                pointer-events: auto;
                z-index: 10;
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
                overflow: hidden;
              "
            >
              <!-- SQL Preview -->
              <div
                class="preview-box card-container"
                style="
                  flex: 1;
                  min-height: 150px;
                  overflow: hidden;
                  display: flex;
                  flex-direction: column;
                "
              >
                <div
                  class="preview-header tw:flex tw:items-center tw:px-3 tw:py-2"
                >
                  <span class="preview-title tw:text-sm tw:font-semibold">{{
                    t("alerts.sqlPreview")
                  }}</span>
                </div>
                <div style="flex: 1; overflow: hidden; min-height: 0">
                  <QueryEditor
                    editor-id="anomaly-sql-preview"
                    language="sql"
                    :read-only="true"
                    :show-auto-complete="false"
                    :hide-nl-toggle="true"
                    :query="anomalyPreviewSql"
                    style="height: 100%"
                  />
                </div>
              </div>

              <!-- Summary -->
              <div
                class="collapsible-section card-container"
                :style="anomalySummarySectionStyle"
              >
                <div
                  class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
                  @click="showAnomalySummary = !showAnomalySummary"
                >
                  <span class="tw:text-sm tw:font-semibold">{{
                    t("alerts.summary.title")
                  }}</span>
                  <q-btn
                    flat
                    dense
                    round
                    size="xs"
                    :icon="showAnomalySummary ? 'expand_less' : 'expand_more'"
                    @click.stop
                  />
                </div>
                <div
                  v-show="showAnomalySummary"
                  style="overflow: auto; flex: 1"
                >
                  <AnomalySummary
                    style="height: 100%; overflow: auto"
                    :config="anomalyConfig"
                    :destinations="destinations"
                    :wizard-step="wizardStep"
                  />
                </div>
              </div>
            </div>
          </div>
        </q-form>
      </div>
    </div>
    <div v-if="isAnomalyMode" class="tw:mx-2">
      <div
        class="flex q-px-md full-width tw:py-3 card-container tw:justify-end"
        style="position: sticky; bottom: 0px; z-index: 2"
      >
        <!-- All Buttons (Right Side) -->
        <div class="tw:flex tw:items-center tw:gap-2">
          <!-- Wizard Navigation Buttons -->
          <q-btn
            flat
            :label="t('alerts.back')"
            class="o2-secondary-button tw:h-[36px]"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            :disable="wizardStep === 1"
            no-caps
            @click="goToPreviousStep"
          />
          <q-btn
            flat
            :label="t('alerts.continue')"
            class="o2-secondary-button tw:h-[36px]"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            :disable="isLastStep"
            no-caps
            @click="goToNextStep"
          />
          <q-separator vertical class="tw:mx-2"
style="height: 36px" />

          <!-- Cancel and Save Buttons -->
          <q-btn
            data-test="add-alert-cancel-btn"
            v-close-popup="true"
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
            @click="$emit('cancel:hideform')"
          />
          <q-btn
            data-test="add-alert-submit-btn"
            class="o2-primary-button no-border tw:h-[36px]"
            :label="isAnomalyMode && !anomalyEditMode ? t('alerts.saveAndTrain') : t('alerts.save')"
            no-caps
            flat
            :loading="anomalySaving"
            :disable="!canSaveAlert"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            @click="handleSave"
          />
        </div>
      </div>
    </div>
  </div>

  <q-dialog
    v-model="showJsonEditorDialog"
    position="right"
    full-height
    maximized
    :persistent="true"
  >
    <JsonEditor
      :data="formData"
      :title="'Edit Alert JSON'"
      :type="'alerts'"
      :validation-errors="validationErrors"
      @close="showJsonEditorDialog = false"
      @saveJson="saveAlertJson"
      :isEditing="beingUpdated"
    />
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

import JsonEditor from "../common/JsonEditor.vue";
import HorizontalStepper from "./HorizontalStepper.vue";
import AlertSetup from "./steps/AlertSetup.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";
import AnomalyDetectionConfig from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.vue";
import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";
import AnomalySummary from "@/components/anomaly_detection/AnomalySummary.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import { useAlertForm, defaultAlertValue } from "@/composables/useAlertForm";

export default defineComponent({
  name: "ComponentAddUpdateAlert",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultAlertValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array,
      default: () => [],
    },
    templates: {
      type: Array,
      default: () => [],
    },
  },
  emits: [
    "update:list",
    "cancel:hideform",
    "refresh:destinations",
    "refresh:templates",
  ],
  components: {
    JsonEditor,
    HorizontalStepper,
    AlertSetup,
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    AlertWizardRightColumn,
    PreviewAlert,
    AlertSummary,
    SelectFolderDropDown,
    AnomalyDetectionConfig,
    AnomalyAlerting,
    AnomalySummary,
    QueryEditor,
  },
  setup(props, { emit }) {
    const alertForm = useAlertForm(props, emit);

    // Re-export everything from the composable for template access
    return {
      ...alertForm,
    };
  },

});
</script>

<style scoped lang="scss">
#editor {
  width: 100%;
  min-height: 5rem;
  resize: both;
}

// V3 Top Bar Styles
.alert-v3-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 52px; // label(20px) + gap(4px) + control(28px)
  justify-content: flex-end;
}

.alert-v3-label {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.alert-v3-field {
  height: 28px !important;
  min-height: 28px !important;

  :deep(.q-field__control) {
    height: 28px !important;
    min-height: 28px !important;
    border-radius: 4px;
  }
  :deep(.q-field__native) {
    padding: 0 0px !important;
    font-size: 13px;
    min-height: 28px !important;
    height: 28px !important;
    line-height: 28px !important;
  }
  :deep(.q-field__input) {
    padding: 0 0px !important;
    font-size: 13px;
    min-height: 28px !important;
    height: 28px !important;
    line-height: 28px !important;
  }
  :deep(.q-field__marginal) {
    height: 28px !important;
    min-height: 28px !important;
  }
  :deep(.q-field__control-container) {
    height: 28px !important;
    min-height: 28px !important;
  }
  :deep(.q-field__append) {
    height: 28px !important;
    align-items: center;
  }
}

.alert-v3-toggle {
  height: 28px !important;
  overflow: visible;

  :deep(.q-btn) {
    height: 28px !important;
    min-height: 28px !important;
    font-size: 12px;
    padding: 0 12px !important;
    font-weight: 500;
    line-height: 28px;
    border-radius: 4px !important;
  }
}

.alert-v3-folder {
  height: 28px !important;
  display: flex;
  align-items: center;

  // The root div of SelectFolderDropDown
  :deep(> div) {
    display: flex;
    align-items: center;
    height: 28px;
    width: 100%;
  }
  :deep(.showLabelOnTop) {
    width: 100% !important;
    margin-right: 0 !important;
    padding-top: 0 !important;
  }
  :deep(.q-field__label) {
    display: none !important;
  }
  :deep(.q-field) {
    height: 28px !important;
    min-height: 28px !important;
    padding-top: 0 !important;
  }
  :deep(.q-field__inner) {
    padding-top: 0 !important;
  }
  :deep(.q-field__control) {
    height: 28px !important;
    min-height: 28px !important;
    border-radius: 4px;
    padding-top: 0 !important;
  }
  :deep(.q-field__control-container) {
    padding-top: 0 !important;
    height: 28px !important;
  }
  :deep(.q-field__native),
  :deep(.q-field__input) {
    padding: 0 4px !important;
    font-size: 13px;
    min-height: 28px !important;
    height: 28px !important;
    line-height: 28px !important;
  }
  :deep(.q-field__marginal) {
    height: 28px !important;
    min-height: 28px !important;
  }
  :deep(.q-field__append) {
    height: 28px !important;
    align-items: center;
  }
  :deep(.add-folder-btn) {
    display: none !important;
  }
}

.alert-v3-add-folder-btn {
  height: 28px !important;
  min-height: 28px !important;
  width: 28px !important;
  min-width: 28px !important;
  padding: 0 !important;
  flex-shrink: 0;
}

// Splitter styles
.alert-v3-splitter {
  :deep(.q-splitter__before),
  :deep(.q-splitter__after) {
    transition: none !important;
  }

  :deep(.q-splitter__separator) {
    background: transparent !important;
    width: 4px !important;
    z-index: 10;
  }
}

.alert-v3-splitter-btn-expanded,
.alert-v3-splitter-btn-collapsed {
  min-height: 3.5em !important;
  min-width: 0.8rem !important;
  position: absolute !important;
  top: 20px !important;
  left: 80% !important;
  transform: translateX(-50%);
  z-index: 100 !important;
  border-radius: 0.325rem;
}

.alert-condition {
  .__column,
  .__value {
    width: 250px;
  }

  .__operator {
    width: 100px;
  }
}
</style>
<style lang="scss">
.no-case .q-field__native span {
  text-transform: none !important;
}

.no-case .q-field__input {
  text-transform: none !important;
}

.add-alert-form {
  .q-field--dense .q-field__control {
    .q-field__native span {
      overflow: hidden;
    }
  }

  .alert-condition .__column .q-field__control .q-field__native span {
    max-width: 152px;
    text-overflow: ellipsis;
    text-align: left;
    white-space: nowrap;
  }

  .q-field__bottom {
    padding: 2px 0;
  }
}

.silence-notification-input,
.threshould-input {
  .q-field--filled .q-field__control {
    background-color: transparent !important;
  }

  .q-field--dark .q-field__control {
    background-color: rgba(255, 255, 255, 0.07) !important;
  }
}

.dark-mode {
  .alert-setup-container {
    background-color: #212121;
    padding: 8px 16px;
    margin-left: 8px;
    border: 1px solid #343434;
    border-top: 0px !important;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
  }
  .q-text-area-input > div > div {
    background-color: rgb(30, 31, 31) !important;
    border: 1px solid $input-border !important;
  }
  .dark-mode-row-template > div > div {
    background-color: rgb(30, 31, 31) !important;
    border: 1px solid $input-border !important;
  }
  .custom-input-label {
    color: #bdbdbd;
  }
}
.light-mode {
  .alert-setup-container {
    background-color: #ffffff;
    padding: 8px 16px;
    margin-left: 8px;
    border: 1px solid #e6e6e6;
    border-top: 0px !important;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
  }
  .custom-input-label {
    color: #5c5c5c;
  }
  .q-field--labeled.showLabelOnTop.q-field .q-field__control {
    border: 1px solid #d4d4d4;
  }
  .add-folder-btn {
    border: 1px solid #d4d4d4;
  }
  .dark-mode .q-text-area-input > div > div {
    background-color: #181a1b !important;
    border: 1px solid black !important;
  }

  .light-mode .q-text-area-input > div > div {
    background-color: #ffffff !important;
    border: 1px solid #e0e0e0 !important;
  }
  .dark-mode-row-template > div > div {
    background-color: #181a1b !important;
    border: 1px solid black !important;
  }
  .light-mode-row-template > div > div {
    background-color: #ffffff !important;
    border: 1px solid #e0e0e0 !important;
  }
}
.q-text-area-input > div > div > div > textarea {
  height: 80px !important;
  resize: none !important;
}
.row-template-input > div > div > div > textarea {
  height: 160px !important;
  resize: none !important;
}
.bottom-sticky-dark {
  background-color: #212121;
}
.bottom-sticky-light {
  background-color: #ffffff;
  border-top: 1px solid #d4d4d4;
}
.input-box-bg-dark .q-field__control {
  background-color: #181a1b !important;
}
.input-box-bg-light .q-field__control {
  background-color: #ffffff !important;
}
.input-border-dark .q-field__control {
  border: 1px solid #181a1b !important;
}
.input-border-light .q-field__control {
  border: 1px solid #d4d4d4 !important;
}

.o2-alert-tab-border {
  border-top: 0.0625rem solid var(--o2-border-color);
}

// Wizard Stepper Styles
.alert-wizard-stepper {
  box-shadow: none;
  .q-stepper__step-inner {
    padding: 0.375rem !important;
  }
  .q-stepper__tab {
    padding-left: 0.375rem !important;
    min-height: 30px !important;
  }

  :deep(.q-stepper__header) {
    border-bottom: 1px solid #e0e0e0;
  }

  :deep(.q-stepper__tab) {
    padding: 12px 16px;
    min-height: 60px;
  }

  // Hide captions for inactive steps
  :deep(.q-stepper__tab) {
    .q-stepper__caption {
      display: none !important;
    }
  }

  // Show caption only on active step
  :deep(.q-stepper__tab--active) {
    .q-stepper__caption {
      display: block !important;
      opacity: 0.7;
      font-size: 12px;
      margin-top: 4px;
    }
  }

  :deep(.q-stepper__tab--active) {
    color: #1976d2;
    font-weight: 600;
  }

  :deep(.q-stepper__tab--done) {
    color: #4caf50;
    cursor: pointer;
  }

  :deep(.q-stepper__dot) {
    width: 32px;
    height: 32px;
    font-size: 14px;
  }

  .q-stepper--horizontal .q-stepper__step-inner {
    padding: 8px !important;
  }

  // Make step titles more compact
  :deep(.q-stepper__title) {
    font-size: 14px;
    line-height: 1.2;
  }
}

.wizard-view-container {
  .q-stepper {
    background: transparent !important;
  }
}

// Dark mode adjustments
.dark-mode1 {
  .alert-wizard-stepper {
    :deep(.q-stepper__header) {
      border-bottom-color: #424242;
    }
  }
}

// Persistent step caption styles (helper text style)
.persistent-step-caption {
  font-size: 12px;
  line-height: 1.6;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-weight: 400;
  margin-left: 0.375rem;
  letter-spacing: 0.01em;
}

.dark-mode-caption {
  background-color: transparent;
  color: #9e9e9e;
  border-left: 3px solid #5a5a5a;
  padding-left: 12px !important;
}

.light-mode-caption {
  background-color: transparent;
  color: #757575;
  border-left: 3px solid #bdbdbd;
  padding-left: 12px !important;
}
</style>
