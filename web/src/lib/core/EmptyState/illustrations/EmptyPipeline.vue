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
  EmptyPipeline — object-only "no pipelines" illustration: a small flow of nodes
  with a packet travelling along it, ending at a dashed "add" node. CSS motion
  gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Create your first pipeline"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="150" rx="74" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="44" r="2" /><circle cx="210" cy="128" r="2" /><circle cx="206" cy="40" r="1.6" />
    </g>

    <!-- connectors -->
    <path d="M76 70 H104" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M100 70 l-6 -4 v8 z" fill="var(--color-border-strong)" />
    <path d="M136 70 H164" stroke="var(--color-border-strong)" stroke-width="2" stroke-dasharray="4 4" />
    <path d="M160 70 l-6 -4 v8 z" fill="var(--color-border-strong)" />
    <path d="M120 86 V112 H64" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M68 112 l-6 -4 v8 z" fill="var(--color-border-strong)" />

    <!-- source node -->
    <rect x="44" y="56" width="32" height="28" rx="7" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M54 76 Q54 70 60 70 Q66 70 66 76 M54 70 Q54 66 60 66 Q66 66 66 70" stroke="var(--color-primary-500)" stroke-width="2" fill="none" />
    <!-- transform node (center) -->
    <rect x="104" y="56" width="32" height="28" rx="7" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <path d="M114 64 l-6 6 6 6 M126 64 l6 6 -6 6" stroke="var(--color-primary-500)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <!-- destination node (dashed / empty, static — a pulsing plus here read as a clickable button) -->
    <g opacity="0.85">
      <rect x="164" y="56" width="32" height="28" rx="7" fill="none" stroke="var(--color-primary-400)" stroke-width="1.75" stroke-dasharray="5 5" />
      <line x1="180" y1="64" x2="180" y2="76" stroke="var(--color-primary-500)" stroke-width="2.25" stroke-linecap="round" />
      <line x1="174" y1="70" x2="186" y2="70" stroke="var(--color-primary-500)" stroke-width="2.25" stroke-linecap="round" />
    </g>
    <!-- output node (lower) -->
    <rect x="40" y="98" width="32" height="28" rx="7" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <rect x="48" y="110" width="4" height="6" rx="1.5" fill="var(--color-primary-400)" /><rect x="55" y="106" width="4" height="10" rx="1.5" fill="var(--color-primary-500)" /><rect x="62" y="108" width="4" height="8" rx="1.5" fill="var(--color-primary-600)" />

    <!-- travelling packet -->
    <circle class="es-packet" cx="60" cy="70" r="4" fill="var(--color-primary-600)" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 260, animated: true },
);
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   20 illustrations reused generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies from unscoped blocks — a global name collision where the
   last-loaded illustration hijacked the others' animations. Vue rewrites scoped
   keyframe names per component, which ends the collision. All selectors and the
   es-static gate live in this file's own template. */
.es-packet {
  transform-box: view-box;
  animation: es-travel 3s ease-in-out infinite;
}
@keyframes es-travel {
  0% {
    transform: translateX(0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  45% {
    transform: translateX(44px);
  }
  60% {
    opacity: 1;
  }
  75%,
  100% {
    transform: translateX(104px);
    opacity: 0;
  }
}
.es-static :where(.es-packet) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-packet) {
    animation: none;
  }
}
</style>
