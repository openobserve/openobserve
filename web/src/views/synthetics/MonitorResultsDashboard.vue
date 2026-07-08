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
  <!-- Chrome-less wrapper: the KPI tiles, chart and table each carry their own
       card-container, mirroring the LLM Insights dashboard. -->
  <div
    class="synthetic-results-dashboard h-full flex flex-col px-[0.625rem]"
    data-test="synthetic-monitor-results-dashboard"
  >
    <div class="flex-1 overflow-y-auto pb-[0.625rem]">
      <!-- KPI Cards Row -->
      <div
        class="grid grid-cols-4 gap-[0.625rem] mt-[0.625rem] mb-[0.625rem]"
      >
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="kpi-card card-container rounded-lg flex flex-col px-[0.875rem] pt-[0.625rem] pb-[0.625rem] gap-[0.25rem]"
          :data-test="`synthetic-monitor-results-kpi-${card.key}`"
        >
          <div class="flex flex-col gap-[0.25rem]">
            <div
              class="kpi-label text-[0.7rem] font-semibold text-[var(--o2-text-muted)]"
            >
              {{ card.label }}
            </div>
            <div class="flex items-baseline gap-[0.2rem]">
              <span
                class="text-[1.4rem] font-bold leading-none text-[var(--o2-text-primary)]"
                :class="card.valueClass"
              >
                {{ card.value }}
              </span>
              <span
                v-if="card.unit"
                class="text-[0.8rem] font-semibold text-[var(--o2-text-secondary)]"
              >
                {{ card.unit }}
              </span>
            </div>
          </div>
          <KpiSparkline
            v-if="card.sparkData && card.sparkData.length > 1"
            :data="card.sparkData"
            :color="card.sparkColor"
            :height="32"
            class="mt-auto"
          />
        </div>
      </div>

      <!-- Response Time chart -->
      <section
        class="card-container rounded-lg px-[0.875rem] py-[0.75rem] mb-[0.625rem]"
        data-test="synthetic-monitor-results-response-time-chart"
      >
        <header class="flex items-baseline gap-[0.5rem] mb-[0.5rem]">
          <h4
            class="text-[0.85rem] font-semibold text-[var(--o2-text-heading)]"
          >
            {{ t("synthetics.results.responseTime") }}
          </h4>
          <small class="text-[var(--o2-text-caption)]">
            {{ t("synthetics.results.responseTimeSubtitle") }}
          </small>
        </header>
        <div ref="chartEl" class="response-time-chart" />
      </section>

      <!-- Runs table (expandable) -->
      <section
        class="card-container rounded-lg overflow-hidden"
        data-test="synthetic-monitor-results-runs-section"
      >
        <header class="flex items-center justify-between px-[0.875rem] pt-[0.75rem] pb-[0.5rem]">
          <h4 class="text-[0.85rem] font-semibold text-[var(--o2-text-heading)]">
            {{ t("synthetics.results.recentRuns") }}
          </h4>
          <span v-if="runsTotal" class="text-xs text-[var(--o2-text-muted)]">{{ runsTotal }} runs</span>
        </header>

        <!-- Loading skeleton -->
        <div v-if="runsLoading" class="flex flex-col gap-1 px-4 py-3">
          <div v-for="i in 5" :key="i" class="runs-skel h-9 rounded" />
        </div>

        <!-- Empty -->
        <div v-else-if="!runRows.length" class="flex items-center justify-center py-12 text-sm text-[var(--o2-text-muted)]">
          {{ t("synthetics.results.noRuns") }}
        </div>

        <!-- Table -->
        <div v-else class="runs-list">
          <!-- Column headers -->
          <div class="runs-header grid text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--o2-text-muted)] px-4 py-1.5 border-b border-[var(--o2-border-color)]">
            <span class="pl-5">Status</span>
            <span>Started</span>
            <span class="text-right">Duration</span>
            <span>Locations</span>
            <span>Trigger</span>
          </div>

          <!-- Rows -->
          <div
            v-for="run in runRows"
            :key="run.id"
            class="border-b border-[var(--o2-border-color)] last:border-b-0"
          >
            <!-- Summary row -->
            <button
              class="runs-row w-full grid items-center px-4 py-2.5 text-xs text-left hover:bg-[var(--o2-surface-hover)] transition-colors"
              :class="run.status === 'pending' ? 'cursor-default' : 'cursor-pointer'"
              :disabled="run.status === 'pending'"
              @click="run.status !== 'pending' && toggleRunExpansion(run.id)"
            >
              <!-- Chevron + status -->
              <span class="flex items-center gap-1.5">
                <OIcon
                  v-if="run.status !== 'pending'"
                  :name="expandedRunIds.has(run.id) ? 'expand_more' : 'chevron_right'"
                  size="xs"
                  class="text-[var(--o2-text-muted)] shrink-0"
                />
                <span v-else class="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                  <span class="run-status-spinner inline-block" />
                </span>
                <span
                  class="run-status flex items-center gap-1.5 font-semibold"
                  :class="`run-status--${run.status}`"
                >
                  <span v-if="run.status !== 'pending'" class="run-status-dot" />
                  {{
                    run.status === 'passed' ? t('synthetics.results.passed')
                    : run.status === 'warning' ? t('synthetics.results.warning')
                    : run.status === 'error' ? t('synthetics.results.error')
                    : run.status === 'pending' ? 'In Progress'
                    : t('synthetics.results.failed')
                  }}
                </span>
              </span>
              <span class="text-[var(--o2-text-secondary)]">{{ relativeFromNow(run.scheduledTs / 1000) }}</span>
              <span class="text-right tabular-nums text-[var(--o2-text-secondary)]">
                {{ run.durationMs ? formatDuration(run.durationMs) : '—' }}
              </span>
              <span class="text-[var(--o2-text-muted)]">{{ run.jobsDone }}/{{ run.jobCount }}</span>
              <span class="text-[var(--o2-text-muted)] capitalize">{{ run.triggerType || 'scheduled' }}</span>
            </button>

            <!-- Inline expansion -->
            <RunRowExpansion
              v-if="expandedRunIds.has(run.id)"
              :run-id="run.id"
              :monitor-id="monitorId"
              :scheduled-ts="run.scheduledTs"
              :run-status="run.status"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import * as echarts from "echarts";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import KpiSparkline from "@/plugins/traces/KpiSparkline.vue";
