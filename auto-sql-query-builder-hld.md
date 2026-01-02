# Auto SQL Query Builder - High-Level Design (HLD)

## Document Overview

This document provides the technical implementation details for adding the Auto SQL Query Builder feature to the OpenObserve logs page. It complements the [Design Document](./auto-sql-query-builder-design.md) by focusing on system architecture, component implementation, data structures, and integration points.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Component Specifications](#component-specifications)
3. [Data Models](#data-models)
4. [Integration Points](#integration-points)
5. [Implementation Plan](#implementation-plan)
6. [Testing Strategy](#testing-strategy)
7. [Performance Considerations](#performance-considerations)
8. [Security Considerations](#security-considerations)

---

## System Architecture

### Overview Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Frontend (Vue 3)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Logs Page (Index.vue)                         │  │
│  │  ┌────────┬──────────┬──────────┬─────────────────────────┐    │  │
│  │  │  Logs  │Visualize │ Patterns │  Build (NEW) ◄────────┐ │    │  │
│  │  └────────┴──────────┴──────────┴─────────────────────────┘    │  │
│  │                                                    │             │  │
│  │  ┌─────────────────────────────────────────────────┼──────────┐ │  │
│  │  │        BuildQueryTab.vue (NEW)                 │          │ │  │
│  │  │                                                 ↓          │ │  │
│  │  │  ┌──────────────────────────────────────────────────────┐ │ │  │
│  │  │  │         useDashboardPanel Composable                 │ │ │  │
│  │  │  │         (dashboardPanelDataPageKey = "logs")         │ │ │  │
│  │  │  │                                                      │ │ │  │
│  │  │  │  • dashboardPanelData (reactive state)              │ │ │  │
│  │  │  │  • makeAutoSQLQuery() - SQL generation             │ │ │  │
│  │  │  │  • addXAxisItem(), addYAxisItem(), etc.            │ │ │  │
│  │  │  │  • validatePanel()                                 │ │ │  │
│  │  │  │  • updateGroupedFields()                           │ │ │  │
│  │  │  └──────────────────────────────────────────────────────┘ │ │  │
│  │  │                         │                                  │ │  │
│  │  │    ┌────────────────────┼────────────────────┐           │ │  │
│  │  │    ↓                    ↓                    ↓           │ │  │
│  │  │  ┌─────────┐    ┌───────────────┐    ┌──────────┐      │ │  │
│  │  │  │FieldList│    │ QueryBuilder  │    │ Preview  │      │ │  │
│  │  │  │         │    │               │    │          │      │ │  │
│  │  │  │ Chart   │    │ DashboardQuery│    │PanelSchema│     │ │  │
│  │  │  │Selection│    │ Builder       │    │Renderer   │     │ │  │
│  │  │  └─────────┘    └───────────────┘    └──────────┘      │ │  │
│  │  │                                                          │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Utility Layer                                       │  │
│  │  • dashboardAutoQueryBuilder.ts - buildSQLChartQuery()          │  │
│  │  • sqlUtils.ts - isSimpleSelectAllQuery(), parseSQL()           │  │
│  │  • checkConfigChangeApiCall.ts - Config change detection        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP/WebSocket
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                          Backend (Rust)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  • Query Execution Engine                                              │
│  • Stream Schema API                                                   │
│  • Search API (/api/{org}/logs/_search)                                │
│  • Dashboard Panel Save API                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
Index.vue (Logs Page)
│
├─ SearchBarComponent
│  ├─ StreamSelector
│  ├─ DateTimePicker
│  └─ RunQueryButton
│
├─ TabNavigation
│  ├─ LogsTab
│  ├─ VisualizeTab
│  ├─ PatternsTab
│  └─ BuildTab ◄── NEW
│
└─ TabContent (v-show based on logsVisualizeToggle)
   │
   ├─ SearchResult (when mode === 'logs')
   ├─ VisualizeLogsQuery (when mode === 'visualize')
   ├─ PatternsList (when mode === 'patterns')
   │
   └─ BuildQueryTab ◄── NEW (when mode === 'build')
      │
      ├─ LeftSidebar (q-splitter before)
      │  ├─ ChartSelection (collapsed/expanded)
      │  └─ FieldList (collapsed/expanded)
      │
      ├─ MainArea (q-splitter after)
      │  ├─ QueryBuilderArea
      │  │  ├─ DashboardQueryBuilder
      │  │  │  ├─ XAxisContainer
      │  │  │  ├─ YAxisContainer
      │  │  │  ├─ ZAxisContainer (conditional)
      │  │  │  ├─ BreakdownContainer
      │  │  │  └─ FilterBuilder
      │  │  │
      │  │  └─ OutdatedWarning (conditional)
      │  │
      │  ├─ ChartPreviewArea
      │  │  ├─ WarningIndicators
      │  │  ├─ PanelSchemaRenderer
      │  │  │  └─ ChartRenderer (echarts)
      │  │  └─ ActionButtons
      │  │     ├─ AddToDashboardButton
      │  │     ├─ ExportQueryButton
      │  │     └─ CreateAlertButton
      │  │
      │  └─ GeneratedQueryDisplay (collapsible)
      │     └─ SQLCodeBlock (syntax highlighted)
      │
      └─ RightSidebar (q-splitter separator)
         └─ PanelSidebar
            └─ ConfigPanel
               ├─ ChartSettings
               ├─ AxisConfiguration
               ├─ ColorSettings
               └─ DataLimits
```

### State Management Architecture

```typescript
// Context Provider Pattern
provide("dashboardPanelDataPageKey", "logs")

// Shared State (from useDashboardPanel composable)
const {
  dashboardPanelData,      // Reactive state object
  makeAutoSQLQuery,        // SQL generator function
  addXAxisItem,            // Field manipulation functions
  addYAxisItem,
  addBreakDownAxisItem,
  resetDashboardPanelData,
  validatePanel,
  updateGroupedFields,
} = useDashboardPanelData("logs")

// State flows through provide/inject
provide("hoveredSeriesState", hoveredSeriesState)
provide("variablesAndPanelsDataLoadingState", loadingState)

// Child components inject the state
const dashboardPanelData = inject("dashboardPanelDataPageKey")
```

---

## Component Specifications

### 1. BuildQueryTab.vue (NEW)

**File Path:** `web/src/plugins/logs/BuildQueryTab.vue`

**Purpose:** Main container component for the Build tab, orchestrating query builder UI and state management.

#### Props
```typescript
interface Props {
  // Inherit context from parent logs page
  searchResponse?: Object;      // Current query results
  errorData: Object;            // Error tracking object
  shouldRefreshWithoutCache?: boolean;
}
```

#### Emits
```typescript
interface Emits {
  (e: 'query-changed', query: string): void;
  (e: 'visualization-saved', config: any): void;
  (e: 'error', error: any): void;
}
```

#### Template Structure
```vue
<template>
  <div class="build-query-tab">
    <!-- Three-column layout with splitters -->
    <div class="row" style="height: 100%">

      <!-- LEFT SIDEBAR: Chart Types + Fields -->
      <div class="tw:pl-[0.625rem]">
        <div class="col scroll card-container">
          <ChartSelection
            v-model:selectedChartType="dashboardPanelData.data.type"
            @update:selected-chart-type="handleChartTypeChange"
          />
        </div>
      </div>

      <q-separator vertical />

      <!-- MAIN CONTENT AREA -->
      <div class="col flex column">

        <!-- Field List Sidebar (collapsible) -->
        <div
          v-if="!dashboardPanelData.layout.showFieldList"
          class="field-list-sidebar-header-collapsed card-container"
          @click="collapseFieldList"
        >
          <q-icon name="expand_all" class="field-list-collapsed-icon rotate-90" />
          <div class="field-list-collapsed-title">{{ t("panel.fields") }}</div>
        </div>

        <q-splitter
          v-model="dashboardPanelData.layout.splitter"
          :limits="[0, 20]"
        >
          <template #before>
            <div class="field-list-container">
              <FieldList
                :editMode="true"
                :hideAllFieldsSelection="false"
              />
            </div>
          </template>

          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
            <q-btn
              color="primary"
              size="sm"
              :icon="dashboardPanelData.layout.showFieldList ? 'chevron_left' : 'chevron_right'"
              dense
              round
              @click.stop="collapseFieldList"
            />
          </template>

          <template #after>
            <div class="main-content-area card-container">

              <!-- Query Builder Section -->
              <DashboardQueryBuilder :dashboardData="{}" />

              <q-separator />

              <!-- Outdated Warning -->
              <div v-if="isOutdated" class="outdated-warning">
                <div class="warning-title">Your chart is not up to date</div>
                <div class="warning-message">
                  Chart configuration has been updated, but the chart was not updated automatically.
                  Click on the "Run Query" button to run the query again.
                </div>
              </div>

              <!-- Chart Preview -->
              <div class="chart-preview-container">

                <!-- Warning/Error Indicators -->
                <div class="indicators-row">
                  <q-btn
                    v-if="errorMessage"
                    :icon="outlinedWarning"
                    flat
                    size="xs"
                    class="warning q-mr-xs"
                  >
                    <q-tooltip>{{ errorMessage }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    v-if="maxQueryRangeWarning"
                    :icon="outlinedWarning"
                    flat
                    size="xs"
                    class="warning q-mr-xs"
                  >
                    <q-tooltip>{{ maxQueryRangeWarning }}</q-tooltip>
                  </q-btn>

                  <q-btn
                    size="md"
                    color="primary"
                    @click="addToDashboard"
                    :disabled="errorData?.errors?.length > 0"
                  >
                    {{ t("search.addToDashboard") }}
                  </q-btn>
                </div>

                <!-- Chart Renderer -->
                <PanelSchemaRenderer
                  :key="dashboardPanelData.data.type"
                  :panelSchema="chartData"
                  :selectedTimeObj="dashboardPanelData.meta.dateTime"
                  :variablesData="{}"
                  :showLegendsButton="true"
                  :width="6"
                  :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
                  :allowAlertCreation="true"
                  @metadata-update="handleMetadataUpdate"
                  @result-metadata-update="handleResultMetadataUpdate"
                  @error="handleChartApiError"
                  @series-data-update="seriesDataUpdate"
                  @show-legends="showLegendsDialog = true"
                  ref="panelSchemaRendererRef"
                />
              </div>

              <!-- Generated SQL Display -->
              <GeneratedQueryDisplay
                :query="dashboardPanelData.data.queries[0].query"
                :collapsed="sqlDisplayCollapsed"
                @toggle="sqlDisplayCollapsed = !sqlDisplayCollapsed"
              />

              <!-- Error Display -->
              <DashboardErrorsComponent
                :errors="errorData"
                class="col-auto"
              />

            </div>
          </template>
        </q-splitter>
      </div>

      <q-separator vertical />

      <!-- RIGHT SIDEBAR: Configuration Panel -->
      <div class="col-auto">
        <PanelSidebar
          :title="t('dashboard.configLabel')"
          v-model="dashboardPanelData.layout.isConfigPanelOpen"
        >
          <ConfigPanel
            :dashboardPanelData="dashboardPanelData"
            :panelData="seriesData"
          />
        </PanelSidebar>
      </div>

    </div>

    <!-- Dialogs -->
    <q-dialog v-model="showLegendsDialog">
      <ShowLegendsPopup
        :panelData="currentPanelData"
        @close="showLegendsDialog = false"
      />
    </q-dialog>

    <q-dialog
      v-model="showAddToDashboardDialog"
      position="right"
      full-height
      maximized
    >
      <AddToDashboard
        @save="handlePanelSaved"
        :dashboardPanelData="dashboardPanelData"
      />
    </q-dialog>
  </div>
</template>
```

#### Script Setup
```vue
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onActivated, provide, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import { isEqual } from "lodash-es";

// Components
import ChartSelection from "@/components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "@/components/dashboards/addPanel/FieldList.vue";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import PanelSidebar from "@/components/dashboards/addPanel/PanelSidebar.vue";
import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import DashboardErrorsComponent from "@/components/dashboards/addPanel/DashboardErrors.vue";
import GeneratedQueryDisplay from "@/plugins/logs/GeneratedQueryDisplay.vue";

// Composables
import useDashboardPanelData from "@/composables/useDashboardPanel";
import useNotifications from "@/composables/useNotifications";
import { searchState } from "@/composables/useLogs/searchState";

// Utils
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import { outlinedWarning } from "@quasar/extras/material-icons-outlined";
import { symOutlinedDataInfoAlert } from "@quasar/extras/material-symbols-outlined";

export default defineComponent({
  name: "BuildQueryTab",

  components: {
    ChartSelection,
    FieldList,
    DashboardQueryBuilder,
    PanelSchemaRenderer,
    PanelSidebar,
    ConfigPanel,
    DashboardErrorsComponent,
    GeneratedQueryDisplay,
  },

  props: {
    searchResponse: {
      type: Object,
      required: false,
    },
    errorData: {
      type: Object,
      required: true,
    },
    shouldRefreshWithoutCache: {
      type: Boolean,
      required: false,
      default: false,
    },
  },

  emits: ['query-changed', 'visualization-saved', 'error'],

  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const route = useRoute();
    const { showErrorNotification } = useNotifications();
    const { searchObj } = searchState();

    // Provide page key for dashboard panel composable
    provide("dashboardPanelDataPageKey", "logs");

    // Initialize dashboard panel data with "logs" context
    const {
      dashboardPanelData,
      resetDashboardPanelData,
      resetAggregationFunction,
      validatePanel,
      makeAutoSQLQuery,
    } = useDashboardPanelData("logs");

    // Local state
    const chartData = ref({});
    const seriesData = ref([]);
    const sqlDisplayCollapsed = ref(true);
    const showLegendsDialog = ref(false);
    const showAddToDashboardDialog = ref(false);
    const panelSchemaRendererRef = ref(null);

    // Warning states
    const errorMessage = ref("");
    const maxQueryRangeWarning = ref("");
    const limitNumberOfSeriesWarningMessage = ref("");

    // Hover state for cross-component communication
    const hoveredSeriesState = ref({
      hoveredSeriesName: "",
      panelId: -1,
      dataIndex: -1,
      seriesIndex: -1,
      hoveredTime: null,
      setHoveredSeriesName: function (name: string) {
        hoveredSeriesState.value.hoveredSeriesName = name ?? "";
      },
      setIndex: function (dataIndex: number, seriesIndex: number, panelId: any, hoveredTime?: any) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
        hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
      },
    });

    provide("hoveredSeriesState", hoveredSeriesState);

    // Computed: Check if configuration is outdated
    const isOutdated = computed(() => {
      const configChanged = !isEqual(chartData.value, dashboardPanelData.data);

      if (configChanged) {
        return checkIfConfigChangeRequiredApiCallOrNot(
          chartData.value,
          dashboardPanelData.data
        );
      }
      return false;
    });

    // Computed: Current panel data for legends
    const currentPanelData = computed(() => {
      const rendererData = panelSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: dashboardPanelData.data.config || {},
      };
    });

    // Initialize from logs context
    const initializeFromLogsContext = () => {
      // Set stream from current search
      if (searchObj.data.stream?.selectedStream?.length > 0) {
        dashboardPanelData.data.queries[0].fields.stream =
          searchObj.data.stream.selectedStream[0].value;
        dashboardPanelData.data.queries[0].fields.stream_type = "logs";
      }

      // Set time range from search
      if (searchObj.meta.dateTime) {
        dashboardPanelData.meta.dateTime = {
          start_time: searchObj.meta.dateTime.start_time,
          end_time: searchObj.meta.dateTime.end_time,
        };
      }

      // Set default chart type
      if (!dashboardPanelData.data.type) {
        dashboardPanelData.data.type = "bar";
      }

      // Add default timestamp field to X-axis if empty
      if (dashboardPanelData.data.queries[0].fields.x.length === 0) {
        dashboardPanelData.data.queries[0].fields.x.push({
          column: "_timestamp",
          alias: "x_axis_1",
          aggregationFunction: "histogram",
          args: ["1 hour"],
        });
      }

      // Add default count to Y-axis if empty
      if (dashboardPanelData.data.queries[0].fields.y.length === 0) {
        dashboardPanelData.data.queries[0].fields.y.push({
          column: "*",
          alias: "y_axis_1",
          aggregationFunction: "count",
        });
      }

      // Generate initial query
      makeAutoSQLQuery();

      // Copy to chartData for rendering
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
    };

    // Handle chart type change
    const handleChartTypeChange = (newType: string) => {
      dashboardPanelData.data.type = newType;
      resetAggregationFunction();

      // Regenerate query for new chart type
      makeAutoSQLQuery();
    };

    // Handle field list collapse/expand
    const collapseFieldList = () => {
      if (dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.showFieldList = false;
        dashboardPanelData.layout.splitter = 0;
      } else {
        dashboardPanelData.layout.showFieldList = true;
        dashboardPanelData.layout.splitter = 20;
      }
      window.dispatchEvent(new Event("resize"));
    };

    // Handle chart errors
    const handleChartApiError = (errorMsg: any) => {
      if (typeof errorMsg === "string") {
        errorMessage.value = errorMsg;
        props.errorData.errors = [errorMsg];
      } else if (errorMsg?.message) {
        errorMessage.value = errorMsg.message;
        props.errorData.errors = [errorMsg.message];
      } else {
        errorMessage.value = "";
      }

      emit('error', errorMsg);
    };

    // Handle metadata updates
    const handleMetadataUpdate = (metadata: any) => {
      // Process metadata if needed
    };

    // Handle result metadata (warnings, errors)
    const handleResultMetadataUpdate = (metadata: any) => {
      maxQueryRangeWarning.value = processQueryMetadataErrors(
        metadata,
        store.state.timezone
      );
    };

    // Handle series data updates
    const seriesDataUpdate = (data: any) => {
      seriesData.value = data;
    };

    // Add to dashboard
    const addToDashboard = () => {
      const errors: any = [];
      validatePanel(errors, true);

      if (errors.length) {
        props.errorData.errors = errors;
        showErrorNotification(
          "There are some errors, please fix them and try again"
        );
        return;
      }

      showAddToDashboardDialog.value = true;
    };

    // Handle panel saved to dashboard
    const handlePanelSaved = () => {
      showAddToDashboardDialog.value = false;
      emit('visualization-saved', dashboardPanelData.data);
    };

    // Watch for panel data changes
    watch(
      () => dashboardPanelData.data,
      (newVal) => {
        // Emit query change
        if (newVal.queries[0]?.query) {
          emit('query-changed', newVal.queries[0].query);
        }
      },
      { deep: true }
    );

    // Watch for config changes to update chart
    watch(
      () => dashboardPanelData.data,
      (newVal) => {
        if (!isEqual(chartData.value, newVal)) {
          const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
            chartData.value,
            newVal
          );

          if (!configNeedsApiCall) {
            // Update chart without API call (visual config only)
            chartData.value = JSON.parse(JSON.stringify(newVal));
            window.dispatchEvent(new Event("resize"));
          }
        }
      },
      { deep: true }
    );

    // Watch for outdated state
    watch(isOutdated, () => {
      window.dispatchEvent(new Event("resize"));
    });

    // Watch config panel state
    watch(
      () => dashboardPanelData.layout.isConfigPanelOpen,
      () => {
        window.dispatchEvent(new Event("resize"));
      }
    );

    // Lifecycle: Mount
    onMounted(() => {
      initializeFromLogsContext();
    });

    // Lifecycle: Activated (when switching back to Build tab)
    onActivated(() => {
      // Keep field list closed by default for Build tab
      dashboardPanelData.layout.showFieldList = true;
      dashboardPanelData.layout.splitter = 20;

      // Refresh if context changed
      if (searchObj.data.stream?.selectedStream?.length > 0) {
        const currentStream = dashboardPanelData.data.queries[0].fields.stream;
        const searchStream = searchObj.data.stream.selectedStream[0].value;

        if (currentStream !== searchStream) {
          initializeFromLogsContext();
        }
      }
    });

    return {
      t,
      store,
      dashboardPanelData,
      chartData,
      seriesData,
      sqlDisplayCollapsed,
      showLegendsDialog,
      showAddToDashboardDialog,
      panelSchemaRendererRef,
      isOutdated,
      currentPanelData,
      errorMessage,
      maxQueryRangeWarning,
      limitNumberOfSeriesWarningMessage,
      handleChartTypeChange,
      collapseFieldList,
      handleChartApiError,
      handleMetadataUpdate,
      handleResultMetadataUpdate,
      seriesDataUpdate,
      addToDashboard,
      handlePanelSaved,
      outlinedWarning,
      symOutlinedDataInfoAlert,
    };
  },
});
</script>
```

#### Styles
```vue
<style lang="scss" scoped>
.build-query-tab {
  height: 100%;
  width: 100%;
}

.field-list-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
}

.main-content-area {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.outdated-warning {
  border-color: #c3920d;
  border-width: 1px;
  border-style: solid;
  background-color: var(--q-dark) ? #2a1f03 : #faf2da;
  padding: 12px;
  margin: 12px;
  border-radius: 5px;

  .warning-title {
    font-weight: 700;
    margin-bottom: 4px;
  }

  .warning-message {
    font-size: 14px;
  }
}

.chart-preview-container {
  flex: 1;
  min-height: 300px;
  position: relative;
  display: flex;
  flex-direction: column;
}

.indicators-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 8px 16px;
  gap: 8px;
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
}

.warning {
  color: var(--q-warning);
}

.splitter-vertical {
  width: 4px;
  height: 100%;
}

.splitter-enabled {
  background-color: transparent;
  transition: 0.3s;
  transition-delay: 0.2s;

  &:hover {
    background-color: orange;
  }
}

.field-list-sidebar-header-collapsed {
  cursor: pointer;
  width: 50px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
}

.field-list-collapsed-icon {
  margin-top: 10px;
  font-size: 20px;
}

.field-list-collapsed-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-weight: bold;
}
</style>
```

---

### 2. GeneratedQueryDisplay.vue (NEW)

**File Path:** `web/src/plugins/logs/GeneratedQueryDisplay.vue`

**Purpose:** Display auto-generated SQL query with syntax highlighting and controls.

#### Template
```vue
<template>
  <div class="generated-query-display">
    <div class="query-header" @click="toggleCollapse">
      <div class="header-left">
        <q-icon
          :name="collapsed ? 'chevron_right' : 'expand_more'"
          size="sm"
          class="collapse-icon"
        />
        <span class="header-title">Generated SQL Query</span>
        <q-chip
          size="sm"
          color="primary"
          text-color="white"
          class="auto-chip"
        >
          Auto-generated
        </q-chip>
      </div>

      <div class="header-actions" @click.stop>
        <q-btn
          flat
          dense
          size="sm"
          icon="content_copy"
          @click="copyQuery"
          class="action-btn"
        >
          <q-tooltip>Copy SQL</q-tooltip>
        </q-btn>

        <q-btn
          flat
          dense
          size="sm"
          icon="open_in_new"
          @click="openInSQLMode"
          class="action-btn"
        >
          <q-tooltip>Edit in SQL mode</q-tooltip>
        </q-btn>
      </div>
    </div>

    <q-slide-transition>
      <div v-show="!collapsed" class="query-content">
        <pre class="sql-code"><code v-html="highlightedQuery"></code></pre>
      </div>
    </q-slide-transition>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "GeneratedQueryDisplay",

  props: {
    query: {
      type: String,
      required: true,
    },
    collapsed: {
      type: Boolean,
      default: true,
    },
  },

  emits: ['toggle', 'copy', 'edit'],

  setup(props, { emit }) {
    const $q = useQuasar();

    // SQL syntax highlighting (simple regex-based)
    const highlightedQuery = computed(() => {
      if (!props.query) return "";

      let highlighted = props.query;

      // Keywords
      const keywords = [
        'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT',
        'AND', 'OR', 'NOT', 'IN', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT',
        'INNER', 'OUTER', 'HAVING', 'DISTINCT', 'COUNT', 'SUM', 'AVG',
        'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
      ];

      keywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        highlighted = highlighted.replace(
          regex,
          `<span class="sql-keyword">${keyword}</span>`
        );
      });

      // Functions
      highlighted = highlighted.replace(
        /(\w+)\s*\(/g,
        '<span class="sql-function">$1</span>('
      );

      // Strings
      highlighted = highlighted.replace(
        /'([^']*)'/g,
        '<span class="sql-string">\'$1\'</span>'
      );

      // Numbers
      highlighted = highlighted.replace(
        /\b(\d+\.?\d*)\b/g,
        '<span class="sql-number">$1</span>'
      );

      // Comments
      highlighted = highlighted.replace(
        /--([^\n]*)/g,
        '<span class="sql-comment">--$1</span>'
      );

      return highlighted;
    });

    const toggleCollapse = () => {
      emit('toggle');
    };

    const copyQuery = async () => {
      try {
        await navigator.clipboard.writeText(props.query);
        $q.notify({
          type: 'positive',
          message: 'SQL query copied to clipboard',
          timeout: 2000,
        });
        emit('copy');
      } catch (error) {
        $q.notify({
          type: 'negative',
          message: 'Failed to copy query',
          timeout: 2000,
        });
      }
    };

    const openInSQLMode = () => {
      emit('edit');
    };

    return {
      highlightedQuery,
      toggleCollapse,
      copyQuery,
      openInSQLMode,
    };
  },
});
</script>

