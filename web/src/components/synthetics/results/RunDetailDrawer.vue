<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  buildRunDetailSql,
  mapRunLocationResult,
  type RunLocationResult,
  type RunStatus,
} from "@/composables/synthetics/syntheticResultsSchema";
import syntheticsService from "@/services/synthetics";

const { t } = useI18n();

const props = defineProps<{
  runId: string;
  monitorId: string;
  scheduledTs: number; // microseconds
  open: boolean;
}>();

const emit = defineEmits<{ close: [] }>();

const store = useStore();
const { executeQuery, cancelAll } = useLLMStreamQuery();

const loading = ref(false);
const queryError = ref<string | null>(null);
const locations = ref<RunLocationResult[]>([]);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      cancelAll();
      return;
    }
    loading.value = true;
    queryError.value = null;
    locations.value = [];
    expandedSteps.value = new Set();
    try {
      const windowUs = 5 * 60 * 1_000_000;
      const start = props.scheduledTs - windowUs;
      const end = props.scheduledTs + windowUs;
      const rows = await executeQuery(
        buildRunDetailSql(props.monitorId, props.runId, ""),
        start,
        end,
        "logs",
      );
      locations.value = rows.map(mapRunLocationResult);
      // Auto-expand steps for locations that have failures
      for (const loc of locations.value) {
        if (loc.steps.some((s) => s.status === "fail") || loc.status !== "passed") {
          expandedSteps.value.add(loc.executionId);
        }
      }
      expandedSteps.value = new Set(expandedSteps.value);
    } catch (e: any) {
      queryError.value = e?.message ?? "Query failed";
    } finally {
      loading.value = false;
    }
  },
  { immediate: false },
);

const org = computed(() => store.state.selectedOrganization.identifier);

function artifactUrl(key: string) {
  return syntheticsService.artifactUrl(org.value, key);
}

const overallStatus = computed<RunStatus | null>(() => {
  if (!locations.value.length) return null;
  const rank: Record<RunStatus, number> = { passed: 1, warning: 2, failed: 3, error: 4 };
  let worst: RunStatus = "passed";
  for (const l of locations.value) {
    if (rank[l.status] > rank[worst]) worst = l.status;
  }
  return worst;
});

const overallDurationMs = computed(() =>
  locations.value.length ? Math.max(...locations.value.map((l) => l.durationMs)) : 0,
);

function statusVariant(s: RunStatus) {
  if (s === "passed") return "success";
  if (s === "warning") return "warning";
  return "error";
}

function statusLabel(s: RunStatus) {
  if (s === "passed") return t("synthetics.results.passed");
  if (s === "warning") return t("synthetics.results.warning");
  if (s === "error") return t("synthetics.results.error");
  return t("synthetics.results.failed");
}

function fmtDuration(ms: number) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtTime(tsMicros: number) {
  const ms = tsMicros > 1e12 ? tsMicros / 1000 : tsMicros;
  return new Date(ms).toLocaleString();
}

// Steps with errors or screenshots — expanded by default per location
const expandedSteps = ref<Set<string>>(new Set());
function toggleSteps(executionId: string) {
  if (expandedSteps.value.has(executionId)) {
    expandedSteps.value.delete(executionId);
  } else {
    expandedSteps.value.add(executionId);
  }
  expandedSteps.value = new Set(expandedSteps.value);
}
</script>

