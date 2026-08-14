<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OScheduleTimeline — a stack of horizontal time tracks sharing one axis.
//
// The whole point of the primitive is that it owns the geometry: a caller hands
// over bands as 0–1 shares of the visible window and never computes a `left` or
// a `width` itself. Percentage positioning is genuinely data-driven, so it is a
// bound style HERE (the same seam OProgressBar uses) and nowhere else.
//
// Reused by the on-call calendar, the 7×24 coverage bar and the escalation
// ladder, which are the same drawing with different rows.

import { computed } from "vue";
import OScheduleBand from "./OScheduleBand.vue";
import type { ScheduleTimelineProps, ScheduleTimelineSlots } from "./OScheduleTimeline.types";

const props = withDefaults(defineProps<ScheduleTimelineProps>(), {
  dayColumns: () => [],
  axisTicks: () => [],
  nowOffset: null,
  labelWidth: "md",
});

defineSlots<ScheduleTimelineSlots>();

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

const LABEL_WIDTH_CLASS = {
  sm: "w-20",
  md: "w-32",
} as const;

const labelClass = computed(() => LABEL_WIDTH_CLASS[props.labelWidth]);

const guides = computed(() => props.dayColumns.map((offset) => clamp01(offset)));

const ticks = computed(() =>
  props.axisTicks.map((tick, index) => ({
    key: `${index}-${tick.offset}`,
    offset: clamp01(tick.offset),
    label: tick.label,
  })),
);

// null when the window does not contain the present — paging forward through a
// calendar must not pin the marker to an edge and imply "now" is there.
const now = computed(() => (props.nowOffset == null ? null : clamp01(props.nowOffset)));

const inlineStart = (offset: number) => ({ insetInlineStart: `${offset * 100}%` });
</script>

<template>
  <div class="flex flex-col gap-1" data-test="o2-schedule-timeline">
    <!-- Axis — labels sit above the plot area, aligned to the same 0-1 scale. -->
    <div v-if="ticks.length" class="flex items-end">
      <div :class="[labelClass, 'shrink-0']" />
      <div class="text-text-secondary relative h-4 min-w-0 flex-1 text-2xs">
        <span
          v-for="tick in ticks"
          :key="tick.key"
          class="absolute bottom-0 -translate-x-1/2 whitespace-nowrap"
          :style="inlineStart(tick.offset)"
          >{{ tick.label }}</span
        >
      </div>
    </div>

    <div
      v-for="track in tracks"
      :key="track.key"
      class="flex items-stretch gap-2"
      :data-test="`o2-schedule-track-${track.key}`"
    >
      <div :class="[labelClass, 'text-text-secondary flex shrink-0 items-center truncate text-xs']">
        {{ track.label }}
      </div>

      <div class="bg-surface-subtle rounded-default relative h-7 min-w-0 flex-1">
        <!-- Day / hour guides. Decorative, so no accessible name. -->
        <span
          v-for="(guide, index) in guides"
          :key="`guide-${index}`"
          class="border-border-default absolute inset-y-0 border-l"
          :style="inlineStart(guide)"
          aria-hidden="true"
        />

        <!-- An empty strip reads as "nobody, all week". When the row is empty
             because nothing was fetched for it, say that instead. -->
        <span
          v-if="track.note && !track.bands.length"
          class="text-text-muted absolute inset-0 flex items-center px-2 text-xs italic"
          :data-test="`o2-schedule-track-note-${track.key}`"
        >
          {{ track.note }}
        </span>

        <template v-for="band in track.bands" :key="band.key">
          <slot name="band" :band="band" :track="track">
            <OScheduleBand :band="band" />
          </slot>
        </template>

        <!-- Now marker, drawn over the bands so it is never hidden by one. -->
        <span
          v-if="now !== null"
          class="bg-accent absolute inset-y-0 z-1 w-px"
          :style="inlineStart(now)"
          :role="nowLabel ? 'img' : undefined"
          :aria-label="nowLabel"
          :aria-hidden="nowLabel ? undefined : 'true'"
          data-test="o2-schedule-timeline-now"
        />
      </div>
    </div>

    <div v-if="$slots.legend" class="flex flex-wrap items-center gap-2">
      <slot name="legend" />
    </div>
  </div>
</template>