<style lang="scss" scoped>
.generated-query-display {
  border: 1px solid var(--q-border-color, #e0e0e0);
  border-radius: 4px;
  margin: 12px;
  overflow: hidden;
}

.query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--q-dark) ? #2c2c2c : #f5f5f5;
  cursor: pointer;
  user-select: none;

  &:hover {
    background-color: var(--q-dark) ? #3a3a3a : #ececec;
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-icon {
  transition: transform 0.3s;
}

.header-title {
  font-weight: 600;
  font-size: 14px;
}

.auto-chip {
  font-size: 11px;
  height: 20px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  min-width: auto;
  padding: 4px 8px;
}

.query-content {
  padding: 12px;
  background-color: var(--q-dark) ? #1e1e1e : #ffffff;
  max-height: 400px;
  overflow-y: auto;
}

.sql-code {
  margin: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;

  :deep(.sql-keyword) {
    color: #569cd6;
    font-weight: bold;
  }

  :deep(.sql-function) {
    color: #dcdcaa;
  }

  :deep(.sql-string) {
    color: #ce9178;
  }

  :deep(.sql-number) {
    color: #b5cea8;
  }

  :deep(.sql-comment) {
    color: #6a9955;
    font-style: italic;
  }
}
</style>
```

---

### 3. Integration with Index.vue (Logs Page)

**File Path:** `web/src/plugins/logs/Index.vue`

**Changes Required:**

#### Add Build Tab to Navigation

```vue
<!-- Add to tab navigation (around line 200-300) -->
<template>
  <!-- Existing tabs -->
  <q-tabs>
    <q-tab name="logs" label="Logs" />
    <q-tab name="visualize" label="Visualize" />
    <q-tab name="patterns" label="Patterns" />
    <q-tab name="build" label="Build" />  <!-- NEW TAB -->
  </q-tabs>

  <!-- Tab content -->
  <q-tab-panels v-model="searchObj.meta.logsVisualizeToggle">
    <!-- Existing panels -->
    <q-tab-panel name="logs">
      <SearchResult ... />
    </q-tab-panel>

    <q-tab-panel name="visualize">
      <VisualizeLogsQuery ... />
    </q-tab-panel>

    <q-tab-panel name="patterns">
      <PatternsList ... />
    </q-tab-panel>

    <!-- NEW PANEL -->
    <q-tab-panel name="build">
      <BuildQueryTab
        :searchResponse="searchObj.data.queryResults"
        :errorData="errorData"
        :shouldRefreshWithoutCache="shouldRefreshWithoutCache"
        @query-changed="handleBuildQueryChanged"
        @visualization-saved="handleVisualizationSaved"
        @error="handleBuildError"
      />
    </q-tab-panel>
  </q-tab-panels>
</template>

<script>
import BuildQueryTab from "./BuildQueryTab.vue";

export default {
  components: {
    // ... existing components
    BuildQueryTab,
  },

  setup() {
    // ... existing setup

    const handleBuildQueryChanged = (query: string) => {
      // Optionally sync generated query back to main search
      console.log("Generated query:", query);
    };

    const handleVisualizationSaved = (config: any) => {
      // Show success notification
      $q.notify({
        type: 'positive',
        message: 'Visualization saved to dashboard',
        timeout: 3000,
      });
    };

    const handleBuildError = (error: any) => {
      // Handle errors from Build tab
      console.error("Build tab error:", error);
    };

    return {
      // ... existing returns
      handleBuildQueryChanged,
      handleVisualizationSaved,
      handleBuildError,
    };
  },
};
</script>
```

---

## Data Models

### dashboardPanelData Structure (Full Schema)

```typescript
interface DashboardPanelData {
  data: {
    version: number;                      // Schema version (currently 5)
    id: string;                           // Panel ID (auto-generated)
    type: ChartType;                      // Chart type
    title: string;                        // Panel title
    description: string;                  // Panel description
    config: ChartConfig;                  // Chart-specific configuration
    queries: PanelQuery[];                // Array of queries (multi-query support)
    queryType: 'sql' | 'promql';         // Query language
  };

  layout: {
    splitter: number;                     // Field list splitter position (0-100)
    querySplitter: number;                // Query editor splitter position (0-100)
    showQueryBar: boolean;                // Show query editor
    isConfigPanelOpen: boolean;           // Config panel visibility
    currentQueryIndex: number;            // Active query index (for multi-query)
    vrlFunctionToggle: boolean;           // VRL function editor visibility
    showFieldList: boolean;               // Field list visibility
  };

  meta: {
    parsedQuery: string;                  // Parsed query (internal use)
    dragAndDrop: DragDropState;           // Drag state tracking
    dateTime: {
      start_time: Date | string;          // Query time range start
      end_time: Date | string;            // Query time range end
    };
    stream: StreamMetadata;               // Stream-related metadata
  };
}

type ChartType =
  | 'area'
  | 'area-stacked'
  | 'bar'
  | 'h-bar'
  | 'line'
  | 'scatter'
  | 'pie'
  | 'donut'
  | 'metric'
  | 'gauge'
  | 'table'
  | 'heatmap'
  | 'h-stacked'
  | 'stacked'
  | 'geomap'
  | 'sankey';

interface ChartConfig {
  show_legends: boolean;
  legends_position: 'bottom' | 'right' | 'top' | 'left';
  unit: string | null;                    // Y-axis unit
  unit_custom: string | null;             // Custom unit string
  axis_width: number | null;
  axis_border_show: boolean;
  connect_nulls: boolean;
  decimals: number | null;
  [key: string]: any;                     // Chart-specific configs
}

interface PanelQuery {
  query: string;                          // Generated/custom SQL
  vrlFunctionQuery: string;               // VRL transformation query
  customQuery: boolean;                   // true = custom SQL, false = auto-gen
  joins: QueryJoin[];                     // Multi-stream joins
  fields: QueryFields;                    // Field configuration
  config: QueryConfig;                    // Query-specific config
}

interface QueryFields {
  stream: string;                         // Stream name
  stream_type: 'logs' | 'metrics' | 'traces';

  // Standard axes
  x: AxisField[];                         // X-axis (time/category)
  y: AxisField[];                         // Y-axis (metrics)
  z: AxisField[];                         // Z-axis (for 3D charts)
  breakdown: AxisField[];                 // Grouping/breakdown dimension

  // Filter conditions
  filter: FilterConfig;

  // Map-specific fields
  latitude: AxisField | null;
  longitude: AxisField | null;
  weight: AxisField | null;

  // Geo map fields
  name: AxisField | null;
  value_for_maps: AxisField | null;

  // Sankey diagram fields
  source: AxisField | null;
  target: AxisField | null;
  value: AxisField | null;
}

interface AxisField {
  column: string;                         // Field name
  alias: string;                          // Display alias
  aggregationFunction?: string;           // COUNT, SUM, AVG, MIN, MAX, etc.
  args?: any[];                           // Function arguments (e.g., histogram interval)
  isDerived?: boolean;                    // Is this a VRL-derived field?
  sortBy?: 'ASC' | 'DESC';               // Sort direction
}

interface FilterConfig {
  filterType: 'group' | 'condition';
  logicalOperator: 'AND' | 'OR';
  conditions: FilterCondition[];
}

interface FilterCondition {
  column: string;                         // Field to filter
  operator: ComparisonOperator;           // Comparison operator
  value: any;                             // Filter value
  logicalOperator?: 'AND' | 'OR';        // Connector to next condition
}

type ComparisonOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'IN'
  | 'NOT IN'
  | 'LIKE'
  | 'NOT LIKE'
  | 'IS NULL'
  | 'IS NOT NULL';

interface QueryConfig {
  promql_legend: string;                  // PromQL legend template
  step_value: number | null;              // PromQL step
  layer_type: 'scatter' | 'heatmap';     // Map layer type
  weight_fixed: number;                   // Fixed weight for maps
  limit: number;                          // Result limit
  min: number;                            // Gauge min value
  max: number;                            // Gauge max value
  time_shift: any[];                      // Time shift configuration
}

interface QueryJoin {
  stream: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  joinOn: {
    left: string;
    right: string;
  }[];
}

interface StreamMetadata {
  hasUserDefinedSchemas: boolean;
  interestingFieldList: string[];
  userDefinedSchema: SchemaField[];
  vrlFunctionFieldList: SchemaField[];
  selectedStreamFields: SchemaField[];
  customQueryFields: SchemaField[];
  streamResults: any[];
  filterField: string;
}

interface SchemaField {
  name: string;
  type: string;                           // Utf8, Int64, Float64, Boolean, etc.
}
```

---

## Integration Points

### 1. Search Context Integration

**Bidirectional sync between main search and Build tab:**

```typescript
// When entering Build tab
const syncFromSearch = () => {
  // Extract stream
  dashboardPanelData.data.queries[0].fields.stream =
    searchObj.data.stream.selectedStream[0].value;

  // Extract time range
  dashboardPanelData.meta.dateTime = {
    start_time: searchObj.meta.dateTime.start_time,
    end_time: searchObj.meta.dateTime.end_time,
  };

  // Parse existing SQL query (if in SQL mode and query exists)
  if (searchObj.meta.sqlMode && searchObj.data.query) {
    // Attempt to parse SQL into visual builder
    try {
      const parsed = parseSQLIntoFields(searchObj.data.query);
      if (parsed) {
        Object.assign(dashboardPanelData.data.queries[0].fields, parsed);
      }
    } catch (error) {
      // If parsing fails, start with defaults
      console.warn("Could not parse SQL query:", error);
    }
  }
};

// When exiting Build tab
const syncToSearch = () => {
  // Optionally update search query with generated SQL
  if (dashboardPanelData.data.queries[0].query) {
    searchObj.data.query = dashboardPanelData.data.queries[0].query;
    searchObj.meta.sqlMode = true;
  }
};
```

### 2. Field Schema Loading

**Use existing stream schema API:**

```typescript
// useDashboardPanel.ts already handles this
const updateGroupedFields = async () => {
  const stream = dashboardPanelData.data.queries[currentQueryIndex].fields.stream;
  const streamType = dashboardPanelData.data.queries[currentQueryIndex].fields.stream_type;

  if (!stream) return;

  try {
    const schema = await getStream(stream, streamType, true);

    // Update stream metadata
    dashboardPanelData.meta.stream.selectedStreamFields = schema.schema || [];
    dashboardPanelData.meta.stream.userDefinedSchema = schema.uds_schema || [];
    dashboardPanelData.meta.stream.hasUserDefinedSchemas = schema.has_uds || false;

    // Group fields by type for FieldList
    // (This is handled automatically by FieldList component)
  } catch (error) {
    console.error("Failed to load stream schema:", error);
  }
};
```

### 3. Query Execution

**Reuse PanelSchemaRenderer's query execution:**

```typescript
// PanelSchemaRenderer automatically executes queries when:
// 1. panelSchema prop changes
// 2. selectedTimeObj changes
// 3. shouldRefreshWithoutCache changes

// In BuildQueryTab.vue:
const runQuery = () => {
  // Update chartData to trigger PanelSchemaRenderer
  chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

  // Optionally force cache refresh
  shouldRefreshWithoutCache.value = true;

  // Reset outdated flag
  nextTick(() => {
    shouldRefreshWithoutCache.value = false;
  });
};
```

### 4. Dashboard Save Integration

**Use existing AddToDashboard component:**

```vue
<q-dialog v-model="showAddToDashboardDialog">
  <AddToDashboard
    @save="handlePanelSaved"
    :dashboardPanelData="dashboardPanelData"
  />
</q-dialog>
```

```typescript
const handlePanelSaved = async (dashboardInfo: any) => {
  try {
    // AddToDashboard component handles the actual save
    // We just need to show success feedback

    showPositiveNotification("Visualization saved to dashboard");

    // Optionally navigate to dashboard
    if (dashboardInfo.shouldNavigate) {
      router.push({
        path: "/dashboards/view",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: dashboardInfo.dashboardId,
          folder: dashboardInfo.folderId,
        },
      });
    }
  } catch (error) {
    showErrorNotification("Failed to save visualization");
  }
};
```

---

## Implementation Plan

### Phase 1: Core Components (Week 1)

**Tasks:**
1. Create `BuildQueryTab.vue` component
   - [ ] Basic layout with splitters
   - [ ] Integrate ChartSelection component
   - [ ] Integrate FieldList component
   - [ ] Initialize dashboardPanelData from logs context
   - [ ] Add lifecycle hooks (mount, activate)

2. Create `GeneratedQueryDisplay.vue` component
   - [ ] SQL syntax highlighting
   - [ ] Copy to clipboard
   - [ ] Collapse/expand functionality

3. Integrate with `Index.vue`
   - [ ] Add "Build" tab to navigation
   - [ ] Add tab panel for BuildQueryTab
   - [ ] Wire up event handlers

**Acceptance Criteria:**
- [ ] Build tab visible in logs page
- [ ] Field list displays stream fields
- [ ] Chart type selection works
- [ ] Generated SQL displays correctly
- [ ] No console errors

### Phase 2: Query Builder Integration (Week 2)

**Tasks:**
1. Integrate DashboardQueryBuilder
   - [ ] Add to BuildQueryTab layout
   - [ ] Wire up field drag-and-drop
   - [ ] Connect to dashboardPanelData

2. Auto SQL generation
   - [ ] Watch field changes
   - [ ] Trigger makeAutoSQLQuery()
   - [ ] Display generated query

3. Field configuration
   - [ ] Aggregation function selection
   - [ ] Custom alias editing
   - [ ] VRL function support (future)

**Acceptance Criteria:**
- [ ] Drag field from list to X-axis → updates query
- [ ] Drag field to Y-axis → adds with aggregation
- [ ] Breakdown field → adds GROUP BY
- [ ] Filter conditions → adds WHERE clause
- [ ] Generated SQL is valid and executable

### Phase 3: Chart Preview (Week 3)

**Tasks:**
1. Integrate PanelSchemaRenderer
   - [ ] Add to BuildQueryTab layout
   - [ ] Connect to chartData
   - [ ] Handle query execution

2. Chart preview controls
   - [ ] Show/hide warnings
   - [ ] Error display
   - [ ] Loading states

3. Outdated indicator
   - [ ] Detect config changes
   - [ ] Show warning banner
   - [ ] "Apply" button functionality

**Acceptance Criteria:**
- [ ] Chart renders when query executes
- [ ] Preview updates on "Apply"
- [ ] Errors displayed inline
- [ ] Warnings shown for limits/performance
- [ ] Loading spinner during execution

### Phase 4: Configuration Panel (Week 4)

**Tasks:**
1. Integrate ConfigPanel
   - [ ] Add to right sidebar
   - [ ] Wire up config changes
   - [ ] Test all chart settings

2. Chart-specific configs
   - [ ] Legend position
   - [ ] Axis labels
   - [ ] Colors
   - [ ] Data limits

**Acceptance Criteria:**
- [ ] Config panel opens/closes
- [ ] Settings apply to chart
- [ ] Chart-specific options show/hide
- [ ] Visual-only changes don't trigger query

### Phase 5: Actions & Integrations (Week 5)

**Tasks:**
1. Add to Dashboard
   - [ ] Integrate AddToDashboard dialog
   - [ ] Validate before save
   - [ ] Show success/error feedback

2. Export/Share
   - [ ] Copy SQL query
   - [ ] Export as JSON (future)

3. Alert creation (future)
   - [ ] Navigate to alerts with query

4. Context sync
   - [ ] Sync stream selection
   - [ ] Sync time range
   - [ ] Handle mode switching

**Acceptance Criteria:**
- [ ] "Add to Dashboard" saves successfully
- [ ] SQL copy works
- [ ] Stream changes sync from search
- [ ] Time range updates when changed
- [ ] No data loss on tab switching

### Phase 6: Polish & Testing (Week 6)

**Tasks:**
1. UI polish
   - [ ] Responsive layout
   - [ ] Accessibility (keyboard nav, ARIA)
   - [ ] Loading states
   - [ ] Empty states
   - [ ] Error states

2. Testing
   - [ ] Unit tests for new components
   - [ ] Integration tests for workflows
   - [ ] E2E tests for critical paths
   - [ ] Cross-browser testing

3. Documentation
   - [ ] User guide
   - [ ] API documentation
   - [ ] Code comments

**Acceptance Criteria:**
- [ ] All unit tests pass
- [ ] E2E tests cover main workflows
- [ ] Works in Chrome, Firefox, Safari
- [ ] Keyboard navigation functional
- [ ] Screen reader compatible

---

## Testing Strategy

### Unit Tests

```typescript
// BuildQueryTab.spec.ts
describe('BuildQueryTab', () => {
  it('initializes from logs context', () => {
    // Mock searchObj with stream and time
    const wrapper = mount(BuildQueryTab, {
      global: {
        provide: {
          searchObj: {
            data: { stream: { selectedStream: [{ value: 'test_stream' }] } },
            meta: { dateTime: { start_time: '...', end_time: '...' } }
          }
        }
      }
    });

    expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.stream)
      .toBe('test_stream');
  });

  it('generates SQL on field add', async () => {
    const wrapper = mount(BuildQueryTab);

    // Simulate field drag
    await wrapper.vm.addYAxisItem({
      column: 'response_time',
      aggregationFunction: 'AVG'
    });

    await nextTick();

    expect(wrapper.vm.dashboardPanelData.data.queries[0].query)
      .toContain('AVG(response_time)');
  });

  it('shows outdated warning on config change', async () => {
    const wrapper = mount(BuildQueryTab);

    // Run initial query
    wrapper.vm.chartData = { ...wrapper.vm.dashboardPanelData.data };

    // Change config
    wrapper.vm.dashboardPanelData.data.type = 'line';
    await nextTick();

    expect(wrapper.vm.isOutdated).toBe(true);
    expect(wrapper.find('.outdated-warning').exists()).toBe(true);
  });
});