import RunRowExpansion from "@/components/synthetics/results/RunRowExpansion.vue";
import {
  splitDuration,
} from "@/plugins/traces/llmInsightsDashboard.utils";
import { formatDuration } from "@/utils/formatters";
import useSyntheticResults from "@/composables/useSyntheticResults";
import syntheticsService from "@/services/synthetics";

interface Props {
  monitorId: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
}
const props = defineProps<Props>();

const { t } = useI18n();
const store = useStore();

const { kpi, buckets, loading, fetchAll, cancelAll } =
  useSyntheticResults();

// ── KPI cards (exact LLM kpiCards design, 4 cards) ───────────────────────
interface KpiCard {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sparkData?: number[];
  sparkColor?: string;
  valueClass?: string;
}

const kpiCards = computed<KpiCard[]>(() => {
  // splitDuration takes microseconds; our durations are milliseconds.
  const p95 = splitDuration(kpi.value.p95Ms * 1000);
  const lastStatus = kpi.value.lastRunStatus;
  return [
    {
      key: "uptime",
      label: t("synthetics.results.uptime"),
      value: kpi.value.uptimePct.toFixed(2),
      unit: "%",
      sparkData: buckets.value.map((b) => b.uptimePct),
      sparkColor: "#16a34a",
    },
    {
      key: "p95",
      label: t("synthetics.results.p95Duration"),
      value: p95.value,
      unit: p95.unit,
      sparkData: buckets.value.map((b) => b.p95Ms),
      sparkColor: "#3b82f6",
    },
    {
      key: "failed",
      label: t("synthetics.results.failedRuns"),
      value: kpi.value.failedRuns.toLocaleString(),
      sparkData: buckets.value.map((b) => b.failedRuns),
      sparkColor: "#ef4444",
    },
    {
      key: "last-run",
      label: t("synthetics.results.lastRun"),
      value: lastStatus
        ? lastStatus === "passed"
          ? t("synthetics.results.passed")
          : lastStatus === "warning"
            ? t("synthetics.results.warning")
            : lastStatus === "error"
              ? t("synthetics.results.error")
              : t("synthetics.results.failed")
        : "—",
      unit: kpi.value.lastRunAt
        ? relativeFromNow(kpi.value.lastRunAt)
        : undefined,
      valueClass:
        lastStatus === "passed"
          ? "text-[#16a34a]!"
          : lastStatus === "warning"
            ? "text-[var(--o2-status-warning-text)]!"
            : lastStatus === "failed" || lastStatus === "error"
              ? "text-[var(--o2-status-error-text)]!"
              : undefined,
    },
  ];
});

// ── Runs table (REST API) ─────────────────────────────────────────────────
interface RunRow {
  id: string;          // run_id (KSUID)
  status: "pending" | "passed" | "warning" | "failed" | "error";
  scheduledTs: number; // microseconds
  jobCount: number;
  jobsDone: number;
  completedAt: number | null; // microseconds
  durationMs: number;
  triggerType: string;
}

const runRows = ref<RunRow[]>([]);
const runsLoading = ref(false);
const runsTotal = ref(0);

