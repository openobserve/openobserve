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
  EmptyConnect — "no streams yet" as a TOP-DOWN ingestion diagram: three
  source nodes across the top (server / code / cloud) send packets down
  right-angle, rounded-elbow flowchart connectors that merge into a database
  cylinder at the bottom — sources above, your data below, gravity doing the
  storytelling. Built on EmptyPipeline's proven grammar (nodes + connectors +
  travelling packets), but routed like a real diagram instead of diagonal
  lines. Packets travel via multi-stop translate() keyframes that trace each
  elbow's vertices exactly (down → across → down), so motion still tracks
  its path precisely — the same discipline that made the earlier straight
  version safe, just with more stops. No +/add glyphs (they read as
  buttons). Landing dots pulse opacity-only as each packet arrives. CSS
  motion gated by `animated` + prefers-reduced-motion.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 240 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Connect a data source to create your first stream"
    :class="['es-root', { 'es-static': !animated }]"
  >
    <circle cx="120" cy="86" r="72" fill="var(--color-primary-500)" opacity="0.05" />
    <ellipse cx="120" cy="169" rx="48" ry="6" fill="var(--color-primary-900)" opacity="0.1" />
    <g fill="var(--color-border-default)" opacity="0.5">
      <circle cx="30" cy="92" r="2" />
      <circle cx="210" cy="92" r="2" />
      <circle cx="52" cy="130" r="1.6" />
      <circle cx="188" cy="130" r="1.6" />
      <circle cx="120" cy="60" r="1.6" />
    </g>

    <!-- source nodes across the top: server / code / upload -->
    <g>
      <rect
        x="36"
        y="16"
        width="32"
        height="26"
        rx="6"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-strong)"
        stroke-width="1.75"
      />
      <line
        x1="42"
        y1="24"
        x2="55"
        y2="24"
        stroke="var(--color-border-strong)"
        stroke-width="1.75"
        stroke-linecap="round"
        opacity="0.6"
      />
      <line
        x1="42"
        y1="31"
        x2="55"
        y2="31"
        stroke="var(--color-border-strong)"
        stroke-width="1.75"
        stroke-linecap="round"
        opacity="0.6"
      />
      <circle cx="60" cy="24" r="1.6" fill="var(--color-primary-500)" />
      <circle cx="60" cy="31" r="1.6" fill="var(--color-primary-400)" />
    </g>
    <g>
      <rect
        x="104"
        y="8"
        width="32"
        height="26"
        rx="6"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-strong)"
        stroke-width="1.75"
      />
      <path
        d="M115 17.5 l-4.5 3.5 4.5 3.5 M125 17.5 l4.5 3.5 -4.5 3.5"
        stroke="var(--color-primary-500)"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
    <g>
      <rect
        x="172"
        y="16"
        width="32"
        height="26"
        rx="6"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-strong)"
        stroke-width="1.75"
      />
      <!-- cloud — matches the "cloud-upload" icon used on the ingestion CTA
           elsewhere, so this source clearly reads as a cloud/agent source
           (Feather Icons' well-tested "cloud" path, scaled to fit) -->
      <g
        transform="translate(174.5 15) scale(0.9)"
        fill="none"
        stroke="var(--color-primary-400)"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </g>
    </g>

    <!-- dashed flowchart connectors: right-angle routing with rounded-default elbows,
         merging onto the database like a real diagram, not diagonal lines -->
    <g
      stroke="var(--color-primary-300)"
      stroke-width="1.75"
      stroke-dasharray="4 5"
      stroke-linecap="round"
      fill="none"
    >
      <path d="M52 46 L52 64 Q52 70 58 70 L98 70 Q104 70 104 76 L104 104" />
      <path d="M120 38 L120 100" />
      <path d="M188 46 L188 64 Q188 70 182 70 L142 70 Q136 70 136 76 L136 104" />
    </g>

    <!-- database cylinder receiving the streams -->
    <path
      d="M88 112 V158 A32 7.5 0 0 0 152 158 V112"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="2.25"
    />
    <path
      d="M88 127 A32 7.5 0 0 0 152 127"
      stroke="var(--color-border-default)"
      stroke-width="1.5"
      opacity="0.7"
    />
    <path
      d="M88 143 A32 7.5 0 0 0 152 143"
      stroke="var(--color-border-default)"
      stroke-width="1.5"
      opacity="0.7"
    />
    <ellipse
      cx="120"
      cy="112"
      rx="32"
      ry="7.5"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-strong)"
      stroke-width="2.25"
    />

    <!-- landing dots on the database rim, pulsing as packets arrive -->
    <circle class="es-in es-in-a" cx="104" cy="107" r="2.25" fill="var(--color-primary-400)" />
    <circle class="es-in es-in-b" cx="120" cy="105" r="2.25" fill="var(--color-primary-400)" />
    <circle class="es-in es-in-c" cx="136" cy="107" r="2.25" fill="var(--color-primary-400)" />

    <!-- packets travelling from each source down to the database -->
    <circle class="es-pk es-pk-a" cx="52" cy="46" r="3" fill="var(--color-primary-500)" />
    <circle class="es-pk es-pk-b" cx="120" cy="38" r="3" fill="var(--color-primary-600)" />
    <circle class="es-pk es-pk-c" cx="188" cy="46" r="3" fill="var(--color-primary-500)" />

    <!-- ambient sparkles -->
    <g class="es-spark es-spark-a" transform="translate(206 118)">
      <path
        d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z"
        fill="var(--color-primary-400)"
      />
    </g>
    <g class="es-spark es-spark-b" transform="translate(36 116)">
      <path
        d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z"
        fill="var(--color-primary-300)"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 260, animated: true });
