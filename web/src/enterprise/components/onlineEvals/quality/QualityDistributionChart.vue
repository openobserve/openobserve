<template>
  <div ref="chartEl" class="h-full min-h-50 w-full" data-test="quality-distribution-chart" />
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import * as echarts from "echarts";
import { chartColor } from "@/utils/chartTheme";
import { CHART_THRESHOLD_COLOR } from "@/utils/dashboard/colorPalette";
import type { DistributionBucket } from "../composables/useQualityDetailCharts";
import { withChartFont } from "@/utils/fonts";
const { t } = useI18nTyped();

const props = defineProps<{
  buckets: DistributionBucket[];
  threshold: { value: number; direction: "gte" | "lte" } | null;
  legendHealthy: I18nText;
  legendUnhealthy: string;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const store = useStore();

function buildOption(): echarts.EChartsOption {
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  const labels = props.buckets.map((b) => b.label);

  const seriesData = props.buckets.map((b) => ({
    value: b.count,
    itemStyle: {
      color: b.healthy ? "rgba(46, 125, 50, 0.85)" : "rgba(178, 84, 0, 0.85)",
    },
  }));

  const series: echarts.SeriesOption[] = [
    {
      name: t("onlineEvals.count"),
      type: "bar",
      data: seriesData,
      barCategoryGap: "8%",
      label: {
        show: true,
        position: "top",
        color: text,
        fontSize: 10,
      },
    },
  ];

  if (props.threshold) {
    const sign = props.threshold.direction === "gte" ? ">=" : "<=";
    const thresholdLabel = t("onlineEvals.quality.detail.markLineHealthy", {
      direction: sign,
      value: props.threshold.value,
    });
    series.push({
      name: thresholdLabel,
      type: "line",
      data: [],
      markLine: {
        silent: true,
        symbol: "none",
        label: {
          formatter: thresholdLabel,
          color: CHART_THRESHOLD_COLOR,
          fontSize: 10,
          position: "insideEndTop",
        },
        lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed", width: 1.2 },
        data: [{ xAxis: thresholdBucketIndex() }],
      },
    });
  }

  return {
    grid: { left: 40, right: 16, top: 28, bottom: 28 },
    tooltip: { trigger: "axis", confine: true },
    legend: {
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: text, fontSize: 11 },
      data: [
        {
          name: props.legendHealthy,
          icon: "rect",
          itemStyle: { color: "rgba(46, 125, 50, 0.85)" } as any,
        },
        {
          name: props.legendUnhealthy,
          icon: "rect",
          itemStyle: { color: "rgba(178, 84, 0, 0.85)" } as any,
        },
      ],
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    series,
  };
}

function thresholdBucketIndex(): number {
  if (!props.threshold) return -1;
  const target = props.threshold.value;
  const idx = props.buckets.findIndex((b) => target >= b.rangeStart && target <= b.rangeEnd);
  return idx >= 0 ? idx : -1;
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
  () => [props.buckets, props.threshold, store.state.theme],
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
