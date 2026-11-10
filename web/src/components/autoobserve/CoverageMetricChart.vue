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
    class="bg-surface-base rounded-surface flex min-w-0 flex-col gap-1 border p-3 shadow-xs"
    :class="expanded ? 'border-accent' : 'border-border-default'"
    :data-test="`autoobserve-coverage-chart-${def.signal}`"
  >
    <div class="flex items-center gap-2">
      <span class="text-text-secondary min-w-0 truncate text-xs">{{ title }}</span>
      <span
        v-if="partial && (status === 'ready' || status === 'empty')"
        class="text-text-secondary shrink-0 text-xs"
        :data-test="`autoobserve-coverage-chart-partial-${def.signal}`"
        >{{ t("autoobserveLive.charts.partial") }}</span
      >
      <OTooltip v-if="wide && status === 'ready'" :content="wideText">
        <span
          role="img"
          class="text-text-secondary inline-flex shrink-0"
          :aria-label="wideText"
          :data-test="`autoobserve-coverage-chart-wide-${def.signal}`"
          ><OIcon name="info-outline" size="xs"
        /></span>
      </OTooltip>
      <OButton
        variant="ghost"
        size="xs"
        class="ms-auto"
        :aria-expanded="expanded"
        :aria-label="t('autoobserve.coverage.detailsFor', { metric: title })"
        :data-test="`autoobserve-coverage-chart-details-${def.signal}`"
        @click="emit('toggle')"
      >
        <OIcon :name="expanded ? 'expand-less' : 'expand-more'" size="xs" />
        {{ t("autoobserve.coverage.details") }}
      </OButton>
    </div>
    <div
      class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
      :class="status ? 'min-h-6.25' : ''"
    >
      <span
        v-if="showValue"
        class="text-text-heading text-xl leading-tight font-semibold tabular-nums"
        :data-test="`autoobserve-coverage-chart-value-${def.signal}`"
        >{{ valueText }}</span
      >
      <OSkeleton
        v-else-if="status === 'loading'"
        class="h-6.25 w-16 self-center"
        animation="pulse"
      />
      <span
        v-if="delta"
        class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
        :class="delta.tone"
        :aria-label="delta.label"
        :data-test="`autoobserve-coverage-chart-delta-${def.signal}`"
        ><OIcon
          v-if="delta.up !== null"
          :name="delta.up ? 'arrow-upward' : 'arrow-downward'"
          size="xs"
        />{{ delta.text }}</span
      >
      <span
        class="ms-auto inline-flex items-center gap-1 text-xs"
        :class="badge.tone"
        :data-test="`autoobserve-coverage-chart-badge-${def.signal}`"
      >
        <OIcon :name="badge.icon" size="xs" />{{ badge.label }}
      </span>
    </div>

    <OSkeleton
      v-if="status === 'loading'"
      class="h-30"
      animation="pulse"
      role="status"
      :aria-label="t('autoobserveLive.charts.loading', { metric: title })"
      :data-test="`autoobserve-coverage-chart-loading-${def.signal}`"
    />
    <div
      v-else-if="status === 'failed' || status === 'denied'"
      :role="status === 'failed' ? 'alert' : 'status'"
      class="border-banner-error-soft-border bg-banner-error-soft-bg text-banner-error-soft-text rounded-default flex h-30 min-w-0 flex-col items-start justify-center gap-1 border px-3 text-sm"
      :data-test="`autoobserve-coverage-chart-${status}-${def.signal}`"
    >
      <span class="inline-flex min-w-0 items-center gap-1 font-medium"
        ><OIcon :name="status === 'denied' ? 'lock' : 'error'" size="xs" class="shrink-0" />{{
          reason
        }}</span
      >
      <span v-if="detail" class="text-text-body line-clamp-2 text-xs break-words" :title="detail">{{
        detail
      }}</span>
      <OButton
        v-if="status === 'failed'"
        variant="outline"
        size="xs"
        :data-test="`autoobserve-coverage-chart-retry-${def.signal}`"
        @click="emit('retry')"
        >{{ t("autoobserveLive.retry") }}</OButton
      >
    </div>
    <div
      v-else-if="cell.state === 'gap' && !cell.engine && !noData"
      class="bg-hatch-unavailable border-border-default rounded-default text-text-secondary flex h-16 items-center justify-center border border-dashed text-sm"
      :data-test="`autoobserve-coverage-chart-gap-${def.signal}`"
    >
      {{ t("autoobserve.coverage.badgeNotWatched") }}
    </div>
    <div
      v-else-if="noData"
      class="bg-hatch-unavailable border-border-default rounded-default text-text-secondary flex items-center justify-center border border-dashed px-3 text-center text-sm"
      :class="status ? 'h-30' : 'h-16'"
      :data-test="`autoobserve-coverage-chart-nodata-${def.signal}`"
    >
      {{ reason ?? t("autoobserveLive.drawer.chartNoData") }}
    </div>
    <template v-else>
      <div
        role="img"
        :aria-label="summary"
        class="h-30 min-w-0 cursor-pointer"
        @click="emit('toggle')"
      >
        <!-- ChartRenderer, not PanelSchemaRenderer: the series is built before it gets here, from a fixture or the drawer's own query. -->
        <ChartRenderer :data="{ options, extras: { panelId, isTimeSeries: true } }" />
      </div>
      <span
        v-if="cell.state === 'learning'"
        class="text-text-secondary text-xs"
        :data-test="`autoobserve-coverage-chart-learning-${def.signal}`"
        >{{ learningCaption }}</span
      >
    </template>
    <slot />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import ChartRenderer from "@/components/dashboards/panels/ChartRenderer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useTheme from "@/composables/useTheme";
