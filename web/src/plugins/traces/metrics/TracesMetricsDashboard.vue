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
  <div class="traces-metrics-dashboard tw-p-2">
    <!-- Filters Section -->
    <div
      v-if="show"
      class="filters-section tw-mb-2 tw-flex tw-items-center tw-gap-2 tw-px-1 tw-flex-wrap"
    >
      <!-- Error Only Toggle -->
      <div
        style="border: 1px solid #c4c4c4; border-radius: 5px"
        class="q-pr-xs q-pl-xs tw-flex tw-items-center tw-justify-center"
      >
        <q-toggle
          v-model="showErrorOnly"
          class="o2-toggle-button-xs tw-flex tw-items-center tw-justify-center"
          size="xs"
          flat
          :class="
            store.state.theme === 'dark'
              ? 'o2-toggle-button-xs-dark'
              : 'o2-toggle-button-xs-light'
          "
          @update:model-value="onFilterChange"
          data-test="error-only-toggle"
        />
        <q-icon name="error"
size="18px" class="tw-mx-1" />
        <q-tooltip>Show Error Only</q-tooltip>
      </div>

      <!-- Range Filter Chips -->
      <div
        v-for="[panelId, filter] in rangeFilters"
        :key="panelId"
        class="filter-chip"
        data-test="range-filter-chip"
      >
        <span class="chip-label"
          >{{ filter.panelTitle }}:
          <span
            v-if="
              filter.panelTitle === 'Errors' || filter.panelTitle === 'Rate'
            "
          >
            >= {{ filter.start }}</span
          >
          <span v-if="filter.panelTitle === 'Duration'">
            {{ filter.start }}µs - {{ filter.end }}µs
          </span>
        </span>
        <q-icon
          name="close"
          size="14px"
          class="chip-close-icon"
          @click="removeRangeFilter(panelId)"
        />
      </div>
    </div>

    <!-- Charts Section -->
    <div class="charts-container">
      <RenderDashboardCharts
        v-if="show"
        ref="dashboardChartsRef"
        :viewOnly="true"
        :dashboardData="dashboardData"
        :currentTimeObj="currentTimeObj"
        searchType="dashboards"
        @updated:dataZoom="onDataZoom"
        @chart:contextmenu="handleChartContextMenu"
      />
    </div>

    <TracesMetricsContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuPosition.x"
      :y="contextMenuPosition.y"
      :value="contextMenuValue"
      :fieldName="contextMenuFieldName"
      @select="handleContextMenuSelect"
      @close="hideContextMenu"
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

const TracesMetricsContextMenu = defineAsyncComponent(
  () => import("./TracesMetricsContextMenu.vue"),
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
const store = useStore();

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

// Filter state
const showErrorOnly = ref(false);
const rangeFilters = ref<
  Map<string, { panelTitle: string; start: number; end: number }>
>(new Map());

// Context menu state
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuValue = ref(0);
const contextMenuFieldName = ref("");
const contextMenuData = ref<any>(null);

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
      // Build WHERE clause based on filters
      let whereClause = "";
      const baseFilters: string[] = [];

      // Add error filter if showErrorOnly is enabled
      if (showErrorOnly.value) {
        baseFilters.push("span_status = 'ERROR'");
      }

      // Add user-provided filters
      if (props.filter?.trim().length) {
        baseFilters.push(props.filter.trim());
      }

      // Add range filter if exists for this panel
      const rangeFilter = rangeFilters.value.get(panel.id);
      if (rangeFilter) {
        baseFilters.push(
          `_timestamp >= ${rangeFilter.start} AND _timestamp <= ${rangeFilter.end}`,
        );
      }

      // Special handling for "Errors" panel - always filter by error status
      if (panel.title === "Errors") {
        const errorFilters = ["span_status = 'ERROR'"];
        if (props.filter?.trim().length) {
          errorFilters.push(props.filter.trim());
        }
        // Add range filter for Errors panel if exists
        if (rangeFilter) {
          errorFilters.push(
            `_timestamp >= ${rangeFilter.start} AND _timestamp <= ${rangeFilter.end}`,
          );
        }
        whereClause = errorFilters.length
          ? "WHERE " + errorFilters.join(" AND ")
          : "";
      } else {
        // For Rate and Duration panels, apply the combined filters
        whereClause = baseFilters.length
          ? "WHERE " + baseFilters.join(" AND ")
          : "";
      }

      convertedDashboard.tabs[0].panels[index]["queries"][0].query = panel[
        "queries"
      ][0].query.replace("[WHERE_CLAUSE]", whereClause);
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

// const onDataZoom = (event: any) => {
//   console.log("event -----", event);
// };

const onDataZoom = ({
  start,
  end,
  start1,
  end1,
  data,
}: {
  start: number;
  end: number;
  start1: number;
  end1: number;
  data: any; // contains panel schema with data.id as panel id
}) => {
  console.log("start 1, end 1 ---", start1, end1, data.id);
  if (start && end) {
    // Create or update range filter chip for this panel
    const panelId = data?.id;
    const panelTitle = data?.title || "Chart";

    if (panelId) {
      rangeFilters.value.set(panelId, {
        panelTitle,
        start: Math.floor(start1),
        end: Math.floor(end1),
      });
    }

    emit("time-range-selected", { start, end });
  }
};

const removeRangeFilter = (panelId: string) => {
  rangeFilters.value.delete(panelId);
  // Trigger dashboard reload to remove the filter
  loadDashboard();
};

const formatTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const handleChartContextMenu = (event: any) => {
  // Extract field name from series name
  // For traces metrics, the panel titles are "Rate", "Errors", "Duration"
  const panelTitle = event.panelTitle || "";
  const seriesName = event.seriesName || "";

  // Use panel title as field name (Rate, Errors, Duration)
  contextMenuFieldName.value = panelTitle || seriesName || "Value";

  contextMenuVisible.value = true;
  contextMenuPosition.value = { x: event.x, y: event.y };
  contextMenuValue.value = event.value;
  contextMenuData.value = event;
};

const hideContextMenu = () => {
  contextMenuVisible.value = false;
};

const handleContextMenuSelect = (selection: {
  condition: string;
  value: number;
  fieldName: string;
}) => {
  hideContextMenu();

  console.log("Context menu selection:", {
    fieldName: selection.fieldName,
    condition: selection.condition,
    value: selection.value,
  });

  // You can emit this to parent or handle filtering logic here
  // For example: emit("filter-applied", selection);
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

// Filter chip styles
.filter-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background-color: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 16px;
  font-size: 0.75rem;
  font-weight: 500;
  color: #1976d2;

  .chip-label {
    user-select: none;
  }

  .chip-close-icon {
    cursor: pointer;
    transition: color 0.2s;

    &:hover {
      color: #d32f2f;
    }
  }
}

// Dark mode support
:deep(.q-dark) {
  .traces-metrics-dashboard {
    background: var(--q-dark);
  }

  .dashboard-header:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .filter-chip {
    background-color: #1e3a5f;
    border-color: #2c5282;
    color: #90caf9;

    .chip-close-icon:hover {
      color: #ff5252;
    }
  }
}
</style>
