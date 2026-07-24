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
  EmptyAlert — object-only "create your first alert" illustration: a notification
  bell that gently swings, with a pulsing badge. Pure SMIL motion gated behind
  `animated` (prefers-reduced-motion; OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Create your first alert"
  >
    <circle cx="120" cy="84" r="58" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="150" rx="54" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="34" cy="52" r="2" />
      <circle cx="206" cy="120" r="2" />
      <circle cx="202" cy="48" r="1.6" />
    </g>

    <!-- bell (swings) -->
    <g>
      <!-- swings around the top loop (pivot 120 48) -->
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="-7 120 48; 7 120 48; -7 120 48"
        keyTimes="0;0.5;1"
        dur="3.4s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <!-- top loop -->
      <path
        d="M114 50 Q114 43 120 43 Q126 43 126 50"
        stroke="var(--color-border-strong)"
        stroke-width="3"
        fill="none"
        stroke-linecap="round"
      />
      <!-- body -->
      <path
        d="M94 116 Q94 74 120 64 Q146 74 146 116 Z"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-strong)"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <!-- inner accent band -->
      <path
        d="M104 104 Q120 110 136 104"
        stroke="var(--color-primary-400)"
        stroke-width="2.5"
        fill="none"
        stroke-linecap="round"
      />
      <!-- rim -->
      <rect
        x="88"
        y="114"
        width="64"
        height="7"
        rx="3.5"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        stroke-width="2"
      />
      <!-- clapper -->
      <circle cx="120" cy="128" r="5.5" fill="var(--color-border-strong)" />
    </g>

    <!-- notification badge (pulses) -->
    <!-- scale about centre (146 58); the paired translate keeps that centre fixed -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; -20.44 -8.12; 0 0"
        keyTimes="0;0.5;1"
        dur="2.4s"
        repeatCount="indefinite"
        additive="sum"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="scale"
        values="1;1.14;1"
        keyTimes="0;0.5;1"
        dur="2.4s"
        repeatCount="indefinite"
        additive="sum"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <circle cx="146" cy="58" r="11" fill="var(--color-error-500)" />
      <line
        x1="146"
        y1="53"
        x2="146"
        y2="60"
        stroke="var(--color-white)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <circle cx="146" cy="64" r="1.6" fill="var(--color-white)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>
