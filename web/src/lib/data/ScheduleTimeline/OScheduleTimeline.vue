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

import { computed, ref } from "vue";
import OScheduleBand from "./OScheduleBand.vue";
import type {
  ScheduleTimelineEmits,
  ScheduleTimelineProps,
  ScheduleTimelineSlots,
} from "./OScheduleTimeline.types";

const props = withDefaults(defineProps<ScheduleTimelineProps>(), {
  dayColumns: () => [],
  axisTicks: () => [],
  nowOffset: null,
  labelWidth: "md",
});

const emit = defineEmits<ScheduleTimelineEmits>();

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
    sublabel: tick.sublabel,
    emphasis: tick.emphasis,
  })),
);

// null when the window does not contain the present — paging forward through a
// calendar must not pin the marker to an edge and imply "now" is there.
const now = computed(() => (props.nowOffset == null ? null : clamp01(props.nowOffset)));

const inlineStart = (offset: number) => ({ insetInlineStart: `${offset * 100}%` });

/// Where the pointer is, as a share of the window — so a reader can ask "what
/// instant is THAT band under my cursor" without counting columns off the axis.
///
/// Held here rather than by the caller because it is geometry, which is this
/// component's job; the caller is handed the share and turns it into whatever
/// its window makes that mean.
const plotRef = ref<HTMLElement | null>(null);
const hover = ref<number | null>(null);

function onPointerMove(event: MouseEvent) {
  const el = plotRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;

  // Positioning is `inset-inline-start`, so under RTL the 0 end of the window
  // is the RIGHT edge. Measuring from `rect.left` regardless would run the
  // marker backwards on exactly the layouts nobody tests.
  const rtl = getComputedStyle(el).direction === "rtl";
  const share = rtl ? (rect.right - event.clientX) / rect.width : (event.clientX - rect.left) / rect.width;

  hover.value = clamp01(share);
  emit("hover", hover.value);
}

function onPointerLeave() {
  hover.value = null;
  emit("hover", null);
}

/// A pill centred on its line loses half of itself at the edges of the window —
/// the same clipping the axis ticks had. It sits beside the line instead, and
/// flips to the other side once there is no room on the right.
const pillSide = (offset: number) =>
  offset > 0.85 ? "-translate-x-full -ms-1.5" : "ms-1.5";
</script>

