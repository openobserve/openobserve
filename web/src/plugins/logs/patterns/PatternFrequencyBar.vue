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
    class="tw:w-full tw:h-[0.5rem] tw:rounded-full tw:overflow-hidden tw:bg-[var(--o2-surface-3,#f3f4f6)]"
    :data-test="`patterns-patternfrequencybar-${dataTestSuffix}`"
  >
    <div
      class="tw:h-full tw:rounded-full tw:transition-[width] tw:duration-300 tw:ease-out"
      :style="{ width: clampedPercentage + '%', backgroundColor: barColor }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { getFrequencyBarColor } from "./patternUtils";

const props = defineProps<{
  percentage: number;
  isAnomaly: boolean;
  dataTestSuffix: string;
}>();

const clampedPercentage = computed(() =>
  Math.max(0, Math.min(100, props.percentage)),
);

const barColor = computed(() =>
  getFrequencyBarColor(props.percentage, props.isAnomaly),
);
</script>
