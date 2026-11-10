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
  <div class="h-full min-h-55 w-full" data-test="version-overlay-chart">
    <ChartRenderer :data="chartData" />
  </div>
</template>

<script lang="ts">
import type { EChartsOption } from "echarts";
import { chartColor, chartGridLine, chartTextColor } from "@/utils/chartTheme";

export interface OverlayPoint {
  x: number;
  y: number;
}

export type OverlayMode = "sinceRollout" | "sameWallClock";

/** Numeric [x, y] points, since the SQL panel's categorical conversion would distort unequal gaps. */
export function buildOverlayOptions(
  seriesA: OverlayPoint[],
  seriesB: OverlayPoint[],
  labelA: string,
  labelB: string,
  xAxisLabel: string,
): EChartsOption {
  const text = chartTextColor();
  return {
    animation: false,
    backgroundColor: "transparent",
    color: [chartColor("--color-accent"), chartColor("--color-chart-series-6")],
    grid: { left: 55, right: 20, top: 20, bottom: 80, containLabel: true },
    legend: { bottom: 0, textStyle: { color: text } },
    tooltip: {
      trigger: "axis",
      confine: true,
      valueFormatter: (value) =>
        Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    },
    xAxis: {
      type: "value",
      min: 0,
      name: xAxisLabel,
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: text },
      axisLabel: { color: text },
      axisLine: { show: true, lineStyle: { color: chartColor("--color-border-default") } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: chartGridLine() } },
    },
    series: [
      { name: labelA, points: seriesA },
      { name: labelB, points: seriesB },
    ].map(({ name, points }) => ({
      name,
      type: "line" as const,
      showSymbol: false,
      smooth: true,
      connectNulls: true,
      lineStyle: { width: 2 },
      data: [...points].sort((a, b) => a.x - b.x).map(({ x, y }) => [x, y]),
    })),
  };
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import useTheme from "@/composables/useTheme";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";

const props = withDefaults(
  defineProps<{
    seriesA: OverlayPoint[];
    seriesB: OverlayPoint[];
    mode: OverlayMode;
    /** Unit of the rebased x axis, used in its label. */
    xUnit?: "minutes" | "hours" | "days";
    versionA?: string;
    versionB?: string;
  }>(),
  { xUnit: "hours", versionA: "", versionB: "" },
);

const { t } = useI18nTyped();
const { isDark } = useTheme();
const xAxisLabel = computed(() => {
  const family = props.mode === "sinceRollout" ? "xAxisSinceRollout" : "xAxisWallClock";
  const suffix = props.xUnit === "hours" ? "Hours" : props.xUnit === "days" ? "Days" : "Minutes";
  return t(`aiObservability.overlayChart.${family}${suffix}`);
});

const chartData = computed(() => {
  // Resolve design tokens again when the theme changes, like CoverageMetricChart.
  void isDark.value;
  return {
    options: buildOverlayOptions(
      props.seriesA,
      props.seriesB,
      props.versionA || t("aiObservability.overlayChart.seriesA"),
      props.versionB || t("aiObservability.overlayChart.seriesB"),
      xAxisLabel.value,
    ),
    extras: { panelId: "version-overlay-chart", isTimeSeries: false },
  };
});
</script>
