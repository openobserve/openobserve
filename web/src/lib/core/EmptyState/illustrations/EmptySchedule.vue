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
  EmptySchedule — object-only "no scheduled jobs" illustration: a queue of
  search-job rows with a ticking clock badge, signalling work that runs later
  in the background. Distinct from `history` (clock + rewind). CSS motion gated
  by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.noSearchJobs.title')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="84" r="64" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="156" rx="70" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="50" r="2" />
      <circle cx="214" cy="118" r="2" />
      <circle cx="210" cy="44" r="1.6" />
    </g>

    <!-- job queue card (matches the standard 156-wide card used by the other
         empty-state illustrations so it renders at a consistent size) -->
    <rect
      x="42"
      y="46"
      width="156"
      height="92"
      rx="10"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />

    <!-- queued job rows (status dot + bar) -->
    <g>
      <circle class="es-dot es-dot-1" cx="60" cy="68" r="4.5" fill="var(--color-primary-500)" />
      <rect x="74" y="63.5" width="94" height="8" rx="4" fill="var(--color-border-default)" />
    </g>
    <g>
      <circle class="es-dot es-dot-2" cx="60" cy="92" r="4.5" fill="var(--color-primary-500)" />
      <rect x="74" y="87.5" width="80" height="8" rx="4" fill="var(--color-border-default)" />
    </g>
    <g>
      <circle class="es-dot es-dot-3" cx="60" cy="116" r="4.5" fill="var(--color-primary-500)" />
      <rect x="74" y="111.5" width="88" height="8" rx="4" fill="var(--color-border-default)" />
    </g>

    <!-- clock badge (overlapping bottom-right corner) -->
    <circle
      cx="182"
      cy="128"
      r="22"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />
    <circle cx="182" cy="128" r="17.5" fill="var(--color-primary-500)" opacity="0.08" />
    <line
      x1="182"
      y1="128"
      x2="182"
      y2="116"
      stroke="var(--color-text-heading)"
      stroke-width="2.5"
      stroke-linecap="round"
      opacity="0.75"
    />
    <line
      class="es-hand"
      x1="182"
      y1="128"
      x2="192"
      y2="128"
      stroke="var(--color-primary-600)"
      stroke-width="2.25"
      stroke-linecap="round"
    />
    <circle cx="182" cy="128" r="2.75" fill="var(--color-primary-600)" />
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
.es-hand {
  transform-box: view-box;
  transform-origin: 182px 128px;
  animation: es-tick 6s linear infinite;
}
.es-dot {
  animation: es-blink 3s ease-in-out infinite;
}
.es-dot-2 {
  animation-delay: 0.6s;
}
.es-dot-3 {
  animation-delay: 1.2s;
}
@keyframes es-tick {
  to {
    transform: rotate(360deg);
  }
}
@keyframes es-blink {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.es-static :where(.es-hand, .es-dot) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-hand, .es-dot) {
    animation: none;
  }
}
</style>
