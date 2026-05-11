<!-- Copyright 2026 OpenObserve Inc.

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
      <div class="tw:flex tw:flex-col" style="height: calc(100vh - var(--navbar-height) - 5px);">
      <div class="alert-v3-topbar card-container tw:mx-[0.625rem] tw:mb-2 tw:shrink-0">
        <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:h-[48px]">

          <!-- Back + Title -->
          <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0 tw:min-w-0">

            <!-- Back button — matches dashboard style -->
            <OButton
              variant="outline"
              size="icon-sm"
              data-test="add-alert-back-btn"
              @click="goBackToAlertsList"
            >
              <q-icon name="arrow_back_ios_new" />
            </OButton>

          <!-- EDIT MODE: (folder → chevron → name) -->
          <template v-if="beingUpdated || anomalyEditMode">
            <span
              class="q-table__title alert-folder-name tw:px-2 tw:cursor-pointer tw:transition-all tw:rounded-sm tw:ml-2"
              @click="goBackToAlertsList"
            >{{ activeFolderName }}</span>
            <q-icon name="chevron_right" class="q-table__title tw:text-gray-400 tw:mt-0.5 tw:shrink-0" />
            <template v-if="!isAnomalyMode">
              <span class="q-table__title tw:truncate tw:max-w-[200px]">
                {{ formData.name }}
                <q-tooltip v-if="formData.name?.length > 24" class="tw:text-sm">{{ formData.name }}</q-tooltip>
              </span>
            </template>
            <template v-else>
              <span class="q-table__title tw:truncate tw:max-w-[200px]">
                {{ anomalyConfig.name }}
                <q-tooltip v-if="anomalyConfig.name?.length > 24" class="tw:text-sm">{{ anomalyConfig.name }}</q-tooltip>
              </span>
              <q-badge v-if="anomalyConfig.status" :color="anomalyStatusColor" :label="anomalyConfig.status" class="text-caption" />
              <span
                v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                class="tw:text-[11px] tw:whitespace-nowrap"
                :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
              >
                Last run: {{ anomalyFormatTs(anomalyConfig.last_detection_run) }}
              </span>
              <OButton v-if="anomalyConfig.status === 'failed'" variant="ghost-destructive" size="xs" :loading="anomalyRetraining" @click="anomalyTriggerRetrain" icon-left="replay">
                  {{ t('alerts.retry') }}
                </OButton>
            </template>
          </template>

          <!-- CREATE MODE: Alert Name + Folder -->
          <template v-else>
            <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
              <label class="alert-v3-inline-label">{{ isAnomalyMode ? t('alerts.anomalyName') : t('alerts.incidents.alertName') }} <span class="tw:text-red-500">*</span></label>
              <q-input
                v-if="!isAnomalyMode"
                ref="step1Ref"
                v-model="formData.name"
                data-test="add-alert-name-input"
                dense
                borderless
                no-error-icon
                :placeholder="t('alerts.alertNamePlaceholder')"
                class="alert-v3-field topbar-name-input tw:text-sm"
                :class="alertNameError ? 'field-error' : ''"
                hide-bottom-space
                @update:model-value="alertNameError = false"
              />
              <q-input
                v-else
                ref="anomalyNameRef"
                v-model="anomalyConfig.name"
                dense
                borderless
                :placeholder="t('alerts.anomalyNamePlaceholder')"
                class="alert-v3-field topbar-name-input tw:text-sm"
                hide-bottom-space
              />
            </div>

            <!-- Folder -->
            <div class="tw:flex tw:items-center tw:gap-1.5 tw:shrink-0">
              <label class="alert-v3-inline-label">{{ t('alerts.folder') }}</label>
              <InlineSelectFolderDropdown
                :model-value="activeFolderId"
                type="alerts"
                class="topbar-folder-select"
                @update:model-value="updateActiveFolderId({ value: $event })"
              />
            </div>
          </template>

          <div class="tw:flex-1" />
          </div>
        </div>
      </div>

      <div class="tw:flex tw:flex-1 tw:min-h-0 tw:mx-[0.625rem] tw:gap-2 tw:mb-2">

      <!-- LEFT column wrapper (flex: 6.5) -->
      <div style="flex: 6.5; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px;">

      <!-- Stream Name & Stream Type -->
      <div class="card-container tw:shrink-0 stream-config-card">
        <div class="section-header">
          <div class="section-header-accent" />
          <span class="section-header-title">Stream Config <span class="tw:text-red-500">*</span></span>
        </div>
        <div class="tw:flex tw:items-center tw:gap-4 tw:px-3 tw:py-2">
        <!-- Stream Type -->
        <div class="tw:flex tw:items-center tw:gap-1.5">
          <label class="alert-v3-inline-label">{{ t("alerts.streamType") }} <span class="tw:text-red-500">*</span></label>
          <q-select
            ref="streamTypeRef"
            data-test="add-alert-stream-type-select-dropdown"
            v-model="formData.stream_type"
            :options="streamTypes"
            :popup-content-style="{ textTransform: 'lowercase' }"
            class="no-case alert-v3-field stream-type-select"
            :class="streamTypeError ? 'field-error' : ''"
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
            @update:model-value="streamTypeError = false; updateStreams()"
            behavior="menu"
          />
        </div>

        <!-- Stream Name -->
        <div class="tw:flex tw:items-center tw:gap-1.5">
          <label class="alert-v3-inline-label">{{ t("alerts.stream_name") }} <span class="tw:text-red-500">*</span></label>
          <q-select
            ref="streamNameRef"
            data-test="add-alert-stream-name-select-dropdown"
            v-model="formData.stream_name"
            :options="filteredStreams"
            :loading="isFetchingStreams"
            color="input-border"
            class="no-case alert-v3-field stream-name-select"
            :class="streamNameError ? 'field-error' : ''"
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
            @update:model-value="streamNameError = false; updateStreamFields($event)"
            behavior="menu"
          />
          <q-tooltip v-if="!formData.stream_type">{{ t('alerts.selectStreamTypeFirst') }}</q-tooltip>
        </div>

        <!-- Alert Type -->
        <div class="tw:flex tw:items-center tw:gap-1.5">
          <label class="alert-v3-inline-label">{{ t("alerts.alertType") || 'Alert Type' }}</label>
          <q-select
            v-model="formData.is_real_time"
            :options="alertTypeOptions"
            emit-value
            map-options
            dense
            borderless
            hide-bottom-space
            :disable="beingUpdated || anomalyEditMode"
            class="alert-v3-field alert-type-select"
          />
        </div>
        </div>
      </div>

      <!-- TIER 3: Configuration Tabs -->
      <div class="alert-v3-tabs card-container" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
        <!-- Tab Headers -->
        <OToggleGroup
          :model-value="activeTab"
          @update:model-value="activeTab = ($event as string)"
          class="tw:shrink-0"
        >
          <OToggleGroupItem
            v-for="tab in alertTabs"
            :key="tab.key"
            :value="tab.key"
            size="sm"
          >
            <template #icon-left>
              <Shield v-if="tab.key === 'condition'" class="tw:size-3.5 tw:shrink-0" />
              <SlidersHorizontal v-else-if="tab.key === 'advanced'" class="tw:size-3.5 tw:shrink-0" />
              <TrendingUp v-else-if="tab.key === 'anomaly-config'" class="tw:size-3.5 tw:shrink-0" />
              <Bell v-else-if="tab.key === 'anomaly-alerting'" class="tw:size-3.5 tw:shrink-0" />
            </template>
            {{ tab.label }}{{ tab.required ? ' *' : '' }}
          </OToggleGroupItem>
        </OToggleGroup>

        <!-- Tab Content -->
        <q-form ref="addAlertForm" class="tw:flex-1 tw:overflow-auto" @submit="onSubmit">
          <!-- Alert Rules Tab (Conditions + Alert Settings merged) -->
          <div v-show="activeTab === 'condition'" class="tw:flex tw:flex-col tw:gap-4">
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

          <div v-show="activeTab === 'advanced'" class="tw:flex tw:flex-col tw:gap-4">

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

          <div v-show="activeTab === 'anomaly-config'">
            <AnomalyDetectionConfig
              ref="anomalyStep2Ref"
              :config="anomalyConfig"
            />
          </div>

          <div v-show="activeTab === 'anomaly-alerting'">
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
        <OButton
          data-test="add-alert-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="$emit('cancel:hideform')"
        >{{ t('alerts.cancel') }}</OButton>
        <OButton
          data-test="add-alert-submit-btn"
          variant="primary"
          size="sm-action"
          :loading="isAnomalyMode ? anomalySaving : false"
          :disabled="isAnomalyMode ? !canSaveAlert : false"
          @click="handleSave"
        >{{ isAnomalyMode && !anomalyEditMode ? t('alerts.saveAndTrain') : t('alerts.save') }}</OButton>
      </div>

      </div><!-- end LEFT column wrapper -->

      <!-- TIER 2: Preview + Summary (RIGHT 30%) -->
      <div class="tw:flex tw:flex-col tw:gap-2" style="flex: 3.5; min-width: 0; min-height: 0; overflow: hidden;">
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
                {{ activeEvaluationStatus.wouldTrigger ? t('alerts.wouldTrigger') : t('alerts.wouldNotTrigger') }}
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
                  {{ t('alerts.previewEmptyState') }}
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

  <ODrawer data-test="add-alert-json-editor-drawer"
    v-model:open="showJsonEditorDialog"
    size="lg"
    :title="t('alerts.editJson')"
    persistent
  >
    <JsonEditor
      :data="formData"
      :title="t('alerts.editJson')"
      :type="'alerts'"
      :validation-errors="validationErrors"
      @close="showJsonEditorDialog = false"
      @saveJson="saveAlertJson"
      :isEditing="beingUpdated"
    />
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent, computed, watch } from "vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import { Shield, SlidersHorizontal, TrendingUp, Bell } from 'lucide-vue-next';