import { chartColor, chartGridLine, chartTextColor } from "@/utils/chartTheme";
import {
  ACCENT,
  RISE_IS_BAD,
  formatValue,
  type ChartRange,
  type MetricDef,
  type MetricSeries,
} from "./coverageSeries";
import type { CoverageCell } from "./fixtures";
import { liveCellWord } from "./live/liveCopy";
import type { ServiceChartStatus } from "./live/useServiceCharts";

const props = defineProps<{
  def: MetricDef;
  series: MetricSeries;
  cell: CoverageCell;
  range: ChartRange;
  start: number;
  end: number;
  expanded: boolean;
  readyOn: I18nText | null;
  noData?: boolean;
  status?: ServiceChartStatus;
  reason?: I18nText;
  detail?: I18nText;
  partial?: boolean;
  wide?: boolean;
  /** An alert for this check was just added and waits for the next pass to count it. */
  added?: boolean;
}>();

const emit = defineEmits<{ toggle: []; retry: [] }>();

const { t } = useI18nTyped();
const { isDark } = useTheme();

const panelId = computed(() => `autoobserve-coverage-${props.def.signal}`);

const title = computed(() => t(props.def.titleKey));

const valueText = computed(() => {
  const { current } = props.series;
  return raw(current == null ? "\u2014" : formatValue(props.def, current));
});

// A live cell carries engine state, and a live gap still has data worth charting.
const showValue = computed(
  () =>
    !props.noData &&
    (props.status == null || props.status === "ready") &&
    (props.cell.state !== "gap" || !!props.cell.engine),
);

const wideText = computed(() => t("autoobserveLive.charts.wide"));

// Against the start of the window; requests carry no good-or-bad colour.
const delta = computed(() => {
  const { current, previous } = props.series;
  if (!showValue.value || current == null || !previous) return null;
  const change = (current - previous) / previous;
  const pct = raw(`${Math.round(Math.abs(change) * 100)}%`);
  if (Math.round(Math.abs(change) * 100) === 0)
    return {
      up: null,
      tone: "text-text-secondary",
      text: pct,
      label: t("autoobserve.coverage.deltaFlat"),
    };
  const up = change > 0;
  const bad = RISE_IS_BAD[props.def.signal];
  const tone =
    bad == null
      ? "text-text-secondary"
      : up === bad
        ? "text-status-warning-text"
        : "text-status-success-text";
  const label = up
    ? t("autoobserve.coverage.deltaUp", { change: pct })
    : t("autoobserve.coverage.deltaDown", { change: pct });
  return { up, tone, text: pct, label };
});

const anomaly = computed(() => props.cell.method === "anomaly");

const plain = (v: number) => formatValue({ ...props.def, max: undefined }, v);

const badge = computed<{ icon: IconName; label: I18nText; tone: string }>(() => {
  const [days, total] = props.cell.progress ?? [0, 0];
  if (props.cell.state === "gap" && props.added)
    return {
      icon: "hourglass-empty",
      label: t("autoobserveLive.cell.added"),
      tone: "text-text-secondary",
    };
  if (props.cell.state === "gap")
    return {
      icon: "warning-amber",
      label: props.cell.engine
        ? liveCellWord(t, props.cell.engine.stateKey)
        : t("autoobserve.coverage.badgeNotWatched"),
      tone: "text-badge-amber-soft-text",
    };
  if (props.cell.state === "learning")
    return {
      icon: "psychology",
      label: t("autoobserve.coverage.badgeLearning", { days, total }),
      tone: "text-status-info-text",
    };
  if (props.cell.engine?.detectorKind)
    return {
      icon: anomaly.value ? "insights" : "rule",
      label: props.cell.engine.detectorKind,
      tone: anomaly.value ? "text-status-success-text" : "text-text-secondary",
    };
  if (anomaly.value)
    return {
      icon: "insights",
      label: t("autoobserve.coverage.badgeAnomaly"),
      tone: "text-status-success-text",
    };
  return {
    icon: "rule",
    label: t("autoobserve.coverage.badgeThreshold", {
      threshold: raw(plain(props.def.threshold ?? 0)),
    }),
    tone: "text-text-secondary",
  };
});

const learningCaption = computed(() => {
  const [days, total] = props.cell.progress ?? [0, 0];
  return t("autoobserve.coverage.readyCaption", { day: props.readyOn ?? "", days, total });
});

