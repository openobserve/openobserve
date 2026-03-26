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

import {
  ref,
  watch,
  reactive,
  toRefs,
  onMounted,
  onUnmounted,
  toRaw,
  markRaw,
} from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";

import { usePanelCache } from "./usePanelCache";
import { isEqual, omit } from "lodash-es";

import { useAnnotations } from "./useAnnotations";
import useHttpStreamingSearch from "../useStreamingSearch";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import { usePanelPromQLExecutor } from "./usePanelPromQLExecutor";
import { usePanelSQLExecutor } from "./usePanelSQLExecutor";

import { panelIdToBeRefreshed } from "@/utils/dashboard/convertCustomChartData";
import { usePanelVariableSubstitution } from "./usePanelVariableSubstitution";
import { usePanelSearchHandlers } from "./usePanelSearchHandlers";

/**
 * debounce time in milliseconds for panel data loader
 */
const PANEL_DATA_LOADER_DEBOUNCE_TIME = 50;

export const usePanelDataLoader = (
  panelSchema: any,
  selectedTimeObj: any,
  variablesData: any,
  chartPanelRef: any,
  forceLoad: any,
  searchType: any,
  dashboardId: any,
  folderId: any,
  reportId: any,
  runId?: any,
  tabId?: any,
  tabName?: any,
  searchResponse?: any,
  is_ui_histogram?: any,
  dashboardName?: any,
  folderName?: any,
  shouldRefreshWithoutCache?: any,
  regionClusterParams?: any,
) => {
  const log = (...args: any[]) => {
    if (false) {
      console.log(panelSchema?.value?.title + ": ", ...args);
    }
  };
  let runCount = 0;

  const store = useStore();

  const getRegionClusterParams = () => {
    if (
      regionClusterParams?.value?.regions ||
      regionClusterParams?.value?.clusters
    ) {
      return {
        regions: regionClusterParams.value.regions,
        clusters: regionClusterParams.value.clusters,
      };
    }
    return {};
  };

  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreamingSearch();

  const { refreshAnnotations } = useAnnotations(
    store.state.selectedOrganization.identifier,
    dashboardId?.value,
    panelSchema.value.id,
  );

  const shouldFetchAnnotations = () => {
    return [
      "area",
      "area-stacked",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "stacked",
      "h-stacked",
    ].includes(panelSchema.value.type);
  };

  /**
   * Calculate cache key for panel
   * @returns cache key
   */
  const getCacheKey = () => ({
    panelSchema: toRaw(panelSchema.value),
    variablesData: JSON.parse(
      JSON.stringify([
        ...(getDependentVariablesData() || []),
        ...(getDynamicVariablesData() || []),
      ]),
    ),
    forceLoad: toRaw(forceLoad.value),
    // searchType: toRaw(searchType.value),
    dashboardId: toRaw(dashboardId?.value),
    folderId: toRaw(folderId?.value),
  });

  const { getPanelCache, savePanelCache } = usePanelCache(
    folderId?.value,
    dashboardId?.value,
    panelSchema.value.id,
  );

  const state = reactive({
    data: [] as any,
    loading: false,
    errorDetail: {
      message: "",
      code: "",
    },
    metadata: {
      queries: [] as any,
      seriesLimiting: undefined as
        | {
            totalMetricsReceived: number;
            metricsStored: number;
            maxSeries: number;
          }
        | undefined,
    } as {
      queries: any;
      seriesLimiting?: {
        totalMetricsReceived: number;
        metricsStored: number;
        maxSeries: number;
      };
    },
    annotations: [] as any,
    resultMetaData: [] as any, // 2D array: [queryIndex][partitionIndex]
    lastTriggeredAt: null as any,
    isCachedDataDifferWithCurrentTimeRange: false,
    searchRequestTraceIds: <string[]>[],
    isOperationCancelled: false,
    loadingTotal: 0,
    loadingCompleted: 0,
    loadingProgressPercentage: 0,
    isPartialData: false,
  });

  // observer for checking if panel is visible on the screen
  let observer: any = null;

  // is panel currently visible or not
  const isVisible: any = ref(false);

  const saveCurrentStateToCache = async () => {
    await savePanelCache(
      getCacheKey(),
      { ...toRaw(state) },
      {
        start_time: selectedTimeObj?.value?.start_time?.getTime(),
        end_time: selectedTimeObj?.value?.end_time?.getTime(),
      },
    );
  };

  // Wire up variable substitution composable
  // (owns the currentDependentVariablesData / currentDynamicVariablesData snapshots)
  const {
    getCurrentDependentVariablesData,
    getCurrentDynamicVariablesData,
    getDependentVariablesData,
    getDynamicVariablesData,
    ifPanelVariablesCompletedLoading,
    variablesDataUpdated,
    replaceQueryValue,
    applyDynamicVariables,
  } = usePanelVariableSubstitution({
    panelSchema,
    variablesData,
    chartPanelRef,
    store,
    log,
  });

  let abortController = new AbortController();

  // [START] --------- New Functions ------------------------------------------

  // This function acts as a debounce and helps to reduce to continue execution
  // with old values when too many frequent updates are made to schema
  const waitForTimeout = (signal: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      // wait for timeout
      // and abort if abort signal received
      const timeoutId = setTimeout(resolve, PANEL_DATA_LOADER_DEBOUNCE_TIME);

      // Listen to the abort signal
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new Error("Aborted waiting for loading"));
      });
    });
  };

  // an async function that waits for the panel to become visible
  const waitForThePanelToBecomeVisible = (signal: any) => {
    return new Promise<void>((resolve, reject) => {
      // Immediately resolve if forceLoad is true
      if (forceLoad.value == true) {
        resolve();
        return;
      }
      // Immediately resolve if isVisible is already true
      if (isVisible.value) {
        resolve();
        return;
      }

      // Watch for changes in isVisible
      const stopWatching = watch(isVisible, (newValue) => {
        if (newValue) {
          resolve();
          stopWatching(); // Stop watching once isVisible is true
        }
      });

      // Listen to the abort signal
      signal.addEventListener("abort", () => {
        stopWatching(); // Stop watching on abort
        reject(new Error("Aborted waiting for loading"));
      });
    });
  };

  // an async function that waits for the variables to load
  const waitForTheVariablesToLoad = (signal: any) => {
    return new Promise<void>((resolve, reject) => {
      log("waitForTheVariablesToLoad: entering...");

      // PROGRESSIVE LOADING: Check if PANEL-SPECIFIC variables are ready
      // This allows panels to load as soon as THEIR dependencies are ready
      // instead of waiting for ALL dashboard variables to finish loading
      if (ifPanelVariablesCompletedLoading()) {
        log("waitForTheVariablesToLoad: panel variables are already loaded");
        resolve();
        return;
      }

      // Watch for changes in variables data
      const stopWatching = watch(
        () => variablesData.value,
        () => {
          // Check if panel-specific variables are ready
          if (ifPanelVariablesCompletedLoading()) {
            log(
              "waitForTheVariablesToLoad: panel variables are loaded (inside watch)",
            );
            resolve();
            stopWatching(); // Stop watching once panel variables are ready
          }
        },
        { deep: true }, // Watch nested properties
      );

      // Listen to the abort signal
      signal.addEventListener("abort", () => {
        stopWatching(); // Stop watching on abort
        reject(new Error("Aborted waiting for loading"));
      });
    });
  };

  const cancelQueryAbort = () => {
    // Only set isPartialData to true if the panel was still loading
    if (state.loading) {
      state.isPartialData = true; // Set to true when cancelled
    }
    state.loading = false;
    state.isOperationCancelled = true;

    if (state.searchRequestTraceIds?.length > 0) {
      try {
        state.searchRequestTraceIds.forEach((traceId) => {
          cancelStreamQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
      } catch (error) {
        console.error("Error during Stream cleanup:", error);
      } finally {
        state.searchRequestTraceIds = [];
      }
    }
    if (abortController) {
      abortController?.abort();
    }
    saveCurrentStateToCache();
  };

  const loadData = async () => {
    log(
      "[usePanelDataLoader] " +
        panelSchema?.value?.title +
        ": loadData() PROCEEDING",
    );

    // Only reset isPartialData if we're starting a fresh load and not restoring from cache
    if (runCount > 0 && !state.isOperationCancelled) {
      state.isPartialData = false;
    }

    try {
      log("loadData: entering...");
      state.loadingTotal = 0;
      state.loadingCompleted = 0;
      state.loadingProgressPercentage = 0;
      // Check and abort the previous call if necessary
      if (abortController) {
        log("loadData: aborting previous function call (if any)");
        abortController.abort();
      }

      // Create a new AbortController for the new operation
      abortController = new AbortController();
      window.addEventListener("cancelQuery", cancelQueryAbort);
      // Checking if there are queries to execute
      if (!panelSchema.value.queries?.length || !hasAtLeastOneQuery()) {
        log("loadData: there are no queries to execute");
        state.loading = false;
        state.isOperationCancelled = false;
        state.data = [];
        state.metadata = {
          queries: [],
        };
        state.resultMetaData = [];
        return;
      }

      log("loadData: now waiting for the timeout to avoid frequent updates");

      await waitForTimeout(abortController.signal);

      log("loadData: now waiting for the panel to become visible");

      state.lastTriggeredAt = new Date().getTime();

      // if force load is true, skip restoring from cache
      if (runCount == 0 && forceLoad?.value != true) {
        log("loadData: panelcache: run count is 0");
        // restore from the cache and return
        const isRestoredFromCache = await restoreFromCache();
        log("loadData: panelcache: isRestoredFromCache", isRestoredFromCache);
        if (isRestoredFromCache) {
          state.loading = false;
          state.isOperationCancelled = false;
          log("loadData: panelcache: restored from cache");
          runCount++;
          return;
        }
      }

      // Wait for isVisible to become true
      await waitForThePanelToBecomeVisible(abortController.signal);

      log("loadData: now waiting for the variables to load");

      // Wait for variables to load
      await waitForTheVariablesToLoad(abortController.signal);

      log("loadData: good to go... starting query executions...");

      const timestamps = selectedTimeObj.value;

      let startISOTimestamp: any;
      let endISOTimestamp: any;
      if (
        timestamps?.start_time &&
        timestamps?.end_time &&
        timestamps.start_time != "Invalid Date" &&
        timestamps.end_time != "Invalid Date"
      ) {
        startISOTimestamp = new Date(
          timestamps.start_time.toISOString(),
        ).getTime();
        endISOTimestamp = new Date(timestamps.end_time.toISOString()).getTime();
      } else {
        return;
      }

      log(
        "loadData: panelcache: no cache restored, continue firing, runCount ",
        runCount,
      );

      runCount++;

      state.loading = true;
      state.isCachedDataDifferWithCurrentTimeRange = false;

      // remove past error detail
      state.errorDetail = {
        message: "",
        code: "",
      };

      // Check if the query type is "promql"
      if (panelSchema.value.queryType == "promql") {
        await executePromQL(
          startISOTimestamp,
          endISOTimestamp,
          abortController,
        );
      } else {
        await executeSQL(startISOTimestamp, endISOTimestamp, abortController);
      }
    } catch (error: any) {
      if (
        error.name === "AbortError" ||
        error.message === "Aborted waiting for loading"
      ) {
        log("logaData: Operation aborted");
      } else {
        log("logaData: An error occurred:", error);
      }
    }
  };

  watch(
    // Watching for changes in panelSchema, selectedTimeObj and forceLoad
    () => [selectedTimeObj?.value, forceLoad?.value],
    async (newVal, oldVal) => {
      log("PanelSchema/Time Wather: called");

      // CRITICAL FIX: Check if this specific panel should refresh
      // If panelIdToBeRefreshed is set and doesn't match this panel, skip loading
      // This prevents all panels from refreshing when only one panel's time changes
      if (
        panelIdToBeRefreshed.value &&
        panelIdToBeRefreshed.value !== panelSchema.value.id
      ) {
        log(
          "PanelSchema/Time Wather: skipping - different panel is being refreshed",
        );
        return;
      }

      loadData(); // Loading the data
    },
  );

  watch(
    () => [panelSchema?.value],
    async (newVal, oldVal) => {
      const [newSchema] = newVal;
      const [oldSchema] = oldVal;

      const configNeedsApiCall = checkIfConfigChangeRequiredApiCallOrNot(
        oldSchema,
        newSchema,
      );

      if (!configNeedsApiCall) {
        return;
      }

      loadData();
    },
    { deep: true },
  );
  /**
   * Processes an API error based on the given error and type.
   *
   * @param {any} error - The error object to be processed.
   * @param {any} type - The type of error being processed.
   */
  const processApiError = async (error: any, type: any) => {
    state.isPartialData = false;

    switch (type) {
      case "promql": {
        const errorDetailValue = error?.response?.data?.error || error?.message;
        const trimmedErrorMessage =
          errorDetailValue?.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;

        const errorCode =
          error?.response?.status ||
          error?.status ||
          error?.response?.data?.code ||
          "";

        state.errorDetail = {
          message: trimmedErrorMessage,
          code: errorCode,
        };
        break;
      }
      case "sql": {
        const errorDetailValue =
          error?.response?.data.error_detail ||
          error?.response?.data.message ||
          error?.error_detail ||
          error?.message ||
          error?.error;

        const trimmedErrorMessage =
          errorDetailValue?.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;

        const errorCode =
          error?.response?.status ||
          error?.status ||
          error?.response?.data?.code ||
          error?.code ||
          "";

        state.errorDetail = {
          message: trimmedErrorMessage,
          code: errorCode,
        };
        break;
      }
      default:
        break;
    }
  };

  const addTraceId = (traceId: string) => {
    if (state.searchRequestTraceIds.includes(traceId)) {
      return;
    }

    state.searchRequestTraceIds = [...state.searchRequestTraceIds, traceId];
  };

  const removeTraceId = (traceId: string) => {
    state.searchRequestTraceIds = state.searchRequestTraceIds.filter(
      (id: any) => id !== traceId,
    );
  };

  // Wire up search handlers composable (placed here so processApiError,
  // loadData, and removeTraceId are all already declared above).
  const {
    handleSearchResponse,
    handleSearchClose,
    handleSearchReset,
    handleSearchError,
  } = usePanelSearchHandlers({
    state,
    processApiError,
    saveCurrentStateToCache,
    loadData,
    removeTraceId,
  });

  // Wire up PromQL and SQL executors (placed here so handleSearch* handlers,
  // processApiError, addTraceId, removeTraceId are all already declared above).
  const { executePromQL } = usePanelPromQLExecutor({
    state,
    panelSchema,
    store,
    dashboardId,
    dashboardName,
    folderId,
    folderName,
    runId,
    tabId,
    tabName,
    replaceQueryValue,
    applyDynamicVariables,
    fetchQueryDataWithHttpStream,
    shouldFetchAnnotations,
    refreshAnnotations,
    saveCurrentStateToCache,
    addTraceId,
    removeTraceId,
  });

  const { executeSQL } = usePanelSQLExecutor({
    state,
    panelSchema,
    store,
    searchType,
    searchResponse,
    is_ui_histogram,
    shouldRefreshWithoutCache,
    dashboardId,
    dashboardName,
    folderId,
    folderName,
    runId,
    tabId,
    tabName,
    replaceQueryValue,
    applyDynamicVariables,
    fetchQueryDataWithHttpStream,
    handleSearchResponse,
    handleSearchClose,
    handleSearchError,
    handleSearchReset,
    processApiError,
    saveCurrentStateToCache,
    addTraceId,
    removeTraceId,
    shouldFetchAnnotations,
    refreshAnnotations,
    log,
    getRegionClusterParams,
  });

  const hasAtLeastOneQuery = () =>
    panelSchema.value.queries?.some((q: any) => q?.query);

  // [START] variables management
  // check when the variables data changes
  // 1. get the dependent variables
  // 2. compare the dependent variables data with the old dependent variables Data
  // 3. if the value of any current variable is changed, call the api
  // (getDependentVariablesData, getDynamicVariablesData, variablesDataUpdated come from usePanelVariableSubstitution)
  watch(
    () => variablesData?.value?.values,
    () => {
      log("Variables Watcher: starting...");

      const newDependentVariablesData = getDependentVariablesData();
      const newDynamicVariablesData = getDynamicVariablesData();

      if (
        !newDependentVariablesData?.length &&
        !newDynamicVariablesData?.length &&
        !getCurrentDependentVariablesData()?.length &&
        !getCurrentDynamicVariablesData()?.length
      ) {
        // go ahead and bravly load the data
        log("Variables Watcher: no variables needed, returning false...");
        return;
      }

      if (variablesDataUpdated()) {
        loadData();
      }
    },
    { deep: true },
  );

  const handleIntersection = async (entries: any) => {
    isVisible.value = entries[0].isIntersecting;
  };

  onMounted(async () => {
    observer = new IntersectionObserver(handleIntersection, {
      root: null,
      rootMargin: "0px",
      threshold: 0, // Adjust as needed
    });

    // Keep the working solution - setTimeout ensures the element is fully rendered
    // This is necessary because IntersectionObserver checks immediately after observe()
    // but the element might not be fully laid out yet (especially in popups/drawers)
    setTimeout(() => {
      if (chartPanelRef?.value) {
        observer.observe(chartPanelRef?.value);
      }
    }, 0);
  });

  // remove intersection observer
  onUnmounted(() => {
    // abort on unmount
    if (abortController) {
      // Only set isPartialData if we're still loading or haven't received complete response
      // AND we haven't already marked it as complete
      if (
        (state.loading || state.loadingProgressPercentage < 100) &&
        !state.isOperationCancelled
      ) {
        state.isPartialData = true;
      }
      abortController.abort();
    }
    // Save current state to cache only if still loading on unmount ΓÇö
    // MUST come after isPartialData is set above so the cache stores the correct flag.
    // (handles tab-switch / navigate-away mid-load scenario)
    // If loading is already done, the end/complete handlers already saved the cache.
    if (state.loading) {
      saveCurrentStateToCache();
    }
    if (observer) {
      observer.disconnect();
    }
    // cancel http2 queries using http streaming api
    if (
      state.searchRequestTraceIds?.length > 0 &&
      state.loading &&
      !state.isOperationCancelled
    ) {
      try {
        state.searchRequestTraceIds.forEach((traceId) => {
          cancelStreamQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
        queryService.delete_running_queries(
          store?.state?.selectedOrganization?.identifier,
          state.searchRequestTraceIds,
        );
      } catch (error) {
        console.error("Error during HTTP2 cleanup:", error);
      } finally {
        state.searchRequestTraceIds = [];
      }
    }

    // remove cancelquery event
    window.removeEventListener("cancelQuery", cancelQueryAbort);
  });

  onMounted(async () => {
    log("PanelSchema/Time Initial: should load the data");

    loadData(); // Loading the data
  });

  const restoreFromCache: () => Promise<boolean> = async () => {
    const cache = await getPanelCache();

    if (!cache) {
      log("usePanelDataLoader: panelcache: cache is not there");
      // cache is not there, we need to load the data
      return false;
    }
    // now we have a cache
    const { key: tempPanelCacheKey, value: tempPanelCacheValue } = cache;
    log("usePanelDataLoader: panelcache: tempPanelCache", tempPanelCacheValue);

    let isRestoredFromCache = false;

    const keysToIgnore = [
      "panelSchema.version",
      "panelSchema.layout",
      "panelSchema.htmlContent",
      "panelSchema.markdownContent",
      "panelSchema.customChartResult", // Ignore computed result field
    ];

    log("usePanelDataLoader: panelcache: tempPanelCacheKey", tempPanelCacheKey);
    log(
      "usePanelDataLoader: panelcache: omit(getCacheKey())",
      omit(getCacheKey(), keysToIgnore),
    );
    log(
      "usePanelDataLoader: panelcache: omit(tempPanelCacheKey))",
      omit(tempPanelCacheKey, keysToIgnore),
    );

    // Helper function to normalize variables data for cache comparison
    // Removes runtime-only fields that don't affect query results
    const normalizeVariablesForCache = (variables: any[]) => {
      if (!variables || !Array.isArray(variables)) return variables;
      return variables.map((v) => ({
        name: v.name,
        type: v.type,
        value: v.value,
        scope: v.scope,
        multiSelect: v.multiSelect,
        query_data: v.query_data,
        // Exclude: options, isLoading, isVariableLoadingPending, isVariablePartialLoaded
        // These are runtime state and don't affect the query result
      }));
    };

    const currentCacheKey = omit(getCacheKey(), keysToIgnore);
    const savedCacheKey = omit(tempPanelCacheKey, keysToIgnore);

    // Normalize variables in both keys before comparison
    const normalizedCurrentKey = {
      ...currentCacheKey,
      variablesData: normalizeVariablesForCache(currentCacheKey.variablesData),
    };
    const normalizedSavedKey = {
      ...savedCacheKey,
      variablesData: normalizeVariablesForCache(savedCacheKey.variablesData),
    };

    const cacheKeysMatch = isEqual(normalizedCurrentKey, normalizedSavedKey);

    // Check if it is stale or not
    if (
      tempPanelCacheValue &&
      Object.keys(tempPanelCacheValue).length > 0 &&
      cacheKeysMatch
    ) {
      // const cache = getPanelCache();
      state.data = markRaw(tempPanelCacheValue.data ?? []);
      state.loading = tempPanelCacheValue.loading;
      state.errorDetail = tempPanelCacheValue.errorDetail;
      state.metadata = tempPanelCacheValue.metadata;
      state.resultMetaData = tempPanelCacheValue.resultMetaData;
      state.annotations = tempPanelCacheValue.annotations;
      state.lastTriggeredAt = tempPanelCacheValue.lastTriggeredAt;
      // Restore isPartialData and isOperationCancelled from cache
      state.isPartialData = tempPanelCacheValue.isPartialData;
      state.isOperationCancelled = tempPanelCacheValue.isOperationCancelled;

      // set that the cache is restored
      isRestoredFromCache = true;

      // if selected time range is not matched with the cache time range
      if (
        selectedTimeObj?.value?.end_time -
          selectedTimeObj?.value?.start_time !==
        cache?.cacheTimeRange?.end_time - cache?.cacheTimeRange?.start_time
      ) {
        state.isCachedDataDifferWithCurrentTimeRange = true;
      }

      log("usePanelDataLoader: panelcache: panel data loaded from cache");
    }

    return isRestoredFromCache;
  };

  return {
    ...toRefs(state),
    loadData,
  };
};