import JsonEditor from "../common/JsonEditor.vue";
import QueryConfig from "./steps/QueryConfig.vue";
import AlertSettings from "./steps/AlertSettings.vue";
import CompareWithPast from "./steps/CompareWithPast.vue";
import Deduplication from "./steps/Deduplication.vue";
import Advanced from "./steps/Advanced.vue";
import InlineSelectFolderDropdown from "../common/sidebar/InlineSelectFolderDropdown.vue";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";
import AnomalyDetectionConfig from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.vue";
import AnomalyAlerting from "@/components/anomaly_detection/steps/AnomalyAlerting.vue";
import AnomalySummary from "@/components/anomaly_detection/AnomalySummary.vue";
import QueryEditor from "@/components/QueryEditor.vue";
import { useAlertForm, defaultAlertValue } from "@/composables/useAlertForm";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";

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
    QueryConfig,
    AlertSettings,
    CompareWithPast,
    Deduplication,
    Advanced,
    PreviewAlert,
    AlertSummary,
    AnomalyDetectionConfig,
    AnomalyAlerting,
    AnomalySummary,
    QueryEditor,
    InlineSelectFolderDropdown,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    ODrawer,
    Shield,
    SlidersHorizontal,
    TrendingUp,
    Bell,
  },
  setup(props, { emit }) {
    const alertForm = useAlertForm(props, emit);

    const isAnomalyDetectionEnabled = computed(
      () => alertForm.store.state.zoConfig.anomaly_detection_enabled === true,
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

    const activeEvaluationStatus = computed(() =>
      alertForm.previewAlertRef.value?.evaluationStatus || null
    );
    const alertTypeOptions = computed(() => [
      { label: alertForm.t("alerts.scheduled"), value: "false" },
      { label: alertForm.t("alerts.realTime"), value: "true" },
      ...(isAnomalyDetectionEnabled.value
        ? [{ label: alertForm.t("alerts.anomalyDetection"), value: "anomaly" }]
        : []),
    ]);

    const alertTabs = computed(() => {
      const tabs = alertForm.isAnomalyMode.value
        ? [
            { key: "anomaly-config", label: alertForm.t("alerts.anomalyDetectionConfig"), required: true },
            { key: "anomaly-alerting", label: alertForm.t("alerts.alerting") || "Alerting", required: alertForm.anomalyConfig.value.alert_enabled },
          ]
        : [
            { key: "condition", label: "Alert Rules", required: true },
            { key: "advanced", label: alertForm.t("alerts.steps.advanced") },
          ];
      return tabs.filter((tab: any) => (tab as any).show !== false);
    });

    const activeFolderName = computed(() => {
      const folders = alertForm.store.state.organizationData.foldersByType?.alerts ?? [];
      const found = folders.find((f: any) => f.folderId === alertForm.activeFolderId.value);
      return found?.name ?? "default";
    });

    const goBackToAlertsList = () => {
      return alertForm.router.push({
        path: "/alerts",
        query: {
          folder: alertForm.activeFolderId.value ?? "default",
        },
      });
    };

    return {
      ...alertForm,
      isAnomalyDetectionEnabled,
      alertTypeOptions,
      alertTabs,
      activeFolderName,
      goBackToAlertsList,
      activeEvaluationStatus,
    };
  },

});
</script>

