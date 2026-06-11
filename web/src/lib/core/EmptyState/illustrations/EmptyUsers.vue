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
  EmptyUsers — object-only "no users" illustration: two faint member avatars
  beside a dashed "add member" slot with a pulsing + badge. CSS motion gated by
  `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No users yet"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="86" r="58" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="150" rx="64" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="32" cy="50" r="2" /><circle cx="208" cy="120" r="2" /><circle cx="204" cy="46" r="1.6" />
    </g>

    <!-- faint existing members -->
    <g opacity="0.55">
      <circle cx="74" cy="86" r="11" fill="var(--color-primary-300)" />
      <path d="M58 122 Q58 102 74 100 Q90 102 90 122 Z" fill="var(--color-primary-300)" />
    </g>
    <g opacity="0.7">
      <circle cx="166" cy="86" r="11" fill="var(--color-primary-400)" />
      <path d="M150 122 Q150 102 166 100 Q182 102 182 122 Z" fill="var(--color-primary-400)" />
    </g>

    <!-- dashed "add member" slot (center, hero) -->
    <g>
      <circle cx="120" cy="76" r="16" fill="var(--color-surface-base)" stroke="var(--color-primary-400)" stroke-width="2" stroke-dasharray="5 5" />
      <path d="M98 126 Q98 100 120 98 Q142 100 142 126 Z" fill="var(--color-surface-base)" stroke="var(--color-primary-400)" stroke-width="2" stroke-dasharray="5 5" />
    </g>
    <!-- + badge -->
    <g class="es-badge">
      <circle cx="142" cy="64" r="11" fill="var(--color-primary-600)" />
      <line x1="142" y1="58" x2="142" y2="70" stroke="var(--color-white)" stroke-width="2.5" stroke-linecap="round" />
      <line x1="136" y1="64" x2="148" y2="64" stroke="var(--color-white)" stroke-width="2.5" stroke-linecap="round" />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style scoped>
.es-badge {
  transform-box: fill-box;
  transform-origin: center;
  animation: es-pop 2.6s ease-in-out infinite;
}
@keyframes es-pop {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.12);
  }
}
.es-static :where(.es-badge) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-badge) {
    animation: none;
  }
}
</style>
