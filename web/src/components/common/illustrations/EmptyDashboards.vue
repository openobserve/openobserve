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
  EmptyDashboards — a calm, modern empty-state illustration of a dashboard:
  a soft card holding a small bar chart and a sparkline. Animation is pure SMIL
  inside the SVG (no CSS/SCSS) — bars breathe gently and the sparkline draws
  itself on a slow loop, signalling "empty, waiting to be filled" without
  stealing focus from the call-to-action. Colors come from design tokens so it
  reads correctly in light and dark.
-->
<template>
  <svg
    width="208"
    height="156"
    viewBox="0 0 208 156"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="No dashboards yet"
  >
    <!-- soft brand glow behind the card -->
    <ellipse cx="104" cy="82" rx="92" ry="58" fill="var(--color-primary-500)" opacity="0.06" />

    <!-- floating accent dot -->
    <circle cx="40" cy="34" r="5" fill="var(--color-primary-400)" opacity="0.55">
      <animate attributeName="cy" values="34;27;34" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1" />
    </circle>
    <circle cx="172" cy="40" r="3.5" fill="var(--color-primary-300)" opacity="0.6">
      <animate attributeName="cy" values="40;46;40" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1; 0.4 0 0.2 1" keyTimes="0;0.5;1" />
    </circle>

    <!-- dashboard card -->
    <rect x="42" y="34" width="124" height="92" rx="12" fill="var(--color-surface-base)" stroke="var(--color-border-default)" stroke-width="1.5" />

    <!-- title bar + window dots -->
    <rect x="56" y="48" width="42" height="6" rx="3" fill="var(--color-border-strong)" />
    <circle cx="150" cy="51" r="2.5" fill="var(--color-border-strong)" />
    <circle cx="142" cy="51" r="2.5" fill="var(--color-border-strong)" />

    <!-- divider -->
    <line x1="42" y1="64" x2="166" y2="64" stroke="var(--color-border-default)" stroke-width="1" />

    <!-- bar-chart widget (bars breathe) -->
    <g>
      <rect x="58" y="92" width="11" height="22" rx="2.5" fill="var(--color-primary-500)">
        <animate attributeName="height" values="22;34;22" dur="2.6s" repeatCount="indefinite" begin="0s" />
        <animate attributeName="y" values="92;80;92" dur="2.6s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="74" y="100" width="11" height="14" rx="2.5" fill="var(--color-primary-400)">
        <animate attributeName="height" values="14;26;14" dur="2.6s" repeatCount="indefinite" begin="0.35s" />
        <animate attributeName="y" values="100;88;100" dur="2.6s" repeatCount="indefinite" begin="0.35s" />
      </rect>
      <rect x="90" y="84" width="11" height="30" rx="2.5" fill="var(--color-primary-500)">
        <animate attributeName="height" values="30;20;30" dur="2.6s" repeatCount="indefinite" begin="0.7s" />
        <animate attributeName="y" values="84;94;84" dur="2.6s" repeatCount="indefinite" begin="0.7s" />
      </rect>
    </g>

    <!-- sparkline widget (draws itself) -->
    <polyline
      points="116,104 126,94 136,99 146,86 156,90"
      fill="none"
      stroke="var(--color-primary-400)"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-dasharray="120"
    >
      <animate attributeName="stroke-dashoffset" values="120;0;0;120" keyTimes="0;0.5;0.85;1" dur="4s" repeatCount="indefinite" />
    </polyline>
    <circle cx="146" cy="86" r="3" fill="var(--color-primary-500)">
      <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.45;0.5;0.85;1" dur="4s" repeatCount="indefinite" />
    </circle>
  </svg>
</template>