<style scoped lang="scss">
.alert-v3-inline-label {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: rgba(0, 0, 0, 0.72);
}

.body--dark .alert-v3-inline-label {
  color: rgba(255, 255, 255, 0.7);
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

// Error highlight for topbar fields — combined selector beats .body--dark .alert-v3-field specificity
.alert-v3-field.field-error {
  :deep(.q-field__control) {
    border-color: #ef5350 !important;
    background: rgba(239, 83, 80, 0.05) !important;
  }
}
.body--dark .alert-v3-field.field-error {
  :deep(.q-field__control) {
    border-color: #ef5350 !important;
    background: rgba(239, 83, 80, 0.08) !important;
  }
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

</style>
<style lang="scss">
// ── Section header (matches QueryConfig.vue pattern) ───────────────────────
.section-header {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 10px 12px;
  border-bottom: 1px solid #e6e6e6;
}

body.body--dark .section-header {
  border-bottom-color: #343434;
}

.section-header-accent {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
  background: var(--q-primary);
}

.section-header-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

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
  height: 2.3rem;
  line-height: 1.3rem;
  font-size: 12px;
  margin-top: 0.1rem;
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


// Folder name — exact same as ViewDashboard.vue
.alert-folder-name {
  color: var(--o2-menu-color) !important;
}

.alert-folder-name:hover {
  border-radius: 0.325rem;
  background-color: var(--o2-tab-bg) !important;
}

// Folder breadcrumb select — matches q-table__title sizing/weight
.topbar-folder-select {
  min-width: 60px;
  max-width: 140px;

  :deep(.q-field__control) { padding: 0; }

  :deep(.q-field__native) {
    font-size: 1.25rem;
    font-weight: 500;
    cursor: pointer;
  }
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
// ── Stream Config card responsive container queries ───────────────────────
.stream-config-card {
  container-type: inline-size;
  container-name: stream-config;
}

.stream-type-select { width: 150px; }
.stream-name-select { width: 160px; }
.alert-type-select  { min-width: 110px; }

@container stream-config (max-width: 900px) {
  .stream-type-select { width: 110px; }
  .stream-name-select { width: 120px; }
  .alert-type-select  { min-width: 95px; }
}

@container stream-config (max-width: 750px) {
  .stream-type-select { width: 110px; }
  .stream-name-select { width: 110px; }
  .alert-type-select  { min-width: 85px; }
}

@container stream-config (max-width: 600px) {
  .stream-type-select { width: 70px; }
  .stream-name-select { width: 80px; }
  .alert-type-select  { min-width: 75px; }
}
// ───────────────────────────────────────────────────────────────────────────
</style>
