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
  <section
    class="rounded-surface border-border-default bg-surface-panel flex flex-col gap-1 border px-3 py-2.5"
    data-test="svcver-rum-chart"
    :data-metric="metric"
  >
    <div class="flex flex-wrap items-center gap-3">
      <span
        class="text-text-heading text-compact font-semibold"
        data-test="svcver-rum-chart-title"
        >{{ t(`serviceVersions.compare.tile.${metric}`) }}</span
      ><span class="text-text-secondary text-xs" data-test="svcver-rum-chart-hint">{{
        t("serviceVersions.compare.chartHint")
      }}</span
      ><span
        class="text-text-secondary ms-auto flex flex-wrap gap-3 text-xs"
        data-test="svcver-rum-chart-legend"
        ><span
          ><span
            class="border-accent me-1 inline-block w-3.5 border-t-2 border-dashed align-middle"
          />{{ t("serviceVersions.compare.before", { version: armLabels.b }) }}</span
        ><span
          ><span class="border-ai-accent me-1 inline-block w-3.5 border-t-2 align-middle" />{{
            t("serviceVersions.compare.after", { version: armLabels.a })
          }}</span
        ></span
      >
    </div>
    <div v-if="failed" class="flex items-center gap-2" data-test="svcver-rum-chart-error">
      <p class="text-text-body text-compact">{{ t("serviceVersions.compare.error") }}</p>
      <OButton
        variant="outline"
        size="sm"
        data-test="svcver-rum-chart-retry"
        @click="emit('retry')"
        >{{ t("serviceVersions.actions.retry") }}</OButton
      >
    </div>
    <template v-else>
      <VersionOverlayChart
        v-if="seriesA.length || seriesB.length"
        :series-a="seriesA"
        :series-b="seriesB"
        mode="sameWallClock"
        :version-a="armLabels.a"
        :version-b="armLabels.b"
        :format-y="formatY"
        :marker="marker"
        service-versions
      />
      <p
        v-for="line in reasons"
        :key="line.arm"
        class="text-text-secondary text-xs"
        :data-test="`svcver-rum-chart-reason-${line.arm}`"
      >
        {{ line.text }}
      </p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import VersionOverlayChart, { type OverlayPoint } from "../AIObservability/VersionOverlayChart.vue";
import type {
  CompareResponse,
  RumArmSeries,
  RumMetricSeries,
  RumSeriesMetric,
} from "@/services/service_versions";
import { buildTiles, formatCount, formatMetric, type TileTone } from "./VersionSummaryTiles.format";
import { compareArmLabels, leadingVerdict, metricName, worseTone } from "./verdictText";
import { metricChange } from "./rumStrip";
import { buildLabel } from "@/utils/serviceVersionsCopy";
interface ReasonLine {
  arm: "a" | "b" | "both";
  text: string;
}
const props = defineProps<{ result: CompareResponse; metric: RumSeriesMetric }>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();
const armLabels = computed(() => compareArmLabels(props.result, t));
const section = computed(() => props.result.rum_series);
const failed = computed(
  () => section.value?.status === "error" || section.value?.status === "timeout",
);
// A bucket without samples is a gap, never a zero, and the line restarts after it.
function points(arm: RumArmSeries | null | undefined) {
  const series = arm?.[props.metric];
  if (!series || series.status !== "ok") return [];
  const out: OverlayPoint[] = [];
  let gap = false;
  for (const point of series.points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      gap = out.length > 0;
      continue;
    }
    out.push(
      gap
        ? { x: point.t / 1000, y: point.value, gapBefore: true }
        : { x: point.t / 1000, y: point.value },
    );
    gap = false;
  }
  return out;
}
const seriesA = computed(() => points(section.value?.a));
const seriesB = computed(() => points(section.value?.b));
function reason(arm: "a" | "b", series: RumMetricSeries | undefined): ReasonLine[] {
  if (!series || series.status === "ok") return [];
  const params = {
    version: props.result.arms[arm].version,
    have: formatCount(series.n),
    need: formatCount(series.floor),
  };
  return [
    {
      arm,
      text:
        series.reason === "below_min_count"
          ? t("serviceVersions.compare.drill.chart.belowFloor", params)
          : t("serviceVersions.compare.drill.chart.noData", params),
    },
  ];
}
const reasons = computed<ReasonLine[]>(() => {
  const value = section.value;
  if (!value || failed.value) return [];
  const before = value.b?.[props.metric];
  const after = value.a?.[props.metric];
  if (after?.reason === "no_data" && (!before || before.reason === "no_data"))
    return [{ arm: "both", text: t("serviceVersions.compare.drill.chart.noDataBoth") }];
  return [...reason("b", before), ...reason("a", after)];
});
const formatY = (value: number) => formatMetric(props.metric, value, t);
const MARKER_COLORS: Partial<Record<TileTone, string>> = {
  crit: "var(--color-status-error-text)",
  warn: "var(--color-status-warning-text)",
  good: "var(--color-status-success-text)",
};
// Sequential arms meet at the deploy; concurrent arms share one window, so no line marks a switch.
const marker = computed(() => {
  if (props.result.mode === "concurrent") return undefined;
  const { a, b } = props.result.arms;
  const tile = props.result.rum?.[props.metric];
  const change =
    tile && !tile.insufficient && tile.a != null && tile.b != null
      ? metricChange(props.metric, tile.b, tile.a, t)
      : "—";
  const restricted = leadingVerdict(props.result)?.restricted;
  const tone = restricted
    ? undefined
    : buildTiles(props.result, "rum", t, worseTone(props.result) === "warn").find(
        (tile) => tile.key === props.metric,
      )?.tone;
  const version = buildLabel(a, b, t);
  return {
    x: a.start_time / 1000,
    label: change === "—" ? version : `${version} · ${metricName(props.metric, t)} ${change}`,
    color: (tone && MARKER_COLORS[tone]) ?? "var(--color-text-secondary)",
    dot: true,
  };
});
</script>
