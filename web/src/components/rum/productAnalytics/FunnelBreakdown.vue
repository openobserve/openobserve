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
  <div class="flex flex-col" data-test="rum-analytics-funnel-breakdown">
    <div class="flex items-center gap-2 px-4 pt-3 pb-1">
      <span
        class="text-text-heading text-sm font-semibold"
        data-test="rum-analytics-funnel-breakdown-title"
        >{{ t("rum.analytics.funnel.breakdownBy", { field: dimLabel }) }}</span
      >
      <OPopover
        v-if="about"
        align="start"
        content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
        :aria-label="t('rum.analytics.funnel.breakdownAbout')"
      >
        <template #trigger>
          <OButton
            variant="ghost-primary"
            size="xs"
            icon-left="info-outline"
            data-test="rum-analytics-funnel-breakdown-about"
            >{{ t("rum.analytics.funnel.breakdownAbout") }}</OButton
          >
        </template>
        <div
          class="text-text-body flex flex-col gap-2 text-sm"
          data-test="rum-analytics-funnel-breakdown-about-text"
        >
          <span class="text-text-heading font-semibold">{{
            t("rum.analytics.funnel.breakdownAbout")
          }}</span>
          <p>{{ about }}</p>
          <p v-if="k > 1">{{ t("rum.analytics.funnel.breakdownAboutLeft", { step: k }) }}</p>
        </div>
      </OPopover>
    </div>
    <OTable
      :data="tableRows"
      :columns="columns"
      :default-columns="false"
      row-key="id"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :frame="false"
    >
      <template #cell-value="{ row, index }">
        <span
          class="flex items-center gap-1.5"
          :data-test="`rum-analytics-funnel-breakdown-row-${index}`"
        >
          <span :class="labelClass(row)">{{ row.label }}</span>
          <OTag
            v-if="row.atLeast"
            :label="t('rum.analytics.funnel.atLeast')"
            variant="default-soft"
            size="xs"
          />
          <OTag
            v-if="row.builtinOnly"
            :label="t('rum.analytics.funnel.builtinOnly')"
            variant="default-outline"
            size="xs"
          />
          <OTag
            v-if="row.lowVolume"
            :label="t('rum.analytics.funnel.lowVolumeTag')"
            variant="default-soft"
            size="xs"
            :data-test="`rum-analytics-funnel-breakdown-row-${index}-low-volume`"
          />
        </span>
      </template>
      <template v-for="i in shownSteps" :key="i" #[`cell-s${i}`]="{ row }">
        <span v-if="row.prevOnly" class="text-text-secondary flex justify-end">{{ dash }}</span>
        <span
          v-else
          class="flex flex-col items-end tabular-nums"
          :class="row.leftBefore && i >= k - 1 ? 'text-text-secondary' : ''"
        >
          <span>{{ formatCount(row.counts[i], sampled) }}</span>
          <span v-if="i > k - 1 && !row.leftBefore" class="text-text-secondary text-xs">{{
            pct(row.counts[k - 1] > 0 ? row.counts[i] / row.counts[k - 1] : 0)
          }}</span>
        </span>
      </template>
      <template #cell-conversion="{ row }">
        <span v-if="row.prevOnly || row.leftBefore" class="text-text-secondary flex justify-end">{{
          dash
        }}</span>
        <ODataBarCell
          v-else
          :value="row.conversion * 100"
          :max="100"
          :display="pct(row.conversion)"
        />
      </template>
      <template #cell-median="{ row, index }">
        <span
          class="flex justify-end tabular-nums"
          :class="row.medianMs === null ? 'text-text-secondary' : 'text-text-body'"
          :data-test="`rum-analytics-funnel-breakdown-row-${index}-median`"
          >{{ row.medianMs === null ? dash : formatDuration(row.medianMs) }}</span
        >
      </template>
      <template #cell-prev="{ row, index }">
        <span
          class="flex justify-end tabular-nums"
          :class="row.prev?.conversion == null ? 'text-text-secondary' : 'text-text-body'"
          :data-test="`rum-analytics-funnel-breakdown-row-${index}-prev`"
          >{{ row.prev?.conversion == null ? dash : pct(row.prev.conversion)
          }}<OTooltip v-if="prevTip(row)" :content="prevTip(row)"
        /></span>
      </template>
      <template #cell-change="{ row, index }">
        <span
          class="flex justify-end"
          :data-test="`rum-analytics-funnel-breakdown-row-${index}-change`"
        >
          <FunnelChangeCell
            :change="row.prev?.change ?? null"
            :unit-noun="unitNoun"
            :failed="compare?.status === 'failed'"
            end
          />
        </span>
      </template>
    </OTable>
    <span
      v-if="tableRows.some((r) => r.lowVolume)"
      class="text-text-secondary px-4 py-2 text-end text-xs"
      data-test="rum-analytics-funnel-breakdown-low-volume-note"
      >{{
        t("rum.analytics.funnel.lowVolumeNote", { count: LOW_VOLUME, unit: unitNoun, step: k })
      }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FunnelChangeCell from "@/components/rum/productAnalytics/funnelParts/FunnelChangeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  formatCount,
  formatDuration,
  type BreakdownRow,
  type BreakdownStart,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type { SampleRatio, StepRef } from "@/utils/rum/productAnalyticsQueries";
import type {
  BreakdownCompareState,
  ComparedBreakdownRow,
  PrevSide,
} from "@/utils/rum/funnelCompare";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

interface TableRow {
  id: string;
  label: string;
  counts: number[];
  conversion: number;
  atLeast: boolean;
  total: boolean;
  builtinOnly: boolean;
  prev: PrevSide | null;
  prevOnly: boolean;
  leftBefore: boolean;
  medianMs: number | null;
  lowVolume: boolean;
  best: boolean;
}

const props = withDefaults(
  defineProps<{
    rows: (BreakdownRow | ComparedBreakdownRow)[];
    total: number[];
    steps: StepRef[];
    dimLabel: I18nText;
    events: NamedEvent[];
    sampled?: SampleRatio;
    deletedNames?: Readonly<Record<string, string>>;
    builtinOnly?: string[];
    compare?: BreakdownCompareState | null;
    unitNoun?: I18nText;
    /** Where an attribute breakdown's rates start; null for a built-in one, which starts at step 1. */
    start?: BreakdownStart | null;
  }>(),
  {
    start: null,
    sampled: 1,
    deletedNames: () => ({}),
    builtinOnly: () => [],
    compare: null,
    unitNoun: () => raw(""),
  },
);
const { t } = useI18nTyped();

// Below this many units at the start step a rate swings on a handful of units.
const LOW_VOLUME = 10;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const dash = raw("—");

const k = computed(() => (props.start && !props.start.anyStep ? props.start.step : 1));

// Columns between step 1 and the start step only repeat the start step's count, so they are left out.
const shownSteps = computed(() =>
  props.steps.map((_, i) => i).filter((i) => i === 0 || i >= k.value - 1),
);

const nameOf = (step: number) =>
  props.steps[step - 1] ? stepLabel(props.steps[step - 1], props.events, props.deletedNames) : "";

const about = computed<I18nText | null>(() => {
  const s = props.start;
  if (!s) return null;
  const args = {
    field: props.dimLabel,
    step: s.step,
    name: raw(nameOf(s.step)),
    covered: raw(addCommasToNumber(s.covered)),
    reached: raw(addCommasToNumber(s.reached)),
    unit: props.unitNoun,
  };
  if (s.anyStep) return t("rum.analytics.funnel.breakdownAboutAny", args);
  return s.pinned
    ? t("rum.analytics.funnel.breakdownAboutPinned", args)
    : t("rum.analytics.funnel.breakdownAboutAuto", args);
});

const prevTip = (row: TableRow): I18nText | undefined => {
  if (props.compare?.status === "failed") return t("rum.analytics.funnel.previousFailed");
  if (!row.prev || props.compare?.status !== "ok") return undefined;
  return t("rum.analytics.funnel.breakdownPrevTooltip", {
    last: formatCount(row.prev.last, props.sampled),
    first: formatCount(row.prev.first, props.sampled),
    unit: props.unitNoun,
    range: raw(props.compare.prevRange),
  });
};

// Only a finished previous run lines up with these rows; while it loads or after it fails every cell is a dash.
const prevOf = (r: BreakdownRow | ComparedBreakdownRow): PrevSide | null =>
  props.compare?.status === "ok" && "prev" in r ? r.prev : null;

const rowLabel = (r: BreakdownRow): string => {
  if (r.leftBefore) return t("rum.analytics.funnel.leftBefore", { step: k.value });
  if (r.noValue) return t("rum.analytics.funnel.reachedNoValue", { step: k.value });
  if (r.notSet) return t("rum.analytics.funnel.notSet");
  return r.other ? t("rum.analytics.funnel.other") : r.label;
};

const isPrevOnly = (r: BreakdownRow | ComparedBreakdownRow) => "prevOnly" in r && r.prevOnly;

const isLow = (r: BreakdownRow | ComparedBreakdownRow) =>
  r.value !== null && !isPrevOnly(r) && r.counts[k.value - 1] < LOW_VOLUME;

// One value converting best among those with enough volume; a tie names none.
const bestValue = computed<string | null>(() => {
  const ranked = props.rows
    .filter((r) => r.value !== null && !isPrevOnly(r) && !isLow(r))
    .sort((a, b) => b.conversion - a.conversion);
  if (ranked.length < 2 || ranked[0].conversion === ranked[1].conversion) return null;
  return ranked[0].value;
});

const labelClass = (row: TableRow) => {
  if (row.total || row.best) return "text-text-heading font-semibold";
  return row.leftBefore ? "text-text-secondary" : "text-text-body";
};

const tableRows = computed<TableRow[]>(() => [
  ...props.rows.map((r, i) => ({
    id: `r${i}`,
    label: rowLabel(r),
    counts: r.counts,
    conversion: r.conversion,
    atLeast: r.atLeast,
    total: false,
    builtinOnly: !r.notSet && !r.other && props.builtinOnly.includes(r.label),
    prev: prevOf(r),
    prevOnly: isPrevOnly(r),
    leftBefore: r.leftBefore,
    medianMs: isPrevOnly(r) || r.leftBefore ? null : r.medianMs,
    lowVolume: isLow(r),
    best: r.value !== null && r.value === bestValue.value,
  })),
  {
    id: "total",
    label: t("rum.analytics.funnel.total"),
    counts: props.total,
    conversion:
      props.total[k.value - 1] > 0
        ? props.total[props.total.length - 1] / props.total[k.value - 1]
        : 0,
    atLeast: false,
    total: true,
    builtinOnly: false,
    prev: props.compare?.status === "ok" ? props.compare.total : null,
    prevOnly: false,
    leftBefore: false,
    medianMs: null,
    lowVolume: false,
    best: false,
  },
]);

const columns = computed<OTableColumnDef<TableRow>[]>(() => [
  {
    id: "value",
    header: props.dimLabel,
    accessorKey: "label",
    size: 160,
    meta: { fillRemaining: true },
  },
  ...shownSteps.value.map((i) => ({
    id: `s${i}`,
    header: raw(`${i + 1}. ${stepLabel(props.steps[i], props.events, props.deletedNames)}`),
    accessorFn: (r: TableRow) => r.counts[i],
    size: 120,
    meta: { align: "right" as const },
  })),
  {
    id: "conversion",
    header: t("rum.analytics.funnel.conversionFromStep", { step: k.value }),
    accessorKey: "conversion",
    size: 150,
    meta: { align: "right" },
  },
  {
    id: "median",
    header: t("rum.analytics.funnel.medianTime"),
    accessorFn: (r: TableRow) => r.medianMs,
    size: 100,
    meta: { align: "right" },
  },
  ...(props.compare
    ? [
        {
          id: "prev",
          header: props.compare.label,
          accessorFn: (r: TableRow) => r.prev?.conversion ?? null,
          size: 110,
          meta: { align: "right" as const },
        },
        {
          id: "change",
          header: t("rum.analytics.funnel.changeHeader"),
          accessorFn: (r: TableRow) => r.prev?.change?.pts ?? null,
          size: 140,
          meta: { align: "right" as const },
        },
      ]
    : []),
]);
</script>