<template>
  <div class="flex flex-col gap-1" data-test="o2-schedule-timeline">
    <!-- The plot: axis and tracks share one coordinate space, and the markers
         below are drawn over the whole of it. The legend sits OUTSIDE, so the
         now line stops at the last lane rather than running through the key
         that explains it. -->
    <div
      ref="plotRef"
      class="relative flex flex-col gap-1"
      @mousemove="laneHeaders ? onPointerMove($event) : undefined"
      @mouseleave="laneHeaders ? onPointerLeave() : undefined"
    >
      <!-- A row kept clear for the marker pills, above the axis labels rather
           than on top of them. Always present, never only while hovering: a
           chart that grows a row under the pointer moves the very band the
           reader was trying to read. -->
      <div v-if="laneHeaders" class="h-6 shrink-0" aria-hidden="true" />

    <!-- Axis — labels sit above the plot area, aligned to the same 0-1 scale. -->
    <div v-if="ticks.length" class="flex items-end">
      <div v-if="!laneHeaders" :class="[labelClass, 'shrink-0']" />
      <div
        :class="[
          'text-text-secondary text-2xs relative min-w-0 flex-1',
          laneHeaders ? 'h-8' : 'h-4',
        ]"
      >
        <!-- Centred ticks need a gutter to hang their left half over. Lane mode
             removes it, so they are anchored to the boundary they mark — which
             is also where a day label belongs when it labels a COLUMN rather
             than a point. -->
        <span
          v-for="tick in ticks"
          :key="tick.key"
          :class="[
            'absolute bottom-0 flex flex-col whitespace-nowrap',
            laneHeaders ? '' : '-translate-x-1/2',
            tick.emphasis ? 'text-status-error-text font-medium' : '',
          ]"
          :style="inlineStart(tick.offset)"
        >
          <span>{{ tick.label }}</span>
          <span v-if="tick.sublabel" class="text-text-secondary font-normal">{{
            tick.sublabel
          }}</span>
        </span>
      </div>
    </div>

    <div
      v-for="track in tracks"
      :key="track.key"
      :class="laneHeaders ? 'flex flex-col gap-1.5' : 'flex items-stretch gap-2'"
      :data-test="`o2-schedule-track-${track.key}`"
    >
      <!-- Lane mode: the caller draws a full-width header above the strip. The
           gutter it replaces is removed, so the strip spans the whole row. -->
      <slot v-if="laneHeaders" name="track-header" :track="track" />
      <div
        v-else
        :class="[labelClass, 'text-text-secondary flex shrink-0 items-center truncate text-xs']"
      >
        {{ track.label }}
      </div>

      <!-- An empty strip is an answer, and usually the loudest one on the
           chart. When the caller has something to say about it, it says it
           INSTEAD of the strip rather than inside an otherwise blank one. -->
      <slot v-if="!track.bands.length && $slots['track-empty']" name="track-empty" :track="track" />

      <div
        v-else
        :class="[
          'bg-surface-subtle rounded-default relative h-7 min-w-0',
          laneHeaders ? 'w-full' : 'flex-1',
        ]"
      >
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

        <!-- Now marker, drawn over the bands so it is never hidden by one.
             Gutter mode only — lane mode draws one full-height line over every
             track instead, from the overlay below. -->
        <span
          v-if="now !== null && !laneHeaders"
          class="bg-accent absolute inset-y-0 z-1 w-px"
          :style="inlineStart(now)"
          :role="nowLabel ? 'img' : undefined"
          :aria-label="nowLabel"
          :aria-hidden="nowLabel ? undefined : 'true'"
          data-test="o2-schedule-timeline-now"
        />
      </div>
    </div>

    <!-- Full-height markers.
         LANE MODE ONLY: with no gutter the plot area IS this element's width,
         so one overlay spans every lane and the line reads as one line. In
         gutter mode the plot starts after the label column, and each strip
         still draws its own marker inside itself.

         `pointer-events-none` throughout: the lane headers underneath carry
         buttons, and a marker that ate their clicks would be a worse trade
         than no marker. -->
    <div v-if="laneHeaders" class="pointer-events-none absolute inset-0 z-2">
      <!-- Where the pointer is. Grey, because it answers "which instant am I
           looking at" — a question about the reader, not about the schedule. -->
      <template v-if="hover !== null">
        <span
          class="bg-border-strong absolute inset-y-0 w-px"
          :style="inlineStart(hover)"
          aria-hidden="true"
          data-test="o2-schedule-timeline-hover"
        />
        <span
          v-if="hoverLabel"
          :class="[
            'bg-text-secondary text-text-inverse rounded-default absolute top-0 px-1.5 py-0.5',
            'text-2xs font-medium whitespace-nowrap',
            pillSide(hover),
          ]"
          :style="inlineStart(hover)"
          aria-hidden="true"
          data-test="o2-schedule-timeline-hover-label"
        >
          {{ hoverLabel }}
        </span>
      </template>

      <!-- Now. Drawn last so it stays legible where the two cross, and always
           present: every instant on this chart is read relative to it. -->
      <template v-if="now !== null">
        <span
          class="bg-status-error-text absolute inset-y-0 z-1 w-px"
          :style="inlineStart(now)"
          :role="nowLabel ? 'img' : undefined"
          :aria-label="nowLabel"
          :aria-hidden="nowLabel ? undefined : 'true'"
          data-test="o2-schedule-timeline-now"
        />
        <span
          v-if="nowLabel"
          :class="[
            'bg-status-error-text text-text-inverse rounded-default absolute top-0 z-1 px-1.5 py-0.5',
            'text-2xs font-medium whitespace-nowrap',
            pillSide(now),
          ]"
          :style="inlineStart(now)"
          aria-hidden="true"
          data-test="o2-schedule-timeline-now-label"
        >
          {{ nowLabel }}
        </span>
      </template>
    </div>
    </div>

    <div v-if="$slots.legend" class="flex flex-wrap items-center gap-2">
      <slot name="legend" />
    </div>
  </div>
</template>
