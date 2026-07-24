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
  EmptyBoard — clean, object-only first-run "create" illustration: a dashboard
  with one placed widget and an empty, pulsing "+" slot, with drifting "+"
  confetti. No character. Brand-recoloured; CSS motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.createFirstItem')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="158" rx="74" ry="9" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- depth: stacked back card + dotted field -->
    <rect
      x="58"
      y="24"
      width="150"
      height="104"
      rx="12"
      fill="var(--color-surface-subtle)"
      opacity="0.45"
    />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="24" cy="44" r="2" />
      <circle cx="222" cy="118" r="2" />
      <circle cx="28" cy="116" r="2" />
      <circle cx="220" cy="40" r="2" />
      <circle cx="14" cy="84" r="1.6" />
      <circle cx="230" cy="80" r="1.6" />
    </g>

    <!-- drifting + confetti -->
    <g
      class="es-cf es-cf-a origin-center [transform-box:fill-box]"
      transform="translate(196 40)"
      stroke="var(--color-primary-400)"
      stroke-width="3"
      stroke-linecap="round"
    >
      <line x1="-5" y1="0" x2="5" y2="0" />
      <line x1="0" y1="-5" x2="0" y2="5" />
    </g>
    <g
      class="es-cf es-cf-b origin-center [transform-box:fill-box]"
      transform="translate(40 56)"
      stroke="var(--color-primary-300)"
      stroke-width="3"
      stroke-linecap="round"
    >
      <line x1="-4" y1="0" x2="4" y2="0" />
      <line x1="0" y1="-4" x2="0" y2="4" />
    </g>

    <!-- dashboard -->
    <rect
      x="42"
      y="34"
      width="156"
      height="116"
      rx="13"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.5"
    />
    <rect
      x="56"
      y="48"
      width="48"
      height="7"
      rx="3.5"
      fill="var(--color-border-strong)"
      opacity="0.5"
    />
    <circle cx="182" cy="51" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <circle cx="172" cy="51" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <line
      x1="42"
      y1="66"
      x2="198"
      y2="66"
      stroke="var(--color-border-default)"
      stroke-width="1.5"
    />

    <!-- placed widget -->
    <rect x="56" y="78" width="60" height="58" rx="7" fill="var(--color-surface-subtle)" />
    <rect x="64" y="114" width="8" height="14" rx="2" fill="var(--color-primary-400)" />
    <rect x="76" y="106" width="8" height="22" rx="2" fill="var(--color-primary-500)" />
    <rect x="88" y="98" width="8" height="30" rx="2" fill="var(--color-primary-600)" />
    <rect x="100" y="110" width="8" height="18" rx="2" fill="var(--color-primary-400)" />

    <!-- empty slot (static — a pulsing plus here read as a clickable button) -->
    <g opacity="0.75">
      <rect
        x="124"
        y="78"
        width="60"
        height="58"
        rx="7"
        fill="none"
        stroke="var(--color-primary-400)"
        stroke-width="1.75"
        stroke-dasharray="6 6"
      />
      <line
        x1="154"
        y1="97"
        x2="154"
        y2="117"
        stroke="var(--color-primary-500)"
        stroke-width="3"
        stroke-linecap="round"
      />
      <line
        x1="144"
        y1="107"
        x2="164"
        y2="107"
        stroke="var(--color-primary-500)"
        stroke-width="3"
        stroke-linecap="round"
      />
    </g>

    <!-- sparkle near the slot -->
    <g class="es-spark origin-center [transform-box:fill-box]" transform="translate(190 92)">
      <path
        d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z"
        fill="var(--color-primary-400)"
      />
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
@keyframes es-cf {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
    opacity: 0.5;
  }
  50% {
    transform: translateY(-10px) rotate(40deg);
    opacity: 1;
  }
}

/* Animations MUST start from this block, not from a template arbitrary utility:
   Vue's scoped compiler rewrites `@keyframes es-cf` -> `es-cf-<hash>` and rewrites
   `animation:` in THIS block to match, but it cannot rewrite a class string in the
   template — an `[animation:es-cf_5s_...]` utility there would reference a name
   that no longer exists, silently killing the motion. */
.es-cf-a {
  animation: es-cf 5s ease-in-out infinite;
}
.es-cf-b {
  animation: es-cf 6.2s ease-in-out infinite;
  animation-delay: -2.4s;
}
.es-spark {
  animation: es-twinkle 2.6s ease-in-out infinite;
  animation-delay: -0.6s;
}

/* Gates must out-specify the rules above. `:where()` adds 0 specificity, so a
   `:where(.es-spark, .es-cf)` gate would score only (0,1,0) from the scoped
   attribute and LOSE to `.es-spark[data-v]` (0,2,0) — plain lists score (0,2,0)
   / (0,3,0) and win. */
.es-static .es-spark,
.es-static .es-cf {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .es-spark,
  .es-cf {
    animation: none;
  }
}
</style>
