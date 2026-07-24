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
  EmptyBoard — clean, object-only first-run "create" illustration: a dashboard
  with one placed widget and an empty, pulsing "+" slot, with drifting "+"
  confetti. No character. Brand-recoloured. Pure SMIL motion gated behind
  `animated` (prefers-reduced-motion; OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Create your first item"
  >
    <ellipse cx="120" cy="158" rx="74" ry="9" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- depth: stacked back card + dotted field -->
    <rect x="58" y="24" width="150" height="104" rx="12" fill="var(--color-surface-subtle)" opacity="0.45" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="24" cy="44" r="2" /><circle cx="222" cy="118" r="2" /><circle cx="28" cy="116" r="2" /><circle cx="220" cy="40" r="2" /><circle cx="14" cy="84" r="1.6" /><circle cx="230" cy="80" r="1.6" />
    </g>

    <!-- drifting + confetti -->
    <g transform="translate(196 40)" stroke="var(--color-primary-400)" stroke-width="3" stroke-linecap="round">
      <animateTransform v-if="animated" attributeName="transform" type="translate" additive="sum" values="0 0; 0 -10; 0 0" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animateTransform v-if="animated" attributeName="transform" type="rotate" additive="sum" values="0; 40; 0" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animate v-if="animated" attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <line x1="-5" y1="0" x2="5" y2="0" /><line x1="0" y1="-5" x2="0" y2="5" />
    </g>
    <g transform="translate(40 56)" stroke="var(--color-primary-300)" stroke-width="3" stroke-linecap="round">
      <animateTransform v-if="animated" attributeName="transform" type="translate" additive="sum" values="0 0; 0 -10; 0 0" keyTimes="0;0.5;1" dur="6.2s" repeatCount="indefinite" begin="-2.4s" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animateTransform v-if="animated" attributeName="transform" type="rotate" additive="sum" values="0; 40; 0" keyTimes="0;0.5;1" dur="6.2s" repeatCount="indefinite" begin="-2.4s" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animate v-if="animated" attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="6.2s" repeatCount="indefinite" begin="-2.4s" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <line x1="-4" y1="0" x2="4" y2="0" /><line x1="0" y1="-4" x2="0" y2="4" />
    </g>

    <!-- dashboard -->
    <rect x="42" y="34" width="156" height="116" rx="13" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />
    <rect x="56" y="48" width="48" height="7" rx="3.5" fill="var(--color-border-strong)" opacity="0.5" />
    <circle cx="182" cy="51" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <circle cx="172" cy="51" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <line x1="42" y1="66" x2="198" y2="66" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- placed widget -->
    <rect x="56" y="78" width="60" height="58" rx="7" fill="var(--color-surface-subtle)" />
    <rect x="64" y="114" width="8" height="14" rx="2" fill="var(--color-primary-400)" />
    <rect x="76" y="106" width="8" height="22" rx="2" fill="var(--color-primary-500)" />
    <rect x="88" y="98" width="8" height="30" rx="2" fill="var(--color-primary-600)" />
    <rect x="100" y="110" width="8" height="18" rx="2" fill="var(--color-primary-400)" />

    <!-- empty slot (static — a pulsing plus here read as a clickable button) -->
    <g opacity="0.75">
      <rect x="124" y="78" width="60" height="58" rx="7" fill="none" stroke="var(--color-primary-400)" stroke-width="1.75" stroke-dasharray="6 6" />
      <line x1="154" y1="97" x2="154" y2="117" stroke="var(--color-primary-500)" stroke-width="3" stroke-linecap="round" />
      <line x1="144" y1="107" x2="164" y2="107" stroke="var(--color-primary-500)" stroke-width="3" stroke-linecap="round" />
    </g>

    <!-- sparkle near the slot -->
    <g transform="translate(190 92)">
      <animateTransform v-if="animated" attributeName="transform" type="scale" additive="sum" values="0.6;1.1;0.6" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" begin="-0.6s" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animate v-if="animated" attributeName="opacity" values="0.35;1;0.35" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" begin="-0.6s" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="var(--color-primary-400)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>
