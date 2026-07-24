<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OStatCard — the reusable KPI / stat tile. The ONE stat primitive across the
// app (list summaries, Home overview, dashboards, AI) so every KPI reads the
// same. A tile has a cohesive tone identity: a soft tone icon chip, a tone value,
// and — when a `max` is given — a thin tone proportion bar showing this stat's
// share of the whole. Optional trend and a `#chart` slot cover richer surfaces.
//
//   <OStatCard label="Active" :value="47" icon="check-circle" tone="success" :max="61" />
//   <OStatCard label="Requests" :value="fmt(n)" tone="primary" :trend="{ direction:'up', label:'12%', tone:'success' }">
//     <template #chart><MySparkline :data="series" /></template>
//   </OStatCard>
//
// Colour comes only from `tone` (token-backed, both themes). `clickable` makes it
// a button (e.g. a filter tile); `selected` marks the active filter with an
// accent BORDER (no fills). Value is shown verbatim — pass "—" for "no data";
// a real 0 renders as "0".

import { computed, useSlots } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { StatTone, StatTrend } from "./OStatStrip.types";

const props = withDefaults(
  defineProps<{
    label?: string;
    value?: string | number;
    icon?: IconName;
    tone?: StatTone;
    trend?: StatTrend;
    /** Denominator for the proportion bar (this stat's share of the whole). */
    max?: number;
    /** Render as a button with hover feedback (e.g. a filter tile). */
    clickable?: boolean;
    /** Active-filter state — accent border. */
    selected?: boolean;
    dataTest?: string;
  }>(),
  { tone: "neutral", clickable: false, selected: false },
);

const slots = useSlots();

// tone → { icon-chip, value-text, proportion-bar } classes. All token-backed.
const TONES: Record<StatTone, { chip: string; value: string; bar: string }> = {
  success: {
    chip: "bg-icon-chip-success-bg text-icon-chip-success-text",
    value: "text-icon-chip-success-text",
    bar: "bg-success-500",
  },
  warning: {
    chip: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
    value: "text-icon-chip-warning-text",
    bar: "bg-warning-500",
  },
  error: {
    chip: "bg-icon-chip-error-bg text-icon-chip-error-text",
    value: "text-icon-chip-error-text",
    bar: "bg-error-500",
  },
  primary: {
    chip: "bg-icon-chip-primary-bg text-icon-chip-primary-text",
    value: "text-icon-chip-primary-text",
    bar: "bg-accent",
  },
  info: {
    chip: "bg-icon-chip-info-bg text-icon-chip-info-text",
    value: "text-icon-chip-info-text",
    bar: "bg-icon-chip-info-text",
  },
  orange: {
    chip: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
    value: "text-icon-chip-orange-text",
    bar: "bg-icon-chip-orange-text",
  },
  // Decorative tones — reuse the OTag badge-soft tokens so a stat tile matches
  // the chip colour of the same value (scorerType, evalDataType, …) exactly.
  blue: {
    chip: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
    value: "text-badge-blue-soft-text",
    bar: "bg-badge-blue-soft-text",
  },
  teal: {
    chip: "bg-badge-teal-soft-bg text-badge-teal-soft-text",
    value: "text-badge-teal-soft-text",
    bar: "bg-badge-teal-soft-text",
  },
  purple: {
    chip: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
    value: "text-badge-purple-soft-text",
    bar: "bg-badge-purple-soft-text",
  },
  neutral: {
    chip: "bg-surface-subtle text-text-secondary",
    value: "text-text-heading",
    bar: "bg-text-muted",
  },
};

const tc = computed(() => TONES[props.tone ?? "neutral"] ?? TONES.neutral);
// Empty ("" / null / "—") shows a dash; a real 0 shows "0". Both render MUTED
// (nothing to draw attention to) — only a positive value gets the tone colour.
const displayValue = computed(() => {
  const v = props.value;
  return v === "" || v == null || v === "—" ? "—" : v;
});
const isMuted = computed(() => {
  const v = props.value;
  return v === 0 || v === "0" || v === "" || v == null || v === "—";
});
// Proportion-bar fill %. The track is ALWAYS rendered (so height never shifts as
// data loads); only the fill width changes:
//   empty / "—" / 0  → 0% (empty track)
//   value, no max    → 100% (a full line, e.g. the Total tile)
//   value with max   → its share of the total
const pct = computed(() => {
  if (isMuted.value) return 0;
  const v = Number(props.value);
  if (props.max == null || props.max <= 0 || !Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, (v / props.max) * 100));
});
const trendArrow = computed(() =>
  props.trend?.direction === "up" ? "▲" : props.trend?.direction === "down" ? "▼" : "—",
);
const trendClass = computed(() =>
  props.trend?.tone
    ? (TONES[props.trend.tone]?.value ?? "text-text-secondary")
    : "text-text-secondary",
);
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="rounded-default bg-surface-base flex min-w-0 flex-col justify-center gap-1 border px-2.5 py-1 text-left transition-colors"
    :class="[
      selected ? 'border-accent' : 'border-border-default',
      clickable ? 'cursor-pointer' : '',
      clickable && !selected ? 'hover:border-accent' : '',
    ]"
    :data-test="dataTest"
  >
    <div class="flex min-w-0 items-center justify-between gap-2">
      <div class="flex min-w-0 items-baseline gap-1.5">
        <span
          class="truncate text-2xl leading-none font-semibold"
          :class="isMuted ? 'text-text-muted' : tc.value"
        >
          <slot name="value">{{ displayValue }}</slot>
        </span>
        <span v-if="label" class="text-text-secondary truncate text-xs font-medium">{{
          label
        }}</span>
        <span v-if="trend" class="text-2xs shrink-0 font-semibold" :class="trendClass"
          >{{ trendArrow }} {{ trend.label }}</span
        >
      </div>
      <span
        v-if="icon || slots.icon"
        class="rounded-default grid h-7 w-7 shrink-0 place-items-center"
        :class="tc.chip"
      >
        <slot name="icon">
          <!-- 20px glyph: the step between OIcon's sm (16px) and md (24px), so the
               icon fills the w-7 chip without touching the surrounding background. -->
          <OIcon v-if="icon" :name="icon" size="sm" class="size-5!" />
        </slot>
      </span>
    </div>
    <!-- Track is always rendered so the card height never shifts as data loads;
         only the fill width changes. -->
    <div class="bg-surface-subtle h-1 overflow-hidden rounded-full">
      <div
        class="h-full rounded-full transition-all duration-300"
        :class="tc.bar"
        :style="{ width: pct + '%' }"
      />
    </div>
    <div v-if="slots.chart" class="min-w-0">
      <slot name="chart" />
    </div>
  </component>
</template>
