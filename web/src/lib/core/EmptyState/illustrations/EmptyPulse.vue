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
  EmptyPulse — a beacon emitting sonar-style ripples that expand and fade on a
  continuous loop. Calm but clearly alive. Pure SMIL, token colors, `animated`
  gate. Great for "listening / no events yet".
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.listeningForData')"
  >
    <ellipse cx="104" cy="82" rx="86" ry="52" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- expanding ripples (staggered) -->
    <g v-for="(begin, i) in rippleBegins" :key="i">
      <circle cx="104" cy="82" r="10" fill="none" stroke="var(--color-primary-500)" stroke-width="2">
        <animate v-if="animated" attributeName="r" values="10;58" dur="3s" :begin="begin" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0.6 0.3 1" />
        <animate v-if="animated" attributeName="opacity" values="0.55;0" dur="3s" :begin="begin" repeatCount="indefinite" />
        <animate v-if="animated" attributeName="stroke-width" values="2.5;0.5" dur="3s" :begin="begin" repeatCount="indefinite" />
      </circle>
    </g>

    <!-- static halo + core -->
    <circle cx="104" cy="82" r="20" fill="var(--color-primary-500)" opacity="0.1" />
    <circle cx="104" cy="82" r="11" fill="var(--color-primary-600)">
      <animate v-if="animated" attributeName="r" values="11;13;11" dur="3s" repeatCount="indefinite" />
    </circle>
    <circle cx="104" cy="82" r="4.5" fill="var(--color-white)" opacity="0.9" />
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{ width?: number; animated?: boolean }>(),
  { width: 208, animated: true },
);

// three ripples evenly phased across the 3s loop
const rippleBegins = ["0s", "1s", "2s"];
</script>
