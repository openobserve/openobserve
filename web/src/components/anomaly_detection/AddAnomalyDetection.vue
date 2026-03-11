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
  <div class="anomaly-wizard" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <!-- Header -->
    <div class="row items-center no-wrap card-container tw:mx-[0.625rem] tw:mb-[0.625rem]">
      <div class="flex items-center justify-between tw:w-full card-container tw:h-[68px] tw:px-2 tw:py-3">
        <div class="flex items-center tw:gap-2">
          <q-btn flat round dense icon="arrow_back" @click="goBack" />
          <div>
            <div class="text-h6 tw:font-semibold">
              {{ isEdit ? t("alerts.editAnomalyDetection") : t("alerts.newAnomalyDetection") }}
            </div>
            <div
              class="text-caption"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              {{ t("alerts.anomalyDetectionSubtitle") }}
            </div>
          </div>
        </div>

        <!-- Status badge (edit mode only) -->
        <div v-if="isEdit && config.status" class="flex items-center tw:gap-3 tw:flex-wrap">
          <q-badge :color="statusColor" :label="config.status" class="text-caption" />
          <span
            v-if="config.last_detection_run && config.last_detection_run > 0"
            class="text-caption"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            Last run: {{ formatTs(config.last_detection_run) }}
          </span>
          <q-btn
            v-if="config.status === 'failed'"
            flat
            no-caps
            dense
            size="sm"
            color="negative"
            icon="replay"
            label="Retry Training"
            :loading="retraining"
            @click="triggerRetrain"
          />
        </div>
        <!-- Error banner (edit mode, failed status) -->
        <div
          v-if="isEdit && config.status === 'failed' && config.last_error"
          class="tw:mt-1 tw:rounded tw:px-3 tw:py-2 text-caption text-negative"
          style="background: rgba(244, 67, 54, 0.08); border: 1px solid rgba(244, 67, 54, 0.3); max-width: 600px"
        >
          <strong>Training error:</strong> {{ config.last_error }}
        </div>
      </div>
    </div>

    <!-- Wizard body -->
    <div
      class="wizard-view-container tw:mb-2"
      :style="{ maxHeight: 'calc(100vh - 194px)', overflowY: 'auto' }"
    >
      <div class="card-container tw:px-2 tw:mx-[0.675rem] tw:py-2" style="position: relative">
        <q-stepper
          v-model="step"
          flat
          header-nav
          animated
          class="anomaly-wizard-stepper"
        >
          <!-- Step 1: Setup -->
          <q-step :name="1" :title="t('alerts.steps.alertSetup')" icon="settings" :done="step > 1">
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 302px)">
              <div style="flex: 0 0 62%; overflow-y: auto">
                <AnomalySetup ref="step1Ref" :config="config" :is-edit="isEdit" />
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
            </div>
          </q-step>

          <!-- Step 2: Detection Config -->
          <q-step
            :name="2"
            :title="t('alerts.anomalyDetectionConfig')"
            icon="manage_search"
            :done="step > 2"
          >
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 302px)">
              <div style="flex: 0 0 62%; overflow-y: auto">
                <AnomalyDetectionConfig ref="step2Ref" :config="config" />
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
            </div>
          </q-step>

          <!-- Step 3: Alerting -->
          <q-step :name="3" :title="t('alerts.alerting')" icon="notifications">
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 302px)">
              <div style="flex: 0 0 62%; overflow-y: auto">
                <AnomalyAlerting
                  :config="config"
                  :destinations="destinations"
                  @refresh:destinations="$emit('refresh:destinations')"
                />
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem)"></div>
            </div>
          </q-step>
        </q-stepper>

        <!-- Right panel (persistent, overlaid) -->
        <div
          style="
            position: absolute;
            top: 86px;
            right: 4px;
            width: calc(39% - 1.5rem);
            height: calc(100vh - 302px);
            overflow-y: auto;
            pointer-events: auto;
            z-index: 10;
          "
        >
          <!-- SQL Preview -->
          <div class="collapsible-panel tw:mb-2">
            <div
              class="panel-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:cursor-pointer"
              @click="showSqlPreview = !showSqlPreview"
            >
              <span class="tw:font-semibold text-caption">{{ t("alerts.sqlPreview") }}</span>
              <q-btn
                flat
                round
                dense
                size="xs"
                :icon="showSqlPreview ? 'expand_less' : 'expand_more'"
              />
            </div>
            <div v-show="showSqlPreview" class="tw:px-3 tw:pb-3">
              <pre
                class="tw:text-xs tw:whitespace-pre-wrap tw:break-all tw:m-0 tw:rounded tw:p-2"
                :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:text-gray-200' : 'tw:bg-gray-100 tw:text-gray-800'"
              >{{ previewSql }}</pre>
            </div>
          </div>

          <!-- Summary -->
          <div class="collapsible-panel">
            <div
              class="panel-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:cursor-pointer"
              @click="showSummary = !showSummary"
            >
              <span class="tw:font-semibold text-caption">{{ t("alerts.configSummary") }}</span>
              <q-btn
                flat
                round
                dense
                size="xs"
                :icon="showSummary ? 'expand_less' : 'expand_more'"
              />
            </div>
            <div v-show="showSummary" class="tw:px-3 tw:pb-3">
              <div class="tw:flex tw:flex-col tw:gap-2">
                <div v-if="config.stream_name" class="summary-row">
                  <span class="summary-label">Stream</span>
                  <span>
                    <q-badge color="primary" :label="config.stream_type" class="tw:mr-1 text-caption" />
                    <span class="text-caption">{{ config.stream_name }}</span>
                  </span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Query mode</span>
                  <q-badge
                    :color="config.query_mode === 'custom_sql' ? 'deep-purple' : 'teal'"
                    :label="config.query_mode === 'custom_sql' ? 'Custom SQL' : 'Filters'"
                    class="text-caption"
                  />
                </div>
                <div v-if="config.query_mode === 'filters'" class="summary-row">
                  <span class="summary-label">Function</span>
                  <span class="text-caption">{{ config.detection_function }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Resolution</span>
                  <span class="text-caption">{{ config.histogram_interval_value }}{{ config.histogram_interval_unit }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Schedule</span>
                  <span class="text-caption">{{ config.schedule_interval_value }}{{ config.schedule_interval_unit }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Training</span>
                  <span class="text-caption">
                    {{ config.training_window_days }} days
                    ({{ config.training_window_days >= 7 ? 'hour + day-of-week' : 'hour-of-day' }})
                  </span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Retrain</span>
                  <span class="text-caption">{{ config.retrain_interval_days === 0 ? 'Never' : config.retrain_interval_days + 'd' }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Threshold</span>
                  <span class="text-caption">{{ 100 - config.threshold }}% anomaly rate</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Alerting</span>
                  <q-badge
                    :color="config.alert_enabled ? 'positive' : 'grey'"
                    :label="config.alert_enabled ? 'Enabled' : 'Disabled'"
                    class="text-caption"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer navigation -->
    <div
      class="flex q-px-md full-width tw:py-3 card-container tw:justify-end tw:mx-[0.625rem]"
      style="position: sticky; bottom: 0; width: calc(100% - 1.25rem)"
    >
      <q-btn
        flat
        no-caps
        :label="t('alerts.cancel')"
        class="o2-secondary-button q-mr-sm"
        @click="goBack"
      />
      <q-btn
        v-if="step > 1"
        flat
        no-caps
        :label="t('alerts.back') || 'Back'"
        class="o2-secondary-button q-mr-sm"
        @click="step--"
      />
      <q-separator v-if="step > 1" vertical spaced />
      <q-btn
        v-if="step < 3"
        no-caps
        color="primary"
        :label="t('alerts.continue') || 'Continue'"
        :loading="saving"
        unelevated
        @click="goNext"
      />
      <q-btn
        v-else
        no-caps
        color="primary"
        :label="isEdit ? (t('common.save') || 'Save') : t('alerts.saveAndTrain')"
        :loading="saving"
        unelevated
        @click="save"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, type PropType } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useQuasar, date } from "quasar";
import { useStore } from "vuex";
import AnomalySetup from "./steps/AnomalySetup.vue";
import AnomalyDetectionConfig from "./steps/AnomalyDetectionConfig.vue";
import AnomalyAlerting from "./steps/AnomalyAlerting.vue";
import anomalyDetectionService from "@/services/anomaly_detection";

const defaultConfig = () => ({
  name: "",
  description: "",
  stream_type: "logs",
  stream_name: "",
  query_mode: "filters" as const,
  filters: [] as any[],
  custom_sql: "",
  detection_function: "count",
  // Histogram bucket size (SQL histogram() arg): stored as value + unit
  histogram_interval_value: 5,
  histogram_interval_unit: "m" as "m" | "h",
  // How often the detection job fires: stored as value + unit
  schedule_interval_value: 1,
  schedule_interval_unit: "h" as "m" | "h",
  // How far back each detection run queries: stored as value + unit (default = schedule_interval)
  detection_window_value: 1,
  detection_window_unit: "h" as "m" | "h",
  training_window_days: 14,
  retrain_interval_days: 7,
  threshold: 97,
  alert_enabled: true,
  alert_destination_id: undefined as string | undefined,
  // read-only state fields
  status: undefined as string | undefined,
  is_trained: false,
  enabled: true,
  last_error: undefined as string | undefined,
  last_detection_run: undefined as number | undefined,
  next_run_at: undefined as number | undefined,
});

export default defineComponent({
  name: "AddAnomalyDetection",

  components: {
    AnomalySetup,
    AnomalyDetectionConfig,
    AnomalyAlerting,
  },

  props: {
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },

  emits: ["saved", "cancel", "refresh:destinations"],

  setup(props, { emit }) {
    const router = useRouter();
    const route = useRoute();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();

    const step = ref(1);
    const saving = ref(false);
    const retraining = ref(false);
    const config = ref(defaultConfig());
    const showSqlPreview = ref(true);
    const showSummary = ref(true);

    const step1Ref = ref<any>(null);
    const step2Ref = ref<any>(null);

    const isEdit = computed(() => !!route.params.anomaly_id);

    const statusColor = computed(() => {
      switch (config.value.status) {
        case "active":   return "positive";
        case "training": return "info";
        case "failed":   return "negative";
        default:         return "grey";
      }
    });

    const formatTs = (ts: number) =>
      date.formatDate(ts / 1000, "YYYY-MM-DD HH:mm");

    const histogramInterval = computed(
      () => `${config.value.histogram_interval_value}${config.value.histogram_interval_unit}`,
    );
    const scheduleInterval = computed(
      () => `${config.value.schedule_interval_value}${config.value.schedule_interval_unit}`,
    );
    // Returns seconds (i64) — mirrors alerts' trigger_period_seconds
    const detectionWindowSeconds = computed(() => {
      const mult = config.value.detection_window_unit === "h" ? 3600 : 60;
      return config.value.detection_window_value * mult;
    });

    const previewSql = computed(() => {
      const c = config.value;
      if (c.query_mode === "custom_sql") {
        return c.custom_sql || "-- Enter your SQL in Detection Config step";
      }
      const stream = c.stream_name || "<stream>";
      const interval = histogramInterval.value || "5m";
      const fn = c.detection_function === "count"
        ? "count(*)"
        : `${c.detection_function}(<field>)`;
      const filterLines = (c.filters || [])
        .filter((f: any) => f.field && f.value)
        .map((f: any) => {
          const op = f.operator;
          if (op === "contains")
            return `  AND ${f.field} LIKE '%${f.value}%'`;
          if (op === "not_contains")
            return `  AND ${f.field} NOT LIKE '%${f.value}%'`;
          return `  AND ${f.field} ${op} '${f.value}'`;
        });
      const where = filterLines.length
        ? ["WHERE", ...filterLines.map((l: string, i: number) => i === 0 ? l.replace(/^\s+AND /, "  ") : l)].join("\n")
        : "";

      // Seasonality is auto-determined from training_window_days (same logic as backend)
      const autoSeasonality = c.training_window_days >= 7 ? "week" : "day";
      const seasonalSelect = autoSeasonality === "week"
        ? ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour,\n       date_part('dow', to_timestamp(_timestamp / 1000000)) AS dow"
        : ",\n       date_part('hour', to_timestamp(_timestamp / 1000000)) AS hour";
      const seasonalGroup = autoSeasonality === "week" ? ", hour, dow" : ", hour";

      return [
        `SELECT histogram(_timestamp, '${interval}') AS time_bucket,`,
        `       ${fn} AS value${seasonalSelect}`,
        `FROM ${stream}`,
        where,
        `GROUP BY time_bucket${seasonalGroup}`,
        `ORDER BY time_bucket`,
      ].filter(Boolean).join("\n");
    });

    const goBack = () => {
      router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          tab: "anomalyDetection",
        },
      });
    };

    const goNext = async () => {
      if (step.value === 1 && step1Ref.value) {
        const valid = await step1Ref.value.validate();
        if (!valid) return;
      }
      if (step.value === 2 && step2Ref.value) {
        const valid = await step2Ref.value.validate();
        if (!valid) return;
      }
      step.value++;
    };

    const save = async () => {
      saving.value = true;
      try {
        const orgId = store.state.selectedOrganization.identifier;
        const payload = {
          name: config.value.name,
          description: config.value.description || undefined,
          stream_name: config.value.stream_name,
          stream_type: config.value.stream_type,
          query_mode: config.value.query_mode,
          filters: config.value.query_mode === "filters" ? config.value.filters : undefined,
          custom_sql: config.value.query_mode === "custom_sql" ? config.value.custom_sql : undefined,
          detection_function: config.value.detection_function,
          histogram_interval: histogramInterval.value,
          schedule_interval: scheduleInterval.value,
          detection_window_seconds: detectionWindowSeconds.value,
          training_window_days: config.value.training_window_days,
          retrain_interval_days: config.value.retrain_interval_days,
          percentile: config.value.threshold,
          alert_enabled: config.value.alert_enabled,
          alert_destination_id: config.value.alert_enabled
            ? config.value.alert_destination_id
            : undefined,
        };

        if (isEdit.value) {
          await anomalyDetectionService.update(orgId, route.params.anomaly_id as string, {
            name: payload.name,
            description: payload.description,
            detection_function: payload.detection_function,
            histogram_interval: payload.histogram_interval,
            schedule_interval: payload.schedule_interval,
            detection_window_seconds: payload.detection_window_seconds,
            percentile: payload.percentile,
            retrain_interval_days: payload.retrain_interval_days,
            alert_enabled: payload.alert_enabled,
            alert_destination_id: payload.alert_destination_id,
          });
          $q.notify({ type: "positive", message: "Anomaly detection config updated." });
        } else {
          await anomalyDetectionService.create(orgId, payload);
          $q.notify({
            type: "positive",
            message: "Anomaly detection config created. Training will start shortly.",
          });
        }

        emit("saved");
        goBack();
      } catch (err: any) {
        $q.notify({
          type: "negative",
          message: err?.response?.data?.message || "Failed to save config.",
        });
      } finally {
        saving.value = false;
      }
    };

    const triggerRetrain = async () => {
      const configId = route.params.anomaly_id as string;
      if (!configId) return;
      retraining.value = true;
      try {
        await anomalyDetectionService.triggerTraining(
          store.state.selectedOrganization.identifier,
          configId,
        );
        $q.notify({ type: "positive", message: "Training started. Status will update shortly." });
        // Reload to pick up the cleared last_error + status = 'training'
        await loadConfig();
      } catch {
        $q.notify({ type: "negative", message: "Failed to trigger training." });
      } finally {
        retraining.value = false;
      }
    };

    const prefillFromQuery = () => {
      if (route.query.stream_type) {
        config.value.stream_type = route.query.stream_type as string;
      }
      if (route.query.stream_name) {
        config.value.stream_name = route.query.stream_name as string;
      }
    };

    const loadConfig = async () => {
      const configId = route.params.anomaly_id as string;
      if (!configId) return;
      try {
        const res = await anomalyDetectionService.get(
          store.state.selectedOrganization.identifier,
          configId,
        );
        const data = res.data;

        const parseInterval = (raw: string, defaultValue: number, defaultUnit: "m" | "h") => {
          if (!raw) return { value: defaultValue, unit: defaultUnit };
          if (raw.endsWith("h")) return { value: parseInt(raw) || defaultValue, unit: "h" as const };
          return { value: parseInt(raw) || defaultValue, unit: "m" as const };
        };

        const histInterval = parseInterval(data.histogram_interval || "5m", 5, "m");
        const sched = parseInterval(data.schedule_interval || "1h", 1, "h");
        const parseSeconds = (secs: number) => {
          if (secs >= 3600 && secs % 3600 === 0) return { value: secs / 3600, unit: "h" as const };
          return { value: Math.round(secs / 60), unit: "m" as const };
        };
        const win = data.detection_window_seconds
          ? parseSeconds(data.detection_window_seconds)
          : parseSeconds(sched.value * (sched.unit === "h" ? 3600 : 60));

        config.value = {
          ...defaultConfig(),
          ...data,
          threshold: data.threshold ?? data.percentile ?? 97,
          filters: data.filters ?? [],
          histogram_interval_value: histInterval.value,
          histogram_interval_unit: histInterval.unit,
          schedule_interval_value: sched.value,
          schedule_interval_unit: sched.unit,
          detection_window_value: win.value,
          detection_window_unit: win.unit,
        };
      } catch {
        $q.notify({ type: "negative", message: "Failed to load config." });
        goBack();
      }
    };

    onMounted(async () => {
      if (isEdit.value) {
        await loadConfig();
      } else {
        prefillFromQuery();
      }
    });

    return {
      t,
      store,
      step,
      step1Ref,
      step2Ref,
      config,
      saving,
      retraining,
      isEdit,
      statusColor,
      previewSql,
      showSqlPreview,
      showSummary,
      formatTs,
      goBack,
      goNext,
      save,
      triggerRetrain,
    };
  },
});
</script>

<style lang="scss" scoped>
.anomaly-wizard {
  .collapsible-panel {
    border-radius: 8px;
  }

  .panel-header {
    border-radius: 8px;
    user-select: none;
  }

  .summary-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .summary-label {
    font-weight: 600;
    min-width: 80px;
    font-size: 12px;
    line-height: 20px;
  }

  &.dark-mode {
    .collapsible-panel {
      background-color: #212121;
      border: 1px solid #343434;
    }
    .panel-header:hover {
      background-color: #2a2a2a;
    }
    .summary-label {
      color: #9e9e9e;
    }
  }

  &.light-mode {
    .collapsible-panel {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
    .panel-header:hover {
      background-color: #f9f9f9;
    }
    .summary-label {
      color: #5c5c5c;
    }
  }
}

.anomaly-wizard-stepper {
  :deep(.q-stepper__step-inner) {
    padding: 0;
  }
  :deep(.q-stepper__tab) {
    padding: 8px 16px 8px 8px;
  }
}
</style>
