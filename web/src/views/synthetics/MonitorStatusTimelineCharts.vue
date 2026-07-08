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
<!--
  MonitorStatusTimelineCharts — ECharts bar chart version of the Status Timeline.

  Each bar = one logical run (grouped by runId). No x/y axes visible.
  30 segments per page with arrow-button pagination.
  Custom tooltip shows per-execution (location·browser·device) breakdown.
-->
<template>
  <div
    class="card-container rounded-lg flex flex-col bg-[var(--o2-card-bg)] border border-[var(--o2-border-color)] overflow-hidden"
    data-test="monitor-status-timeline-charts"
  >
    <div
      class="flex items-center gap-2 px-[0.875rem] pt-[0.625rem] pb-[0.5rem]"
    >
      <span class="font-bold text-xs text-text-heading">
        Status Timeline (ECharts)
      </span>
      <span class="flex-1" />
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-error-text)]"
        />
        {{ failCount }} Failed
      </span>
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-warning-text)]"
        />
        {{ mixedCount }} Warning
      </span>
      <span
        class="inline-flex items-center gap-1.5 text-xs text-text-secondary"
      >
        <span
          class="w-[7px] h-[7px] rounded-full bg-[var(--o2-status-success-text)]"
        />
        {{ passCount }} Passed
      </span>
    </div>
    <div class="border-t border-[var(--o2-border-color)]" />
    <div class="flex flex-col gap-1 py-2 px-[0.875rem]">
      <div class="flex items-center gap-1">
        <button
          class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-transparent border-none cursor-pointer text-text-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          :disabled="currentPage === 0"
          @click="prevPage"
          aria-label="Scroll timeline left"
        >
          <OIcon name="chevron-left" size="xs" />
        </button>
        <div class="flex-1 rounded" style="height: 60px">
          <ChartRenderer
            :data="{ options: chartOptions, notMerge: true, lazyUpdate: true }"
            height="60px"
          />
        </div>
        <button
          class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-transparent border-none cursor-pointer text-text-secondary hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-default transition-colors"
          :disabled="currentPage >= maxPage"
          @click="nextPage"
          aria-label="Scroll timeline right"
        >
          <OIcon name="chevron-right" size="xs" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
// Types duplicated from MonitorRuns.vue for isolation - no import dependency
interface TimelineExecution {
  location: string;
  browserEngine: string;
  device: string;
  status: "pass" | "fail";
  errorSnippet: string | null;
}

interface TimelineSegment {
  runId: string;
  status: "all-pass" | "mixed" | "all-fail";
  color: string;
  title: string;
  /** Epoch ms of the first execution in this logical run. */
  timestampMs: number;
  executions: TimelineExecution[];
}

defineOptions({ name: "MonitorStatusTimelineCharts" });

const MAX_VISIBLE = 30;

interface Props {
  segments: TimelineSegment[];
  failCount: string;
  passCount: string;
  mixedCount: string;
}
const props = defineProps<Props>();

const currentPage = ref(0);
const maxPage = computed(() =>
  Math.max(0, Math.ceil(props.segments.length / MAX_VISIBLE) - 1),
);

const pageSegments = computed(() => {
  const start = currentPage.value * MAX_VISIBLE;
  return props.segments.slice(start, start + MAX_VISIBLE);
});

function prevPage() {
  currentPage.value = Math.max(0, currentPage.value - 1);
}

function nextPage() {
  currentPage.value = Math.min(maxPage.value, currentPage.value + 1);
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.body).getPropertyValue(name).trim() || fallback
  );
}

const chartOptions = computed(() => {
  const page = currentPage.value;
  const segs = pageSegments.value;

  if (segs.length === 0) {
    return { grid: { left: 0, right: 0, top: 0, bottom: 0 } };
  }

  const successColor = cssVar("--o2-status-success-text", "#22c55e");
  const errorColor = cssVar("--o2-status-error-text", "#ef4444");
  const warningColor = cssVar("--o2-status-warning-text", "#f59e0b");

  const axisColor = cssVar("--o2-text-caption", "#999");

  const data = segs.map((seg) => {
    const color =
      seg.status === "all-pass"
        ? successColor
        : seg.status === "all-fail"
          ? errorColor
          : warningColor;
    return {
      value: [seg.timestampMs, 1],
      itemStyle: {
        color,
        borderRadius: [1, 1, 0, 0] as const,
      },
    };
  });

  return {
    grid: { left: 4, right: 4, top: 8, bottom: 22 },
    xAxis: {
      type: "time",
      inverse: true,
      show: true,
      splitLine: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        fontSize: 9,
        color: axisColor,
        margin: 2,
      },
    },
    yAxis: {
      type: "value",
      show: false,
      min: 0,
      max: 1,
      splitLine: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    tooltip: {
      trigger: "axis",
      position: (point: number[]) => ({ top: point[1] + 12, left: point[0] }),
      appendToBody: true,
      extraCssText: "z-index: 9999;",
      formatter: (params: any) => {
        if (!params || params.length === 0) return "";
        const dataIndex = params[0].dataIndex;
        // dataIndex 0 = first data element = most recent segment (inverse axis)
        const seg = props.segments[page * MAX_VISIBLE + dataIndex];
        if (!seg) return "";
        const rows = seg.executions
          .map(
            (
              e,
            ) => `<div style="display:flex;align-items:center;gap:6px;padding:1px 0;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;${
            e.status === "pass"
              ? "background:" + successColor
              : "background:" + errorColor
          }"></span>
          <span>${e.location}</span>
          <span style="opacity:0.65">${e.browserEngine}</span>
          <span style="opacity:0.65">${e.device}</span>
        </div>`,
          )
          .join("");
        return `<div style="padding:2px 4px;min-width:200px;">
          <div style="font-weight:600;margin-bottom:6px;font-size:12px;">${seg.title}</div>
          ${rows}
        </div>`;
      },
    },
    series: [
      {
        type: "bar",
        data,
        barWidth: 6,
        animation: false,
        emphasis: {
          itemStyle: {
            opacity: 0.8,
          },
        },
      },
    ],
  };
});
</script>
