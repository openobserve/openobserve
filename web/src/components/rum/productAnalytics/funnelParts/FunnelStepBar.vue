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

<template>
  <div
    class="bg-progress-bar-track relative flex h-5 overflow-hidden rounded-full"
    role="progressbar"
    :aria-valuenow="Math.round(kept * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <!-- A width is data, so it is the one binding a utility class cannot carry, as in OProgressBar. -->
    <div class="bg-progress-bar-default h-full rounded-full" :style="{ width: pct(kept) }" />
    <div
      v-if="hatched > 0"
      class="bg-hatch h-full"
      :style="{ width: pct(hatched) }"
      data-test="rum-analytics-funnel-bar-removed"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ value: number; removed: number }>();

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const kept = computed(() => clamp01(props.value));
const hatched = computed(() => Math.min(clamp01(props.removed), 1 - kept.value));
const pct = (v: number) => `${v * 100}%`;
</script>
