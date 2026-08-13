<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// One span on a schedule track. Focusable and `role="img"` with a real
// accessible name, because "who is on call between 09:00 and 17:00" is the
// content of the screen, not decoration around it.

import { computed } from "vue";
import type { ScheduleBandProps, ScheduleBandTone } from "./OScheduleTimeline.types";

const props = defineProps<ScheduleBandProps>();

const TONE_CLASS: Record<ScheduleBandTone, string> = {
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
      TONE_CLASS[band.tone],
    ]"
    :style="geometry"
    :data-test="`o2-schedule-band-${band.key}`"
    :data-tone="String(band.tone)"
  >
    {{ band.label }}
  </div>
</template>