// GeneratedQueryDisplay.spec.ts
describe('GeneratedQueryDisplay', () => {
  it('highlights SQL keywords', () => {
    const wrapper = mount(GeneratedQueryDisplay, {
      props: { query: 'SELECT * FROM logs WHERE level = "error"' }
    });

    expect(wrapper.html()).toContain('<span class="sql-keyword">SELECT</span>');
  });

  it('copies query to clipboard', async () => {
    const wrapper = mount(GeneratedQueryDisplay, {
      props: { query: 'SELECT * FROM logs' }
    });

    await wrapper.find('.copy-btn').trigger('click');

    // Mock clipboard
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('SELECT * FROM logs');
  });
});
```

### Integration Tests

```typescript
describe('Build Query Workflow', () => {
  it('creates visualization from scratch', async () => {
    // Mount logs page
    const wrapper = mount(IndexView);

    // Switch to Build tab
    await wrapper.find('[data-test="build-tab"]').trigger('click');

    // Select bar chart
    await wrapper.find('[data-test="chart-bar"]').trigger('click');

    // Drag field to X-axis
    await dragField(wrapper, 'timestamp', 'x-axis');

    // Drag field to Y-axis
    await dragField(wrapper, 'count', 'y-axis');

    // Click Apply
    await wrapper.find('[data-test="apply-btn"]').trigger('click');

    // Verify chart renders
    expect(wrapper.find('.echarts-container').exists()).toBe(true);

    // Add to dashboard
    await wrapper.find('[data-test="add-to-dashboard"]').trigger('click');

    // Select dashboard
    await wrapper.find('[data-test="dashboard-select"]').setValue('test_dashboard');

    // Save
    await wrapper.find('[data-test="save-btn"]').trigger('click');

    // Verify API call
    expect(apiMock.addPanel).toHaveBeenCalled();
  });
});
```

### E2E Tests (Playwright)

```typescript
test('Build query end-to-end', async ({ page }) => {
  // Navigate to logs page
  await page.goto('/logs');

  // Select stream
  await page.selectOption('[data-test="stream-select"]', 'nginx_logs');

  // Click Build tab
  await page.click('text=Build');

  // Verify initial state
  await expect(page.locator('[data-test="chart-preview"]')).toBeVisible();

  // Select line chart
  await page.click('[data-test="chart-line"]');

  // Drag timestamp to X-axis
  await page.dragAndDrop(
    '[data-test="field-timestamp"]',
    '[data-test="x-axis-drop-zone"]'
  );

  // Drag response_time to Y-axis
  await page.dragAndDrop(
    '[data-test="field-response_time"]',
    '[data-test="y-axis-drop-zone"]'
  );

  // Configure aggregation
  await page.click('[data-test="y-axis-field-0"]');
  await page.selectOption('[data-test="aggregation-select"]', 'AVG');
  await page.click('[data-test="apply-aggregation"]');

  // Apply changes
  await page.click('[data-test="run-query-btn"]');

  // Wait for chart to render
  await page.waitForSelector('.echarts-container');

  // Verify SQL generated
  const sqlText = await page.textContent('[data-test="generated-sql"]');
  expect(sqlText).toContain('AVG(response_time)');

  // Add to dashboard
  await page.click('[data-test="add-to-dashboard"]');

  // Fill dashboard name
  await page.fill('[data-test="dashboard-name"]', 'API Monitoring');

  // Save
  await page.click('[data-test="save-to-dashboard"]');

  // Verify success notification
  await expect(page.locator('.q-notification--positive')).toBeVisible();
});
```

---

## Performance Considerations

### 1. Debouncing Auto-Query Generation

```typescript
import { debounce } from 'lodash-es';

