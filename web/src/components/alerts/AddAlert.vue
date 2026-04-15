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
    <!-- V3 "Single Pane of Glass" Layout (All alert types)                -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
      <div class="tw:flex tw:flex-col" style="height: calc(100vh - 44px);">
      <div class="alert-v3-topbar card-container tw:mx-[0.625rem] tw:mb-2 tw:shrink-0">
        <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:h-[48px]">

          <!-- Back + Title -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
            <div
              data-test="add-alert-back-btn"
              class="tw:flex tw:justify-center tw:items-center tw:cursor-pointer tw:opacity-60 hover:tw:opacity-100 tw:transition-opacity"
              style="border: 1.5px solid; border-radius: 50%; width: 18px; height: 18px;"
              title="Go Back"
              @click="router.back()"
            >
              <q-icon name="arrow_back_ios_new" size="10px" class="tw:font-semibold" />
            </div>
            <template v-if="!isAnomalyMode">
              <span v-if="beingUpdated" class="tw:text-sm tw:font-semibold tw:max-w-[160px] tw:truncate tw:inline-block">
                {{ formData.name }}
                <q-tooltip v-if="formData.name?.length > 20" class="tw:text-sm">{{ formData.name }}</q-tooltip>
              </span>
              <template v-else>
                <q-input
                  v-model="formData.name"
                  data-test="add-alert-name-input"
                  dense
                  borderless
                  :placeholder="'Alert name'"
                  class="alert-v3-field topbar-name-input tw:text-sm"
                  hide-bottom-space
                />
              </template>

            </template>
            <template v-else>
              <template v-if="!anomalyEditMode">
                <q-input
                  v-model="anomalyConfig.name"
                  dense
                  borderless
                  placeholder="Anomaly name"
                  class="alert-v3-field topbar-name-input tw:text-sm"
                  hide-bottom-space
                />
              </template>
              <template v-if="anomalyEditMode">
                <span class="tw:text-sm tw:font-semibold tw:max-w-[160px] tw:truncate tw:inline-block">
                  {{ anomalyConfig.name }}
                  <q-tooltip v-if="anomalyConfig.name?.length > 20" class="tw:text-sm">{{ anomalyConfig.name }}</q-tooltip>
                </span>
                <q-badge v-if="anomalyConfig.status" :color="anomalyStatusColor" :label="anomalyConfig.status" class="text-caption" />
                <span
                  v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                  class="tw:text-[11px] tw:whitespace-nowrap"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                >
                  Last run: {{ anomalyFormatTs(anomalyConfig.last_detection_run) }}
                </span>
                <q-btn v-if="anomalyConfig.status === 'failed'" flat no-caps dense size="xs" color="negative" icon="replay" label="Retry" :loading="anomalyRetraining" @click="anomalyTriggerRetrain" />
              </template>
            </template>
          </div>

          <!-- Push everything to the right -->
          <div class="tw:flex-1" />

          <!-- Folder -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
            <label class="alert-v3-inline-label tw:opacity-80 tw:font-semibold">Folder</label>
            <InlineSelectFolderDropdown
              :model-value="activeFolderId"
              type="alerts"
              :disable="beingUpdated || anomalyEditMode"
              @update:model-value="updateActiveFolderId({ value: $event })"
            />
          </div>

          <!-- Separator after Folder -->
          <div class="tw:w-px tw:h-5 tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:bg-gray-600/50' : 'tw:bg-gray-300'" />

          <!-- Stream Type -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
            <label class="alert-v3-inline-label tw:opacity-80 tw:font-semibold">{{ t("alerts.streamType") }} <span class="tw:text-red-500">*</span></label>
            <q-select
              data-test="add-alert-stream-type-select-dropdown"
              v-model="formData.stream_type"
              :options="streamTypes"
              :popup-content-style="{ textTransform: 'lowercase' }"
              class="no-case alert-v3-field topbar-stream-type"
              dense
              borderless
              use-input
              fill-input
              hide-selected
              hide-bottom-space
              :input-debounce="200"
              :readonly="beingUpdated || anomalyEditMode"
              :disable="beingUpdated || anomalyEditMode"
              @filter="(val, update) => update(() => {})"
              @update:model-value="updateStreams()"
              behavior="menu"
            />
          </div>

          <!-- Stream Name -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
            <label class="alert-v3-inline-label tw:opacity-80 tw:font-semibold">{{ t("alerts.stream_name") }} <span class="tw:text-red-500">*</span></label>
            <q-select
              data-test="add-alert-stream-name-select-dropdown"
              v-model="formData.stream_name"
              :options="filteredStreams"
              :loading="isFetchingStreams"
              color="input-border"
              class="no-case alert-v3-field topbar-stream-name"
              dense
              borderless
              use-input
              hide-selected
              hide-bottom-space
              fill-input
              :input-debounce="400"
              :readonly="beingUpdated || anomalyEditMode"
              :disable="beingUpdated || anomalyEditMode || !formData.stream_type"
              @filter="filterStreams"
              @update:model-value="updateStreamFields"
              behavior="menu"
            />
            <q-tooltip v-if="!formData.stream_type">Select a stream type first</q-tooltip>
          </div>

          <!-- Separator before Alert Type -->
          <div class="tw:w-px tw:h-5 tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:bg-gray-600/50' : 'tw:bg-gray-300'" />

          <!-- Alert Type — tabs normally, dropdown when AI chat is open -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
            <label class="alert-v3-inline-label">{{ t("alerts.alertType") || 'Alert Type' }}</label>

            <!-- Tabs: default -->
            <div v-if="!store.state.isAiChatEnabled" class="alert-type-tabs">
              <button
                v-for="tab in [
                  { key: 'false', label: t('alerts.scheduled') },
                  { key: 'true', label: t('alerts.realTime') },
                  ...(isAnomalyDetectionEnabled ? [{ key: 'anomaly', label: t('alerts.anomalyDetection') }] : []),
                ]"
                :key="tab.key"
                class="alert-type-tab"
                :class="{ active: formData.is_real_time === tab.key }"
                :disabled="beingUpdated || anomalyEditMode"
                @click="formData.is_real_time = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>

            <!-- Dropdown: when AI chat is open -->
            <q-select
              v-else
              v-model="formData.is_real_time"
              :options="[
                { label: t('alerts.scheduled'), value: 'false' },
                { label: t('alerts.realTime'), value: 'true' },
                ...(isAnomalyDetectionEnabled ? [{ label: t('alerts.anomalyDetection'), value: 'anomaly' }] : []),
              ]"
              emit-value
              map-options
              dense
              borderless
              hide-bottom-space
              :disable="beingUpdated || anomalyEditMode"
              class="alert-v3-field"
              style="min-width: 110px;"
            />
          </div>

        </div>
      </div>

      <div class="tw:flex tw:flex-1 tw:min-h-0 tw:mx-[0.625rem] tw:gap-2 tw:mb-2">

      <!-- LEFT column wrapper (flex: 6.5) -->
      <div style="flex: 6.5; min-height: 0; display: flex; flex-direction: column; gap: 8px;">

      <!-- TIER 3: Configuration Tabs -->
      <div class="alert-v3-tabs card-container" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
        <!-- Tab Headers -->
        <div class="tw:flex tw:border-b tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'">
          <div
            v-for="tab in (isAnomalyMode ? [
              { key: 'anomaly-config', label: t('alerts.anomalyDetectionConfig'), required: true },
              { key: 'anomaly-alerting', label: t('alerts.alerting') || 'Alerting', required: anomalyConfig.alert_enabled },
            ] : [
              { key: 'condition', label: 'Alert Rules', required: true },
              { key: 'advanced', label: t('alerts.steps.advanced') },
            ]).filter(t => t.show !== false)"
            :key="tab.key"
            class="tw:px-4 tw:py-2.5 tw:cursor-pointer tw:text-sm tw:font-medium tw:relative tw:select-none tw:transition-colors"
            :class="activeTab === tab.key
              ? 'active-tab'
              : (store.state.theme === 'dark' ? 'tw:text-gray-400 hover:tw:text-gray-200' : 'tw:text-gray-500 hover:tw:text-gray-800')"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}{{ tab.required ? ' *' : '' }}
          </div>
        </div>

        <!-- Tab Content -->
        <q-form ref="addAlertForm" class="tw:flex-1 tw:overflow-auto" @submit="onSubmit">
          <!-- Alert Rules Tab (Conditions + Alert Settings merged) -->
          <div v-show="activeTab === 'condition'" class="tw:p-3 tw:flex tw:flex-col tw:gap-4">
            <div>
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
              :beingUpdated="beingUpdated"
              :promqlCondition="formData.query_condition.promql_condition"
              :triggerCondition="formData.trigger_condition"
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
              @update:triggerCondition="(val) => (formData.trigger_condition = val)"
            />
            </div>

            <div>
              <AlertSettings
              ref="step4Ref"
              :formData="formData"
              :isRealTime="formData.is_real_time"
              :columns="filteredColumns"
              :isAggregationEnabled="isAggregationEnabled"
              :destinations="formData.destinations"
              :formattedDestinations="getFormattedDestinations"
              @update:trigger="(val) => (formData.trigger_condition = val)"
              @update:aggregation="(val) => (formData.query_condition.aggregation = val)"
              @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
              @update:promqlCondition="(val) => (formData.query_condition.promql_condition = val)"
              @update:destinations="updateDestinations"
              @refresh:destinations="refreshDestinations"
            />
            </div>
          </div>

          <!-- Advanced Tab (includes Compare with Past, Deduplication, and Advanced settings) -->
          <div v-show="activeTab === 'advanced'" class="tw:p-3 tw:flex tw:flex-col tw:gap-4">

            <!-- Compare with Past (scheduled only) -->
            <div v-if="formData.is_real_time === 'false'">
              <CompareWithPast
                ref="step3Ref"
                :multiTimeRange="formData.query_condition.multi_time_range"
                :period="formData.trigger_condition.period"
                :frequency="formData.trigger_condition.frequency"
                :frequencyType="formData.trigger_condition.frequency_type"
                :cron="formData.trigger_condition.cron"
                :selectedTab="formData.query_condition.type || 'custom'"
                @update:multiTimeRange="(val) => (formData.query_condition.multi_time_range = val)"
              />
            </div>

            <!-- Deduplication (scheduled only) -->
            <div v-if="formData.is_real_time === 'false'">
              <Deduplication
                :deduplication="formData.deduplication"
                :columns="filteredColumns"
                @update:deduplication="(val) => (formData.deduplication = val)"
              />
            </div>

            <!-- Advanced settings -->
            <div>
              <Advanced
                :template="formData.template"
                :templates="templates"
                :contextAttributes="formData.context_attributes"
                :description="formData.description"
                :rowTemplate="formData.row_template"
                :rowTemplateType="formData.row_template_type"
                @update:template="(val) => (formData.template = val)"
                @refresh:templates="refreshTemplates"
                @update:contextAttributes="(val) => (formData.context_attributes = val)"
                @update:description="(val) => (formData.description = val)"
                @update:rowTemplate="(val) => (formData.row_template = val)"
                @update:rowTemplateType="(val) => (formData.row_template_type = val)"
              />
            </div>
          </div>

          <!-- Anomaly Detection Config Tab -->
          <div v-show="activeTab === 'anomaly-config'" class="tw:p-3">
            <AnomalyDetectionConfig
              ref="anomalyStep2Ref"
              :config="anomalyConfig"
            />
          </div>

          <!-- Anomaly Alerting Tab -->
          <div v-show="activeTab === 'anomaly-alerting'" class="tw:p-3">
            <AnomalyAlerting
              :config="anomalyConfig"
              :destinations="destinations"
              @refresh:destinations="$emit('refresh:destinations')"
            />
          </div>
        </q-form>
      </div><!-- end TIER 3 card -->

      <!-- Footer: Cancel / Save (left column, separate card) -->
      <div
        class="card-container tw:flex tw:items-center tw:justify-end tw:px-3 tw:py-2.5 tw:shrink-0 tw:gap-2"
      >
        <q-btn
          data-test="add-alert-cancel-btn"
          class="o2-secondary-button tw:h-[36px]"
          :label="t('alerts.cancel')"
          no-caps
          flat
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          @click="$emit('cancel:hideform')"
        />
        <q-btn
          data-test="add-alert-submit-btn"
          class="o2-primary-button no-border tw:h-[36px]"
          :label="isAnomalyMode && !anomalyEditMode ? t('alerts.saveAndTrain') : t('alerts.save')"
          no-caps
          flat
          :loading="isAnomalyMode ? anomalySaving : false"
          :disable="isAnomalyMode ? !canSaveAlert : false"
          :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
          @click="handleSave"
        />
      </div>

      </div><!-- end LEFT column wrapper -->

      <!-- TIER 2: Preview + Summary (RIGHT 30%) -->
      <div class="tw:flex tw:flex-col tw:gap-2" style="flex: 3.5; min-height: 0;">
        <!-- Preview Card -->
        <div class="card-container tw:overflow-hidden tw:flex tw:flex-col" style="flex: 1; min-height: 0;">
          <div
            class="tw:flex tw:items-center tw:px-3 tw:h-[40px] tw:select-none tw:border-b tw:shrink-0 tw:gap-2"
            :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
          >
            <span class="tw:text-sm tw:font-medium">{{ isAnomalyMode ? t('alerts.sqlPreview') : (t('alerts.preview') || 'Preview') }}</span>
            <template v-if="!isAnomalyMode && activeEvaluationStatus">
              <div class="tw:w-px tw:h-4" :class="store.state.theme === 'dark' ? 'tw:bg-gray-600' : 'tw:bg-gray-300'" />
              <q-icon :name="activeEvaluationStatus.wouldTrigger ? 'check_circle' : 'cancel'" :color="activeEvaluationStatus.wouldTrigger ? 'positive' : 'grey-5'" size="16px" />
              <span class="tw:text-xs tw:font-semibold" :class="activeEvaluationStatus.wouldTrigger ? 'tw:text-green-600' : 'tw:text-gray-400'">
                {{ activeEvaluationStatus.wouldTrigger ? 'Would Trigger' : 'Would Not Trigger' }}
              </span>
              <span class="tw:text-xs tw:opacity-60">{{ activeEvaluationStatus.reason }}</span>
            </template>
          </div>
          <div class="tw:flex-1 tw:min-h-0" style="overflow: hidden;">
            <template v-if="isAnomalyMode">
              <QueryEditor editor-id="anomaly-sql-preview" language="sql" :read-only="true" :show-auto-complete="false" :hide-nl-toggle="true" :query="anomalyPreviewSql" style="height: 100%" />
            </template>
            <template v-else>
              <div v-if="!formData.stream_name" class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-2">
                <q-icon name="query_stats" size="36px" class="tw:opacity-20" />
                <span class="tw:text-sm tw:font-medium" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'">
                  Select a stream type and stream name to see a preview
                </span>
              </div>
              <preview-alert
                v-else
                ref="previewAlertRef"
                style="width: 100%; height: 100%;"
                :formData="formData"
                :query="previewQuery"
                :selectedTab="formData.query_condition.type || 'custom'"
                :isAggregationEnabled="isAggregationEnabled"
                :isUsingBackendSql="isUsingBackendSql"
                :isEditorOpen="isEditorOpen"
                :previewDateTime="previewDateTimeValue"
              />
            </template>
          </div>
        </div>

        <!-- Summary Card -->
        <div class="card-container tw:overflow-hidden tw:flex tw:flex-col" style="flex: 1; min-height: 0;">
          <div
            class="tw:flex tw:items-center tw:px-3 tw:h-[40px] tw:select-none tw:border-b tw:shrink-0"
            :class="store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200'"
          >
            <span class="tw:text-sm tw:font-medium">{{ t('alerts.summary.title') || 'Summary' }}</span>
          </div>
          <div class="tw:flex-1 tw:min-h-0" style="overflow: auto;">
            <AnomalySummary
              v-if="isAnomalyMode"
              style="height: 100%; overflow: auto;"
              :config="anomalyConfig"
              :destinations="destinations"
              :wizard-step="3"
            />
            <alert-summary
              v-else
              style="height: 100%;"
              :formData="formData"
              :destinations="destinations"
              :previewQuery="previewQuery"
              :generatedSqlQuery="generatedSqlQuery"
            />
          </div>
        </div>
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
import { defineComponent, ref, reactive, computed, watch, onBeforeUnmount } from "vue";

