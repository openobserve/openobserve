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
  <div
    class="step-anomaly-config"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content card-container tw:px-3 tw:py-4">
      <q-form ref="formRef" @submit.prevent>
        <!-- Query Mode toggle -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            {{ t("alerts.queryMode") }}
          </div>
          <div>
            <div class="tw:flex frequency-toggle-group">
              <q-btn
                label="Filters"
                :outline="config.query_mode !== 'filters'"
                :unelevated="config.query_mode === 'filters'"
                :color="config.query_mode === 'filters' ? 'primary' : 'grey-7'"
                no-caps
                size="sm"
                class="tw:px-4 frequency-toggle-btn frequency-toggle-left"
                :class="config.query_mode === 'filters' ? 'active' : 'inactive'"
                data-test="anomaly-query-mode-filters"
                @click="config.query_mode = 'filters'"
              />
              <q-btn
                label="Custom SQL"
                :outline="config.query_mode !== 'custom_sql'"
                :unelevated="config.query_mode === 'custom_sql'"
                :color="
                  config.query_mode === 'custom_sql' ? 'primary' : 'grey-7'
                "
                no-caps
                size="sm"
                class="tw:px-4 frequency-toggle-btn frequency-toggle-right"
                :class="
                  config.query_mode === 'custom_sql' ? 'active' : 'inactive'
                "
                data-test="anomaly-query-mode-sql"
                @click="config.query_mode = 'custom_sql'"
              />
            </div>
          </div>
        </div>

        <!-- Filters mode -->
        <div
          v-if="config.query_mode === 'filters'"
          class="flex items-start alert-settings-row"
        >
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; min-height: 36px; padding-top: 4px"
          >
            Filters
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
                input-debounce="200"
                :placeholder="filter.field ? '' : 'Field'"
                style="width: 160px; background: none"
                :loading="loadingFields"
                @filter="filterFieldOptions"
              >
                <template #no-option>
                  <q-item>
                    <q-item-section class="text-grey">
                      {{
                        config.stream_name
                          ? "No fields found"
                          : "Select a stream first"
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
                style="width: 110px; background: none"
              />
              <q-input
                v-if="operatorNeedsValue(filter.operator)"
                v-model="filter.value"
                dense
                borderless
                placeholder="Value"
                style="flex: 1; background: none"
              />
              <q-btn
                flat
                round
                dense
                size="sm"
                icon="close"
                @click="removeFilter(idx)"
              />
            </div>
            <q-btn
              flat
              no-caps
              dense
              icon="add"
              label="Add filter"
              color="primary"
              size="sm"
              @click="addFilter"
            />
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
            Custom SQL <span class="text-negative tw:ml-1">*</span>
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
                  !config.stream_name ? 'Select a stream first' : ''
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
              SQL is required in custom SQL mode
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

        <!-- Detection Function (filters mode only) -->
        <div
          v-if="config.query_mode === 'filters'"
          class="flex items-start alert-settings-row"
        >
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
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
              style="width: 110px; background: none"
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
              :placeholder="config.detection_function_field ? '' : 'Field'"
              :loading="loadingFields"
              :rules="[(v) => !!v || 'Field is required']"
              hide-bottom-space
              data-test="anomaly-detection-function-field"
              style="width: 180px; background: none"
              @filter="filterDetectionFieldOptions"
            >
              <template #no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    {{
                      config.stream_name
                        ? "No fields found"
                        : "Select a stream first"
                    }}
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>
        </div>

        <!-- Detection Resolution -->
        <div class="flex items-start alert-settings-row">
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
                <span style="font-size: 14px">
                  How granular each data point is. E.g. "5m" means anomalies are
                  detected at 5-minute resolution.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important">
                <q-input
                  v-model.number="config.histogram_interval_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none"
                  data-test="anomaly-histogram-interval-value"
                />
              </div>
              <q-select
                v-model="config.histogram_interval_unit"
                :options="intervalUnits"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                dense
                borderless
                style="min-width: 100px; background: none"
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

        <!-- Schedule Interval -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            Schedule Interval <span class="text-negative tw:ml-1">*</span>
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
                  How often the detection job runs. Can be larger than the
                  sample period (e.g. sample every 5m, run detection every 1h).
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important">
                <q-input
                  v-model.number="config.schedule_interval_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none"
                  data-test="anomaly-schedule-interval-value"
                />
              </div>
              <q-select
                v-model="config.schedule_interval_unit"
                :options="intervalUnits"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                dense
                borderless
                style="min-width: 100px; background: none"
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

        <!-- Look Back Window (detection_window) -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            Look Back Window <span class="text-negative tw:ml-1">*</span>
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
                  How far back each detection run queries. Caps the window even
                  after a long pause. Defaults to Schedule Interval.
                </span>
              </q-tooltip>
            </q-icon>
          </div>
          <div>
            <div class="flex items-center" style="width: fit-content">
              <div style="width: 87px; margin-left: 0 !important">
                <q-input
                  v-model.number="config.detection_window_value"
                  type="number"
                  dense
                  borderless
                  min="1"
                  style="background: none"
                  data-test="anomaly-detection-window-value"
                />
              </div>
              <q-select
                v-model="config.detection_window_unit"
                :options="intervalUnits"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                dense
                borderless
                style="min-width: 100px; background: none"
                data-test="anomaly-detection-window-unit"
              />
            </div>
          </div>
        </div>

        <!-- Training Window -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
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
          <div class="tw:flex tw:flex-col" style="width: calc(100% - 190px)">
            <q-input
              v-model.number="config.training_window_days"
              type="number"
              dense
              borderless
              hide-bottom-space
              :min="1"
              :rules="[(v) => v >= 1 || 'Minimum 1 day']"
              data-test="anomaly-training-window"
              style="width: 87px"
            />
            <span
              class="text-caption tw:mt-1"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              days (seasonality:
              {{
                config.training_window_days >= 7
                  ? "hour + day-of-week"
                  : "hour-of-day"
              }})
            </span>
          </div>
        </div>

        <!-- Retrain interval -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; height: 36px"
          >
            Retrain Every
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
                <span style="font-size: 14px"
                  >How often to automatically retrain the model. "Never" means
                  train once and keep the model until manually retrained.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
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
              style="max-width: 200px; background: none"
            />
          </div>
        </div>

        <!-- Threshold / Sensitivity -->
        <div class="flex items-start alert-settings-row">
          <div
            class="tw:font-semibold flex items-center"
            style="width: 190px; padding-top: 4px"
          >
            Sensitivity
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
                <span style="font-size: 14px"
                  >Adjust the anomaly score range to control sensitivity. Points
                  with scores outside this range will not trigger alerts. Use
                  the chart to visualize historical data and tune
                  accordingly.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- Chart + Slider container -->
            <div class="sensitivity-chart-container">
              <!-- Header row: range labels + load button -->
              <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <span class="text-caption text-grey-6"
                    >Anomaly Score Range:</span
                  >
                  <span
                    class="tw:font-semibold text-caption"
                    data-test="anomaly-threshold-range-label"
                    >{{ config.threshold_min ?? 0 }} –
                    {{ config.threshold }}</span
                  >
                </div>
                <q-btn
                  flat
                  dense
                  no-caps
                  size="sm"
                  icon="refresh"
                  :loading="historyLoading"
                  :disable="!config.id || historyLoading"
                  class="text-caption"
                  data-test="anomaly-sensitivity-load-btn"
                  @click="loadSensitivityHistory"
                >
                  <q-tooltip v-if="!config.id"
                    >Available after saving</q-tooltip
                  >
                  <span v-else class="q-ml-xs">Load Data</span>
                </q-btn>
              </div>

              <!-- Chart + Vertical Slider row -->
              <div class="tw:flex tw:gap-3">
                <!-- ECharts time series chart -->
                <div class="sensitivity-chart-wrapper tw:flex-1">
                  <div
                    v-if="!config.id"
                    class="sensitivity-empty-state"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-6'
                    "
                  >
                    <q-icon
                      name="bar_chart"
                      size="2rem"
                      class="tw:mb-2 tw:opacity-40"
                    />
                    <span class="text-caption"
                      >Save first to load historical data</span
                    >
                  </div>
                  <div
                    v-else-if="historyLoading"
                    class="sensitivity-empty-state"
                  >
                    <q-spinner size="1.5rem" color="primary" />
                  </div>
                  <div
                    v-else-if="historyPoints.length === 0"
                    class="sensitivity-empty-state"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-grey-5'
                        : 'text-grey-6'
                    "
                  >
                    <q-icon
                      name="timeline"
                      size="2rem"
                      class="tw:mb-2 tw:opacity-40"
                    />
                    <span class="text-caption"
                      >No history data yet. Click Load Data.</span
                    >
                  </div>
                  <div
                    v-else
                    ref="chartRef"
                    class="sensitivity-chart"
                    data-test="anomaly-sensitivity-chart"
                  />
                </div>

                <!-- Vertical dual-handle range slider -->
                <div
                  class="sensitivity-slider-col tw:flex tw:flex-col tw:items-center"
                >
                  <q-range
                    v-model="thresholdRange"
                    :min="0"
                    :max="100"
                    :step="1"
                    vertical
                    reverse
                    color="primary"
                    label-always
                    markers
                    :marker-labels="[{ value: 0, label: '0' }, { value: 25, label: '25' }, { value: 50, label: '50' }, { value: 75, label: '75' }, { value: 100, label: '100' }]"
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
import { defineComponent, ref, watch, onUnmounted, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import * as echarts from "echarts";
import streamService from "@/services/stream";
import anomalyDetectionService from "@/services/anomaly_detection";
import {
  ANOMALY_FILTER_OPERATORS,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";
import QueryEditor from "@/components/QueryEditor.vue";

export default defineComponent({
  name: "AnomalyDetectionConfig",

  components: { QueryEditor },

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

    const filterOperators = ANOMALY_FILTER_OPERATORS;
    const detectionFunctions = [
      "count",
      "avg",
      "sum",
      "min",
      "max",
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

    // Build default SQL template for a given stream name and histogram interval
    const buildDefaultSql = (
      streamName: string,
      intervalValue: number,
      intervalUnit: string,
    ) =>
      `SELECT histogram(_timestamp, '${intervalValue}${intervalUnit}') AS time_bucket, count(*) AS value\nFROM "${streamName}"\nGROUP BY time_bucket\nORDER BY time_bucket`;

    // Stream fields for filter field selector and detection function field
    const allStreamFields = ref<string[]>([]);
    const filteredStreamFields = ref<string[]>([]);
    const filteredDetectionFields = ref<string[]>([]);
    const loadingFields = ref(false);

    const loadStreamFields = async () => {
      const streamName = props.config.stream_name;
      const streamType = props.config.stream_type;
      if (!streamName || !streamType) {
        allStreamFields.value = [];
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
        filteredStreamFields.value = allStreamFields.value;
        filteredDetectionFields.value = allStreamFields.value;
      } catch {
        allStreamFields.value = [];
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
        filteredDetectionFields.value = needle
          ? allStreamFields.value.filter((f) =>
              f.toLowerCase().includes(needle),
            )
          : allStreamFields.value;
      });
    };

    const onDetectionFunctionChange = (fn: string) => {
      if (fn === "count") {
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
      return formValid;
    };

    // ── Sensitivity chart ───────────────────────────────────────────────────
    const chartRef = ref<HTMLElement | null>(null);
    const historyLoading = ref(false);
    const historyPoints = ref<
      Array<{ ts: number; value: number; score: number }>
    >([]);
    const thresholdRange = ref<{ min: number; max: number }>({
      min: props.config.threshold_min ?? 0,
      max: props.config.threshold ?? 97,
    });

    let chartInstance: echarts.ECharts | null = null;

    const isDark = () => store.state.theme === "dark";

    const buildChartOption = () => {
      const pts = historyPoints.value;
      const scatterData = pts.map((p) => [p.ts, p.value, p.score]);
      const lineData = pts.map((p) => [p.ts, p.value]);
      const scores = pts.map((p) => p.score);
      const minScore = scores.length ? Math.min(...scores) : 0;
      const maxScore = scores.length ? Math.max(...scores) : 100;

      return {
        backgroundColor: "transparent",
        animation: false,
        grid: { left: 50, right: 90, top: 10, bottom: 30 },
        xAxis: {
          type: "time",
          axisLabel: {
            color: isDark() ? "#9e9e9e" : "#666",
            fontSize: 10,
            formatter: (val: number) => {
              const d = new Date(val);
              return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
            },
          },
          axisLine: { lineStyle: { color: isDark() ? "#444" : "#ddd" } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          name: "Value",
          nameTextStyle: { color: isDark() ? "#9e9e9e" : "#666", fontSize: 10 },
          axisLabel: { color: isDark() ? "#9e9e9e" : "#666", fontSize: 10 },
          axisLine: { lineStyle: { color: isDark() ? "#444" : "#ddd" } },
          splitLine: { lineStyle: { color: isDark() ? "#333" : "#eee" } },
        },
        visualMap: {
          min: minScore,
          max: maxScore,
          dimension: 2,
          orient: "vertical",
          right: 0,
          top: "center",
          text: ["High", "Low"],
          textStyle: { color: isDark() ? "#9e9e9e" : "#666", fontSize: 10 },
          calculable: false,
          inRange: {
            color: ["#5470c6", "#91cc75", "#fac858", "#ee6666"],
          },
          width: 12,
          itemHeight: 100,
        },
        tooltip: {
          trigger: "item",
          formatter: (params: any) => {
            if (params.seriesIndex === 0) {
              const [ts, val, score] = params.data;
              const d = new Date(ts);
              return `${d.toLocaleString()}<br/>Value: ${Number(val).toFixed(4)}<br/>Score: ${Number(score).toFixed(2)}`;
            }
            return "";
          },
        },
        series: [
          {
            name: "Data",
            type: "scatter",
            data: scatterData,
            symbolSize: 6,
            encode: { x: 0, y: 1, tooltip: [0, 1, 2] },
          },
          {
            name: "Baseline",
            type: "line",
            data: lineData,
            lineStyle: { color: isDark() ? "#555" : "#ccc", width: 1 },
            symbol: "none",
            z: 0,
          },
        ],
      };
    };

    const renderChart = () => {
      if (!chartRef.value || historyPoints.value.length === 0) return;
      if (!chartInstance) {
        chartInstance = echarts.init(
          chartRef.value,
          isDark() ? "dark" : undefined,
        );
      }
      chartInstance.setOption(buildChartOption(), true);
    };

    watch(historyPoints, () => {
      setTimeout(renderChart, 50);
    });

    watch(
      () => store.state.theme,
      () => {
        if (chartInstance) {
          chartInstance.dispose();
          chartInstance = null;
        }
        setTimeout(renderChart, 50);
      },
    );

    const loadSensitivityHistory = async () => {
      const orgId = store.state.selectedOrganization?.identifier;
      if (!orgId || !props.config.id) return;
      historyLoading.value = true;
      try {
        const res = await anomalyDetectionService.getHistory(
          orgId,
          props.config.id,
          200,
        );
        const raw: any[] = res.data?.history ?? res.data?.list ?? [];
        historyPoints.value = raw
          .map((r: any) => ({
            ts: r.timestamp ?? r._timestamp ?? r.ts ?? 0,
            value: r.actual_value ?? r.value ?? 0,
            score: r.anomaly_score ?? r.score ?? 0,
          }))
          .filter((p) => p.ts > 0)
          .sort((a, b) => a.ts - b.ts);
      } catch {
        historyPoints.value = [];
      } finally {
        historyLoading.value = false;
      }
    };

    const onThresholdRangeChange = (val: { min: number; max: number }) => {
      props.config.threshold_min = val.min;
      props.config.threshold = val.max;
    };

    // init range from config
    watch(
      () => [props.config.threshold, props.config.threshold_min],
      ([max, min]) => {
        thresholdRange.value = {
          min: (min as number) ?? 0,
          max: (max as number) ?? 97,
        };
      },
    );

    onUnmounted(() => {
      chartInstance?.dispose();
      chartInstance = null;
    });

    return {
      t,
      store,
      formRef,
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
      chartRef,
      historyLoading,
      historyPoints,
      thresholdRange,
      loadSensitivityHistory,
      onThresholdRangeChange,
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
  margin-bottom: 24px !important;
  padding-bottom: 0 !important;
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

.sensitivity-chart {
  width: 100%;
  height: 180px;
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
  height: 180px;

  --slider-accent: color-mix(
    in srgb,
    var(--o2-primary-color) 55%,
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
  :deep(.q-slider__marker) {
    background: var(--o2-border) !important;
    opacity: 0.6;
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
