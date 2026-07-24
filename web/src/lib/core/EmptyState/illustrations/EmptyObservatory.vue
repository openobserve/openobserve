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
  EmptyObservatory — a richer radar: rings + crosshair, a continuously rotating
  sweep, several blips that ping at staggered times and positions, data chips
  drifting upward at the edges, and a sparkle. Pure SMIL, token colors,
  `animated` gate.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.scanningForData')"
  >
    <ellipse cx="104" cy="80" rx="92" ry="58" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- rings + crosshair -->
    <circle cx="104" cy="80" r="20" stroke="var(--color-border-default)" stroke-width="1.5" />
    <circle cx="104" cy="80" r="40" stroke="var(--color-border-default)" stroke-width="1.5" />
    <circle
      cx="104"
      cy="80"
      r="60"
      stroke="var(--color-border-default)"
      stroke-width="1.5"
      opacity="0.7"
    />
    <line
      x1="44"
      y1="80"
      x2="164"
      y2="80"
      stroke="var(--color-border-default)"
      stroke-width="1"
      opacity="0.5"
    />
    <line
      x1="104"
      y1="20"
      x2="104"
      y2="140"
      stroke="var(--color-border-default)"
      stroke-width="1"
      opacity="0.5"
    />

    <!-- rotating sweep -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 80;360 104 80"
        dur="4s"
        repeatCount="indefinite"
      />
      <path
        d="M104 80 L164 80 A60 60 0 0 0 146 37.6 Z"
        fill="var(--color-primary-500)"
        opacity="0.16"
      />
      <line
        x1="104"
        y1="80"
        x2="164"
        y2="80"
        stroke="var(--color-primary-500)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </g>

    <!-- blips pinging at staggered times -->
    <circle v-for="(p, i) in blips" :key="'b' + i" :cx="p.x" :cy="p.y" r="3" :fill="p.fill">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;0;1;0"
        :keyTimes="`0;${p.t};${p.t + 0.05};${p.t + 0.4}`"
        dur="4s"
        repeatCount="indefinite"
      />
      <animate
        v-if="animated"
        attributeName="r"
        values="3;3;7;3"
        :keyTimes="`0;${p.t};${p.t + 0.05};${p.t + 0.4}`"
        dur="4s"
        repeatCount="indefinite"
      />
    </circle>

    <!-- data chips drifting up at the edges -->
    <g v-for="(c, i) in chips" :key="'c' + i" :transform="`translate(${c.x} ${c.y})`">
      <g>
        <animateTransform
          v-if="animated"
          attributeName="transform"
          type="translate"
          values="0 8;0 -10"
          :dur="c.dur"
          :begin="c.begin"
          repeatCount="indefinite"
        />
        <animate
          v-if="animated"
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.2;0.7;1"
          :dur="c.dur"
          :begin="c.begin"
          repeatCount="indefinite"
        />
        <rect
          x="-10"
          y="-6"
          width="20"
          height="12"
          rx="3"
          fill="var(--color-surface-base)"
          stroke="var(--color-border-strong)"
          stroke-width="1.25"
        />
        <circle cx="-4" cy="0" r="2" fill="var(--color-primary-500)" />
        <rect
          x="0"
          y="-1.5"
          width="7"
          height="3"
          rx="1.5"
          fill="var(--color-border-strong)"
          opacity="0.5"
        />
      </g>
    </g>

    <!-- center hub -->
    <circle cx="104" cy="80" r="6" fill="var(--color-primary-600)" />

    <!-- sparkle -->
    <g transform="translate(40 38)">
      <path
        d="M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5 Z"
        fill="var(--color-primary-400)"
      >
        <animate
          v-if="animated"
          attributeName="opacity"
          values="0.2;1;0.2"
          dur="2.6s"
          repeatCount="indefinite"
        />
        <animateTransform
          v-if="animated"
          attributeName="transform"
          type="scale"
          values="0.6;1.1;0.6"
          dur="2.6s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 208, animated: true });

// t = fraction of the 4s loop when each blip lights up (roughly as the sweep passes)
const blips = [
  { x: 132, y: 54, t: 0.12, fill: "var(--color-primary-600)" },
  { x: 140, y: 96, t: 0.34, fill: "var(--color-primary-500)" },
  { x: 76, y: 102, t: 0.62, fill: "var(--color-primary-400)" },
  { x: 70, y: 60, t: 0.84, fill: "var(--color-primary-500)" },
];

const chips = [
  { x: 30, y: 112, dur: "5s", begin: "0s" },
  { x: 180, y: 116, dur: "6s", begin: "2.2s" },
];
</script>
