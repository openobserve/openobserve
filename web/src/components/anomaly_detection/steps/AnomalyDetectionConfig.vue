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
  <div
    class="step-anomaly-config h-full"
  >
    <div
      class="step-content px-3 py-4 rounded-default h-full overflow-y-auto overflow-x-hidden bg-surface-overlay border border-border-default"
    >
      <OForm :form="form">
        <!-- Query Mode Tabs -->
        <div class="mb-4">
          <OFormToggleGroup name="query_mode" data-test="anomaly-query-tabs">
            <OToggleGroupItem
              v-for="tab in queryTabOptions"
              :key="tab.value"
              :value="tab.value"
              size="sm"
            >
              {{ tab.label }}
            </OToggleGroupItem>
          </OFormToggleGroup>
        </div>

        <!-- Filters mode -->
        <div
          v-if="queryMode === 'filters'"
          class="flex items-start mb-4! pb-0!"
        >
          <div
            class="font-semibold flex items-center"
            style="width: 178px; min-height: 36px"
          >
            {{ t("alerts.anomaly.filters") }}
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- :key must be the array INDEX — the fields bind by index-based
                 name and do not re-bind, so a stable-id key would leave inputs
                 shifted on a mid-list delete. -->
            <div
              v-for="(filter, idx) in filterRows"
              :key="idx"
              class="flex items-center gap-2 mb-2"
            >
              <OFormSelect
                :name="`filters[${idx}].field`"
                :options="filteredStreamFields"
                :placeholder="
                  filter.field ? '' : t('alerts.anomaly.fieldPlaceholder')
                "
                class="alert-v3-select filter-field-select"
                style="width: 200px"
                :loading="loadingFields"
              >
                <template #empty>
                  <div class="px-3 py-2 text-muted-foreground">
                    {{
                      config.stream_name
                        ? t("alerts.anomaly.noFieldsFound")
                        : t("alerts.anomaly.selectStreamFirst")
                    }}
                  </div>
                </template>
              </OFormSelect>
              <OFormSelect
                :name="`filters[${idx}].operator`"
                :options="filterOperators"
                class="alert-v3-select"
                style="width: 110px"
              />
              <OFormInput
                v-if="operatorNeedsValue(filter.operator)"
                :name="`filters[${idx}].value`"
                :placeholder="t('alerts.placeholders.value')"
                class="alert-v3-input"
                style="max-width: 160px"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                @click="removeFilter(idx)"
                icon-left="close"
              />
            </div>
            <OButton
              variant="outline"
              size="sm-action"
              class="mt-2"
              @click="addFilter"
            >
              {{ t("alerts.anomaly.addFilter") }}
            </OButton>
          </div>
        </div>

        <!-- Custom SQL mode -->
        <div
          v-if="queryMode === 'custom_sql'"
          class="flex items-start mb-4! pb-0!"
        >
          <div
            class="font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            SQL <span class="text-status-error-text ml-1">*</span>
          </div>
          <div style="width: calc(100% - 190px)">
            <div
              class="custom-sql-editor-wrapper h-35 rounded-default overflow-hidden border"
              :class="hasSqlError ? 'border-input-border-error' : 'border-border-default'"
            >
              <!-- Bare Monaco: value bridged into the form from the editor's
                   own change handler so the schema covers it. -->
              <QueryEditor
                data-test-prefix="anomaly-custom-sql"
                :query="customSql || ''"
                :keywords="allStreamFields"
                :show-auto-complete="true"
                :disable-ai="!config.stream_name"
                :disable-ai-reason="
                  !config.stream_name
                    ? t('alerts.anomaly.selectStreamFirst')
                    : ''
                "
                editor-height="100%"
                data-test="anomaly-custom-sql"
                @update:query="onCustomSqlChange"
              />
            </div>
            <!-- `custom_sql` is a bare editor bridged in via setFieldValue with
                 no name= binding, so the schema's issue has no field to route to
                 and THIS div is the only surface. It must mirror the schema's
                 condition exactly — the schema rejects on `!custom_sql.trim()`,
                 so a whitespace-only query must light this up too. -->
            <div
              v-if="showSqlErrors && !customSql?.trim()"
              class="text-xs text-input-error-text pt-1"
              data-test="anomaly-custom-sql-required-error"
            >
              {{ t("alerts.anomaly.sqlRequired") }}
            </div>
            <div
              v-if="showSqlErrors && hasTimestampAlias"
              class="text-xs text-input-error-text pt-1"
              data-test="anomaly-custom-sql-timestamp-alias-error"
            >
              <!-- Can't reuse alerts.validation.timestampAliasBanned (which
                   bakes `time_bucket` into its text): the slotted variant needs
                   both the column AND time_bucket as params. -->
              <i18n-t keypath="alerts.anomaly.timestampAliasBanned" tag="span">
                <template #column>
                  <code>{{
                    store.state.zoConfig.timestamp_column || "_timestamp"
                  }}</code>
                </template>
                <template #timeBucket><code>time_bucket</code></template>
              </i18n-t>
            </div>
            <div
              class="text-xs mt-1"
              :class="
                'text-text-secondary'
              "
            >
              <i18n-t keypath="alerts.anomaly.sqlColumnsHint" tag="span">
                <template #timeBucket><code>time_bucket</code></template>
                <template #valueColumn><code>value</code></template>
              </i18n-t>
            </div>
          </div>
        </div>

        <!-- Row: Detection Function + Detection Resolution (filters mode) -->
        <div
          v-if="queryMode === 'filters'"
          class="grid grid-cols-2 gap-3 items-start mb-4! pb-0!"
        >
          <!-- Detection Function -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.detectionFunction") }}
              <span class="text-status-error-text ml-1">*</span>
            </div>
            <!-- items-start, not items-center: the field select renders its
                 validation message inside its own column (OSelect's root is
                 flex-col), so on error that column grows and centering would
                 shove the function select down out of line with it. -->
            <div class="flex items-start gap-2">
              <OFormSelect
                name="detection_function"
                :options="detectionFunctions"
                data-test="anomaly-detection-function"
                class="alert-v3-select"
                style="width: 110px"
                @update:model-value="onDetectionFunctionChange"
              />
              <OFormSelect
                v-if="detectionFunction && detectionFunction !== 'count'"
                name="detection_function_field"
                :options="filteredDetectionFields"
                :placeholder="
                  detectionFunctionField
                    ? ''
                    : t('alerts.anomaly.fieldPlaceholder')
                "
                :loading="loadingFields"
                data-test="anomaly-detection-function-field"
                class="alert-v3-select"
                style="width: 140px"
              >
                <template #empty>
                  <div class="px-3 py-2 text-muted-foreground">
                    {{
                      config.stream_name
                        ? t("alerts.anomaly.noFieldsFound")
                        : t("alerts.anomaly.selectStreamFirst")
                    }}
                  </div>
                </template>
              </OFormSelect>
            </div>
          </div>
          <!-- Detection Resolution -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.anomaly.detectionResolution") }}
              <span class="text-status-error-text ml-1">*</span>
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer text-icon-color"
              >
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  :content="t('alerts.anomaly.detectionResolutionTooltip')"
                />
              </OIcon>
            </div>
            <div>
              <div class="flex items-center gap-0">
                <OFormInput
                  name="histogram_interval_value"
                  type="number"
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-histogram-interval-value"
                >
                  <!-- Message rendered below at pair width — see histogramIntervalError. -->
                  <template #error />
                </OFormInput>
                <OFormSelect
                  name="histogram_interval_unit"
                  :options="intervalUnits"
                  label-key="label"
                  value-key="value"
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-histogram-interval-unit"
                />
              </div>
              <div
                v-if="histogramIntervalError"
                class="text-xs text-input-error-text pt-1"
                data-test="anomaly-histogram-interval-error"
                role="alert"
              >
                {{ histogramIntervalError }}
              </div>
            </div>
          </div>
        </div>

        <!-- Detection Resolution alone (custom_sql mode) -->
        <div v-else class="flex items-start mb-4! pb-0!">
          <div
            class="font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            {{ t("alerts.anomaly.detectionResolution") }}
            <span class="text-status-error-text ml-1">*</span>
            <OIcon
              name="info"
              size="sm"
              class="ml-1 cursor-pointer text-icon-color"
            >
              <OTooltip
                side="right"
                align="center"
                max-width="300px"
                :content="t('alerts.anomaly.detectionResolutionTooltip')"
              />
            </OIcon>
          </div>
          <div>
            <div class="flex items-center gap-0">
              <OFormInput
                name="histogram_interval_value"
                type="number"
                min="1"
                class="alert-v3-input"
                style="width: 87px"
                data-test="anomaly-histogram-interval-value"
              >
                <!-- Message rendered below at pair width — see histogramIntervalError. -->
                <template #error />
              </OFormInput>
              <OFormSelect
                name="histogram_interval_unit"
                :options="intervalUnits"
                label-key="label"
                value-key="value"
                class="alert-v3-select"
                style="min-width: 100px"
                data-test="anomaly-histogram-interval-unit"
              />
            </div>
            <div
              v-if="histogramIntervalError"
              class="text-xs text-input-error-text pt-1"
              data-test="anomaly-histogram-interval-error"
              role="alert"
            >
              {{ histogramIntervalError }}
            </div>
          </div>
        </div>

        <!-- Row: Check Every + Look Back Window -->
        <div class="grid grid-cols-2 gap-3 items-start mb-4! pb-0!">
          <!-- Check Every -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.anomaly.checkEvery") }}
              <span class="text-status-error-text ml-1">*</span>
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer text-icon-color"
              >
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  :content="t('alerts.anomaly.checkEveryTooltip')"
                />
              </OIcon>
            </div>
            <div>
              <div class="flex items-center gap-0">
                <OFormInput
                  name="schedule_interval_value"
                  type="number"
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-schedule-interval-value"
                >
                  <!-- Message rendered below at pair width — see scheduleIntervalError. -->
                  <template #error />
                </OFormInput>
                <OFormSelect
                  name="schedule_interval_unit"
                  :options="intervalUnits"
                  label-key="label"
                  value-key="value"
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-schedule-interval-unit"
                />
              </div>
              <div
                v-if="scheduleIntervalError"
                class="text-xs text-input-error-text pt-1"
                data-test="anomaly-schedule-interval-error"
                role="alert"
              >
                {{ scheduleIntervalError }}
              </div>
            </div>
          </div>
          <!-- Look Back Window -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.anomaly.lookBackWindow") }}
              <span class="text-status-error-text ml-1">*</span>
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer text-icon-color"
              >
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  :content="t('alerts.anomaly.lookBackWindowTooltip')"
                />
              </OIcon>
            </div>
            <div>
              <div class="flex items-center gap-0">
                <OFormInput
                  name="detection_window_value"
                  type="number"
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-detection-window-value"
                >
                  <!-- Message rendered below at pair width — see detectionWindowError. -->
                  <template #error />
                </OFormInput>
                <OFormSelect
                  name="detection_window_unit"
                  :options="intervalUnits"
                  label-key="label"
                  value-key="value"
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-detection-window-unit"
                />
              </div>
              <!-- This is the single error message for this field. -->
              <div
                v-if="detectionWindowError"
                class="text-xs text-input-error-text pt-1"
                data-test="anomaly-detection-window-error"
                role="alert"
              >
                {{ detectionWindowError }}
              </div>
            </div>
          </div>
        </div>

        <!-- Row: Training Window + Retrain Every -->
        <div class="grid grid-cols-2 gap-3 items-start mb-4! pb-0!">
          <!-- Training Window -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.trainingWindow") }}
              <span class="text-status-error-text ml-1">*</span>
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer text-icon-color"
              >
                <OTooltip side="right" align="center" max-width="300px">
                  <!-- Uses a #content slot (not :content) so the font-size
                       span survives. -->
                  <template #content><span style="font-size: var(--text-sm)">{{
                    t("alerts.anomaly.trainingWindowTooltip")
                  }}</span></template>
                </OTooltip>
              </OIcon>
            </div>
            <div class="flex flex-col">
              <OFormInput
                name="training_window_days"
                type="number"
                :min="1"
                data-test="anomaly-training-window"
                class="alert-v3-input"
                style="width: 87px"
              />
              <span
                class="static-text text-xs"
                :class="
                  'text-text-secondary'
                "
              >
                {{
                  t("alerts.anomaly.trainingWindowSeasonality", {
                    seasonality:
                      Number(trainingWindowDays) >= 7
                        ? t("alerts.anomaly.seasonalityWeekly")
                        : t("alerts.anomaly.seasonalityDaily"),
                  })
                }}
              </span>
            </div>
          </div>
          <!-- Retrain Every -->
          <div class="flex flex-row items-start gap-2">
            <div class="w-42.5 min-w-42.5 min-h-8 leading-[1.4] text-[length:inherit] font-semibold">
              {{ t("alerts.anomaly.retrainEvery") }}
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer text-icon-color"
              >
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  :content="t('alerts.anomaly.retrainEveryTooltip')"
                />
              </OIcon>
            </div>
            <OFormSelect
              name="retrain_interval_days"
              :options="retrainIntervalOptions"
              label-key="label"
              value-key="value"
              data-test="anomaly-retrain-interval"
              class="alert-v3-select"
              style="max-width: 200px"
            />
          </div>
        </div>

        <!-- Threshold / Sensitivity -->
        <div class="flex items-start mb-4! pb-0!">
          <div
            class="font-semibold flex items-center pt-1"
            style="width: 190px"
          >
            {{ t("alerts.sensitivity") }}
            <OIcon
              name="info"
              size="sm"
              class="ml-1 cursor-pointer text-icon-color"
            >
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  :content="t('alerts.anomaly.sensitivityTooltip')"
                />
            </OIcon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- Chart + Slider container -->
            <div class="w-full">
              <!-- Header row: range labels + load button -->
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-text-secondary">{{
                    t("alerts.anomaly.anomalyScoreRange")
                  }}</span>
                  <span
                    class="font-semibold text-xs"
                    data-test="anomaly-threshold-range-label"
                    >{{ thresholdRange.min ?? 0 }} –
                    {{ thresholdRange.max }}</span
                  >
                </div>
                <OButton
                  variant="outline"
                  size="sm-action"
                  :disabled="
                    !config.stream_name ||
                    (queryMode === 'custom_sql' && !customSql)
                  "
                  data-test="anomaly-sensitivity-load-btn"
                  @click="loadPreview"
                >
                  {{ t("alerts.anomaly.loadData") }}
                  <OTooltip v-if="!config.stream_name" :content="t('alerts.anomaly.selectStreamFirstTooltip')" />
                  <OTooltip
                    v-else-if="queryMode === 'custom_sql' && !customSql"
                    :content="t('alerts.anomaly.enterSqlFirst')"
                  />
                </OButton>
              </div>

              <!-- Chart + Vertical Slider row -->
              <div class="flex gap-3">
                <!-- Time series chart -->
                <div class="min-h-45 relative flex-1">
                  <div
                    v-if="!previewActive"
                    class="w-full h-45 flex flex-col items-center justify-center rounded-default border border-dashed border-border-default"
                    :class="
                      'text-text-secondary'
                    "
                    data-test="anomaly-sensitivity-empty"
                  >
                    <OIcon
                      name="bar-chart"
                      size="lg"
                      class="mb-2 opacity-40"
                    />
                    <span class="text-xs">{{
                      !config.stream_name
                        ? t("alerts.anomaly.selectStreamFirst")
                        : t("alerts.anomaly.clickLoadDataHint")
                    }}</span>
                  </div>
                  <PanelSchemaRenderer
                    v-else
                    :key="previewKey"
                    :panelSchema="previewPanelSchema"
                    :selectedTimeObj="previewTimeObj"
                    :variablesData="{}"
                    :forceLoad="true"
                    searchType="ui"
                    class="w-full"
                    style="height: 180px"
                    data-test="anomaly-sensitivity-chart"
                    @series-data-update="onSeriesDataUpdate"
                  />
                </div>

                <!-- Vertical dual-handle range slider -->
                <div
                  class="flex flex-col items-center w-15 shrink-0"
                >
                  <OFormRange
                    name="threshold_range"
                    :min="0"
                    :max="100"
                    :step="1"
                    vertical
                    reverse
                    label-always
                    markers
                    :marker-labels="[
                      { value: 0, label: '0' },
                      { value: 25, label: '25' },
                      { value: 50, label: '50' },
                      { value: 75, label: '75' },
                      { value: 100, label: '100' },
                    ]"
                    class="sensitivity-range-slider mt-3.5 h-36.25! [--color-slider-track-fill:var(--color-accent)] [--color-slider-thumb:var(--color-accent)] [--color-slider-thumb-border:white] [--color-slider-value:var(--color-text-secondary)]"
                    data-test="anomaly-threshold-range"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </OForm>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import streamService from "@/services/stream";
