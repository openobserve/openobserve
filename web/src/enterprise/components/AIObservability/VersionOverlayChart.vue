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
    <svg
      v-if="serviceVersions"
      viewBox="0 0 680 190"
      class="w-full"
      role="img"
      :aria-label="t('serviceVersions.compare.overlay')"
      data-test="svcver-overlay-chart"
    >
      <g v-for="tick in yTicks" :key="tick.y">
        <line x1="56" x2="672" :y1="tick.y" :y2="tick.y" stroke="var(--color-border-default)" />
        <text
          x="50"
          :y="tick.y + 3"
          text-anchor="end"
          fill="var(--color-text-secondary)"
          font-size="10"
        >
          {{ tick.label }}
        </text>
      </g>
      <text
        v-for="tick in xTicks"
        :key="tick.x"
        :x="tick.x"
        y="186"
        :text-anchor="tick.anchor"
        fill="var(--color-text-secondary)"
        font-size="10"
      >
        {{ tick.label }}
      </text>
      <path
        v-if="seriesB.length"
        :d="pathFor(seriesB)"
        fill="none"
        stroke="var(--color-accent)"
        stroke-width="2"
        stroke-dasharray="6 4"
        data-test="svcver-overlay-line-b"
      />
      <path
        v-if="seriesA.length"
        :d="pathFor(seriesA)"
        fill="none"
        stroke="var(--color-ai-accent)"
        stroke-width="2.25"
        data-test="svcver-overlay-line-a"
      />
      <circle
        v-for="point in seriesB"
        :key="`b${point.x}`"
        :cx="plotX(point.x)"
        :cy="plotY(point.y)"
        r="2.5"
        fill="var(--color-accent)"
      />
      <circle
        v-for="point in seriesA"
        :key="`a${point.x}`"
        :cx="plotX(point.x)"
        :cy="plotY(point.y)"
        r="2.5"
        fill="var(--color-ai-accent)"
      />
      <g v-if="markerX !== undefined" data-test="svcver-overlay-marker">
        <line
          :x1="markerX"
          :x2="markerX"
          y1="14"
          y2="168"
          :stroke="markerColor"
          stroke-dasharray="3 3"
        />
        <circle
          v-if="marker?.dot"
          :cx="markerX"
          cy="15"
          r="3.5"
          :fill="markerColor"
          data-test="svcver-overlay-marker-dot"
        />
        <text :x="markerX" y="10" :text-anchor="markerAnchor" :fill="markerColor" font-size="10">
          {{ marker?.label }}
        </text>
      </g>
    </svg>
    <ChartRenderer v-else :data="chartData" />
  </div>
</template>

<script lang="ts">
import type { EChartsOption } from "echarts";
import { chartColor, chartGridLine, chartTextColor } from "@/utils/chartTheme";

export interface OverlayPoint {
  x: number;
  y: number;
  gapBefore?: boolean;
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

const SECOND = 1000;
const TICK_STEPS = [
  ...[1, 2, 5, 10, 15, 30].map((n) => n * SECOND),
  ...[1, 2, 5, 10, 15, 30].map((n) => n * 60 * SECOND),
  ...[1, 2, 3, 6, 12, 24].map((n) => n * 3600 * SECOND),
];

/** Wall-clock ticks for the service versions axis: both ends, round steps between, never one label twice. */
export function overlayTimeTicks(
  min: number,
  max: number,
  format: (at: number, seconds: boolean) => string,
): { at: number; label: string; edge: "start" | "end" | null }[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [{ at: min, label: format(min, false), edge: "start" }];
  const step = TICK_STEPS.find((candidate) => (max - min) / candidate <= 4) ?? TICK_STEPS.at(-1)!;
  const seconds = step < 60 * SECOND;
  const inner: number[] = [];
  for (let at = Math.ceil(min / step) * step; at <= max; at += step)
    if (at - min >= step / 2 && max - at >= step / 2) inner.push(at);
  const ticks: { at: number; label: string; edge: "start" | "end" | null }[] = [];
  const points = [
    { at: min, edge: "start" as const },
    ...inner.map((at) => ({ at, edge: null })),
    { at: max, edge: "end" as const },
  ];
  for (const point of points) {
    const label = format(point.at, seconds);
    if (ticks.some((tick) => tick.label === label)) continue;
    ticks.push({ ...point, label });
  }
  return ticks;
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import useTheme from "@/composables/useTheme";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import { formatDeployClock } from "@/utils/serviceVersionsCopy";

const props = withDefaults(
  defineProps<{
    seriesA: OverlayPoint[];
    seriesB: OverlayPoint[];
    mode: OverlayMode;
    /** Unit of the rebased x axis, used in its label. */
    xUnit?: "minutes" | "hours" | "days";
    versionA?: string;
    versionB?: string;
    serviceVersions?: boolean;
    serviceMetric?: "requests" | "error_rate" | "p95" | "p99";
    formatY?: (value: number) => string;
    marker?: { x: number; label: string; color?: string; dot?: boolean };
    /** Wall-clock span the x axis covers at least, so each window keeps its place. */
    range?: { min: number; max: number };
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

const overlayBounds = computed(() => {
  const xs = [...props.seriesA, ...props.seriesB].map((p) => p.x);
  if (props.marker) xs.push(props.marker.x);
  if (props.range) xs.push(props.range.min, props.range.max);
  return { min: Math.min(...xs), max: Math.max(...xs) };
});
const maxY = computed(() =>
  Math.max(0, ...props.seriesA.map((p) => p.y), ...props.seriesB.map((p) => p.y)),
);
const plotX = (x: number) => {
  const { min, max } = overlayBounds.value;
  return 60 + ((x - min) / Math.max(1, max - min)) * 608;
};
const plotY = (y: number) => 168 - (maxY.value ? y / maxY.value : 0) * 150;
const yTicks = computed(() =>
  [0, 0.5, 1].map((share) => ({
    y: plotY(maxY.value * share),
    label: props.formatY ? props.formatY(maxY.value * share) : String(maxY.value * share),
  })),
);
const xTicks = computed(() => {
  const { min, max } = overlayBounds.value;
  const format = (at: number, seconds: boolean) => formatDeployClock(at * 1000, seconds);
  return overlayTimeTicks(min, max, format).map((tick) => ({
    x: plotX(tick.at),
    anchor: tick.edge ?? "middle",
    label: tick.label,
  }));
});
const markerX = computed(() => (props.marker ? plotX(props.marker.x) : undefined));
const markerColor = computed(() => props.marker?.color ?? "var(--color-error-600)");
const markerAnchor = computed(() => {
  const x = markerX.value ?? 0;
  return x < 60 + 608 / 3 ? "start" : x > 668 - 608 / 3 ? "end" : "middle";
});
function pathFor(points: OverlayPoint[]) {
  return points
    .map((p, index) => `${index && !p.gapBefore ? "L" : "M"}${plotX(p.x)},${plotY(p.y)}`)
    .join(" ");
}

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
