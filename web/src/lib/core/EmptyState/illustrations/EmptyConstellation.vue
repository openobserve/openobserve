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
  EmptyConstellation — a busy-but-balanced orbital scene: a pulsing core,
  sonar ripples, three orbit rings each carrying dots/chips at different speeds
  and directions, plus twinkling sparkles. Many elements moving at once, layered
  by opacity so it reads rich, not noisy. Pure SMIL, token colors, `animated`.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Waiting for data"
  >
    <ellipse cx="104" cy="80" rx="92" ry="58" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- sonar ripples from the core -->
    <circle
      v-for="(b, i) in ['0s', '1.5s']"
      :key="'r' + i"
      cx="104"
      cy="80"
      r="14"
      fill="none"
      stroke="var(--color-primary-500)"
      stroke-width="1.5"
    >
      <animate
        v-if="animated"
        attributeName="r"
        values="14;64"
        dur="3s"
        :begin="b"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.2 0.6 0.3 1"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.4;0"
        dur="3s"
        :begin="b"
        repeatCount="indefinite"
      />
    </circle>

    <!-- orbit guides -->
    <circle
      cx="104"
      cy="80"
      r="32"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      stroke-dasharray="2 5"
    />
    <circle
      cx="104"
      cy="80"
      r="50"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      stroke-dasharray="2 5"
      opacity="0.8"
    />
    <circle
      cx="104"
      cy="80"
      r="66"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      stroke-dasharray="2 5"
      opacity="0.55"
    />

    <!-- ring 1 (inner) — clockwise -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 80;360 104 80"
        dur="6s"
        repeatCount="indefinite"
      />
      <circle cx="136" cy="80" r="6" fill="var(--color-primary-500)" />
      <circle cx="72" cy="80" r="3.5" fill="var(--color-primary-300)" />
    </g>

    <!-- ring 2 (middle) — counter-clockwise, carries a data chip -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="360 104 80;0 104 80"
        dur="9s"
        repeatCount="indefinite"
      />
      <circle cx="154" cy="80" r="5" fill="var(--color-primary-400)" />
      <g transform="translate(54 80)">
        <rect
          x="-9"
          y="-6"
          width="18"
          height="12"
          rx="3"
          fill="var(--color-surface-base)"
          stroke="var(--color-border-strong)"
          stroke-width="1.25"
        />
        <circle cx="-3" cy="0" r="1.8" fill="var(--color-primary-500)" />
        <rect
          x="1"
          y="-1.5"
          width="6"
          height="3"
          rx="1.5"
          fill="var(--color-border-strong)"
          opacity="0.5"
        />
      </g>
    </g>

    <!-- ring 3 (outer) — clockwise, slow -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 80;360 104 80"
        dur="14s"
        repeatCount="indefinite"
      />
      <circle cx="170" cy="80" r="4" fill="var(--color-primary-300)" />
      <circle cx="38" cy="80" r="3" fill="var(--color-primary-400)" />
    </g>

    <!-- central node -->
    <circle
      cx="104"
      cy="80"
      r="15"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="1.5"
    />
    <circle cx="104" cy="80" r="6" fill="var(--color-primary-600)">
      <animate
        v-if="animated"
        attributeName="r"
        values="6;8;6"
        dur="2.4s"
        repeatCount="indefinite"
      />
    </circle>

    <!-- twinkling sparkles -->
    <g v-for="(s, i) in sparkles" :key="'s' + i" :transform="`translate(${s.x} ${s.y})`">
      <path
        d="M0 -6 L1.5 -1.5 L6 0 L1.5 1.5 L0 6 L-1.5 1.5 L-6 0 L-1.5 -1.5 Z"
        fill="var(--color-primary-400)"
      >
        <animate
          v-if="animated"
          attributeName="opacity"
          values="0.2;1;0.2"
          :dur="s.dur"
          :begin="s.begin"
          repeatCount="indefinite"
        />
        <animateTransform
          v-if="animated"
          attributeName="transform"
          type="scale"
          values="0.6;1.1;0.6"
          :dur="s.dur"
          :begin="s.begin"
          repeatCount="indefinite"
        />
      </path>
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 208, animated: true });

const sparkles = [
  { x: 40, y: 36, dur: "2.6s", begin: "0s" },
  { x: 168, y: 120, dur: "3.1s", begin: "0.8s" },
  { x: 158, y: 34, dur: "2.2s", begin: "1.4s" },
];
</script>
