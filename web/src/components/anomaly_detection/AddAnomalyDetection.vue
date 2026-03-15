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
  <div class="anomaly-wizard full-width q-mx-lg q-pt-xs">
    <!-- Header -->
    <div class="row items-center no-wrap card-container tw:mx-[0.625rem] tw:mb-[0.625rem]">
      <div class="flex items-center justify-between tw:w-full card-container tw:h-[68px] tw:px-2 tw:py-3">
        <div class="flex items-center">
          <div
            class="flex justify-center items-center q-mr-md cursor-pointer"
            style="
              border: 1.5px solid;
              border-radius: 50%;
              width: 22px;
              height: 22px;
            "
            title="Go Back"
            @click="goBack"
          >
            <q-icon name="arrow_back_ios_new" size="14px" />
          </div>
          <div class="text-h6">
            {{ isEdit ? t("alerts.editAnomalyDetection") : t("alerts.newAnomalyDetection") }}
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
      style="
        max-height: calc(100vh - 194px);
        overflow-y: auto;
        scroll-behavior: smooth;
      "
    >
      <div class="card-container tw:px-2 tw:mx-[0.675rem] tw:py-2" style="position: relative">
        <q-stepper
          v-model="step"
          ref="wizardStepper"
          color="primary"
          flat
          header-nav
          keep-alive
          class="anomaly-wizard-stepper"
        >
          <!-- Step caption (appears below active step header) -->
          <template v-slot:message>
            <div
              v-if="currentStepCaption"
              class="persistent-step-caption tw:px-3 tw:py-1 tw:mb-1 tw:mt-2"
              :class="store.state.theme === 'dark' ? 'dark-mode-caption' : 'light-mode-caption'"
            >
              {{ currentStepCaption }}
            </div>
          </template>

          <!-- Step 1: Setup -->
          <q-step :name="1" :title="t('alerts.steps.alertSetup')" icon="settings" :done="step > 1">
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 305px);">
              <div style="flex: 0 0 61.5%; display: flex; flex-direction: column; overflow: hidden;">
                <div style="flex: 1; overflow: auto;">
                  <AnomalySetup
                    ref="step1Ref"
                    :config="config"
                    :is-edit="isEdit"
                    :active-folder-id="activeFolderId"
                    @update:active-folder-id="updateActiveFolderId"
                  />
                </div>
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem);"></div>
            </div>
          </q-step>

          <!-- Step 2: Detection Config -->
          <q-step
            :name="2"
            :title="t('alerts.anomalyDetectionConfig')"
            icon="manage_search"
            :done="step > 2"
          >
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 305px);">
              <div style="flex: 0 0 61.5%; display: flex; flex-direction: column; overflow: hidden;">
                <div style="flex: 1; overflow: auto;">
                  <AnomalyDetectionConfig ref="step2Ref" :config="config" />
                </div>
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem);"></div>
            </div>
          </q-step>

          <!-- Step 3: Alerting -->
          <q-step :name="3" :title="t('alerts.alerting')" icon="notifications">
            <div style="display: flex; gap: 0.625rem; height: calc(100vh - 305px);">
              <div style="flex: 0 0 61.5%; display: flex; flex-direction: column; overflow: hidden;">
                <div style="flex: 1; overflow: auto;">
                  <AnomalyAlerting
                    :config="config"
                    :destinations="destinations"
                    @refresh:destinations="$emit('refresh:destinations')"
                  />
                </div>
              </div>
              <div style="flex: 0 0 calc(35% - 0.625rem);"></div>
            </div>
          </q-step>
        </q-stepper>

        <!-- Right panel (persistent, overlaid) -->
        <div
          class="anomaly-right-column"
          style="
            position: absolute;
            top: 92px;
            right: 12px;
            width: calc(39% - 1.5rem);
            height: calc(100vh - 305px);
            pointer-events: auto;
            z-index: 10;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            overflow: hidden;
          "
        >
          <!-- SQL Preview -->
          <div class="preview-box" style="flex: 1; min-height: 150px;">
            <div class="preview-header tw:flex tw:items-center tw:px-3 tw:py-2">
              <span class="preview-title">{{ config.query_mode === 'custom_sql' ? t("alerts.sqlPreview") : t("alerts.sqlPreview") }}</span>
            </div>
            <div class="preview-content tw:px-3 tw:py-2">
              <pre class="preview-code">{{ previewSql }}</pre>
            </div>
          </div>

          <!-- Summary -->
          <div class="collapsible-section card-container" :style="summarySectionStyle">
            <div
              class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
              @click="showSummary = !showSummary"
            >
              <span class="tw:text-sm tw:font-semibold">{{ t("alerts.summary.title") }}</span>
              <q-btn
                flat
                dense
                round
                size="xs"
                :icon="showSummary ? 'expand_less' : 'expand_more'"
                class="expand-toggle-btn"
                @click.stop
              />
            </div>
            <div v-show="showSummary" class="summary-section-content">
              <AnomalySummary
                style="height: 100%; overflow: auto;"
                :config="config"
                :destinations="destinations"
                :wizard-step="step"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="tw:mx-2">
      <div
        class="flex q-px-md full-width tw:py-3 card-container tw:justify-end"
        style="position: sticky; bottom: 0px; z-index: 2"
      >
        <div class="tw:flex tw:items-center tw:gap-2">
          <q-btn
            flat
            :label="t('alerts.back')"
            class="o2-secondary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            :disable="step === 1"
            no-caps
            @click="step--"
          />
          <q-btn
            flat
            :label="t('alerts.continue')"
            class="o2-secondary-button tw:h-[36px]"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            :disable="step === 3"
            no-caps
            @click="goNext"
          />
          <q-separator vertical class="tw:mx-2" style="height: 36px;" />
          <q-btn
            flat
            class="o2-secondary-button tw:h-[36px]"
            :label="t('alerts.cancel')"
            no-caps
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            @click="goBack"
          />
          <q-btn
            flat
            class="o2-primary-button no-border tw:h-[36px]"
            :label="isEdit ? (t('common.save') || 'Save') : t('alerts.saveAndTrain')"
            no-caps
            :loading="saving"
            :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
            @click="save"
          />
        </div>
      </div>
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
import AnomalySummary from "./AnomalySummary.vue";
import anomalyDetectionService from "@/services/anomaly_detection";
import { getFoldersListByType } from "@/utils/commons";

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
  folder_id: "default",
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
    AnomalySummary,
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
    const showSummary = ref(true);
    const activeFolderId = ref(
      (router.currentRoute.value.query.folder as string) || "default",
    );

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

    const updateActiveFolderId = (folder: any) => {
      activeFolderId.value = folder.value;
      config.value.folder_id = folder.value;
    };

    const summarySectionStyle = computed(() => {
      if (!showSummary.value) return { flex: "0 0 auto" };
      return { flex: "1", minHeight: "150px" };
    });

    const currentStepCaption = computed(() => {
      const captions: Record<number, string> = {
        1: t("alerts.anomalyStepCaptions.alertSetup"),
        2: t("alerts.anomalyStepCaptions.detectionConfig"),
        3: t("alerts.anomalyStepCaptions.alerting"),
      };
      return captions[step.value] || "";
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
          folder_id: activeFolderId.value || "default",
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
        if (data.folder_id) {
          activeFolderId.value = data.folder_id;
        }
      } catch {
        $q.notify({ type: "negative", message: "Failed to load config." });
        goBack();
      }
    };

    onMounted(async () => {
      await getFoldersListByType(store, "alerts");
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
      activeFolderId,
      updateActiveFolderId,
      saving,
      retraining,
      isEdit,
      statusColor,
      previewSql,
      showSummary,
      summarySectionStyle,
      currentStepCaption,
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
  .q-stepper--horizontal .q-stepper__step-inner {
    padding: 5px !important;
  }
}

.collapsible-section {
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 5px 1px var(--o2-hover-shadow);
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));

  .section-header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
    border-radius: 0.375rem 0.375rem 0 0;
    user-select: none;
    transition: background 0.2s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    &:active {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .section-content {
    flex: 1;
    overflow-y: auto;
  }

  .summary-section-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .expand-toggle-btn {
    opacity: 0.5;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}

.preview-box {
  border-radius: 0.375rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
  background-color: var(--o2-primary-background, #f5f5f5);

  .preview-header {
    border-bottom: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
    background-color: var(--o2-card-bg, #ffffff);
  }

  .preview-title {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .preview-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }

  .preview-code {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.75rem;
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--o2-text-primary);
  }
}

// Wizard Stepper Styles
.anomaly-wizard {
  box-shadow: none;

  .q-stepper__step-inner {
    padding: 0.375rem !important;
  }

  .q-stepper__tab {
    padding-left: 0.375rem !important;
    min-height: 30px !important;
  }

  :deep(.q-stepper__tab) {
    padding: 8px 16px;
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


  .q-stepper--horizontal .q-stepper__step-inner {
    padding: 8px !important;
  }

  :deep(.q-stepper__title) {
    font-size: 14px;
    line-height: 1.2;
  }
}

.wizard-view-container {
  :deep(.q-stepper) {
    background: transparent !important;
  }
}

// Persistent step caption styles
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

.dark-mode{
  .alert-setup-container{
  background-color: #212121;
  padding: 8px 16px;
  margin-left: 8px;
  border: 1px solid #343434;
  border-top: 0px !important;
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px ;
}
.q-text-area-input > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.dark-mode-row-template  > div > div  { 
  background-color:rgb(30, 31, 31) !important;
  border: 1px solid $input-border !important;
}
.custom-input-label{
  color: #BDBDBD;
}
}
.light-mode{
  .alert-setup-container{
    background-color: #ffffff;
    padding: 8px 16px;
    margin-left: 8px;
    border: 1px solid #e6e6e6;
    border-top: 0px !important;
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px ;
  }
  .custom-input-label{
    color: #5C5C5C;
  }
  .q-field--labeled.showLabelOnTop.q-field .q-field__control{
    border: 1px solid #d4d4d4;
  }
  .add-folder-btn{
    border: 1px solid #d4d4d4;
  }
  .dark-mode .q-text-area-input > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}

.light-mode .q-text-area-input > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
.dark-mode-row-template > div > div  { 
  background-color: #181a1b !important;
  border: 1px solid black !important;
}
.light-mode-row-template > div > div  { 
  background-color:#ffffff !important;
  border: 1px solid #e0e0e0 !important;
}
}
.q-text-area-input > div > div > div > textarea{  
    height: 80px !important;
    resize: none !important;
}
.row-template-input > div > div > div > textarea{
  height: 160px !important;
  resize: none !important;
}
.bottom-sticky-dark{
  background-color: #212121;
}
.bottom-sticky-light{
  background-color: #ffffff;
  border-top: 1px solid #d4d4d4
}
.input-box-bg-dark .q-field__control{
  background-color: #181a1b !important;
}
.input-box-bg-light .q-field__control{
  background-color: #ffffff !important;
}
.input-border-dark .q-field__control{
  border: 1px solid #181a1b !important;
}
.input-border-light .q-field__control{
  border: 1px solid #d4d4d4 !important;
}


.o2-alert-tab-border{
  border-top: 0.0625rem solid var(--o2-border-color);
}

// Wizard Stepper Styles
.anomaly-wizard-stepper {
  box-shadow: none;
  .q-stepper__step-inner{
    padding: 0.375rem !important;
  }
  .q-stepper__tab{
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
  .anomaly-wizard-stepper {
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
