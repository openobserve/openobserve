<script setup lang="ts">
import { raw, type I18nText } from "@/types/i18n";
// Copyright 2026 OpenObserve Inc.
//
// ODataBarCell — the headline in-cell bar chart. Renders
// a (right-aligned) formatted value with a subtle horizontal bar behind it,
// width proportional to value / columnMax. The caller computes the column max
// over the visible page and passes it in, plus the already-formatted display
// string (so existing accessorFn formatting is reused verbatim).
//
//   <ODataBarCell :value="row.doc_num" :max="docNumMax" :display="value" />
//   <ODataBarCell :value="row.error_count" :max="errMax" :display="value"
//                 :variant="row.error_count > 0 ? 'danger' : 'default'" />

import { computed } from "vue";
import { addCommasToNumber } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    /** Raw numeric value used for the bar width. */
    value: unknown;
    /** Column maximum (over the visible rows) — the bar's 100% reference. */
    max: number;
    /** Column minimum — the bar's 0% reference. */
    min?: number;
    /** Bar colour from data (e.g. a threshold step); overrides the variant tone. */
    color?: string | null;
    /** Pre-formatted text to show. Falls back to a grouped number. */
    display?: string | number;
    /** Bar tone. Default teal; "warning"/"danger" for threshold columns. */
    variant?: "default" | "warning" | "danger";
    emptyLabel?: I18nText;
    /** Draw a filled bar on a track with the value beside it, instead of a thin bar under the value. */
    gauge?: boolean;
  }>(),
  { variant: "default", emptyLabel: raw("—"), min: 0, color: null, gauge: false },
);

const num = computed<number | null>(() => {
  const v = props.value;
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
});

const text = computed(() => {
  if (props.display !== undefined && props.display !== null && props.display !== "")
    return String(props.display);
  return num.value === null ? props.emptyLabel : addCommasToNumber(num.value);
});

/** Bar width 0–100%. Hidden when no value, non-positive, or no valid max. */
const widthPct = computed(() => {
  const span = props.max - props.min;
  if (num.value === null || span <= 0 || num.value <= props.min) return 0;
  return Math.min(100, ((num.value - props.min) / span) * 100);
});

const barClass = computed(
  () =>
    ({
      default: "bg-progress-bar-default",
      warning: "bg-progress-bar-warning",
      danger: "bg-progress-bar-danger",
    })[props.variant],
);
</script>

<template>
  <div v-if="gauge" class="flex w-full min-w-0 items-center gap-2">
    <div
      class="rounded-default bg-progress-bar-track relative h-3 min-w-0 flex-1 overflow-hidden"
      aria-hidden="true"
      data-test="o2-data-bar-cell-track"
    >
      <div
        v-if="widthPct > 0"
        class="rounded-default h-full transition-[width] duration-300"
        :class="barClass"
        :style="{ width: widthPct + '%', ...(color ? { backgroundColor: color } : {}) }"
        data-test="o2-data-bar-cell-fill"
      />
    </div>
    <span
      class="shrink-0 leading-none whitespace-nowrap tabular-nums"
      :class="num === null ? 'text-text-body text-xs' : ''"
      >{{ text }}</span
    >
  </div>
  <!-- Value on top, a thin magnitude bar UNDERNEATH (no overlap with the
       number). Both right-aligned so the bars share a common right edge and
       lengths stay comparable across rows. -->
  <div v-else class="flex w-full min-w-0 flex-col items-end justify-center gap-0.75">
    <span
      class="leading-none whitespace-nowrap tabular-nums"
      :class="num === null ? 'text-text-body text-xs' : ''"
      >{{ text }}</span
    >
    <div
      v-if="widthPct > 0"
      class="pointer-events-none h-0.75 rounded-full opacity-80 transition-[width] duration-300"
      :class="barClass"
      :style="{ width: widthPct + '%', ...(color ? { backgroundColor: color } : {}) }"
      aria-hidden="true"
    />
  </div>
</template>
