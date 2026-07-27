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
  EmptyOrbit — a central node with dots orbiting around it on two rings turning
  in opposite directions. Continuous rotation reads as "live system, nothing
  here yet". Pure SMIL, token colors, `animated` gate.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Waiting for data"
  >
    <ellipse cx="104" cy="80" rx="86" ry="54" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- orbit guides -->
    <circle
      cx="104"
      cy="80"
      r="46"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      stroke-dasharray="3 5"
    />
    <circle
      cx="104"
      cy="80"
      r="28"
      stroke="var(--color-border-default)"
      stroke-width="1.25"
      stroke-dasharray="3 5"
    />

    <!-- outer orbit: two dots, clockwise -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="0 104 80;360 104 80"
        dur="7s"
        repeatCount="indefinite"
      />
      <circle cx="150" cy="80" r="6" fill="var(--color-primary-500)" />
      <circle cx="58" cy="80" r="4" fill="var(--color-primary-300)" />
    </g>

    <!-- inner orbit: one dot, counter-clockwise -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="rotate"
        values="360 104 80;0 104 80"
        dur="4.5s"
        repeatCount="indefinite"
      />
      <circle cx="132" cy="80" r="5" fill="var(--color-primary-400)" />
    </g>

    <!-- central node -->
    <circle
      cx="104"
      cy="80"
      r="16"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-strong)"
      stroke-width="1.5"
    />
    <circle cx="104" cy="80" r="6" fill="var(--color-primary-600)">
      <animate
        v-if="animated"
        attributeName="r"
        values="6;7.5;6"
        dur="2.4s"
        repeatCount="indefinite"
      />
    </circle>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ width?: number; animated?: boolean }>(), { width: 208, animated: true });
</script>
