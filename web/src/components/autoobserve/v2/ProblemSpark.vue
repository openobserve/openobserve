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

<template>
  <span class="flex-col gap-1" :class="{ 'sm:items-end': size !== 'card' }">
    <span
      role="img"
      :aria-label="t(chart.label)"
      class="relative block w-full"
      :class="[size === 'card' ? 'h-18' : 'h-9 sm:w-36', OUTCOME[outcome].ink]"
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        class="absolute inset-0 size-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient :id="fillId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.22" />
            <stop offset="1" stop-color="currentColor" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line
          v-if="limitY !== null"
          x1="0"
          x2="100"
          :y1="limitY"
          :y2="limitY"
          class="text-text-secondary"
          stroke="currentColor"
          stroke-dasharray="2 3"
          vector-effect="non-scaling-stroke"
        />
        <path :d="shape.area" :fill="`url(#${fillId})`" />
        <path :d="shape.line" v-bind="STROKE" />
        <path v-if="shape.forecast" :d="shape.forecast" v-bind="STROKE" stroke-dasharray="3 3" />
      </svg>
      <span
        v-if="action"
        class="bg-border-default absolute inset-y-0 w-px"
        :style="{ left: `${action.x}%` }"
      />
      <span class="absolute size-1.5 -translate-1/2 rounded-full bg-current" :style="at(detect)" />
      <span
        v-if="action"
        class="border-text-heading bg-surface-base absolute size-2 -translate-1/2 rounded-full border-2"
        :style="at(action)"
      />
      <span v-if="live" class="absolute size-2 -translate-1/2" :style="at(live)">
        <span
          class="absolute inset-0 rounded-full bg-current opacity-50 motion-safe:animate-ping"
        />
        <span class="absolute inset-0 rounded-full bg-current" />
      </span>
    </span>
    <span class="text-text-secondary text-xs tabular-nums sm:whitespace-nowrap">
      {{ t(chart.caption) }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { ProblemChart, ProblemOutcome } from "./fixtures";
import { OUTCOME } from "./outcome";

const props = defineProps<{
  chart: ProblemChart;
  outcome: ProblemOutcome;
  size?: "row" | "card";
}>();

const { t } = useI18nTyped();

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.5,
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
  "vector-effect": "non-scaling-stroke",
} as const;

// Room above the peak and below zero, so markers centred on the line never clip.
const TOP = 12;
const BOTTOM = 92;

const fillId = useId();

const top = computed(() => Math.max(...props.chart.points, props.chart.limit ?? 0) || 1);

// A capacity chart starts near its data, not at zero, so the climb toward the limit stays visible.
const floor = computed(() => {
  if (props.chart.limit === undefined) return 0;
  const low = Math.min(...props.chart.points);
  return Math.max(low - (top.value - low) * 0.25, 0);
});

const yOf = (value: number) =>
  BOTTOM - ((BOTTOM - TOP) * (value - floor.value)) / (top.value - floor.value || 1);

const point = (i: number) => {
  const { points } = props.chart;
  return { x: 2 + (96 * i) / Math.max(points.length - 1, 1), y: yOf(points[i]) };
};

const path = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, n) => {
    const { x, y } = point(from + n);
    return `${n ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");

const lastMeasured = computed(() => props.chart.points.length - 1 - props.chart.forecast);

const shape = computed(() => {
  const end = lastMeasured.value;
  const line = path(0, end);
  return {
    line,
    area: `${line} L${point(end).x.toFixed(2)},100 L${point(0).x.toFixed(2)},100 Z`,
    forecast: props.chart.forecast ? path(end, props.chart.points.length - 1) : "",
  };
});

const limitY = computed(() => (props.chart.limit === undefined ? null : yOf(props.chart.limit)));

const detect = computed(() => point(props.chart.detectedAt));

const action = computed(() =>
  props.chart.actionAt === undefined ? null : point(props.chart.actionAt),
);

const live = computed(() => (props.outcome === "active" ? point(lastMeasured.value) : null));

const at = (p: { x: number; y: number }) => ({ left: `${p.x}%`, top: `${p.y}%` });
</script>