import {
  ANOMALY_FILTER_OPERATORS,
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import { toDetectionFunctionSql } from "@/utils/alerts/anomalySqlBuilder";
import QueryEditor from "@/components/QueryEditor.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormRange from "@/lib/forms/Range/OFormRange.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import {
  createAnomalyDetectionConfigSchema,
  anomalyDetectionConfigDefaults,
  hasTimestampAliasInSql,
  makeAnomalyFilterRow,
  type AnomalyDetectionConfigForm,
  type AnomalyFilterRow,
} from "./AnomalyDetectionConfig.schema";

export default defineComponent({
  name: "AnomalyDetectionConfig",

  components: {
    QueryEditor,
    PanelSchemaRenderer,
    OButton,
    OToggleGroupItem,
    OFormToggleGroup,
    OIcon,
    OTooltip,
    OForm,
    OFormInput,
    OFormSelect,
    OFormRange,
  },

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
  },

  setup(props) {
    const { t } = useI18n();
    const store = useStore();

    // Option labels go through t() inside a computed so they re-resolve on a
    // locale change (a plain const would freeze them at mount locale).
    // "SQL" stays a literal — a proper noun, not translatable copy.
    const queryTabOptions = computed(() => [
      { label: t("alerts.queryBuilder"), value: "filters" },
      { label: "SQL", value: "custom_sql" },
    ]);

    const filterOperators = ANOMALY_FILTER_OPERATORS;
    const detectionFunctions = [
      "count",
      "avg",
      "sum",
      "min",
      "max",
      "p50",
      "p95",
      "p99",
    ];
    const intervalUnits = computed(() => [
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
    ]);
    // Fixed enum labels, not dynamic counts — plain keys, no pluralization.
    const retrainIntervalOptions = computed(() => [
      { label: t("alerts.anomaly.retrainNever"), value: 0 },
      { label: t("alerts.anomaly.retrainOneDay"), value: 1 },
      { label: t("alerts.anomaly.retrainSevenDays"), value: 7 },
      { label: t("alerts.anomaly.retrainFourteenDays"), value: 14 },
    ]);

    const getTimestampColumn = () =>
      store.state.zoConfig.timestamp_column || "_timestamp";

    // The parent (useAlertForm.saveAnomalyDetection) owns the save + payload;
    // this step's submit exists purely to run the schema (the exposed
    // validate() drives form.handleSubmit()), so onSubmit is a no-op.
    const anomalyDetectionConfigSchema =
      createAnomalyDetectionConfigSchema(t, getTimestampColumn);

    const form = useOForm<AnomalyDetectionConfigForm>({
      defaultValues: anomalyDetectionConfigDefaults(props.config),
      schema: anomalyDetectionConfigSchema,
      onSubmit: () => {},
    });

    // Reactive reads via form.useStore.
    const queryMode = form.useStore((s: any) => s.values.query_mode);
    const customSql = form.useStore((s: any) => s.values.custom_sql);
    const filterRows = form.useStore(
      (s: any): AnomalyFilterRow[] => s.values.filters ?? [],
    );
    const detectionFunction = form.useStore(
      (s: any) => s.values.detection_function,
    );
    const detectionFunctionField = form.useStore(
      (s: any) => s.values.detection_function_field,
    );
    const histogramIntervalValue = form.useStore(
      (s: any) => s.values.histogram_interval_value,
    );
    const histogramIntervalUnit = form.useStore(
      (s: any) => s.values.histogram_interval_unit,
    );
    const detectionWindowValue = form.useStore(
      (s: any) => s.values.detection_window_value,
    );
    const trainingWindowDays = form.useStore(
      (s: any) => s.values.training_window_days,
    );
    const thresholdRange = form.useStore(
      (s: any) => s.values.threshold_range ?? { min: 0, max: 100 },
    );
    // Bare-widget errors (Monaco custom_sql + the data-test div) render only
    // after the first submit attempt, same timing as the wrappers.
    const showSqlErrors = form.useStore(
      (s: any) => s.submissionAttempts > 0,
    );

    // The interval controls are composite "number + unit" fields: a ~5.5rem
    // OFormInput glued to a unit OFormSelect. OFormInput renders its message
    // INSIDE the number field's own width, which wraps it into a ragged column
    // and grows the field, pushing the unit select out of line. An empty #error
    // slot suppresses the built-in message and we render it in a full-width
    // sibling below the pair, reading the same field errors OFormInput surfaces.
    const fieldError = (path: string) =>
      form.useStore((s: any) =>
        firstFieldError(s.fieldMeta?.[path]?.errors ?? []),
      );
    const histogramIntervalError = fieldError("histogram_interval_value");
    const scheduleIntervalError = fieldError("schedule_interval_value");
    const detectionWindowError = fieldError("detection_window_value");

    // Write-back watch (form → props.config): the parent reads props.config
    // directly (live anomalyPreviewSql computed + saveAnomalyDetection payload),
    // so the form writes back into the parent-owned object. Numeric fields are
    // re-coerced so the parent payload keeps number types.
    const toModelNumber = (v: unknown) => {
      if (v === "" || v === null || v === undefined) return v;
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    };

    const formValues = form.useStore((s: any) => s.values);
    watch(
      formValues,
      (v: any) => {
        const cfg = props.config;
        if (!cfg || !v) return;
        cfg.query_mode = v.query_mode;
        // Replace the array only when its contents changed, so the deep
        // preview watcher below doesn't refire on unrelated field edits.
        if (
          JSON.stringify(cfg.filters ?? []) !== JSON.stringify(v.filters ?? [])
        ) {
          cfg.filters = (v.filters ?? []).map((f: any) => ({ ...f }));
        }
        cfg.custom_sql = v.custom_sql;
        cfg.detection_function = v.detection_function;
        cfg.detection_function_field = v.detection_function_field;
        cfg.histogram_interval_value = toModelNumber(
          v.histogram_interval_value,
        );
        cfg.histogram_interval_unit = v.histogram_interval_unit;
        cfg.schedule_interval_value = toModelNumber(v.schedule_interval_value);
        cfg.schedule_interval_unit = v.schedule_interval_unit;
        cfg.detection_window_value = toModelNumber(v.detection_window_value);
        cfg.detection_window_unit = v.detection_window_unit;
        cfg.training_window_days = toModelNumber(v.training_window_days);
        cfg.retrain_interval_days = toModelNumber(v.retrain_interval_days);
        cfg.threshold_min = v.threshold_range?.min ?? 0;
        cfg.threshold = v.threshold_range?.max ?? 100;
      },
      { deep: true },
    );

    // Async edit-prefill replaces the whole config object → re-seed via
    // form.reset(record).
    watch(
      () => props.config,
      (cfg) => {
        form.reset(anomalyDetectionConfigDefaults(cfg));
      },
    );

    // Check if the custom SQL uses the timestamp column name as an alias
    // (display gating for the bare-editor error div; the schema enforces it).
    const hasTimestampAlias = computed(
      () =>
        queryMode.value === "custom_sql" &&
        hasTimestampAliasInSql(customSql.value || "", getTimestampColumn()),
    );

    // Bare Monaco has no field binding, so it never gets the red border the
    // OForm* wrappers paint from field state. This drives that border, post-
    // submit only, over the same conditions the two error divs render on.
    const hasSqlError = computed(
      () =>
        showSqlErrors.value &&
        (!customSql.value?.trim() || hasTimestampAlias.value),
    );

    // Bridge the bare Monaco editor's value into the form so the schema
    // covers it.
    const onCustomSqlChange = (sql: string) => {
      form.setFieldValue("custom_sql", sql);
    };

    // Build default SQL template for a given stream name and histogram interval
    const buildDefaultSql = (
      streamName: string,
      intervalValue: number | string,
      intervalUnit: string,
    ) =>
      `SELECT histogram(_timestamp, '${intervalValue}${intervalUnit}') AS time_bucket, count(*) AS value\nFROM "${streamName}"\nGROUP BY time_bucket\nORDER BY time_bucket`;

    // Stream fields for filter field selector and detection function field
    const allStreamFields = ref<string[]>([]);
    const numericStreamFields = ref<string[]>([]); // only numeric types for avg/sum/min/max/pXX
    const filteredStreamFields = ref<string[]>([]);
    const filteredDetectionFields = ref<string[]>([]);
    const loadingFields = ref(false);

    const NUMERIC_FIELD_TYPES = new Set([
      "Int8",
      "Int16",
      "Int32",
      "Int64",
      "UInt8",
      "UInt16",
      "UInt32",
      "UInt64",
      "Float16",
      "Float32",
      "Float64",
    ]);

    const requiresNumericField = (fn: string) =>
      ["avg", "sum", "min", "max", "p50", "p95", "p99"].includes(fn);

    const loadStreamFields = async () => {
      const streamName = props.config.stream_name;
      const streamType = props.config.stream_type;
      if (!streamName || !streamType) {
        allStreamFields.value = [];
        numericStreamFields.value = [];
        filteredStreamFields.value = [];
        filteredDetectionFields.value = [];
        return;
      }
      loadingFields.value = true;
      try {
        const res = await streamService.schema(
          store.state.selectedOrganization.identifier,
          streamName,
          streamType,
        );
        const schema = res.data;
        const fieldsArray =
          schema.uds_schema && schema.uds_schema.length > 0
            ? schema.uds_schema
            : schema.schema || schema.fields || [];
        allStreamFields.value = fieldsArray.map((f: any) => f.name).sort();
        numericStreamFields.value = fieldsArray
          .filter((f: any) => {
            const t: string = f.field_type || f.data_type || f.type || "";
            return NUMERIC_FIELD_TYPES.has(t);
          })
          .map((f: any) => f.name)
          .sort();
        filteredStreamFields.value = allStreamFields.value;
        filteredDetectionFields.value = requiresNumericField(
          detectionFunction.value as string,
        )
          ? numericStreamFields.value
          : allStreamFields.value;
      } catch {
        allStreamFields.value = [];
        numericStreamFields.value = [];
        filteredStreamFields.value = [];
        filteredDetectionFields.value = [];
      } finally {
        loadingFields.value = false;
      }
    };

    const filterFieldOptions = (val: string, update: any) => {
      update(() => {
        const needle = val.toLowerCase();
        filteredStreamFields.value = needle
          ? allStreamFields.value.filter((f) =>
              f.toLowerCase().includes(needle),
            )
          : allStreamFields.value;
      });
    };

    const filterDetectionFieldOptions = (val: string, update: any) => {
      update(() => {
        const needle = val.toLowerCase();
        const base = requiresNumericField(detectionFunction.value as string)
          ? numericStreamFields.value
          : allStreamFields.value;
        filteredDetectionFields.value = needle
          ? base.filter((f) => f.toLowerCase().includes(needle))
          : base;
      });
    };

    const onDetectionFunctionChange = (fn: string) => {
      if (fn === "count") {
        form.setFieldValue("detection_function_field", "");
      }
      // Refresh available fields based on whether the new function needs numeric fields.
      const base = requiresNumericField(fn)
        ? numericStreamFields.value
        : allStreamFields.value;
      filteredDetectionFields.value = base;
      // Clear the selected field if it's no longer valid for the new function.
      if (
        requiresNumericField(fn) &&
        form.state.values.detection_function_field &&
        !numericStreamFields.value.includes(
          form.state.values.detection_function_field as string,
        )
      ) {
        form.setFieldValue("detection_function_field", "");
      }
    };

    watch(
      () => [props.config.stream_name, props.config.stream_type],
      ([streamName]) => {
        loadStreamFields();
        // Pre-fill default SQL when switching to custom_sql mode with a selected stream
        if (
          form.state.values.query_mode === "custom_sql" &&
          streamName &&
          !form.state.values.custom_sql
        ) {
          form.setFieldValue(
            "custom_sql",
            buildDefaultSql(
              streamName as string,
              (form.state.values.histogram_interval_value as any) ?? 5,
              (form.state.values.histogram_interval_unit as string) ?? "m",
            ),
          );
        }
      },
      { immediate: true },
    );

    // When switching to custom_sql mode, seed a default query if one isn't set
    watch(queryMode, (mode) => {
      if (
        mode === "custom_sql" &&
        props.config.stream_name &&
        !form.state.values.custom_sql
      ) {
        form.setFieldValue(
          "custom_sql",
          buildDefaultSql(
            props.config.stream_name,
            (form.state.values.histogram_interval_value as any) ?? 5,
            (form.state.values.histogram_interval_unit as string) ?? "m",
          ),
        );
      }
    });

    // Sync histogram interval changes into the custom SQL histogram() call
    watch([histogramIntervalValue, histogramIntervalUnit], ([newValue, newUnit]) => {
      if (
        form.state.values.query_mode !== "custom_sql" ||
        !form.state.values.custom_sql
      )
        return;
      form.setFieldValue(
        "custom_sql",
        (form.state.values.custom_sql as string).replace(
          /histogram\(\s*_timestamp\s*,\s*'[^']+'\s*\)/gi,
          `histogram(_timestamp, '${newValue}${newUnit}')`,
        ),
      );
    });

    // Structural mutations go through the form.
    const addFilter = () => {
      form.pushFieldValue("filters", makeAnomalyFilterRow());
    };

    const removeFilter = (idx: number) => {
      form.removeFieldValue("filters", idx);
    };

    // The parent (AddAlert wizard via useAlertForm) still calls
    // anomalyStep2Ref.validate() to gate Next/Save — drive it through
    // form.handleSubmit() so it runs the schema and flips submissionAttempts
    // so the post-submit errors render.
    const validate = async (): Promise<boolean> => {
      await form.handleSubmit();
      return form.state.isValid;
    };

    // ── Data Preview chart ──────────────────────────────────────────────────
    const previewActive = ref(false);
    const previewKey = ref(0);
    const previewPanelSchema = ref<any>(null);
    const previewTimeObj = ref<any>(null);

    // Reads props.config, which the write-back watch above keeps in sync with
    // the form — same values the parent's own preview/save read.
    const buildPreviewSql = () => {
      let sql: string;
      if (props.config.query_mode === "custom_sql") {
        sql = props.config.custom_sql || "";
      } else {
        const streamName = props.config.stream_name;
        if (!streamName) {
          sql = "";
        } else {
          const intervalValue = props.config.histogram_interval_value ?? 5;
          const intervalUnit = props.config.histogram_interval_unit ?? "m";
          const interval = `${intervalValue}${intervalUnit}`;
          const fn = toDetectionFunctionSql(
            props.config.detection_function || "count",
            props.config.detection_function_field || "*",
          );
          const filterLines = (props.config.filters || [])
            .filter(
              (f: any) =>
                f.field && (operatorNeedsValue(f.operator) ? f.value : true),
            )
            .map(
              (f: any) =>
                `  AND ${buildAnomalyFilterExpression(f.field, f.operator, f.value)}`,
            );
          const where = filterLines.length
            ? [
                "WHERE",
                ...filterLines.map((l: string, i: number) =>
                  i === 0 ? l.replace(/^\s+AND /, "  ") : l,
                ),
              ].join("\n")
            : "";
          sql = [
            `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
            `       ${fn} AS value`,
            `FROM "${streamName}"`,
            where,
            `GROUP BY time_bucket`,
            `ORDER BY time_bucket`,
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
      // Normalize multiline SQL to a single line — the dashboard panel
      // query executor can truncate at newlines in some code paths
      return sql.replace(/\s+/g, " ").trim();
    };

    const loadPreview = () => {
      const sql = buildPreviewSql();
      if (!sql || !props.config.stream_name) return;

      const windowValue = props.config.detection_window_value ?? 30;
      const windowUnit = props.config.detection_window_unit ?? "m";
      const windowMs = windowValue * (windowUnit === "h" ? 3600000 : 60000);
      // The dashboard DateTime picker returns microseconds (ms * 1000).
      // viewDashboard wraps those with new Date(microseconds), so the Date
      // object's internal value IS the microsecond number.
      // usePanelDataLoader then calls .getTime() which returns the microsecond
      // value unchanged. We must replicate that convention here.
      const endMicros = new Date().getTime() * 1000;
      const startMicros = endMicros - windowMs * 1000;

      previewTimeObj.value = {
        start_time: new Date(startMicros),
        end_time: new Date(endMicros),
      };
      // PanelSchemaRenderer expects the inner data object directly (not wrapped)
      previewPanelSchema.value = {
        version: 2,
        id: "anomaly-preview",
        type: "line",
        title: "",
        description: "",
        config: {
          show_legends: false,
          legends_position: "bottom",
          unit: "short",
          unit_custom: "",
          promql_legend: "",
          axis_border_show: false,
          connect_nulls: true,
          no_value_replacement: "",
          wrap_table_cells: false,
          table_transpose: false,
          table_dynamic_columns: false,
          base_map: { type: "osm" },
          map_view: { zoom: 1, lat: 0, lng: 0 },
          custom_chart_options: {
            tooltip: { appendToBody: true, confine: false },
          },
          mark_line: [
            {
              name: t("alerts.anomaly.maxThresholdMarkLine"),
              type: "yAxis",
              value: String(thresholdRange.value.max),
            },
            {
              name: t("alerts.anomaly.minThresholdMarkLine"),
              type: "yAxis",
              value: String(thresholdRange.value.min),
            },
          ],
        },
        queryType: "sql",
        queries: [
          {
            query: sql,
            customQuery: true,
            vrlFunctionQuery: null,
            query_fn: null,
            fields: {
              stream: props.config.stream_name,
              stream_type: props.config.stream_type || "logs",
              x: [
                {
                  alias: "time_bucket",
                  column: "time_bucket",
                  label: "",
                  color: null,
                },
              ],
              y: [
                {
                  alias: "value",
                  column: "value",
                  label: "",
                  color: "#5960b2",
                },
              ],
              z: [],
              breakdown: [],
              filter: {
                filterType: "group",
                logicalOperator: "AND",
                conditions: [],
              },
              latitude: null,
              longitude: null,
              weight: null,
            },
            config: {
              promql_legend: "",
              layer_type: "scatter",
              weight_fixed: 1,
              limit: 0,
              min: 0,
              max: 100,
              time_shift: [],
            },
          },
        ],
      };
      previewKey.value++;
      previewActive.value = true;
      previewHasData.value = false; // reset until new data arrives
      seriesDataMax.value = null;
    };

    // Auto-refresh when Look Back Window, Detection Resolution, filters, or
    // detection function changes (props.config stays in sync via write-back)
    let previewRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    watch(
      () => [
        props.config.detection_window_value,
        props.config.detection_window_unit,
        props.config.histogram_interval_value,
        props.config.histogram_interval_unit,
        props.config.query_mode,
        props.config.custom_sql,
        props.config.detection_function,
        props.config.detection_function_field,
        props.config.filters,
      ],
      () => {
        if (!previewActive.value) return;
        if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
        previewRefreshTimer = setTimeout(() => {
          loadPreview();
        }, 600);
      },
      { deep: true },
    );

    const previewHasData = ref(false);
    const seriesDataMax = ref<number | null>(null);

    const onSeriesDataUpdate = (data: any) => {
      const series = data?.options?.series ?? data?.series ?? [];
      previewHasData.value = series.some(
        (s: any) => Array.isArray(s.data) && s.data.length > 0,
      );

      // Find the max y value across all series so we can convert the 0-100
      // slider percentages into actual y-axis values for the mark lines.
      let max = -Infinity;
      for (const s of series) {
        if (!Array.isArray(s.data)) continue;
        for (const point of s.data) {
          // Points can be [x, y], plain number, or { value: [x, y] / y }
          let raw: any = point;
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw))
            raw = raw.value;
          const v: any = Array.isArray(raw) ? raw[1] : raw;
          if (typeof v === "number" && isFinite(v) && v > max) max = v;
        }
      }
      if (isFinite(max) && max !== seriesDataMax.value) {
        seriesDataMax.value = max;
      }
    };

    const updateMarkLines = (maxPct: number, minPct: number) => {
      if (!previewPanelSchema.value) return;
      const yMax = seriesDataMax.value;
      // If data is loaded, map 0-100% → actual y values; otherwise fall back to raw %
      const toValue = (pct: number) =>
        yMax !== null ? (pct / 100) * yMax : pct;
      previewPanelSchema.value.config.mark_line = [
        { name: "", type: "yAxis", value: String(toValue(maxPct)) },
        { name: "", type: "yAxis", value: String(toValue(minPct)) },
      ];
    };

    // Keep mark_line in sync with slider — update the schema config in-place
    // so PanelSchemaRenderer re-renders the lines without a full chart reload.
    watch(thresholdRange, ({ max, min }) => updateMarkLines(max, min), {
      deep: true,
    });

    // Re-apply mark lines once data max is known after chart loads.
    watch(seriesDataMax, () => {
      updateMarkLines(thresholdRange.value.max, thresholdRange.value.min);
    });

    return {
      t,
      store,
      form,
      queryTabOptions,
      filterOperators,
      operatorNeedsValue,
      detectionFunctions,
      intervalUnits,
      retrainIntervalOptions,
      allStreamFields,
      filteredStreamFields,
      filteredDetectionFields,
      loadingFields,
      onDetectionFunctionChange,
      addFilter,
      removeFilter,
      validate,
      hasTimestampAlias,
      hasSqlError,
      queryMode,
      customSql,
      filterRows,
      detectionFunction,
      detectionFunctionField,
      detectionWindowValue,
      trainingWindowDays,
      showSqlErrors,
      histogramIntervalError,
      scheduleIntervalError,
      detectionWindowError,
      onCustomSqlChange,
      thresholdRange,
      previewActive,
      previewKey,
      previewPanelSchema,
      previewTimeObj,
      loadPreview,
      previewHasData,
      onSeriesDataUpdate,
    };
  },
});
</script>
