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

    <div class="flex h-full flex-col">
      <!-- ── Loading skeleton ── -->
      <div v-if="loading" class="flex flex-col gap-3 p-5">
        <div class="mb-2 flex gap-6">
          <div class="rounded-default h-10 w-28 animate-pulse bg-[var(--color-border-default)]" />
          <div class="rounded-default h-10 w-20 animate-pulse bg-[var(--color-border-default)]" />
          <div class="rounded-default h-10 w-40 animate-pulse bg-[var(--color-border-default)]" />
        </div>
        <div
          v-for="i in 2"
          :key="i"
          class="rounded-default border-border-default overflow-hidden border"
        >
          <div class="h-11 w-full animate-pulse bg-[var(--color-border-default)]" />
          <div class="flex flex-col gap-2 p-4">
            <div class="rounded-default h-4 w-2/3 animate-pulse bg-[var(--color-border-default)]" />
            <div class="rounded-default h-4 w-1/2 animate-pulse bg-[var(--color-border-default)]" />
          </div>
        </div>
      </div>

      <!-- ── Query error ── -->
      <div
        v-else-if="queryError"
        class="text-text-muted flex flex-col items-center gap-3 px-5 py-16"
      >
        <OIcon name="error_outline" size="xl" class="text-status-error-text" />
        <p class="text-status-error-text text-sm font-medium">
          {{ t("synthetics.runDetail.loadFailed") }}
        </p>
        <p class="text-text-secondary max-w-sm text-center font-mono text-xs">{{ queryError }}</p>
      </div>

      <!-- ── No data ── -->
      <div
        v-else-if="!locations.length"
        class="text-text-muted flex flex-col items-center gap-3 px-5 py-16"
      >
        <OIcon name="hourglass_empty" size="xl" />
        <p class="text-sm font-medium">{{ t("synthetics.runDetail.noExecutionData") }}</p>
        <p class="text-text-secondary text-center text-xs">
          {{ t("synthetics.runDetail.noExecutionDataDesc", { runId: runId }) }}
        </p>
      </div>

      <!-- ── Data ── -->
      <template v-else>
        <!-- Summary strip -->
        <div
          class="border-border-default bg-surface-panel grid shrink-0 grid-cols-3 gap-x-6 border-b px-5 py-4"
        >
          <div>
            <p
              class="text-3xs text-text-muted mb-[0.2rem] font-semibold tracking-[0.06em] uppercase"
            >
              {{ t("synthetics.runDetail.maxDuration") }}
            </p>
            <p class="text-text-body text-sm font-semibold">{{ fmtDuration(overallDurationMs) }}</p>
          </div>
          <div>
            <p
              class="text-3xs text-text-muted mb-[0.2rem] font-semibold tracking-[0.06em] uppercase"
            >
              {{ t("synthetics.runDetail.locations") }}
            </p>
            <p class="text-text-body text-sm font-semibold">{{ locations.length }}</p>
          </div>
          <div>
            <p
              class="text-3xs text-text-muted mb-[0.2rem] font-semibold tracking-[0.06em] uppercase"
            >
              {{ t("synthetics.runDetail.runId") }}
            </p>
            <p class="text-text-secondary mt-0.5 truncate font-mono text-xs" :title="runId">
              {{ runId }}
            </p>
          </div>
        </div>

        <!-- Per-location cards -->
        <div class="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div
            v-for="loc in locations"
            :key="loc.executionId"
            class="bg-surface-base rounded-default border-border-default overflow-hidden border"
          >
            <!-- Card header -->
            <div
              class="bg-surface-panel border-border-default flex items-center gap-2.5 border-b px-4 py-3"
            >
              <OBadge :variant="statusVariant(loc.status)" size="sm">{{
                statusLabel(loc.status)
              }}</OBadge>
              <span class="text-text-heading truncate text-sm font-semibold">{{
                loc.location || "—"
              }}</span>
              <div class="ml-auto flex shrink-0 items-center gap-3">
                <span class="text-text-muted text-xs">{{
                  [loc.browserEngine, loc.device].filter(Boolean).join(" · ")
                }}</span>
                <span class="text-text-body text-sm font-medium tabular-nums">{{
                  fmtDuration(loc.durationMs)
                }}</span>
              </div>
            </div>

            <div class="divide-border-default divide-y">
              <!-- Error -->
              <div v-if="loc.error" class="px-4 py-3">
                <p
                  class="text-status-error-text mb-1.5 flex items-center gap-1.5 text-xs font-semibold"
                >
                  <OIcon name="cancel" size="xs" />
                  {{ t("synthetics.results.error") }}
                </p>
                <pre
                  class="text-text-secondary bg-status-error-bg rounded-default border border-[var(--color-status-error-text)] px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                  >{{ loc.error }}</pre
                >
              </div>

              <!-- Steps -->
              <div v-if="loc.steps.length" class="px-4 py-3">
                <OButton
                  variant="ghost"
                  size="xs"
                  class="text-text-body mb-2 flex items-center gap-1.5 font-semibold"
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
                    class="text-status-error-text ml-1"
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
                      class="text-3xs mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold text-white"
                      :class="
                        step.status === 'ok'
                          ? 'bg-[var(--color-success-600)]'
                          : 'bg-[var(--color-error-500)]'
                      "
                      >{{ idx + 1 }}</span
                    >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-text-secondary truncate font-mono">{{
                          step.stepId
                        }}</span>
                        <span class="text-text-muted ml-auto shrink-0 tabular-nums">{{
                          fmtDuration(step.durationMs)
                        }}</span>
                      </div>
                      <p
                        v-if="step.error"
                        class="text-status-error-text mt-0.5 truncate"
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
                <p class="text-text-heading mb-2 text-xs font-semibold">
                  {{ t("synthetics.runDetail.screenshots") }}
                </p>
                <div class="grid grid-cols-2 gap-2">
                  <div
                    v-for="step in loc.steps.filter((s) => s.screenshotKey)"
                    :key="step.stepId"
                    class="rounded-default border-border-default bg-surface-panel overflow-hidden border"
                  >
                    <div class="border-border-default flex items-center gap-1.5 border-b px-2 py-1">
                      <span
                        class="h-2 w-2 shrink-0 rounded-full"
                        :class="
                          step.status === 'ok'
                            ? 'bg-[var(--color-success-500)]'
                            : 'bg-[var(--color-error-500)]'
                        "
                      />
                      <span class="text-3xs text-text-muted truncate font-mono">{{
                        step.stepId
                      }}</span>
                    </div>
                    <a :href="artifactUrl(step.screenshotKey!)" target="_blank">
                      <img
                        :src="artifactUrl(step.screenshotKey!)"
                        :alt="`Screenshot ${step.stepId}`"
                        class="block max-h-48 w-full object-contain transition-opacity hover:opacity-90"
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
                  class="text-text-link hover:text-text-link-hover bg-surface-panel border-border-default rounded-default inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-medium transition-colors"
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
