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

import { ref, watch, reactive, toRefs, onMounted, onUnmounted } from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";
import { convertOffsetToSeconds } from "@/utils/dashboard/convertDataIntoUnitValue";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import { useAnnotations } from "./useAnnotations";
import useHttpStreamingSearch from "../useStreamingSearch";
import { checkIfConfigChangeRequiredApiCallOrNot } from "@/utils/dashboard/checkConfigChangeApiCall";
import {
  b64EncodeUnicode,
  generateTraceContext,
  isWebSocketEnabled,
  isStreamingEnabled,
} from "@/utils/zincutils";

// Import our modular components
import { adjustTimestampByTimeRangeGap } from "./panelDataLoader/constants";
import { VariableManager } from "./panelDataLoader/variableManager";
import { SearchMethods } from "./panelDataLoader/searchMethods";
import { ResponseHandlers } from "./panelDataLoader/responseHandlers";
import { CacheManager } from "./panelDataLoader/cacheManager";
import { PanelHelpers } from "./panelDataLoader/helpers";
import type { PanelState } from "./panelDataLoader/types";

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
  searchResponse: any,
  is_ui_histogram: any,
  runId?: any,
  tabId?: any,
  tabName?: any,
) => {
  const log = (...args: any[]) => {
    // if (true) {
    //   console.log(panelSchema?.value?.title + ": ", ...args);
    // }
  };
  let runCount = 0;

  const store = useStore();

  const {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    cleanUpListeners,
  } = useSearchWebSocket();

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

  const state = reactive<PanelState>({
    data: [] as any,
    loading: false,
    errorDetail: {
      message: "",
      code: "",
    },
    metadata: {
      queries: [] as any,
    },
    annotations: [] as any,
    resultMetaData: [] as any,
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

  let abortController = new AbortController();

  // Initialize our modular components
  const variableManager = new VariableManager(
    panelSchema,
    variablesData,
    chartPanelRef,
  );

  const helpers = new PanelHelpers(state, panelSchema);

  const cacheManager = new CacheManager(
    state,
    panelSchema,
    variableManager,
    selectedTimeObj,
    forceLoad,
    dashboardId,
    folderId,
  );

  const searchMethods = new SearchMethods(
    state,
    panelSchema,
    dashboardId,
    folderId,
    runId,
    tabId,
    tabName,
    searchType,
    is_ui_histogram,
    (traceId) => helpers.addTraceId(traceId),
    (traceId) => helpers.removeTraceId(traceId),
  );

  const responseHandlers = new ResponseHandlers(
    state,
    (traceId) => helpers.removeTraceId(traceId),
    (error, type) => helpers.processApiError(error, type),
    () => cacheManager.saveCurrentStateToCache(),
    loadData,
  );

  const cancelQueryAbort = () => {
    if (state.loading) {
      state.isPartialData = true;
    }
    state.loading = false;
    state.isOperationCancelled = true;

    if (
      isStreamingEnabled(store.state) &&
      state.searchRequestTraceIds?.length > 0
    ) {
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

    if (
      isWebSocketEnabled(store.state) &&
      state.searchRequestTraceIds?.length > 0
    ) {
      try {
        state.searchRequestTraceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
      } catch (error) {
        console.error("Error during WebSocket cleanup:", error);
      } finally {
        state.searchRequestTraceIds = [];
      }
    }
    if (abortController) {
      abortController?.abort();
    }
    cacheManager.saveCurrentStateToCache();
  };

  const sendSearchMessage = async (payload: any) => {
    if (state.isOperationCancelled) {
      state.isOperationCancelled = false;
      cleanUpListeners(payload.traceId);
      return;
    }

    sendSearchMessageBasedOnRequestId({
      type: "search",
      content: {
        trace_id: payload.traceId,
        payload: {
          query: {
            ...searchMethods.getHistogramSearchRequest(
              payload.queryReq.query,
              payload.queryReq.it,
              payload.queryReq.startISOTimestamp,
              payload.queryReq.endISOTimestamp,
              null,
            ),
          },
          ...(store.state.zoConfig.sql_base64_enabled
            ? { encoding: "base64" }
            : {}),
        },
        stream_type: payload.pageType,
        search_type: searchType.value ?? "dashboards",
        org_id: store?.state?.selectedOrganization?.identifier,
        use_cache: (window as any).use_cache ?? true,
        dashboard_id: dashboardId?.value,
        folder_id: folderId?.value,
        panel_id: panelSchema.value.id,
        panel_name: panelSchema.value.title,
        run_id: runId?.value,
        tab_id: tabId?.value,
        tab_name: tabName?.value,
        fallback_order_by_col: searchMethods.getFallbackOrderByCol(),
        is_ui_histogram: is_ui_histogram.value,
      },
    });
  };

  const waitForThePanelToBecomeVisible = (signal: any) => {
    return new Promise<void>((resolve, reject) => {
      if (forceLoad.value == true) {
        resolve();
        return;
      }
      if (isVisible.value) {
        resolve();
        return;
      }

      const stopWatching = watch(isVisible, (newValue) => {
        if (newValue) {
          resolve();
          stopWatching();
        }
      });

      signal.addEventListener("abort", () => {
        stopWatching();
        reject(new Error("Aborted waiting for loading"));
      });
    });
  };

  const waitForTheVariablesToLoad = (signal: any) => {
    return new Promise<void>((resolve, reject) => {
      log("waitForTheVariablesToLoad: entering...");
      if (variableManager.ifPanelVariablesCompletedLoading()) {
        log("waitForTheVariablesToLoad: variables are already loaded");
        resolve();
        return;
      }

      const stopWatching = watch(
        () => variablesData.value?.values,
        () => {
          if (variableManager.ifPanelVariablesCompletedLoading()) {
            log(
              "waitForTheVariablesToLoad: variables are loaded (inside watch)",
            );
            resolve();
            stopWatching();
          }
        },
      );

      signal.addEventListener("abort", () => {
        stopWatching();
        reject(new Error("Aborted waiting for loading"));
      });
    });
  };

  async function loadData() {
    if (runCount > 0 && !state.isOperationCancelled) {
      state.isPartialData = false;
    }

    try {
      log("loadData: entering...");
      state.loadingTotal = 0;
      state.loadingCompleted = 0;
      state.loadingProgressPercentage = 0;

      if (abortController) {
        log("loadData: aborting previous function call (if any)");
        abortController.abort();
      }

      abortController = new AbortController();
      window.addEventListener("cancelQuery", cancelQueryAbort);

      if (!panelSchema.value.queries?.length || !helpers.hasAtLeastOneQuery()) {
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
      await helpers.waitForTimeout(abortController.signal);

      log("loadData: now waiting for the panel to become visible");
      state.lastTriggeredAt = new Date().getTime();

      if (runCount == 0) {
        log("loadData: panelcache: run count is 0");
        const isRestoredFromCache = await cacheManager.restoreFromCache();
        log("loadData: panelcache: isRestoredFromCache", isRestoredFromCache);
        if (isRestoredFromCache) {
          state.loading = false;
          state.isOperationCancelled = false;
          log("loadData: panelcache: restored from cache");
          runCount++;
          return;
        }
      }

      await waitForThePanelToBecomeVisible(abortController.signal);
      log("loadData: now waiting for the variables to load");
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

      state.errorDetail = {
        message: "",
        code: "",
      };

      if (panelSchema.value.queryType == "promql") {
        // Handle PromQL queries
        const queryPromises = panelSchema.value.queries?.map(
          async (it: any) => {
            const { query: query1, metadata: metadata1 } =
              variableManager.replaceQueryValue(
                it.query,
                startISOTimestamp,
                endISOTimestamp,
                panelSchema.value.queryType,
              );

            const { query: query2, metadata: metadata2 } =
              await variableManager.applyDynamicVariables(
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
            const { traceparent, traceId } = generateTraceContext();
            helpers.addTraceId(traceId);
            try {
              const res = await searchMethods.callWithAbortController(
                () =>
                  queryService.metrics_query_range({
                    org_identifier: store.state.selectedOrganization.identifier,
                    query: query,
                    start_time: startISOTimestamp,
                    end_time: endISOTimestamp,
                    step: panelSchema.value.config.step_value ?? "0",
                    dashboard_id: dashboardId?.value,
                    folder_id: folderId?.value,
                    panel_id: panelSchema.value.id,
                    panel_name: panelSchema.value.title,
                    run_id: runId?.value,
                    tab_id: tabId?.value,
                    tab_name: tabName?.value,
                  }),
                abortController.signal,
              );

              state.errorDetail = {
                message: "",
                code: "",
              };
              return { result: res.data.data, metadata: metadata };
            } catch (error) {
              helpers.processApiError(error, "promql");
              return { result: null, metadata: metadata };
            } finally {
              helpers.removeTraceId(traceId);
            }
          },
        );

        const annotationList = helpers.shouldFetchAnnotations()
          ? await refreshAnnotations(startISOTimestamp, endISOTimestamp)
          : [];

        const queryResults: any = await Promise.all(queryPromises);
        state.loading = false;
        state.data = queryResults.map((it: any) => it?.result);
        state.metadata = {
          queries: queryResults.map((it: any) => it?.metadata),
        };
        state.annotations = annotationList || [];

        await cacheManager.saveCurrentStateToCache();
      } else {
        // Handle SQL queries
        const abortControllerRef = abortController;

        try {
          state.data = [];
          state.metadata = {
            queries: [],
          };
          state.resultMetaData = [];
          state.annotations = [];
          state.isOperationCancelled = false;

          const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

          for (const [
            panelQueryIndex,
            it,
          ] of panelSchema.value.queries.entries()) {
            state.loading = true;

            if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
              // Handle time shift queries
              const timeShiftInMilliSecondsArray = it.config?.time_shift?.map(
                (it: any) => convertOffsetToSeconds(it.offSet, endISOTimestamp),
              );

              timeShiftInMilliSecondsArray.unshift({
                seconds: 0,
                periodAsStr: "",
              });

              const timeShiftQueries: any[] = [];

              for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
                const timeRangeGap = timeShiftInMilliSecondsArray[i];
                const { query: query1, metadata: metadata1 } =
                  variableManager.replaceQueryValue(
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
                  await variableManager.applyDynamicVariables(
                    query1,
                    panelSchema.value.queryType,
                  );

                const query = query2;
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
                const searchQueries = timeShiftQueries.map(
                  (it: any) => it.searchRequestObj,
                );

                const { traceparent, traceId } = generateTraceContext();
                helpers.addTraceId(traceId);

                if (abortControllerRef?.signal?.aborted) {
                  return;
                }

                state.loading = true;

                try {
                  const searchRes = await searchMethods.callWithAbortController(
                    async () =>
                      await queryService.search(
                        {
                          org_identifier:
                            store.state.selectedOrganization.identifier,
                          query: {
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
                          page_type: pageType,
                          traceparent,
                          dashboard_id: dashboardId?.value,
                          folder_id: folderId?.value,
                          panel_id: panelSchema.value.id,
                          panel_name: panelSchema.value.title,
                          run_id: runId?.value,
                          tab_id: tabId?.value,
                          tab_name: tabName?.value,
                          is_ui_histogram: is_ui_histogram.value,
                        },
                        searchType.value ?? "dashboards",
                      ),
                    abortControllerRef.signal,
                  );

                  state.errorDetail = {
                    message: "",
                    code: "",
                  };

                  if (
                    searchRes.data.function_error &&
                    searchRes.data.is_partial != true
                  ) {
                    if (abortControllerRef) {
                      abortControllerRef?.abort();
                    }
                    throw new Error(
                      `Function error: ${searchRes.data.function_error}`,
                    );
                  }

                  if (abortControllerRef?.signal?.aborted) {
                    break;
                  }

                  for (
                    let i = 0;
                    i < timeShiftInMilliSecondsArray.length;
                    i++
                  ) {
                    state.data.push([]);
                    state.metadata.queries.push({});
                    state.resultMetaData.push({});

                    if (
                      searchRes?.data?.hits &&
                      Array.isArray(searchRes.data.hits[i])
                    ) {
                      state.data[i] = [...(searchRes.data.hits[i] ?? [])];
                    } else {
                      throw new Error(
                        "Invalid response format: Expected an array, but received an object. Please update your function.",
                      );
                    }

                    state.resultMetaData[i] = {
                      ...searchRes.data,
                      hits: searchRes.data.hits[i],
                    };

                    Object.assign(
                      state.metadata.queries[i],
                      timeShiftQueries[i]?.metadata ?? {},
                    );
                  }

                  const annotationList = helpers.shouldFetchAnnotations()
                    ? await refreshAnnotations(
                        startISOTimestamp,
                        endISOTimestamp,
                      )
                    : [];
                  state.annotations = annotationList;

                  await cacheManager.saveCurrentStateToCache();
                } finally {
                  helpers.removeTraceId(traceId);
                }
              } catch (error) {
                helpers.processApiError(error, "sql");
                return { result: null, metadata: null };
              } finally {
                state.loading = false;
              }
            } else {
              // Handle regular queries (non-time-shift)
              const { query: query1, metadata: metadata1 } =
                variableManager.replaceQueryValue(
                  it.query,
                  startISOTimestamp,
                  endISOTimestamp,
                  panelSchema.value.queryType,
                );

              const { query: query2, metadata: metadata2 } =
                await variableManager.applyDynamicVariables(
                  query1,
                  panelSchema.value.queryType,
                );

              const query = query2;

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

              if (variableManager.shouldSkipSearchDueToEmptyVariables()) {
                return;
              }

              state.metadata.queries[panelQueryIndex] = metadata;
              const annotations = helpers.shouldFetchAnnotations()
                ? await refreshAnnotations(
                    Number(startISOTimestamp),
                    Number(endISOTimestamp),
                  )
                : [];
              state.annotations = annotations;

              if (searchResponse?.value?.hits?.length > 0) {
                state.data.push([]);
                state.resultMetaData.push({});

                const currentQueryIndex = state.data.length - 1;

                state.data[currentQueryIndex] = searchResponse.value.hits;
                state.resultMetaData[currentQueryIndex] = searchResponse.value;
                state.loading = false;
                return;
              }

              if (isStreamingEnabled(store.state)) {
                await searchMethods.getDataThroughStreaming(
                  query,
                  it,
                  startISOTimestamp,
                  endISOTimestamp,
                  pageType,
                  panelQueryIndex,
                  abortControllerRef,
                  () => variableManager.shouldSkipSearchDueToEmptyVariables(),
                  () => cacheManager.saveCurrentStateToCache(),
                  {
                    data: (payload: any, response: any) =>
                      responseHandlers.handleSearchResponse(payload, response),
                    error: (payload: any, response: any) =>
                      responseHandlers.handleSearchError(payload, response),
                    complete: (payload: any, response: any) =>
                      responseHandlers.handleSearchClose(payload, response),
                    reset: (payload: any, traceId?: string) =>
                      responseHandlers.handleSearchReset(payload, traceId),
                  },
                );
              } else if (isWebSocketEnabled(store.state)) {
                await searchMethods.getDataThroughWebSocket(
                  query,
                  it,
                  startISOTimestamp,
                  endISOTimestamp,
                  pageType,
                  panelQueryIndex,
                  () => variableManager.shouldSkipSearchDueToEmptyVariables(),
                  {
                    open: sendSearchMessage,
                    close: (payload: any, response: any) =>
                      responseHandlers.handleSearchClose(payload, response),
                    error: (payload: any, response: any) =>
                      responseHandlers.handleSearchError(payload, response),
                    message: (payload: any, response: any) =>
                      responseHandlers.handleSearchResponse(payload, response),
                    reset: (payload: any, traceId?: string) =>
                      responseHandlers.handleSearchReset(payload, traceId),
                  },
                );
              } else {
                await searchMethods.getDataThroughPartitions(
                  query,
                  metadata,
                  it,
                  startISOTimestamp,
                  endISOTimestamp,
                  pageType,
                  abortControllerRef,
                  () => variableManager.shouldSkipSearchDueToEmptyVariables(),
                  () => cacheManager.saveCurrentStateToCache(),
                  (error: any, type: string) =>
                    helpers.processApiError(error, type),
                );
              }

              await cacheManager.saveCurrentStateToCache();
            }
          }

          log("loadData: state.data", state.data);
          log("loadData: state.metadata", state.metadata);
        } finally {
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
        log("loadData: Operation aborted");
      } else {
        log("loadData: An error occurred:", error);
      }
    }
  }

  watch(
    () => [selectedTimeObj?.value, forceLoad?.value],
    async () => {
      log("PanelSchema/Time Watcher: called");
      loadData();
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

  watch(
    () => variablesData?.value?.values,
    () => {
      log("Variables Watcher: starting...");

      const newDependentVariablesData =
        variableManager.getDependentVariablesData();
      const newDynamicVariablesData = variableManager.getDynamicVariablesData();

      if (
        !newDependentVariablesData?.length &&
        !newDynamicVariablesData?.length &&
        !variableManager.getCurrentDependentVariablesData()?.length
      ) {
        log("Variables Watcher: no variables needed, returning false...");
        return;
      }

      if (variableManager.variablesDataUpdated()) {
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
      threshold: 0,
    });

    if (chartPanelRef?.value) observer.observe(chartPanelRef?.value);
  });

  onUnmounted(() => {
    if (abortController) {
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

    if (
      isStreamingEnabled(store.state) &&
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

    if (
      isWebSocketEnabled(store.state) &&
      state.searchRequestTraceIds?.length > 0 &&
      state.loading &&
      !state.isOperationCancelled
    ) {
      try {
        state.searchRequestTraceIds.forEach((traceId) => {
          cancelSearchQueryBasedOnRequestId({
            trace_id: traceId,
            org_id: store?.state?.selectedOrganization?.identifier,
          });
        });
        queryService.delete_running_queries(
          store?.state?.selectedOrganization?.identifier,
          state.searchRequestTraceIds,
        );
      } catch (error) {
        console.error("Error during WebSocket cleanup:", error);
      } finally {
        state.searchRequestTraceIds = [];
      }
    }

    window.removeEventListener("cancelQuery", cancelQueryAbort);
  });

  onMounted(async () => {
    log("PanelSchema/Time Initial: should load the data");
    loadData();
  });

  return {
    ...toRefs(state),
    loadData,
  };
};