// Debounce query generation to avoid excessive calls
const debouncedMakeAutoSQLQuery = debounce(() => {
  makeAutoSQLQuery();
}, 500);

watch(
  () => [
    dashboardPanelData.data.queries[0].fields.x,
    dashboardPanelData.data.queries[0].fields.y,
    // ... other fields
  ],
  () => {
    if (!dashboardPanelData.data.queries[0].customQuery) {
      debouncedMakeAutoSQLQuery();
    }
  },
  { deep: true }
);
```

### 2. Lazy Loading Heavy Components

```typescript
// Lazy load config panel and other heavy components
const ConfigPanel = defineAsyncComponent(() =>
  import("@/components/dashboards/addPanel/ConfigPanel.vue")
);

const AddToDashboard = defineAsyncComponent(() =>
  import("@/plugins/metrics/AddToDashboard.vue")
);
```

### 3. Virtual Scrolling for Field List

```typescript
// FieldList.vue already implements pagination
// Ensure it's configured for optimal performance:
const fieldListConfig = {
  pageSize: 50,           // Show 50 fields at a time
  virtualScroll: true,    // Enable virtual scrolling
  lazyLoad: true          // Load schema on demand
};
```

### 4. Chart Rendering Optimization

```typescript
// Only re-render chart when necessary
const shouldUpdateChart = computed(() => {
  return checkIfConfigChangeRequiredApiCallOrNot(
    chartData.value,
    dashboardPanelData.data
  );
});

