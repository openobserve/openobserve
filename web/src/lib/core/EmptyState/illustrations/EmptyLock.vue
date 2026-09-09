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
  EmptyLock — "you may not see this" illustration: a closed padlock standing in
  front of a dashed content card. The card is the point — it says the content
  EXISTS and is withheld, which an empty container would wrongly read as "there
  is nothing here". Deliberately still: this is a stop, not an invitation, so
  only a slow halo breathes. Brand-recoloured; motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.noAccess.title')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="152" rx="54" ry="8" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- dotted field -->
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="46" cy="52" r="2" />
      <circle cx="198" cy="58" r="2" />
      <circle cx="38" cy="110" r="1.6" />
      <circle cx="206" cy="102" r="1.6" />
      <circle cx="58" cy="36" r="1.6" />
    </g>

    <!-- withheld content: a dashed card with rows, sitting behind the lock -->
    <g opacity="0.65">
      <rect
        x="78"
        y="34"
        width="84"
        height="50"
        rx="6"
        stroke="var(--color-border-default)"
        stroke-width="1.5"
        stroke-dasharray="5 4"
      />
      <g fill="var(--color-border-default)" opacity="0.8">
        <rect x="88" y="46" width="46" height="4" rx="2" />
        <rect x="88" y="56" width="64" height="4" rx="2" />
        <rect x="88" y="66" width="34" height="4" rx="2" />
      </g>
    </g>

    <!-- halo: the only moving part, and only just -->
    <circle
      class="es-halo"
      cx="120"
      cy="116"
      r="42"
      stroke="var(--color-primary-400)"
      stroke-width="1.5"
      opacity="0.18"
    />

    <!-- padlock -->
    <g>
      <path
        d="M106 100 V90 A14 14 0 0 1 134 90 V100"
        stroke="var(--color-border-strong)"
        stroke-width="6"
        stroke-linecap="round"
        fill="none"
      />
      <rect
        x="94"
        y="100"
        width="52"
        height="44"
        rx="9"
        fill="var(--color-surface-subtle)"
        stroke="var(--color-border-strong)"
        stroke-width="2"
      />
      <circle cx="120" cy="117" r="5.5" fill="var(--color-border-strong)" />
      <path d="M117.6 121 L122.4 121 L123.6 133 L116.4 133 Z" fill="var(--color-border-strong)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   illustrations reuse generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies from unscoped blocks — a global name collision where the
   last-loaded illustration hijacked the others' animations. Vue rewrites scoped
   keyframe names per component, which ends the collision. All selectors and the
   es-static gate live in this file's own template. */
.es-halo {
  transform-box: fill-box;
  transform-origin: center;
  animation: es-breathe 4s ease-in-out infinite;
}

@keyframes es-breathe {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.12;
  }
  50% {
    transform: scale(1.04);
    opacity: 0.26;
  }
}

.es-static :where(.es-halo) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-halo) {
    animation: none;
  }
}
</style>
