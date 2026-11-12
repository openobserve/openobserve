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
import PanelBar from "@/components/common/PanelBar.vue";
import PanelChartPlaceholder from "@/components/dashboards/PanelChartPlaceholder.vue";

defineProps<{
  title: string;
  meta?: string;
}>();
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-1 flex-col" data-test="traces-red-panel-placeholder">
    <PanelBar class="w-full flex-nowrap" data-test="traces-metrics-placeholder-title">
      <span class="truncate">{{ title }}</span>
      <span
        v-if="meta"
        class="text-2xs text-text-secondary ms-2 shrink-0 font-normal whitespace-nowrap"
        >{{ meta }}</span
      >
    </PanelBar>
    <div class="min-h-0 flex-1"><PanelChartPlaceholder /></div>
  </div>
</template>
