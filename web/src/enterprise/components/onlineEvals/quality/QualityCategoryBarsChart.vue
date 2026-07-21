<template>
  <div ref="chartEl" class="w-full h-full min-h-45" data-test="quality-category-bars-chart" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import * as echarts from "echarts";
import { chartColor } from "@/utils/chartTheme";
import { withChartFont } from "@/utils/fonts";

interface CategoryRow {
  value_categorical?: string | null;
  c?: number | string;
}

const props = defineProps<{
  rows: CategoryRow[];
  healthyCategories: string[];
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const store = useStore();

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildOption(): echarts.EChartsOption {
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  // Sort by count DESC (per spec §7.6.6 categorical secondary chart).
  const sorted = [...props.rows].sort((a, b) => toNumber(b.c) - toNumber(a.c));
  const labels = sorted.map((r) => r.value_categorical ?? "(null)");
  const data = sorted.map((r) => {
    const healthy =
      r.value_categorical != null && props.healthyCategories.includes(r.value_categorical);
    return {
      value: toNumber(r.c),
      itemStyle: { color: healthy ? "rgba(46, 125, 50, 0.85)" : "rgba(178, 84, 0, 0.85)" },
    };
  });

  return {
    grid: { left: 110, right: 32, top: 16, bottom: 16 },
    tooltip: { trigger: "axis", confine: true },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: "category",
      data: labels,
      inverse: true,
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: text, fontSize: 11 },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: 14,
        data,
        label: {
          show: true,
          position: "right",
          color: text,
          fontSize: 10,
        },
      },
    ],
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
  () => [props.rows, props.healthyCategories, store.state.theme],
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
