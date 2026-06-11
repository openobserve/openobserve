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
    aria-label="No scheduled search jobs"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="88" r="58" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="152" rx="56" ry="8" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="36" cy="54" r="2" /><circle cx="208" cy="116" r="2" /><circle cx="200" cy="46" r="1.6" />
    </g>

    <!-- job queue card -->
    <rect x="64" y="50" width="112" height="78" rx="8" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />

    <!-- queued job rows (status dot + bar) -->
    <g>
      <circle class="es-dot es-dot-1" cx="80" cy="68" r="4" fill="var(--color-primary-500)" />
      <rect x="92" y="64.5" width="68" height="7" rx="3.5" fill="var(--color-border-default)" />
    </g>
    <g>
      <circle class="es-dot es-dot-2" cx="80" cy="89" r="4" fill="var(--color-primary-500)" />
      <rect x="92" y="85.5" width="58" height="7" rx="3.5" fill="var(--color-border-default)" />
    </g>
    <g>
      <circle class="es-dot es-dot-3" cx="80" cy="110" r="4" fill="var(--color-primary-500)" />
      <rect x="92" y="106.5" width="64" height="7" rx="3.5" fill="var(--color-border-default)" />
    </g>

    <!-- clock badge (overlapping bottom-right corner) -->
    <circle cx="168" cy="120" r="20" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />
    <circle cx="168" cy="120" r="16" fill="var(--color-primary-500)" opacity="0.08" />
    <line x1="168" y1="120" x2="168" y2="109" stroke="var(--color-text-primary)" stroke-width="2.5" stroke-linecap="round" opacity="0.75" />
    <line class="es-hand" x1="168" y1="120" x2="177" y2="120" stroke="var(--color-primary-600)" stroke-width="2.25" stroke-linecap="round" />
    <circle cx="168" cy="120" r="2.5" fill="var(--color-primary-600)" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style scoped>
.es-hand {
  transform-box: view-box;
  transform-origin: 168px 120px;
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
