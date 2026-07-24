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
  EmptyNoResults — empty-state illustration for "no matching results": a result
  list whose rows have dissolved to nothing while a magnifier sweeps across,
  finding empty space. Pure SMIL animation, token colors (correct in light and
  dark). All motion is gated behind the `animated` prop so callers can honour
  prefers-reduced-motion (OEmptyState wires this up automatically).

  Sizing: the SVG carries a viewBox but NO fixed height — set `width` and the
  height follows the 4:3 aspect ratio, so OEmptyState can scale it per size.
-->
<template>
  <svg
    :width="width"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="t('emptyState.illustrations.noMatchingResults')"
  >
    <!-- soft brand glow -->
    <ellipse
      cx="104"
      cy="82"
      rx="90"
      ry="56"
      fill="var(--color-primary-500)"
      opacity="0.06"
    />

    <!-- result card -->
    <rect
      x="44"
      y="34"
      width="120"
      height="90"
      rx="12"
      fill="var(--color-surface-base)"
      stroke="var(--color-border-default)"
      stroke-width="1.5"
    />

    <!-- applied-filter chip + floating accents -->
    <rect x="60" y="22" width="44" height="10" rx="5" fill="var(--color-surface-subtle)" stroke="var(--color-border-default)" stroke-width="1" />
    <circle cx="68" cy="27" r="2" fill="var(--color-primary-400)" />
    <g fill="var(--color-border-default)" opacity="0.55">
      <circle cx="24" cy="40" r="2" /><circle cx="186" cy="116" r="2" /><circle cx="28" cy="112" r="1.5" /><circle cx="182" cy="44" r="1.5" />
    </g>

    <!-- result rows: each fades out then back on a slow loop, as if the matches
         keep slipping away. Staggered so the list reads as "emptying". -->
    <g>
      <rect x="60" y="52" width="88" height="8" rx="4" fill="var(--color-border-strong)" opacity="0.55">
        <animate v-if="animated" attributeName="opacity" values="0.55;0.12;0.55" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="60" y="70" width="66" height="8" rx="4" fill="var(--color-border-strong)" opacity="0.4">
        <animate v-if="animated" attributeName="opacity" values="0.4;0.1;0.4" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite" begin="0.3s" />
      </rect>
      <rect x="60" y="88" width="78" height="8" rx="4" fill="var(--color-border-strong)" opacity="0.3">
        <animate v-if="animated" attributeName="opacity" values="0.3;0.08;0.3" keyTimes="0;0.5;1" dur="3.2s" repeatCount="indefinite" begin="0.6s" />
      </rect>
    </g>

    <!-- magnifier: sweeps gently left↔right across the card looking for matches -->
    <g>
      <animateTransform
        v-if="animated"
        attributeName="transform"
        type="translate"
        values="-14 0; 16 6; -14 0"
        keyTimes="0;0.5;1"
        dur="4.6s"
        repeatCount="indefinite"
        calcMode="spline"
        keySplines="0.4 0 0.2 1; 0.4 0 0.2 1"
      />
      <!-- lens -->
      <circle
        cx="132"
        cy="70"
        r="20"
        fill="var(--color-surface-base)"
        fill-opacity="0.6"
        stroke="var(--color-primary-500)"
        stroke-width="3"
      />
      <!-- a small empty "·" inside the lens to reinforce "nothing found" -->
      <circle cx="132" cy="70" r="3" fill="var(--color-primary-400)">
        <animate v-if="animated" attributeName="opacity" values="1;0.3;1" keyTimes="0;0.5;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <!-- handle -->
      <line
        x1="147"
        y1="85"
        x2="160"
        y2="98"
        stroke="var(--color-primary-500)"
        stroke-width="3.5"
        stroke-linecap="round"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

withDefaults(
  defineProps<{
    /** Rendered SVG width in px; height follows the 4:3 viewBox. */
    width?: number;
    /** When false, all SMIL motion is omitted (prefers-reduced-motion). */
    animated?: boolean;
  }>(),
  { width: 208, animated: true },
);
</script>
