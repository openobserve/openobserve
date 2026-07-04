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
  EmptyBuilder — first-run "create your first thing". Composition: a LARGE
  dashboard dominates the frame while a SMALL person stands at the corner,
  presenting, as widgets fly in to fill an empty slot. Scale contrast + corner
  placement make this read very differently from a centred figure. Micro-anim:
  tiles fly into the pulsing slot; the presenter's arm gestures. CSS motion gated
  by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Create your first item"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- faint dotted field behind the board -->
    <g fill="var(--color-border-default)" opacity="0.45">
      <circle cx="288" cy="60" r="2" /><circle cx="312" cy="92" r="2" /><circle cx="300" cy="128" r="2" /><circle cx="326" cy="150" r="2" />
    </g>

    <!-- LARGE dashboard board (the hero) -->
    <rect x="30" y="36" width="226" height="176" rx="14" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" />
    <rect x="46" y="50" width="64" height="8" rx="4" fill="var(--color-border-strong)" opacity="0.5" />
    <circle cx="240" cy="54" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <circle cx="230" cy="54" r="3" fill="var(--color-border-strong)" opacity="0.45" />
    <line x1="30" y1="70" x2="256" y2="70" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- placed: bar widget -->
    <rect x="46" y="82" width="92" height="56" rx="7" fill="var(--color-surface-subtle)" />
    <rect x="56" y="116" width="9" height="14" rx="2.5" fill="var(--color-primary-400)" />
    <rect x="70" y="106" width="9" height="24" rx="2.5" fill="var(--color-primary-500)" />
    <rect x="84" y="98" width="9" height="32" rx="2.5" fill="var(--color-primary-600)" />
    <rect x="98" y="110" width="9" height="20" rx="2.5" fill="var(--color-primary-400)" />
    <!-- placed: sparkline widget -->
    <rect x="148" y="82" width="96" height="56" rx="7" fill="var(--color-surface-subtle)" />
    <polyline points="158,124 174,108 188,116 204,96 232,104" fill="none" stroke="var(--color-primary-400)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="204" cy="96" r="3" fill="var(--color-primary-600)" />

    <!-- empty slot (pulses, awaiting the flying tiles) -->
    <g class="es-slot">
      <rect x="46" y="148" width="198" height="50" rx="7" fill="none" stroke="var(--color-primary-400)" stroke-width="1.75" stroke-dasharray="6 6" />
      <line x1="145" y1="164" x2="145" y2="182" stroke="var(--color-primary-500)" stroke-width="3" stroke-linecap="round" />
      <line x1="136" y1="173" x2="154" y2="173" stroke="var(--color-primary-500)" stroke-width="3" stroke-linecap="round" />
    </g>

    <!-- tiles flying in toward the slot -->
    <g class="es-fly es-fly-a">
      <rect x="300" y="160" width="34" height="26" rx="5" fill="var(--color-surface-base)" stroke="var(--color-primary-500)" stroke-width="2" />
      <rect x="306" y="174" width="5" height="6" rx="1.5" fill="var(--color-primary-400)" /><rect x="313" y="170" width="5" height="10" rx="1.5" fill="var(--color-primary-500)" /><rect x="320" y="166" width="5" height="14" rx="1.5" fill="var(--color-primary-600)" />
    </g>
    <g class="es-fly es-fly-b">
      <rect x="312" y="120" width="30" height="24" rx="5" fill="var(--color-surface-base)" stroke="var(--color-primary-400)" stroke-width="2" />
      <circle cx="327" cy="132" r="7" fill="none" stroke="var(--color-primary-500)" stroke-width="2.5" stroke-dasharray="22 10" />
    </g>

    <!-- SMALL presenter at the corner -->
    <ellipse cx="300" cy="250" rx="34" ry="7" fill="var(--color-primary-900)" opacity="0.12" />
    <g>
      <!-- legs -->
      <path d="M292 224 L300 224 L298 248 L291 248 Z" fill="var(--color-grey-800)" />
      <path d="M289 246 Q289 250 294 250 L300 250 Q302 249 301 246 Z" fill="var(--color-grey-900)" />
      <path d="M302 224 L310 224 L311 248 L304 248 Z" fill="var(--color-grey-700)" />
      <path d="M303 246 Q303 250 308 250 L314 250 Q316 249 315 246 Z" fill="var(--color-grey-900)" />
      <!-- torso -->
      <path d="M290 206 Q289 202 294 201 L307 201 Q313 202 312 207 L314 224 Q314 227 309 227 L294 227 Q290 227 290 223 Z" fill="var(--color-primary-500)" />
      <path d="M304 201 Q313 202 312 207 L314 224 Q314 227 309 227 L304 227 Z" fill="var(--color-primary-600)" opacity="0.5" />
      <!-- far arm down -->
      <path d="M311 208 Q318 215 315 226 Q314 229 310 228 L308 224 Q310 216 306 210 Z" fill="var(--color-primary-600)" opacity="0.85" />
      <!-- presenting arm (gestures toward the board) -->
      <g class="es-present">
        <path d="M292 207 Q282 203 276 194 Q274 190 278 189 Q282 188 284 192 Q289 200 298 202 Z" fill="var(--color-primary-500)" />
        <ellipse cx="278" cy="191" rx="4" ry="3.5" fill="#f0c29a" />
      </g>
      <!-- head facing the board -->
      <g class="es-head">
        <rect x="299" y="190" width="8" height="9" rx="3" fill="#e8b48c" />
        <ellipse cx="302" cy="180" rx="11" ry="12" fill="#f0c29a" />
        <circle cx="296" cy="181" r="2.2" fill="#e8b48c" />
        <path d="M313 177 Q315 166 302 165 Q289 166 291 177 Q291 171 297 170 Q294 173 295 177 Q300 171 306 172 Q310 173 312 178 Q313 175 313 177 Z" fill="#5b4a3a" />
        <circle cx="297" cy="180" r="1.4" fill="#3a2f25" />
        <path d="M294 185 Q297 188 300 185" stroke="#b5764a" stroke-width="1.4" stroke-linecap="round" fill="none" />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 300, animated: true },
);
</script>

