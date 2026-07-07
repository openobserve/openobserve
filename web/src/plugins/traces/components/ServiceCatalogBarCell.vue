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
  <div class="flex flex-col gap-[0.15rem] w-full min-w-0">
    <span class="text-[0.75rem] leading-none tabular-nums truncate">
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
}>();

const ratio = computed(() =>
  props.max > 0 ? Math.min(1, props.value / props.max) : 0,
);
</script>
