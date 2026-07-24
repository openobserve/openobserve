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
  EmptyDataScene — the richest of the set: a live dashboard card (oscillating
  bars + a self-drawing sparkline) flanked by floating stat chips that bob, an
  orbiting dot, sonar pulse, and sparkles. Lots happening, layered by depth.
  Pure SMIL, token colors, `animated` gate.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.dataScene.ariaLabel')"
  >
    <ellipse cx="104" cy="82" rx="94" ry="58" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- floating stat chips behind the card -->
    <g transform="translate(34 56)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        additive="sum"
        values="0 0;0 -6;0 0"
        dur="4.2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        keyTimes="0;0.5;1"
      />
      <rect
        x="-16"
        y="-13"
        width="32"
        height="26"
        rx="6"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-default)"
        stroke-width="1.5"
      />
      <rect
        x="-9"
        y="-6"
        width="14"
        height="4"
        rx="2"
        fill="var(--color-border-strong)"
        opacity="0.5"
      />
      <rect x="-9" y="2" width="18" height="5" rx="2.5" fill="var(--color-primary-500)" />
    </g>
    <g transform="translate(176 96)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        additive="sum"
        values="0 0;0 -7;0 0"
        dur="3.6s"
        begin="0.5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        keyTimes="0;0.5;1"
      />
      <rect
        x="-15"
        y="-12"
        width="30"
        height="24"
        rx="6"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-default)"
        stroke-width="1.5"
      />
      <circle cx="-6" cy="0" r="5" fill="var(--color-primary-400)" />
      <rect
        x="2"
        y="-2.5"
        width="10"
        height="5"
        rx="2.5"
        fill="var(--color-border-strong)"
        opacity="0.45"
      />
    </g>

    <!-- main dashboard card -->
    <rect
      x="58"
      y="40"
      width="92"
      height="78"
      rx="11"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="1.5"
    />
    <!-- header -->
    <rect
      x="68"
      y="50"
      width="30"
      height="5"
      rx="2.5"
      fill="var(--color-border-strong)"
      opacity="0.55"
    />
    <circle cx="140" cy="52.5" r="2.5" fill="var(--color-border-strong)" opacity="0.5" />
    <circle cx="132" cy="52.5" r="2.5" fill="var(--color-border-strong)" opacity="0.5" />
    <line x1="58" y1="62" x2="150" y2="62" stroke="var(--color-border-default)" stroke-width="1" />

    <!-- live bars (lower-left) -->
    <rect
      v-for="(bar, i) in bars"
      :key="'bar' + i"
      :x="bar.x"
      :y="108 - bar.lo"
      width="8"
      :height="bar.lo"
      rx="2"
      :fill="bar.fill"
    >
      <animate
        v-if="animated"
        attributeName="height"
        :values="bar.h"
        :dur="bar.dur"
        :begin="bar.begin"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        keyTimes="0;0.5;1"
      />
      <animate
        v-if="animated"
        attributeName="y"
        :values="bar.y"
        :dur="bar.dur"
        :begin="bar.begin"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        keyTimes="0;0.5;1"
      />
    </rect>

    <!-- self-drawing sparkline (lower-right) -->
    <polyline
      points="108,98 118,90 126,94 134,82 142,88"
      fill="none"
      stroke="var(--color-primary-400)"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-dasharray="90"
    >
      <animate
        v-if="animated"
        attributeName="stroke-dashoffset"
        values="90;0;0;90"
        keyTimes="0;0.5;0.85;1"
        dur="4s"
        repeatCount="indefinite"
      />
    </polyline>
    <circle cx="134" cy="82" r="3" fill="var(--color-primary-500)">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;0;1;1;0"
        keyTimes="0;0.45;0.5;0.85;1"
        dur="4s"
        repeatCount="indefinite"
      />
    </circle>

    <!-- orbiting dot around the card -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 79;360 104 79"
        dur="9s"
        repeatCount="indefinite"
      />
      <circle cx="104" cy="14" r="4.5" fill="var(--color-primary-500)" />
    </g>

    <!-- sparkles -->
    <g v-for="(s, i) in sparkles" :key="'s' + i" :transform="`translate(${s.x} ${s.y})`">
      <path
        d="M0 -5.5 L1.4 -1.4 L5.5 0 L1.4 1.4 L0 5.5 L-1.4 1.4 L-5.5 0 L-1.4 -1.4 Z"
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
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 208, animated: true });

const BASE = 108;
const mk = (x: number, lo: number, hi: number, dur: string, begin: string, fill: string) => ({
  x,
  lo,
  fill,
  dur,
  begin,
  h: `${lo};${hi};${lo}`,
  y: `${BASE - lo};${BASE - hi};${BASE - lo}`,
});
const bars = [
  mk(70, 10, 26, "1.7s", "0s", "var(--color-primary-400)"),
  mk(82, 16, 38, "2s", "0.25s", "var(--color-primary-500)"),
  mk(94, 12, 30, "1.5s", "0.45s", "var(--color-primary-600)"),
];

const sparkles = [
  { x: 44, y: 110, dur: "2.6s", begin: "0s" },
  { x: 164, y: 40, dur: "3s", begin: "1.1s" },
];
</script>
