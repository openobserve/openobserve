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
  <div class="w-full h-full">

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- V3 "Single Pane of Glass" Layout (All alert types)                -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
      <div class="flex flex-col h-full">
      <AppPageHeader
        class="alert-v3-topbar [container-type:inline-size] [container-name:topbar] shrink-0 px-4 border-b border-border-default"
        :back="{
          label: activeFolderName || t('alerts.header'),
          onClick: goBackToAlertsList,
          dataTest: 'add-alert-back-btn',
        }"
        :subtitle="(beingUpdated || anomalyEditMode) ? activeFolderName : ''"
      >
        <!-- EDIT MODE: the alert/anomaly name is the title and the folder its
             subtitle — matching the dashboard header. CREATE MODE keeps the
             inline name input + folder select in the #tabs area (an <h1> can't
             host form inputs), per the AddPanel convention. -->
        <template #title>
          <template v-if="beingUpdated || anomalyEditMode">
            <span
              v-if="!isAnomalyMode"
              class="truncate"
              :title="formData.name"
            >
              {{ formData.name }}
              <OTooltip v-if="formData.name?.length > 24" :content="formData.name" />
            </span>
            <span
              v-else
              class="truncate"
              :title="anomalyConfig.name"
            >
              {{ anomalyConfig.name }}
              <OTooltip v-if="anomalyConfig.name?.length > 24" :content="anomalyConfig.name" />
            </span>
          </template>
        </template>

        <!-- EDIT MODE (anomaly): status + last-run + retry trail the name -->
        <template #title-trail>
          <div
            v-if="(beingUpdated || anomalyEditMode) && isAnomalyMode"
            class="flex items-center gap-1.5"
          >
            <OTag v-if="anomalyConfig.status" type="anomalyStatus" :value="anomalyConfig.status" />
            <span
              v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
              class="text-2xs whitespace-nowrap text-text-secondary"
            >
              Last run: {{ anomalyFormatTs(anomalyConfig.last_detection_run) }}
            </span>
            <OButton v-if="anomalyConfig.status === 'failed'" variant="ghost-destructive" size="xs" :loading="anomalyRetraining" @click="anomalyTriggerRetrain" icon-left="replay">
              {{ t('alerts.retry') }}
            </OButton>
          </div>
        </template>

        <!-- CREATE MODE: Alert Name input + Folder select, inline beside the back tile -->
        <template #tabs>
          <div
            v-if="!(beingUpdated || anomalyEditMode)"
            class="flex items-center gap-1.5 min-w-0"
          >
            <div class="flex items-center gap-1.5 shrink-0">
              <div class="text-xs font-semibold whitespace-nowrap text-text-label">{{ isAnomalyMode ? t('alerts.anomalyName') : t('alerts.incidents.alertName') }} <span class="text-text-primary">*</span></div>
              <OInput
                v-if="!isAnomalyMode"
                ref="step1Ref"
                v-model="formData.name"
                data-test="add-alert-name-input"
                :placeholder="t('alerts.alertNamePlaceholder')"
                class="topbar-name-input text-sm h-7! min-h-7! min-w-30 max-w-37.5 @max-[1300px]/topbar:min-w-25 @max-[850px]/topbar:min-w-22.5 @max-[680px]/topbar:min-w-17.5"
                :class="alertNameError ? 'field-error' : ''"
                @update:model-value="alertNameError = false"
              />
              <OInput
                v-else
                ref="anomalyNameRef"
                v-model="anomalyConfig.name"
                :placeholder="t('alerts.anomalyNamePlaceholder')"
                class="topbar-name-input text-sm h-7! min-h-7! min-w-30 max-w-37.5 @max-[1300px]/topbar:min-w-25 @max-[850px]/topbar:min-w-22.5 @max-[680px]/topbar:min-w-17.5"
              />
            </div>

            <!-- Folder -->
            <div class="flex items-center gap-1.5 shrink-0">
              <div class="text-xs font-semibold whitespace-nowrap text-text-label">{{ t('alerts.folder') }}</div>
              <InlineSelectFolderDropdown
                :model-value="activeFolderId"
                type="alerts"
                class="topbar-folder-select min-w-15 max-w-35"
                @update:model-value="updateActiveFolderId({ value: $event })"
              />
            </div>
          </div>
        </template>
      </AppPageHeader>

      <div class="flex flex-1 min-h-0">

      <!-- LEFT column wrapper (flex: 6.5) -->
      <div class="flex-[6.5] min-w-0 min-h-0 flex flex-col gap-2 py-2">

      <!-- Stream Name & Stream Type -->
      <div class="bg-card-glass-bg shrink-0 stream-config-card [container-type:inline-size] [container-name:stream-config]">
        <div class="flex items-center gap-0 py-2.5 px-3 border-b border-border-default">
          <div class="w-0.75 h-4 rounded-sm mr-2 shrink-0 bg-theme-accent" />
          <span class="text-compact font-semibold tracking-[0.01em]">{{ t('alerts.streamConfig') }} <span class="text-text-primary">*</span></span>
        </div>
        <div class="flex items-center gap-4 px-3 py-2">
        <!-- Stream Type -->
        <div class="flex items-center gap-1.5">
          <div class="text-xs font-semibold whitespace-nowrap text-text-label">{{ t("alerts.streamType") }} <span class="text-text-primary">*</span></div>
          <OSelect
            ref="streamTypeRef"
            data-test="add-alert-stream-type-select-dropdown"
            v-model="formData.stream_type"
            :options="streamTypes"
            :searchable="false"
            class="stream-type-select h-7! min-h-7! w-37.5 @max-[900px]/stream-config:w-27.5 @max-[600px]/stream-config:w-17.5"
            :class="streamTypeError ? 'field-error' : ''"
            :disabled="beingUpdated || anomalyEditMode"
            @update:model-value="streamTypeError = false; updateStreams()"
          />
        </div>

        <!-- Stream Name -->
        <div class="flex items-center gap-1.5">
          <div class="text-xs font-semibold whitespace-nowrap text-text-label">{{ t("alerts.stream_name") }} <span class="text-text-primary">*</span></div>
          <OSelect
            ref="streamNameRef"
            data-test="add-alert-stream-name-select-dropdown"
            v-model="formData.stream_name"
            :options="indexOptions"
            :loading="isFetchingStreams"
            class="stream-name-select h-7! min-h-7! w-40 @max-[900px]/stream-config:w-30 @max-[750px]/stream-config:w-27.5 @max-[600px]/stream-config:w-20"
            :class="streamNameError ? 'field-error' : ''"
            :disabled="beingUpdated || anomalyEditMode || !formData.stream_type"
            @update:model-value="streamNameError = false; updateStreamFields($event)"
          />
          <OTooltip v-if="!formData.stream_type" :content="t('alerts.selectStreamTypeFirst')" />
        </div>

        <!-- Alert Type -->
        <div class="flex items-center gap-1.5">
          <div class="text-xs font-semibold whitespace-nowrap text-text-label">{{ t("alerts.alertType") || 'Alert Type' }}</div>
          <OSelect
            data-test="add-alert-type-select-dropdown"
            v-model="formData.is_real_time"
            :options="alertTypeOptions"
            :disabled="beingUpdated || anomalyEditMode"
            class="alert-type-select h-7! min-h-7! min-w-27.5 @max-[900px]/stream-config:min-w-23.75 @max-[750px]/stream-config:min-w-21.25 @max-[600px]/stream-config:min-w-18.75"
            :searchable="false"
          />
        </div>
        </div>
      </div>

      <!-- TIER 3: Configuration Tabs -->
      <div class="alert-v3-tabs bg-card-glass-bg flex-1 min-h-0 flex flex-col mx-2">
        <!-- Tab Headers -->
        <OToggleGroup
          :model-value="activeTab"
          @update:model-value="activeTab = ($event as string)"
          class="shrink-0"
        >
          <OToggleGroupItem
            v-for="tab in alertTabs"
            :key="tab.key"
            :value="tab.key"
            size="sm"
            :data-test="`add-alert-tab-${tab.key}`"
          >
            <template #icon-left>
              <OIcon v-if="tab.key === 'condition'" name="shield" size="sm" />
              <OIcon v-else-if="tab.key === 'advanced'" name="tune" size="sm" />
              <OIcon v-else-if="tab.key === 'anomaly-config'" name="trending-up" size="sm" />
              <OIcon v-else-if="tab.key === 'anomaly-alerting'" name="notifications" size="sm" />
            </template>
            {{ tab.label }}{{ tab.required ? ' *' : '' }}
          </OToggleGroupItem>
        </OToggleGroup>

        <!-- Tab Content -->
        <div class="flex-1 overflow-auto">
          <!-- Alert Rules Tab (Conditions + Alert Settings merged) -->
          <div v-show="activeTab === 'condition'" class="flex flex-col gap-4">
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

          <div v-show="activeTab === 'advanced'" class="flex flex-col gap-4">

            <!-- Additional Settings (first) -->
            <div>
              <Advanced
                :template="formData.template"
                :templates="templates"
                :contextAttributes="formData.context_attributes"
                :description="formData.description"
                :rowTemplate="formData.row_template"
                :rowTemplateType="formData.row_template_type"
                :destinations="destinations"
                :selectedDestinations="formData.destinations"
                :alertName="formData.name"
                :streamName="formData.stream_name"
                :streamType="formData.stream_type"
                :triggerCondition="formData.trigger_condition"
                :streamFields="filteredColumns"
                @update:template="(val) => (formData.template = val)"
                @refresh:templates="refreshTemplates"
                @update:contextAttributes="(val) => (formData.context_attributes = val)"
                @update:description="(val) => (formData.description = val)"
                @update:rowTemplate="(val) => (formData.row_template = val)"
                @update:rowTemplateType="(val) => (formData.row_template_type = val)"
              />
            </div>

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
        </div>
      </div><!-- end TIER 3 card -->

      <!-- Footer: Cancel / Save (left column, separate card) -->
      <div
        class="bg-card-glass-bg flex items-center justify-end px-3 py-2.5 shrink-0 gap-2 border-t border-border-default"
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
      <!-- border-l: full-height vertical divider flush against the Preview/Summary pane -->
      <div class="flex flex-col gap-2 border-l border-border-default pt-2 pb-2 flex-[3.5] min-w-0 min-h-0 overflow-hidden">
        <!-- Preview Card -->
        <div class="bg-card-glass-bg overflow-hidden flex flex-col flex-1 min-h-0">
          <div
            class="flex items-center px-3 py-2.5 select-none border-b border-border-default shrink-0 gap-2"
          >
            <span class="text-sm font-medium">{{ isAnomalyMode ? t('alerts.sqlPreview') : (t('alerts.preview') || 'Preview') }}</span>
            <template v-if="!isAnomalyMode && activeEvaluationStatus">
              <div class="w-px h-4 bg-border-default" />
              <OIcon :name="activeEvaluationStatus.wouldTrigger ? 'check-circle' : 'cancel'" :class="activeEvaluationStatus.wouldTrigger ? 'text-status-positive' : 'text-gray'" size="sm" />
              <span class="text-xs font-semibold" :class="activeEvaluationStatus.wouldTrigger ? 'text-status-positive' : 'text-gray'">
                {{ activeEvaluationStatus.wouldTrigger ? t('alerts.wouldTrigger') : t('alerts.wouldNotTrigger') }}
              </span>
              <span class="text-xs opacity-60">{{ activeEvaluationStatus.reason }}</span>
            </template>
          </div>
          <div class="flex-1 min-h-0 overflow-hidden">
            <template v-if="isAnomalyMode">
              <!-- editor-height is QueryEditor's own API for this; a class cannot
                   win against the inline height its rootStyle always sets. -->
              <QueryEditor editor-id="anomaly-sql-preview" language="sql" :read-only="true" :show-auto-complete="false" :hide-nl-toggle="true" :query="anomalyPreviewSql" editor-height="100%" />
            </template>
            <template v-else>
              <div v-if="!formData.stream_name" class="flex flex-col items-center justify-center h-full gap-2">
                <OIcon name="query-stats" size="lg" class="opacity-20" />
                <span class="text-sm font-medium text-text-secondary">
                  {{ t('alerts.previewEmptyState') }}
                </span>
              </div>
              <preview-alert class="w-full h-full"
                v-else
                ref="previewAlertRef"
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
        <div class="bg-card-glass-bg overflow-hidden flex flex-col flex-1 min-h-0">
          <div
            class="flex items-center px-3 py-2.5 select-none border-b border-border-default shrink-0"
          >
            <span class="text-sm font-medium">{{ t('alerts.summary.title') || 'Summary' }}</span>
          </div>
          <div class="flex-1 min-h-0 overflow-auto">
            <AnomalySummary class="h-full overflow-auto"
              v-if="isAnomalyMode"
              :config="anomalyConfig"
              :destinations="destinations"
              :wizard-step="3"
            />
            <alert-summary class="h-full"
              v-else
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
import { defineComponent, computed, watch, provide } from "vue";
import OButton from '@/lib/core/Button/OButton.vue';
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue';
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue';
import OIcon from '@/lib/core/Icon/OIcon.vue';

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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

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
    OIcon,
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
    OTag,
    OTooltip,
    OInput,
    OSelect,
    AppPageHeader,
  },
  setup(props, { emit }) {
    const alertForm = useAlertForm(props, emit);

    // Share server SQL-validation squiggle ranges with the descendant query
    // editors (QueryEditorDialog / QueryConfig) via inject.
    provide("alertSqlErrorRanges", alertForm.sqlErrorRanges);

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
            { key: "condition", label: alertForm.t("alerts.alertRules"), required: true },
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

<style scoped>
/* keep(complex-state): `.alert-field-highlight` is a transient state class that
   AlertFocusManager (utils/alerts/focusManager.ts) adds/removes at RUNTIME via
   classList on refs registered from useAlertForm — no template ever writes it,
   so it cannot become a template utility. AddAlert is the alert-form root and
   owns every registered field's DOM (incl. the QueryConfig subtree, which
   instantiates its own focusManager), so one `:deep()` here covers them all.
   `!important` is preserved: it must beat the field components' own border
   utilities, exactly as the previous global rule did. */
:deep(.alert-field-highlight) {
  border: 0.125rem solid var(--color-accent) !important;
  border-radius: 0.25rem;
  transition: border 0.3s ease;
}
</style>
