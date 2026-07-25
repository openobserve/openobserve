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
  VersionOverlayChart — two overlaid line series (A vs B) for version compare.
  Modeled on the token-driven ECharts pattern used by QualityTrendChart
  (src/enterprise/components/onlineEvals/quality/QualityTrendChart.vue): a thin
  wrapper around `echarts` directly rather than the dashboard ChartRenderer,
  whose `data` prop shape is built for the full panel-query pipeline and is
  heavier than a two-series compare overlay needs. Colors come through
  `chartColor()` (token-driven, resolves --color-accent / the chart amber
  series token) so the chart matches the app theme without hardcoding hex.

  `mode` controls the x-axis: "sinceRollout" rebases both series onto elapsed
  hours since each version's rollout (so two windows that started at different
  wall-clock times can be overlaid apples-to-apples); "sameWallClock" plots
  real time on the x-axis, for when A and B were literally concurrent.

  The option-building logic is exported as `buildOverlayOption` so specs can
  assert on the computed echarts option (series count, x-axis name) without
  mounting a real chart / canvas.
-->
<template>
  <div ref="chartEl" class="h-full min-h-55 w-full" data-test="version-overlay-chart" />
</template>

<script lang="ts">
import * as echarts from "echarts";
import { chartColor } from "@/utils/chartTheme";

export interface OverlayPoint {
  x: number;
  y: number;
}

export type OverlayMode = "sinceRollout" | "sameWallClock";

export interface BuildOverlayOptionArgs {
  seriesA: OverlayPoint[];
  seriesB: OverlayPoint[];
  mode: OverlayMode;
  labelA: string;
  labelB: string;
  xAxisLabel: string;
}

export function buildOverlayOption(args: BuildOverlayOptionArgs): echarts.EChartsOption {
  const { seriesA, seriesB, mode, labelA, labelB, xAxisLabel } = args;
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  const accent = chartColor("--color-accent");
  const amber = chartColor("--color-chart-series-6");

  const series: echarts.SeriesOption[] = [
    {
      name: labelA,
      type: "line",
      data: seriesA.map((p) => [p.x, p.y]),
      smooth: true,
      symbol: "none",
      lineStyle: { color: accent, width: 2 },
      z: 3,
    },
    {
      name: labelB,
      type: "line",
      data: seriesB.map((p) => [p.x, p.y]),
      smooth: true,
      symbol: "none",
      lineStyle: { color: amber, width: 2 },
      z: 2,
    },
  ];

  return {
    grid: { left: 44, right: 16, top: 28, bottom: 40 },
    tooltip: { trigger: "axis", confine: true },
    legend: {
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: text, fontSize: 11 },
    },
    xAxis: {
      type: mode === "sinceRollout" ? "value" : "time",
      name: xAxisLabel,
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { color: text, fontSize: 10 },
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
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { withChartFont } from "@/utils/fonts";

const props = defineProps<{
  seriesA: OverlayPoint[];
  seriesB: OverlayPoint[];
  mode: OverlayMode;
}>();

const { t } = useI18n();
const store = useStore();
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

function render() {
  if (!chart) return;
  const xAxisLabel =
    props.mode === "sinceRollout"
      ? t("aiObservability.overlayChart.xAxisSinceRollout")
      : t("aiObservability.overlayChart.xAxisWallClock");
  const option = buildOverlayOption({
    seriesA: props.seriesA,
    seriesB: props.seriesB,
    mode: props.mode,
    labelA: t("aiObservability.overlayChart.seriesA"),
    labelB: t("aiObservability.overlayChart.seriesB"),
    xAxisLabel,
  });
  chart.setOption(withChartFont(option), true);
}

onMounted(() => {
  if (!chartEl.value) return;
  chart = echarts.init(chartEl.value, undefined, { renderer: "canvas" });
  render();
});

watch(() => [props.seriesA, props.seriesB, props.mode, store.state.theme], () => render(), { deep: true });

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
