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
  EmptyStreamSelect — object-only "pick a stream to start exploring" illustration:
  a list card of stream rows with ONE row highlighted (selected), signalling
  "choose a stream from the list". Built on the same card grammar as
  EmptyServicesCatalog. No character. CSS motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Pick a stream to start exploring"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- Ground shadow -->
    <ellipse cx="120" cy="156" rx="66" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <!-- Ambient dots -->
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="26" cy="46" r="2" />
      <circle cx="214" cy="120" r="2" />
      <circle cx="210" cy="42" r="1.6" />
    </g>

    <!-- Card background -->
    <rect
      x="40"
      y="28"
      width="160"
      height="122"
      rx="10"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2"
    />

    <!-- Header row divider + labels -->
    <line
      x1="40"
      y1="52"
      x2="200"
      y2="52"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      opacity="0.6"
    />
    <rect
      x="54"
      y="38"
      width="34"
      height="7"
      rx="3.5"
      fill="var(--color-border-default)"
      opacity="0.5"
    />
    <rect
      x="150"
      y="38"
      width="24"
      height="7"
      rx="3.5"
      fill="var(--color-border-default)"
      opacity="0.5"
    />

    <!-- Selected row highlight (row 2) -->
    <rect
      x="46"
      y="90"
      width="148"
      height="24"
      rx="6"
      fill="var(--color-primary-500)"
      opacity="0.12"
    />
    <rect x="46" y="90" width="3.5" height="24" rx="1.75" fill="var(--color-primary-500)" />

    <!-- Row 1 -->
    <circle class="es-dot es-dot-1" cx="58" cy="70" r="5" fill="var(--color-primary-400)" />
    <rect
      x="72"
      y="66"
      width="64"
      height="8"
      rx="4"
      fill="var(--color-border-strong)"
      opacity="0.4"
    />
    <rect
      x="150"
      y="66"
      width="34"
      height="8"
      rx="4"
      fill="var(--color-border-default)"
      opacity="0.35"
    />

    <!-- Row 2 (selected) -->
    <circle cx="58" cy="102" r="5" fill="var(--color-primary-600)" />
    <rect
      x="72"
      y="98"
      width="58"
      height="8"
      rx="4"
      fill="var(--color-primary-600)"
      opacity="0.7"
    />
    <rect
      x="150"
      y="98"
      width="34"
      height="8"
      rx="4"
      fill="var(--color-primary-400)"
      opacity="0.45"
    />

    <!-- Row 3 -->
    <circle class="es-dot es-dot-3" cx="58" cy="134" r="5" fill="var(--color-primary-300)" />
    <rect
      x="72"
      y="130"
      width="70"
      height="8"
      rx="4"
      fill="var(--color-border-strong)"
      opacity="0.4"
    />
    <rect
      x="150"
      y="130"
      width="34"
      height="8"
      rx="4"
      fill="var(--color-border-default)"
      opacity="0.35"
    />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   illustrations reuse generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies, so an unscoped block lets the last-loaded illustration
   hijack the others' animations. Vue rewrites scoped keyframe names per
   component, which ends the collision. All selectors and the es-static gate
   live in this file's own template. */
.es-dot {
  transform-box: fill-box;
  transform-origin: center;
}
.es-dot-1 {
  animation: es-pulse 2.4s ease-in-out infinite;
}
.es-dot-3 {
  animation: es-pulse 2.4s ease-in-out infinite 1.2s;
}
@keyframes es-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}
.es-static :where(.es-dot-1, .es-dot-3) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-dot-1, .es-dot-3) {
    animation: none;
  }
}
</style>
