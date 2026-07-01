<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// ODataBarCell — the headline "bars like Datadog" cell (audit §2.2). Renders
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
    /** Pre-formatted text to show. Falls back to a grouped number. */
    display?: string | number;
    /** Bar tone. Default teal; "warning"/"danger" for threshold columns. */
    variant?: "default" | "warning" | "danger";
    emptyLabel?: string;
  }>(),
  { variant: "default", emptyLabel: "—" },
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
  if (num.value === null || props.max <= 0 || num.value <= 0) return 0;
  return Math.min(100, (num.value / props.max) * 100);
});

const barClass = computed(
  () =>
    ({
      default: "tw:bg-progress-bar-default",
      warning: "tw:bg-progress-bar-warning",
      danger: "tw:bg-progress-bar-danger",
    })[props.variant],
);
</script>

<template>
  <!-- Value on top, a thin magnitude bar UNDERNEATH (no overlap with the
       number). Both right-aligned so the bars share a common right edge and
       lengths stay comparable across rows. -->
  <div class="tw:flex tw:flex-col tw:items-end tw:justify-center tw:gap-0.75 tw:w-full tw:min-w-0">
    <span
      class="tw:tabular-nums tw:whitespace-nowrap tw:leading-none"
      :class="num === null ? 'tw:text-text-primary tw:text-xs' : ''"
    >{{ text }}</span>
    <div
      v-if="widthPct > 0"
      class="tw:h-0.75 tw:rounded-full tw:opacity-80 tw:pointer-events-none tw:transition-[width] tw:duration-300"
      :class="barClass"
      :style="{ width: widthPct + '%' }"
      aria-hidden="true"
    />
  </div>
</template>