<style>
.es-slot {
  transform-box: fill-box;
  transform-origin: center;
}
.es-fly {
  transform-box: view-box;
}
.es-fly-a {
  animation: es-fly-a 3.4s ease-in-out infinite;
}
.es-fly-b {
  animation: es-fly-b 3.4s ease-in-out infinite;
  animation-delay: -1.7s;
}
.es-present {
  transform-box: view-box;
  transform-origin: 293px 207px;
  animation: es-present 2.8s ease-in-out infinite;
}
.es-head {
  transform-box: view-box;
  transform-origin: 303px 191px;
  animation: es-headtilt 4s ease-in-out infinite;
}
.es-slot {
  animation: es-slot 2.8s ease-in-out infinite;
}

@keyframes es-fly-a {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  60% {
    transform: translate(-150px, 12px);
    opacity: 1;
  }
  72%,
  100% {
    transform: translate(-160px, 14px);
    opacity: 0;
  }
}
@keyframes es-fly-b {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  15% {
    opacity: 1;
  }
  60% {
    transform: translate(-176px, 42px);
    opacity: 1;
  }
  72%,
  100% {
    transform: translate(-186px, 46px);
    opacity: 0;
  }
}
@keyframes es-present {
  0%,
  100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(-7deg);
  }
}
@keyframes es-headtilt {
  0%,
  100% {
    transform: rotate(-1.5deg);
  }
  50% {
    transform: rotate(1deg);
  }
}
@keyframes es-slot {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.03);
    opacity: 1;
  }
}

.es-static :where(.es-fly, .es-present, .es-head, .es-slot) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-fly, .es-present, .es-head, .es-slot) {
    animation: none;
  }
}
</style>
