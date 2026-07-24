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
  EmptyExplorer — a hand-built, detailed flat-style scene for "no data / lost":
  an analyst holding a tablet, scratching their head at a "no-signal" bubble,
  beside a signpost. Brand-recoloured (steel-blue palette), neutral skin/hair so
  it reads in light AND dark. Motion is subtle CSS (float + parallax + twinkle),
  gated by `animated` and prefers-reduced-motion. Scales by `width` (4:3 viewBox).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.explorer.ariaLabel')"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- backdrop blob (slow parallax drift) -->
    <g class="es-blob">
      <path
        d="M188 30 C262 24 330 52 332 122 C334 182 308 220 244 228 C188 235 126 238 84 210 C36 178 42 104 84 68 C120 36 132 36 188 30 Z"
        fill="var(--color-surface-subtle)"
      />
    </g>

    <!-- ground shadow (breathes with the float) -->
    <ellipse class="es-shadow" cx="180" cy="252" rx="104" ry="13" fill="var(--color-primary-900)" opacity="0.14" />

    <!-- signpost -->
    <g>
      <rect x="70" y="120" width="7" height="134" rx="2" fill="var(--color-illustration-bark)" />
      <rect x="70" y="120" width="3" height="134" fill="var(--color-illustration-wood)" />
      <!-- left arrow -->
      <path d="M86 142 H44 L32 152 L44 162 H86 Z" fill="var(--color-primary-500)" />
      <rect x="80" y="146" width="14" height="3" rx="1.5" fill="var(--color-white)" opacity="0.55" />
      <!-- right arrow -->
      <path d="M60 170 H104 L116 180 L104 190 H60 Z" fill="var(--color-primary-400)" />
      <rect x="64" y="178" width="20" height="3" rx="1.5" fill="var(--color-white)" opacity="0.55" />
      <!-- left arrow (small) -->
      <path d="M86 198 H50 L40 207 L50 216 H86 Z" fill="var(--color-primary-300)" />
    </g>

    <!-- character (gentle vertical float) -->
    <g class="es-char">
      <!-- back leg -->
      <path d="M182 176 L196 176 L192 246 L181 246 Z" fill="var(--color-grey-800)" />
      <path d="M178 244 Q178 251 187 251 L198 251 Q201 250 199 245 L192 244 Z" fill="var(--color-grey-900)" />
      <!-- front leg -->
      <path d="M198 176 L213 176 L210 246 L200 246 Z" fill="var(--color-grey-700)" />
      <path d="M198 244 Q198 251 207 251 L219 251 Q222 250 220 245 L210 244 Z" fill="var(--color-grey-900)" />

      <!-- torso / hoodie -->
      <path
        d="M178 152 Q176 146 185 145 L206 145 Q216 146 214 154 L217 176 Q218 181 211 181 L183 181 Q176 181 177 174 Z"
        fill="var(--color-primary-500)"
      />
      <!-- hoodie shade -->
      <path d="M201 146 Q216 147 214 154 L217 176 Q218 181 211 181 L201 181 Z" fill="var(--color-primary-600)" opacity="0.55" />
      <!-- hoodie pocket -->
      <path d="M188 166 H206 Q205 174 197 174 Q189 174 188 166 Z" fill="var(--color-primary-600)" opacity="0.5" />

      <!-- lower arm holding tablet -->
      <path d="M180 154 Q170 166 176 184 Q179 190 186 187 L192 180 Q186 168 190 156 Z" fill="var(--color-primary-500)" />
      <!-- tablet -->
      <g transform="rotate(-12 188 188)">
        <rect x="168" y="176" width="40" height="28" rx="4" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2" />
        <polyline points="174,194 182,188 188,191 196,183 202,187" fill="none" stroke="var(--color-primary-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="172" y1="199" x2="204" y2="199" stroke="var(--color-border-default)" stroke-width="1.5" />
      </g>
      <!-- tablet hand -->
      <ellipse cx="183" cy="186" rx="5.5" ry="4.5" fill="var(--color-illustration-tan)" transform="rotate(-12 183 186)" />

      <!-- head (3/4 facing the bubble) — subtle "thinking" tilt -->
      <g class="es-head">
        <!-- neck -->
        <rect x="192" y="132" width="12" height="14" rx="4" fill="var(--color-illustration-tan)" />
        <ellipse cx="200" cy="114" rx="19" ry="21" fill="var(--color-illustration-sand)" />
        <!-- ear -->
        <circle cx="210" cy="116" r="3.5" fill="var(--color-illustration-tan)" />
        <!-- hair -->
        <path d="M182 110 Q179 90 200 88 Q221 89 219 110 Q219 100 210 98 Q214 104 213 110 Q205 100 195 102 Q188 103 185 112 Q183 108 182 110 Z" fill="var(--color-illustration-umber)" />
        <path d="M181 110 Q179 96 188 90 Q183 99 186 108 Z" fill="var(--color-illustration-cocoa)" />
        <!-- face: brow (raised/puzzled), eye, mouth -->
        <path d="M186 108 Q190 105 194 107" stroke="var(--color-illustration-cocoa)" stroke-width="1.8" stroke-linecap="round" fill="none" />
        <circle cx="190" cy="113" r="2" fill="var(--color-illustration-espresso)" />
        <path d="M187 124 Q191 126 195 123" stroke="var(--color-illustration-clay)" stroke-width="1.8" stroke-linecap="round" fill="none" />
      </g>

      <!-- raised arm — actually scratches the head (rubs back and forth) -->
      <g class="es-scratch">
        <path d="M206 150 Q224 146 230 124 Q232 116 226 114 Q220 113 218 121 Q214 138 200 144 Z" fill="var(--color-primary-500)" />
        <!-- sleeve shade -->
        <path d="M226 114 Q232 116 230 124 Q227 134 222 140 L219 132 Q224 124 222 116 Z" fill="var(--color-primary-600)" opacity="0.5" />
        <!-- scratching hand + fingers -->
        <ellipse cx="224" cy="111" rx="6.5" ry="6" fill="var(--color-illustration-sand)" />
        <path d="M219 108 Q221 104 223 108 M223 107 Q225 103 227 107 M227 108 Q229 105 230 109" stroke="var(--color-illustration-tan)" stroke-width="1.4" stroke-linecap="round" fill="none" />
      </g>
    </g>

    <!-- floating accents -->
    <circle class="es-dot es-dot-a" cx="298" cy="150" r="5" fill="var(--color-primary-400)" />
    <circle class="es-dot es-dot-b" cx="120" cy="92" r="4" fill="var(--color-primary-300)" />
    <g class="es-dot es-dot-c" transform="translate(140 72)">
      <path d="M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z" fill="var(--color-primary-400)" />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 300, animated: true },
);
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   20 illustrations reused generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies from unscoped blocks — a global name collision where the
   last-loaded illustration hijacked the others' animations. Vue rewrites scoped
   keyframe names per component, which ends the collision. All selectors and the
   es-static gate live in this file's own template. */
