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
  EmptyRadar — a radar dish sweeping for data: concentric rings, a continuously
  rotating sweep arm with a fading trail, and a blip that pings as the arm
  passes. Lots of continuous motion. Pure SMIL, token colors, `animated` gate.
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
    <ellipse cx="104" cy="80" rx="86" ry="56" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- rings -->
    <circle cx="104" cy="80" r="18" stroke="var(--color-border-default)" stroke-width="1.5" />
    <circle cx="104" cy="80" r="36" stroke="var(--color-border-default)" stroke-width="1.5" />
    <circle cx="104" cy="80" r="54" stroke="var(--color-border-default)" stroke-width="1.5" />
    <!-- crosshair -->
    <line
      x1="50"
      y1="80"
      x2="158"
      y2="80"
      stroke="var(--color-border-default)"
      stroke-width="1"
      opacity="0.6"
    />
    <line
      x1="104"
      y1="26"
      x2="104"
      y2="134"
      stroke="var(--color-border-default)"
      stroke-width="1"
      opacity="0.6"
    />

    <!-- rotating sweep -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 80;360 104 80"
        dur="3.6s"
        repeatCount="indefinite"
      />
      <path
        d="M104 80 L158 80 A54 54 0 0 0 142 41.8 Z"
        fill="var(--color-primary-500)"
        opacity="0.18"
      />
      <line
        x1="104"
        y1="80"
        x2="158"
        y2="80"
        stroke="var(--color-primary-500)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    </g>

    <!-- blips that ping -->
    <circle cx="134" cy="56" r="4" fill="var(--color-primary-600)">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;0;1;0"
        keyTimes="0;0.18;0.25;0.6"
        dur="3.6s"
        repeatCount="indefinite"
      />
      <animate
        v-if="animated"
        attributeName="r"
        values="3;3;6;3"
        keyTimes="0;0.18;0.25;0.6"
        dur="3.6s"
        repeatCount="indefinite"
      />
    </circle>
    <circle cx="76" cy="104" r="4" fill="var(--color-primary-400)">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;0;1;0"
        keyTimes="0;0.62;0.7;1"
        dur="3.6s"
        repeatCount="indefinite"
      />
      <animate
        v-if="animated"
        attributeName="r"
        values="3;3;6;3"
        keyTimes="0;0.62;0.7;1"
        dur="3.6s"
        repeatCount="indefinite"
      />
    </circle>

    <!-- center hub -->
    <circle cx="104" cy="80" r="5" fill="var(--color-primary-600)" />
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 208, animated: true });
</script>
