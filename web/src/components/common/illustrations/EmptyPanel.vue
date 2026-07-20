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
  EmptyPanel — a calm, modern empty-state illustration for a dashboard with no
  panels: an empty chart frame whose bars rise from a dashed baseline on a slow
  loop. No "+" badge — the actual "Add panel" action lives in the CTA below the
  illustration, and a decorative "+" here read as a clickable button. Pure SMIL
  animation (no CSS/SCSS); token colors keep it correct in light and dark.
-->
<template>
  <svg
    width="208"
    height="156"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No panels yet"
  >
    <!-- soft brand glow -->
    <ellipse cx="104" cy="84" rx="90" ry="56" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- chart frame -->
    <rect x="44" y="34" width="120" height="90" rx="12" fill="var(--color-surface-base)" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- y/x axes -->
    <line x1="62" y1="48" x2="62" y2="108" stroke="var(--color-border-default)" stroke-width="1.5" stroke-linecap="round" />
    <line x1="62" y1="108" x2="148" y2="108" stroke="var(--color-border-default)" stroke-width="1.5" stroke-linecap="round" />

    <!-- dashed baseline -->
    <line x1="62" y1="86" x2="148" y2="86" stroke="var(--color-border-strong)" stroke-width="1" stroke-dasharray="3 4" opacity="0.7" />

    <!-- bars rising from the baseline -->
    <g>
      <rect x="74" y="108" width="12" height="0" rx="2.5" fill="var(--color-primary-400)">
        <animate attributeName="height" values="0;30;30;0" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0s" />
        <animate attributeName="y" values="108;78;78;108" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="94" y="108" width="12" height="0" rx="2.5" fill="var(--color-primary-500)">
        <animate attributeName="height" values="0;46;46;0" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0.25s" />
        <animate attributeName="y" values="108;62;62;108" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0.25s" />
      </rect>
      <rect x="114" y="108" width="12" height="0" rx="2.5" fill="var(--color-primary-400)">
        <animate attributeName="height" values="0;22;22;0" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0.5s" />
        <animate attributeName="y" values="108;86;86;108" keyTimes="0;0.35;0.85;1" dur="3.4s" repeatCount="indefinite" begin="0.5s" />
      </rect>
    </g>
  </svg>
</template>
