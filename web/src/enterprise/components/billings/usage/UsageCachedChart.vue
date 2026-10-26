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
    <!-- Hidden, not removed, while usage is on its way: it keeps querying and clears the state itself. -->
    <PanelSchemaRenderer
      class="h-full w-full"
      :class="{ invisible: streamMissing }"
      :panel-schema="panelSchema"
      :selected-time-obj="selectedTimeObj"
      :variables-data="{}"
      @loading-state-change="busy = $event"
      @error="onError"
    />
    <div
      v-if="streamMissing"
      class="absolute inset-0 z-10 flex items-center justify-center"
      data-test="billings-usagechart-waiting"
    >
      <OEmptyState
        size="compact"
        illustration="wave-bars"
        :title="t('billing.usageTrends.waitingTitle')"
        :description="t('billing.usageTrends.waitingForData')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import UsageChartSkeleton from "./UsageChartSkeleton.vue";
import { USAGE_STREAM_NAME } from "./usageQueries";

defineProps<{
  panelSchema: Record<string, unknown>;
  selectedTimeObj: { start_time: Date; end_time: Date };
}>();

const { t } = useI18nTyped();

const busy = ref(true);

/** The renderer re-emits its error whenever it changes, an empty one included, so this clears itself. */
const streamMissing = ref(false);

const onError = (error: { message?: string } | null) => {
  const message = String(error?.message ?? "").toLowerCase();
  streamMissing.value = message.includes("stream not found") && message.includes(USAGE_STREAM_NAME);
};
</script>
