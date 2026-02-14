// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref, reactive, computed, watch, provide, inject, nextTick } from "vue";
import type { Ref, ComputedRef } from "vue";
import { useStore } from "vuex";
import { isEqual } from "lodash-es";

import type {
  PanelEditorPageType,
  PanelEditorConfig,
  PanelEditorChartData,
  PanelEditorErrorData,
  PanelEditorDateTime,
  PanelEditorVariablesData,
} from "../types/panelEditor";

import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { processQueryMetadataErrors } from "@/utils/zincutils";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";

/**
 * Options for usePanelEditor composable
 */
export interface UsePanelEditorOptions {
  /** The page type - determines default behavior */
  pageType: PanelEditorPageType;
  /** Resolved configuration (after merging props with presets) */
  config: PanelEditorConfig;
  /** Dashboard panel data from useDashboardPanelData composable */
  dashboardPanelData: any;
  /** Whether in edit mode (editing existing panel vs creating new) */
  editMode: Ref<boolean>;
  /** External chart data (for logs mode) */
  externalChartData?: Ref<PanelEditorChartData | undefined>;
  /** Variables data (for dashboard mode) */
  variablesData?: PanelEditorVariablesData;
  /** Committed variables data (for dashboard mode - what the chart is currently using) */
  updatedVariablesData?: PanelEditorVariablesData;
  /** Function to update committed variables (dashboard mode) */
  updateCommittedVariables?: () => void;
  /** DateTime picker ref (for dashboard mode) */
  dateTimePickerRef?: Ref<any>;
  /** Selected date value */
  selectedDate?: Ref<any>;
}

/**
 * Combined composable for PanelEditor component.
 * Handles all shared state and actions across dashboard, metrics, and logs pages.
 */
