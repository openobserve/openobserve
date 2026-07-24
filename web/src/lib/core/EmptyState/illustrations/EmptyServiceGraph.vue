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
  EmptyServiceGraph — object-only "no service graph" illustration: one root
  service node on the left calling two downstream nodes on the right (horizontal
  tree topology). Animated packets travel each branch in alternating sequence.
  Pure SMIL motion gated behind `animated`
  (prefers-reduced-motion; OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No service graph data"
  >
    <!-- Ground shadow -->
    <ellipse cx="120" cy="156" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <!-- Ambient dots -->
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="26" cy="46" r="2" /><circle cx="214" cy="120" r="2" /><circle cx="210" cy="42" r="1.6" />
    </g>

    <!-- Edge: root → top-right child -->
    <line x1="94" y1="82" x2="153" y2="58" stroke="var(--color-border-strong)" stroke-width="2" />
    <!-- Arrowhead at top child -->
    <path d="M 153 58 L 148 65 L 144 57 Z" fill="var(--color-border-strong)" />

    <!-- Edge: root → bottom-right child -->
    <line x1="94" y1="98" x2="153" y2="122" stroke="var(--color-border-strong)" stroke-width="2" />
    <!-- Arrowhead at bottom child -->
    <path d="M 153 122 L 144 123 L 148 115 Z" fill="var(--color-border-strong)" />

    <!-- Root node (left — service origin), larger -->
    <circle cx="75" cy="90" r="20" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <circle cx="75" cy="90" r="8" fill="var(--color-primary-500)" opacity="0.9" />
    <circle cx="75" cy="90" r="4" fill="var(--color-primary-700)" />

    <!-- Top-right child node -->
    <circle cx="168" cy="52" r="16" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <circle cx="168" cy="52" r="6" fill="var(--color-primary-400)" opacity="0.85" />
    <circle cx="168" cy="52" r="3" fill="var(--color-primary-600)" />

    <!-- Bottom-right child node -->
    <circle cx="168" cy="128" r="16" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <circle cx="168" cy="128" r="6" fill="var(--color-primary-300)" opacity="0.85" />
    <circle cx="168" cy="128" r="3" fill="var(--color-primary-500)" />

    <!-- Animated packets -->
    <!-- Packet toward top-right child: travels delta (59, -24) in user units -->
    <circle cx="94" cy="82" r="4" fill="var(--color-primary-600)">
      <animateTransform v-if="animated" attributeName="transform" type="translate" values="0 0; 59 -24; 59 -24" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animate v-if="animated" attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.1;0.5;0.65;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1" />
    </circle>
    <!-- Packet toward bottom-right child: delta (59, 24), 1.5s phase offset -->
    <circle cx="94" cy="98" r="4" fill="var(--color-primary-400)">
      <animateTransform v-if="animated" attributeName="transform" type="translate" values="0 0; 59 24; 59 24" keyTimes="0;0.5;1" dur="3s" begin="1.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animate v-if="animated" attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.1;0.5;0.65;1" dur="3s" begin="1.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1" />
    </circle>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>
