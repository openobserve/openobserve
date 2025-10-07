<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="traces-metrics-dashboard tw-h-[16.25rem] tw-p-2">
    <RenderDashboardCharts
      v-if="show"
      ref="dashboardChartsRef"
      :viewOnly="true"
      :dashboardData="dashboardData"
      :currentTimeObj="currentTimeObj"
      searchType="dashboards"
      @updated:dataZoom="onDataZoom"
    />
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  computed,
  reactive,
  defineAsyncComponent,
} from "vue";
import { useStore } from "vuex";
import useNotifications from "@/composables/useNotifications";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import metrics from "./metrics.json";
import { deepCopy, getUUID } from "@/utils/zincutils";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue"),
);

interface TimeRange {
  startTime: number;
  endTime: number;
}

const props = defineProps<{
  streamName: string;
  timeRange: TimeRange;
  filter?: string;
  show?: boolean;
}>();

const emit = defineEmits<{
  (e: "time-range-selected", range: { start: number; end: number }): void;
}>();

const { showErrorNotification } = useNotifications();

const autoRefreshEnabled = ref(false);
const autoRefreshIntervalId = ref<number | null>(null);
const error = ref<string | null>(null);
const dashboardChartsRef = ref<any>(null);
const currentTimeObj = ref({
  __global: {
    start_time: new Date(props.timeRange.startTime),
    end_time: new Date(props.timeRange.endTime),
  },
});

const dashboardData = ref(null);

const loadDashboard = async () => {
  try {
    error.value = null;

    currentTimeObj.value = {
      __global: {
        start_time: new Date(props.timeRange.startTime),
        end_time: new Date(props.timeRange.endTime),
      },
    };
    // Convert the dashboard schema and update stream names
    const convertedDashboard = convertDashboardSchemaVersion(deepCopy(metrics));

    convertedDashboard.tabs[0].panels.forEach((panel, index) => {
      if (panel.title === "Errors") {
        convertedDashboard.tabs[0].panels[index]["queries"][0].query = panel[
          "queries"
        ][0].query.replace(
          "[WHERE_CLAUSE]",
          props.filter.trim().length
            ? "WHERE span_status = 'ERROR' and " + props.filter
            : "WHERE span_status = 'ERROR'",
        );
      } else {
        convertedDashboard.tabs[0].panels[index]["queries"][0].query = panel[
          "queries"
        ][0].query.replace(
          "[WHERE_CLAUSE]",
          props.filter.trim().length ? "WHERE " + props.filter : "",
        );
      }
    });

    dashboardData.value = convertedDashboard;

    updateLayout();
  } catch (err: any) {
    console.error("Error loading dashboard:", err);
    error.value = err.message || "Failed to load metrics dashboard";
    showErrorNotification(error.value);
  }
};

const updateLayout = async () => {
  window.dispatchEvent(new Event("resize"));
};

const refreshDashboard = () => {
  if (dashboardChartsRef.value) {
    dashboardChartsRef?.value?.forceRefreshPanel();
  }
};

const onDataZoom = ({ start, end }: { start: number; end: number }) => {
  if (start && end) {
    emit("time-range-selected", { start, end });
  }
};

const toggleAutoRefresh = () => {
  autoRefreshEnabled.value = !autoRefreshEnabled.value;

  if (autoRefreshEnabled.value) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
};

const startAutoRefresh = () => {
  if (autoRefreshIntervalId.value !== null) {
    stopAutoRefresh();
  }

  autoRefreshIntervalId.value = window.setInterval(() => {
    refreshDashboard();
  }, 30000); // 30 seconds
};

const stopAutoRefresh = () => {
  if (autoRefreshIntervalId.value !== null) {
    clearInterval(autoRefreshIntervalId.value);
    autoRefreshIntervalId.value = null;
  }
};

onMounted(() => {
  loadDashboard();
});

onBeforeUnmount(() => {
  stopAutoRefresh();
});

defineExpose({
  refresh: refreshDashboard,
  resetZoom: () => {
    // Dashboard handles zoom reset through toolbar
  },
  loadDashboard,
});
</script>

<style lang="scss" scoped>
.traces-metrics-dashboard {
  width: 100%;
  border-radius: 4px;
  background: var(--q-card-background, #fff);
}

.dashboard-header {
  border-bottom: 1px solid rgba(194, 194, 194, 0.48);

  &:hover {
    background-color: rgba(0, 0, 0, 0.02);
  }
}

.metrics-dashboard-content {
  min-height: auto !important;
  max-height: calc(100vh - 250px);
  overflow-y: auto;
}

// Dark mode support
:deep(.q-dark) {
  .traces-metrics-dashboard {
    background: var(--q-dark);
  }

  .dashboard-header:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
}
</style>
