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
  the check badge pops + draws, sparkles twinkle. Pure SMIL motion gated behind
  `animated` (prefers-reduced-motion; OEmptyState wires this up automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="You're all caught up"
  >
    <!-- glow + slow rays (upper right) -->
    <circle cx="262" cy="92" r="58" fill="var(--color-warning-300)" opacity="0.12" />
    <g stroke="var(--color-warning-400)" stroke-width="3" stroke-linecap="round" opacity="0.5">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 262 92; 360 262 92"
        keyTimes="0;1"
        dur="22s"
        repeatCount="indefinite"
      />
      <line x1="262" y1="30" x2="262" y2="18" />
      <line x1="262" y1="154" x2="262" y2="166" />
      <line x1="200" y1="92" x2="188" y2="92" />
      <line x1="324" y1="92" x2="336" y2="92" />
      <line x1="218" y1="48" x2="210" y2="40" />
      <line x1="306" y1="136" x2="314" y2="144" />
      <line x1="306" y1="48" x2="314" y2="40" />
      <line x1="218" y1="136" x2="210" y2="144" />
    </g>

    <!-- check badge (pops) -->
    <!-- scale about centre (262 92); the paired translate keeps that centre fixed -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 0; -18.34 -6.44; 0 0; 0 0"
        keyTimes="0;0.46;0.54;0.66;1"
        dur="3.4s"
        repeatCount="indefinite"
        additive="sum"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="scale"
        values="1;1;1.07;1;1"
        keyTimes="0;0.46;0.54;0.66;1"
        dur="3.4s"
        repeatCount="indefinite"
        additive="sum"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <circle cx="262" cy="92" r="26" fill="var(--color-success-100)" />
      <circle
        cx="262"
        cy="92"
        r="26"
        fill="none"
        stroke="var(--color-success-500)"
        stroke-width="2.5"
      />
      <path
        d="M251 93 L259 101 L275 84"
        fill="none"
        stroke="var(--color-success-700)"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-dasharray="40"
      >
        <animate
          v-if="animated"
          attributeName="stroke-dashoffset"
          values="40;40;0;0"
          keyTimes="0;0.4;0.6;1"
          dur="3.4s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"
        />
      </path>
    </g>
    <!-- twinkling sparkles: star drawn around 0,0, additive scale twinkles in place; b's negative begin desyncs it from a -->
    <g transform="translate(300 120)">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.35;1;0.35"
        keyTimes="0;0.5;1"
        dur="2.4s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="scale"
        values="0.6;1.1;0.6"
        additive="sum"
        keyTimes="0;0.5;1"
        dur="2.4s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <path
        d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z"
        fill="var(--color-success-500)"
      />
    </g>
    <g transform="translate(224 60)">
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.35;1;0.35"
        keyTimes="0;0.5;1"
        dur="3s"
        begin="-1s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="scale"
        values="0.6;1.1;0.6"
        additive="sum"
        keyTimes="0;0.5;1"
        dur="3s"
        begin="-1s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <path
        d="M0 -5 L1.2 -1.2 L5 0 L1.2 1.2 L0 5 L-1.2 1.2 L-5 0 L-1.2 -1.2 Z"
        fill="var(--color-primary-400)"
      />
    </g>

    <ellipse cx="178" cy="246" rx="120" ry="11" fill="var(--color-primary-900)" opacity="0.1" />

    <!-- beanbag -->
    <path
      d="M96 232 Q86 196 138 190 Q196 186 200 222 Q202 238 150 240 Q104 240 96 232 Z"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-default)"
      stroke-width="2"
    />
    <!-- footrest pouf -->
    <ellipse
      cx="252"
      cy="214"
      rx="26"
      ry="14"
      fill="var(--color-surface-subtle)"
      stroke="var(--color-border-default)"
      stroke-width="2"
    />

    <!-- reclined character (breathes with a gentle rotate about 150 210) -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="-0.8 150 210; 0.8 150 210; -0.8 150 210"
        keyTimes="0;0.5;1"
        dur="5.5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <!-- legs extended onto the pouf, ankles crossed -->
      <path
        d="M150 206 L226 196 L250 200 L250 207 L228 205 L152 216 Z"
        fill="var(--color-grey-700)"
      />
      <path
        d="M150 214 L222 206 L246 210 L245 216 L224 214 L152 222 Z"
        fill="var(--color-grey-800)"
      />
      <path d="M246 198 L262 195 L266 201 L249 205 Z" fill="var(--color-grey-900)" />
      <path d="M242 208 L258 205 L262 211 L245 215 Z" fill="var(--color-grey-900)" />

      <!-- torso reclined up-left -->
      <path
        d="M150 210 Q142 212 140 203 L122 178 Q118 172 124 168 L133 171 Q150 190 158 204 Z"
        fill="var(--color-primary-500)"
      />
      <path
        d="M140 203 L122 178 Q118 172 124 168 L130 170 L135 192 Z"
        fill="var(--color-primary-600)"
        opacity="0.5"
      />

      <!-- arms behind head -->
      <path
        d="M132 176 Q124 166 126 154 Q127 148 133 150 Q138 153 137 161 Q136 170 142 174 Z"
        fill="var(--color-primary-600)"
        opacity="0.85"
      />
      <path
        d="M144 182 Q138 170 142 158 Q144 152 150 155 Q154 159 152 167 Q150 176 156 180 Z"
        fill="var(--color-primary-500)"
      />

      <!-- head (content, eyes closed) -->
      <g>
        <ellipse
          cx="120"
          cy="166"
          rx="15"
          ry="16"
          fill="var(--color-illustration-sand)"
          transform="rotate(-28 120 166)"
        />
        <path
          d="M106 156 Q108 140 124 141 Q140 144 136 160 Q135 152 127 150 Q131 155 129 161 Q122 151 114 154 Q108 156 107 164 Z"
          fill="var(--color-illustration-umber)"
        />
        <path
          d="M110 164 Q114 167 118 164"
          stroke="var(--color-illustration-espresso)"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M122 161 Q126 164 130 160"
          stroke="var(--color-illustration-espresso)"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        />
        <path
          d="M111 172 Q116 177 122 170"
          stroke="var(--color-illustration-clay)"
          stroke-width="1.7"
          stroke-linecap="round"
          fill="none"
        />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 300, animated: true });
</script>
