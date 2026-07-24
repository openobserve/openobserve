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
  EmptyQuery — object-only "no running queries" illustration: a calm query
  console with a prompt and a blinking cursor (idle). CSS motion gated by
  `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.noQueries.title')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="152" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="48" r="2" />
      <circle cx="210" cy="120" r="2" />
      <circle cx="206" cy="44" r="1.6" />
    </g>

    <!-- console card -->
    <rect
      x="42"
      y="40"
      width="156"
      height="100"
      rx="11"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2"
    />
    <path
      d="M42 51 Q42 40 53 40 L187 40 Q198 40 198 51 L198 58 L42 58 Z"
      fill="var(--color-surface-subtle)"
    />
    <circle cx="54" cy="49" r="2.5" fill="var(--color-error-400)" />
    <circle cx="64" cy="49" r="2.5" fill="var(--color-warning-400)" />
    <circle cx="74" cy="49" r="2.5" fill="var(--color-success-500)" />

    <!-- prompt + cursor -->
    <path
      d="M56 76 l7 5 -7 5"
      stroke="var(--color-primary-500)"
      stroke-width="2.5"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <rect
      x="70"
      y="77"
      width="44"
      height="7"
      rx="3.5"
      fill="var(--color-border-strong)"
      opacity="0.45"
    />
    <rect
      class="es-cursor"
      x="118"
      y="76"
      width="7"
      height="9"
      rx="1"
      fill="var(--color-primary-500)"
    />

    <!-- faint earlier queries -->
    <g opacity="0.5">
      <rect x="70" y="98" width="96" height="6" rx="3" fill="var(--color-border-default)" />
      <rect x="70" y="112" width="68" height="6" rx="3" fill="var(--color-border-default)" />
      <rect x="70" y="126" width="84" height="6" rx="3" fill="var(--color-border-default)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   20 illustrations reused generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies from unscoped blocks — a global name collision where the
   last-loaded illustration hijacked the others' animations. Vue rewrites scoped
   keyframe names per component, which ends the collision. All selectors and the
   es-static gate live in this file's own template. */
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
