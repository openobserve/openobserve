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
  Placeholder for a chart panel: a row of bars in the shape the real chart takes.
  The background is opaque, because the renderer below already paints its axes
  and grid lines while it loads and they must not show through the placeholder.
-->
<template>
  <div
    class="bg-surface-base flex h-full w-full items-end gap-1 overflow-hidden"
    data-test="billings-usagechartskeleton"
  >
    <OSkeleton v-for="(bar, index) in BAR_HEIGHTS" :key="index" class="flex-1" :class="bar" />
  </div>
</template>

<script setup lang="ts">
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

/** One bar per day of a cycle's first half, so the placeholder is as dense as the chart. */
const BAR_HEIGHTS = [
  "h-1/4",
  "h-2/5",
  "h-3/5",
  "h-1/3",
  "h-4/5",
  "h-1/2",
  "h-3/4",
  "h-2/5",
  "h-3/5",
  "h-1/4",
  "h-1/2",
  "h-2/3",
  "h-1/3",
  "h-3/5",
  "h-2/5",
];
</script>
