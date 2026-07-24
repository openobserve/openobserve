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
  EmptyWaveBars — a row of bars rising and falling like a live signal monitor,
  each on its own phase so the row ripples continuously. The most energetic of
  the set. Pure SMIL, token colors, `animated` gate. Good for "no metrics /
  streams yet".
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.waveBars.ariaLabel')"
  >
    <ellipse cx="104" cy="84" rx="86" ry="50" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- baseline -->
    <line x1="56" y1="116" x2="152" y2="116" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-linecap="round" opacity="0.7" />

    <!-- oscillating bars -->
    <g>
      <rect
        v-for="(bar, i) in bars"
        :key="i"
        :x="bar.x"
        :y="116 - bar.h0"
        width="12"
        :height="bar.h0"
        rx="3"
        :fill="bar.fill"
      >
        <animate v-if="animated" attributeName="height" :values="bar.heights" :dur="bar.dur" repeatCount="indefinite" :begin="bar.begin" calcMode="spline" :keySplines="splines" keyTimes="0;0.5;1" />
        <animate v-if="animated" attributeName="y" :values="bar.ys" :dur="bar.dur" repeatCount="indefinite" :begin="bar.begin" calcMode="spline" :keySplines="splines" keyTimes="0;0.5;1" />
      </rect>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 208, animated: true },
);

const BASE = 116;
const splines = "0.4 0 0.2 1;0.4 0 0.2 1";

// Each bar oscillates between a low and high height on its own duration/phase,
// so the row never lines up — reads as a living signal.
const defs = [
  { x: 60, lo: 14, hi: 40, dur: "1.6s", begin: "0s", fill: "var(--color-primary-400)" },
  { x: 78, lo: 22, hi: 58, dur: "1.9s", begin: "0.2s", fill: "var(--color-primary-500)" },
  { x: 96, lo: 18, hi: 70, dur: "1.5s", begin: "0.45s", fill: "var(--color-primary-600)" },
  { x: 114, lo: 24, hi: 52, dur: "2.1s", begin: "0.15s", fill: "var(--color-primary-500)" },
  { x: 132, lo: 12, hi: 38, dur: "1.7s", begin: "0.35s", fill: "var(--color-primary-400)" },
];

const bars = defs.map((d) => ({
  x: d.x,
  fill: d.fill,
  dur: d.dur,
  begin: d.begin,
  h0: d.lo,
  heights: `${d.lo};${d.hi};${d.lo}`,
  ys: `${BASE - d.lo};${BASE - d.hi};${BASE - d.lo}`,
}));
</script>