watch(
  () => dashboardPanelData.data,
  (newVal) => {
    if (shouldUpdateChart.value) {
      // Re-execute query
      chartData.value = JSON.parse(JSON.stringify(newVal));
    } else {
      // Just update visual config (no query)
      // ECharts will handle efficiently
    }
  },
  { deep: true }
);
```

### 5. Memory Management

```typescript
// Clean up on unmount
onUnmounted(() => {
  // Dispose chart instance
  if (panelSchemaRendererRef.value) {
    panelSchemaRendererRef.value.dispose();
  }

  // Clear large data objects
  chartData.value = {};
  seriesData.value = [];

  // Remove event listeners
  window.removeEventListener('resize', handleResize);
});
```

---

## Security Considerations

### 1. SQL Injection Prevention

```typescript
// All SQL generation goes through parameterized query builder
// Never concatenate user input directly into SQL

const buildSQLChartQuery = (fields: QueryFields) => {
  // Field names are validated against stream schema
  const validFields = fields.y.filter(field =>
    isValidFieldName(field.column)
  );

  // Filter values are escaped/parameterized
  const whereClause = buildWhereClause(fields.filter, {
    escapeValues: true,
    parameterize: true
  });

  return {
    query: `SELECT ${buildSelectClause(validFields)} FROM ${escapeIdentifier(fields.stream)} ${whereClause}`,
    parameters: extractParameters(fields.filter)
  };
};
```

### 2. XSS Prevention in SQL Display

```typescript
// GeneratedQueryDisplay.vue uses proper escaping
const highlightedQuery = computed(() => {
  // Escape HTML before highlighting
  const escaped = escapeHtml(props.query);

  // Then apply syntax highlighting with safe HTML
  return applyHighlighting(escaped);
});

