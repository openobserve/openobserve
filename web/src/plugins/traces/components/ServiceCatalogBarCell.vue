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
  <!-- Inline: number vertically centered on the row's shared baseline, with the
       bar pinned as a thin underline at the cell's bottom. Use when the column
       sits alongside single-line numeric columns so the numbers line up. -->
  <div
    v-if="inline"
    class="relative flex h-full min-h-7 w-full min-w-0 items-center"
    :class="align === 'right' ? 'justify-end' : 'justify-start'"
  >
    <span class="min-w-0 truncate text-xs leading-none tabular-nums">
      {{ label }}
      <OTooltip v-if="tooltip" :content="tooltip" />
    </span>
    <!-- Bar wrapped in an absolute div: OProgressBar's own root is `relative w-full`,
         so positioning it directly would keep it in flow and crush the number. -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0.5">
      <OProgressBar :value="ratio" :variant="variant" size="xs" />
    </div>
  </div>
  <!-- Stacked (default): number above a full-width bar. -->
  <div v-else class="flex w-full min-w-0 flex-col gap-[0.15rem]">
    <span
      class="truncate text-xs leading-none tabular-nums"
      :class="align === 'right' ? 'text-right' : 'text-left'"
    >
      {{ label }}
      <OTooltip v-if="tooltip" :content="tooltip" />
    </span>
    <OProgressBar :value="ratio" :variant="variant" size="xs" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";

const props = defineProps<{
  value: number;
  max: number;
  label: string;
  variant?: ProgressBarVariant;
  tooltip?: string;
  align?: "left" | "right";
  /** Render the number inline (row-baseline) with the bar as a bottom underline,
   *  so it aligns with single-line numeric columns in the same table row. */
  inline?: boolean;
}>();

const ratio = computed(() => (props.max > 0 ? Math.min(1, props.value / props.max) : 0));
</script>
