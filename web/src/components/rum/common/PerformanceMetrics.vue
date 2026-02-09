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
  <div class="performance-metrics" data-test="performance-metrics">
    <!-- View Performance -->
    <template v-if="eventType === 'view'">
      <ViewPerformanceMetrics :metrics="metrics" />
    </template>

    <!-- Action Performance -->
    <template v-else-if="eventType === 'action'">
      <ActionPerformanceMetrics :metrics="metrics" />
    </template>

    <!-- Resource Performance -->
    <template v-else-if="eventType === 'resource'">
      <ResourcePerformanceMetrics :metrics="metrics" />
    </template>

    <!-- Error Performance -->
    <template v-else-if="eventType === 'error'">
      <ErrorPerformanceMetrics :metrics="metrics" />
    </template>

    <!-- Fallback -->
    <template v-else>
      <div class="tw:text-center tw:py-8 tw:text-grey-6 tw:text-sm">
        No performance data available for this event type
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ViewPerformanceMetrics from "./performance/ViewPerformanceMetrics.vue";
import ActionPerformanceMetrics from "./performance/ActionPerformanceMetrics.vue";
import ResourcePerformanceMetrics from "./performance/ResourcePerformanceMetrics.vue";
import ErrorPerformanceMetrics from "./performance/ErrorPerformanceMetrics.vue";

interface Props {
  eventType: "view" | "action" | "resource" | "error";
  metrics: any;
}

defineProps<Props>();
</script>
