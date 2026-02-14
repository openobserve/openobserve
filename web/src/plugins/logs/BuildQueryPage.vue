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
      @addToDashboard="onAddToDashboard"
      @chartApiError="handleChartApiError"
      @queryGenerated="onQueryGenerated"
      @customQueryModeChanged="onCustomQueryModeChanged"
      @searchRequestTraceIdsUpdated="onSearchRequestTraceIdsUpdated"
    />

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
import { useRouter } from "vue-router";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import {
  parseSQL,
  shouldUseCustomMode,
  parsedQueryToPanelFields,
} from "@/utils/query/sqlQueryParser";
import { decodeBuildConfig } from "@/composables/useLogs/logsVisualization";
import useNotifications from "@/composables/useNotifications";

// ============================================================================
// Component Imports
// ============================================================================

// PanelEditor is imported synchronously so it's available immediately in onMounted
import PanelEditor from "@/components/dashboards/PanelEditor/PanelEditor.vue";

// These can remain async as they're not needed immediately
const AddToDashboard = defineAsyncComponent(
  () => import("@/plugins/metrics/AddToDashboard.vue"),
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
  /** Whether this is the first toggle to build tab (for shared link support) */
  isFirstToggle?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: "",
  selectedStream: "",
  selectedDateTime: undefined,
  isFirstToggle: true,
});

// Emits
const emit = defineEmits<{
  /** Emitted when SQL query is generated from builder fields */
  (e: "queryGenerated", query: string): void;
  /** Emitted when customQuery mode changes (true = custom mode, false = builder mode) */
  (e: "customQueryModeChanged", isCustomMode: boolean): void;
  /** Emitted when initialization is complete */
  (e: "initialized"): void;
  /** Emitted when search request trace IDs change (for cancel query functionality) */
  (e: "searchRequestTraceIdsUpdated", traceIds: string[]): void;
}>();

// ============================================================================
// Setup
// ============================================================================

const router = useRouter();
const panelEditorRef = ref<any>(null);
const showAddToDashboardDialog = ref(false);

// Get dashboard panel data for build page
const { dashboardPanelData, resetDashboardPanelData, updateGroupedFields, makeAutoSQLQuery, validatePanel } =
  useDashboardPanelData("build");

const { showErrorNotification } = useNotifications();

// Provide page key for child components
provide("dashboardPanelDataPageKey", "build");

// ============================================================================
// URL Config Restore Helper
// ============================================================================

/**
 * Restore chart type and config from URL params (similar to visualization's preservedConfig)
 * NOTE: This only restores config/chart type, NOT fields or query.
 * Fields are always parsed from props.searchQuery on every tab switch.
 */
const restoreConfigFromUrl = (): { type?: string; config?: any } => {
  const buildData = router.currentRoute.value?.query?.build_data as string | undefined;
  if (!buildData) {
    return {};
  }

  try {
    const decoded = decodeBuildConfig(buildData);
    if (!decoded) {
      return {};
    }

    return {
      type: decoded.type,
      config: decoded.config,
    };
  } catch (error) {
    console.error("Failed to restore build config from URL:", error);
    return {};
  }
};

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

  // Restore config/chart type from URL params (similar to visualization's preservedConfig)
  // NOTE: This only restores config, NOT fields. Fields are always parsed from props.searchQuery.
  // Chart type is only restored on FIRST toggle (for shared links). On subsequent tab switches,
  // chart type is always auto-selected based on the query.
  const urlConfig = restoreConfigFromUrl();
  let shouldAutoSelectChartType = true;

  // Always restore config from URL (for settings like table_dynamic_columns, etc.)
  if (urlConfig.config) {
    dashboardPanelData.data.config = { ...dashboardPanelData.data.config, ...urlConfig.config };
  }
  // Only restore chart type from URL on FIRST toggle (shared link scenario)
  // On subsequent toggles, always re-parse and auto-select chart type
  if (urlConfig.type && props.isFirstToggle) {
    dashboardPanelData.data.type = urlConfig.type;
    shouldAutoSelectChartType = false;
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
    // Use table chart with dynamic columns for custom mode (unless chart type from URL)
    if (shouldAutoSelectChartType) {
      dashboardPanelData.data.type = "table";
    }
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
        // Use table chart with dynamic columns for custom mode (unless chart type from URL)
        if (shouldAutoSelectChartType) {
          dashboardPanelData.data.type = "table";
        }
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

        // Apply parsed JOINs to builder
        if (panelFields.joins && panelFields.joins.length > 0) {
          dashboardPanelData.data.queries[0].joins = panelFields.joins;
        }

        // Auto-select chart type based on fields (unless chart type from URL):
        // - If useTableChart flag is set (more than 2 GROUP BY fields) → use "table" chart
        // - If only Y-axis fields (no X-axis, no breakdown) → use "metric" chart
        if (shouldAutoSelectChartType) {
          if (panelFields.useTableChart) {
            dashboardPanelData.data.type = "table";
          } else if (panelFields.x.length === 0 && panelFields.y.length > 0 && panelFields.breakdown.length === 0) {
            dashboardPanelData.data.type = "metric";
          }
        }

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
      // Use table chart with dynamic columns for custom mode (unless chart type from URL on first toggle)
      if (shouldAutoSelectChartType) {
        dashboardPanelData.data.type = "table";
      }
      dashboardPanelData.data.config.table_dynamic_columns = true;
    }
  }

  // Notify parent that initialization is complete
  // This marks the end of first toggle, so subsequent tab switches will auto-select chart type
  emit("initialized");

  // Run the query after initialization
  await runQuery();
};

// ============================================================================
// Event Handlers
// ============================================================================

const handleChartApiError = (error: any) => {
  console.error("Chart API error:", error);
};

const onAddToDashboard = () => {
  const errors: string[] = [];
  validatePanel(errors, true);
  if (errors.length) {
    showErrorNotification(
      "There are some errors, please fix them and try again",
    );
    return;
  }
  showAddToDashboardDialog.value = true;
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

const onSearchRequestTraceIdsUpdated = (traceIds: string[]) => {
  // Forward search request trace IDs to parent for cancel query functionality
  emit("searchRequestTraceIdsUpdated", traceIds);
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
 */
const runQuery = async (withoutCache?: boolean) => {
  // Ensure stream fields are loaded before running query in builder mode
  if (!dashboardPanelData.data.queries[0].customQuery) {
    if (!dashboardPanelData.meta.streamFields?.groupedFields?.length) {
      await updateGroupedFields();
    }
    // Generate SQL query after stream fields are loaded
    // The watcher won't fire because only streamFields changed, not the watched fields
    const generatedQuery = await makeAutoSQLQuery();
    if (generatedQuery !== undefined) {
      emit("queryGenerated", generatedQuery);
    }
  }

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
</style>
