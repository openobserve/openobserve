<template>
  <div ref="chartEl" class="w-full h-full min-h-30" data-test="quality-boolean-bars-chart" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import * as echarts from "echarts";
import { chartColor } from "@/utils/chartTheme";
import { withChartFont } from "@/utils/fonts";

const props = defineProps<{
  trueCount: number;
  falseCount: number;
  legendTrue: string;
  legendFalse: string;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
const store = useStore();

function buildOption(): echarts.EChartsOption {
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  return {
    grid: { left: 80, right: 32, top: 16, bottom: 16 },
    tooltip: { trigger: "axis", confine: true },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: "category",
      data: [props.legendFalse, props.legendTrue],
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: text, fontSize: 11 },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: 16,
        data: [
          { value: props.falseCount, itemStyle: { color: "rgba(178, 84, 0, 0.85)" } },
          { value: props.trueCount, itemStyle: { color: "rgba(46, 125, 50, 0.85)" } },
        ],
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
  () => [props.trueCount, props.falseCount, store.state.theme],
  () => render(),
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
