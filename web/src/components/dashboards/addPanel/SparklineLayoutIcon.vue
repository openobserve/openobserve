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
  Small metric-cell preview for the sparkline layout picker, showing the value
  "3.14" over a filled area trend, styled per layout so each option reads at a
  glance:
    - bottom / auto (null resolves to bottom): value on top, area along the bottom
    - background: area fills the whole cell behind a centered value
  Drawn in currentColor so it inherits the select item's active/inactive colour.
  Sized past the select's default size-4 (via `!`) so the value stays legible.
-->
<template>
  <svg
    width="24"
    height="16"
    viewBox="0 0 24 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    class="h-5! w-8!"
  >
    <rect
      x="1"
      y="1"
      width="22"
      height="14"
      rx="2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      opacity="0.55"
    />
    <path
      v-if="layout === 'background'"
      d="M1.5 8.5 6.5 6.5 11.5 8 16.5 6 22.5 7.5 22.5 14.5 1.5 14.5Z"
      fill="currentColor"
      opacity="0.3"
    />
    <path
      v-else
      d="M1.5 11.5 6.5 10 11.5 11 16.5 9.5 22.5 10.8 22.5 14.5 1.5 14.5Z"
      fill="currentColor"
      opacity="0.35"
    />
    <text
      x="12"
      :y="layout === 'background' ? 10.5 : 8"
      text-anchor="middle"
      font-size="8"
      font-weight="700"
      fill="currentColor"
    >
      3.14
    </text>
  </svg>
</template>

<script setup lang="ts">
// null → "auto"; otherwise "bottom" | "background".
defineProps<{ layout: string | null }>();
</script>
