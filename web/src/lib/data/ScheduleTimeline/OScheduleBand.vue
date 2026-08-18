<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// One span on a schedule track. Focusable and `role="img"` with a real
// accessible name, because "who is on call between 09:00 and 17:00" is the
// content of the screen, not decoration around it.

import { computed } from "vue";
import type {
  ScheduleBandProps,
  ScheduleBandTone,
  ScheduleBandVariant,
} from "./OScheduleTimeline.types";

/// Tone says WHICH row this belongs to; variant says what KIND of span it is.
/// Kept as three literal maps rather than one built from the tone number:
/// Tailwind reads class names as literal text, so a template-built
/// `bg-schedule-band-${n}-solid-bg` produces no CSS and an invisible band.
const SOFT_CLASS: Record<ScheduleBandTone, string> = {
  1: "bg-schedule-band-1-bg text-schedule-band-1-text",
  2: "bg-schedule-band-2-bg text-schedule-band-2-text",
  3: "bg-schedule-band-3-bg text-schedule-band-3-text",
  4: "bg-schedule-band-4-bg text-schedule-band-4-text",
  5: "bg-schedule-band-5-bg text-schedule-band-5-text",
  6: "bg-schedule-band-6-bg text-schedule-band-6-text",
  gap: "bg-schedule-gap-bg text-schedule-gap-text border border-dashed border-schedule-gap-border",
  // Solid, not the pale ramp: a coverage bar is read for its exceptions, and a
  // 50-tint span against a white card is indistinguishable from empty track.
  covered: "bg-badge-success-solid-bg text-badge-success-solid-text",
  partial: "bg-badge-warning-solid-bg text-badge-warning-solid-text",
};

const SOLID_CLASS: Partial<Record<ScheduleBandTone, string>> = {
  1: "bg-schedule-band-1-solid-bg text-schedule-band-solid-text",
  2: "bg-schedule-band-2-solid-bg text-schedule-band-solid-text",
  3: "bg-schedule-band-3-solid-bg text-schedule-band-solid-text",
  4: "bg-schedule-band-4-solid-bg text-schedule-band-solid-text",
  5: "bg-schedule-band-5-solid-bg text-schedule-band-solid-text",
  6: "bg-schedule-band-6-solid-bg text-schedule-band-solid-text",
};

const OUTLINE_CLASS: Partial<Record<ScheduleBandTone, string>> = {
  1: "bg-surface-base text-schedule-band-1-text border border-schedule-band-1-border",
  2: "bg-surface-base text-schedule-band-2-text border border-schedule-band-2-border",
  3: "bg-surface-base text-schedule-band-3-text border border-schedule-band-3-border",
  4: "bg-surface-base text-schedule-band-4-text border border-schedule-band-4-border",
  5: "bg-surface-base text-schedule-band-5-text border border-schedule-band-5-border",
  6: "bg-surface-base text-schedule-band-6-text border border-schedule-band-6-border",
};

const VARIANT_MAP: Record<ScheduleBandVariant, Partial<Record<ScheduleBandTone, string>>> = {
  soft: SOFT_CLASS,
  solid: SOLID_CLASS,
  outline: OUTLINE_CLASS,
};

const props = defineProps<ScheduleBandProps>();

/// `gap` has exactly one treatment. It is the alarming value, and painting it
/// solid or hollow on request would let a call site make "nobody is on call"
/// look like an ordinary shift.
const toneClass = computed(() => {
  const tone = props.band.tone;
  if (tone === "gap") return SOFT_CLASS.gap;
  const variant = props.band.variant ?? "soft";
  return VARIANT_MAP[variant][tone] ?? SOFT_CLASS[tone];
});

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

// Clamped so a band computed from a rotation longer than the visible window
// cannot run past the track and push the rest of the row off screen.
const offset = computed(() => clamp01(props.band.offset));
const width = computed(() => clamp01(props.band.width));

const geometry = computed(() => ({
  insetInlineStart: `${offset.value * 100}%`,
  width: `${width.value * 100}%`,
}));
</script>

<template>
  <div
    role="img"
    tabindex="0"
    :aria-label="band.ariaLabel"
    :class="[
      'absolute inset-y-0 flex items-center overflow-hidden',
      'rounded-default px-1.5 text-2xs leading-none font-medium whitespace-nowrap',
      'focus-visible:ring-badge-focus-ring focus-visible:ring-2 focus-visible:outline-none',
      toneClass,
    ]"
    :style="geometry"
    :data-test="`o2-schedule-band-${band.key}`"
    :data-tone="String(band.tone)"
    :data-variant="band.variant ?? 'soft'"
  >
    {{ band.label }}
  </div>
</template>
