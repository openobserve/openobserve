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
  <!-- AddAlert OWNS the ONE form (Rule ③ owner pattern): `form` is created in
       setup() via useAlertForm's useOForm and handed to <OForm :form> so the
       topbar OForm* fields and the already-migrated descendant steps
       (QueryConfig / AlertSettings) bind by nested `name=` into it. -->
  <OForm :form="form" v-slot="{ isSubmitting }" class="h-full w-full">
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- V3 "Single Pane of Glass" Layout (All alert types)                -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <OPageLayout bleed>
      <template #header>
        <OPageHeader
          class="alert-v3-topbar border-border-default [container-type:inline-size] shrink-0 border-b [container-name:topbar]"
          :back="{
            label: activeFolderName || t('alerts.header'),
            onClick: goBackToAlertsList,
            dataTest: 'add-alert-back-btn',
          }"
          :subtitle="beingUpdated || anomalyEditMode ? activeFolderName : ''"
        >
          <!-- EDIT MODE: the alert/anomaly name is the title and the folder its
             subtitle — matching the dashboard header. CREATE MODE keeps the
             inline name input + folder select in the #tabs area (an <h1> can't
             host form inputs), per the AddPanel convention. -->
          <template #title>
            <template v-if="beingUpdated || anomalyEditMode">
              <span v-if="!isAnomalyMode" class="truncate" :title="formData.name">
                {{ formData.name }}
                <OTooltip v-if="formData.name?.length > 24" :content="formData.name" />
              </span>
              <span v-else class="truncate" :title="anomalyConfig.name">
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
              <OTag
                v-if="anomalyConfig.status"
                type="anomalyStatus"
                :value="anomalyConfig.status"
              />
              <span
                v-if="anomalyConfig.last_detection_run && anomalyConfig.last_detection_run > 0"
                class="text-2xs text-text-secondary whitespace-nowrap"
              >
                {{
                  t("alerts.lastRun", { time: anomalyFormatTs(anomalyConfig.last_detection_run) })
                }}
              </span>
              <OButton
                v-if="anomalyConfig.status === 'failed'"
                variant="ghost-destructive"
                size="xs"
                :loading="anomalyRetraining"
                @click="anomalyTriggerRetrain"
                icon-left="replay"
              >
                {{ t("alerts.retry") }}
              </OButton>
            </div>
          </template>

          <!-- CREATE MODE: Alert Name input + Folder select, inline beside the back tile -->
          <template #tabs>
            <div
              v-if="!(beingUpdated || anomalyEditMode)"
              class="flex min-w-0 items-center gap-1.5"
            >
              <div class="flex shrink-0 items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ isAnomalyMode ? t("alerts.anomalyName") : t("alerts.incidents.alertName") }}
                  <span class="text-text-body">*</span>
                </div>
                <OFormInput
                  v-if="!isAnomalyMode"
                  ref="step1Ref"
                  name="name"
                  data-test="add-alert-name-input"
                  :placeholder="t('alerts.alertNamePlaceholder')"
                  class="topbar-name-input h-7! min-h-7! max-w-37.5 min-w-30 text-sm @max-[1300px]/topbar:min-w-25 @max-[850px]/topbar:min-w-22.5 @max-[680px]/topbar:min-w-17.5"
                />
                <!-- Anomaly name binds the SAME `name` field as the alert name, not
                   `anomalyConfig.name`: a bare OInput has no field for the schema
                   to paint, so a blank name could only ever toast. useAlertForm's
                   formData.name → anomalyConfig.name watcher still feeds the value
                   saveAnomalyDetection reads, and anomaly edit-load already seeds
                   it via setF("name", data.name). -->
                <OFormInput
                  v-else
                  ref="anomalyNameRef"
                  name="name"
                  data-test="add-anomaly-name-input"
                  :placeholder="t('alerts.anomalyNamePlaceholder')"
                  class="topbar-name-input h-7! min-h-7! max-w-37.5 min-w-30 text-sm @max-[1300px]/topbar:min-w-25 @max-[850px]/topbar:min-w-22.5 @max-[680px]/topbar:min-w-17.5"
                />
              </div>

              <!-- Folder -->
              <div class="flex shrink-0 items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.folder") }}
                </div>
                <InlineSelectFolderDropdown
                  :model-value="activeFolderId as string"
                  type="alerts"
                  class="topbar-folder-select max-w-35 min-w-15"
                  @update:model-value="updateActiveFolderId({ value: $event })"
                />
              </div>
            </div>
          </template>
        </OPageHeader>
      </template>

      <div class="flex min-h-0 flex-1">
        <!-- LEFT column wrapper (flex: 6.5) -->
        <div class="flex min-h-0 min-w-0 flex-[6.5] flex-col gap-2 py-2">
          <!-- Stream Name & Stream Type -->
          <div
            class="bg-card-glass-bg stream-config-card [container-type:inline-size] shrink-0 [container-name:stream-config]"
          >
            <div class="border-border-default flex items-center gap-0 border-b px-3 py-2.5">
              <div class="rounded-default bg-theme-accent mr-2 h-4 w-0.75 shrink-0" />
              <span class="text-compact font-semibold tracking-[0.01em]"
                >{{ t("alerts.streamConfig") }} <span class="text-text-body">*</span></span
              >
            </div>
            <div class="flex items-center gap-4 px-3 py-2">
              <!-- Stream Type -->
              <div class="flex items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.streamType") }} <span class="text-text-body">*</span>
                </div>
                <OFormSelect
                  ref="streamTypeRef"
                  name="stream_type"
                  data-test="add-alert-stream-type-select-dropdown"
                  :options="streamTypes"
                  :searchable="false"
                  class="stream-type-select w-37.5! @max-[900px]/stream-config:w-27.5! @max-[600px]/stream-config:w-17.5!"
                  :disabled="beingUpdated || anomalyEditMode"
                  @update:model-value="onStreamTypeChange"
                />
              </div>

              <!-- Stream Name -->
              <div class="flex items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.stream_name") }} <span class="text-text-body">*</span>
                </div>
                <OFormSelect
                  ref="streamNameRef"
                  name="stream_name"
                  data-test="add-alert-stream-name-select-dropdown"
                  :options="indexOptions"
                  :loading="isFetchingStreams"
                  class="stream-name-select w-40! @max-[900px]/stream-config:w-30! @max-[750px]/stream-config:w-27.5! @max-[600px]/stream-config:w-20!"
                  :disabled="beingUpdated || anomalyEditMode || !formData.stream_type"
                  @update:model-value="updateStreamFields($event)"
                />
                <OTooltip
                  v-if="!formData.stream_type"
                  :content="t('alerts.selectStreamTypeFirst')"
                />
              </div>

              <!-- Alert Type -->
              <div class="flex items-center gap-1.5">
                <div class="text-text-heading text-xs font-semibold whitespace-nowrap">
                  {{ t("alerts.alertType") }}
                </div>
                <OFormSelect
                  data-test="add-alert-type-select-dropdown"
                  name="is_real_time"
                  :options="alertTypeOptions"
                  :disabled="beingUpdated || anomalyEditMode"
                  class="alert-type-select min-w-27.5 @max-[900px]/stream-config:min-w-23.75 @max-[750px]/stream-config:min-w-21.25 @max-[600px]/stream-config:min-w-18.75"
                  :searchable="false"
                />
              </div>
            </div>
          </div>

          <!-- TIER 3: Configuration Tabs -->
          <div class="alert-v3-tabs bg-card-glass-bg mx-2 flex min-h-0 flex-1 flex-col">
            <!-- Tab Headers -->
            <OToggleGroup
              :model-value="activeTab"
              @update:model-value="activeTab = $event as string"
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
                  <OIcon
                    v-else-if="tab.key === 'anomaly-alerting'"
                    name="notifications"
                    size="sm"
                  />
                </template>
                {{ tab.label }}{{ tab.required ? " *" : "" }}
              </OToggleGroupItem>
            </OToggleGroup>

            <!-- Tab Content -->
            <div class="flex-1 overflow-auto">
              <!-- Alert Rules Tab (Conditions + Alert Settings merged) -->
              <!-- data-tab-pane: lets focusOnFirstError find the tab owning an
               invalid field and bring it forward before focusing it. -->
              <div
                v-show="activeTab === 'condition'"
                data-tab-pane="condition"
                class="flex flex-col gap-4"
              >
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
                    @update:sqlQuery="updateSqlQuery"
                    @update:promqlQuery="updatePromqlQuery"
                    @update:vrlFunction="updateVrlFunction"
                    @validate-sql="validateSqlQuery"
                    @clear-multi-windows="clearMultiWindows"
                    @editor-closed="handleEditorClosed"
                    @editor-state-changed="handleEditorStateChanged"
                    @update:isAggregationEnabled="(value) => (isAggregationEnabled = value)"
                    @update:aggregation="updateAggregation"
                    @update:promqlCondition="updatePromqlCondition"
                    @update:triggerCondition="updateTriggerCondition"
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
                    :workflows="formData.workflows"
                    @update:trigger="updateTriggerCondition"
                    @update:aggregation="updateAggregation"
                    @update:isAggregationEnabled="(val) => (isAggregationEnabled = val)"
                    @update:promqlCondition="updatePromqlCondition"
                    @update:destinations="updateDestinations"
                    @refresh:destinations="refreshDestinations"
                    @update:workflows="updateWorkflows"
                  />
                </div>
              </div>

              <div
                v-show="activeTab === 'advanced'"
                data-tab-pane="advanced"
                class="flex flex-col gap-4"
              >
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
                    @update:template="updateTemplate"
                    @refresh:templates="refreshTemplates"
                    @update:contextAttributes="updateContextAttributes"
                    @update:description="updateDescription"
                    @update:rowTemplate="updateRowTemplate"
                    @update:rowTemplateType="updateRowTemplateType"
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
                    @update:multiTimeRange="updateMultiTimeRange"
                  />
                </div>

                <!-- Deduplication (scheduled only) -->
                <div v-if="formData.is_real_time === 'false'">
                  <Deduplication
                    :deduplication="formData.deduplication"
                    :columns="filteredColumns"
                    @update:deduplication="updateDeduplication"
                  />
                </div>
              </div>

              <div v-show="activeTab === 'anomaly-config'" data-tab-pane="anomaly-config">
                <AnomalyDetectionConfig ref="anomalyStep2Ref" :config="anomalyConfig" />
              </div>

              <div v-show="activeTab === 'anomaly-alerting'" data-tab-pane="anomaly-alerting">
                <AnomalyAlerting
                  :config="anomalyConfig"
                  :destinations="destinations as (SelectOption & { name: string })[]"
                  @refresh:destinations="$emit('refresh:destinations')"
                />
              </div>
            </div>
          </div>
          <!-- end TIER 3 card -->

          <!-- Footer: Cancel / Save (left column, separate card) -->
          <div
            class="bg-card-glass-bg border-border-default flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2.5"
          >
            <OButton
              data-test="add-alert-cancel-btn"
              variant="outline"
              size="sm-action"
              :disabled="isSubmitting"
              @click="$emit('cancel:hideform')"
              >{{ t("alerts.cancel") }}</OButton
            >
            <OButton
              data-test="add-alert-submit-btn"
              variant="primary"
              size="sm-action"
              :loading="isSubmitting || (isAnomalyMode && anomalySaving)"
              @click="handleSave"
              >{{
                isAnomalyMode && !anomalyEditMode ? t("alerts.saveAndTrain") : t("alerts.save")
              }}</OButton
            >
          </div>
        </div>
        <!-- end LEFT column wrapper -->

        <!-- TIER 2: Preview + Summary (RIGHT 30%) -->
        <!-- border-l: full-height vertical divider flush against the Preview/Summary pane -->
        <div
          class="border-border-default flex min-h-0 min-w-0 flex-[3.5] flex-col gap-2 overflow-hidden border-l pt-2 pb-2"
        >
          <!-- Preview Card -->
          <div class="bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              class="border-border-default flex shrink-0 items-center gap-2 border-b px-3 py-2.5 select-none"
            >
              <span class="text-sm font-medium">{{
                isAnomalyMode ? t("alerts.sqlPreview") : t("alerts.preview")
              }}</span>
              <template v-if="!isAnomalyMode && activeEvaluationStatus">
                <div class="bg-border-default h-4 w-px" />
                <OIcon
                  :name="activeEvaluationStatus.wouldTrigger ? 'check-circle' : 'cancel'"
                  :class="
                    activeEvaluationStatus.wouldTrigger ? 'text-status-positive' : 'text-gray'
                  "
                  size="sm"
                />
                <span
                  class="text-xs font-semibold"
                  :class="
                    activeEvaluationStatus.wouldTrigger ? 'text-status-positive' : 'text-gray'
                  "
                >
                  {{
                    activeEvaluationStatus.wouldTrigger
                      ? t("alerts.wouldTrigger")
                      : t("alerts.wouldNotTrigger")
                  }}
                </span>
                <span class="text-xs opacity-60">{{ activeEvaluationStatus.reason }}</span>
              </template>
            </div>
            <div class="min-h-0 flex-1 overflow-hidden">
              <template v-if="isAnomalyMode">
                <!-- editor-height is QueryEditor's own API for this; a class cannot
                   win against the inline height its rootStyle always sets. -->
                <QueryEditor
                  editor-id="anomaly-sql-preview"
                  language="sql"
                  :read-only="true"
                  :show-auto-complete="false"
                  :hide-nl-toggle="true"
                  :query="anomalyPreviewSql"
                  editor-height="100%"
                />
              </template>
              <template v-else>
                <div
                  v-if="!formData.stream_name"
                  class="flex h-full flex-col items-center justify-center gap-2"
                >
                  <OIcon name="query-stats" size="lg" class="opacity-20" />
                  <span class="text-text-secondary text-sm font-medium">
                    {{ t("alerts.previewEmptyState") }}
                  </span>
                </div>
                <PreviewAlert
                  class="h-full w-full"
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
          <div class="bg-card-glass-bg flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              class="border-border-default flex shrink-0 items-center border-b px-3 py-2.5 select-none"
            >
              <span class="text-sm font-medium">{{ t("alerts.summary.title") }}</span>
            </div>
            <div class="min-h-0 flex-1 overflow-auto">
              <AnomalySummary
                class="h-full overflow-auto"
                v-if="isAnomalyMode"
                :config="anomalyConfig"
                :destinations="destinations"
                :wizard-step="3"
              />
              <AlertSummary
                class="h-full"
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
    </OPageLayout>
  </OForm>

  <ODrawer
    data-test="add-alert-json-editor-drawer"
    bleed
    v-model:open="showJsonEditorDialog"
    size="lg"
    :title="t('alerts.editJson')"
    persistent
  >
    <JsonEditor
      :data="jsonEditorData"
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
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

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
  emits: ["update:list", "cancel:hideform", "refresh:destinations", "refresh:templates"],
  components: {
    OIcon,
    OPageLayout,
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
    OForm,
    OFormInput,
    OFormSelect,
    OPageHeader,
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
      },
    );

    // Switch activeTab when alert type changes to/from anomaly
    watch(
      () => alertForm.formData.value.is_real_time,
      (newVal) => {
        if (newVal === "anomaly") {
          alertForm.activeTab.value = "anomaly-config";
        } else if (alertForm.activeTab.value.startsWith("anomaly-")) {
          alertForm.activeTab.value = "condition";
        }
      },
    );

    const activeEvaluationStatus = computed(
      () => alertForm.previewAlertRef.value?.evaluationStatus || null,
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
            {
              key: "anomaly-config",
              label: alertForm.t("alerts.anomalyDetectionConfig"),
              required: true,
            },
            {
              key: "anomaly-alerting",
              label: alertForm.t("alerts.alerting"),
              required: alertForm.anomalyConfig.value.alert_enabled,
            },
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

    // Stream-type change: write the value into the ONE form explicitly (so the
    // synchronous form store is current before updateStreams reads it — not
    // relying on the OFormSelect field-change flush order), then refresh streams
    // (which also resets stream_name via setF).
    const onStreamTypeChange = (value: any) => {
      alertForm.setF("stream_type", value);
      alertForm.updateStreams();
    };

    return {
      ...alertForm,
      isAnomalyDetectionEnabled,
      alertTypeOptions,
      alertTabs,
      activeFolderName,
      goBackToAlertsList,
      onStreamTypeChange,
      activeEvaluationStatus,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:o2-form): float each control's validation message out of
   flow. A class passed to OInput/OFormSelect lands on the ROOT wrapper — the
   flex-col holding the control AND its message — so an in-flow message would
   grow these fixed-height topbar rows, escape the card, and be painted over by
   the next card. `top:100%` resolves against the wrapper; the topbar input's
   h-7 clamp genuinely compresses it, so it anchors correctly, while the three
   selects deliberately carry NO h-7 clamp (it only ever shrank the wrapper box,
   never the 2.125rem trigger, which mis-anchored the floating message).
   pointer-events:none so the floating text can't swallow clicks on the tab bar
   it overlaps. `:deep` because [role="alert"] renders inside the child
   component. All widths and container-query steps are template utilities. */
.topbar-name-input,
.stream-type-select,
.stream-name-select {
  position: relative;
}

.topbar-name-input :deep([role="alert"]),
.stream-type-select :deep([role="alert"]),
.stream-name-select :deep([role="alert"]) {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.125rem;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}
</style>

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
