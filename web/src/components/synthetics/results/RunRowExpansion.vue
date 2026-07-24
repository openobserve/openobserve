<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  buildRunDetailSql,
  mapRunLocationResult,
  type RunLocationResult,
  type RunStatus,
  type StepResult,
} from "@/composables/synthetics/syntheticResultsSchema";
import syntheticsService from "@/services/synthetics";
import ExecutionDetailDrawer from "./ExecutionDetailDrawer.vue";

const props = defineProps<{
  runId: string;
  monitorId: string;
  scheduledTs: number; // microseconds
  runStatus?: string;
}>();

const store = useStore();
const { t } = useI18n();
const { executeQuery, cancelAll } = useLLMStreamQuery();

// ── Data loading ──────────────────────────────────────────────────────────

const loading = ref(true);
const queryError = ref<string | null>(null);
const executions = ref<RunLocationResult[]>([]);

watch(
  () => props.runId,
  async () => {
    loading.value = true;
    queryError.value = null;
    executions.value = [];
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
      executions.value = rows.map(mapRunLocationResult);
      initExpanded();
    } catch (e: any) {
      const msg: string = e?.message ?? "";
      // Stream not found = no results written yet (e.g. probe infra error before first run).
      // Treat as empty rather than surfacing a technical error.
      const isIgnorable =
        /stream.*not.*found|table.*not.*found|not.*found|field.*not.*found|search field|column.*not.*exist/i.test(
          msg,
        );
      if (!isIgnorable) {
        queryError.value = msg || "Query failed";
      }
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

onUnmounted(() => cancelAll());

// ── Grouping by location ──────────────────────────────────────────────────

interface LocationGroup {
  location: string;
  status: RunStatus;
  durationMs: number;
  execs: RunLocationResult[];
}

const locationGroups = computed<LocationGroup[]>(() => {
  const map = new Map<string, RunLocationResult[]>();
  for (const ex of executions.value) {
    const key = ex.location || t("synthetics.runRowExpansion.unknownLocation");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ex);
  }
  return Array.from(map.entries()).map(([location, execs]) => ({
    location,
    execs,
    status: worstStatus(execs.map((e) => e.status)),
    durationMs: Math.max(...execs.map((e) => e.durationMs)),
  }));
});

// ── Accordion state ───────────────────────────────────────────────────────

// Locations expanded (show execution table inside)
const expandedLocations = ref(new Set<string>());
// Drawer state
const selectedExecution = ref<RunLocationResult | null>(null);

function openDrawer(ex: RunLocationResult) {
  selectedExecution.value = ex;
}

function initExpanded() {
  expandedLocations.value = new Set();
}

function toggleLocation(loc: string) {
  const s = new Set(expandedLocations.value);
  if (s.has(loc)) s.delete(loc);
  else s.add(loc);
  expandedLocations.value = s;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function worstStatus(statuses: RunStatus[]): RunStatus {
  const rank: Record<RunStatus, number> = { passed: 1, warning: 2, failed: 3, error: 4 };
  let worst: RunStatus = "passed";
  for (const s of statuses) {
    if (rank[s] > rank[worst]) worst = s;
  }
  return worst;
}

const STATUS_COLOR: Record<RunStatus | "pending", string> = {
  passed: "text-[var(--color-success-500)]",
  warning: "text-(--color-orange-500)",
  failed: "text-[var(--color-error-500)]",
  error: "text-[var(--color-warning-500)]",
  pending: "text-text-muted",
};

function statusDot(s: RunStatus) {
  return s === "error" ? "○" : "●";
}

function statusLabel(s: RunStatus) {
  return s === "passed"
    ? t("synthetics.results.passed")
    : s === "warning"
      ? t("synthetics.results.warning")
      : s === "error"
        ? t("synthetics.results.error")
        : t("synthetics.results.failed");
}

function fmtDuration(ms: number) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function deviceIcon(device: string) {
  if (device?.includes("mobile") || device?.includes("tablet")) return "smartphone";
  return "laptop";
}

const org = computed(() => store.state.selectedOrganization.identifier);

function artifactUrl(key: string) {
  return syntheticsService.artifactUrl(org.value, key);
}

function failedAtStep(steps: StepResult[]): string {
  const step = steps.find((s) => s.status === "fail");
  return step ? step.stepId || "—" : "—";
}
</script>

<template>
  <div class="run-expansion border-border-default bg-surface-panel border-t">
    <!-- Loading skeleton -->
    <div v-if="loading" class="flex flex-col gap-2 p-4">
      <div class="flex items-center gap-3 py-2">
        <div class="rounded-default h-4 w-24 animate-pulse bg-[var(--color-border-default)]" />
        <div class="rounded-default h-4 w-16 animate-pulse bg-[var(--color-border-default)]" />
        <div class="rounded-default h-4 w-40 animate-pulse bg-[var(--color-border-default)]" />
      </div>
      <div class="rounded-default h-24 w-full animate-pulse bg-[var(--color-border-default)]" />
    </div>

    <!-- Query error -->
    <div v-else-if="queryError" class="text-status-error-text flex items-center gap-2 p-4 text-xs">
      <OIcon name="error_outline" size="sm" />
      <span>{{ queryError }}</span>
    </div>

    <!-- No data -->
    <div v-else-if="!executions.length" class="text-text-muted flex items-center gap-2 p-4 text-xs">
      <OIcon name="info" size="sm" />
      <span v-if="runStatus === 'error'">{{
        t("synthetics.runRowExpansion.probeInfraError")
      }}</span>
      <span v-else>{{ t("synthetics.runRowExpansion.noExecutionData") }}</span>
    </div>

    <!-- Location groups -->
    <template v-else>
      <!-- Warning banner for warning runs -->
      <div
        v-if="
          locationGroups.some((g) => g.status === 'warning') &&
          locationGroups.every((g) => g.status !== 'failed' && g.status !== 'error')
        "
        class="flex items-center gap-2 border-b border-(--color-orange-500)/20 bg-(--color-orange-500)/10 px-4 py-2 text-xs text-(--color-orange-600)"
      >
        <OIcon name="warning" size="xs" />
        {{ t("synthetics.runRowExpansion.flakyWarning") }}
      </div>

      <div class="divide-border-default flex flex-col divide-y">
        <div v-for="group in locationGroups" :key="group.location" class="location-group">
          <!-- Location header row — click to expand/collapse -->
          <OButton
            variant="ghost"
            size="xs"
            class="w-full justify-start gap-2 px-4 py-2.5 text-left text-xs font-medium"
            :data-test="`synthetics-run-row-toggle-location-${group.location}-btn`"
            @click="toggleLocation(group.location)"
          >
            <OIcon
              :name="expandedLocations.has(group.location) ? 'expand_more' : 'chevron_right'"
              size="sm"
              class="text-text-muted shrink-0"
            />
            <span :class="STATUS_COLOR[group.status]" class="text-sm font-bold">
              {{ statusDot(group.status) }}
            </span>
            <span class="text-text-heading font-semibold">{{ group.location }}</span>
            <span :class="STATUS_COLOR[group.status]" class="font-medium">
              {{ statusLabel(group.status) }}
            </span>
            <span class="text-text-muted">{{ fmtDuration(group.durationMs) }}</span>
            <span class="text-text-muted ml-auto">
              {{ t("synthetics.runRowExpansion.executions", { count: group.execs.length }) }}
            </span>
          </OButton>

          <!-- Location expansion: execution table -->
          <div v-if="expandedLocations.has(group.location)" class="px-4 pb-3">
            <!-- Execution summary table -->
            <div class="rounded-default border-border-default mb-3 overflow-hidden border">
              <table class="w-full text-xs">
                <thead>
                  <tr class="bg-surface-panel border-border-default border-b">
                    <th
                      class="text-text-muted text-3xs px-3 py-2 text-left font-semibold tracking-wide uppercase"
                    >
                      {{ t("synthetics.runRowExpansion.browserHeader") }}
                    </th>
                    <th
                      class="text-text-muted text-3xs px-3 py-2 text-left font-semibold tracking-wide uppercase"
                    >
                      {{ t("synthetics.runRowExpansion.deviceHeader") }}
                    </th>
                    <th
                      class="text-text-muted text-3xs px-3 py-2 text-left font-semibold tracking-wide uppercase"
                    >
                      {{ t("synthetics.results.status") }}
                    </th>
                    <th
                      class="text-text-muted text-3xs px-3 py-2 text-right font-semibold tracking-wide uppercase"
                    >
                      {{ t("synthetics.results.duration") }}
                    </th>
                    <th
                      class="text-text-muted text-3xs px-3 py-2 text-left font-semibold tracking-wide uppercase"
                    >
                      {{ t("synthetics.runRowExpansion.failedAtHeader") }}
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-border-default divide-y">
                  <tr
                    v-for="ex in group.execs"
                    :key="ex.executionId"
                    class="hover:bg-surface-subtle-hover cursor-pointer transition-colors"
                    @click="openDrawer(ex)"
                  >
                    <td class="px-3 py-2 font-medium capitalize">{{ ex.browserEngine }}</td>
                    <td class="px-3 py-2">
                      <span class="flex items-center gap-1">
                        <OIcon :name="deviceIcon(ex.device)" size="xs" class="text-text-muted" />
                        {{ ex.device || "—" }}
                      </span>
                    </td>
                    <td class="px-3 py-2">
                      <span
                        class="flex items-center gap-1.5 font-semibold"
                        :class="STATUS_COLOR[ex.status]"
                      >
                        <span class="text-base leading-none">{{ statusDot(ex.status) }}</span>
                        {{ statusLabel(ex.status) }}
                        <span v-if="ex.status === 'warning'" class="text-text-muted font-normal">{{
                          t("synthetics.runRowExpansion.flaky")
                        }}</span>
                      </span>
                    </td>
                    <td class="text-text-secondary px-3 py-2 text-right tabular-nums">
                      {{ fmtDuration(ex.durationMs) }}
                    </td>
                    <td class="text-text-muted max-w-48 truncate px-3 py-2 font-mono">
                      {{ ex.status !== "passed" ? failedAtStep(ex.steps) : "—" }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Execution detail drawer -->
    <ExecutionDetailDrawer
      :execution="selectedExecution"
      :artifact-url-fn="artifactUrl"
      @close="selectedExecution = null"
    />
  </div>
</template>
