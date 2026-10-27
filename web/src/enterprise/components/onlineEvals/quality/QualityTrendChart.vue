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
  <div class="h-full min-h-0 w-full" data-test="quality-trend-chart">
    <ChartRenderer :data="{ options }" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useStore } from "vuex";
import { format, isSameDay } from "date-fns";
import { useI18nTyped } from "@/types/i18n";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import {
  CHART_THRESHOLD_COLOR,
  QUALITY_SCORE_LINE_COLOR,
  colorToRgba,
} from "@/utils/dashboard/colorPalette";
import type { QualityTimelineBucket } from "@/services/online-evals.service";
import {
  formatAxis,
  formatCount,
  formatExact,
  formatScore,
  scoreAxisBounds,
  trendBuckets,
  trendPoints,
  type QualityTrendKind,
} from "../utils/qualityFormat";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{
  timeline: QualityTimelineBucket[];
  kind: QualityTrendKind;
  /** Numeric configs: the y axis range and the healthy threshold line. */
  range?: { min: number; max: number } | null;
  threshold?: { value: number; direction: "gte" | "lte" } | null;
}>();

const { t } = useI18nTyped();
const store = useStore();

const plotted = computed(() => trendBuckets(props.timeline));

const gradient = (color: string) => ({
  type: "linear",
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: colorToRgba(color, 0.3) },
    { offset: 1, color: colorToRgba(color, 0.02) },
  ],
});

const DAY_US = 86_400_000_000;
// The widest bucket is the step; the first and last can be cut short by the time range.
const step = computed(() => Math.max(0, ...props.timeline.map((b) => b.end - b.start)));

/** "Oct 8" for day buckets, "Oct 8, 14:00–15:00" for shorter ones. */
function bucketTime(bucket: QualityTimelineBucket): string {
  const start = bucket.start / 1000;
  const end = bucket.end / 1000;
  if (step.value >= DAY_US) return format(start, "MMM d");
  return `${format(start, "MMM d, HH:mm")}–${format(end, isSameDay(start, end) ? "HH:mm" : "MMM d, HH:mm")}`;
}

function shownValue(value: number): string {
  if (props.kind === "healthyRate" || props.kind === "trueRate") return `${value.toFixed(1)}%`;
  return props.kind === "count" ? formatCount(value) : formatScore(value);
}

function seriesFor(name: string, data: [number, number | null][], color: string, extra = {}) {
  return {
    name,
    type: "line",
    data,
    color,
    smooth: true,
    symbol: "circle",
    symbolSize: 5,
    // A single bucket has no line to draw, so it needs its point.
    showSymbol: props.kind !== "score" || data.length === 1,
    lineStyle: { color, width: 2 },
    ...extra,
  };
}

const options = computed(() => {
  // Read the theme so token colors re-resolve when it flips.
  void store.state.theme;
  const text = chartColor("--color-text-secondary");
  const grid = chartColor("--color-border-subtle");
  const rate = props.kind === "healthyRate" || props.kind === "trueRate";
  const series: any[] = [];
  if (props.kind === "score") {
    series.push(
      seriesFor(
        t("onlineEvals.quality.detail.legendAvg"),
        trendPoints(props.timeline, "average"),
        QUALITY_SCORE_LINE_COLOR,
        { areaStyle: { color: gradient(QUALITY_SCORE_LINE_COLOR) }, z: 3 },
      ),
      seriesFor("p95", trendPoints(props.timeline, "p95"), CHART_THRESHOLD_COLOR, {
        lineStyle: { color: CHART_THRESHOLD_COLOR, width: 2, type: "dashed" },
        z: 2,
      }),
    );
    if (props.threshold) {
      const sign = {
        direction: props.threshold.direction === "gte" ? "≥" : "≤",
        value: formatExact(props.threshold.value),
      };
      // Its own series, so the threshold gets a legend entry next to Avg and p95.
      series.push({
        name: t("onlineEvals.quality.detail.legendThreshold", sign),
        type: "line",
        data: [],
        color: CHART_THRESHOLD_COLOR,
        lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed" },
        markLine: {
          silent: true,
          symbol: "none",
          label: {
            formatter: t("onlineEvals.quality.detail.markLineHealthy", sign),
            color: CHART_THRESHOLD_COLOR,
            fontSize: 10,
            position: "insideEndTop",
          },
          lineStyle: { color: CHART_THRESHOLD_COLOR, type: "dashed", width: 1.2 },
          data: [{ yAxis: props.threshold.value }],
        },
      });
    }
  } else {
    const color = rate
      ? chartColor("--color-service-health-healthy")
      : chartColor("--color-chart-series-1");
    series.push(
      seriesFor(
        t(`onlineEvals.quality.detail.trendLegend.${props.kind}`),
        trendPoints(props.timeline, props.kind),
        color,
        { areaStyle: { color: gradient(color) } },
      ),
    );
  }
  return {
    grid: { left: 8, right: 16, top: 28, bottom: 4, containLabel: true },
    legend: {
      right: 0,
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: text, fontSize: 11 },
    },
    // Two short lines: when and how many, then the values side by side.
    tooltip: {
      trigger: "axis",
      confine: true,
      padding: [6, 10],
      textStyle: { fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: grid } },
      formatter: (params: any[]) => {
        const bucket = plotted.value[params?.[0]?.dataIndex];
        if (!bucket) return "";
        const values = params
          .filter((p: any) => p.value?.[1] != null)
          .map(
            (p: any) =>
              `${p.marker}${escapeHtml(String(p.seriesName))} <b>${escapeHtml(shownValue(p.value[1]))}</b>`,
          )
          .join("&nbsp;&nbsp;&nbsp;");
        const when = escapeHtml(bucketTime(bucket));
        if (props.kind === "count") return `${when}<br/>${values}`;
        const count = t(
          "onlineEvals.quality.detail.chartTooltipCount",
          { count: formatCount(bucket.count) },
          bucket.count,
        );
        return `${when} · ${escapeHtml(count)}<br/>${values}`;
      },
    },
    xAxis: {
      type: "time",
      axisLabel: { color: text, fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: grid } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      ...(props.kind === "score"
        ? scoreAxisBounds(props.range, plotted.value)
        : rate
          ? { min: 0, max: 100 }
          : { min: 0, minInterval: 1 }),
      axisLabel: { color: text, fontSize: 10, formatter: rate ? "{value}%" : formatAxis },
      splitLine: { lineStyle: { color: grid } },
    },
    series,
  };
});
</script>
