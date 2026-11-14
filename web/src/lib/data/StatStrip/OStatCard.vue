<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OStatCard: the one stat tile. Value first, label beside it, an optional tone chip and a
// proportion track that is always drawn, so the box is the same size loading or loaded.

import { computed } from "vue";

import { raw } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatCompactCount } from "@/utils/formatters";

import type { OStatCardProps, OStatCardSlots, StatDelta, StatTone } from "./OStatStrip.types";

const props = withDefaults(defineProps<OStatCardProps>(), {
  tone: "neutral",
  size: "md",
  compactValue: false,
  stacked: false,
  clickable: false,
  selected: false,
  loading: false,
});

const slots = defineSlots<OStatCardSlots>();

const TONES: Record<StatTone, { chip: string; value: string; bar: string }> = {
  neutral: {
    chip: "bg-surface-subtle text-text-secondary",
    value: "text-text-heading",
    bar: "bg-text-muted",
  },
  ok: {
    chip: "bg-badge-success-soft-bg text-badge-success-soft-text",
    value: "text-badge-success-soft-text",
    bar: "bg-badge-success-solid-bg",
  },
  warn: {
    chip: "bg-badge-warning-soft-bg text-badge-warning-soft-text",
    value: "text-badge-warning-soft-text",
    bar: "bg-badge-warning-solid-bg",
  },
  err: {
    chip: "bg-badge-error-soft-bg text-badge-error-soft-text",
    value: "text-badge-error-soft-text",
    bar: "bg-badge-error-solid-bg",
  },
  crit: {
    chip: "bg-badge-purple-soft-bg text-badge-purple-soft-text",
    value: "text-badge-purple-soft-text",
    bar: "bg-badge-purple-solid-bg",
  },
  info: {
    chip: "bg-badge-blue-soft-bg text-badge-blue-soft-text",
    value: "text-badge-blue-soft-text",
    bar: "bg-badge-blue-solid-bg",
  },
};

const DELTA_TONE: Record<NonNullable<StatDelta["tone"]>, string> = {
  neutral: "text-text-secondary",
  ok: "text-badge-success-soft-text",
  warn: "text-badge-warning-soft-text",
  err: "text-badge-error-soft-text",
};

const DELTA_ARROW: Record<StatDelta["direction"], string> = { up: "▲", down: "▼", flat: "→" };

const isUnknown = computed(() => {
  const v = props.value;
  return v == null || v === "" || v === "—";
});

// Strings that are not plain numbers ("1.2 s", "3 / 5") count as above zero.
const isAboveZero = computed(() => {
  if (isUnknown.value) return false;
  const n = Number(props.value);
  return Number.isNaN(n) || n > 0;
});

const tone = computed(() => TONES[isAboveZero.value ? props.tone : "neutral"] ?? TONES.neutral);

const displayValue = computed(() => {
  const v = props.value;
  if (isUnknown.value) return "—";
  return props.compactValue && typeof v === "number" ? formatCompactCount(v) : String(v);
});

const exactValue = computed(() => {
  const v = props.value;
  return props.compactValue && typeof v === "number" && String(v) !== displayValue.value
    ? raw(v.toLocaleString())
    : undefined;
});

const fillPct = computed(() => {
  if (props.loading || !isAboveZero.value || props.max == null || props.max <= 0) return 0;
  const n = Number(props.value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, (n / props.max) * 100));
});

const rootClasses = computed(() => [
  "relative flex min-w-0 flex-col gap-1.75 rounded-default border bg-surface-base px-3 pt-2 pb-2.25 text-left text-compact",
  props.selected ? "border-accent ring-1 ring-accent ring-inset" : "border-border-default",
  props.clickable
    ? [
        "cursor-pointer transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring-accent",
        props.selected ? "" : "hover:border-accent/50",
      ]
    : "",
]);

const valueClasses = computed(() => [
  "shrink-0 font-semibold whitespace-nowrap tabular-nums",
  props.size === "lg" ? "text-2xl leading-8" : "text-xl leading-7",
  isAboveZero.value ? tone.value.value : "text-text-muted",
]);
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    :aria-pressed="clickable ? String(selected) : undefined"
    :class="rootClasses"
    :data-test="dataTest"
  >
    <OTooltip v-if="hint && clickable" :content="hint" />
    <div class="flex min-w-0 items-center gap-2">
      <div
        class="flex min-w-0 flex-1"
        :class="stacked ? 'flex-col items-start' : 'items-baseline gap-1.5'"
      >
        <span :class="valueClasses" data-test="o-stat-card-value">
          <OSkeleton
            v-if="loading"
            class="my-1"
            :class="size === 'lg' ? 'h-6 w-12' : 'h-5 w-10'"
            data-test="o-stat-card-value-skeleton"
          />
          <slot v-else name="value">{{ displayValue }}</slot>
          <OTooltip v-if="exactValue && !loading" :content="exactValue" />
        </span>
        <OTruncatedText
          v-if="label"
          :lines="2"
          class="text-text-secondary text-xs font-medium"
          data-test="o-stat-card-label"
          >{{ label }}</OTruncatedText
        >
        <OIcon
          v-if="sub && subIcon"
          :name="subIcon"
          size="xs"
          :label="sub"
          class="text-text-secondary shrink-0 self-center"
          data-test="o-stat-card-sub-icon"
        >
          <OTooltip :content="subTooltip || sub" />
        </OIcon>
        <OTruncatedText v-else-if="sub" class="text-text-muted text-xs">{{ sub }}</OTruncatedText>
      </div>
      <span
        v-if="delta"
        class="shrink-0 text-xs font-medium whitespace-nowrap"
        :class="DELTA_TONE[delta.tone ?? 'neutral']"
        data-test="o-stat-card-delta"
        >{{ DELTA_ARROW[delta.direction] }} {{ delta.label }}</span
      >
      <span
        v-if="icon || slots.icon"
        class="rounded-default grid size-6 shrink-0 place-items-center"
        :class="tone.chip"
        data-test="o-stat-card-icon"
      >
        <slot name="icon">
          <OIcon v-if="icon" :name="icon" size="sm" />
        </slot>
      </span>
    </div>
    <div class="bg-surface-subtle h-0.75 overflow-hidden rounded-full" aria-hidden="true">
      <div
        class="h-full rounded-full transition-[width] duration-300"
        :class="tone.bar"
        :style="{ width: `${fillPct}%` }"
        data-test="o-stat-card-fill"
      />
    </div>
    <div v-if="slots.chart" class="min-w-0">
      <slot name="chart" />
    </div>
  </component>
</template>
