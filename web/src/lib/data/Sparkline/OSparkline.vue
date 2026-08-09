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

<!--
  OSparkline — a trend shape sized for a table cell.

  The whole component exists to get ONE thing right: a gap is not a zero. A
  `null` point breaks the line instead of dropping it to the baseline, because
  a shape that dives to zero says "this stopped happening" — and when the real
  reason is "this ranked below the top-N in that window", that misreading turns
  an ongoing incident into an apparent recovery.

  The SVG is drawn in an abstract unit box and stretched by CSS, so nothing here
  is a pixel measurement: `viewBox` units are a coordinate space, not a size.
-->
<template>
  <svg
    v-if="segments.length || bars.length"
    :viewBox="`0 0 ${VB_W} ${VB_H}`"
    preserveAspectRatio="none"
    role="img"
    :aria-label="ariaLabel"
    :class="['w-full', sizeClass, toneClass]"
    :data-test="dataTest ? `${dataTest}-sparkline` : undefined"
  >
    <template v-if="shape === 'bar'">
      <rect
        v-for="bar in bars"
        :key="bar.key"
        :x="bar.x"
        :y="bar.y"
        :width="bar.width"
        :height="bar.height"
        fill="currentColor"
        :opacity="bar.provisional ? 0.4 : 1"
      />
    </template>

    <template v-else>
      <!-- One path pair per unbroken run, so a gap leaves a real hole. -->
      <template v-for="segment in segments" :key="segment.key">
        <path :d="segment.area" fill="currentColor" opacity="0.14" />
        <path
          :d="segment.line"
          fill="none"
          stroke="currentColor"
          :stroke-width="STROKE"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </template>
    </template>
  </svg>
  <!-- Reserve the row height even with nothing to draw, so a table of
       sparklines never reflows as series arrive. -->
  <div v-else :class="['w-full', sizeClass]" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { SparklinePoint, SparklineProps } from "./OSparkline.types";

const props = withDefaults(defineProps<SparklineProps>(), {
  points: () => [],
  shape: "area",
  tone: "default",
  size: "xs",
});

/**
 * The SVG coordinate space. Not pixels — `preserveAspectRatio="none"` stretches
 * this box to whatever CSS sizes the element, so these are pure ratios.
 */
const VB_W = 100;
const VB_H = 24;
const STROKE = 1.6;
/** Keeps the stroke's round cap from clipping at the box edge. */
const PAD = STROKE;

const sizeClasses: Record<NonNullable<SparklineProps["size"]>, string> = {
  xs: "h-5",
  sm: "h-8",
};

// Matches OCoverageMeter's tone map, so a sparkline and the coverage read-out
// beside it never disagree about what "warning" looks like.
const toneClasses: Record<NonNullable<SparklineProps["tone"]>, string> = {
  default: "text-accent",
  success: "text-status-success-text",
  warning: "text-status-warning-text",
  danger: "text-status-error-text",
  neutral: "text-text-muted",
};

const sizeClass = computed(() => sizeClasses[props.size]);
const toneClass = computed(() => toneClasses[props.tone]);

/** Accept bare numbers for the common case, normalise to the point shape. */
const normalized = computed<SparklinePoint[]>(() =>
  props.points.map((point) =>
    point === null || typeof point === "number" ? { value: point } : point,
  ),
);

const scale = computed(() => {
  const values = normalized.value
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (!values.length) return null;

  const max = props.max !== undefined ? props.max : Math.max(...values);
  const min = Math.min(...values, 0);
  // A flat series has no range to divide by; centre it rather than dividing by
  // zero, which would put every point at the top of the box.
  const range = max - min || 1;
  const count = normalized.value.length;
  const stepX = count > 1 ? (VB_W - PAD * 2) / (count - 1) : 0;

  return {
    x: (index: number) => PAD + index * stepX,
    y: (value: number) => {
      const clamped = Math.min(Math.max(value, min), max);
      return PAD + (VB_H - PAD * 2) * (1 - (clamped - min) / range);
    },
    max,
    min,
    count,
  };
});

interface Segment {
  key: string;
  line: string;
  area: string;
}

/**
 * Split the series into unbroken runs at every `null`, then draw each run
 * independently. A single-point run still draws a dot-length dash so an
 * isolated observation is visible rather than silently dropped.
 */
const segments = computed<Segment[]>(() => {
  if (props.shape === "bar") return [];
  const s = scale.value;
  if (!s) return [];

  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  normalized.value.forEach((point, index) => {
    if (point.value === null || !Number.isFinite(point.value)) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, value: point.value });
  });
  if (run.length) runs.push(run);

  const baseline = VB_H - PAD;
  return runs.map((points, i) => {
    const coords = points.map((p) => [s.x(p.index), s.y(p.value)] as const);
    // A lone point has no line to draw — nudge it into a minimal segment.
    if (coords.length === 1) {
      const [x, y] = coords[0];
      const half = STROKE / 2;
      return {
        key: `run-${i}`,
        line: `M${(x - half).toFixed(2)},${y.toFixed(2)} L${(x + half).toFixed(2)},${y.toFixed(2)}`,
        area: "",
      };
    }
    const line = coords
      .map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    const first = coords[0];
    const last = coords[coords.length - 1];
    return {
      key: `run-${i}`,
      line,
      area: `${line} L${last[0].toFixed(2)},${baseline.toFixed(2)} L${first[0].toFixed(2)},${baseline.toFixed(2)} Z`,
    };
  });
});

interface Bar {
  key: string;
  x: string;
  y: string;
  width: string;
  height: string;
  provisional: boolean;
}

/** Bar mode: a missing point draws NO bar, which is visually distinct from a
    zero-height one at the baseline. */
const bars = computed<Bar[]>(() => {
  if (props.shape !== "bar") return [];
  const s = scale.value;
  if (!s) return [];

  const slot = VB_W / s.count;
  const width = slot * 0.68;
  const gap = (slot - width) / 2;
  const baseline = VB_H - PAD;

  return normalized.value.flatMap((point, index) => {
    if (point.value === null || !Number.isFinite(point.value)) return [];
    const y = s.y(point.value);
    // Always paint at least a sliver so a genuine zero reads as "measured, and
    // it was zero" rather than as a gap.
    const height = Math.max(baseline - y, 0.75);
    return [
      {
        key: `bar-${index}`,
        x: (index * slot + gap).toFixed(2),
        y: (baseline - height).toFixed(2),
        width: width.toFixed(2),
        height: height.toFixed(2),
        provisional: !!point.provisional,
      },
    ];
  });
});
</script>
