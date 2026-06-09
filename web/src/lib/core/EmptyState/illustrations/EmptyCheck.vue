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
  EmptyCheck — clean, object-only "you're all caught up" illustration: a check
  badge over an empty inbox tray, with a soft halo and sparkles. No character.
  Micro-animation: the badge pops + the check draws, sparkles twinkle. Uses
  success green; CSS motion gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="You're all caught up"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="74" r="56" fill="var(--color-success-500)" opacity="0.07" />
    <ellipse cx="120" cy="156" rx="58" ry="9" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- success rays + confetti -->
    <g stroke="var(--color-success-400)" stroke-width="2.5" stroke-linecap="round" opacity="0.45">
      <line x1="120" y1="22" x2="120" y2="12" /><line x1="170" y1="34" x2="178" y2="27" /><line x1="70" y1="34" x2="62" y2="27" /><line x1="182" y1="74" x2="192" y2="74" /><line x1="58" y1="74" x2="48" y2="74" />
    </g>
    <g fill="var(--color-success-500)" opacity="0.7">
      <circle cx="48" cy="100" r="2.2" /><circle cx="192" cy="104" r="2.2" /><circle cx="62" cy="40" r="1.8" />
    </g>

    <!-- empty inbox tray -->
    <path d="M74 138 L88 116 H152 L166 138 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="2" stroke-linejoin="round" />
    <path d="M74 138 V150 Q74 154 78 154 H162 Q166 154 166 150 V138 H142 Q140 146 120 146 Q100 146 98 138 Z" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" stroke-linejoin="round" />

    <!-- check badge (pops) -->
    <g class="es-badge">
      <circle cx="120" cy="70" r="34" fill="var(--color-success-100)" />
      <circle cx="120" cy="70" r="34" fill="none" stroke="var(--color-success-500)" stroke-width="3" />
      <path class="es-check" d="M104 71 L116 83 L138 58" fill="none" stroke="var(--color-success-700)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    </g>

    <!-- sparkles -->
    <g class="es-spark es-spark-a" transform="translate(166 44)">
      <path d="M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z" fill="var(--color-success-500)" />
    </g>
    <g class="es-spark es-spark-b" transform="translate(70 52)">
      <path d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z" fill="var(--color-primary-400)" />
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
.es-badge,
.es-spark {
  transform-box: fill-box;
  transform-origin: center;
}
.es-badge {
  animation: es-pop 3.4s ease-in-out infinite;
}
.es-check {
  stroke-dasharray: 52;
  animation: es-draw 3.4s ease-in-out infinite;
}
.es-spark-a {
  animation: es-twinkle 2.4s ease-in-out infinite;
}
.es-spark-b {
  animation: es-twinkle 3s ease-in-out infinite;
  animation-delay: -1s;
}

@keyframes es-pop {
  0%,
  46%,
  100% {
    transform: scale(1);
  }
  54% {
    transform: scale(1.06);
  }
  66% {
    transform: scale(1);
  }
}
@keyframes es-draw {
  0%,
  40% {
    stroke-dashoffset: 52;
  }
  60%,
  100% {
    stroke-dashoffset: 0;
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

.es-static :where(.es-badge, .es-check, .es-spark) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-badge, .es-check, .es-spark) {
    animation: none;
  }
}
</style>