async function fetchRuns() {
  if (!props.monitorId) return;
  runsLoading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const resp = await syntheticsService.getRuns(org, props.monitorId, {
      start_time: props.startTime,
      end_time: props.endTime,
      page: 0,
      page_size: 50,
    });
    const data = resp.data as { runs: any[]; total: number };
    runsTotal.value = data.total ?? 0;
    runRows.value = (data.runs ?? []).map((r: any) => {
      const durationUs = r.completed_at && r.scheduled_ts
        ? r.completed_at - r.scheduled_ts
        : null;
      return {
        id: r.id,
        status: r.status,
        scheduledTs: r.scheduled_ts,
        jobCount: r.job_count,
        jobsDone: r.jobs_done,
        completedAt: r.completed_at ?? null,
        durationMs: durationUs ? Math.round(durationUs / 1000) : 0,
        triggerType: r.trigger_type,
      } as RunRow;
    });
  } catch {
    runRows.value = [];
  } finally {
    runsLoading.value = false;
  }
}

// ── Run expansion (inline accordion — multiple rows can be open) ──────────
const expandedRunIds = ref(new Set<string>());

function toggleRunExpansion(id: string) {
  const s = new Set(expandedRunIds.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expandedRunIds.value = s;
}

// ── Relative-time formatting ("2 min ago") ───────────────────────────────
function relativeFromNow(ms: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec} sec ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

// ── Response Time chart (ECharts) ─────────────────────────────────────────
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

function buildChartOption(): echarts.EChartsOption {
  const lineColor = cssVar("--o2-primary-color", "#3b82f6");
  const axisColor = cssVar("--o2-text-caption", "#6c707e");
  const splitColor = cssVar("--o2-border-color", "#e2e8f0");
  const p95Color = cssVar("--o2-status-warning-text", "#f59e0b");

  const seriesData = buckets.value.map((b) => [b.tsMs, b.avgMs]);

  return {
    grid: { left: 52, right: 52, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (val) => formatDuration(Number(val)),
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: splitColor } },
      axisLabel: { color: axisColor, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: axisColor,
        fontSize: 10,
        formatter: (val: number) => formatDuration(val),
      },
      splitLine: { lineStyle: { color: splitColor, type: "dashed" } },
    },
    series: [
      {
        name: t("synthetics.results.duration"),
        type: "line",
        smooth: true,
        showSymbol: false,
        data: seriesData,
        lineStyle: { color: lineColor, width: 1.5 },
        areaStyle: { color: lineColor, opacity: 0.08 },
        markLine: kpi.value.p95Ms
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: p95Color, type: "dashed" },
              data: [{ yAxis: kpi.value.p95Ms, name: "p95" }],
              label: { formatter: `p95 ${splitDuration(kpi.value.p95Ms * 1000).value}${splitDuration(kpi.value.p95Ms * 1000).unit}`, color: p95Color, fontSize: 10 },
            }
          : undefined,
      },
    ],
  };
}

function renderChart() {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  chart.setOption(buildChartOption(), true);
}

// Imperative side effect: re-draw the ECharts canvas when the bucket series
// changes — no computed/event can express a canvas redraw, so a watcher is
// the correct tool here.
watch(buckets, () => {
  nextTick(renderChart);
});

onMounted(() => {
  if (chartEl.value) {
    chart = echarts.init(chartEl.value);
    renderChart();
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(chartEl.value);
  }
});

onBeforeUnmount(() => {
  cancelAll();
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart?.dispose();
  chart = null;
});

// ── Public API — parent drives all (re)loads ─────────────────────────────
async function refresh(startTime?: number, endTime?: number) {
  await Promise.all([
    fetchAll(
      props.monitorId,
      startTime ?? props.startTime,
      endTime ?? props.endTime,
    ),
    fetchRuns(),
  ]);
}

defineExpose({ refresh });
</script>

<style scoped lang="scss">
.kpi-card {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  }
}

.card-container {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
}

.response-time-chart {
  width: 100%;
  height: 14rem;
}

.run-status {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 600;

  &--passed {
    color: #16a34a;
  }
  &--warning {
    color: var(--o2-status-warning-text);
  }
  &--failed, &--error {
    color: var(--o2-status-error-text);
  }
  &--pending {
    color: var(--o2-text-muted);
  }

  .run-status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
  }

  .run-status-spinner {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// ── Runs table ──────────────────────────────────────────────────────────

$cols: 1.8fr 1.4fr 1fr 0.8fr 0.8fr;

.runs-header,
.runs-row {
  display: grid;
  grid-template-columns: $cols;
  gap: 0.5rem;
  align-items: center;
}

.runs-skel {
  background: var(--o2-border-color);
  animation: skel-pulse 1.4s ease-in-out infinite;
  &:nth-child(2) { animation-delay: 0.1s; }
  &:nth-child(3) { animation-delay: 0.2s; }
  &:nth-child(4) { animation-delay: 0.3s; }
  &:nth-child(5) { animation-delay: 0.4s; }
}

@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
</style>
