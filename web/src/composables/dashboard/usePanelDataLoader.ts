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
import queryService from "../../services/search";
import { useStore } from "vuex";
import { addLabelToPromQlQuery } from "@/utils/query/promQLUtils";
import { addLabelsToSQlQuery } from "@/utils/query/sqlUtils";
import { getStreamFromQuery } from "@/utils/query/sqlUtils";
import {
  formatInterval,
  formatRateInterval,
  getTimeInSecondsBasedOnUnit,
} from "@/utils/dashboard/variables/variablesUtils";
import {
  b64EncodeUnicode,
  generateTraceContext,
  escapeSingleQuotes,
} from "@/utils/zincutils";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
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

const adjustTimestampByTimeRangeGap = (
  timestamp: number,
  timeRangeGapSeconds: number,
) => {
  return timestamp - timeRangeGapSeconds * 1000;
};

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

  const getFallbackOrderByCol = () => {
    // from panelSchema, get first x axis field alias
    if (panelSchema?.value?.queries?.[0]?.fields?.x) {
      return panelSchema.value?.queries[0]?.fields?.x?.[0]?.alias ?? null;
    }
    return null;
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

  const getHistogramSearchRequest = async (
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    histogramInterval: number | null | undefined,
  ) => {
    return {
      sql: query,
      query_fn: it.vrlFunctionQuery
        ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
        : null,
      // if i == 0 ? then do gap of 7 days
      start_time: startISOTimestamp,
      end_time: endISOTimestamp,
      size: -1,
      histogram_interval: histogramInterval ?? undefined,
    };
  };

  const handleHistogramResponse = async (payload: any, searchRes: any) => {
    // remove past error detail
    state.errorDetail = {
      message: "",
      code: "",
    };

    // is streaming aggs
    const streaming_aggs = searchRes?.content?.streaming_aggs ?? false;

    // Initialize data array if not exists
    if (!state.data[payload?.meta?.currentQueryIndex]) {
      state.data[payload?.meta?.currentQueryIndex] = [];
    }

    // if streaming aggs, replace the state data
    if (streaming_aggs) {
      state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    }
    // if order by is desc, append new partition response at end
    else if (searchRes?.content?.results?.order_by?.toLowerCase() === "asc") {
      // else append new partition response at start
      state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
        ...(state.data[payload?.meta?.currentQueryIndex] ?? []),
      ];
    } else {
      state.data[payload?.meta?.currentQueryIndex] = [
        ...(state.data[payload?.meta?.currentQueryIndex] ?? []),
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    }

    // Push metadata for each partition
    state.resultMetaData[payload?.meta?.currentQueryIndex].push(
      searchRes?.content?.results ?? {},
    );

    // If we have data and loading is complete, set isPartialData to false
    if (
      state.data[payload?.meta?.currentQueryIndex]?.length > 0 &&
      !state.loading
    ) {
      state.isPartialData = false;
    }
  };

  const handleStreamingHistogramMetadata = (payload: any, searchRes: any) => {
    // Use currentQueryIndex from payload meta
    const currentQueryIndex = payload?.meta?.currentQueryIndex;

    // Initialize metadata array if not exists
    if (!state.resultMetaData[currentQueryIndex]) {
      state.resultMetaData[currentQueryIndex] = [];
    }

    // Push metadata for each partition
    state.resultMetaData[currentQueryIndex].push({
      ...(searchRes?.content ?? {}),
      ...(searchRes?.content?.results ?? {}),
    });
  };

  const handleStreamingHistogramHits = (payload: any, searchRes: any) => {
    // remove past error detail
    state.errorDetail = {
      message: "",
      code: "",
    };

    const lastPartitionIndex = Math.max(
      state?.resultMetaData?.[payload?.meta?.currentQueryIndex]?.length - 1,
      0,
    );
    // is streaming aggs
    const streaming_aggs =
      state?.resultMetaData?.[payload?.meta?.currentQueryIndex]?.[
        lastPartitionIndex
      ]?.streaming_aggs ?? false;

    // Initialize data array if not exists
    if (!state.data[payload?.meta?.currentQueryIndex]) {
      state.data[payload?.meta?.currentQueryIndex] = [];
    }

    // if streaming aggs, replace the state data
    if (streaming_aggs) {
      // handle empty hits case
      if (searchRes?.content?.results?.hits?.length > 0) {
        state.data[payload?.meta?.currentQueryIndex] = [
          ...(searchRes?.content?.results?.hits ?? {}),
        ];
      }
    }
    // if order by is desc, append new partition response at end
    else if (
      state?.resultMetaData?.[payload?.meta?.currentQueryIndex]?.[
        lastPartitionIndex
      ]?.order_by?.toLowerCase() === "asc"
    ) {
      // else append new partition response at start
      state.data[payload?.meta?.currentQueryIndex] = [
        ...(searchRes?.content?.results?.hits ?? {}),
        ...(state.data[payload?.meta?.currentQueryIndex] ?? []),
      ];
    } else {
      state.data[payload?.meta?.currentQueryIndex] = [
        ...(state.data[payload?.meta?.currentQueryIndex] ?? []),
        ...(searchRes?.content?.results?.hits ?? {}),
      ];
    }

    // update result metadata - update the first partition result
    if (
      state.resultMetaData[payload?.meta?.currentQueryIndex]?.[
        lastPartitionIndex
      ]
    ) {
      state.resultMetaData[payload?.meta?.currentQueryIndex][
        lastPartitionIndex
      ].hits = searchRes?.content?.results?.hits ?? {};
    }
  };

  // Limit, aggregation, vrl function, pagination, function error and query error
  const handleSearchResponse = (payload: any, response: any) => {
    try {
      if (response.type === "search_response_metadata") {
        handleStreamingHistogramMetadata(payload, response);
        saveCurrentStateToCache();
      }

      if (response.type === "search_response_hits") {
        handleStreamingHistogramHits(payload, response);
        saveCurrentStateToCache();
      }

      if (response.type === "search_response") {
        handleHistogramResponse(payload, response);
        saveCurrentStateToCache();
      }

      if (response.type === "error") {
        state.loading = false;
        state.loadingTotal = 0;
        state.loadingCompleted = 0;
        state.loadingProgressPercentage = 0;
        state.isOperationCancelled = false;
        state.isPartialData = false;
        processApiError(response?.content, "sql");
      }

      if (response.type === "end") {
        state.loading = false;
        state.loadingTotal = 0;
        state.loadingCompleted = 0;
        state.loadingProgressPercentage = 100; // Set to 100% when complete
        state.isOperationCancelled = false;
        state.isPartialData = false; // Explicitly set to false when complete
        saveCurrentStateToCache();
      }

      if (response.type === "event_progress") {
        state.loadingProgressPercentage = response?.content?.percent ?? 0;
        state.isPartialData = true;
        saveCurrentStateToCache();
      }
    } catch (error: any) {
      state.loading = false;
      state.isOperationCancelled = false;
      state.loadingTotal = 0;
      state.loadingCompleted = 0;
      state.loadingProgressPercentage = 0;
      state.isPartialData = false;
      state.errorDetail = {
        message: error?.message || "Unknown error in search response",
        code: error?.code ?? "",
      };
    }
  };

  const handleSearchClose = (payload: any, response: any) => {
    removeTraceId(payload?.traceId);

    if (response.type === "error") {
      processApiError(response?.content, "sql");
    }

    const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];

    if (errorCodes.includes(response.code)) {
      handleSearchError(payload, {
        content: {
          message:
            "WebSocket connection terminated unexpectedly. Please check your network and try again",
          trace_id: payload.traceId,
          code: response.code,
          error_detail: "",
        },
      });
    }

    // set loading to false
    state.loading = false;
    state.isOperationCancelled = false;
    state.isPartialData = false;
    // save current state to cache
    // this is async task, which will be executed in background(await is not required)
    saveCurrentStateToCache();
  };

  const handleSearchReset = (payload: any, traceId?: string) => {
    // Save current state to cache
    saveCurrentStateToCache();
    loadData();
  };

  const handleSearchError = (payload: any, response: any) => {
    removeTraceId(payload.traceId);

    // set loading to false
    state.loading = false;
    state.loadingTotal = 0;
    state.loadingCompleted = 0;
    state.loadingProgressPercentage = 0;
    state.isOperationCancelled = false;
    state.isPartialData = false;

    processApiError(response?.content, "sql");
  };

  const shouldSkipSearchDueToEmptyVariables = () => {
    // Retrieve all variables data
    const allVars = [
      ...(getDependentVariablesData() || []),
      ...(getDynamicVariablesData() || []),
    ];

    // Identify variables with empty values
    const variablesToSkip = allVars
      .filter(
        (v) =>
          v.value === null ||
          v.value === undefined ||
          (Array.isArray(v.value) && v.value.length === 0),
      )
      .map((v) => v.name);

    // Log variables for which the API will be skipped
    variablesToSkip.forEach((variableName) => {
      state.loading = false;
    });

    // Return true if there are any variables to skip, indicating loading should be continued
    return variablesToSkip.length > 0;
  };

  const getDataThroughStreaming = async (
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    pageType: string,
    currentQueryIndex: number,
    abortControllerRef: any,
  ) => {
    try {
      const { traceId } = generateTraceContext();

      const payload: {
        queryReq: any;
        type: "search" | "histogram" | "pageCount";
        isPagination: boolean;
        traceId: string;
        org_id: string;
        pageType: string;
        searchType: string;
        meta: any;
        clear_cache: boolean;
      } = {
        queryReq: {
          query: {
            ...(await getHistogramSearchRequest(
              query,
              it,
              startISOTimestamp,
              endISOTimestamp,
              null,
            )),
          },
        },
        type: "histogram",
        isPagination: false,
        traceId,
        org_id: store?.state?.selectedOrganization?.identifier,
        pageType,
        searchType: searchType.value ?? "dashboards",
        meta: {
          currentQueryIndex,
          dashboard_id: dashboardId?.value,
          dashboard_name: dashboardName?.value,
          folder_id: folderId?.value,
          folder_name: folderName?.value,
          panel_id: panelSchema.value.id,
          panel_name: panelSchema.value.title,
          run_id: runId?.value,
          tab_id: tabId?.value,
          tab_name: tabName?.value,
          fallback_order_by_col: getFallbackOrderByCol(),
          is_ui_histogram: is_ui_histogram.value,
        },
        clear_cache: shouldRefreshWithoutCache?.value || false,
      };

      // type: "search",
      // content: {
      //   trace_id: payload.traceId,
      //   payload: {
      //     query: await getHistogramSearchRequest(
      //       payload.queryReq.query,
      //       payload.queryReq.it,
      //       payload.queryReq.startISOTimestamp,
      //       payload.queryReq.endISOTimestamp,
      //       null,
      //     ),
      //   },
      //   stream_type: payload.pageType,
      //   search_type: searchType.value ?? "dashboards",
      //   org_id: store?.state?.selectedOrganization?.identifier,
      //   use_cache: (window as any).use_cache ?? true,
      //   dashboard_id: dashboardId?.value,
      //   folder_id: folderId?.value,
      //   fallback_order_by_col: getFallbackOrderByCol(),
      // },

      // if aborted, return
      if (abortControllerRef?.signal?.aborted) {
        // Set partial data flag on abort
        state.isPartialData = true;
        // Save current state to cache
        saveCurrentStateToCache();
        return;
      }

      // Add guard here
      // if (shouldSkipSearchDueToEmptyVariables()) {
      //   return;
      // }

      fetchQueryDataWithHttpStream(payload, {
        data: handleSearchResponse,
        error: handleSearchError,
        complete: handleSearchClose,
        reset: handleSearchReset,
      });

      addTraceId(traceId);
    } catch (e: any) {
      state.errorDetail = {
        message: e?.message || e,
        code: e?.code ?? "",
      };
      state.loading = false;
      state.isOperationCancelled = false;
      state.isPartialData = false;
    }
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
        // copy of current abortController
        // which is used to check whether the current query has been aborted
        const abortControllerRef = abortController;

        try {
          // Initialize state for PromQL streaming
          state.data = [];
          state.metadata = {
            queries: [],
          };
          state.resultMetaData = [];
          state.annotations = [];
          state.isOperationCancelled = false;

          // Start fetching annotations in parallel with queries
          const annotationsPromise = (async () => {
            try {
              if (!shouldFetchAnnotations()) {
                return [];
              }
              const annotationList = await refreshAnnotations(
                startISOTimestamp,
                endISOTimestamp,
              );
              return annotationList || [];
            } catch (annotationError) {
              console.error("Failed to fetch annotations:", annotationError);
              return [];
            }
          })();

          // Initialize result data and metadata arrays
          const queryResults: any[] = [];
          const queryMetadata: any[] = [];
          const completedQueries = new Set<number>(); // Track completed queries

          // Process each query using streaming
          // Process all queries in parallel using Promise.all
          await Promise.all(
            panelSchema.value.queries.map(async (it, queryIndex) => {
              const { query: query1, metadata: metadata1 } = replaceQueryValue(
                it.query,
                startISOTimestamp,
                endISOTimestamp,
                panelSchema.value.queryType,
              );

              const { query: query2, metadata: metadata2 } =
                await applyDynamicVariables(
                  query1,
                  panelSchema.value.queryType,
                );

              const query = query2;
              const metadata = {
                originalQuery: it.query,
                query: query,
                startTime: startISOTimestamp,
                endTime: endISOTimestamp,
                queryType: panelSchema.value.queryType,
                variables: [...(metadata1 || []), ...(metadata2 || [])],
              };

              queryMetadata[queryIndex] = metadata;
              // Don't initialize queryResults[queryIndex] yet - let it be undefined
              // This way we can detect the first chunk properly

              const { traceId } = generateTraceContext();

              const queryStepValue = it.config?.step_value?.trim()?.length
                ? it.config?.step_value?.trim()
                : undefined;

              const panelStepValue = panelSchema.value.config.step_value?.trim()
                ?.length
                ? panelSchema.value.config?.step_value?.trim()
                : undefined;

              const payload = {
                queryReq: {
                  query: query,
                  start_time: startISOTimestamp,
                  end_time: endISOTimestamp,
                  step: queryStepValue
                    ? queryStepValue
                    : panelStepValue
                      ? panelStepValue
                      : "0",
                  query_type: it.config.query_type || "range", // Add query_type from config (default: range)
                },
                type: "promql" as const,
                traceId: traceId,
                org_id: store.state.selectedOrganization.identifier,
                meta: {
                  dashboard_id: dashboardId?.value,
                  dashboard_name: dashboardName?.value,
                  folder_id: folderId?.value,
                  folder_name: folderName?.value,
                  panel_id: panelSchema.value.id,
                  panel_name: panelSchema.value.title,
                  run_id: runId?.value,
                  tab_id: tabId?.value,
                  tab_name: tabName?.value,
                },
              };

              // if aborted, return
              if (abortControllerRef?.signal?.aborted) {
                // Set partial data flag on abort
                state.isPartialData = true;
                // Save current state to cache
                saveCurrentStateToCache();
                return;
              }

              // Get series limit from config
              const maxSeries = store.state?.zoConfig?.max_dashboard_series ?? 100;

              // Create chunk processor for efficient metric merging
              const chunkProcessor = createPromQLChunkProcessor({
                maxSeries,
                enableLogging: false,
              });

              const handlePromQLResponse = (data: any, res: any) => {
                if (res.type === "event_progress") {
                  state.loadingProgressPercentage = res?.content?.percent ?? 0;
                  state.isPartialData = true;
                  saveCurrentStateToCache();
                }
                if (res?.type === "promql_response") {
                  const newData = res?.content?.results;

                  // Process chunk using extracted processor module
                  queryResults[queryIndex] = chunkProcessor.processChunk(
                    queryResults[queryIndex],
                    newData
                  );

                  // Update state with accumulated results
                  state.data = [...queryResults];
                  state.metadata = {
                    queries: queryMetadata,
                  };

                  // Clear error on successful response
                  state.errorDetail = {
                    message: "",
                    code: "",
                  };
                }
              };

              const handlePromQLError = (data: any, err: any) => {
                // Mark this query as completed (even with error)
                completedQueries.add(queryIndex);

                const errorMessage =
                  err?.content?.message ||
                  err?.content?.error ||
                  "Unknown error";
                const errorCode = err?.content?.code || "";

                state.errorDetail = {
                  message: errorMessage,
                  code: errorCode,
                };

                removeTraceId(traceId);

                // Only mark loading as complete when ALL queries are done
                if (
                  completedQueries.size === panelSchema.value.queries.length
                ) {
                  state.loading = false;
                  state.isOperationCancelled = false;
                  state.isPartialData = false;
                }
              };

              const handlePromQLComplete = (data: any, _: any) => {
                // Mark this query as completed
                completedQueries.add(queryIndex);

                // Get statistics from chunk processor
                const stats = chunkProcessor.getStats();

                // Final update with complete results
                state.data = [...queryResults];
                state.metadata = {
                  queries: queryMetadata,
                  // Add series limiting information for warning message
                  seriesLimiting: {
                    totalMetricsReceived: stats.totalMetricsReceived,
                    metricsStored: stats.metricsStored,
                    maxSeries,
                  },
                };

                removeTraceId(traceId);

                // Only mark loading as complete when ALL queries are done
                if (
                  completedQueries.size === panelSchema.value.queries.length
                ) {
                  state.loading = false;
                  state.isOperationCancelled = false;
                  state.isPartialData = false;

                  // Save to cache after all queries complete
                  saveCurrentStateToCache();
                }
              };

              const handlePromQLReset = (data: any, res: any) => {
                // Reset handling if needed
              };

              fetchQueryDataWithHttpStream(payload, {
                data: handlePromQLResponse,
                error: handlePromQLError,
                complete: handlePromQLComplete,
                reset: handlePromQLReset,
              });

              addTraceId(traceId);
            }),
          );

          // Wait for annotations to complete and update state
          state.annotations = await annotationsPromise;
        } catch (error) {
          state.loading = false;
          state.isOperationCancelled = false;
          state.isPartialData = false;
        }
      } else {
        // copy of current abortController
        // which is used to check whether the current query has been aborted
        const abortControllerRef = abortController;

        try {
          // Call search API
          state.data = [];
          state.metadata = {
            queries: [],
          };
          state.resultMetaData = [];
          state.annotations = [];
          state.isOperationCancelled = false;

          // Get the page type from the first query in the panel schema
          const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

          // Handle each query sequentially
          for (const [
            panelQueryIndex,
            it,
          ] of panelSchema.value.queries.entries()) {
            state.loading = true;

            if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
              // convert time shift to milliseconds
              const timeShiftInMilliSecondsArray = it.config?.time_shift?.map(
                (it: any) => convertOffsetToSeconds(it.offSet, endISOTimestamp),
              );

              // append 0 seconds to the timeShiftInMilliSecondsArray at 0th index
              timeShiftInMilliSecondsArray.unshift({
                seconds: 0,
                periodAsStr: "",
              });

              const timeShiftQueries: any[] = [];

              // loop on all timeShiftInMilliSecondsArray
              for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
                const timeRangeGap = timeShiftInMilliSecondsArray[i];
                const { query: query1, metadata: metadata1 } =
                  replaceQueryValue(
                    it.query,
                    adjustTimestampByTimeRangeGap(
                      startISOTimestamp,
                      timeRangeGap.seconds,
                    ),
                    adjustTimestampByTimeRangeGap(
                      endISOTimestamp,
                      timeRangeGap.seconds,
                    ),
                    panelSchema.value.queryType,
                  );

                const { query: query2, metadata: metadata2 } =
                  await applyDynamicVariables(
                    query1,
                    panelSchema.value.queryType,
                  );
                const query = query2;

                // Validate that timestamp column is not used as an alias for other fields
                if (!checkTimestampAlias(query)) {
                  state.errorDetail = {
                    message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
                    code: "400",
                  };
                  addTraceId("tempTraceId");
                  await nextTick();
                  removeTraceId("tempTraceId");
                  state.loading = false;
                  // Skip this iteration and continue with next query/time shift
                  continue;
                }
                const metadata: any = {
                  originalQuery: it.query,
                  query: query,
                  startTime: adjustTimestampByTimeRangeGap(
                    startISOTimestamp,
                    timeRangeGap.seconds,
                  ),
                  endTime: adjustTimestampByTimeRangeGap(
                    endISOTimestamp,
                    timeRangeGap.seconds,
                  ),
                  queryType: panelSchema.value.queryType,
                  variables: [...(metadata1 || []), ...(metadata2 || [])],
                  timeRangeGap: timeRangeGap,
                };

                // push metadata and searchRequestObj[which will be passed to search API]
                timeShiftQueries.push({
                  metadata,
                  searchRequestObj: {
                    sql: query,
                    start_time: adjustTimestampByTimeRangeGap(
                      startISOTimestamp,
                      timeRangeGap.seconds,
                    ),
                    end_time: adjustTimestampByTimeRangeGap(
                      endISOTimestamp,
                      timeRangeGap.seconds,
                    ),
                    query_fn: null,
                  },
                });
              }

              try {
                // Start fetching annotations in parallel with search
                const annotationsPromise = (async () => {
                  try {
                    if (!shouldFetchAnnotations()) {
                      return [];
                    }
                    const annotationList = await refreshAnnotations(
                      startISOTimestamp,
                      endISOTimestamp,
                    );
                    return annotationList || [];
                  } catch (annotationError) {
                    console.error(
                      "Failed to fetch annotations:",
                      annotationError,
                    );
                    return [];
                  }
                })();

                // get search queries
                const searchQueries = timeShiftQueries.map(
                  (it: any) => it.searchRequestObj,
                );

                const { traceId } = generateTraceContext();
                addTraceId(traceId);
                // if aborted, return
                if (abortControllerRef?.signal?.aborted) {
                  return;
                }

                state.loading = true;

                // Initialize state arrays for each time shift query
                for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
                  state.data.push([]);
                  state.metadata.queries.push(
                    timeShiftQueries[i]?.metadata ?? {},
                  );
                  state.resultMetaData.push([]);
                }

                // Use HTTP2/streaming for multi-query (time-shift) queries
                // Track the current query index being processed
                let currentQueryIndexInStream: number | null = null;

                const payload: any = {
                  queryReq: {
                    query: {
                      sql: searchQueries,
                      query_fn: it.vrlFunctionQuery
                        ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
                        : null,
                      start_time: startISOTimestamp,
                      end_time: endISOTimestamp,
                      per_query_response: true,
                      size: -1,
                    },
                  },
                  type: "histogram" as const,
                  isPagination: false,
                  traceId,
                  org_id: store?.state?.selectedOrganization?.identifier,
                  pageType,
                  searchType: searchType.value ?? "dashboards",
                  meta: {
                    dashboard_id: dashboardId?.value,
                    dashboard_name: dashboardName?.value,
                    folder_id: folderId?.value,
                    folder_name: folderName?.value,
                    panel_id: panelSchema.value.id,
                    panel_name: panelSchema.value.title,
                    run_id: runId?.value,
                    tab_id: tabId?.value,
                    tab_name: tabName?.value,
                    fallback_order_by_col: getFallbackOrderByCol(),
                    is_ui_histogram: is_ui_histogram.value,
                    is_refresh_cache: shouldRefreshWithoutCache?.value || false,
                    timeShiftQueries,
                  },
                };

                fetchQueryDataWithHttpStream(payload, {
                  data: (payload: any, response: any) => {
                    // Handle streaming response for multi-query
                    if (response.type === "search_response_metadata") {
                      const results = response?.content?.results;

                      const queryIndex = results?.query_index ?? 0;

                      // Store the current query index for the next hits event
                      currentQueryIndexInStream = queryIndex;

                      // Initialize metadata array if not exists
                      if (!state.resultMetaData[queryIndex]) {
                        state.resultMetaData[queryIndex] = [];
                      }

                      // Push metadata for each partition
                      state.resultMetaData[queryIndex].push({
                        ...(response?.content ?? {}),
                        ...(response?.content?.results ?? {}),
                      });
                    }

                    if (response.type === "search_response_hits") {
                      // The hits come directly in response.content.hits or response.content.results.hits
                      const hits =
                        response?.content?.results?.hits ??
                        response?.content?.hits;
                      // Get query_index from results metadata
                      const results = response?.content?.results;

                      // Use query_index from the event, or from the last metadata event, or find next empty
                      let queryIndex =
                        results?.query_index ?? currentQueryIndexInStream;

                      // If query_index is still not available, find the first query that doesn't have hits yet
                      if (queryIndex === undefined || queryIndex === null) {
                        queryIndex = state.resultMetaData.findIndex(
                          (meta: any, idx: number) =>
                            !state.data[idx] || state.data[idx].length === 0,
                        );
                      }

                      if (
                        queryIndex >= 0 &&
                        queryIndex < state.data.length &&
                        Array.isArray(hits) &&
                        hits.length > 0
                      ) {
                        // Check if streaming_aggs is enabled
                        const streaming_aggs =
                          state.resultMetaData[queryIndex]?.[0]
                            ?.streaming_aggs ?? false;

                        // If streaming_aggs, replace the data (aggregation query)
                        if (streaming_aggs) {
                          state.data[queryIndex] = [...hits];
                        }
                        // Otherwise, append/prepend based on order_by (multiple partitions)
                        else {
                          const orderBy =
                            state.resultMetaData[
                              queryIndex
                            ]?.order_by?.toLowerCase();

                          if (orderBy === "asc") {
                            // For ascending order, prepend new data at start
                            state.data[queryIndex] = [
                              ...hits,
                              ...(state.data[queryIndex] ?? []),
                            ];
                          } else {
                            // For descending order, append new data at end
                            state.data[queryIndex] = [
                              ...(state.data[queryIndex] ?? []),
                              ...hits,
                            ];
                          }
                        }

                        if (state.resultMetaData[queryIndex]) {
                          state.resultMetaData[queryIndex].hits =
                            state.data[queryIndex];
                        }
                      }
                      state.errorDetail = { message: "", code: "" };
                      saveCurrentStateToCache();
                    }

                    if (response.type === "search_response") {
                      // Legacy format: single response with all data
                      const results = response?.content?.results;
                      const queryIndex = results?.query_index ?? 0;

                      if (results?.hits && Array.isArray(results.hits)) {
                        state.data[queryIndex] = [...results.hits];
                        state.resultMetaData[queryIndex] = {
                          ...(state.resultMetaData[queryIndex] ?? {}),
                          ...results,
                        };
                      }
                      state.errorDetail = { message: "", code: "" };
                      saveCurrentStateToCache();
                    }

                    if (response.type === "error") {
                      processApiError(response?.content, "sql");
                    }

                    if (response.type === "end") {
                      state.loading = false;
                      state.isPartialData = false;
                      saveCurrentStateToCache();
                    }
                  },
                  error: handleSearchError,
                  complete: async (payload: any) => {
                    state.loading = false;
                    saveCurrentStateToCache();
                    removeTraceId(traceId);
                  },
                  reset: handleSearchReset,
                });

                // Wait for annotations to complete (started in parallel earlier)
                state.annotations = await annotationsPromise;
              } catch (error) {
                // Process API error for "sql"
                processApiError(error, "sql");
                return { result: null, metadata: null };
              } finally {
                // set loading to false
                // state.loading = false;
              }
            } else {
              const { query: query1, metadata: metadata1 } = replaceQueryValue(
                it.query,
                startISOTimestamp,
                endISOTimestamp,
                panelSchema.value.queryType,
              );

              const { query: query2, metadata: metadata2 } =
                await applyDynamicVariables(
                  query1,
                  panelSchema.value.queryType,
                );

              const query = query2;

              // Validate that timestamp column is not used as an alias for other fields
              if (!checkTimestampAlias(query)) {
                state.errorDetail = {
                  message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
                  code: "400",
                };
                state.loading = false;
                addTraceId("tempTraceId");
                await nextTick();
                removeTraceId("tempTraceId");
                // Skip executing this query and move to next
                continue;
              }

              const metadata: any = {
                originalQuery: it.query,
                query: query,
                startTime: startISOTimestamp,
                endTime: endISOTimestamp,
                queryType: panelSchema.value.queryType,
                variables: [...(metadata1 || []), ...(metadata2 || [])],
                timeRangeGap: {
                  seconds: 0,
                  periodAsStr: "",
                },
              };
              // if (shouldSkipSearchDueToEmptyVariables()) {
              //   return;
              // }
              state.metadata.queries[panelQueryIndex] = metadata;

              let annotationsPromise: Promise<any> | null = null;

              if (searchResponse?.value?.hits?.length > 0) {
                // Start fetching annotations in parallel
                annotationsPromise = (async () => {
                  try {
                    if (!shouldFetchAnnotations()) {
                      return [];
                    }
                    const annotationList = await refreshAnnotations(
                      Number(startISOTimestamp),
                      Number(endISOTimestamp),
                    );
                    return annotationList || [];
                  } catch (annotationError) {
                    return [];
                  }
                })();

                // Add empty objects to state.resultMetaData for the results of this query
                state.data.push([]);
                state?.resultMetaData?.push([{}]); // Initialize as array with one element

                const currentQueryIndex = state.data.length - 1;

                state.data[currentQueryIndex] = searchResponse.value.hits;
                state.resultMetaData[currentQueryIndex] = [
                  searchResponse.value,
                ]; // Wrap in array

                // Wait for annotations to complete
                if (annotationsPromise) {
                  state.annotations = await annotationsPromise;
                }

                // set loading to false
                state.loading = false;
                return;
              }
              // Start fetching annotations in parallel for ALL query types
              annotationsPromise = (async () => {
                try {
                  if (!shouldFetchAnnotations()) {
                    return [];
                  }
                  const annotationList = await refreshAnnotations(
                    Number(startISOTimestamp),
                    Number(endISOTimestamp),
                  );
                  return annotationList || [];
                } catch (annotationError) {
                  console.error(
                    "Failed to fetch annotations:",
                    annotationError,
                  );
                  return [];
                }
              })();

              // Initialize data and resultMetaData arrays for this query index
              // This is necessary before the streaming response handlers try to access them
              state.data[panelQueryIndex] = [];
              state.resultMetaData[panelQueryIndex] = [];

              // Use HTTP2/streaming for all dashboard queries
              await getDataThroughStreaming(
                query,
                it,
                startISOTimestamp,
                endISOTimestamp,
                pageType,
                panelQueryIndex,
                abortControllerRef,
              );

              // Wait for annotations to complete if they were started
              if (annotationsPromise) {
                state.annotations = await annotationsPromise;
              }

              // this is async task, which will be executed in background(await is not required)
              saveCurrentStateToCache();
            }
          }

          log("logaData: state.data", state.data);
          log("logaData: state.metadata", state.metadata);
        } finally {
          // abort on done
          if (abortControllerRef) {
            abortControllerRef?.abort();
          }
        }
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

  /**
   * Replaces the query with the corresponding variable values.
   *
   * @param {any} query - The query to be modified.
   * @return {any} The modified query with replaced values.
   */
  const replaceQueryValue = (
    query: any,
    startISOTimestamp: any,
    endISOTimestamp: any,
    queryType: any,
  ) => {
    const metadata: any[] = [];

    //fixed variables value calculations
    //scrape interval by default 15 seconds
    const scrapeInterval =
      store.state.organizationData.organizationSettings.scrape_interval ?? 15;

    // timestamp in seconds / chart panel width
    const __interval =
      (endISOTimestamp - startISOTimestamp) /
      (chartPanelRef.value?.offsetWidth ?? 1000) /
      1000;

    // if less than 1, set it to 1
    // minimum will be 15000 millisecond
    // __interval = Math.max(15000, __interval);

    // round interval
    const formattedInterval = formatInterval(__interval);

    // calculate rate interval in seconds
    // we need formatted interval value in seconds
    const __rate_interval: any = Math.max(
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) + scrapeInterval,
      4 * scrapeInterval,
    );

    //get interval in ms
    const __interval_ms =
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit,
      ) * 1000;

    // calculate range in seconds (total time range of the dashboard)
    // Note: startISOTimestamp and endISOTimestamp are in microseconds (from API)
    const __range_micros = endISOTimestamp - startISOTimestamp;
    const __range_seconds = __range_micros / 1000000; // Convert microseconds to seconds

    // format range, ensuring it's never empty (minimum 1s for PromQL compatibility)
    const formattedRange = formatRateInterval(__range_seconds) || "1s";

    const fixedVariables = [
      {
        name: "__interval_ms",
        value: `${__interval_ms}ms`,
      },
      {
        name: "__interval",
        value: `${formattedInterval.value}${formattedInterval.unit}`,
      },
      {
        name: "__rate_interval",
        value: `${formatRateInterval(__rate_interval)}`,
      },
      {
        name: "__range",
        value: formattedRange,
      },
      {
        name: "__range_s",
        value: `${Math.floor(__range_seconds)}`,
      },
      {
        name: "__range_ms",
        value: `${Math.floor(__range_seconds * 1000)}`,
      },
    ];

    // replace fixed variables with its values
    fixedVariables?.forEach((variable: any) => {
      // replace $VARIABLE_NAME or ${VARIABLE_NAME} with its value
      const variableName = `$${variable.name}`;
      const variableNameWithBrackets = `\${${variable.name}}`;
      const variableValue = variable.value;
      if (
        query.includes(variableName) ||
        query.includes(variableNameWithBrackets)
      ) {
        metadata.push({
          type: "fixed",
          name: variable.name,
          value: variable.value,
        });
      }
      query = query.replaceAll(variableNameWithBrackets, variableValue);
      query = query.replaceAll(variableName, variableValue);
    });

    if (currentDependentVariablesData?.length) {
      currentDependentVariablesData?.forEach((variable: any) => {
        // replace $VARIABLE_NAME or ${VARIABLE_NAME} with its value
        const variableName = `$${variable.name}`;
        const variableNameWithBrackets = `\${${variable.name}}`;

        let variableValue = "";
        if (Array.isArray(variable.value)) {
          // If no data found (empty array), use SELECT_ALL_VALUE
          const valueToUse =
            variable.value.length === 0 ? [SELECT_ALL_VALUE] : variable.value;
          const value =
            valueToUse
              .map(
                (value: any) =>
                  `'${variable.escapeSingleQuotes ? escapeSingleQuotes(value) : value}'`,
              )
              .join(",") || "''";
          const possibleVariablesPlaceHolderTypes = [
            {
              placeHolder: `\${${variable.name}:csv}`,
              value: valueToUse.join(","),
            },
            {
              placeHolder: `\${${variable.name}:pipe}`,
              value: valueToUse.join("|"),
            },
            {
              placeHolder: `\${${variable.name}:doublequote}`,
              value:
                valueToUse.map((value: any) => `"${value}"`).join(",") || '""',
            },
            {
              placeHolder: `\${${variable.name}:singlequote}`,
              value: value,
            },
            {
              placeHolder: `\${${variable.name}}`,
              value: queryType === "sql" ? value : valueToUse.join("|"),
            },
            {
              placeHolder: `\$${variable.name}`,
              value: queryType === "sql" ? value : valueToUse.join("|"),
            },
          ];

          possibleVariablesPlaceHolderTypes.forEach((placeHolderObj) => {
            if (query.includes(placeHolderObj.placeHolder)) {
              metadata.push({
                type: "variable",
                name: variable.name,
                value: placeHolderObj.value,
              });
            }
            query = query.replaceAll(
              placeHolderObj.placeHolder,
              placeHolderObj.value,
            );
          });
        } else {
          // If no data found (null value), use SELECT_ALL_VALUE
          const valueToUse =
            variable.value === null ? SELECT_ALL_VALUE : variable.value;
          variableValue = `${variable.escapeSingleQuotes ? escapeSingleQuotes(valueToUse) : valueToUse}`;
          if (
            query.includes(variableName) ||
            query.includes(variableNameWithBrackets)
          ) {
            metadata.push({
              type: "variable",
              name: variable.name,
              value: valueToUse,
            });
          }
          query = query.replaceAll(variableNameWithBrackets, variableValue);
          query = query.replaceAll(variableName, variableValue);
        }
      });

      return { query, metadata };
    } else {
      return { query, metadata };
    }
  };

  const applyDynamicVariables = async (query: any, queryType: any) => {
    const metadata: any[] = [];
    const adHocVariables = variablesData.value?.values
      ?.filter((it: any) => it.type === "dynamic_filters")
      ?.map((it: any) => it?.value)
      .flat()
      ?.filter((it: any) => it?.operator && it?.name && it?.value);

    if (!adHocVariables?.length) {
      return { query, metadata };
    }

    // continue if there are any adhoc queries
    if (queryType === "promql") {
      adHocVariables.forEach((variable: any) => {
        metadata.push({
          type: "dynamicVariable",
          name: variable.name,
          value: variable.value,
          operator: variable.operator,
        });

        query = addLabelToPromQlQuery(
          query,
          variable.name,
          variable.value,
          variable.operator,
        );
      });
    }

    if (queryType === "sql") {
      const queryStream = await getStreamFromQuery(query);

      const applicableAdHocVariables = adHocVariables;
      // .filter((it: any) => {
      //   return it?.streams?.find((it: any) => it.name == queryStream);
      // });

      applicableAdHocVariables.forEach((variable: any) => {
        metadata.push({
          type: "dynamicVariable",
          name: variable.name,
          value: variable.value,
          operator: variable.operator,
        });
      });
      query = await addLabelsToSQlQuery(query, applicableAdHocVariables);
    }

    return { query, metadata };
  };

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