import JsonEditor from "../common/JsonEditor.vue";
import HorizontalStepper from "./HorizontalStepper.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import AlertWizardRightColumn from "./AlertWizardRightColumn.vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import InlineSelectFolderDropdown from "../common/sidebar/InlineSelectFolderDropdown.vue";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";
import DateTimePicker from "@/components/DateTimePicker.vue";
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
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    AlertWizardRightColumn,
    PreviewAlert,
    AlertSummary,
    SelectFolderDropDown,
    DateTimePicker,
    AnomalyDetectionConfig,
    AnomalyAlerting,
    AnomalySummary,
    QueryEditor,
    InlineSelectFolderDropdown,
  },
  setup(props, { emit }) {
    const alertForm = useAlertForm(props, emit);

    const isAnomalyDetectionEnabled = computed(
      () => alertForm.store.state.zoConfig.anomaly_detection_enabled === false,
    );

    // Auto-expand preview when stream name is selected, collapse when cleared
    watch(
      () => alertForm.formData.value.stream_name,
      (newVal) => {
        alertForm.chartCollapsed.value = !newVal;
      }
    );

    // Switch activeTab when alert type changes to/from anomaly
    watch(
      () => alertForm.formData.value.is_real_time,
      (newVal) => {
        if (newVal === 'anomaly') {
          alertForm.activeTab.value = 'anomaly-config';
        } else if (alertForm.activeTab.value.startsWith('anomaly-')) {
          alertForm.activeTab.value = 'condition';
        }
      }
    );

    // ── Floating preview widget ──
    const floatingPreview = ref(false);
    const floatingPreviewRef = ref<any>(null);

    // Use floating preview's status when it's active, otherwise use inline
    const activeEvaluationStatus = computed(() => {
      if (floatingPreview.value && floatingPreviewRef.value?.evaluationStatus) {
        return floatingPreviewRef.value.evaluationStatus;
      }
      return alertForm.previewAlertRef.value?.evaluationStatus || null;
    });
    const floatingWidgetRef = ref<HTMLElement | null>(null);
    const floatingPos = reactive({
      x: typeof window !== 'undefined' ? window.innerWidth - 470 : 600,
      y: 100,
    });
    const floatingWidgetStyle = computed(() => ({
      left: `${floatingPos.x}px`,
      top: `${floatingPos.y}px`,
    }));

    let dragOffset = { x: 0, y: 0 };
    const onFloatingDragStart = (e: MouseEvent) => {
      dragOffset.x = e.clientX - floatingPos.x;
      dragOffset.y = e.clientY - floatingPos.y;
      document.addEventListener('mousemove', onFloatingDragMove);
      document.addEventListener('mouseup', onFloatingDragEnd);
    };
    const onFloatingDragMove = (e: MouseEvent) => {
      floatingPos.x = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - 420));
      floatingPos.y = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 240));
    };
    const onFloatingDragEnd = () => {
      document.removeEventListener('mousemove', onFloatingDragMove);
      document.removeEventListener('mouseup', onFloatingDragEnd);
    };
    onBeforeUnmount(() => {
      document.removeEventListener('mousemove', onFloatingDragMove);
      document.removeEventListener('mouseup', onFloatingDragEnd);
    });

    return {
      ...alertForm,
      isAnomalyDetectionEnabled,
      floatingPreview,
      floatingPreviewRef,
      activeEvaluationStatus,
      floatingWidgetRef,
      floatingWidgetStyle,
      onFloatingDragStart,
    };
  },

});
</script>

