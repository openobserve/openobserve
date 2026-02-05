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
  <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 lg:tw:grid-cols-3 tw:gap-3" data-test="error-performance-metrics">
    <MetricCard
      v-if="metrics?.error?.handling_duration"
      label="Handling Duration"
      :value="metrics.error.handling_duration"
      unit="ns"
      icon="timer"
      description="Time taken to handle the error"
      data-test="metric-handling-duration"
    />

    <MetricCard
      v-if="metrics?.view?.time_spent"
      label="Time on Page"
      :value="metrics.view.time_spent"
      unit="ns"
      icon="schedule"
      description="Time spent on page before error"
      data-test="metric-time-spent"
    />

    <MetricCard
      v-if="metrics?.view?.dom_interactive"
      label="DOM Interactive"
      :value="metrics.view.dom_interactive"
      unit="ns"
      icon="code"
      description="DOM state when error occurred"
      data-test="metric-dom-interactive"
    />

    <MetricCard
      v-if="metrics?.error?.resource_status !== undefined"
      label="Resource Status"
      :value="metrics.error.resource_status"
      unit=""
      icon="info"
      :status="getStatusCodeStatus(metrics.error.resource_status)"
      description="HTTP status code if resource error"
      data-test="metric-resource-status"
    />
  </div>
</template>

<script setup lang="ts">
import MetricCard from "./MetricCard.vue";

interface Props {
  metrics: any;
}

defineProps<Props>();

const getStatusCodeStatus = (statusCode: number): "good" | "needs-improvement" | "poor" => {
  if (statusCode >= 200 && statusCode < 300) return "good";
  if (statusCode >= 300 && statusCode < 400) return "needs-improvement";
  return "poor";
};
</script>
