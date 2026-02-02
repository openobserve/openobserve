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
  <div class="build-query-page">
    <!-- PanelEditor with BUILD_PRESET -->
    <PanelEditor
      ref="panelEditorRef"
      pageType="build"
      :editMode="true"
      :selectedDateTime="dashboardPanelData.meta.dateTime"
      :showAddToDashboardButton="true"
      @addToDashboard="showAddToDashboardDialog = true"
      @chartApiError="handleChartApiError"
      @queryGenerated="onQueryGenerated"
      @customQueryModeChanged="onCustomQueryModeChanged"
    />

    <!-- Query Mode Toggle - Bottom Right Corner -->
    <div class="query-mode-toggle">
      <span class="query-mode-label">Mode:</span>
      <QueryTypeSelector />
    </div>

    <!-- Add to Dashboard Dialog -->
    <q-dialog
      v-model="showAddToDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <add-to-dashboard
        @save="addPanelToDashboard"
        :dashboardPanelData="dashboardPanelData"
      />
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, defineAsyncComponent, provide, defineExpose } from "vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import {
  parseSQL,
  shouldUseCustomMode,
  parsedQueryToPanelFields,
} from "@/utils/query/sqlQueryParser";

// ============================================================================
// Component Imports
// ============================================================================

// PanelEditor is imported synchronously so it's available immediately in onMounted
import PanelEditor from "@/components/dashboards/PanelEditor/PanelEditor.vue";

// These can remain async as they're not needed immediately
const AddToDashboard = defineAsyncComponent(
  () => import("@/plugins/metrics/AddToDashboard.vue"),
);

const QueryTypeSelector = defineAsyncComponent(
  () => import("@/components/dashboards/addPanel/QueryTypeSelector.vue"),
);

// ============================================================================
// Props and Emits
// ============================================================================

interface Props {
  /** Current SQL query from logs search */
  searchQuery?: string;
  /** Selected stream name */
  selectedStream?: string;
  /** Selected date time */
  selectedDateTime?: {
    start_time: number | string;
    end_time: number | string;
    valueType?: "relative" | "absolute";
    relativeTimePeriod?: string;
  };
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: "",
  selectedStream: "",
  selectedDateTime: undefined,
});

// Emits
const emit = defineEmits<{
  /** Emitted when SQL query is generated from builder fields */
  (e: "queryGenerated", query: string): void;
  /** Emitted when customQuery mode changes (true = custom mode, false = builder mode) */
  (e: "customQueryModeChanged", isCustomMode: boolean): void;
}>();

// ============================================================================
// Setup
// ============================================================================

const panelEditorRef = ref<any>(null);
const showAddToDashboardDialog = ref(false);

// Get dashboard panel data for build page
const { dashboardPanelData, resetDashboardPanelData, updateGroupedFields } =
  useDashboardPanelData("build");

// Provide page key for child components
provide("dashboardPanelDataPageKey", "build");

// ============================================================================
// Initialization
// ============================================================================

