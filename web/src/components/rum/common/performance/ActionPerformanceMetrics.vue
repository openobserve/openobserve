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
  <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 lg:tw:grid-cols-3 tw:gap-3" data-test="action-performance-metrics">
    <MetricCard
      v-if="metrics?.action?.loading_time"
      label="Loading Time"
      :value="metrics.action.loading_time"
      unit="ns"
      icon="hourglass_empty"
      :status="getLoadingTimeStatus(metrics.action.loading_time)"
      description="Time taken for action to complete"
      data-test="metric-loading-time"
    />

    <MetricCard
      v-if="metrics?.action?.duration"
      label="Action Duration"
      :value="metrics.action.duration"
      unit="ns"
      icon="timer"
      description="Total duration of the action"
      data-test="metric-duration"
    />

    <MetricCard
      v-if="metrics?.action?.long_task?.count !== undefined"
      label="Long Tasks"
      :value="metrics.action.long_task.count"
      unit=""
      icon="warning"
      :status="getLongTaskStatus(metrics.action.long_task.count)"
      description="Number of long tasks during action"
      data-test="metric-long-tasks"
    />

    <MetricCard
      v-if="metrics?.action?.resource?.count !== undefined"
      label="Resources Loaded"
      :value="metrics.action.resource.count"
      unit=""
      icon="cloud_download"
      description="Number of resources loaded during action"
      data-test="metric-resources"
    />

    <MetricCard
      v-if="metrics?.action?.error?.count !== undefined"
      label="Errors"
      :value="metrics.action.error.count"
      unit=""
      icon="error"
      :status="metrics.action.error.count > 0 ? 'poor' : 'good'"
      description="Number of errors during action"
      data-test="metric-errors"
    />
  </div>
</template>

<script setup lang="ts">
import MetricCard from "./MetricCard.vue";

interface Props {
  metrics: any;
}

defineProps<Props>();

// Action performance thresholds
const LOADING_TIME_GOOD = 1000000000; // 1s
const LOADING_TIME_NEEDS_IMPROVEMENT = 3000000000; // 3s

const getLoadingTimeStatus = (value: number): "good" | "needs-improvement" | "poor" => {
  if (value <= LOADING_TIME_GOOD) return "good";
  if (value <= LOADING_TIME_NEEDS_IMPROVEMENT) return "needs-improvement";
  return "poor";
};

const getLongTaskStatus = (count: number): "good" | "needs-improvement" | "poor" => {
  if (count === 0) return "good";
  if (count <= 2) return "needs-improvement";
  return "poor";
};
</script>
