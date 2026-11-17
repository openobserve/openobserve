<script setup lang="ts">
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
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
// accent BORDER. Value is shown verbatim unless `compactValue` — pass "—" for
// "no data"; a real 0 renders as "0". OStatStrip picks `variant`: `chip` for a
// filter, `kpi` for a flat inline stat; `card` is the default tile.

import { computed, useSlots } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { StatCardVariant, StatTone, StatTrend } from "./OStatStrip.types";
import { formatCompactCount } from "@/utils/formatters";
import useBreakpoint from "@/composables/useBreakpoint";

const { lgUp } = useBreakpoint();
const { t } = useI18nTyped();

const props = withDefaults(
  defineProps<{
    /** Puts the label under the value, so a narrow tile keeps its full label. */
    stacked?: boolean;
    label?: I18nText;
    value?: string | number;
    /**
     * Short qualifier shown beside the label — what the value IS, when the
     * label alone is ambiguous (e.g. "wait time" under a generic "Database
     * time"). Not a second metric and never a trend.
     */
    sub?: I18nText;
    /** Render the qualifier as this glyph; `sub` becomes its accessible name and default tooltip. */
    subIcon?: IconName;
    /** The glyph's tooltip when it should say more than `sub`. */
    subTooltip?: I18nText;
    icon?: IconName;
    tone?: StatTone;
    trend?: StatTrend;
    /** Denominator for the proportion bar (this stat's share of the whole). */
    max?: number;
    /** Show a numeric value as "819.5K"; the exact number moves to the tooltip. */
    compactValue?: boolean;
    /** Render as a button with hover feedback (e.g. a filter tile). */
    clickable?: boolean;
    /** Active-filter state. */
    selected?: boolean;
    /** A selected chip that only means "unfiltered": pressed, but without the accent a real filter gets. */
    quiet?: boolean;
    /** What clicking the chip does, when the strip knows better than "show only". */
    hint?: I18nText;
    /** Set by OStatStrip: `chip` for a filter toggle, `kpi` for a flat inline stat. */
    variant?: StatCardVariant;
    /** Placeholder for the value until it first arrives; a 0 shown meanwhile reads as a real count. */
    loading?: boolean;
    dataTest?: string;
  }>(),
  {
    tone: "neutral",
    clickable: false,
    selected: false,
    quiet: false,
    variant: "card",
    loading: false,
    compactValue: false,
  },
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
  if (v === "" || v == null || v === "—") return "—";
  return props.compactValue && typeof v === "number" ? formatCompactCount(v) : v;
});
const exactTitle = computed(() => {
  const v = props.value;
  return props.compactValue && typeof v === "number" && String(v) !== displayValue.value
    ? raw(v.toLocaleString())
    : undefined;
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
// Zero dims the glyph; neutral takes the label ink; any other tone colours it.
const chipGlyphClass = computed(() => {
  if (isMuted.value) return "text-text-muted";
  return props.tone === "neutral" ? "text-text-label" : tc.value.value;
});
// Only a non-zero problem count earns a coloured badge; the selected chip's badge follows the accent.
const chipBadgeClass = computed(() => {
  if (props.selected && !props.quiet)
    return "bg-badge-primary-soft-bg text-badge-primary-soft-text font-semibold";
  if (isMuted.value) return "bg-surface-subtle text-table-row-text-secondary-tinted font-medium";
  if (props.tone === "error" || props.tone === "orange")
    return "bg-badge-error-soft-bg text-badge-error-soft-text font-semibold";
  if (props.tone === "warning")
    return "bg-badge-warning-soft-bg text-badge-warning-soft-text font-semibold";
  return "bg-surface-subtle text-text-heading font-semibold";
});
const chipTooltip = computed(() => {
  if (props.hint) return props.hint;
  return props.clickable && !props.selected && props.label
    ? t("components.statStrip.showOnly", { label: props.label })
    : undefined;
});
// An inline KPI stays neutral unless it reports a problem.
const kpiGlyphClass = computed(() => {
  if (isMuted.value) return "text-text-muted";
  return ["warning", "error", "orange"].includes(props.tone) ? tc.value.value : "text-text-label";
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
    :aria-pressed="clickable ? String(selected) : undefined"
    class="flex min-w-0 text-left transition-colors"
    :class="[
      variant === 'chip'
        ? [
            'rounded-default text-compact focus-visible:outline-accent h-8 shrink-0 items-center gap-1.5 border px-2.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-1',
            selected && !quiet
              ? 'border-accent bg-surface-accent-hover'
              : [
                  'border-border-default bg-surface-base',
                  clickable ? 'hover:bg-surface-accent-hover' : '',
                ],
          ]
        : variant === 'kpi'
          ? 'h-5 shrink-0 items-center gap-1.5 whitespace-nowrap'
          : [
              'rounded-default bg-surface-base flex-col justify-center gap-1 overflow-hidden border px-2.5 py-1 max-lg:px-1.5',
              selected ? 'border-accent' : 'border-border-default',
              clickable && !selected ? 'hover:border-accent' : '',
            ],
      clickable ? 'cursor-pointer' : '',
    ]"
    :title="label && !lgUp && variant === 'card' ? String(label) : undefined"
    :data-test="dataTest"
  >
    <template v-if="variant === 'chip'">
      <span
        v-if="icon || slots.icon"
        class="flex size-4 shrink-0 items-center justify-center"
        :class="chipGlyphClass"
        aria-hidden="true"
        data-test="o-stat-card-glyph"
      >
        <slot name="icon">
          <OIcon v-if="icon" :name="icon" size="sm" />
        </slot>
      </span>
      <span
        v-else
        class="size-1.5 shrink-0 rounded-full"
        :class="tc.bar"
        aria-hidden="true"
        data-test="o-stat-card-dot"
      />
      <!-- The hidden semibold copy reserves the selected width, so selecting a chip never shifts its neighbours. -->
      <span
        v-if="label"
        class="inline-flex min-w-0 flex-col leading-5 whitespace-nowrap after:invisible after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]"
        :data-label="label"
      >
        <OTruncatedText
          :class="
            selected
              ? 'text-text-heading font-semibold'
              : 'text-table-row-text-secondary-tinted font-medium'
          "
          data-test="o-stat-card-label"
          >{{ label }}</OTruncatedText
        >
      </span>
      <span
        class="text-2xs inline-flex h-4.5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 leading-none whitespace-nowrap tabular-nums"
        :class="chipBadgeClass"
        data-test="o-stat-card-value"
      >
        <OSkeleton
          v-if="loading"
          type="text"
          class="block h-2.5 w-3"
          data-test="o-stat-card-value-skeleton"
        />
        <slot v-else name="value">{{ displayValue }}</slot>
        <OTooltip v-if="exactTitle" :content="exactTitle" />
      </span>
      <OTooltip v-if="chipTooltip" :content="chipTooltip" />
    </template>
    <template v-else-if="variant === 'kpi'">
      <span
        v-if="icon || slots.icon"
        class="flex size-4 shrink-0 items-center justify-center"
        :class="kpiGlyphClass"
        aria-hidden="true"
        data-test="o-stat-card-glyph"
      >
        <slot name="icon">
          <OIcon v-if="icon" :name="icon" size="sm" />
        </slot>
      </span>
      <span
        class="inline-flex h-5 items-center text-base leading-5 tabular-nums"
        :class="isMuted ? 'text-text-muted font-medium' : 'text-text-heading font-semibold'"
        data-test="o-stat-card-value"
      >
        <OSkeleton
          v-if="loading"
          type="text"
          class="block h-4 w-8"
          data-test="o-stat-card-value-skeleton"
        />
        <slot v-else name="value">{{ displayValue }}</slot>
        <OTooltip v-if="exactTitle" :content="exactTitle" />
      </span>
      <OTruncatedText
        v-if="label"
        class="text-text-secondary text-compact leading-5 font-medium"
        data-test="o-stat-card-label"
        >{{ label }}</OTruncatedText
      >
      <span
        v-if="trend"
        class="text-2xs inline-flex h-5 shrink-0 items-center font-semibold"
        :class="trendClass"
        >{{ trendArrow }} {{ trend.label }}</span
      >
      <OIcon
        v-if="sub && subIcon"
        :name="subIcon"
        size="xs"
        :label="sub"
        class="text-text-label size-3.5! shrink-0 self-center"
        data-test="o-stat-card-sub-icon"
      >
        <OTooltip :content="subTooltip || sub" />
      </OIcon>
      <OTruncatedText v-else-if="sub" class="text-text-label text-2xs leading-5">{{
        sub
      }}</OTruncatedText>
    </template>
    <template v-else>
      <div class="flex min-w-0 items-center justify-between gap-2">
        <div
          class="flex min-w-0"
          :class="stacked ? 'flex-col items-start gap-1' : 'items-baseline gap-1.5'"
        >
          <!-- The VALUE never shrinks: it is the payload, and a clipped "499.51…" is
               a useless number. When the tile is too narrow (5 tiles on a laptop),
               the squeeze is absorbed by the label, which truncates but stays: a
               bare number under an icon does not say which metric it is. -->
          <span
            class="shrink-0 text-2xl leading-none font-semibold whitespace-nowrap tabular-nums max-lg:text-lg"
            :class="isMuted ? 'text-text-muted' : tc.value"
          >
            <OSkeleton
              v-if="loading"
              type="text"
              class="block h-6 w-12 max-lg:h-4.5 max-lg:w-6"
              data-test="o-stat-card-value-skeleton"
            />
            <slot v-else name="value">{{ displayValue }}</slot>
            <OTooltip v-if="exactTitle" :content="exactTitle" />
          </span>
          <OTruncatedText v-if="label" class="text-text-secondary text-xs font-medium">{{
            label
          }}</OTruncatedText>
          <span
            v-if="trend"
            class="text-2xs shrink-0 font-semibold max-lg:hidden"
            :class="trendClass"
            >{{ trendArrow }} {{ trend.label }}</span
          >
          <!-- A QUALIFIER on the value, not a second metric: it says what the
               number IS (which measurement, whose count), so a tile under a
               generic heading cannot be read as the wrong quantity. Truncates
               before the value does — the value never shrinks. -->
          <OIcon
            v-if="sub && subIcon"
            :name="subIcon"
            size="xs"
            :label="sub"
            class="text-text-label self-center max-lg:hidden"
            data-test="o-stat-card-sub-icon"
          >
            <OTooltip :content="subTooltip || sub" />
          </OIcon>
          <OTruncatedText v-else-if="sub" class="text-text-label text-2xs max-lg:hidden">{{
            sub
          }}</OTruncatedText>
        </div>
        <span
          v-if="icon || slots.icon"
          class="rounded-default grid h-7 w-7 shrink-0 place-items-center max-lg:h-6 max-lg:w-6"
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
    </template>
  </component>
</template>
