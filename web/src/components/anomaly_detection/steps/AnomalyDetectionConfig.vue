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
            <q-input
              v-model="config.custom_sql"
              dense
              borderless
              type="textarea"
              rows="5"
              placeholder="SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM stream_name GROUP BY time_bucket ORDER BY time_bucket"
              :rules="[(v) => !!v || 'SQL is required in custom SQL mode']"
              data-test="anomaly-custom-sql"
              class="sql-input"
            />
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
          <div style="width: calc(100% - 190px)">
            <q-select
              v-model="config.detection_function"
              :options="detectionFunctions"
              dense
              borderless
              hide-bottom-space
              :rules="[(v) => !!v || 'Detection function is required']"
              data-test="anomaly-detection-function"
              style="max-width: 200px; background: none"
            />
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
            style="width: 190px; height: 36px"
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
                  >Higher sensitivity flags more data points as anomalies. Lower
                  sensitivity only flags the most extreme outliers. Internally
                  stored as the {{ config.threshold }}th percentile
                  cutoff.</span
                >
              </q-tooltip>
            </q-icon>
          </div>
          <div style="width: calc(100% - 190px)">
            <!-- +/- stepper row -->
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-1">
              <q-btn
                flat
                dense
                round
                icon="remove"
                size="sm"
                :disable="config.threshold <= 90"
                @click="config.threshold = Math.max(90, config.threshold - 1)"
                data-test="anomaly-threshold-dec"
              />
              <div class="tw:text-center" style="min-width: 140px">
                <span class="tw:font-semibold"
style="font-size: 13px"
                  >~{{ 100 - config.threshold }}%</span
                >
                <span class="text-caption text-grey-6 q-ml-xs"
                  >of data flagged</span
                >
              </div>
              <q-btn
                flat
                dense
                round
                icon="add"
                size="sm"
                :disable="config.threshold >= 99"
                @click="config.threshold = Math.min(99, config.threshold + 1)"
                data-test="anomaly-threshold-inc"
              />
              <q-badge
                :color="
                  config.threshold <= 92
                    ? 'negative'
                    : config.threshold <= 95
                      ? 'warning'
                      : 'positive'
                "
                :label="
                  config.threshold <= 92
                    ? 'High'
                    : config.threshold <= 95
                      ? 'Medium'
                      : 'Low'
                "
                class="q-ml-xs"
              />
            </div>
            <!-- slider for fine-grained control -->
            <q-slider
              v-model="config.threshold"
              :min="90"
              :max="99"
              :step="1"
              snap
              color="primary"
              style="max-width: 280px"
              data-test="anomaly-threshold"
            />
            <div
              class="tw:flex tw:justify-between text-caption"
              style="max-width: 280px"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
            >
              <span>← More sensitive</span>
              <span>Less sensitive →</span>
            </div>
          </div>
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import streamService from "@/services/stream";
import {
  ANOMALY_FILTER_OPERATORS,
  operatorNeedsValue,
} from "@/utils/alerts/anomalyFilterOperators";

export default defineComponent({
  name: "AnomalyDetectionConfig",

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

    // Stream fields for filter field selector
    const allStreamFields = ref<string[]>([]);
    const filteredStreamFields = ref<string[]>([]);
    const loadingFields = ref(false);

    const loadStreamFields = async () => {
      const streamName = props.config.stream_name;
      const streamType = props.config.stream_type;
      if (!streamName || !streamType) {
        allStreamFields.value = [];
        filteredStreamFields.value = [];
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
      } catch {
        allStreamFields.value = [];
        filteredStreamFields.value = [];
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

    watch(
      () => [props.config.stream_name, props.config.stream_type],
      () => loadStreamFields(),
      { immediate: true },
    );

    const addFilter = () => {
      props.config.filters.push({ field: "", operator: "=", value: "" });
    };

    const removeFilter = (idx: number) => {
      props.config.filters.splice(idx, 1);
    };

    const validate = async (): Promise<boolean> => {
      return formRef.value ? formRef.value.validate() : true;
    };

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
      loadingFields,
      filterFieldOptions,
      addFilter,
      removeFilter,
      validate,
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

// SQL textarea — border applied directly to the Quasar field control
.sql-input {
  :deep(.q-field__control) {
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 0.25rem;
    padding: 0;
  }

  :deep(.q-field__native) {
    font-family: monospace;
    font-size: 0.75rem;
    padding: 0.5rem 0.75rem;
  }

  .body--dark & :deep(.q-field__control) {
    border-color: rgba(255, 255, 255, 0.18);
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
