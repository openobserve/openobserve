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
  EmptyFunction — object-only "no functions" illustration: a transform block
  (</>) with a token flowing in one side and out the other. CSS motion gated by
  `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.noFunctions.title')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="150" rx="72" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="44" r="2" />
      <circle cx="210" cy="126" r="2" />
      <circle cx="206" cy="40" r="1.6" />
    </g>

    <!-- input / output rails -->
    <path d="M34 90 H78" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M162 90 H206" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M202 90 l-6 -4 v8 z" fill="var(--color-border-strong)" />

    <!-- input chip -->
    <rect
      x="40"
      y="80"
      width="22"
      height="20"
      rx="5"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-strong)"
      stroke-width="1.5"
    />
    <rect x="45" y="88" width="12" height="4" rx="2" fill="var(--color-primary-400)" />

    <!-- transform block -->
    <rect
      x="80"
      y="62"
      width="80"
      height="56"
      rx="12"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />
    <!-- </> glyph -->
    <path
      d="M104 80 l-10 10 10 10 M136 80 l10 10 -10 10 M126 76 l-12 28"
      stroke="var(--color-primary-500)"
      stroke-width="2.5"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- output chip -->
    <rect
      x="178"
      y="80"
      width="22"
      height="20"
      rx="5"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-strong)"
      stroke-width="1.5"
    />
    <circle cx="189" cy="90" r="4" fill="var(--color-primary-500)" />

    <!-- token flowing through -->
    <circle class="es-token" cx="70" cy="90" r="4.5" fill="var(--color-primary-600)" />
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
.es-token {
  transform-box: view-box;
  animation: es-flow 2.8s ease-in-out infinite;
}
@keyframes es-flow {
  0% {
    transform: translateX(0);
    opacity: 0;
  }
  18% {
    opacity: 1;
  }
  40% {
    transform: translateX(50px);
  }
  46% {
    transform: translateX(50px);
    opacity: 0.2;
  }
  54% {
    transform: translateX(70px);
    opacity: 0.2;
  }
  62% {
    transform: translateX(70px);
    opacity: 1;
  }
  85%,
  100% {
    transform: translateX(120px);
    opacity: 0;
  }
}
.es-static :where(.es-token) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-token) {
    animation: none;
  }
}
</style>
