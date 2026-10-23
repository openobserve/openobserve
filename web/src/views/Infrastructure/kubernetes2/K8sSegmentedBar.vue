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

<script setup lang="ts">
export interface SegmentedBarSegment {
  id: string;
  // Percent of the track.
  pct: number;
  // Token background utility, e.g. "bg-status-positive".
  class: string;
}

export interface SegmentedBarMarker {
  id: string;
  pct: number;
  class: string;
}

defineProps<{
  segments: SegmentedBarSegment[];
  markers?: SegmentedBarMarker[];
  tall?: boolean;
}>();
</script>

<template>
  <div
    class="bg-border-default relative flex w-full min-w-0 rounded-full"
    :class="tall ? 'h-2.5' : 'h-2'"
  >
    <div class="flex h-full w-full overflow-hidden rounded-full">
      <div
        v-for="segment in segments"
        :key="segment.id"
        class="h-full shrink-0 transition-all duration-300"
        :class="segment.class"
        :style="{ width: `${segment.pct}%` }"
        :data-test="`k8s2-segment-${segment.id}`"
      />
    </div>
    <div
      v-for="marker in markers ?? []"
      :key="marker.id"
      class="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full"
      :class="marker.class"
      :style="{ left: `${marker.pct}%` }"
      :data-test="`k8s2-marker-${marker.id}`"
    />
  </div>
</template>
