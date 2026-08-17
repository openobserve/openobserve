<template>
  <div ref="chartEl" class="h-full min-h-55 w-full" data-test="quality-trend-chart" />
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import * as echarts from "echarts";
import { chartColor } from "@/utils/chartTheme";
import {
  QUALITY_SCORE_LINE_COLOR,
  CHART_THRESHOLD_COLOR,
  colorToRgba,
} from "@/utils/dashboard/colorPalette";
import type { TrendPoint } from "../composables/useQualityDetailCharts";
import { withChartFont } from "@/utils/fonts";

const props = defineProps<{
  points: TrendPoint[];
  threshold: { value: number; direction: "gte" | "lte" } | null;
  yMin?: number | null;
  yMax?: number | null;
  legendAvg: I18nText;
  legendP95: string;
  legendThresholdFmt: string;
}>();

const { t } = useI18nTyped();

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const store = useStore();

function buildOption(): echarts.EChartsOption {
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");

  const avgSeries = props.points.map((p) => [p.t, p.avg ?? null]);
  const p95Series = props.points.map((p) => [p.t, p.p95 ?? null]);

  const series: echarts.SeriesOption[] = [
    {
      name: props.legendAvg,
      type: "line",
      data: avgSeries,
      smooth: true,
      symbol: "none",
      lineStyle: { color: QUALITY_SCORE_LINE_COLOR, width: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: colorToRgba(QUALITY_SCORE_LINE_COLOR, 0.3) },
          { offset: 1, color: colorToRgba(QUALITY_SCORE_LINE_COLOR, 0.02) },
        ]),
      },
      z: 3,
    },
    {
      name: props.legendP95,
      type: "line",
      data: p95Series,
      smooth: true,
      symbol: "none",
      lineStyle: { color: CHART_THRESHOLD_COLOR, width: 2, type: "dashed" },
      z: 2,
    },
  ];

  if (props.threshold) {
    const sign = props.threshold.direction === "gte" ? ">=" : "<=";
    series.push({
      name: props.legendThresholdFmt
        .replace("{direction}", sign)
        .replace("{value}", String(props.threshold.value)),
      type: "line",
      data: [],
      lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed" },
      markLine: {
        silent: true,
        symbol: "none",
        label: {
          formatter: t("onlineEvals.quality.detail.markLineHealthy", {
            direction: sign,
            value: props.threshold.value,
          }),
          color: CHART_THRESHOLD_COLOR,
          fontSize: 10,
          position: "insideEndTop",
        },
        lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed", width: 1.2 },
        data: [{ yAxis: props.threshold.value }],
      },
    });
  }

  return {
    grid: { left: 44, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis", confine: true },
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
      min: props.yMin ?? "dataMin",
      max: props.yMax ?? "dataMax",
      axisLine: { show: false },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    series,
  };
}

function render() {
  if (!chart) return;
  chart.setOption(withChartFont(buildOption()), true);
}

onMounted(() => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, undefined, { renderer: "canvas" });
  render();
});

watch(
  () => [props.points, props.threshold, props.yMin, props.yMax, store.state.theme],
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