/* Subtle, looping motion. transform-box/origin keep scale + translate sane on
   SVG groups. All gated behind `animated` (es-static) and the OS reduce-motion
   preference. */
.es-blob,
.es-dot {
  transform-box: fill-box;
  transform-origin: center;
}
/* pivot in viewBox units so the arm/head rotate about a real joint */
.es-scratch {
  transform-box: view-box;
  transform-origin: 209px 150px;
  animation: es-scratch 0.75s ease-in-out infinite;
}
.es-head {
  transform-box: view-box;
  transform-origin: 200px 134px;
  animation: es-headtilt 3.6s ease-in-out infinite;
}
.es-blob {
  animation: es-drift 15s ease-in-out infinite;
}
.es-dot-a {
  animation: es-bob 3.4s ease-in-out infinite;
}
.es-dot-b {
  animation: es-bob 4.2s ease-in-out infinite;
  animation-delay: -0.8s;
}
.es-dot-c {
  animation: es-twinkle 2.8s ease-in-out infinite;
}

@keyframes es-scratch {
  0%,
  100% {
    transform: rotate(-3deg);
  }
  50% {
    transform: rotate(5.5deg);
  }
}
@keyframes es-headtilt {
  0%,
  100% {
    transform: rotate(1.2deg);
  }
  50% {
    transform: rotate(-1.2deg);
  }
}
@keyframes es-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
@keyframes es-drift {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }
  50% {
    transform: translate(5px, -4px) scale(1.02);
  }
}
@keyframes es-twinkle {
  0%,
  100% {
    transform: scale(0.7);
    opacity: 0.35;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
}

/* honour explicit opt-out and the OS preference */
.es-static :where(.es-scratch, .es-head, .es-blob, .es-dot) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-scratch, .es-head, .es-blob, .es-dot) {
    animation: none;
  }
}
</style>
