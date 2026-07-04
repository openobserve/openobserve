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
  EmptyLogs — object-only "no logs" illustration: a console of log lines with
  severity dots and a blinking cursor. CSS motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No logs found"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="156" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="26" cy="46" r="2" /><circle cx="214" cy="120" r="2" /><circle cx="210" cy="42" r="1.6" />
    </g>

    <rect x="42" y="30" width="156" height="118" rx="12" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <rect x="54" y="42" width="40" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.5" />
    <circle cx="186" cy="45" r="2.5" fill="var(--color-border-strong)" opacity="0.45" />
    <circle cx="178" cy="45" r="2.5" fill="var(--color-border-strong)" opacity="0.45" />
    <line x1="42" y1="56" x2="198" y2="56" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- highlighted row -->
    <rect x="42" y="96" width="156" height="14" fill="var(--color-surface-subtle)" opacity="0.7" />

    <!-- log rows: severity dot + line -->
    <g>
      <circle cx="58" cy="70" r="3" fill="var(--color-primary-400)" /><rect x="70" y="67" width="108" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.45" />
      <circle cx="58" cy="86" r="3" fill="var(--color-warning-500)" /><rect x="70" y="83" width="86" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.4" />
      <circle cx="58" cy="103" r="3" fill="var(--color-error-500)" /><rect x="70" y="100" width="116" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.5" />
      <circle cx="58" cy="120" r="3" fill="var(--color-primary-400)" /><rect x="70" y="117" width="74" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.4" />
      <circle cx="58" cy="136" r="3" fill="var(--color-success-500)" /><rect x="70" y="133" width="96" height="6" rx="3" fill="var(--color-border-strong)" opacity="0.4" />
    </g>

    <!-- blinking cursor -->
    <rect class="es-cursor" x="150" y="132" width="7" height="8" rx="1" fill="var(--color-primary-500)" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style>
.es-cursor {
  animation: es-blink 1.1s steps(1, end) infinite;
}
@keyframes es-blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}
.es-static :where(.es-cursor) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-cursor) {
    animation: none;
  }
}
</style>
