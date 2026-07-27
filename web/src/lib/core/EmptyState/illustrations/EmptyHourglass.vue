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
  EmptyHourglass — clean, object-only "waiting for data" illustration: an
  hourglass with sand trickling through the neck. No character. Brand-recoloured
  (warning amber for the sand). Pure SMIL motion gated behind `animated`
  (prefers-reduced-motion; OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Waiting for data to arrive"
  >
    <circle cx="120" cy="90" r="68" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="160" rx="46" ry="8" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- stand legs + time ticks + dots -->
    <path
      d="M88 161 L76 172 M152 161 L164 172"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <g stroke="var(--color-primary-300)" stroke-width="2.5" stroke-linecap="round" opacity="0.7">
      <line x1="120" y1="14" x2="120" y2="22" />
      <line x1="190" y1="40" x2="184" y2="46" />
      <line x1="50" y1="40" x2="56" y2="46" />
    </g>
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="40" cy="100" r="2" />
      <circle cx="200" cy="100" r="2" />
      <circle cx="48" cy="140" r="1.6" />
      <circle cx="192" cy="140" r="1.6" />
    </g>

    <!-- caps -->
    <rect
      x="80"
      y="26"
      width="80"
      height="11"
      rx="4"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />
    <rect
      x="80"
      y="150"
      width="80"
      height="11"
      rx="4"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />
    <!-- side rails -->
    <path
      d="M90 37 Q84 94 90 150 M150 37 Q156 94 150 150"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
      fill="none"
    />
    <!-- glass bulbs -->
    <path
      d="M92 37 L148 37 L120 92 Z"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
      stroke-linejoin="round"
    />
    <path
      d="M120 92 L148 150 L92 150 Z"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
      stroke-linejoin="round"
    />
    <!-- remaining sand (top) -->
    <path d="M104 68 L136 68 L120 92 Z" fill="var(--color-warning-400)" />
    <!-- collected sand (bottom) -->
    <path d="M96 150 L144 150 L120 128 Z" fill="var(--color-warning-400)" />

    <!-- falling grains -->
    <circle cx="120" cy="96" r="2.4" fill="var(--color-warning-500)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 36"
        keyTimes="0;1"
        dur="1.5s"
        repeatCount="indefinite"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;1;1;0"
        keyTimes="0;0.2;0.85;1"
        dur="1.5s"
        repeatCount="indefinite"
      />
    </circle>
    <circle cx="120" cy="96" r="2" fill="var(--color-warning-500)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 36"
        keyTimes="0;1"
        dur="1.5s"
        repeatCount="indefinite"
        begin="-0.5s"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;1;1;0"
        keyTimes="0;0.2;0.85;1"
        dur="1.5s"
        repeatCount="indefinite"
        begin="-0.5s"
      />
    </circle>
    <circle cx="120" cy="96" r="2.4" fill="var(--color-warning-600)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 36"
        keyTimes="0;1"
        dur="1.5s"
        repeatCount="indefinite"
        begin="-1s"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0;1;1;0"
        keyTimes="0;0.2;0.85;1"
        dur="1.5s"
        repeatCount="indefinite"
        begin="-1s"
      />
    </circle>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>
