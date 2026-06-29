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
    class="synthetic-results-dashboard tw:h-full tw:flex tw:flex-col tw:px-[0.625rem]"
    data-test="synthetic-monitor-results-dashboard"
  >
    <div class="tw:flex-1 tw:overflow-y-auto tw:pb-[0.625rem]">
      <!-- KPI Cards Row -->
      <div
        class="tw:grid tw:grid-cols-4 tw:gap-[0.625rem] tw:mt-[0.625rem] tw:mb-[0.625rem]"
      >
        <div
          v-for="card in kpiCards"
          :key="card.label"
          class="kpi-card card-container tw:rounded-lg tw:flex tw:flex-col tw:px-[0.875rem] tw:pt-[0.625rem] tw:pb-[0.625rem] tw:gap-[0.25rem]"
          :data-test="`synthetic-monitor-results-kpi-${card.key}`"
        >
          <div class="tw:flex tw:flex-col tw:gap-[0.25rem]">
            <div
              class="kpi-label tw:text-[0.7rem] tw:font-semibold tw:text-[var(--o2-text-muted)]"
            >
              {{ card.label }}
            </div>
            <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
              <span
                class="tw:text-[1.4rem] tw:font-bold tw:leading-none tw:text-[var(--o2-text-primary)]"
                :class="card.valueClass"
              >
                {{ card.value }}
              </span>
              <span
                v-if="card.unit"
                class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-secondary)]"
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
            class="tw:mt-auto"
          />
        </div>
      </div>

      <!-- Response Time chart -->
      <section
        class="card-container tw:rounded-lg tw:px-[0.875rem] tw:py-[0.75rem] tw:mb-[0.625rem]"
        data-test="synthetic-monitor-results-response-time-chart"
      >
        <header class="tw:flex tw:items-baseline tw:gap-[0.5rem] tw:mb-[0.5rem]">
          <h4
            class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-heading)]"
          >
            {{ t("synthetics.results.responseTime") }}
          </h4>
          <small class="tw:text-[var(--o2-text-caption)]">
            {{ t("synthetics.results.responseTimeSubtitle") }}
          </small>
        </header>
        <div ref="chartEl" class="response-time-chart" />
      </section>

      <!-- Runs table -->
      <section
        class="card-container tw:rounded-lg tw:overflow-hidden"
        data-test="synthetic-monitor-results-runs-section"
      >
        <header class="tw:px-[0.875rem] tw:pt-[0.75rem]">
          <h4
            class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-heading)]"
          >
            {{ t("synthetics.results.recentRuns") }}
          </h4>
        </header>
        <OTable
          :columns="runColumns"
          :data="runRows"
          :loading="loading"
          pagination="client"
          :page-size="20"
          :page-size-options="[10, 20, 25, 50]"
          row-key="id"
          :show-global-filter="false"
          :footer-title="t('synthetics.results.runs')"
          :empty-message="t('synthetics.results.noRuns')"
          data-test="synthetic-monitor-results-runs-table"
        >
          <template #cell-status="{ row }">
            <div class="tw:flex tw:flex-col tw:gap-[0.125rem]">
              <span
                class="run-status"
                :class="`run-status--${(row as RunRow).status}`"
              >
                <span class="run-status-dot" />
                {{
                  (row as RunRow).status === "failed"
                    ? t("synthetics.results.failed")
                    : t("synthetics.results.passed")
                }}
              </span>
              <small
                v-if="(row as RunRow).status === 'failed' && (row as RunRow).error"
                class="tw:text-[var(--o2-text-caption)] tw:truncate tw:max-w-[18rem]"
                :title="(row as RunRow).error"
              >
                {{ (row as RunRow).error }}
              </small>
            </div>
          </template>
          <template #cell-started="{ row }">
            {{ relativeFromNow((row as RunRow).timestamp) }}
          </template>
          <template #cell-duration="{ row }">
            {{ formatDuration((row as RunRow).durationMs) }}
          </template>
        </OTable>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import * as echarts from "echarts";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import KpiSparkline from "@/plugins/traces/KpiSparkline.vue";
import {
  splitDuration,
} from "@/plugins/traces/llmInsightsDashboard.utils";
import { formatDuration } from "@/utils/formatters";
import useSyntheticResults from "@/composables/useSyntheticResults";

interface Props {
  monitorId: string;
  startTime: number; // microseconds
  endTime: number; // microseconds
}
const props = defineProps<Props>();

const { t } = useI18n();

const { kpi, buckets, runs, loading, fetchAll, cancelAll } =
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
        ? lastStatus === "failed"
          ? t("synthetics.results.failed")
          : t("synthetics.results.passed")
        : "—",
      unit: kpi.value.lastRunAt
        ? relativeFromNow(kpi.value.lastRunAt)
        : undefined,
      valueClass:
        lastStatus === "failed"
          ? "tw:text-[var(--o2-status-error-text)]!"
          : lastStatus === "passed"
            ? "tw:text-[#16a34a]!"
            : undefined,
    },
  ];
});

// ── Runs table ───────────────────────────────────────────────────────────
interface RunRow {
  id: string;
  timestamp: number;
  status: "passed" | "failed";
  durationMs: number;
  location: string;
  device: string;
  error: string;
}

const runRows = computed<RunRow[]>(() =>
  runs.value.map((r, i) => ({ id: `${r.timestamp}-${i}`, ...r })),
);

const runColumns = computed<OTableColumnDef[]>(() => [
  { id: "status", header: t("synthetics.results.status"), accessorKey: "status", size: 120, minSize: 100, sortable: true },
  { id: "started", header: t("synthetics.results.started"), accessorKey: "timestamp", size: 160, minSize: 120, sortable: true },
  { id: "duration", header: t("synthetics.results.duration"), accessorKey: "durationMs", size: 140, minSize: 100, sortable: true, meta: { align: "right" } },
  { id: "location", header: t("synthetics.results.location"), accessorKey: "location", size: 160, minSize: 120, sortable: true },
  { id: "device", header: t("synthetics.results.device"), accessorKey: "device", size: 140, minSize: 100, sortable: true },
]);

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
  await fetchAll(
    props.monitorId,
    startTime ?? props.startTime,
    endTime ?? props.endTime,
  );
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
  &--failed {
    color: var(--o2-status-error-text);
  }

  .run-status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: currentColor;
  }
}
</style>
