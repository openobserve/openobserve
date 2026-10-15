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
  <OCard
    variant="outlined"
    class="min-w-0 gap-2 p-3"
    :data-test="`traces-comparison-field-${field.name}`"
    :data-score="field.score.toFixed(2)"
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="text-compact text-text-heading min-w-0 truncate font-mono">
        {{ raw(field.name) }}
        <OTooltip :content="raw(field.name)" />
      </span>
      <span
        class="ms-auto shrink-0 text-xs tabular-nums"
        :class="field.score > noiseFloorPts ? 'text-text-heading' : 'text-text-secondary'"
      >
        {{ t("traces.comparison.scorePts", { pts: Math.round(field.score) }) }}
      </span>
    </div>
    <div class="text-text-secondary text-xs">
      {{ t("traces.comparison.presentIn", { pct: percent(field.presenceSel) }) }}
    </div>

    <template v-if="field.kind === 'numeric' && field.bins">
      <div class="h-32 min-w-0">
        <!-- ChartRenderer escape hatch: bin click selects the bin for the ≥/< actions; data is computed in the browser, not a panel query -->
        <ChartRenderer :data="{ options }" @click="onBinClick" />
      </div>
      <div class="flex flex-wrap gap-2">
        <OButton
          v-if="gteTerm"
          variant="outline"
          size="xs"
          :data-test="`traces-comparison-bin-gte-${field.name}`"
          @click="emit('apply', gteTerm)"
        >
          {{ t("traces.comparison.atLeast", { value: boundLabel(selectedBinRange.lo) }) }}
        </OButton>
        <OButton
          v-if="ltTerm"
          variant="outline"
          size="xs"
          :data-test="`traces-comparison-bin-lt-${field.name}`"
          @click="emit('apply', ltTerm)"
        >
          {{ t("traces.comparison.below", { value: boundLabel(selectedBinRange.hi) }) }}
        </OButton>
      </div>
    </template>

    <div
      v-for="(row, i) in field.rows"
      :key="i"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2"
    >
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-text-body min-w-0 truncate text-xs">
          {{ rowLabel(row) }}
          <OTooltip :content="rowLabel(row)" />
        </span>
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <OProgressBar size="xs" :value="row.sel" />
          </div>
          <span class="text-text-secondary w-10 text-end text-xs tabular-nums">
            {{ percent(row.sel) }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <OProgressBar size="xs" variant="neutral" :value="row.base" />
          </div>
          <span class="text-text-secondary w-10 text-end text-xs tabular-nums">
            {{ percent(row.base) }}
          </span>
        </div>
      </div>
      <div v-if="row.bucket.kind !== 'other'" class="flex items-center gap-1">
        <OTooltip :content="t('traces.comparison.filterTo')">
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            :aria-label="t('traces.comparison.filterTo')"
            :data-test="`traces-comparison-include-${field.name}-${i}`"
            @click="applyRow(row, 'include')"
          >
            <EqualIcon class="size-2" />
          </OButton>
        </OTooltip>
        <OTooltip :content="t('traces.comparison.exclude')">
          <OButton
            variant="ghost"
            size="icon-xs-circle"
            :aria-label="t('traces.comparison.exclude')"
            :data-test="`traces-comparison-exclude-${field.name}-${i}`"
            @click="applyRow(row, 'exclude')"
          >
            <NotEqualIcon class="size-2" />
          </OButton>
        </OTooltip>
      </div>
    </div>
  </OCard>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import useTheme from "@/composables/useTheme";
import { chartColor, chartTextColor, chartAxisLine } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { formatDurationBound } from "./latencyHeatmap";
import { filterTermFor, type BucketRow, type FieldComparison } from "./traceComparison";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);

const props = defineProps<{ field: FieldComparison; noiseFloorPts: number }>();
const emit = defineEmits<{ (e: "apply", term: string): void }>();

const { t } = useI18nTyped();
const { isDark } = useTheme();

// A sparse field's shares are small, so keep one decimal below 1% rather than showing a non-zero share as 0%.
const percent = (share: number) =>
  share > 0 && share < 0.01 ? `${(share * 100).toFixed(1)}%` : `${Math.round(share * 100)}%`;

const boundLabel = (value: number) =>
  props.field.durationLiterals ? formatDurationBound(value) : String(+value.toPrecision(6));

const rowLabel = (row: BucketRow): I18nText => {
  switch (row.bucket.kind) {
    case "noValue":
      return t("traces.comparison.noValue");
    case "empty":
      return t("traces.comparison.emptyValue");
    case "other":
      return t("traces.comparison.otherValues", { count: row.bucket.count }, row.bucket.count);
    default:
      return raw(row.label);
  }
};

const applyRow = (row: BucketRow, action: "include" | "exclude") => {
  const term = filterTermFor(props.field, row.bucket, action);
  if (term) emit("apply", term);
};

const selectedBin = ref(props.field.topBin ?? 0);
watch(
  () => props.field,
  (field) => (selectedBin.value = field.topBin ?? 0),
);

const selectedBinRange = computed(() => props.field.bins?.[selectedBin.value] ?? { lo: 0, hi: 0 });
const gteTerm = computed(() =>
  filterTermFor(props.field, { kind: "bin", index: selectedBin.value }, "gte"),
);
const ltTerm = computed(() =>
  filterTermFor(props.field, { kind: "bin", index: selectedBin.value }, "lt"),
);

const onBinClick = (params: { dataIndex?: number }) => {
  if (typeof params?.dataIndex === "number") selectedBin.value = params.dataIndex;
};

const binLabel = (lo: number, hi: number) =>
  hi === Infinity ? `≥ ${boundLabel(lo)}` : `${boundLabel(lo)}–${boundLabel(hi)}`;

const options = computed(() => {
  void isDark.value; // The resolved token values are cached — re-read on a flip.
  const bins = props.field.bins ?? [];
  const marked = { borderColor: chartColor("--color-border-strong"), borderWidth: 1.5 };
  const textColor = chartTextColor();
  const series = (key: "sel" | "base", color: string, opacity = 1) => ({
    type: "bar",
    barGap: "-100%",
    itemStyle: { color, opacity },
    data: bins.map((b, k) => ({
      value: b[key] * 100,
      ...(k === selectedBin.value ? { itemStyle: marked } : {}),
    })),
  });
  return {
    animation: false,
    // ECharts canvas sizes are pixel numbers with no CSS cascade, and no chart size tokens exist.
    grid: { left: 4, right: 4, top: 6, bottom: 20 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderWidth: 0,
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      formatter: (params: any[]) => {
        const k = params?.[0]?.dataIndex ?? 0;
        const b = bins[k];
        if (!b) return "";
        return [
          escapeHtml(binLabel(b.lo, b.hi)),
          escapeHtml(t("traces.comparison.selectionShare", { pct: percent(b.sel) })),
          escapeHtml(t("traces.comparison.baselineShare", { pct: percent(b.base) })),
        ].join("<br/>");
      },
    },
    xAxis: {
      type: "category",
      data: bins.map((b) => binLabel(b.lo, b.hi)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartAxisLine() } },
      axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
    },
    yAxis: { type: "value", show: false },
    series: [
      series("base", chartColor("--color-progress-bar-neutral")),
      series("sel", chartColor("--color-progress-bar-default"), 0.75),
    ],
  };
});
</script>