<template>
  <ODrawer
    bleed
    :open="open"
    size="lg"
    :title="t('synthetics.runDetail.title')"
    :sub-title="fmtTime(scheduledTs)"
    @update:open="
      (v) => {
        if (!v) emit('close');
      }
    "
  >
    <template #header-right>
      <OBadge v-if="overallStatus" :variant="statusVariant(overallStatus)" size="md">
        {{ statusLabel(overallStatus) }}
      </OBadge>
    </template>

    <div class="flex flex-col h-full">
      <!-- ── Loading skeleton ── -->
      <div v-if="loading" class="flex flex-col gap-3 p-5">
        <div class="flex gap-6 mb-2">
          <div class="bg-[var(--color-border-default)] animate-pulse h-10 w-28 rounded-default" />
          <div class="bg-[var(--color-border-default)] animate-pulse h-10 w-20 rounded-default" />
          <div class="bg-[var(--color-border-default)] animate-pulse h-10 w-40 rounded-default" />
        </div>
        <div
          v-for="i in 2"
          :key="i"
          class="rounded-default border border-border-default overflow-hidden"
        >
          <div class="bg-[var(--color-border-default)] animate-pulse h-11 w-full" />
          <div class="p-4 flex flex-col gap-2">
            <div class="bg-[var(--color-border-default)] animate-pulse h-4 w-2/3 rounded-default" />
            <div class="bg-[var(--color-border-default)] animate-pulse h-4 w-1/2 rounded-default" />
          </div>
        </div>
      </div>

      <!-- ── Query error ── -->
      <div
        v-else-if="queryError"
        class="flex flex-col items-center gap-3 py-16 text-text-muted px-5"
      >
        <OIcon name="error_outline" size="xl" class="text-status-error-text" />
        <p class="text-sm font-medium text-status-error-text">
          {{ t("synthetics.runDetail.loadFailed") }}
        </p>
        <p class="text-xs font-mono text-text-secondary text-center max-w-sm">{{ queryError }}</p>
      </div>

      <!-- ── No data ── -->
      <div
        v-else-if="!locations.length"
        class="flex flex-col items-center gap-3 py-16 text-text-muted px-5"
      >
        <OIcon name="hourglass_empty" size="xl" />
        <p class="text-sm font-medium">{{ t("synthetics.runDetail.noExecutionData") }}</p>
        <p class="text-xs text-text-secondary text-center">
          {{ t("synthetics.runDetail.noExecutionDataDesc", { runId: runId }) }}
        </p>
      </div>

      <!-- ── Data ── -->
      <template v-else>
        <!-- Summary strip -->
        <div
          class="grid grid-cols-3 gap-x-6 px-5 py-4 border-b border-border-default bg-surface-panel shrink-0"
        >
          <div>
            <p
              class="text-3xs font-semibold uppercase tracking-[0.06em] text-text-muted mb-[0.2rem]"
            >
              {{ t("synthetics.runDetail.maxDuration") }}
            </p>
            <p class="text-sm font-semibold text-text-body">{{ fmtDuration(overallDurationMs) }}</p>
          </div>
          <div>
            <p
              class="text-3xs font-semibold uppercase tracking-[0.06em] text-text-muted mb-[0.2rem]"
            >
              {{ t("synthetics.runDetail.locations") }}
            </p>
            <p class="text-sm font-semibold text-text-body">{{ locations.length }}</p>
          </div>
          <div>
            <p
              class="text-3xs font-semibold uppercase tracking-[0.06em] text-text-muted mb-[0.2rem]"
            >
              {{ t("synthetics.runDetail.runId") }}
            </p>
            <p class="text-xs font-mono text-text-secondary truncate mt-0.5" :title="runId">
              {{ runId }}
            </p>
          </div>
        </div>

        <!-- Per-location cards -->
        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div
            v-for="loc in locations"
            :key="loc.executionId"
            class="bg-surface-base rounded-default border border-border-default overflow-hidden"
          >
            <!-- Card header -->
            <div
              class="flex items-center gap-2.5 px-4 py-3 bg-surface-panel border-b border-border-default"
            >
              <OBadge :variant="statusVariant(loc.status)" size="sm">{{
                statusLabel(loc.status)
              }}</OBadge>
              <span class="text-sm font-semibold text-text-heading truncate">{{
                loc.location || "—"
              }}</span>
              <div class="ml-auto flex items-center gap-3 shrink-0">
                <span class="text-xs text-text-muted">{{
                  [loc.browserEngine, loc.device].filter(Boolean).join(" · ")
                }}</span>
                <span class="text-sm font-medium tabular-nums text-text-body">{{
                  fmtDuration(loc.durationMs)
                }}</span>
              </div>
            </div>

            <div class="divide-y divide-border-default">
              <!-- Error -->
              <div v-if="loc.error" class="px-4 py-3">
                <p
                  class="text-xs font-semibold text-status-error-text flex items-center gap-1.5 mb-1.5"
                >
                  <OIcon name="cancel" size="xs" />
                  {{ t("synthetics.results.error") }}
                </p>
                <pre
                  class="whitespace-pre-wrap font-mono text-xs text-text-secondary leading-relaxed bg-status-error-bg rounded-default px-3 py-2 border border-[var(--color-status-error-text)]"
                  >{{ loc.error }}</pre
                >
              </div>

              <!-- Steps -->
              <div v-if="loc.steps.length" class="px-4 py-3">
                <OButton
                  variant="ghost"
                  size="xs"
                  class="flex items-center gap-1.5 font-semibold text-text-body mb-2"
                  :data-test="`synthetics-run-detail-toggle-steps-${loc.executionId}-btn`"
                  @click="toggleSteps(loc.executionId)"
                >
                  <OIcon
                    :name="expandedSteps.has(loc.executionId) ? 'expand_less' : 'expand_more'"
                    size="sm"
                  />
                  {{ t("synthetics.runDetail.stepsCount", { count: loc.steps.length }) }}
                  <span
                    v-if="loc.steps.some((s) => s.status === 'fail')"
                    class="ml-1 text-status-error-text"
                  >
                    ·
                    {{
                      t("synthetics.runDetail.failedCount", {
                        count: loc.steps.filter((s) => s.status === "fail").length,
                      })
                    }}
                  </span>
                </OButton>

                <div v-if="expandedSteps.has(loc.executionId)" class="flex flex-col gap-1">
                  <div
                    v-for="(step, idx) in loc.steps"
                    :key="step.stepId"
                    class="flex items-start gap-2.5 py-1.5 text-xs"
                  >
                    <span
                      class="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-white text-3xs font-bold mt-px"
                      :class="
                        step.status === 'ok'
                          ? 'bg-[var(--color-success-600)]'
                          : 'bg-[var(--color-error-500)]'
                      "
                      >{{ idx + 1 }}</span
                    >
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="font-mono text-text-secondary truncate">{{
                          step.stepId
                        }}</span>
                        <span class="ml-auto tabular-nums text-text-muted shrink-0">{{
                          fmtDuration(step.durationMs)
                        }}</span>
                      </div>
                      <p
                        v-if="step.error"
                        class="text-status-error-text truncate mt-0.5"
                        :title="step.error"
                      >
                        {{ step.error }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Screenshots -->
              <div v-if="loc.steps.some((s) => s.screenshotKey)" class="px-4 py-3">
                <p class="text-xs font-semibold text-text-heading mb-2">
                  {{ t("synthetics.runDetail.screenshots") }}
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <div
                    v-for="step in loc.steps.filter((s) => s.screenshotKey)"
                    :key="step.stepId"
                    class="rounded-default border border-border-default overflow-hidden bg-surface-panel"
                  >
                    <div class="flex items-center gap-1.5 px-2 py-1 border-b border-border-default">
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        :class="
                          step.status === 'ok'
                            ? 'bg-[var(--color-success-500)]'
                            : 'bg-[var(--color-error-500)]'
                        "
                      />
                      <span class="text-3xs font-mono text-text-muted truncate">{{
                        step.stepId
                      }}</span>
                    </div>
                    <a :href="artifactUrl(step.screenshotKey!)" target="_blank">
                      <img
                        :src="artifactUrl(step.screenshotKey!)"
                        :alt="`Screenshot ${step.stepId}`"
                        class="w-full block object-contain max-h-48 hover:opacity-90 transition-opacity"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>
              </div>

              <!-- Trace -->
              <div v-if="loc.traceKey" class="px-4 py-3">
                <a
                  :href="artifactUrl(loc.traceKey)"
                  target="_blank"
                  class="inline-flex items-center gap-2 text-xs font-medium text-text-link hover:text-text-link-hover bg-surface-panel border border-border-default rounded-default px-3 py-1.5 transition-colors"
                >
                  <OIcon name="download" size="xs" />
                  {{ t("synthetics.runDetail.downloadTrace", { filename: "trace.zip" }) }}
                </a>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </ODrawer>
</template>
