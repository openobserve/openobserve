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

<!-- One usage chart with its own loading state, so a kept-alive copy comes back already drawn. -->
<template>
  <div class="relative h-full w-full">
    <!-- The renderer reports "loading" only once its query starts, so it would flash "no data" first. -->
    <UsageChartSkeleton v-if="busy" class="absolute inset-0 z-10 p-2" />
    <PanelSchemaRenderer
      class="h-full w-full"
      :panel-schema="panelSchema"
      :selected-time-obj="selectedTimeObj"
      :variables-data="{}"
      @loading-state-change="busy = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";

defineProps<{
  panelSchema: Record<string, unknown>;
  selectedTimeObj: { start_time: Date; end_time: Date };
}>();

const busy = ref(true);
</script>