</script>

<style scoped>
/* keep(keyframes): SVG illustration animation. Scoped on purpose (W2.b): the
   20 illustrations reused generic keyframe names (es-pulse, es-twinkle, …) with
   DIFFERENT bodies from unscoped blocks — a global name collision where the
   last-loaded illustration hijacked the others' animations. Vue rewrites scoped
   keyframe names per component, which ends the collision. All selectors and the
   es-static gate live in this file's own template. */
/* packets — straight-line translate along each connector (per-line deltas) */
.es-pk {
  transform-box: fill-box;
  transform-origin: center;
}
.es-pk-a {
  animation: es-pk-a 2.1s linear infinite;
}
.es-pk-b {
  animation: es-pk-b 2.1s linear infinite;
  animation-delay: -0.7s;
}
.es-pk-c {
  animation: es-pk-c 2.1s linear infinite;
  animation-delay: -1.4s;
}
@keyframes es-pk-a {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  28% {
    transform: translate(0, 24px);
  }
  62% {
    transform: translate(52px, 24px);
  }
  84% {
    transform: translate(52px, 58px);
    opacity: 1;
  }
  100% {
    transform: translate(52px, 58px);
    opacity: 0;
  }
}
@keyframes es-pk-b {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  12% {
    opacity: 1;
  }
  82% {
    opacity: 1;
  }
  100% {
    transform: translate(0, 62px);
    opacity: 0;
  }
}
@keyframes es-pk-c {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  28% {
    transform: translate(0, 24px);
  }
  62% {
    transform: translate(-52px, 24px);
  }
  84% {
    transform: translate(-52px, 58px);
    opacity: 1;
  }
  100% {
    transform: translate(-52px, 58px);
    opacity: 0;
  }
}
/* landing dots pulse opacity-only, offset to match each packet's arrival */
.es-in {
  animation: es-land 2.1s ease-in-out infinite;
}
.es-in-a {
  animation-delay: 0s;
}
.es-in-b {
  animation-delay: -0.7s;
}
.es-in-c {
  animation-delay: -1.4s;
}
@keyframes es-land {
  0%,
  75% {
    opacity: 0.3;
  }
  92% {
    opacity: 1;
  }
  100% {
    opacity: 0.3;
  }
}
.es-spark {
  transform-box: fill-box;
  transform-origin: center;
}
.es-spark-a {
  animation: es-twinkle 2.6s ease-in-out infinite;
}
.es-spark-b {
  animation: es-twinkle 3.1s ease-in-out infinite;
  animation-delay: -1.1s;
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
.es-static :where(.es-pk) {
  animation: none;
  opacity: 0;
}
.es-static :where(.es-in) {
  animation: none;
  opacity: 0.6;
}
.es-static :where(.es-spark) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  :where(.es-pk) {
    animation: none;
    opacity: 0;
  }
  :where(.es-in) {
    animation: none;
    opacity: 0.6;
  }
  :where(.es-spark) {
    animation: none;
  }
}
</style>
