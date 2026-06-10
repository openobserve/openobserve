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
  EmptyWaiting — "no data flowing in yet". Composition: a GIANT hourglass is the
  hero, sand trickling through, while a SMALL person sits at its base gazing up.
  Object-led, strong scale contrast — reads nothing like a centred figure.
  Micro-anim: sand grains fall through the neck on a loop; the seated person
  breathes. CSS motion gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Waiting for data to arrive"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- soft halo + dots -->
    <circle cx="138" cy="138" r="96" fill="var(--color-primary-500)" opacity="0.05" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="250" cy="70" r="2" /><circle cx="276" cy="104" r="2" /><circle cx="44" cy="96" r="2" /><circle cx="60" cy="150" r="2" />
    </g>
    <line x1="40" y1="246" x2="320" y2="246" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- giant hourglass -->
    <g>
      <!-- caps -->
      <rect x="92" y="56" width="92" height="12" rx="4" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="2.5" />
      <rect x="92" y="208" width="92" height="12" rx="4" fill="var(--color-surface-subtle)" stroke="var(--color-border-strong)" stroke-width="2.5" />
      <!-- side rails -->
      <path d="M102 68 Q96 138 102 208 M174 68 Q180 138 174 208" stroke="var(--color-border-strong)" stroke-width="2.5" fill="none" />
      <!-- glass bulbs -->
      <path d="M104 68 L172 68 L138 134 Z" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" stroke-linejoin="round" />
      <path d="M138 134 L172 208 L104 208 Z" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="2.5" stroke-linejoin="round" />
      <!-- remaining sand (top) -->
      <path d="M118 104 L158 104 L138 134 Z" fill="var(--color-warning-400)" />
      <!-- collected sand (bottom pile) -->
      <path d="M110 208 L166 208 L138 182 Z" fill="var(--color-warning-400)" />
      <!-- falling grains -->
      <circle class="es-grain es-grain-a" cx="138" cy="138" r="2.4" fill="var(--color-warning-500)" />
      <circle class="es-grain es-grain-b" cx="138" cy="138" r="2" fill="var(--color-warning-500)" />
      <circle class="es-grain es-grain-c" cx="138" cy="138" r="2.4" fill="var(--color-warning-600)" />
    </g>

    <!-- SMALL person seated at the base, gazing up -->
    <ellipse cx="252" cy="248" rx="32" ry="6" fill="var(--color-primary-900)" opacity="0.1" />
    <g class="es-sit">
      <!-- folded legs / lap -->
      <path d="M230 236 Q230 224 252 224 Q274 224 274 236 L274 242 Q274 246 268 246 L236 246 Q230 246 230 240 Z" fill="var(--color-grey-700)" />
      <ellipse cx="240" cy="232" rx="9" ry="7" fill="var(--color-grey-800)" />
      <!-- torso leaning back to look up -->
      <path d="M250 230 Q246 224 252 220 L266 216 Q272 215 274 221 L280 236 Q281 240 275 241 L258 240 Q251 240 250 234 Z" fill="var(--color-primary-500)" />
      <!-- arm: elbow on knee, hand to chin -->
      <path d="M254 226 Q246 222 244 212 Q243 207 248 208 Q252 209 253 214 Q254 220 260 222 Z" fill="var(--color-primary-600)" opacity="0.9" />
      <ellipse cx="247" cy="210" rx="4" ry="3.5" fill="#f0c29a" />
      <!-- head tilted up toward the hourglass -->
      <g class="es-head">
        <ellipse cx="250" cy="200" rx="11" ry="12" fill="#f0c29a" transform="rotate(-12 250 200)" />
        <path d="M239 196 Q236 184 249 182 Q262 183 261 195 Q261 188 255 187 Q258 191 256 196 Q251 188 245 190 Q240 191 239 197 Z" fill="#5b4a3a" />
        <circle cx="246" cy="198" r="1.5" fill="#3a2f25" />
        <path d="M243 203 Q246 205 249 202" stroke="#b5764a" stroke-width="1.4" stroke-linecap="round" fill="none" />
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

<style scoped>
.es-grain,
.es-sit {
  transform-box: fill-box;
  transform-origin: center;
}
.es-grain {
  transform-box: view-box;
}
.es-grain-a {
  animation: es-grain 1.6s linear infinite;
}
.es-grain-b {
  animation: es-grain 1.6s linear infinite;
  animation-delay: -0.55s;
}
.es-grain-c {
  animation: es-grain 1.6s linear infinite;
  animation-delay: -1.1s;
}
.es-sit {
  animation: es-breathe 4s ease-in-out infinite;
}
.es-head {
  transform-box: view-box;
  transform-origin: 250px 206px;
  animation: es-gaze 5s ease-in-out infinite;
}

@keyframes es-grain {
  0% {
    transform: translateY(0);
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    transform: translateY(46px);
    opacity: 0;
  }
}
@keyframes es-breathe {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}
@keyframes es-gaze {
  0%,
  100% {
    transform: rotate(-1.5deg);
  }
  50% {
    transform: rotate(2deg);
  }
}

.es-static :where(.es-grain, .es-sit, .es-head) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-grain, .es-sit, .es-head) {
    animation: none;
  }
}
</style>
