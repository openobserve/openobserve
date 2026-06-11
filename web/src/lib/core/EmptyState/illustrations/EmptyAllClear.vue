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
  EmptyAllClear — "you're all caught up". Composition: a fully RECLINED figure
  kicked back on a beanbag, feet up, hands behind head — a horizontal/diagonal
  body axis that contrasts with every upright scene. Micro-anim: sun-rays rotate,
  the check badge pops + draws, sparkles twinkle. CSS motion gated by `animated`
  + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="You're all caught up"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <!-- glow + slow rays (upper right) -->
    <circle cx="262" cy="92" r="58" fill="var(--color-warning-300)" opacity="0.12" />
    <g class="es-rays" stroke="var(--color-warning-400)" stroke-width="3" stroke-linecap="round" opacity="0.5">
      <line x1="262" y1="30" x2="262" y2="18" /><line x1="262" y1="154" x2="262" y2="166" />
      <line x1="200" y1="92" x2="188" y2="92" /><line x1="324" y1="92" x2="336" y2="92" />
      <line x1="218" y1="48" x2="210" y2="40" /><line x1="306" y1="136" x2="314" y2="144" />
      <line x1="306" y1="48" x2="314" y2="40" /><line x1="218" y1="136" x2="210" y2="144" />
    </g>

    <!-- check badge (pops) -->
    <g class="es-badge">
      <circle cx="262" cy="92" r="26" fill="var(--color-success-100)" />
      <circle cx="262" cy="92" r="26" fill="none" stroke="var(--color-success-500)" stroke-width="2.5" />
      <path class="es-check" d="M251 93 L259 101 L275 84" fill="none" stroke="var(--color-success-700)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
    </g>
    <g class="es-spark es-spark-a" transform="translate(300 120)">
      <path d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="var(--color-success-500)" />
    </g>
    <g class="es-spark es-spark-b" transform="translate(224 60)">
      <path d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z" fill="var(--color-primary-400)" />
    </g>

    <ellipse cx="178" cy="246" rx="120" ry="11" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- beanbag -->
    <path d="M96 232 Q86 196 138 190 Q196 186 200 222 Q202 238 150 240 Q104 240 96 232 Z" fill="var(--color-surface-subtle)" stroke="var(--color-border-default)" stroke-width="2" />
    <!-- footrest pouf -->
    <ellipse cx="252" cy="214" rx="26" ry="14" fill="var(--color-surface-subtle)" stroke="var(--color-border-default)" stroke-width="2" />

    <!-- reclined character -->
    <g class="es-recline">
      <!-- legs extended onto the pouf, ankles crossed -->
      <path d="M150 206 L226 196 L250 200 L250 207 L228 205 L152 216 Z" fill="var(--color-grey-700)" />
      <path d="M150 214 L222 206 L246 210 L245 216 L224 214 L152 222 Z" fill="var(--color-grey-800)" />
      <path d="M246 198 L262 195 L266 201 L249 205 Z" fill="var(--color-grey-900)" />
      <path d="M242 208 L258 205 L262 211 L245 215 Z" fill="var(--color-grey-900)" />

      <!-- torso reclined up-left -->
      <path d="M150 210 Q142 212 140 203 L122 178 Q118 172 124 168 L133 171 Q150 190 158 204 Z" fill="var(--color-primary-500)" />
      <path d="M140 203 L122 178 Q118 172 124 168 L130 170 L135 192 Z" fill="var(--color-primary-600)" opacity="0.5" />

      <!-- arms behind head -->
      <path d="M132 176 Q124 166 126 154 Q127 148 133 150 Q138 153 137 161 Q136 170 142 174 Z" fill="var(--color-primary-600)" opacity="0.85" />
      <path d="M144 182 Q138 170 142 158 Q144 152 150 155 Q154 159 152 167 Q150 176 156 180 Z" fill="var(--color-primary-500)" />

      <!-- head (content, eyes closed) -->
      <g>
        <ellipse cx="120" cy="166" rx="15" ry="16" fill="#f0c29a" transform="rotate(-28 120 166)" />
        <path d="M106 156 Q108 140 124 141 Q140 144 136 160 Q135 152 127 150 Q131 155 129 161 Q122 151 114 154 Q108 156 107 164 Z" fill="#5b4a3a" />
        <path d="M110 164 Q114 167 118 164" stroke="#3a2f25" stroke-width="1.7" stroke-linecap="round" fill="none" />
        <path d="M122 161 Q126 164 130 160" stroke="#3a2f25" stroke-width="1.7" stroke-linecap="round" fill="none" />
        <path d="M111 172 Q116 177 122 170" stroke="#b5764a" stroke-width="1.7" stroke-linecap="round" fill="none" />
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
.es-badge,
.es-spark {
  transform-box: fill-box;
  transform-origin: center;
}
.es-rays {
  transform-box: view-box;
  transform-origin: 262px 92px;
  animation: es-rays 22s linear infinite;
}
.es-badge {
  animation: es-pop 3.4s ease-in-out infinite;
}
.es-check {
  stroke-dasharray: 40;
  animation: es-draw 3.4s ease-in-out infinite;
}
.es-recline {
  transform-box: view-box;
  transform-origin: 150px 210px;
  animation: es-rest 5.5s ease-in-out infinite;
}
.es-spark-a {
  animation: es-twinkle 2.4s ease-in-out infinite;
}
.es-spark-b {
  animation: es-twinkle 3s ease-in-out infinite;
  animation-delay: -1s;
}

@keyframes es-rays {
  to {
    transform: rotate(360deg);
  }
}
@keyframes es-pop {
  0%,
  46%,
  100% {
    transform: scale(1);
  }
  54% {
    transform: scale(1.07);
  }
  66% {
    transform: scale(1);
  }
}
@keyframes es-draw {
  0%,
  40% {
    stroke-dashoffset: 40;
  }
  60%,
  100% {
    stroke-dashoffset: 0;
  }
}
@keyframes es-rest {
  0%,
  100% {
    transform: rotate(-0.8deg);
  }
  50% {
    transform: rotate(0.8deg);
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

.es-static :where(.es-rays, .es-badge, .es-check, .es-recline, .es-spark) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-rays, .es-badge, .es-check, .es-recline, .es-spark) {
    animation: none;
  }
}
</style>
