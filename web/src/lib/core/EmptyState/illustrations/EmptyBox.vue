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
  EmptyBox — clean, object-only "nothing here yet" illustration: an open box with
  a dashed placeholder item hovering above it. No character. Micro-animation: the
  placeholder lifts/settles and pulses, sparkles twinkle. Brand-recoloured; CSS
  motion gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Nothing here yet"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="150" rx="62" ry="9" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- depth: small sealed parcel + dotted field -->
    <g>
      <path d="M168 130 L196 130 L192 150 L172 150 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="1.5" stroke-linejoin="round" />
      <path d="M168 130 L182 134 L196 130" stroke="var(--color-border-default)" stroke-width="1.25" fill="none" />
      <line x1="182" y1="134" x2="182" y2="150" stroke="var(--color-border-default)" stroke-width="1.25" />
    </g>
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="46" cy="50" r="2" /><circle cx="198" cy="56" r="2" /><circle cx="38" cy="108" r="1.6" /><circle cx="206" cy="100" r="1.6" /><circle cx="58" cy="34" r="1.6" />
    </g>

    <!-- hovering placeholder item -->
    <g class="es-item">
      <rect x="100" y="34" width="40" height="34" rx="7" fill="none" stroke="var(--color-primary-400)" stroke-width="2" stroke-dasharray="5 5" />
      <line x1="120" y1="44" x2="120" y2="58" stroke="var(--color-primary-500)" stroke-width="2.5" stroke-linecap="round" />
      <line x1="113" y1="51" x2="127" y2="51" stroke="var(--color-primary-500)" stroke-width="2.5" stroke-linecap="round" />
    </g>

    <!-- open box -->
    <g>
      <!-- back flaps -->
      <path d="M86 92 L120 100 L96 80 L70 86 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="1.75" stroke-linejoin="round" />
      <path d="M154 92 L120 100 L144 80 L170 86 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="1.75" stroke-linejoin="round" />
      <!-- box body -->
      <path d="M84 96 L156 96 L148 146 L92 146 Z" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" stroke-linejoin="round" />
      <!-- opening (empty inside) -->
      <path d="M84 96 L120 104 L156 96 L120 90 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="2" stroke-linejoin="round" />
      <!-- front fold line -->
      <path d="M120 104 L120 146" stroke="var(--color-border-default)" stroke-width="1.25" />
    </g>

    <!-- sparkles -->
    <g class="es-spark es-spark-a" transform="translate(168 60)">
      <path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="var(--color-primary-400)" />
    </g>
    <g class="es-spark es-spark-b" transform="translate(64 70)">
      <path d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z" fill="var(--color-primary-300)" />
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
.es-item,
.es-spark {
  transform-box: fill-box;
  transform-origin: center;
}
.es-item {
  animation: es-hover 3s ease-in-out infinite;
}
.es-spark-a {
  animation: es-twinkle 2.4s ease-in-out infinite;
}
.es-spark-b {
  animation: es-twinkle 3s ease-in-out infinite;
  animation-delay: -1s;
}

@keyframes es-hover {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.75;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
@keyframes es-twinkle {
  0%,
  100% {
    transform: scale(0.6);
    opacity: 0.35;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
}

.es-static :where(.es-item, .es-spark) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-item, .es-spark) {
    animation: none;
  }
}
</style>
