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
  EmptyHistory — object-only "no history yet" illustration: a clock encircled by
  a rewind arrow, hands ticking. CSS motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No history yet"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="88" r="58" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="152" rx="52" ry="8" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="34" cy="52" r="2" /><circle cx="206" cy="118" r="2" /><circle cx="202" cy="48" r="1.6" />
    </g>

    <!-- rewind arrow around the clock -->
    <g class="es-rewind">
      <path d="M150 46 A48 48 0 1 1 120 40" stroke="var(--color-primary-400)" stroke-width="2.5" fill="none" stroke-linecap="round" />
      <path d="M120 40 l9 -5 -1 11 z" fill="var(--color-primary-500)" />
    </g>

    <!-- clock face -->
    <circle cx="120" cy="88" r="36" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />
    <g stroke="var(--color-border-strong)" stroke-width="2" stroke-linecap="round" opacity="0.6">
      <line x1="120" y1="58" x2="120" y2="63" /><line x1="150" y1="88" x2="145" y2="88" /><line x1="120" y1="118" x2="120" y2="113" /><line x1="90" y1="88" x2="95" y2="88" />
    </g>
    <!-- hands -->
    <line x1="120" y1="88" x2="120" y2="70" stroke="var(--color-text-primary)" stroke-width="3" stroke-linecap="round" opacity="0.75" />
    <line class="es-hand" x1="120" y1="88" x2="138" y2="88" stroke="var(--color-primary-600)" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="120" cy="88" r="3.5" fill="var(--color-primary-600)" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style>
.es-hand {
  transform-box: view-box;
  transform-origin: 120px 88px;
  animation: es-tick 8s linear infinite;
}
.es-rewind {
  transform-box: view-box;
  transform-origin: 120px 88px;
  animation: es-pulse 3s ease-in-out infinite;
}
@keyframes es-tick {
  to {
    transform: rotate(360deg);
  }
}
@keyframes es-pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}
.es-static :where(.es-hand, .es-rewind) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-hand, .es-rewind) {
    animation: none;
  }
}
</style>