const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};
```

### 3. Field Name Validation

```typescript
const isValidFieldName = (fieldName: string): boolean => {
  // Only allow alphanumeric, underscore, and dot
  const fieldNameRegex = /^[a-zA-Z0-9_\.]+$/;

  // Max length check
  if (fieldName.length > 255) return false;

  // Pattern match
  if (!fieldNameRegex.test(fieldName)) return false;

  // Reserved keywords check
  const reservedKeywords = ['SELECT', 'FROM', 'WHERE', 'DROP', 'INSERT'];
  if (reservedKeywords.includes(fieldName.toUpperCase())) return false;

  return true;
};
```

### 4. Rate Limiting Query Execution

```typescript
// Limit query execution frequency per user
const queryRateLimiter = createRateLimiter({
  maxRequests: 10,        // Max 10 queries
  windowMs: 60000,        // Per minute
  errorMessage: 'Too many queries. Please wait before trying again.'
});

const runQuery = async () => {
  try {
    await queryRateLimiter.check();
    // Execute query...
  } catch (error) {
    showErrorNotification(error.message);
  }
};
```

### 5. Dashboard Save Permissions

```typescript
const addToDashboard = async () => {
  // Validate user has permission to save to dashboard
  if (!hasPermission('dashboards:write')) {
    showErrorNotification('You do not have permission to save dashboards');
    return;
  }

  // Validate dashboard exists and user has access
  const dashboard = await getDashboard(selectedDashboardId);
  if (!dashboard || !canAccessDashboard(dashboard)) {
    showErrorNotification('Dashboard not found or access denied');
    return;
  }

  // Proceed with save...
};
```

---

## Appendix

### A. File Structure

```
web/src/
├── plugins/logs/
│   ├── Index.vue                         (Modified: Add Build tab)
│   ├── BuildQueryTab.vue                 (NEW: Main component)
│   ├── GeneratedQueryDisplay.vue         (NEW: SQL display)
│   └── VisualizeLogsQuery.vue            (Reference)
│
├── components/dashboards/addPanel/
│   ├── ChartSelection.vue                (Reused)
│   ├── FieldList.vue                     (Reused)
│   ├── DashboardQueryBuilder.vue         (Reused)
│   ├── PanelSidebar.vue                  (Reused)
│   ├── ConfigPanel.vue                   (Reused)
│   └── DashboardErrors.vue               (Reused)
│
├── components/dashboards/
│   └── PanelSchemaRenderer.vue           (Reused)
│
├── composables/
│   ├── useDashboardPanel.ts              (Existing)
│   ├── useNotifications.ts               (Existing)
│   └── useLogs/
│       └── searchState.ts                (Existing)
│
└── utils/dashboard/
    ├── dashboardAutoQueryBuilder.ts      (Existing)
    ├── checkConfigChangeApiCall.ts       (Existing)
    └── sqlUtils.ts                       (Existing)
