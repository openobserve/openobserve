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
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { usePanelCache } from "./usePanelCache";
import { isEqual, omit } from "lodash-es";
import { convertOffsetToSeconds } from "@/utils/dashboard/convertDataIntoUnitValue";
import { useAnnotations } from "./useAnnotations";
import useHttpStreamingSearch from "../useStreamingSearch";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import logsUtils from "@/composables/useLogs/logsUtils";
import { createPromQLChunkProcessor } from "./promqlChunkProcessor";

/**
 * debounce time in milliseconds for panel data loader
 */
const PANEL_DATA_LOADER_DEBOUNCE_TIME = 50;

import {
  replaceQueryValue,
  applyDynamicVariables,
  adjustTimestampByTimeRangeGap,
  processApiError,
} from "@/utils/dashboard/dataLoader/queryUtils";
import { loadPromQL } from "./dataLoader/loadPromQL";
import { loadSQL } from "./dataLoader/loadSQL";
import { getStreamFromQuery } from "@/utils/query/sqlUtils";

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
) => {
  const log = (...args: any[]) => {
    if (false) {
      console.log(panelSchema?.value?.title + ": ", ...args);
    }
  };
  let runCount = 0;

  const store = useStore();

  const {
    fetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId,
    closeStreamWithError,
    closeStream,
    resetAuthToken,
  } = useHttpStreamingSearch();

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
      seriesLimiting: undefined as {
        totalMetricsReceived: number;
        metricsStored: number;
        maxSeries: number;
      } | undefined,
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

  // Initialize logs utils to reuse common SQL validations
  const { checkTimestampAlias } = logsUtils();

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

  // currently dependent variables data
  let currentDependentVariablesData = variablesData?.value?.values
    ? JSON.parse(
      JSON.stringify(
        variablesData.value?.values
          ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
          ?.filter((it: any) => {
            const regexForVariable = new RegExp(
              `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?.*`,
            );

            return panelSchema.value.queries
              ?.map((q: any) => regexForVariable.test(q?.query))
              ?.includes(true);
          }),
      ),
    )
    : [];

  let currentDynamicVariablesData = variablesData?.value?.values
    ? JSON.parse(
      JSON.stringify(
        variablesData.value?.values
          ?.filter((it: any) => it.type === "dynamic_filters")
          ?.map((it: any) => it?.value)
          ?.flat()
          ?.filter((it: any) => it?.operator && it?.name && it?.value),
      ),
    )
    : [];
  // let currentAdHocVariablesData: any = null;

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

  /**
   * Call a function with an AbortController, and propagate the abort
   * signal to the function. This allows the function to be cancelled
   * when the AbortController is aborted.
   *
   * @param fn The function to call
   * @param signal The AbortSignal to use
   * @returns A promise that resolves with the result of the function, or
   * rejects with an error if the function is cancelled or throws an error
   */
  const callWithAbortController = async <T>(
    fn: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const result = fn();

      // Listen to the abort signal and reject the promise if it is
      // received
      signal.addEventListener("abort", () => {
        reject();
      });

      // Handle the result of the function
      result
        .then((res) => {
          resolve(res);
        })
        .catch((error) => {
          reject(error);
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

      if (!panelSchema.value.queries?.length || !hasAtLeastOneQuery()) {
        log("loadData: no query found, returning...");
        state.loading = false;
        return;
      }

      // Increase run count
      runCount++;

      // STEP 1: Wait for timeout (debounce)
      await waitForTimeout(abortController.signal);

      // STEP 2: Wait for panel to become visible
      await waitForThePanelToBecomeVisible(abortController.signal);

      // STEP 3: Wait for variables to load
      await waitForTheVariablesToLoad(abortController.signal);

      // STEP 4: Check if we can restore from cache
      if (!forceLoad.value) {
        const isRestoredFromCache = await restoreFromCache();
        if (isRestoredFromCache) {
          log("loadData: restored from cache, returning...");
          return;
        }
      }

      // [NEW] If forceLoad is true, reset isPartialData
      if (forceLoad.value) {
        state.isPartialData = false;
      }

      // now start loading the data from the API
      state.loading = true;
      state.isOperationCancelled = false;

      // Extract timestamps for the query
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

      const commonOptions = {
        panelSchema,
        store,
        dashboardId,
        dashboardName,
        folderId,
        folderName,
        runId,
        tabId,
        tabName,
        startISOTimestamp,
        endISOTimestamp,
        variablesData,
        chartPanelRef,
        currentDependentVariablesData,
        state,
        abortControllerRef: abortController,
        fetchQueryDataWithHttpStream,
        saveCurrentStateToCache,
        addTraceId,
        removeTraceId,
        refreshAnnotations,
        shouldFetchAnnotations,
      };

      if (panelSchema.value.queryType === "promql") {
        await loadPromQL(commonOptions);
        return;
      }

      await loadSQL({
        ...commonOptions,
        checkTimestampAlias,
        convertOffsetToSeconds,
        is_ui_histogram,
        searchType,
        shouldRefreshWithoutCache,
        searchResponse,
      });
    } catch (error: any) {
      if (error?.message === "Aborted waiting for loading") {
        log("loadData: aborted waiting for loading");
      } else {
        console.error("loadData: error detail", error);
        state.loading = false;
        state.errorDetail = processApiError(error, panelSchema.value.queryType);
      }
    }
  };

  watch(
    // Watching for changes in panelSchema, selectedTimeObj and forceLoad
    () => [selectedTimeObj?.value, forceLoad?.value],
    async () => {
      log("PanelSchema/Time Wather: called");
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

  const hasAtLeastOneQuery = () =>
    panelSchema.value.queries?.some((q: any) => q?.query);

  // [START] variables management

  // check when the variables data changes
  // 1. get the dependent variables
  // 2. compare the dependent variables data with the old dependent variables Data
  // 3. if the value of any current variable is changed, call the api
  watch(
    () => variablesData?.value?.values,
    () => {
      // console.log("inside watch variablesData");
      // ensure the query is there
      // if (!panelSchema.value.queries?.length) {
      //   return;
      // }
      log("Variables Watcher: starting...");

      const newDependentVariablesData = getDependentVariablesData();
      const newDynamicVariablesData = getDynamicVariablesData();

      if (
        !newDependentVariablesData?.length &&
        !newDynamicVariablesData?.length &&
        !currentDependentVariablesData?.length &&
        !currentDynamicVariablesData?.length
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

  // [START] Variables functions
  const areDynamicVariablesStillLoading = () =>
    variablesData.value?.values?.some(
      (it: any) =>
        it.type === "dynamic_filters" &&
        (it.isLoading || it.isVariableLoadingPending),
    );

  const areDependentVariablesStillLoadingWith = (
    newDependentVariablesData: any,
  ) => {
    const result = newDependentVariablesData?.some((it: any) => {
      const hasNullValue = it.value == null;
      const hasEmptyArray = Array.isArray(it.value) && it.value.length === 0;

      // CRITICAL FIX: Only block if variable has NEVER been loaded (isVariablePartialLoaded=false)
      // If isVariablePartialLoaded=true but value=null, that's VALID (query returned no results)
      // Don't check isLoading or isVariableLoadingPending - those flags can be stale in committed state
      const hasNeverBeenLoaded = !it.isVariablePartialLoaded;

      // Block only if: (null/empty value) AND (never been loaded)
      const shouldBlock = (hasNullValue || hasEmptyArray) && hasNeverBeenLoaded;

      log(`[areDependentVariablesStillLoading] Variable ${it.name}:`, {
        value: it.value,
        hasNullValue,
        hasEmptyArray,
        isVariablePartialLoaded: it.isVariablePartialLoaded,
        hasNeverBeenLoaded,
        shouldBlock,
      });

      return shouldBlock;
    });

    log(`[areDependentVariablesStillLoading] Final result: ${result}`);
    return result;
  };

  const getDependentVariablesData = () =>
    variablesData.value?.values
      ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
      ?.filter((it: any) => {
        const regexForVariable = new RegExp(
          `.*\\$\\{?${it.name}(?::(csv|pipe|doublequote|singlequote))?}?.*`,
        );

        return panelSchema.value.queries
          ?.map((q: any) => regexForVariable.test(q?.query))
          ?.includes(true);
      });

  const getDynamicVariablesData = () => {
    const sqlQueryStreams =
      panelSchema.value.queryType == "sql"
        ? panelSchema.value.queries.map((q: any) => getStreamFromQuery(q.query))
        : [];
    const adHocVariables = variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      ?.flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);
    // ?.filter((it: any) =>
    //   panelSchema.value.queryType == "sql"
    //     ? it.streams.find((it: any) => sqlQueryStreams.includes(it?.name))
    //     : true
    // );
    log("getDynamicVariablesData: adHocVariables", adHocVariables);
    return adHocVariables;
  };

  const updateCurrentDependentVariablesData = (
    newDependentVariablesData: any,
  ) => {
    currentDependentVariablesData = JSON.parse(
      JSON.stringify(newDependentVariablesData),
    );
  };

  const updateCurrentDynamicVariablesData = (newDynamicVariablesData: any) => {
    currentDynamicVariablesData = JSON.parse(
      JSON.stringify(newDynamicVariablesData),
    );
  };

  const areArraysEqual = (array1: any, array2: any) => {
    // Check if both arrays have the same length
    if (array1?.length !== array2?.length) {
      return false;
    }

    // Sort both arrays
    const sortedArray1 = array1?.slice()?.sort();
    const sortedArray2 = array2?.slice()?.sort();

    // Compare sorted arrays element by element
    for (let i = 0; i < sortedArray1?.length; i++) {
      if (sortedArray1[i] !== sortedArray2[i]) {
        return false;
      }
    }

    // If all elements are equal, return true
    return true;
  };

  const isAllRegularVariablesValuesSameWith = (
    newDependentVariablesData: any,
  ) =>
    newDependentVariablesData.every((it: any) => {
      const oldValue = currentDependentVariablesData.find(
        (it2: any) => it2.name == it.name,
      );
      // return it.value == oldValue?.value && oldValue?.value != "";
      return it.multiSelect
        ? areArraysEqual(it.value, oldValue?.value)
        : it.value == oldValue?.value && oldValue?.value != "";
    });

  const isAllDynamicVariablesValuesSameWith = (newDynamicVariablesData: any) =>
    newDynamicVariablesData.every((it: any) => {
      const oldValue = currentDynamicVariablesData?.find(
        (it2: any) => it2.name == it.name,
      );
      return (
        oldValue?.value != "" &&
        it.value == oldValue?.value &&
        it.operator == oldValue?.operator
      );
    });

  const ifPanelVariablesCompletedLoading = () => {
    // STEP 1: Check if there are any dynamic variables that are still loading
    log("Step1: checking if dynamic variables are loading, starting...");
    const newDynamicVariablesData = getDynamicVariablesData();

    if (areDynamicVariablesStillLoading()) {
      log("Step1: dynamic variables still loading..., returning false");
      return false;
    }

    // STEP 2: Check if any regular dependent variables are still loading

    log("Step2: checking if dependent variables are loading, starting...");

    const newDependentVariablesData = getDependentVariablesData();

    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      log("Step2: regular variables still loading..., returning false");
      return false;
    }

    return true;
  };

  const variablesDataUpdated = () => {
    // STEP 1: Check if there are any dynamic variables that are still loading
    log("Step1: checking if dynamic variables are loading, starting...");
    const newDynamicVariablesData = getDynamicVariablesData();

    if (areDynamicVariablesStillLoading()) {
      log("Step1: dynamic variables still loading..., returning false");
      return false;
    }

    // STEP 2: Check if any regular dependent variables are still loading

    log("Step2: checking if dependent variables are loading, starting...");

    const newDependentVariablesData = getDependentVariablesData();

    if (areDependentVariablesStillLoadingWith(newDependentVariablesData)) {
      log("Step2: regular variables still loading..., returning false");
      return false;
    }

    // STEP 3: Check if any of the regular and dynamic variables count have changed
    // if count have changed, that means the variables are added or removed
    // so we need to fire the query
    log("Step3: checking if no of variables have changed, starting...");

    log(
      "Step3: newDependentVariablesData,",
      JSON.stringify(newDependentVariablesData, null, 2),
    );
    log(
      "Step3: newDynamicVariablesData...",
      JSON.stringify(newDynamicVariablesData, null, 2),
    );

    // if the length of the any of the regular and old dynamic data has changed,
    // we need to fire the query
    log(
      "Step3: newDependentVariablesData?.length",
      newDependentVariablesData?.length,
    );
    log(
      "Step3: newDynamicVariablesData?.length",
      newDynamicVariablesData?.length,
    );
    log(
      "Step3: currentDependentVariablesData?.length",
      currentDependentVariablesData?.length,
    );
    log(
      "Step3: currentAdHocVariablesData?.length",
      currentDynamicVariablesData?.length,
    );

    if (
      newDependentVariablesData?.length !=
      currentDependentVariablesData?.length ||
      newDynamicVariablesData?.length != currentDynamicVariablesData?.length
    ) {
      updateCurrentDependentVariablesData(newDependentVariablesData);
      updateCurrentDynamicVariablesData(newDynamicVariablesData);

      log(
        "Step3: length of the any of the regular and old dynamic data has changed, we need to fire the query",
      );
      return true;
    }

    log("Step3: finished...");
    // STEP 4: Now we know same number of variables are there and have updated,
    // we have to perform different action based on different combinations of variables types
    // 1. regular variables
    // 2. dynamic variables
    log("Step4: starting...");

    // now we have to check for different combinations for the count of regular and dynamic variables
    // 1. Regular variables  = 0 and Dynamic variables  = 0
    // 2. Regular variables >= 1 and Dynamic variables  = 0
    // 3. Regular variables  = 0 and Dynamic variables >= 1
    // 4. Regular variables >= 1 and Dynamic variables >= 1

    log(
      "Step4: newDependentVariablesData.length",
      newDependentVariablesData?.length,
    );
    log(
      "Step4: newDynamicVariablesData.length",
      newDynamicVariablesData?.length,
    );

    // execute different scenarios based on the count of variables
    if (
      !newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      // 1. Regular variables  = 0 and Dynamic variables  = 0
      // go ahead and bravly load the data
      !newDependentVariablesData?.length && !newDynamicVariablesData?.length;

      log(
        "Step4: 1: no variables are there, no waiting, can call the api, returning true...",
      );

      return true;
    } else if (
      newDependentVariablesData?.length &&
      !newDynamicVariablesData?.length
    ) {
      log("Step4: 2: Regular variables >= 1 and Dynamic variables  = 0");
      // 2. Regular variables >= 1 and Dynamic variables  = 0

      // log(
      //   "Step4: 2: checking against old values, currentDependentVariablesData",
      //   JSON.stringify(currentDependentVariablesData, null, 2)
      // );

      // check if the values have changed or not
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      if (isAllRegularVariablesValuesSame) {
        log("Step4: 2: regular variables has same old value, returning false");
        return false;
      }

      updateCurrentDependentVariablesData(newDependentVariablesData);

      log("Step4: 2: regular variables values has changed, returning true");
      return true;
    } else if (
      !newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      // 3. Regular variables  = 0 and Dynamic variables >= 1
      log("Step4: 3: Regular variables  = 0 and Dynamic variables >= 1");

      // check if dynamic variables are same or changed
      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      // check if values are changed or not
      if (isAllDynamicVariablesValuesSame) {
        log("Step4: 3: dynamic variables has same old value, returning false");
        return false;
      }

      updateCurrentDynamicVariablesData(newDynamicVariablesData);

      log("Step4: 3: dynamic variables values has changed, returning true");
      return true;
    } else if (
      newDependentVariablesData?.length &&
      newDynamicVariablesData?.length
    ) {
      // 4. Regular variables >= 1 and Dynamic variables >= 1
      log("Step4: 4: Regular variables >= 1 and Dynamic variables >= 1");

      // if any of the value has changed, we need to trigger the query
      // check if the values have changed or not
      const isAllRegularVariablesValuesSame =
        isAllRegularVariablesValuesSameWith(newDependentVariablesData);

      const isAllDynamicVariablesValuesSame =
        isAllDynamicVariablesValuesSameWith(newDynamicVariablesData);

      log(
        "Step4: 4: isAllRegularVariablesValuesSame",
        isAllRegularVariablesValuesSame,
      );
      log(
        "Step4: 4: isAllDynamicVariablesValuesSame",
        isAllDynamicVariablesValuesSame,
      );

      // if any has changed
      if (isAllRegularVariablesValuesSame && isAllDynamicVariablesValuesSame) {
        log(
          "Step4: 4: regular and dynamic variables has same old value, returning false",
        );
        return false;
      }

      // values have changed
      // let's update and fire the query
      updateCurrentDynamicVariablesData(newDynamicVariablesData);
      updateCurrentDependentVariablesData(newDependentVariablesData);

      log("Step4: 4: variables values has changed, returning true");
      return true;
    }
  };

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

    // check if it is stale or not
    if (
      tempPanelCacheValue &&
      Object.keys(tempPanelCacheValue).length > 0 &&
      isEqual(
        omit(getCacheKey(), keysToIgnore),
        omit(tempPanelCacheKey, keysToIgnore),
      )
    ) {
      // const cache = getPanelCache();
      state.data = tempPanelCacheValue.data;
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
