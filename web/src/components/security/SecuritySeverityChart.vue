<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Counts over time stacked by severity (worst on top); `zoomable` emits a dragged range. -->
<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { chartColor, chartGridLine, chartTextColor } from "@/utils/chartTheme";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

export interface ChartSeries {
  key: string;
  label: string;
  token: `--${string}`;
}

const props = withDefaults(
  defineProps<{
    buckets: { ts: number; counts: Record<string, number> }[];
    /** Bottom of the stack first; the last entry is drawn on top. */
    series: ChartSeries[];
    loading?: boolean;
    zoomable?: boolean;
    /** Window bounds in ms. Pinning the axis keeps a sparse window from looking full. */
    min?: number;
    max?: number;
    /** Series key to emphasise (an active severity filter); the rest are dimmed. */
    highlight?: string | null;
    dataTest?: string;
  }>(),
  { loading: false, zoomable: false },
);

const emit = defineEmits<{ zoom: [range: { start: number; end: number }] }>();

const store = useStore();

const options = computed(() => {
  // Read so a theme switch rebuilds the option with the new token values.
  void store.state.theme;
  const text = chartTextColor();
  const grid = chartGridLine();
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: { containLabel: true, left: 8, right: 12, top: 10, bottom: 4 },
    tooltip: {
      trigger: "axis",
      appendToBody: true,
      axisPointer: { type: "shadow" },
      textStyle: { fontSize: 12 },
    },
    legend: { show: false },
    xAxis: {
      type: "time",
      min: props.min,
      max: props.max,
      axisLabel: { color: text, fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitNumber: 3,
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    toolbox: props.zoomable
      ? {
          show: true,
          itemSize: 0,
          itemGap: 0,
          bottom: "100%",
          feature: { dataZoom: { show: true, yAxisIndex: "none" } },
        }
      : { show: false },
    series: props.series.map((s) => ({
      name: s.label,
      type: "bar",
      stack: "total",
      barMaxWidth: 28,
      emphasis: { focus: "series" },
      itemStyle: {
        color: chartColor(s.token),
        opacity: props.highlight && props.highlight !== s.key ? 0.25 : 1,
      },
      data: props.buckets.map((b) => [b.ts, b.counts[s.key] ?? 0]),
    })),
  };
});

const hasData = computed(() =>
  props.buckets.some((b) => Object.values(b.counts).some((n) => n > 0)),
);

function onZoom(range: { start: number; end: number }) {
  if (range.start && range.end && range.end > range.start) {
    emit("zoom", { start: Math.floor(range.start), end: Math.ceil(range.end) });
  }
}
</script>

<template>
  <div class="relative h-full min-h-0 w-full" :data-test="dataTest">
    <OSkeleton v-if="loading && !hasData" class="h-full w-full" />
    <ChartRenderer v-else :data="{ options }" class="h-full w-full" @updated:data-zoom="onZoom" />
  </div>
</template>
