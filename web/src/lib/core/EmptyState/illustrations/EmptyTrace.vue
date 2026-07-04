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
  EmptyTrace — object-only "no traces" illustration: a span waterfall with a
  sweeping scan line. CSS motion gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No traces found"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="156" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="26" cy="46" r="2" /><circle cx="214" cy="120" r="2" /><circle cx="210" cy="42" r="1.6" />
    </g>

    <rect x="42" y="30" width="156" height="118" rx="12" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <!-- time axis -->
    <line x1="54" y1="50" x2="186" y2="50" stroke="var(--color-border-default)" stroke-width="1.5" />
    <g stroke="var(--color-border-default)" stroke-width="1.25">
      <line x1="78" y1="48" x2="78" y2="52" /><line x1="110" y1="48" x2="110" y2="52" /><line x1="142" y1="48" x2="142" y2="52" /><line x1="174" y1="48" x2="174" y2="52" />
    </g>

    <!-- span waterfall -->
    <g>
      <rect x="54" y="62" width="124" height="9" rx="4.5" fill="var(--color-primary-500)" />
      <rect x="66" y="78" width="92" height="9" rx="4.5" fill="var(--color-primary-400)" />
      <rect x="78" y="94" width="66" height="9" rx="4.5" fill="var(--color-primary-500)" />
      <rect x="78" y="110" width="44" height="9" rx="4.5" fill="var(--color-primary-300)" />
      <rect x="96" y="126" width="58" height="9" rx="4.5" fill="var(--color-primary-400)" />
    </g>

    <!-- sweeping scan line -->
    <line class="es-scan" x1="60" y1="58" x2="60" y2="140" stroke="var(--color-primary-600)" stroke-width="1.75" opacity="0.7" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style>
.es-scan {
  transform-box: view-box;
  animation: es-scan 3.4s ease-in-out infinite;
}
@keyframes es-scan {
  0%,
  100% {
    transform: translateX(0);
    opacity: 0.2;
  }
  50% {
    transform: translateX(116px);
    opacity: 0.8;
  }
}
.es-static :where(.es-scan) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-scan) {
    animation: none;
  }
}
</style>
