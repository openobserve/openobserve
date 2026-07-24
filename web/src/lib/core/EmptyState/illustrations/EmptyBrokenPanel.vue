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
  EmptyBrokenPanel — clean, object-only "something went wrong" illustration: a
  cracked panel with a pulsing warning sign and a loose bolt that wobbles free.
  No character. Pure SMIL motion gated behind `animated` (prefers-reduced-motion;
  OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Something went wrong"
  >
    <ellipse cx="120" cy="156" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- scattered fragments + dotted field -->
    <path d="M188 66 l11 4 -5 10 z" fill="var(--color-primary-300)" opacity="0.8" />
    <path d="M42 86 l10 -5 4 10 z" fill="var(--color-error-400)" opacity="0.55" />
    <path d="M198 118 l9 5 -8 6 z" fill="var(--color-primary-400)" opacity="0.7" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="58" r="2" /><circle cx="212" cy="146" r="2" /><circle cx="206" cy="46" r="1.6" /><circle cx="26" cy="118" r="1.6" />
    </g>

    <!-- cracked panel -->
    <rect x="64" y="46" width="112" height="96" rx="13" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />
    <rect x="78" y="60" width="38" height="7" rx="3.5" fill="var(--color-border-strong)" opacity="0.45" />
    <line x1="64" y1="76" x2="176" y2="76" stroke="var(--color-border-default)" stroke-width="1.5" />
    <path d="M120 76 L111 100 L126 114 L115 138 L122 142" stroke="var(--color-border-strong)" stroke-width="2" fill="none" stroke-linejoin="round" opacity="0.7" />
    <path d="M78 112 L94 112 L104 112 M138 104 L154 104 L166 104" stroke="var(--color-error-400)" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.8" />

    <!-- loose bolt (wobbles) -->
    <!-- drawn around 0,0 and placed by the base translate(170 136); the wobble
         rotates around that local origin and adds a 2-unit bob, composed onto the
         base via additive="sum" (replaces the old view-box origin 170px 136px). -->
    <g transform="translate(170 136)">
      <animateTransform v-if="animated" attributeName="transform" type="rotate" values="-8 0 0; 8 0 0; -8 0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animateTransform v-if="animated" attributeName="transform" type="translate" values="0 0; 0 2; 0 0" keyTimes="0;0.5;1" dur="2.6s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <circle r="6" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="1.75" />
      <path d="M-2.4 -2.4 L2.4 2.4 M2.4 -2.4 L-2.4 2.4" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-linecap="round" />
    </g>

    <!-- warning (pulses) -->
    <!-- scales around its own centre (120 40): a compensating translate holds the
         centre fixed while it scales, reproducing the old fill-box
         transform-origin: center; opacity breathes in step. -->
    <g>
      <animate v-if="animated" attributeName="opacity" values="0.92;1;0.92" keyTimes="0;0.5;1" dur="2.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animateTransform v-if="animated" attributeName="transform" type="translate" values="0 0; -7.2 -2.4; 0 0" keyTimes="0;0.5;1" dur="2.2s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <animateTransform v-if="animated" attributeName="transform" type="scale" values="1;1.06;1" keyTimes="0;0.5;1" dur="2.2s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1" />
      <path d="M120 18 L146 62 H94 Z" fill="var(--color-warning-100)" stroke="var(--color-warning-500)" stroke-width="2.5" stroke-linejoin="round" />
      <line x1="120" y1="34" x2="120" y2="48" stroke="var(--color-warning-700)" stroke-width="3.5" stroke-linecap="round" />
      <circle cx="120" cy="55" r="2.2" fill="var(--color-warning-700)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>