const initializeFromQuery = async () => {
  // Reset panel data first
  resetDashboardPanelData();

  // Sync datetime from parent
  if (props.selectedDateTime) {
    dashboardPanelData.meta.dateTime = { ...props.selectedDateTime };
  }

  // If no query, use builder mode with selected stream
  if (!props.searchQuery || !props.searchQuery.trim()) {
    if (props.selectedStream) {
      dashboardPanelData.data.queries[0].fields.stream = props.selectedStream;
      dashboardPanelData.data.queries[0].fields.stream_type = "logs";
      // Load stream fields for the query builder
      await updateGroupedFields();
    }
    dashboardPanelData.data.queries[0].customQuery = false;
  } else if (shouldUseCustomMode(props.searchQuery)) {
    // Complex query - use custom mode
    if (props.selectedStream) {
      dashboardPanelData.data.queries[0].fields.stream = props.selectedStream;
      dashboardPanelData.data.queries[0].fields.stream_type = "logs";
    }
    dashboardPanelData.data.queries[0].query = props.searchQuery;
    dashboardPanelData.data.queries[0].customQuery = true;
    // Use table chart with dynamic columns for custom mode
    dashboardPanelData.data.type = "table";
    dashboardPanelData.data.config.table_dynamic_columns = true;
  } else {
    try {
      // Try to parse the query
      const parsed = await parseSQL(props.searchQuery, "logs");

      if (parsed.customQuery) {
        // Parsing failed or complex query detected
        if (props.selectedStream) {
          dashboardPanelData.data.queries[0].fields.stream = props.selectedStream;
          dashboardPanelData.data.queries[0].fields.stream_type = "logs";
        }
        dashboardPanelData.data.queries[0].query = props.searchQuery;
        dashboardPanelData.data.queries[0].customQuery = true;
        // Use table chart with dynamic columns for custom mode
        dashboardPanelData.data.type = "table";
        dashboardPanelData.data.config.table_dynamic_columns = true;
      } else {
        // Successfully parsed - apply to builder (auto mode)
        const panelFields = parsedQueryToPanelFields(parsed);

        // Set stream from parsed query or fallback to selected stream
        const streamName = panelFields.stream || props.selectedStream;
        dashboardPanelData.data.queries[0].fields.stream = streamName;
        dashboardPanelData.data.queries[0].fields.stream_type =
          panelFields.stream_type || "logs";

        // Apply parsed fields to builder
        dashboardPanelData.data.queries[0].fields.x = panelFields.x;
        dashboardPanelData.data.queries[0].fields.y = panelFields.y;
        dashboardPanelData.data.queries[0].fields.breakdown = panelFields.breakdown;
        dashboardPanelData.data.queries[0].fields.filter = panelFields.filter;
        dashboardPanelData.data.queries[0].customQuery = false;

        // Load stream fields after setting the stream from parsed query
        if (streamName) {
          await updateGroupedFields();
        }
      }
    } catch (error) {
      console.error("Error parsing query:", error);
      // Fall back to custom mode
      if (props.selectedStream) {
        dashboardPanelData.data.queries[0].fields.stream = props.selectedStream;
        dashboardPanelData.data.queries[0].fields.stream_type = "logs";
      }
      dashboardPanelData.data.queries[0].query = props.searchQuery;
      dashboardPanelData.data.queries[0].customQuery = true;
      // Use table chart with dynamic columns for custom mode
      dashboardPanelData.data.type = "table";
      dashboardPanelData.data.config.table_dynamic_columns = true;
    }
  }

  // Run the query after initialization
  await runQuery();
};

// ============================================================================
// Event Handlers
// ============================================================================

const handleChartApiError = (error: any) => {
  console.error("Chart API error:", error);
};

const addPanelToDashboard = () => {
  showAddToDashboardDialog.value = false;
};

// ============================================================================
// Watchers
// ============================================================================

// Watch for datetime changes from parent
watch(
  () => props.selectedDateTime,
  (newDateTime) => {
    if (newDateTime) {
      dashboardPanelData.meta.dateTime = { ...newDateTime };
    }
  },
  { deep: true }
);

// NOTE: Field change watcher for auto SQL generation has been moved to PanelEditor.vue
// PanelEditor emits 'queryGenerated' and 'customQueryModeChanged' which we forward to parent

// ============================================================================
// PanelEditor Event Handlers (forward to parent)
// ============================================================================

const onQueryGenerated = (query: string) => {
  // Forward the generated query to parent (Index.vue -> SearchBar)
  emit("queryGenerated", query);
};

const onCustomQueryModeChanged = (isCustomMode: boolean) => {
  // Forward the custom query mode change to parent
  emit("customQueryModeChanged", isCustomMode);
};

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  initializeFromQuery();
  // Note: PanelEditor's watcher (with immediate: true) will emit initial customQueryModeChanged
});

// ============================================================================
// Expose
// ============================================================================

/**
 * Run the query in PanelEditor
 * PanelEditor handles SQL generation via its watcher and emits queryGenerated
 */
const runQuery = async (withoutCache?: boolean) => {
  // Ensure stream fields are loaded before running query in builder mode
  if (!dashboardPanelData.data.queries[0].customQuery) {
    if (!dashboardPanelData.meta.streamFields?.groupedFields?.length) {
      await updateGroupedFields();
    }
  }

  // PanelEditor will generate SQL and emit queryGenerated
  panelEditorRef.value?.runQuery(withoutCache);
};

defineExpose({
  runQuery,
  panelEditorRef,
  dashboardPanelData,
});
</script>

<style lang="scss" scoped>
.build-query-page {
  height: 100%;
  width: 100%;
  position: relative;
}

.query-mode-toggle {
  position: absolute;
  bottom: 16px;
  right: 60px; // Offset to avoid config panel
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--q-bg, #fff);
  padding: 6px 10px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  border: 1px solid var(--q-separator, #e0e0e0);
}

.query-mode-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--q-text-secondary, #666);
}
</style>