const summary = computed(() => {
  const vars = { metric: title.value, value: valueText.value };
  const { current, low, high } = props.series;
  if (current == null) return t("autoobserveLive.charts.summaryNone", { metric: title.value });
  if (props.cell.engine) return t("autoobserveLive.charts.summary", vars);
  if (props.cell.state === "learning") return t("autoobserve.coverage.chartLearning", vars);
  if (!anomaly.value) {
    const limit = props.def.threshold ?? 0;
    return t(
      current >= limit
        ? "autoobserve.coverage.chartOverThreshold"
        : "autoobserve.coverage.chartUnderThreshold",
      { ...vars, threshold: raw(plain(limit)) },
    );
  }
  if (high != null && current > high) return t("autoobserve.coverage.chartAbove", vars);
  if (low != null && current < low) return t("autoobserve.coverage.chartBelow", vars);
  return t("autoobserve.coverage.chartWithin", vars);
});

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: props.range === "7d" ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });

// Rates under 1 keep two significant digits, or nice ticks such as 0.02 and 0.04 both read "0".
const compact = (v: number) =>
  Math.abs(v) < 1 && v !== 0
    ? v.toLocaleString(undefined, { maximumSignificantDigits: 2 })
    : v.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });

const outside = computed(() => {
  const { points, band } = props.series;
  if (anomaly.value && band)
    return points.filter(([, v], i) => v != null && (v > band[i][2] || v < band[i][1]));
  const limit = props.def.threshold;
  return limit == null ? [] : points.filter(([, v]) => v != null && v >= limit);
});

const options = computed(() => {
  void isDark.value;
  const accent = chartColor(ACCENT[props.def.signal]);
  const warning = chartColor("--color-status-warning-text");
  const surface = chartColor("--color-surface-base");
  const text = chartTextColor();
  const grid = chartGridLine();
  const learning = props.cell.state === "learning";
  const band = anomaly.value && props.series.band ? props.series.band : null;
  const def = props.def;
  const last = props.series.points[props.series.points.length - 1];
  const thresholdLine =
    !anomaly.value && def.threshold != null
      ? {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", color: warning, width: 1 },
          label: {
            position: "insideStartTop",
            color: warning,
            fontSize: 10,
            backgroundColor: surface,
            padding: [1, 3],
            formatter: () => plain(def.threshold ?? 0),
          },
          data: [{ yAxis: def.threshold }],
        }
      : undefined;
  const bandSeries = band
    ? [
        {
          type: "line",
          data: band.map(([ms, lo]) => [ms, lo]),
          stack: "band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
        },
        {
          type: "line",
          data: band.map(([ms, lo, hi]) => [ms, hi - lo]),
          stack: "band",
          symbol: "none",
          silent: true,
          lineStyle: { opacity: 0 },
          areaStyle: { color: accent, opacity: learning ? 0.08 : 0.16 },
        },
      ]
    : [];
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 40, right: 26, top: 14, bottom: 18 },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line", lineStyle: { color: text, width: 1 } },
      textStyle: { fontSize: 12 },
      formatter: (
        params: { seriesIndex: number; dataIndex: number; value: [number, number | null] }[],
      ) => {
        const main = params.find((p) => p.seriesIndex === 0);
        if (!main) return "";
        const [ms, value] = main.value;
        const parts = [fmtTime(ms), `<b>${value == null ? "—" : formatValue(def, value)}</b>`];
        const b = band?.[main.dataIndex];
        if (b)
          parts.push(
            t("autoobserve.coverage.tipNormal", {
              low: formatValue(def, b[1]),
              high: formatValue(def, b[2]),
            }),
          );
        return parts.join("<br/>");
      },
    },
    xAxis: {
      type: "time",
      min: props.start,
      max: props.end,
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
      axisLabel: { color: text, fontSize: 9, hideOverlap: true },
      splitNumber: 3,
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: def.max,
      splitNumber: 2,
      axisLabel: { color: text, fontSize: 10, formatter: compact },
      splitLine: { lineStyle: { color: grid, type: "dashed" } },
    },
    series: [
      {
        type: "line",
        data: props.series.points,
        showSymbol: false,
        symbol: "circle",
        smooth: 0.2,
        z: 3,
        lineStyle: { color: accent, width: 1.75 },
        itemStyle: { color: accent },
        areaStyle: {
          opacity: 0.22,
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: accent },
              { offset: 1, color: surface },
            ],
          },
        },
        markLine: thresholdLine,
      },
      ...bandSeries,
      {
        type: "scatter",
        data: outside.value,
        symbolSize: 6,
        z: 4,
        silent: true,
        itemStyle: { color: accent, borderColor: surface, borderWidth: 1.5 },
      },
      {
        type: "scatter",
        data: last ? [last] : [],
        symbolSize: 9,
        z: 5,
        silent: true,
        itemStyle: { color: accent, borderColor: surface, borderWidth: 2 },
        label: {
          show: true,
          position: "top",
          distance: 4,
          color: text,
          fontSize: 10,
          backgroundColor: surface,
          padding: [1, 3],
          formatter: () => t("autoobserve.coverage.now"),
        },
      },
    ],
  };
});
</script>
