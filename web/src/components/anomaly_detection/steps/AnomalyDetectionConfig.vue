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
    class="step-anomaly-config"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content tw:px-3 tw:py-4">
      <q-form ref="formRef" @submit.prevent>
        <!-- Query Mode Tabs -->
        <div class="tw:mb-4">
          <OToggleGroup
            :model-value="
              config.query_mode === 'custom_sql' ? 'custom_sql' : 'filters'
            "
            @update:model-value="config.query_mode = $event as string"
            data-test="anomaly-query-tabs"
          >
            <OToggleGroupItem
              v-for="tab in queryTabOptions"
              :key="tab.value"
              :value="tab.value"
              size="sm"
            >
              {{ tab.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <!-- Filters mode -->
        <div
          v-if="config.query_mode === 'filters'"
          class="flex items-start alert-settings-row"
        >
          <div
            class="tw:font-semibold flex items-center"
            style="width: 178px; min-height: 36px"
          >
            {{ t("alerts.anomaly.filters") }}
          </div>
          <div style="width: calc(100% - 190px)">
            <div
              v-for="(filter, idx) in config.filters"
              :key="idx"
              class="tw:flex tw:items-center tw:gap-2 tw:mb-2"
            >
              <q-select
                v-model="filter.field"
                :options="filteredStreamFields"
                dense
                borderless
                use-input
                fill-input
                hide-selected
                input-debounce="200"
                :placeholder="
                  filter.field ? '' : t('alerts.anomaly.fieldPlaceholder')
                "
                class="alert-v3-select filter-field-select"
                style="width: 200px"
                :loading="loadingFields"
                @filter="filterFieldOptions"
              >
                <template #no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{
                        config.stream_name
                          ? t("alerts.anomaly.noFieldsFound")
                          : t("alerts.anomaly.selectStreamFirst")
                      }}
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-select
                v-model="filter.operator"
                :options="filterOperators"
                dense
                borderless
                class="alert-v3-select"
                style="width: 110px"
              />
              <q-input
                v-if="operatorNeedsValue(filter.operator)"
                v-model="filter.value"
                dense
                borderless
                :placeholder="t('alerts.placeholders.value')"
                class="alert-v3-input"
                style="max-width: 160px"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                @click="removeFilter(idx)"
              >
                <X class="tw:size-4" />
              </OButton>
            </div>
            <OButton
              variant="outline"
              size="sm-action"
              class="q-mt-sm"
              @click="addFilter"
            >
              {{ t("alerts.anomaly.addFilter") }}
            </OButton>
          </div>
        </div>

        <!-- Custom SQL mode -->
        <div
          v-if="config.query_mode === 'custom_sql'"
          class="flex items-start alert-settings-row"
        >
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            SQL <span class="text-negative tw:ml-1">*</span>
          </div>
          <div style="width: calc(100% - 190px)">
            <div
              class="custom-sql-editor-wrapper"
              :class="
                store.state.theme === 'dark' ? 'dark-editor' : 'light-editor'
              "
            >
              <QueryEditor
                data-test-prefix="anomaly-custom-sql"
                :query="config.custom_sql || ''"
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
                @update:query="config.custom_sql = $event"
              />
            </div>
            <div
              v-if="!config.custom_sql"
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              {{ t("alerts.anomaly.sqlRequired") }}
            </div>
            <div
              v-if="hasTimestampAlias"
              class="text-red-8 q-pt-xs"
              data-test="anomaly-custom-sql-timestamp-alias-error"
              style="font-size: 11px; line-height: 12px"
            >
              <code>{{
                store.state.zoConfig.timestamp_column || "_timestamp"
              }}</code>
              cannot be used as a column alias. Use
              <code>time_bucket</code> instead.
            </div>
            <div
              class="text-caption tw:mt-1"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              Query must return two columns: <code>time_bucket</code> and
              <code>value</code>.
            </div>
          </div>
        </div>

        <!-- Row: Detection Function + Detection Resolution (filters mode) -->
        <div
          v-if="config.query_mode === 'filters'"
          class="alert-settings-row paired-row"
        >
          <!-- Detection Function -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.detectionFunction") }}
              <span class="text-negative tw:ml-1">*</span>
            </div>
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-select
                v-model="config.detection_function"
                :options="detectionFunctions"
                dense
                borderless
                hide-bottom-space
                :rules="[(v) => !!v || 'Detection function is required']"
                data-test="anomaly-detection-function"
                class="alert-v3-select"
                style="width: 110px"
                @update:model-value="onDetectionFunctionChange"
              />
              <q-select
                v-if="
                  config.detection_function &&
                  config.detection_function !== 'count'
                "
                v-model="config.detection_function_field"
                :options="filteredDetectionFields"
                dense
                borderless
                use-input
                input-debounce="200"
                :placeholder="
                  config.detection_function_field
                    ? ''
                    : t('alerts.anomaly.fieldPlaceholder')
                "
                :loading="loadingFields"
                :rules="[(v) => !!v || 'Field is required']"
                hide-bottom-space
                data-test="anomaly-detection-function-field"
                class="alert-v3-select"
                style="width: 140px"
                @filter="filterDetectionFieldOptions"
              >
                <template #no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{
                        config.stream_name
                          ? t("alerts.anomaly.noFieldsFound")
                          : t("alerts.anomaly.selectStreamFirst")
                      }}
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
            </div>
          </div>
          <!-- Detection Resolution -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.anomaly.detectionResolution") }}
              <span class="text-negative tw:ml-1">*</span>
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">{{
                    t("alerts.anomaly.detectionResolutionTooltip")
                  }}</span>
                </q-tooltip>
              </q-icon>
            </div>
            <div>
              <div class="tw:flex tw:items-center tw:gap-0">
                <q-input
                  v-model.number="config.histogram_interval_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-histogram-interval-value"
                />
                <q-select
                  v-model="config.histogram_interval_unit"
                  :options="intervalUnits"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                  dense
                  borderless
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-histogram-interval-unit"
                />
              </div>
              <div
                v-if="
                  !config.histogram_interval_value ||
                  config.histogram_interval_value < 1
                "
                class="text-red-8 q-pt-xs"
                style="font-size: 11px; line-height: 12px"
              >
                Field is required!
              </div>
            </div>
          </div>
        </div>

        <!-- Detection Resolution alone (custom_sql mode) -->
        <div v-else class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            Detection Resolution <span class="text-negative tw:ml-1">*</span>
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                <span style="font-size: 14px">{{
                  t("alerts.anomaly.detectionResolutionTooltip")
                }}</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="tw:flex tw:items-center tw:gap-0">
              <q-input
                v-model.number="config.histogram_interval_value"
                type="number"
                dense
                borderless
                min="1"
                class="alert-v3-input"
                style="width: 87px"
                data-test="anomaly-histogram-interval-value"
              />
              <q-select
                v-model="config.histogram_interval_unit"
                :options="intervalUnits"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                dense
                borderless
                class="alert-v3-select"
                style="min-width: 100px"
                data-test="anomaly-histogram-interval-unit"
              />
            </div>
            <div
              v-if="
                !config.histogram_interval_value ||
                config.histogram_interval_value < 1
              "
              class="text-red-8 q-pt-xs"
              style="font-size: 11px; line-height: 12px"
            >
              Field is required!
            </div>
          </div>
        </div>

        <!-- Row: Check Every + Look Back Window -->
        <div class="alert-settings-row paired-row">
          <!-- Check Every -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.anomaly.checkEvery") }}
              <span class="text-negative tw:ml-1">*</span>
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">{{
                    t("alerts.anomaly.checkEveryTooltip")
                  }}</span>
                </q-tooltip>
              </q-icon>
            </div>
            <div>
              <div class="tw:flex tw:items-center tw:gap-0">
                <q-input
                  v-model.number="config.schedule_interval_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-schedule-interval-value"
                />
                <q-select
                  v-model="config.schedule_interval_unit"
                  :options="intervalUnits"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                  dense
                  borderless
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-schedule-interval-unit"
                />
              </div>
              <div
                v-if="
                  !config.schedule_interval_value ||
                  config.schedule_interval_value < 1
                "
                class="text-red-8 q-pt-xs"
                style="font-size: 11px; line-height: 12px"
              >
                Field is required!
              </div>
            </div>
          </div>
          <!-- Look Back Window -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.anomaly.lookBackWindow") }}
              <span class="text-negative tw:ml-1">*</span>
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">{{
                    t("alerts.anomaly.lookBackWindowTooltip")
                  }}</span>
                </q-tooltip>
              </q-icon>
            </div>
            <div>
              <div class="tw:flex tw:items-center tw:gap-0">
                <q-input
                  v-model.number="config.detection_window_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  class="alert-v3-input"
                  style="width: 87px"
                  data-test="anomaly-detection-window-value"
                />
                <q-select
                  v-model="config.detection_window_unit"
                  :options="intervalUnits"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                  dense
                  borderless
                  class="alert-v3-select"
                  style="min-width: 100px"
                  data-test="anomaly-detection-window-unit"
                />
              </div>
              <div
                v-if="
                  !config.detection_window_value ||
                  config.detection_window_value < 1
                "
                class="text-red-8 q-pt-xs"
                style="font-size: 11px; line-height: 12px"
                data-test="anomaly-detection-window-error"
              >
                Field is required!
              </div>
            </div>
          </div>
        </div>

        <!-- Row: Training Window + Retrain Every -->
        <div class="alert-settings-row paired-row">
          <!-- Training Window -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.trainingWindow") }}
              <span class="text-negative tw:ml-1">*</span>
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">
                    How many days of historical data to use for training. Min 1
                    day. Seasonality is auto-detected: &lt;7 days → hour-of-day;
                    ≥7 days → hour-of-day + day-of-week.
                  </span>
                </q-tooltip>
              </q-icon>
            </div>
            <div class="tw:flex tw:flex-col">
              <q-input
                v-model.number="config.training_window_days"
                type="number"
                dense
                borderless
                hide-bottom-space
                :min="1"
                :rules="[(v) => v >= 1 || 'Minimum 1 day']"
                data-test="anomaly-training-window"
                class="alert-v3-input"
                style="width: 87px"
              />
              <span
                class="static-text text-caption"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                days (seasonality:
                {{
                  config.training_window_days >= 7
                    ? t("alerts.anomaly.seasonalityWeekly")
                    : t("alerts.anomaly.seasonalityDaily")
                }})
              </span>
            </div>
          </div>
          <!-- Retrain Every -->
          <div class="paired-col">
            <div class="paired-col-label tw:font-semibold">
              {{ t("alerts.anomaly.retrainEvery") }}
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="
                  store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
                "
              >
                <q-tooltip
                  anchor="center right"
                  self="center left"
                  max-width="300px"
                >
                  <span style="font-size: 14px">{{
                    t("alerts.anomaly.retrainEveryTooltip")
                  }}</span>
                </q-tooltip>
              </q-icon>
            </div>
            <q-select
              v-model="config.retrain_interval_days"
              :options="retrainIntervalOptions"
              option-label="label"
              option-value="value"
              emit-value
              map-options
              dense
              borderless
              data-test="anomaly-retrain-interval"
              class="alert-v3-select"
              style="max-width: 200px"
            />
          </div>
        </div>

        <!-- Threshold / Sensitivity -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; padding-top: 4px"
          >
            {{ t("alerts.sensitivity") }}
            <q-icon
              name="info"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                <span style="font-size: 14px">{{
                  t("alerts.anomaly.sensitivityTooltip")
                }}</span>
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- Chart + Slider container -->
            <div class="sensitivity-chart-container">
              <!-- Header row: range labels + load button -->
              <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <span class="text-caption text-grey-6">{{
                    t("alerts.anomaly.anomalyScoreRange")
                  }}</span>
                  <span
                    class="tw:font-semibold text-caption"
                    data-test="anomaly-threshold-range-label"
                    >{{ config.threshold_min ?? 0 }} –
                    {{ config.threshold }}</span
                  >
                </div>
                <OButton
                  variant="outline"
                  size="sm-action"
                  :disabled="
                    !config.stream_name ||
                    (config.query_mode === 'custom_sql' && !config.custom_sql)
                  "
                  data-test="anomaly-sensitivity-load-btn"
                  @click="loadPreview"
                >
                  {{ t("alerts.anomaly.loadData") }}
                  <q-tooltip v-if="!config.stream_name">{{
                    t("alerts.anomaly.selectStreamFirstTooltip")
                  }}</q-tooltip>
                  <q-tooltip
                    v-else-if="
                      config.query_mode === 'custom_sql' && !config.custom_sql
                    "
                    >{{ t("alerts.anomaly.enterSqlFirst") }}</q-tooltip
                  >
                </OButton>
              </div>

              <!-- Chart + Vertical Slider row -->
              <div class="tw:flex tw:gap-3">
                <!-- Time series chart -->
                <div class="sensitivity-chart-wrapper tw:flex-1">
                  <div
                    v-if="!previewActive"
                    class="sensitivity-empty-state"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-6'
                    "
                    data-test="anomaly-sensitivity-empty"
                  >
                    <q-icon
                      name="bar_chart"
                      size="2rem"
                      class="tw:mb-2 tw:opacity-40"
                    />
                    <span class="text-caption">{{
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
                    style="height: 180px; width: 100%"
                    data-test="anomaly-sensitivity-chart"
                    @series-data-update="onSeriesDataUpdate"
                  />
                </div>

                <!-- Vertical dual-handle range slider -->
                <div
                  class="sensitivity-slider-col tw:flex tw:flex-col tw:items-center"
                >
                  <q-range
                    ref="sliderRef"
                    v-model="thresholdRange"
                    :min="0"
                    :max="100"
                    :step="1"
                    vertical
                    reverse
                    color="primary"
                    label-always
                    markers
                    :marker-labels="[
                      { value: 0, label: '0' },
                      { value: 25, label: '25' },
                      { value: 50, label: '50' },
                      { value: 75, label: '75' },
                      { value: 100, label: '100' },
                    ]"
                    class="sensitivity-range-slider"
                    data-test="anomaly-threshold-range"
                    @update:model-value="onThresholdRangeChange"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  ref,
  watch,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import streamService from "@/services/stream";
import {
  ANOMALY_FILTER_OPERATORS,
  buildAnomalyFilterExpression,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import QueryEditor from "@/components/QueryEditor.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { X } from "lucide-vue-next";

export default defineComponent({
  name: "AnomalyDetectionConfig",

  components: {
    QueryEditor,
    PanelSchemaRenderer,
    OButton,
    OToggleGroup,
    OToggleGroupItem,
    X,
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
    const formRef = ref<any>(null);

    const queryTabOptions = [
      { label: "Builder", value: "filters" },
      { label: "SQL", value: "custom_sql" },
    ];

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
    const intervalUnits = [
      { label: "Minutes", value: "m" },
      { label: "Hours", value: "h" },
    ];
    const retrainIntervalOptions = [
      { label: "Never", value: 0 },
      { label: "1 day", value: 1 },
      { label: "7 days", value: 7 },
      { label: "14 days", value: 14 },
    ];

    // Check if the custom SQL uses the timestamp column name as an alias
    const hasTimestampAlias = computed(() => {
      const sql = props.config.custom_sql;
      if (!sql || props.config.query_mode !== "custom_sql") return false;
      const tsCol = store.state.zoConfig.timestamp_column || "_timestamp";
      const escaped = tsCol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `\\bAS\\s+["'\`]?${escaped}["'\`]?\\s*(?:,|\\s|$)`,
        "i",
      ).test(sql);
    });

    // Build default SQL template for a given stream name and histogram interval
    const buildDefaultSql = (
      streamName: string,
      intervalValue: number,
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
          props.config.detection_function,
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
        const base = requiresNumericField(props.config.detection_function)
          ? numericStreamFields.value
          : allStreamFields.value;
        filteredDetectionFields.value = needle
          ? base.filter((f) => f.toLowerCase().includes(needle))
          : base;
      });
    };

    const onDetectionFunctionChange = (fn: string) => {
      if (fn === "count") {
        props.config.detection_function_field = "";
      }
      // Refresh available fields based on whether the new function needs numeric fields.
      const base = requiresNumericField(fn)
        ? numericStreamFields.value
        : allStreamFields.value;
      filteredDetectionFields.value = base;
      // Clear the selected field if it's no longer valid for the new function.
      if (
        requiresNumericField(fn) &&
        props.config.detection_function_field &&
        !numericStreamFields.value.includes(
          props.config.detection_function_field,
        )
      ) {
        props.config.detection_function_field = "";
      }
    };

    watch(
      () => [props.config.stream_name, props.config.stream_type],
      ([streamName]) => {
        loadStreamFields();
        // Pre-fill default SQL when switching to custom_sql mode with a selected stream
        if (
          props.config.query_mode === "custom_sql" &&
          streamName &&
          !props.config.custom_sql
        ) {
          props.config.custom_sql = buildDefaultSql(
            streamName as string,
            props.config.histogram_interval_value ?? 5,
            props.config.histogram_interval_unit ?? "m",
          );
        }
      },
      { immediate: true },
    );

    // When switching to custom_sql mode, seed a default query if one isn't set
    watch(
      () => props.config.query_mode,
      (mode) => {
        if (
          mode === "custom_sql" &&
          props.config.stream_name &&
          !props.config.custom_sql
        ) {
          props.config.custom_sql = buildDefaultSql(
            props.config.stream_name,
            props.config.histogram_interval_value ?? 5,
            props.config.histogram_interval_unit ?? "m",
          );
        }
      },
    );

    // Sync histogram interval changes into the custom SQL histogram() call
    watch(
      () => [
        props.config.histogram_interval_value,
        props.config.histogram_interval_unit,
      ],
      ([newValue, newUnit]) => {
        if (
          props.config.query_mode !== "custom_sql" ||
          !props.config.custom_sql
        )
          return;
        props.config.custom_sql = props.config.custom_sql.replace(
          /histogram\(\s*_timestamp\s*,\s*'[^']+'\s*\)/gi,
          `histogram(_timestamp, '${newValue}${newUnit}')`,
        );
      },
    );

    const addFilter = () => {
      props.config.filters.push({ field: "", operator: "=", value: "" });
    };

    const removeFilter = (idx: number) => {
      props.config.filters.splice(idx, 1);
    };

    const validate = async (): Promise<boolean> => {
      const formValid = formRef.value ? await formRef.value.validate() : true;
      if (
        props.config.query_mode === "custom_sql" &&
        !props.config.custom_sql
      ) {
        return false;
      }
      if (hasTimestampAlias.value) {
        return false;
      }
      if (
        !props.config.histogram_interval_value ||
        props.config.histogram_interval_value < 1
      ) {
        return false;
      }
      if (
        !props.config.schedule_interval_value ||
        props.config.schedule_interval_value < 1
      ) {
        return false;
      }
      if (
        !props.config.detection_window_value ||
        props.config.detection_window_value < 1
      ) {
        return false;
      }
      if (
        props.config.query_mode === "filters" &&
        props.config.detection_function &&
        props.config.detection_function !== "count" &&
        !props.config.detection_function_field
      ) {
        return false;
      }
      return formValid;
    };

    // ── Data Preview chart ──────────────────────────────────────────────────
    const previewActive = ref(false);
    const previewKey = ref(0);
    const previewPanelSchema = ref<any>(null);
    const previewTimeObj = ref<any>(null);

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
          const fn =
            props.config.detection_function === "count" ||
            !props.config.detection_function
              ? "count(*)"
              : `${props.config.detection_function}(${props.config.detection_function_field || "*"})`;
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
              name: "max threshold",
              type: "yAxis",
              value: String(thresholdRange.value.max),
            },
            {
              name: "min threshold",
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
    // detection function changes
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

    // ── Sensitivity slider ──────────────────────────────────────────────────
    const thresholdRange = ref<{ min: number; max: number }>({
      min: props.config.threshold_min ?? 0,
      max: props.config.threshold ?? 100,
    });

    const onThresholdRangeChange = (val: { min: number; max: number }) => {
      props.config.threshold_min = val.min;
      props.config.threshold = val.max;
    };

    // sync range when config changes externally
    watch(
      () => [props.config.threshold, props.config.threshold_min],
      ([max, min]) => {
        thresholdRange.value = {
          min: (min as number) ?? 0,
          max: (max as number) ?? 100,
        };
      },
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
      formRef,
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
      filterFieldOptions,
      filterDetectionFieldOptions,
      onDetectionFunctionChange,
      addFilter,
      removeFilter,
      validate,
      hasTimestampAlias,
      thresholdRange,
      onThresholdRangeChange,
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

<style lang="scss" scoped>
.step-anomaly-config {
  height: 100%;

  .step-content {
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.alert-settings-row {
  margin-bottom: 16px !important;
  padding-bottom: 0 !important;
}

.filter-field-select {
  :deep(.q-field__native span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :deep(.q-field__input) {
    text-overflow: ellipsis;
  }
}

.paired-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.paired-col {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
}

.paired-col-label {
  width: 170px;
  min-width: 170px;
  min-height: 32px;
  line-height: 1.4;
  font-size: inherit;
}

// Monaco SQL editor wrapper
.custom-sql-editor-wrapper {
  height: 140px;
  border-radius: 0.25rem;
  overflow: hidden;

  &.light-editor {
    border: 1px solid rgba(0, 0, 0, 0.12);
  }

  &.dark-editor {
    border: 1px solid rgba(255, 255, 255, 0.18);
  }
}

// Sensitivity chart
.sensitivity-chart-container {
  width: 100%;
}

.sensitivity-chart-wrapper {
  min-height: 180px;
  position: relative;
}

.sensitivity-empty-state {
  width: 100%;
  height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  border: 1px dashed var(--o2-border);
}

.sensitivity-slider-col {
  width: 60px;
  flex-shrink: 0;
}

.sensitivity-range-slider {
  // Chart is 180px. With containLabel:true and top/bottom 3% margins (~5px
  // each), the y-axis label at top takes ~15px and the x-axis time labels at
  // bottom take ~25px, leaving the data area at ~top:20px, height:130px.
  margin-top: 14px;
  height: 145px !important;

  --slider-accent: color-mix(
    in srgb,
    var(--q-primary) 55%,
    var(--o2-primary-background)
  );

  // Selection track
  :deep(.q-slider__selection) {
    background: var(--slider-accent) !important;
  }

  // Thumbs
  :deep(.q-slider__thumb) {
    color: var(--slider-accent) !important;

    circle {
      stroke: var(--slider-accent) !important;
      fill: var(--slider-accent) !important;
    }
  }

  // Value labels (number plates)
  :deep(.q-slider__pin-value-marker-bg) {
    background: var(--slider-accent) !important;
  }

  :deep(.q-slider__pin-value-marker) {
    color: white !important;
    font-size: 10px !important;
  }

  // Ruler tick marks — light grey
  :deep(.q-slider__markers) {
    color: var(--o2-border) !important;
    opacity: 0.8;
  }

  // Marker labels (scale numbers)
  :deep(.q-slider__marker-labels-container) {
    color: var(--o2-text-secondary);
    font-size: 9px;
  }
}

// Reuse alerts wizard frequency toggle button styles
.frequency-toggle-group {
  display: flex;
  width: fit-content;
}

.frequency-toggle-btn {
  border: 1px solid !important;
  border-radius: 0 !important;
  transition: all 0.2s ease;
  margin: 0 !important;

  &.active {
    border-color: var(--q-primary) !important;
    background-color: var(--q-primary) !important;
    color: white !important;
    z-index: 1;
  }

  &.inactive {
    border-color: #d0d0d0 !important;
    background-color: transparent !important;
  }
}

.frequency-toggle-left {
  border-radius: 4px 0 0 4px !important;
}

.frequency-toggle-right {
  border-left: none !important;
  border-radius: 0 4px 4px 0 !important;
}

.dark-mode {
  .frequency-toggle-btn {
    &.inactive {
      border-color: #404040 !important;
      color: #bdbdbd !important;
    }
  }
}

.light-mode {
  .frequency-toggle-btn {
    &.inactive {
      color: #5c5c5c !important;
    }
  }
}
</style>
