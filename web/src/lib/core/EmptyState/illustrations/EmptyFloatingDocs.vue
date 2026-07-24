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
  EmptyFloatingDocs — a small fan of record cards bobbing gently at staggered
  phases, with a sparkle. Friendly, continuous floating motion. Pure SMIL,
  token colors, `animated` gate. Good for "no items / records yet".
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.floatingDocs.ariaLabel')"
  >
    <ellipse cx="104" cy="86" rx="84" ry="48" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- back card -->
    <g transform="rotate(-9 104 80)">
      <animateTransform v-if="animated" attributeName="transform" type="translate" additive="sum" values="0 0;0 -5;0 0" dur="4.4s" repeatCount="indefinite" begin="0.6s" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" keyTimes="0;0.5;1" />
      <rect x="60" y="40" width="64" height="80" rx="9" fill="var(--color-surface-base)" stroke="var(--color-border-default)" stroke-width="1.5" />
      <rect x="70" y="54" width="32" height="5" rx="2.5" fill="var(--color-border-strong)" opacity="0.5" />
      <rect x="70" y="66" width="44" height="4" rx="2" fill="var(--color-border-default)" />
    </g>

    <!-- front card -->
    <g transform="rotate(8 110 84)">
      <animateTransform v-if="animated" attributeName="transform" type="translate" additive="sum" values="0 0;0 -7;0 0" dur="3.8s" repeatCount="indefinite" begin="0s" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" keyTimes="0;0.5;1" />
      <rect x="86" y="46" width="66" height="82" rx="9" fill="var(--color-surface-base)" stroke="var(--color-border-strong)" stroke-width="1.5" />
      <circle cx="100" cy="62" r="7" fill="var(--color-primary-500)" opacity="0.9" />
      <rect x="113" y="58" width="30" height="5" rx="2.5" fill="var(--color-border-strong)" opacity="0.55" />
      <rect x="96" y="84" width="46" height="4.5" rx="2.25" fill="var(--color-border-default)" />
      <rect x="96" y="96" width="38" height="4.5" rx="2.25" fill="var(--color-border-default)" />
      <rect x="96" y="108" width="42" height="4.5" rx="2.25" fill="var(--color-border-default)" />
    </g>

    <!-- sparkle (path centered at origin so it scales about its own center) -->
    <g transform="translate(152 46)">
      <path d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z" fill="var(--color-primary-400)">
        <animate v-if="animated" attributeName="opacity" values="0.3;1;0.3" dur="2.6s" repeatCount="indefinite" />
        <animateTransform v-if="animated" attributeName="transform" type="scale" values="0.7;1.05;0.7" dur="2.6s" repeatCount="indefinite" />
      </path>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 208, animated: true },
);
</script>
