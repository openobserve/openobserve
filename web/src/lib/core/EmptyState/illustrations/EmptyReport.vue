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
  EmptyReport — object-only "no reports" illustration: a report document with a
  scheduled calendar badge and a paper plane (delivery) drifting. CSS motion
  gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.noReports.title')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <ellipse cx="120" cy="154" rx="62" ry="9" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="34" cy="52" r="2" /><circle cx="206" cy="120" r="2" /><circle cx="40" cy="120" r="1.6" />
    </g>

    <!-- paper plane (delivery) -->
    <g class="es-plane">
      <path d="M44 56 L74 46 L60 72 L55 62 Z" fill="var(--color-primary-400)" />
      <path d="M74 46 L55 62 L60 72 Z" fill="var(--color-primary-500)" />
      <path d="M40 78 q8 -2 14 -10" stroke="var(--color-primary-300)" stroke-width="1.75" stroke-linecap="round" stroke-dasharray="2 4" fill="none" />
    </g>

    <!-- report document -->
    <rect x="78" y="38" width="96" height="108" rx="9" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
    <rect x="90" y="52" width="50" height="7" rx="3.5" fill="var(--color-border-strong)" opacity="0.5" />
    <rect x="90" y="66" width="72" height="4.5" rx="2" fill="var(--color-border-default)" />
    <rect x="90" y="76" width="60" height="4.5" rx="2" fill="var(--color-border-default)" />
    <!-- mini chart -->
    <rect x="90" y="98" width="72" height="40" rx="6" fill="var(--color-surface-subtle)" />
    <rect x="98" y="120" width="8" height="12" rx="2" fill="var(--color-primary-400)" /><rect x="110" y="112" width="8" height="20" rx="2" fill="var(--color-primary-500)" /><rect x="122" y="106" width="8" height="26" rx="2" fill="var(--color-primary-600)" /><rect x="134" y="116" width="8" height="16" rx="2" fill="var(--color-primary-400)" />

    <!-- scheduled calendar badge -->
    <g class="es-badge">
      <rect x="150" y="32" width="34" height="32" rx="5" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
      <rect x="150" y="32" width="34" height="9" rx="5" fill="var(--color-primary-500)" />
      <line x1="158" y1="30" x2="158" y2="36" stroke="var(--color-border-strong)" stroke-width="2" stroke-linecap="round" />
      <line x1="176" y1="30" x2="176" y2="36" stroke="var(--color-border-strong)" stroke-width="2" stroke-linecap="round" />
      <g fill="var(--color-border-strong)" opacity="0.55">
        <circle cx="159" cy="50" r="2" /><circle cx="167" cy="50" r="2" /><circle cx="175" cy="50" r="2" /><circle cx="159" cy="58" r="2" /><circle cx="167" cy="58" r="2" />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
.es-plane {
  transform-box: view-box;
  animation: es-fly 4s ease-in-out infinite;
}
.es-badge {
  transform-box: fill-box;
  transform-origin: center;
  animation: es-bob 3.2s ease-in-out infinite;
}
@keyframes es-fly {
  0%,
  100% {
    transform: translate(0, 0);
  }
  50% {
    transform: translate(-5px, -5px);
  }
}
@keyframes es-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}
.es-static :where(.es-plane, .es-badge) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-plane, .es-badge) {
    animation: none;
  }
}
</style>
