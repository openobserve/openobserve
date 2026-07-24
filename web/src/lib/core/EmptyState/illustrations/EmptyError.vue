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
  EmptyError — "something went wrong". Composition: a person slumped low on the
  floor, head in hands, under a BIG leaning cracked panel that looms over them —
  a compact, low, dejected layout unlike any upright scene. Micro-anim: the
  warning pulses, the panel creaks (tiny tilt), shards drift. Pure SMIL motion
  gated behind `animated` (prefers-reduced-motion; OEmptyState wires this up
  automatically).
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 360 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Something went wrong"
  >
    <!-- jagged backdrop -->
    <path
      d="M150 44 L210 64 L286 60 L268 120 L300 168 L232 198 L150 210 L96 200 L60 176 L80 132 L52 96 L104 78 Z"
      fill="var(--color-surface-subtle)"
      opacity="0.85"
    />

    <!-- floating shards -->
    <path d="M286 120 l10 4 -4 9 z" fill="var(--color-primary-300)">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 -9; 0 0"
        keyTimes="0;0.5;1"
        dur="5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 291 126.5; 35 291 126.5; 0 291 126.5"
        keyTimes="0;0.5;1"
        dur="5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.6; 1; 0.6"
        keyTimes="0;0.5;1"
        dur="5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
    </path>
    <path d="M256 70 l8 -5 4 9 z" fill="var(--color-error-400)" opacity="0.7">
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 -9; 0 0"
        keyTimes="0;0.5;1"
        dur="6.2s"
        begin="-2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 262 69.5; 35 262 69.5; 0 262 69.5"
        keyTimes="0;0.5;1"
        dur="6.2s"
        begin="-2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.6; 1; 0.6"
        keyTimes="0;0.5;1"
        dur="6.2s"
        begin="-2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
    </path>

    <ellipse cx="186" cy="252" rx="120" ry="11" fill="var(--color-primary-900)" opacity="0.12" />

    <!-- big leaning cracked panel (looms over) -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="-6 103 198; -7.5 103 198; -6 103 198"
        keyTimes="0;0.5;1"
        dur="5s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <rect
        x="42"
        y="74"
        width="122"
        height="124"
        rx="13"
        fill="var(--color-surface-base)"
        stroke="var(--color-border-strong)"
        stroke-width="2.5"
      />
      <rect
        x="56"
        y="88"
        width="40"
        height="7"
        rx="3.5"
        fill="var(--color-border-strong)"
        opacity="0.45"
      />
      <line
        x1="42"
        y1="104"
        x2="164"
        y2="104"
        stroke="var(--color-border-default)"
        stroke-width="1.5"
      />
      <path
        d="M104 104 L95 128 L110 142 L99 166 L106 186"
        stroke="var(--color-border-strong)"
        stroke-width="2"
        fill="none"
        stroke-linejoin="round"
        opacity="0.7"
      />
      <path
        d="M58 148 L74 148 L84 148 M122 138 L138 138 L152 138"
        stroke="var(--color-error-400)"
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
        opacity="0.8"
      />
    </g>

    <!-- warning (pulses): scale about its centre (214 107). SMIL scale is
         origin-based, so the paired translate compensates to keep it in place. -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; -12.84 -6.42; 0 0"
        keyTimes="0;0.5;1"
        dur="2.2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="scale"
        values="1; 1.06; 1"
        keyTimes="0;0.5;1"
        dur="2.2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        additive="sum"
      />
      <animate
        v-if="animated"
        attributeName="opacity"
        values="0.92; 1; 0.92"
        keyTimes="0;0.5;1"
        dur="2.2s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <path
        d="M214 86 L238 128 H190 Z"
        fill="var(--color-warning-100)"
        stroke="var(--color-warning-500)"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <line
        x1="214"
        y1="100"
        x2="214"
        y2="113"
        stroke="var(--color-warning-700)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
      <circle cx="214" cy="120" r="2.2" fill="var(--color-warning-700)" />
    </g>

    <!-- slumped person (head in hands) -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="0 0; 0 2; 0 0"
        keyTimes="0;0.5;1"
        dur="4.6s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
      />
      <!-- bent legs / knees up -->
      <path
        d="M176 244 L176 214 Q176 204 188 204 L210 210 Q218 212 218 222 L218 244 Z"
        fill="var(--color-grey-700)"
      />
      <ellipse cx="190" cy="212" rx="9" ry="7" fill="var(--color-grey-800)" />
      <path d="M172 242 L192 240 L194 250 L172 251 Z" fill="var(--color-grey-900)" />

      <!-- hunched torso -->
      <path
        d="M188 200 Q182 218 202 224 Q220 226 221 210 Q221 199 209 195 Q196 191 188 200 Z"
        fill="var(--color-primary-500)"
      />
      <path
        d="M210 196 Q221 200 221 210 Q221 220 211 223 Q217 214 213 202 Z"
        fill="var(--color-primary-600)"
        opacity="0.5"
      />

      <!-- arms up to the face -->
      <path
        d="M196 202 Q186 196 182 186 Q180 181 185 182 Q190 184 192 190 Q194 196 200 199 Z"
        fill="var(--color-primary-500)"
      />
      <path
        d="M214 200 Q210 192 206 184 Q204 179 209 180 Q214 182 215 189 Q216 195 218 199 Z"
        fill="var(--color-primary-600)"
        opacity="0.85"
      />

      <!-- bowed head, face hidden in hands -->
      <g>
        <animateTransform
          v-if="animated"
          attributeName="transform"
          type="translate"
          values="0 0; 0 2; 0 0"
          keyTimes="0;0.5;1"
          dur="4.6s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
        />
        <ellipse
          cx="198"
          cy="184"
          rx="15"
          ry="15"
          fill="var(--color-illustration-sand)"
          transform="rotate(18 198 184)"
        />
        <path
          d="M183 180 Q182 164 199 163 Q216 165 214 182 Q214 172 206 170 Q210 175 208 182 Q200 171 191 174 Q185 176 184 184 Z"
          fill="var(--color-illustration-umber)"
        />
        <!-- hands covering the face -->
        <ellipse
          cx="190"
          cy="190"
          rx="5"
          ry="6"
          fill="var(--color-illustration-sand)"
          transform="rotate(20 190 190)"
        />
        <ellipse
          cx="205"
          cy="188"
          rx="5"
          ry="6"
          fill="var(--color-illustration-tan)"
          transform="rotate(20 205 188)"
        />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 300, animated: true });
</script>
