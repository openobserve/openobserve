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
  EmptyBrowserCheck — browser window with a dashed journey path, a cursor
  that travels along the path, and a success badge. Used on the
  CreateBrowserTest gate page. Animated: path appears, cursor travels along
  it, badge pops in with check draw. All motion gated by `animated` +
  prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="New browser check"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- soft halo -->
    <circle cx="119" cy="84" r="62" fill="var(--color-primary-400)" opacity="0.06" />
    <!-- ground shadow -->
    <ellipse cx="119" cy="154" rx="56" ry="7" fill="var(--color-primary-900)" opacity="0.08" />

    <!-- browser frame -->
    <rect
      x="47" y="22" width="144" height="114" rx="8"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-primary-400)" stroke-width="2.5"
    />
    <!-- header bar — two rects keep the bottom corners square -->
    <rect x="47" y="22" width="144" height="22" rx="8" fill="var(--color-primary-400)" />
    <rect x="47" y="36" width="144" height="8" fill="var(--color-primary-400)" />
    <!-- three traffic-light dots -->
    <circle cx="65" cy="33" r="3.5" fill="white" opacity="0.5" />
    <circle cx="78" cy="33" r="3.5" fill="white" opacity="0.5" />
    <circle cx="91" cy="33" r="3.5" fill="white" opacity="0.5" />

    <!-- dashed journey path -->
    <path
      class="es-path"
      d="M 79 100 Q 99 124 123 109 Q 145 96 163 103"
      stroke="var(--color-primary-900)"
      stroke-width="2.5"
      stroke-dasharray="5 4"
      stroke-linecap="round"
    />

    <!-- cursor — travels along path via CSS offset-path -->
    <g class="es-cursor">
      <polygon points="-2,-5.5 10,0 -2,5.5 1,0" fill="var(--color-primary-900)" />
    </g>

    <!-- success badge -->
    <g class="es-badge">
      <circle cx="187" cy="132" r="17" fill="var(--color-success-500)" />
      <path
        class="es-check"
        d="M 178 132 L 185 139 L 197 124"
        fill="none"
        stroke="white"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
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
/* keep(keyframes): single-consumer SVG animation choreography (offset-path
   travel, stroke draw, staged opacity) — none of it expressible as utilities. */
/* ── Path appears ─────────────────────────────────────────────────────────── */
.es-path {
  animation: es-path-show 3.5s ease-in-out infinite;
}
@keyframes es-path-show {
  0%, 4%   { opacity: 0; }
  20%, 78% { opacity: 1; }
  88%, 100% { opacity: 0; }
}

/* ── Cursor travels along the path ───────────────────────────────────────── */
.es-cursor {
  offset-path: path("M 79 100 Q 99 124 123 109 Q 145 96 163 103");
  offset-distance: 0%;
  offset-rotate: auto;
  animation: es-cursor-travel 3.5s ease-in-out infinite;
}
@keyframes es-cursor-travel {
  0%, 6%   { offset-distance: 0%;   opacity: 0; }
  12%      { opacity: 1; }
  38%, 78% { offset-distance: 100%; opacity: 1; }
  86%, 100% { offset-distance: 100%; opacity: 0; }
}

/* ── Badge pops in ────────────────────────────────────────────────────────── */
.es-badge {
  transform-box: fill-box;
  transform-origin: center;
  animation: es-pop 3.5s ease-in-out infinite;
}
@keyframes es-pop {
  0%, 42%  { transform: scale(0); opacity: 0; }
  50%      { transform: scale(1.1); opacity: 1; }
  56%, 78% { transform: scale(1);   opacity: 1; }
  88%, 100% { transform: scale(0); opacity: 0; }
}

/* ── Check draws within badge ─────────────────────────────────────────────── */
.es-check {
  stroke-dasharray: 40;
  animation: es-check-draw 3.5s ease-in-out infinite;
}
@keyframes es-check-draw {
  0%, 48%  { stroke-dashoffset: 40; }
  62%, 78% { stroke-dashoffset: 0;  }
  88%, 100% { stroke-dashoffset: 40; }
}

/* ── Static / reduced-motion — show end-state immediately ────────────────── */
.es-static .es-path  { animation: none; opacity: 1; }
.es-static .es-cursor { animation: none; offset-distance: 100%; opacity: 1; }
.es-static .es-badge  { animation: none; transform: scale(1); opacity: 1; transform-box: fill-box; transform-origin: center; }
.es-static .es-check  { animation: none; stroke-dashoffset: 0; }

@media (prefers-reduced-motion: reduce) {
  .es-path  { animation: none; opacity: 1; }
  .es-cursor { animation: none; offset-distance: 100%; opacity: 1; }
  .es-badge  { animation: none; transform: scale(1); opacity: 1; }
  .es-check  { animation: none; stroke-dashoffset: 0; }
}
</style>
