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

import { markRaw, toRaw, nextTick } from "vue";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { convertOffsetToSeconds } from "@/utils/dashboard/dateTimeUtils";
import logsUtils from "@/composables/useLogs/logsUtils";

const adjustTimestampByTimeRangeGap = (
  timestamp: number,
  timeRangeGapSeconds: number,
) => {
  return timestamp - timeRangeGapSeconds * 1000;
};

export const usePanelSQLExecutor = (ctx: {
  state: any;
  panelSchema: any;
  store: any;
  searchType: any;
  searchResponse?: any;
  is_ui_histogram?: any;
  shouldRefreshWithoutCache?: any;
  dashboardId?: any;
  dashboardName?: any;
  folderId?: any;
  folderName?: any;
  runId?: any;
  tabId?: any;
  tabName?: any;
  replaceQueryValue: any;
  applyDynamicVariables: any;
  fetchQueryDataWithHttpStream: any;
  handleSearchResponse: any;
  handleSearchClose: any;
  handleSearchError: any;
  handleSearchReset: any;
  processApiError: (error: any, type: any) => void;
  saveCurrentStateToCache: () => Promise<void>;
  addTraceId: (traceId: string) => void;
  removeTraceId: (traceId: string) => void;
  shouldFetchAnnotations: () => boolean;
  refreshAnnotations: (start: any, end: any) => Promise<any>;
  log: (...args: any[]) => void;
}) => {
  const {
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
  } = ctx;

  const { checkTimestampAlias } = logsUtils();

  const getFallbackOrderByCol = () => {
    // from panelSchema, get first x axis field alias
    if (panelSchema?.value?.queries?.[0]?.fields?.x) {
      return panelSchema.value?.queries[0]?.fields?.x?.[0]?.alias ?? null;
    }
    return null;
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

      // if aborted, return
      if (abortControllerRef?.signal?.aborted) {
        // Set partial data flag on abort
        state.isPartialData = true;
        // Save current state to cache
        saveCurrentStateToCache();
        return;
      }

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

  const executeSQL = async (
    startISOTimestamp: any,
    endISOTimestamp: any,
    abortControllerRef: any,
  ) => {
    try {
      // Reset state
      state.data = [];
      state.metadata = {
        queries: [],
      };
      state.resultMetaData = [];
      state.annotations = [];
      state.isOperationCancelled = false;

      // Get the page type from the first query in the panel schema
      const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

      // Determine if we need the multi-query batch path
      const queries = panelSchema.value.queries;
      const hasTimeShift = queries.some(
        (q: any) => q.config?.time_shift && q.config.time_shift.length > 0,
      );
      const isMultiQuery = queries.length > 1 || hasTimeShift;

      if (isMultiQuery) {
        await executeMultiSQL(
          startISOTimestamp,
          endISOTimestamp,
          abortControllerRef,
          pageType,
        );
      } else {
        await executeSingleSQL(
          startISOTimestamp,
          endISOTimestamp,
          abortControllerRef,
          pageType,
        );
      }

      log("logaData: state.data", state.data);
      log("logaData: state.metadata", state.metadata);
    } finally {
      // abort on done
      if (abortControllerRef) {
        abortControllerRef?.abort();
      }
    }
  };

  // Single query path: uses _search_stream endpoint with standard handlers
  const executeSingleSQL = async (
    startISOTimestamp: any,
    endISOTimestamp: any,
    abortControllerRef: any,
    pageType: string,
  ) => {
    const it = panelSchema.value.queries[0];
    const panelQueryIndex = 0;

    state.loading = true;

    const { query: query1, metadata: metadata1 } = replaceQueryValue(
      it.query,
      startISOTimestamp,
      endISOTimestamp,
      panelSchema.value.queryType,
    );

    const { query: query2, metadata: metadata2 } =
      await applyDynamicVariables(query1, panelSchema.value.queryType);
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
      // Skip executing this query
      return;
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

      state.data[currentQueryIndex] = markRaw(
        searchResponse.value.hits ?? [],
      );
      state.resultMetaData[currentQueryIndex] = [searchResponse.value]; // Wrap in array

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
        console.error("Failed to fetch annotations:", annotationError);
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
    if (!state.loading) {
      saveCurrentStateToCache();
    }
  };

  // Multi-query path: uses _search_multi_stream endpoint with batched queries
  const executeMultiSQL = async (
    startISOTimestamp: any,
    endISOTimestamp: any,
    abortControllerRef: any,
    pageType: string,
  ) => {
    // Handle searchResponse pre-fetch early return
    if (searchResponse?.value?.hits?.length > 0) {
      state.loading = true;

      const annotationsPromise = (async () => {
        try {
          if (!shouldFetchAnnotations()) return [];
          const annotationList = await refreshAnnotations(
            Number(startISOTimestamp),
            Number(endISOTimestamp),
          );
          return annotationList || [];
        } catch {
          return [];
        }
      })();

      state.data.push([]);
      state.resultMetaData.push([{}]);

      const currentQueryIndex = state.data.length - 1;
      state.data[currentQueryIndex] = markRaw(
        searchResponse.value.hits ?? [],
      );
      state.resultMetaData[currentQueryIndex] = [searchResponse.value];

      state.annotations = await annotationsPromise;
      state.loading = false;
      return;
    }

    // Phase 1: Process all queries and build flat arrays
    const allSearchRequests: any[] = [];
    const allMetadata: any[] = [];

    for (const [, it] of panelSchema.value.queries.entries()) {
      if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
        // Expand time-shift query into N+1 entries (original + N shifts)
        const timeShiftInMilliSecondsArray = it.config.time_shift.map(
          (ts: any) => convertOffsetToSeconds(ts.offSet, endISOTimestamp),
        );
        timeShiftInMilliSecondsArray.unshift({
          seconds: 0,
          periodAsStr: "",
        });

        for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
          const timeRangeGap = timeShiftInMilliSecondsArray[i];
          const { query: query1, metadata: metadata1 } = replaceQueryValue(
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
            await applyDynamicVariables(query1, panelSchema.value.queryType);
          const query = query2;

          if (!checkTimestampAlias(query)) {
            state.errorDetail = {
              message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
              code: "400",
            };
            addTraceId("tempTraceId");
            await nextTick();
            removeTraceId("tempTraceId");
            state.loading = false;
            continue;
          }

          allSearchRequests.push({
            sql: query,
            start_time: adjustTimestampByTimeRangeGap(
              startISOTimestamp,
              timeRangeGap.seconds,
            ),
            end_time: adjustTimestampByTimeRangeGap(
              endISOTimestamp,
              timeRangeGap.seconds,
            ),
            query_fn: it.vrlFunctionQuery
              ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
              : null,
          });

          allMetadata.push({
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
          });
        }
      } else {
        // Non-time-shift query: 1 entry
        const { query: query1, metadata: metadata1 } = replaceQueryValue(
          it.query,
          startISOTimestamp,
          endISOTimestamp,
          panelSchema.value.queryType,
        );

        const { query: query2, metadata: metadata2 } =
          await applyDynamicVariables(query1, panelSchema.value.queryType);
        const query = query2;

        if (!checkTimestampAlias(query)) {
          state.errorDetail = {
            message: `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
            code: "400",
          };
          state.loading = false;
          addTraceId("tempTraceId");
          await nextTick();
          removeTraceId("tempTraceId");
          continue;
        }

        allSearchRequests.push({
          sql: query,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
          query_fn: it.vrlFunctionQuery
            ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
            : null,
        });

        allMetadata.push({
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
        });
      }
    }

    // If all queries failed validation, return early
    if (allSearchRequests.length === 0) {
      state.loading = false;
      return;
    }

    // Phase 2: Initialize state arrays for all queries
    for (let i = 0; i < allSearchRequests.length; i++) {
      state.data.push([]);
      state.metadata.queries.push(allMetadata[i]);
      state.resultMetaData.push([]);
    }

    // Phase 3: Send single multi-stream call
    const { traceId } = generateTraceContext();
    addTraceId(traceId);

    if (abortControllerRef?.signal?.aborted) {
      state.isPartialData = true;
      saveCurrentStateToCache();
      return;
    }

    state.loading = true;

    // Start fetching annotations in parallel
    const annotationsPromise = (async () => {
      try {
        if (!shouldFetchAnnotations()) return [];
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

    let currentQueryIndexInStream: number | null = null;

    const payload: any = {
      queryReq: {
        query: {
          sql: allSearchRequests,
          per_query_response: true,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
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
      },
    };

    fetchQueryDataWithHttpStream(payload, {
      data: (_payload: any, response: any) => {
        if (response.type === "search_response_metadata") {
          const results = response?.content?.results;
          const queryIndex = results?.query_index ?? 0;

          currentQueryIndexInStream = queryIndex;

          if (!state.resultMetaData[queryIndex]) {
            state.resultMetaData[queryIndex] = [];
          }

          state.resultMetaData[queryIndex].push({
            ...(response?.content ?? {}),
            ...(response?.content?.results ?? {}),
          });
        }

        if (response.type === "search_response_hits") {
          const hits =
            response?.content?.results?.hits ?? response?.content?.hits;
          const results = response?.content?.results;

          let queryIndex =
            results?.query_index ?? currentQueryIndexInStream;

          if (queryIndex === undefined || queryIndex === null) {
            queryIndex = state.resultMetaData.findIndex(
              (_meta: any, idx: number) =>
                !state.data[idx] || state.data[idx].length === 0,
            );
          }

          if (
            queryIndex >= 0 &&
            queryIndex < state.data.length &&
            Array.isArray(hits) &&
            hits.length > 0
          ) {
            const streaming_aggs =
              state.resultMetaData[queryIndex]?.[0]?.streaming_aggs ??
              false;

            if (streaming_aggs) {
              state.data[queryIndex] = markRaw([...hits]);
            } else {
              const orderBy =
                state.resultMetaData[
                  queryIndex
                ]?.order_by?.toLowerCase();

              if (orderBy === "asc") {
                state.data[queryIndex] = markRaw([
                  ...hits,
                  ...toRaw(state.data[queryIndex] ?? []),
                ]);
              } else {
                state.data[queryIndex] = markRaw([
                  ...toRaw(state.data[queryIndex] ?? []),
                  ...hits,
                ]);
              }
            }

            if (state.resultMetaData[queryIndex]) {
              state.resultMetaData[queryIndex].hits =
                state.data[queryIndex];
            }
          }
          state.errorDetail = { message: "", code: "" };
        }

        if (response.type === "search_response") {
          const results = response?.content?.results;
          const queryIndex = results?.query_index ?? 0;

          if (results?.hits && Array.isArray(results.hits)) {
            state.data[queryIndex] = markRaw([...results.hits]);
            state.resultMetaData[queryIndex] = {
              ...(state.resultMetaData[queryIndex] ?? {}),
              ...results,
            };
          }
          state.errorDetail = { message: "", code: "" };
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
      complete: async (_payload: any) => {
        state.loading = false;
        saveCurrentStateToCache();
        removeTraceId(traceId);
      },
      reset: handleSearchReset,
    });

    // Wait for annotations to complete (started in parallel)
    state.annotations = await annotationsPromise;
  };

  return { executeSQL };
};