export function usePanelEditor(options: UsePanelEditorOptions) {
  const {
    pageType,
    config,
    dashboardPanelData,
    editMode,
    externalChartData,
    variablesData,
    updatedVariablesData,
    updateCommittedVariables,
    dateTimePickerRef,
    selectedDate,
  } = options;

  const store = useStore();

  // ============================================================================
  // State Refs
  // ============================================================================

  /** Current chart data - the data currently being rendered */
  const chartData: Ref<PanelEditorChartData | undefined> = ref(undefined);

  /** Error data from chart queries */
  const errorData: PanelEditorErrorData = reactive({
    errors: [],
  });

  /** Metadata from query execution (for QueryInspector) */
  const metaData: Ref<any> = ref(null);

  /** Series data from chart rendering */
  const seriesData: Ref<any[]> = ref([]);

  /** Timestamp of last query execution */
  const lastTriggeredAt: Ref<Date | null> = ref(null);

  /** Whether to show legends dialog */
  const showLegendsDialog: Ref<boolean> = ref(false);

  /** Whether to show add to dashboard dialog */
  const showAddToDashboardDialog: Ref<boolean> = ref(false);

  /** Whether to refresh without using cache */
  const shouldRefreshWithoutCache: Ref<boolean> = ref(false);

  // ---- Warning Messages ----

  /** Max query range warning message */
  const maxQueryRangeWarning: Ref<string> = ref("");

  /** Series limit warning message */
  const limitNumberOfSeriesWarningMessage: Ref<string> = ref("");

  /** General error message */
  const errorMessage: Ref<string> = ref("");

  // ---- Panel State Flags ----

  /** Whether the data shown is incomplete (loading was interrupted) */
  const isPartialData: Ref<boolean> = ref(false);

  /** Whether the panel is currently loading */
  const isPanelLoading: Ref<boolean> = ref(false);

  /** Whether cached data differs from current time range */
  const isCachedDataDifferWithCurrentTimeRange: Ref<boolean> = ref(false);

  // ---- Loading State ----

  /** Whether queries are disabled (loading) */
  const disable: Ref<boolean> = ref(false);

  /**
   * Reactive object for loading state of variables and panels.
   * First try to inject from parent (e.g., Index.vue for logs page).
   * If no parent provides it, create a new one (e.g., for dashboard AddPanel).
   * This ensures PanelSchemaRenderer updates the correct state that SearchBar reads from.
   */
  const injectedLoadingState = inject<any>("variablesAndPanelsDataLoadingState", null);

  const variablesAndPanelsDataLoadingState = injectedLoadingState || reactive({
    variablesData: {} as Record<string, boolean>,
    panels: {} as Record<string, boolean>,
    searchRequestTraceIds: {} as Record<string, string[]>,
  });

  // Provide loading state for child components (either injected or newly created)
  // This ensures PanelSchemaRenderer can inject it
  provide(
    "variablesAndPanelsDataLoadingState",
    variablesAndPanelsDataLoadingState,
  );

  /** Computed array of search request trace IDs (for cancel functionality) */
  const searchRequestTraceIds: ComputedRef<string[]> = computed(() => {
    const searchIds = Object.values(
      variablesAndPanelsDataLoadingState.searchRequestTraceIds,
    ).filter((item: any) => item.length > 0);
    return searchIds.flat() as string[];
  });

  // ---- Cancel Query Support ----
  const { traceIdRef, cancelQuery } = useCancelQuery();

  // ---- Hovered Series State (for chart interactions) ----
  const hoveredSeriesState = ref({
    hoveredSeriesName: "",
    panelId: -1,
    dataIndex: -1,
    seriesIndex: -1,
    hoveredTime: null as any,
    setHoveredSeriesName: function (name: string) {
      hoveredSeriesState.value.hoveredSeriesName = name ?? "";
    },
    setIndex: function (
      dataIndex: number,
      seriesIndex: number,
      panelId: any,
      hoveredTime?: any,
    ) {
      hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
      hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
      hoveredSeriesState.value.panelId = panelId ?? -1;
      hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
    },
  });

  // Provide hovered series state for child components
  provide("hoveredSeriesState", hoveredSeriesState);

  // ---- Panel Schema Renderer Ref ----
  const panelSchemaRendererRef: Ref<any> = ref(null);

  // ---- Splitter State ----
  const splitterModel: Ref<number> = ref(50);
  const expandedSplitterHeight: Ref<number | null> = ref(null);

  // ============================================================================
  // Computed Properties
  // ============================================================================

  /**
   * Check if this is initial dashboard panel data (no fields configured)
   */
  const isInitialDashboardPanelData = (): boolean => {
    return (
      dashboardPanelData.data.description === "" &&
      !dashboardPanelData.data.config.unit &&
      !dashboardPanelData.data.config.unit_custom &&
      dashboardPanelData.data.queries[0].fields.x.length === 0 &&
      dashboardPanelData.data.queries[0].fields?.breakdown?.length === 0 &&
      dashboardPanelData.data.queries[0].fields.y.length === 0 &&
      dashboardPanelData.data.queries[0].fields.z.length === 0 &&
      dashboardPanelData.data.queries[0].fields.filter.conditions.length ===
        0 &&
      dashboardPanelData.data.queries.length === 1
    );
  };

  /**
   * Whether the chart is out of date (panel data differs from chart data)
   */
  const isOutDated: ComputedRef<boolean> = computed(() => {
    // Check if this is initial add panel call
    if (isInitialDashboardPanelData() && !editMode.value) return false;

    // For logs mode, we don't show outdated warning based on panel data comparison
    // since data comes from external props
    if (pageType === "logs" && externalChartData?.value) {
      return false;
    }

    // Helper function to normalize variables for comparison
    const normalizeVariables = (obj: any) => {
      const normalized = JSON.parse(JSON.stringify(obj));
      // Sort arrays to ensure consistent ordering
      if (normalized.values && Array.isArray(normalized.values)) {
        normalized.values = normalized.values
          .map((variable: any) => {
            if (Array.isArray(variable.value)) {
              variable.value.sort((a: any, b: any) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              );
            }
            return variable;
          })
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
      }
      return normalized;
    };

    // For dashboard mode, also compare variables
    let variablesChanged = false;
    if (config.showVariablesSelector && variablesData && updatedVariablesData) {
      const normalizedCurrent = normalizeVariables(variablesData);
      const normalizedRefreshed = normalizeVariables(updatedVariablesData);
      variablesChanged = !isEqual(normalizedCurrent, normalizedRefreshed);
    }

    // Compare chart data with panel data
    const configChanged = !isEqual(
      JSON.parse(JSON.stringify(chartData.value ?? {})),
      JSON.parse(JSON.stringify(dashboardPanelData.data ?? {})),
    );

    let configNeedsApiCall = false;
    if (configChanged) {
      configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
        chartData.value,
        dashboardPanelData.data,
      );
    }

    return configNeedsApiCall || variablesChanged;
  });

  /**
   * Current panel data (combines renderer data with config)
   * Used by ShowLegendsPopup
   */
  const currentPanelData = computed(() => {
    const rendererData = panelSchemaRendererRef.value?.panelData || {};
    return {
      ...rendererData,
      config: dashboardPanelData.data.config || {},
    };
  });

  /**
   * Whether the component is in loading state
   */
  const isLoading: ComputedRef<boolean> = computed(() => {
    return searchRequestTraceIds.value.length > 0 || disable.value;
  });

  // ============================================================================
  // Action Functions
  // ============================================================================

  /**
   * Run the chart query
   * @param withoutCache - If true, bypass cache (enterprise feature)
   */
  const runQuery = (withoutCache = false): void => {
    try {
      // Set cache flag
      shouldRefreshWithoutCache.value = withoutCache;

      // For dashboard mode, commit the current variable values
      if (config.showVariablesSelector && updateCommittedVariables) {
        updateCommittedVariables();
      }

      // Copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));

      // Refresh the date time picker if available
      if (dateTimePickerRef?.value) {
        dateTimePickerRef.value.refresh();
      }

      // Update datetime
      if (selectedDate?.value) {
        updateDateTime(selectedDate.value);
      }
    } catch (err) {
      // Error during query execution - silently handle
      console.error("Error during runQuery:", err);
    }
  };

  /**
   * Handle chart API errors
   * @param errorMsg - Error message from chart API
   */
  const handleChartApiError = (errorMsg: any): void => {
    if (typeof errorMsg === "string") {
      errorMessage.value = errorMsg;
      const errorList = errorData.errors ?? [];
      errorList.splice(0);
      errorList.push(errorMsg);
    } else if (errorMsg?.message) {
      errorMessage.value = errorMsg.message ?? "";
      const errorList = errorData.errors ?? [];
      errorList.splice(0);
      errorList.push(errorMsg.message);
    } else {
      errorMessage.value = "";
    }
  };

  /**
   * Handle last triggered at timestamp update
   * @param data - Timestamp data
   */
  const handleLastTriggeredAtUpdate = (data: any): void => {
    lastTriggeredAt.value = data;
  };

  /**
   * Handle series limit warning message
   * @param message - Warning message
   */
  const handleLimitNumberOfSeriesWarningMessage = (message: string): void => {
    limitNumberOfSeriesWarningMessage.value = message;
  };

  /**
   * Handle partial data update from PanelSchemaRenderer
   * @param value - Whether data is partial (loading was interrupted)
   */
  const handleIsPartialDataUpdate = (value: boolean): void => {
    isPartialData.value = value;
  };

  /**
   * Handle loading state change from PanelSchemaRenderer
   * @param value - Whether panel is loading
   */
  const handleLoadingStateChange = (value: boolean): void => {
    isPanelLoading.value = value;
  };

  /**
   * Handle cached data differs from current time range update
   * @param value - Whether cached data differs from current time range
   */
  const handleIsCachedDataDifferWithCurrentTimeRangeUpdate = (value: boolean): void => {
    isCachedDataDifferWithCurrentTimeRange.value = value;
  };

  /**
   * Handle result metadata update (for QueryInspector)
   * @param metadata - Query metadata
   */
  const handleResultMetadataUpdate = (metadata: any): void => {
    maxQueryRangeWarning.value = processQueryMetadataErrors(
      metadata,
      store.state.timezone,
    );
  };

  /**
   * Update metadata value
   * @param metadata - Metadata from query
   */
  const metaDataValue = (metadata: any): void => {
    metaData.value = metadata;
  };

  /**
   * Update series data
   * @param data - Series data from chart
   */
  const seriesDataUpdate = (data: any): void => {
    seriesData.value = data;
  };

  /**
   * Collapse or expand the field list sidebar
   */
  const collapseFieldList = (): void => {
    if (dashboardPanelData.layout.showFieldList) {
      dashboardPanelData.layout.splitter = 0;
      dashboardPanelData.layout.showFieldList = false;
    } else {
      dashboardPanelData.layout.splitter = 20;
      dashboardPanelData.layout.showFieldList = true;
    }
  };

  /**
   * Handle layout splitter update (triggers resize)
   */
  const layoutSplitterUpdated = (): void => {
    window.dispatchEvent(new Event("resize"));
  };

  /**
   * Handle query splitter update
   * @param newHeight - New height value
   */
  const querySplitterUpdated = (newHeight: any): void => {
    window.dispatchEvent(new Event("resize"));
    if (dashboardPanelData.layout.showQueryBar) {
      expandedSplitterHeight.value = newHeight;
    }
  };

  /**
   * Update VRL function field list
   * @param fieldList - List of fields
   */
  const updateVrlFunctionFieldList = (fieldList: any): void => {
    // Extract all panelSchema alias
    const aliasList: any[] = [];

    // If auto sql
    if (
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].customQuery === false
    ) {
      // Add x axis alias
      dashboardPanelData?.data?.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.fields?.x?.forEach((it: any) => {
        if (!it.isDerived) {
          aliasList.push(it.alias);
        }
      });

      // Add breakdown alias
      dashboardPanelData?.data?.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.fields?.breakdown?.forEach((it: any) => {
        if (!it.isDerived) {
          aliasList.push(it.alias);
        }
      });

      // Add y axis alias
      dashboardPanelData?.data?.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.fields?.y?.forEach((it: any) => {
        if (!it.isDerived) {
          aliasList.push(it.alias);
        }
      });

      // Add z axis alias
      dashboardPanelData?.data?.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.fields?.z?.forEach((it: any) => {
        if (!it.isDerived) {
          aliasList.push(it.alias);
        }
      });

      // Add special field aliases (latitude, longitude, weight, source, target, value, name, value_for_maps)
      const specialFields = [
        "latitude",
        "longitude",
        "weight",
        "source",
        "target",
        "value",
        "name",
        "value_for_maps",
      ];
      specialFields.forEach((fieldName) => {
        const field =
          dashboardPanelData?.data?.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.[fieldName];
        if (field?.alias && !field?.isDerived) {
          aliasList.push(field.alias);
        }
      });
    }

    // Remove custom query fields from field list
    dashboardPanelData.meta.stream.customQueryFields.forEach((it: any) => {
      aliasList.push(it.name);
    });

    // Rest will be vrl function fields
    const filteredFieldList = fieldList
      .filter(
        (field: any) =>
          !aliasList.some(
            (alias: string) => alias.toLowerCase() === field.toLowerCase(),
          ),
      )
      .map((field: any) => ({ name: field, type: "Utf8" }));

    dashboardPanelData.meta.stream.vrlFunctionFieldList = filteredFieldList;
  };

  /**
   * Handle data zoom event (chart zoom)
   * @param event - Zoom event with start and end
   * @returns Object with start and end dates for parent to handle
   */
  const onDataZoom = (event: any): { start: Date; end: Date } => {
    const selectedDateObj = {
      start: new Date(event.start),
      end: new Date(event.end),
    };

    // Truncate seconds and milliseconds from the dates
    selectedDateObj.start.setSeconds(0, 0);
    selectedDateObj.end.setSeconds(0, 0);

    // Compare the truncated dates
    if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
      // Increment the end date by 1 minute
      selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
    }

    // For dashboard mode, update datetime picker if available
    if (dateTimePickerRef?.value) {
      dateTimePickerRef.value.setCustomDate("absolute", selectedDateObj);
    }

    return selectedDateObj;
  };

  /**
   * Cancel running queries
   */
  const cancelRunningQuery = (): void => {
    traceIdRef.value = searchRequestTraceIds.value;
    cancelQuery();
  };

  /**
   * Reset error state
   */
  const resetErrors = (): void => {
    errorData.errors.splice(0);
    errorMessage.value = "";
    maxQueryRangeWarning.value = "";
    limitNumberOfSeriesWarningMessage.value = "";
  };

  /**
   * Update the datetime for queries
   * @param dateTime - The new datetime object
   */
  const updateDateTime = (dateTime: PanelEditorDateTime): void => {
    if (dateTime) {
      dashboardPanelData.meta.dateTime = {
        start_time: new Date(dateTime.start_time),
        end_time: new Date(dateTime.end_time),
      };
    }
  };

  // ============================================================================
  // Watchers
  // ============================================================================

  // Watch for chart type changes - update chartData
  watch(
    () => dashboardPanelData.data.type,
    async () => {
      await nextTick();
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
    },
  );

  // Watch for config changes - auto-apply if no API call needed
  watch(
    () => dashboardPanelData.data.config,
    () => {
      // Check if the config change requires an API call
      const needsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
        chartData.value,
        dashboardPanelData.data,
      );

      // If no API call needed, auto-apply the config change
      if (!needsApiCall) {
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      }
    },
    { deep: true },
  );

  // Watch for config panel open/close - trigger resize
  watch(
    () => dashboardPanelData.layout.isConfigPanelOpen,
    () => {
      window.dispatchEvent(new Event("resize"));
    },
  );

  // Watch isOutDated - trigger resize
  watch(isOutDated, () => {
    window.dispatchEvent(new Event("resize"));
  });

  // Watch splitter changes - sync showFieldList
  watch(
    () => dashboardPanelData.layout.splitter,
    (newVal) => {
      if (newVal > 0 && !dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.showFieldList = true;
      } else if (newVal === 0 && dashboardPanelData.layout.showFieldList) {
        dashboardPanelData.layout.showFieldList = false;
      }
    },
  );

  // Watch query bar visibility - update splitter
  watch(
    () => dashboardPanelData.layout.showQueryBar,
    (newValue) => {
      if (!newValue) {
        dashboardPanelData.layout.querySplitter = 41;
      } else {
        if (expandedSplitterHeight.value !== null) {
          dashboardPanelData.layout.querySplitter =
            expandedSplitterHeight.value;
        }
      }
    },
  );

  // Watch loading state - update disable
  watch(variablesAndPanelsDataLoadingState, () => {
    const panelsValues = Object.values(
      variablesAndPanelsDataLoadingState.panels,
    );
    disable.value = panelsValues.some((item: any) => item === true);
  });

  // Check if externalChartData has actual VALUE (not just if the ref exists)
  // A ref is always truthy even if its value is undefined, so we must check .value
  const hasExternalChartData = externalChartData && externalChartData.value !== undefined;

  // Watch external chart data (for logs mode) - sync to internal state
  // Only set up this watcher if externalChartData actually has data
  if (hasExternalChartData) {
    watch(
      externalChartData,
      (newData) => {
        if (newData) {
          chartData.value = JSON.parse(JSON.stringify(newData));
        }
      },
      { immediate: true },
    );
  }

  // ---- Chart Data Initialization ----

  /**
   * Initialize chartData from dashboardPanelData.
   * Called by parent component (e.g., AddPanel) after loading panel data in onMounted.
   * This replaces the watcher approach and follows main branch pattern.
   *
   * @param data - Optional data to initialize with. If not provided, uses dashboardPanelData.data
   */
  const initChartData = (data?: any) => {
    const sourceData = data ?? dashboardPanelData.data;
    if (sourceData) {
      chartData.value = JSON.parse(JSON.stringify(sourceData));
    } else {
      chartData.value = {};
    }
  };

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // State refs
    chartData,
    errorData,
    metaData,
    seriesData,
    lastTriggeredAt,
    showLegendsDialog,
    showAddToDashboardDialog,
    shouldRefreshWithoutCache,
    maxQueryRangeWarning,
    limitNumberOfSeriesWarningMessage,
    errorMessage,
    isPartialData,
    isPanelLoading,
    isCachedDataDifferWithCurrentTimeRange,
    disable,
    searchRequestTraceIds,
    hoveredSeriesState,
    panelSchemaRendererRef,
    splitterModel,
    expandedSplitterHeight,
    variablesAndPanelsDataLoadingState,

    // Computed
    isOutDated,
    isLoading,
    currentPanelData,
    isInitialDashboardPanelData,

    // Actions
    initChartData,
    runQuery,
    handleChartApiError,
    handleLastTriggeredAtUpdate,
    handleLimitNumberOfSeriesWarningMessage,
    handleIsPartialDataUpdate,
    handleLoadingStateChange,
    handleIsCachedDataDifferWithCurrentTimeRangeUpdate,
    handleResultMetadataUpdate,
    metaDataValue,
    seriesDataUpdate,
    collapseFieldList,
    layoutSplitterUpdated,
    querySplitterUpdated,
    updateVrlFunctionFieldList,
    onDataZoom,
    cancelRunningQuery,
    resetErrors,
    updateDateTime,
  };
}