```

### B. Component Size Estimates

| Component | Lines of Code | Complexity |
|-----------|---------------|------------|
| BuildQueryTab.vue | ~400 | High |
| GeneratedQueryDisplay.vue | ~200 | Low |
| Index.vue (modifications) | ~50 | Low |
| **Total New Code** | **~650** | - |

### C. API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/{org}/streams` | GET | List streams |
| `/api/{org}/{stream_name}/_schema` | GET | Get stream schema |
| `/api/{org}/logs/_search` | POST | Execute log query |
| `/api/{org}/dashboards` | POST | Create dashboard |
| `/api/{org}/dashboards/{id}` | PUT | Update dashboard |
| `/api/{org}/dashboards/{id}/panels` | POST | Add panel to dashboard |

### D. Browser Storage Usage

```typescript
// Optionally persist Build tab state to localStorage
const BUILD_TAB_STATE_KEY = 'openobserve_build_tab_state';

const saveBuildState = () => {
  const state = {
    chartType: dashboardPanelData.data.type,
    fields: dashboardPanelData.data.queries[0].fields,
    config: dashboardPanelData.data.config,
    timestamp: Date.now(),
  };

  localStorage.setItem(BUILD_TAB_STATE_KEY, JSON.stringify(state));
};

const restoreBuildState = () => {
  const saved = localStorage.getItem(BUILD_TAB_STATE_KEY);
  if (!saved) return false;

  try {
    const state = JSON.parse(saved);

    // Only restore if less than 1 hour old
    if (Date.now() - state.timestamp > 3600000) return false;

    Object.assign(dashboardPanelData.data, state);
    return true;
  } catch (error) {
    return false;
  }
};
```

### E. Future Enhancements

1. **SQL Parser** - Parse custom SQL back into visual builder
2. **Query Templates** - Pre-built query templates for common use cases
3. **AI Query Suggestions** - ML-powered field recommendations
4. **Multi-Query Support** - Join multiple streams in visual builder
5. **Saved Queries** - Save query configurations for reuse
6. **Query History** - Track and reuse previous queries
7. **Export Options** - Export to CSV, JSON, or other formats
8. **Real-time Preview** - Live preview without "Apply" button
9. **Collaborative Editing** - Share query builder state with team
10. **Query Optimization Hints** - Suggest performance improvements

---

## References

- [Design Document](./auto-sql-query-builder-design.md)
- [useDashboardPanel Composable](web/src/composables/useDashboardPanel.ts)
- [AddPanel Component](web/src/views/Dashboards/addPanel/AddPanel.vue)
- [VisualizeLogsQuery Component](web/src/plugins/logs/VisualizeLogsQuery.vue)
- [Dashboard Auto Query Builder](web/src/utils/dashboard/dashboardAutoQueryBuilder.ts)
