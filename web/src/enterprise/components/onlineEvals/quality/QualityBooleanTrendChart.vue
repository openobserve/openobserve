<template>
  <div ref="chartEl" class="qbtrend" data-test="quality-boolean-trend-chart" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import * as echarts from "echarts";
import type {
  BooleanTrendPoint,
  BooleanTrendSeries,
} from "../composables/useQualityDetailCharts";

const props = defineProps<{
  series?: BooleanTrendSeries[];
  /** Fallback flat-array shape — used when caller doesn't yet pass series. */
  points?: BooleanTrendPoint[];
  legendPassRate: string;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const store = useStore();

// Color palette cycles through these for split series.
const PALETTE = [
  "#2e7d32",
  "#1d4ed8",
  "#b25400",
  "#7c3aed",
  "#0e7490",
  "#dc2626",
  "#ca8a04",
  "#0f766e",
];

function effectiveSeries(): BooleanTrendSeries[] {
  if (props.series && props.series.length > 0) return props.series;
  if (props.points && props.points.length > 0) {
    return [{ id: "default", label: props.legendPassRate, points: props.points }];
  }
  return [];
}

function buildOption(): echarts.EChartsOption {
  const isDark = store.state.theme === "dark";
  const text = isDark ? "#d4d4d4" : "#374151";
  const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const seriesList = effectiveSeries();
  const isSplit = seriesList.length > 1 || seriesList.some((s) => s.id !== "__default__" && s.id !== "default");

  const echSeries: echarts.SeriesOption[] = seriesList.map((s, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const label = s.id === "__default__" ? props.legendPassRate : s.label;
    return {
      name: label,
      type: "line",
      data: s.points.map((p) => [p.t, Number(p.passRate.toFixed(2))]),
      smooth: true,
      symbol: "circle",
      symbolSize: 5,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      areaStyle: isSplit
        ? undefined
        : {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(46, 125, 50, 0.30)" },
              { offset: 1, color: "rgba(46, 125, 50, 0.02)" },
            ]),
          },
    };
  });

  return {
    grid: { left: 44, right: 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: "axis",
      confine: true,
      valueFormatter: (val) => (typeof val === "number" ? `${val.toFixed(1)}%` : String(val)),
    },
    legend: {
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: text, fontSize: 11 },
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: text, fontSize: 10, formatter: "{value}%" },
      splitLine: { lineStyle: { color: grid } },
    },
    series: echSeries,
  };
}

function render() {
  if (!chart) return;
  chart.setOption(buildOption(), true);
}

onMounted(() => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, undefined, { renderer: "canvas" });
  render();
});

watch(
  () => [props.series, props.points, store.state.theme],
  () => render(),
  { deep: true },
);

const resizeObserver = new ResizeObserver(() => chart?.resize());
onMounted(() => {
  if (chartEl.value) resizeObserver.observe(chartEl.value);
});
onBeforeUnmount(() => {
  resizeObserver.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<style lang="scss" scoped>
.qbtrend {
  width: 100%;
  height: 100%;
  min-height: 220px;
}
</style>
