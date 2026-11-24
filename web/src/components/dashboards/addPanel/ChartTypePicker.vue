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
    class="flex min-h-0 flex-col"
    data-test="dashboard-addpanel-chart-type-picker"
    @keydown.esc="onEscape"
  >
    <div class="px-page-edge mb-1 shrink-0">
      <ChartTypeSelect
        ref="selectRef"
        :chart-type="chartType"
        :expanded="open"
        @toggle="emit('update:open', !open)"
      />
    </div>
    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- Hidden, not unmounted, so the fields keep their search, page and scroll position. -->
      <div
        class="flex min-h-0 flex-1 flex-col"
        :class="open ? 'invisible' : ''"
        :inert="open || undefined"
      >
        <slot />
      </div>
      <ChartTypeList
        v-if="open"
        class="absolute inset-0"
        :selected="chartType"
        :allowed-chart-types="allowedChartTypes"
        @select="onSelect"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import ChartTypeSelect from "./ChartTypeSelect.vue";
import ChartTypeList from "./ChartTypeList.vue";

const props = defineProps<{
  chartType: string;
  /** The chart-type list is showing in place of the default slot. */
  open: boolean;
  allowedChartTypes?: readonly string[];
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  select: [id: string];
}>();

const selectRef = ref<InstanceType<typeof ChartTypeSelect> | null>(null);

const onSelect = (id: string) => {
  emit("update:open", false);
  emit("select", id);
};

const onEscape = (event: KeyboardEvent) => {
  if (!props.open) return;
  // The editor's host page may close on Escape; this one only closes the list.
  event.stopPropagation();
  emit("update:open", false);
  selectRef.value?.focus();
};
</script>
