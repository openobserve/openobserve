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
  Small metric-cell preview for the sparkline chart-type picker: the value
  "3.14" on top, with the trend shape below per type:
    - line: a stroked trend line
    - area / auto (null resolves to area): a filled area under the line
    - bar: discrete vertical bars
  Drawn in currentColor so it inherits the select item's active/inactive colour.
  Sized past the select's default size-4 (via `!`) to stay legible.
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
    <!-- Bar -->
    <template v-if="type === 'bar'">
      <rect x="4" y="11" width="2.2" height="2.5" rx="0.4" fill="currentColor" opacity="0.7" />
      <rect x="7.4" y="9.3" width="2.2" height="4.2" rx="0.4" fill="currentColor" opacity="0.7" />
      <rect x="10.8" y="11.8" width="2.2" height="1.7" rx="0.4" fill="currentColor" opacity="0.7" />
      <rect x="14.2" y="10" width="2.2" height="3.5" rx="0.4" fill="currentColor" opacity="0.7" />
      <rect x="17.6" y="12" width="2.2" height="1.5" rx="0.4" fill="currentColor" opacity="0.7" />
    </template>
    <!-- Line -->
    <template v-else-if="type === 'line'">
      <polyline
        points="3.5,12 8,9.5 12,11.5 16,9 20.5,11"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
    <!-- Area (area + auto) -->
    <template v-else>
      <path
        d="M3.5 12 8 9.5 12 11.5 16 9 20.5 11 20.5 13.5 3.5 13.5Z"
        fill="currentColor"
        opacity="0.3"
      />
      <polyline
        points="3.5,12 8,9.5 12,11.5 16,9 20.5,11"
        fill="none"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.9"
      />
    </template>
    <text x="12" y="8" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">
      {{ raw("3.14") }}
    </text>
  </svg>
</template>

<script setup lang="ts">
import { raw } from "@/types/i18n";

// null → "auto" (resolves to area); otherwise "line" | "area" | "bar".
defineProps<{ type: string | null }>();
</script>