<style scoped lang="scss">
.active-tab {
  color: var(--q-primary);
  border-bottom: 2px solid var(--q-primary);
}

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
  font-weight: 700;
  white-space: nowrap;
}

.alert-v3-inline-label {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0.8;
}

.alert-v3-field {
  height: 28px !important;
  min-height: 28px !important;

  :deep(.q-field__control) {
    height: 28px !important;
    min-height: 28px !important;
    border-radius: 4px !important;
    border: 1px solid rgba(0, 0, 0, 0.2) !important;
    background: rgba(0, 0, 0, 0.03) !important;
    padding: 0 8px !important;
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

.body--dark .alert-v3-field {
  :deep(.q-field__control) {
    border-color: rgba(255, 255, 255, 0.2) !important;
    background: rgba(255, 255, 255, 0.05) !important;
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

.alert-type-tabs {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  padding: 3px;

  .alert-type-tab {
    padding: 4px 12px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: rgba(0, 0, 0, 0.4);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    line-height: 1.4;

    &:hover {
      color: rgba(0, 0, 0, 0.7);
    }

    &.active {
      background: #ffffff;
      color: #202124;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.body--dark .alert-type-tabs {
  background: rgba(255, 255, 255, 0.05);

  .alert-type-tab {
    color: rgba(255, 255, 255, 0.45);

    &:hover { color: rgba(255, 255, 255, 0.75); }

    &.active {
      background: #374151;
      color: #e4e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
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

.alert-condition {
  .__column,
  .__value {
    width: 250px;
  }

  .__operator {
    width: 100px;
  }
}

.alert-preview-datetime {
  :deep(.q-btn) {
    height: 26px !important;
    min-height: 26px !important;
    font-size: 11px;
    padding: 0 8px !important;
    border-radius: 1rem !important;
  }
}

.floating-preview-widget {
  position: fixed;
  z-index: 9999;
  width: 420px;
  height: 240px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);

  &--light {
    background: #ffffff;
    border: 1px solid #e0e0e0;
  }
  &--dark {
    background: #1e1e1e;
    border: 1px solid #424242;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 4px 0 10px;
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
    &:active { cursor: grabbing; }

    &--light {
      background: #f5f5f5;
      border-bottom: 1px solid #e0e0e0;
    }
    &--dark {
      background: #2a2a2a;
      border-bottom: 1px solid #424242;
    }
  }

  &__body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
}
</style>
<style lang="scss">
// ── Global compact 28px sizing for alert inputs/selects ────────────────────
.alert-v3-input {
  min-height: 28px !important;
  height: 28px !important;
  .q-field__control {
    min-height: 28px !important;
    max-height: 28px !important;
    height: 28px !important;
  }
  .q-field__control-container {
    .q-field__native {
      height: 28px !important;
      min-height: 28px !important;
      &::-webkit-inner-spin-button,
      &::-webkit-outer-spin-button {
        height: 16px;
        margin-block: auto;
      }
    }
  }
}

.alert-v3-select {
  min-height: 1.75rem !important;
  .q-field__inner {
    min-height: 1.75rem !important;
    max-height: 1.75rem !important;
  }
  .q-field__control {
    min-height: 1.75rem !important;
    max-height: 1.75rem !important;
    height: 1.75rem !important;
  }
  .q-field__control-container {
    .q-field__native {
      min-height: 1.75rem !important;
      height: 1.75rem !important;
      padding: 0px !important;
    }
  }
  .q-field__marginal {
    height: 1.75rem !important;
  }
  .q-field__append {
    height: 1.75rem !important;
  }
}
// ───────────────────────────────────────────────────────────────────────────

// ── Global query-mode-tabs (Builder / SQL toggle used in alert forms) ───────
.query-mode-tabs {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  padding: 3px;
  width: fit-content;

  .query-mode-tab {
    padding: 4px 12px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: rgba(0, 0, 0, 0.4);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    line-height: 1.4;

    &:hover { color: rgba(0, 0, 0, 0.7); }

    &.active {
      background: #fff;
      color: #1a1a1a;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
  }
}

body.body--dark .query-mode-tabs {
  background: rgba(255, 255, 255, 0.05);

  .query-mode-tab {
    color: rgba(255, 255, 255, 0.6);

    &:hover { color: rgba(255, 255, 255, 0.85); }

    &.active {
      background: #374151;
      color: #e4e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
  }
}
// ───────────────────────────────────────────────────────────────────────────

// ── static-text: inline label/hint aligned to 28px row height ──────────────
.static-text {
  display: inline-flex;
  align-items: center;
  height: 1.75rem;
  line-height: 1.75rem;
  font-size: 12px;
}
// ───────────────────────────────────────────────────────────────────────────

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

// ── Responsive topbar: container queries so AI chat panel triggers shrink too
.alert-v3-topbar {
  container-type: inline-size;
  container-name: topbar;
}

// Base (widest) — full widths
.topbar-name-input  { min-width: 120px; max-width: 150px; }
.topbar-stream-type { width: 150px; }
.topbar-stream-name { width: 160px; }

// Medium — topbar ~1050–1300px
@container topbar (max-width: 1300px) {
  .topbar-name-input  { min-width: 100px; }
  .topbar-stream-type { width: 90px; }
  .topbar-stream-name { width: 110px; }
}

// Compact — AI chat open or narrow viewport
@container topbar (max-width: 850px) {
  .topbar-name-input  { min-width: 90px; }
  .topbar-stream-type { width: 90px; }
  .topbar-stream-name { width: 95px; }
}

// Minimum — very narrow
@container topbar (max-width: 680px) {
  .topbar-name-input  { min-width: 70px; }
  .topbar-stream-type { width: 75px; }
  .topbar-stream-name { width: 80px; }
}
// ───────────────────────────────────────────────────────────────────────────
</style>
