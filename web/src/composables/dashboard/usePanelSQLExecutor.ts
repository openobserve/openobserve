// Copyright 2026 OpenObserve Inc.
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
import { gt } from "@/types/i18n";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { convertOffsetToSeconds } from "@/utils/dashboard/dateTimeUtils";
import logsUtils from "@/composables/useLogs/logsUtils";
import { detectChunkingDirection, mergeHitsChunk } from "@/utils/dashboard/chunkingDirection";
import { ExportCancelledError } from "@/utils/dashboard/tableExport";
import { summarizeQueryDiagnostics } from "@/utils/dashboard/panelDiagnostics";
import { createActivityTimer } from "@/utils/activityTimer";

// ZO_QUERY_TIMEOUT's server default, used while the UI config does not carry the deployment's value.
export const SERVER_QUERY_TIMEOUT_DEFAULT_SECONDS = 600;
const EXPORT_STALL_MARGIN_MS = 30_000;

type ExportRow = Record<string, unknown>;

interface ExportQueryResult {
  hits: ExportRow[];
  partial: boolean;
  /** The query had no stored request, so its on-screen rows stand in for a re-fetch. */
  held: boolean;
}

export interface ExportRowsResult {
  data: ExportRow[][];
  capped: boolean;
  partial: boolean;
  heldIndexes: number[];
  rowLimit: number;
}

interface ExportQueryMeta {
  query: string;
  startTime: number;
  endTime: number;
  panelQueryIndex?: number;
}

interface ExportStreamContent {
  time_offset?: { start_time?: number; end_time?: number };
  is_partial?: boolean;
  function_error?: unknown;
  streaming_aggs?: boolean;
  order_by?: string;
  hits?: ExportRow[];
}

interface ExportStreamResponse {
  type?: string;
  content?: ExportStreamContent & { results?: ExportStreamContent };
}

// resultMetaData holds one entry per partition; the latest one carries the order of the hits now arriving.
const isLastPartitionAsc = (partitions: unknown): boolean =>
  Array.isArray(partitions) &&
  String(
    (partitions.at(-1) as { order_by?: unknown } | undefined)?.order_by ?? "",
  ).toLowerCase() === "asc";

const isExportQueryMeta = (value: unknown): value is ExportQueryMeta =>
  typeof (value as ExportQueryMeta | undefined)?.query === "string" &&
  (value as ExportQueryMeta).query !== "";

const adjustTimestampByTimeRangeGap = (timestamp: number, timeRangeGapSeconds: number) => {
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
  clearHitsBuffer: () => void;
  processApiError: (error: any, type: any) => void;
  saveCurrentStateToCache: () => Promise<void>;
  addTraceId: (traceId: string) => void;
  removeTraceId: (traceId: string) => void;
  shouldFetchAnnotations: () => boolean;
  refreshAnnotations: (start: any, end: any) => Promise<any>;
  log: (...args: any[]) => void;
  getRegionClusterParams: () => Record<string, any>;
  cancelExportStreams?: (traceIds: string[]) => void;
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
    clearHitsBuffer,
    processApiError,
    saveCurrentStateToCache,
    addTraceId,
    removeTraceId,
    shouldFetchAnnotations,
    refreshAnnotations,
    getRegionClusterParams,
    log,
  } = ctx;

  const { checkTimestampAlias } = logsUtils();

  // Send the encoded VRL function only when the query has one; otherwise null.
  const buildQueryFn = (it: any) =>
    it?.vrlFunctionQuery && it.vrlFunctionQuery.trim()
      ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
      : null;

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
      query_fn: buildQueryFn(it),
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
    runToken: number,
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
          ...getRegionClusterParams(),
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

      if (runToken !== sqlRunToken) return;
      // if aborted, return
      if (abortControllerRef?.signal?.aborted) {
        // Set partial data flag on abort
        state.isPartialData = true;
        // Save current state to cache
        saveCurrentStateToCache();
        return;
      }

      fetchQueryDataWithHttpStream(
        payload,
        dropSupersededRunEvents(runToken, {
          data: handleSearchResponse,
          error: handleSearchError,
          complete: handleSearchClose,
          reset: handleSearchReset,
        }),
      );

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

  // Bumped per run; streams fired by a superseded run drop their writes.
  let sqlRunToken = 0;

  // A superseded run's stream keeps flowing; letting it write appends its hits to the new run's data.
  const dropSupersededRunEvents = (
    runToken: number,
    handlers: Record<"data" | "error" | "complete" | "reset", (p: any, r: any) => any>,
  ) => {
    const isCurrentRun = (p: any, freeTraceId: boolean) => {
      if (runToken === sqlRunToken) return true;
      if (freeTraceId) removeTraceId(p?.traceId);
      return false;
    };
    return {
      data: (p: any, r: any) => isCurrentRun(p, false) && handlers.data(p, r),
      error: (p: any, r: any) => isCurrentRun(p, true) && handlers.error(p, r),
      complete: (p: any, r: any) => isCurrentRun(p, true) && handlers.complete(p, r),
      reset: (p: any, r: any) => isCurrentRun(p, false) && handlers.reset(p, r),
    };
  };

  // Isolated 2nd fetch: a UI histogram (is_ui_histogram=true) of the SAME query,
  // used ONLY to draw the metric sparkline. Fully guarded and fire-and-forget —
  // any failure leaves state.sparklineData empty and the metric shows value-only.
  const fetchSparklineHistogram = (
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    pageType: string,
    currentQueryIndex: number,
    abortControllerRef: any,
    runToken: number,
  ) => {
    try {
      if (abortControllerRef?.signal?.aborted || runToken !== sqlRunToken) return;
      const { traceId } = generateTraceContext();
      const hits: any[] = [];
      const payload: any = {
        queryReq: {
          query: {
            sql: query,
            query_fn: buildQueryFn(it),
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            size: -1,
            histogram_interval: undefined,
          },
          ...getRegionClusterParams(),
        },
        type: "histogram",
        isPagination: false,
        traceId,
        org_id: store?.state?.selectedOrganization?.identifier,
        pageType,
        searchType: searchType.value ?? "dashboards",
        meta: {
          currentQueryIndex,
          panel_id: panelSchema.value.id,
          panel_name: panelSchema.value.title,
          is_ui_histogram: true,
        },
        clear_cache: false,
      };
      // Histogram is unavailable for CTE/DISTINCT/UNION/JOIN/LIMIT queries (API
      // code 20013). Surface a non-blocking header warning; the metric value still
      // renders. Other transient errors stay silent. The API delivers this either
      // as a `data` event of type "error" or via the stream `error` callback.
      const captureSparklineError = (content: any) => {
        if (runToken !== sqlRunToken) return;
        if (content?.code === 20013) {
          state.sparklineWarning = content?.error_detail || content?.message || "";
        }
      };
      // Publish the hits accumulated so far. Called on every chunk so the trend
      // streams in (the render watcher tracks sparklineData) instead of appearing
      // once at the end. Dropped if a newer run already reset the state.
      const commitHits = () => {
        if (runToken !== sqlRunToken) return;
        // Reassign the whole array so the render watcher (shallow ref) fires.
        const next = Array.isArray(state.sparklineData) ? state.sparklineData.slice() : [];
        next[currentQueryIndex] = hits.slice();
        state.sparklineData = next;
      };
      // Same contract as handleSearchResponse: (requestPayload, streamResponse).
      // The response is the 2nd arg; the 1st is our own request (type "histogram").
      fetchQueryDataWithHttpStream(payload, {
        data: (_payload: any, response: any) => {
          if (response?.type === "search_response_hits") {
            const h = response?.content?.results?.hits;
            if (Array.isArray(h)) {
              hits.push(...h);
              commitHits();
            }
          } else if (response?.type === "error") {
            captureSparklineError(response?.content);
          }
        },
        error: (_payload: any, wsError: any) => {
          captureSparklineError(wsError?.content);
          removeTraceId(traceId);
        },
        complete: () => {
          commitHits();
          removeTraceId(traceId);
        },
        reset: () => {
          hits.length = 0;
        },
      });
      addTraceId(traceId);
    } catch {
      // best-effort: never block the panel on the sparkline fetch
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
      // Supersede the previous run so its still-flowing streams drop their writes.
      const runToken = ++sqlRunToken;
      clearHitsBuffer();
      state.sparklineData = [];
      state.sparklineWarning = "";
      state.annotations = [];
      state.isOperationCancelled = false;

      // Get the page type from the first query in the panel schema
      const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

      // Handle each query sequentially
      for (const [panelQueryIndex, it] of panelSchema.value.queries.entries()) {
        // Skip empty queries (e.g. a query slot the user hasn't filled in)
        if (!it.query?.trim()) {
          continue;
        }

        state.loading = true;

        if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
          // convert time shift to milliseconds
          const timeShiftInMilliSecondsArray = it.config?.time_shift?.map((it: any) =>
            convertOffsetToSeconds(it.offSet, endISOTimestamp),
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
            const { query: query1, metadata: metadata1 } = replaceQueryValue(
              it.query,
              adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
              adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
              panelSchema.value.queryType,
            );

            const { query: query2, metadata: metadata2 } = await applyDynamicVariables(
              query1,
              panelSchema.value.queryType,
            );
            if (runToken !== sqlRunToken) return;
            const query = query2;

            // Validate that timestamp column is not used as an alias for other fields
            if (!checkTimestampAlias(query)) {
              state.errorDetail = {
                message: gt("dashboard.utils.aliasNotAllowed", {
                  alias: store.state.zoConfig.timestamp_column || "_timestamp",
                }),
                code: "400",
              };
              addTraceId("tempTraceId");
              await nextTick();
              removeTraceId("tempTraceId");
              if (runToken !== sqlRunToken) return;
              state.loading = false;
              // Skip this iteration and continue with next query/time shift
              continue;
            }
            const metadata: any = {
              originalQuery: it.query,
              query: query,
              startTime: adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
              endTime: adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
              queryType: panelSchema.value.queryType,
              variables: [...(metadata1 || []), ...(metadata2 || [])],
              timeRangeGap: timeRangeGap,
              panelQueryIndex: panelQueryIndex,
            };

            // push metadata and searchRequestObj[which will be passed to search API]
            timeShiftQueries.push({
              metadata,
              searchRequestObj: {
                sql: query,
                start_time: adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
                end_time: adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
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
                const annotationList = await refreshAnnotations(startISOTimestamp, endISOTimestamp);
                return annotationList || [];
              } catch (annotationError) {
                console.error("Failed to fetch annotations:", annotationError);
                return [];
              }
            })();

            // get search queries
            const searchQueries = timeShiftQueries.map((it: any) => it.searchRequestObj);

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
              state.metadata.queries.push(timeShiftQueries[i]?.metadata ?? {});
              state.resultMetaData.push([]);
            }

            // Use HTTP2/streaming for multi-query (time-shift) queries
            // Track the current query index being processed
            let currentQueryIndexInStream: number | null = null;
            // Track chunking direction per query index
            const chunkingLeftToRight: Map<number, boolean> = new Map();

            const payload: any = {
              queryReq: {
                query: {
                  sql: searchQueries,
                  query_fn: buildQueryFn(it),
                  start_time: startISOTimestamp,
                  end_time: endISOTimestamp,
                  per_query_response: true,
                  size: -1,
                },
                ...getRegionClusterParams(),
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

            fetchQueryDataWithHttpStream(
              payload,
              dropSupersededRunEvents(runToken, {
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

                    // Detect chunking direction from first metadata entry
                    if (state.resultMetaData[queryIndex].length === 0) {
                      const metaContent = {
                        ...(response?.content ?? {}),
                        ...(response?.content?.results ?? {}),
                      };
                      const direction = detectChunkingDirection(
                        metaContent?.time_offset?.start_time ?? 0,
                        metaContent?.time_offset?.end_time ?? 0,
                        state.metadata?.queries?.[queryIndex]?.startTime ??
                          state.metadata?.queries?.[0]?.startTime ??
                          0,
                        state.metadata?.queries?.[queryIndex]?.endTime ??
                          state.metadata?.queries?.[0]?.endTime ??
                          0,
                      );
                      if (direction !== null) {
                        chunkingLeftToRight.set(queryIndex, direction);
                      }
                    }

                    // Push metadata for each partition
                    state.resultMetaData[queryIndex].push({
                      ...(response?.content ?? {}),
                      ...(response?.content?.results ?? {}),
                    });
                  }

                  if (response.type === "search_response_hits") {
                    // The hits come directly in response.content.hits or response.content.results.hits
                    const hits = response?.content?.results?.hits ?? response?.content?.hits;
                    // Get query_index from results metadata
                    const results = response?.content?.results;

                    // Use query_index from the event, or from the last metadata event, or find next empty
                    let queryIndex = results?.query_index ?? currentQueryIndexInStream;

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
                      state.data[queryIndex] = markRaw(
                        mergeHitsChunk(toRaw(state.data[queryIndex] ?? []), hits, {
                          streamingAggs:
                            state.resultMetaData[queryIndex]?.[0]?.streaming_aggs ?? false,
                          isLTR: chunkingLeftToRight.get(queryIndex) ?? false,
                          orderAsc: isLastPartitionAsc(state.resultMetaData[queryIndex]),
                        }),
                      );

                      if (state.resultMetaData[queryIndex]) {
                        state.resultMetaData[queryIndex].hits = state.data[queryIndex];
                      }
                    }
                    state.errorDetail = { message: "", code: "" };
                    // saveCurrentStateToCache();
                  }

                  if (response.type === "search_response") {
                    // Legacy format: single response with all data
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

                  if (response.type === "event_progress") {
                    state.loadingProgressPercentage = response?.content?.percent ?? 0;
                    state.isPartialData = true;
                  }

                  if (response.type === "end") {
                    state.loading = false;
                    state.isPartialData = false;
                    saveCurrentStateToCache();
                  }
                },
                error: handleSearchError,
                complete: async () => {
                  state.loading = false;
                  state.isPartialData = false;
                  saveCurrentStateToCache();
                  removeTraceId(traceId);
                },
                reset: handleSearchReset,
              }),
            );

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

          const { query: query2, metadata: metadata2 } = await applyDynamicVariables(
            query1,
            panelSchema.value.queryType,
          );
          if (runToken !== sqlRunToken) return;

          const query = query2;

          // Validate that timestamp column is not used as an alias for other fields
          if (!checkTimestampAlias(query)) {
            state.errorDetail = {
              message: gt("dashboard.utils.aliasNotAllowed", {
                alias: store.state.zoConfig.timestamp_column || "_timestamp",
              }),
              code: "400",
            };
            state.loading = false;
            addTraceId("tempTraceId");
            await nextTick();
            removeTraceId("tempTraceId");
            if (runToken !== sqlRunToken) return;
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
            panelQueryIndex: panelQueryIndex,
            tabName: it.tabName,
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

            // Initialize empty slots for this query's data/metadata; both are
            // overwritten below with the actual searchResponse values. Use []
            // to match the streaming/time-shift paths' initialization.
            state.data.push([]);
            state?.resultMetaData?.push([]);

            const currentQueryIndex = state.data.length - 1;

            state.data[currentQueryIndex] = markRaw(searchResponse.value.hits ?? []);
            // In Logs→Visualize path, searchResponse is a single combined chunk
            // (not streaming). Override time_offset with the user's actual
            // selected range so fillMissingValues detects direction / builds
            // fill bounds correctly.
            state.resultMetaData[currentQueryIndex] = [
              {
                ...searchResponse.value,
                time_offset: {
                  start_time: Number(startISOTimestamp),
                  end_time: Number(endISOTimestamp),
                },
              },
            ];

            // Wait for annotations to complete
            if (annotationsPromise) {
              const annotations = await annotationsPromise;
              if (runToken !== sqlRunToken) return;
              state.annotations = annotations;
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
            runToken,
          );

          // Best-effort 2nd fetch for the metric sparkline trend (isolated).
          if (panelSchema.value.type === "metric" && panelSchema.value.config?.sparkline?.enabled) {
            fetchSparklineHistogram(
              query,
              it,
              startISOTimestamp,
              endISOTimestamp,
              pageType,
              panelQueryIndex,
              abortControllerRef,
              runToken,
            );
          }

          // Wait for annotations to complete if they were started
          if (annotationsPromise) {
            state.annotations = await annotationsPromise;
          }
          if (!state.loading) {
            saveCurrentStateToCache();
          }
        }
      }

      // If every query was empty/skipped, no streaming request was fired, so
      // the end/complete handlers won't run — clear loading here to avoid a
      // perpetual loading state.
      if (state.data.length === 0) {
        state.loading = false;
      }

      log("logaData: state.data", state.data);
      log("logaData: state.metadata", state.metadata);
      return;
    } finally {
      // abort on done
      if (abortControllerRef) {
        abortControllerRef?.abort();
      }
    }
  };

  // Multi-query path: uses _search_multi_stream endpoint with batched queries
  const executeMultiSQL = async (
    startISOTimestamp: any,
    endISOTimestamp: any,
    abortControllerRef: any,
    pageType: string,
  ) => {
    // Bumped before the pre-fetch early return so it also supersedes in-flight streams.
    const runToken = ++sqlRunToken;
    clearHitsBuffer();
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

      // Initialize empty slots; data/metadata are overwritten below with the
      // actual searchResponse values. Use [] to match the streaming path.
      state.data.push([]);
      state.resultMetaData.push([]);
      state.metadata.queries.push({ panelQueryIndex: 0 });

      const currentQueryIndex = state.data.length - 1;
      state.data[currentQueryIndex] = markRaw(searchResponse.value.hits ?? []);
      // Override time_offset with the user's actual selected range
      state.resultMetaData[currentQueryIndex] = [
        {
          ...searchResponse.value,
          time_offset: {
            start_time: Number(startISOTimestamp),
            end_time: Number(endISOTimestamp),
          },
        },
      ];

      const annotations = await annotationsPromise;
      if (runToken !== sqlRunToken) return;
      state.annotations = annotations;
      state.loading = false;
      return;
    }

    // Reset state before building new queries (same as executeSQL)
    state.data = [];
    state.metadata = {
      queries: [],
    };
    state.resultMetaData = [];
    state.sparklineData = [];
    state.sparklineWarning = "";
    state.annotations = [];
    state.isOperationCancelled = false;

    // Phase 1: Process all queries and build flat arrays
    const allSearchRequests: any[] = [];
    const allMetadata: any[] = [];

    for (const [panelQueryIndex, it] of panelSchema.value.queries.entries()) {
      // Skip empty queries (e.g. a query slot the user hasn't filled in).
      // allSearchRequests/allMetadata are built sequentially, so skipping
      // here keeps state array indices aligned with the backend query_index.
      if (!it.query?.trim()) {
        continue;
      }

      if (it.config?.time_shift && it.config?.time_shift?.length > 0) {
        // Expand time-shift query into N+1 entries (original + N shifts)
        const timeShiftInMilliSecondsArray = it.config.time_shift.map((ts: any) =>
          convertOffsetToSeconds(ts.offSet, endISOTimestamp),
        );
        timeShiftInMilliSecondsArray.unshift({
          seconds: 0,
          periodAsStr: "",
        });

        for (let i = 0; i < timeShiftInMilliSecondsArray.length; i++) {
          const timeRangeGap = timeShiftInMilliSecondsArray[i];
          const { query: query1, metadata: metadata1 } = replaceQueryValue(
            it.query,
            adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
            adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
            panelSchema.value.queryType,
          );

          const { query: query2, metadata: metadata2 } = await applyDynamicVariables(
            query1,
            panelSchema.value.queryType,
          );
          if (runToken !== sqlRunToken) return;
          const query = query2;

          if (!checkTimestampAlias(query)) {
            state.errorDetail = {
              message: gt("dashboard.utils.aliasNotAllowed", {
                alias: store.state.zoConfig.timestamp_column || "_timestamp",
              }),
              code: "400",
            };
            addTraceId("tempTraceId");
            await nextTick();
            removeTraceId("tempTraceId");
            if (runToken !== sqlRunToken) return;
            state.loading = false;
            continue;
          }

          allSearchRequests.push({
            sql: query,
            start_time: adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
            end_time: adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
            query_fn: buildQueryFn(it),
          });

          allMetadata.push({
            originalQuery: it.query,
            query: query,
            startTime: adjustTimestampByTimeRangeGap(startISOTimestamp, timeRangeGap.seconds),
            endTime: adjustTimestampByTimeRangeGap(endISOTimestamp, timeRangeGap.seconds),
            queryType: panelSchema.value.queryType,
            variables: [...(metadata1 || []), ...(metadata2 || [])],
            timeRangeGap: timeRangeGap,
            panelQueryIndex: panelQueryIndex,
            tabName: it.tabName,
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

        const { query: query2, metadata: metadata2 } = await applyDynamicVariables(
          query1,
          panelSchema.value.queryType,
        );
        if (runToken !== sqlRunToken) return;
        const query = query2;

        if (!checkTimestampAlias(query)) {
          state.errorDetail = {
            message: gt("dashboard.utils.aliasNotAllowed", {
              alias: store.state.zoConfig.timestamp_column || "_timestamp",
            }),
            code: "400",
          };
          state.loading = false;
          addTraceId("tempTraceId");
          await nextTick();
          removeTraceId("tempTraceId");
          if (runToken !== sqlRunToken) return;
          continue;
        }

        allSearchRequests.push({
          sql: query,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
          query_fn: buildQueryFn(it),
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
          panelQueryIndex: panelQueryIndex,
          tabName: it.tabName,
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

    if (panelSchema.value.type === "metric" && panelSchema.value.config?.sparkline?.enabled) {
      for (let i = 0; i < allSearchRequests.length; i++) {
        const it = panelSchema.value.queries[allMetadata[i]?.panelQueryIndex];
        if (!it) continue;
        fetchSparklineHistogram(
          allSearchRequests[i].sql,
          it,
          allSearchRequests[i].start_time,
          allSearchRequests[i].end_time,
          pageType,
          i,
          abortControllerRef,
          runToken,
        );
      }
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
        const annotationList = await refreshAnnotations(startISOTimestamp, endISOTimestamp);
        return annotationList || [];
      } catch (annotationError) {
        console.error("Failed to fetch annotations:", annotationError);
        return [];
      }
    })();

    let currentQueryIndexInStream: number | null = null;
    // Track chunking direction per query index
    const chunkingLeftToRight: Map<number, boolean> = new Map();

    const payload: any = {
      queryReq: {
        query: {
          sql: allSearchRequests,
          per_query_response: true,
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
          size: -1,
        },
        ...getRegionClusterParams(),
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

    fetchQueryDataWithHttpStream(
      payload,
      dropSupersededRunEvents(runToken, {
        data: (_payload: any, response: any) => {
          if (response.type === "search_response_metadata") {
            const results = response?.content?.results;
            const queryIndex = results?.query_index ?? 0;

            currentQueryIndexInStream = queryIndex;

            if (!state.resultMetaData[queryIndex]) {
              state.resultMetaData[queryIndex] = [];
            }

            // Detect chunking direction from first metadata entry
            if (state.resultMetaData[queryIndex].length === 0) {
              const metaContent = {
                ...(response?.content ?? {}),
                ...(response?.content?.results ?? {}),
              };
              const direction = detectChunkingDirection(
                metaContent?.time_offset?.start_time ?? 0,
                metaContent?.time_offset?.end_time ?? 0,
                state.metadata?.queries?.[queryIndex]?.startTime ??
                  state.metadata?.queries?.[0]?.startTime ??
                  0,
                state.metadata?.queries?.[queryIndex]?.endTime ??
                  state.metadata?.queries?.[0]?.endTime ??
                  0,
              );
              if (direction !== null) {
                chunkingLeftToRight.set(queryIndex, direction);
              }
            }

            state.resultMetaData[queryIndex].push({
              ...(response?.content ?? {}),
              ...(response?.content?.results ?? {}),
            });
          }

          if (response.type === "search_response_hits") {
            const hits = response?.content?.results?.hits ?? response?.content?.hits;
            const results = response?.content?.results;

            let queryIndex = results?.query_index ?? currentQueryIndexInStream;

            if (queryIndex === undefined || queryIndex === null) {
              queryIndex = state.resultMetaData.findIndex(
                (_meta: any, idx: number) => !state.data[idx] || state.data[idx].length === 0,
              );
            }

            if (
              queryIndex >= 0 &&
              queryIndex < state.data.length &&
              Array.isArray(hits) &&
              hits.length > 0
            ) {
              state.data[queryIndex] = markRaw(
                mergeHitsChunk(toRaw(state.data[queryIndex] ?? []), hits, {
                  streamingAggs: state.resultMetaData[queryIndex]?.[0]?.streaming_aggs ?? false,
                  isLTR: chunkingLeftToRight.get(queryIndex) ?? false,
                  orderAsc: isLastPartitionAsc(state.resultMetaData[queryIndex]),
                }),
              );

              if (state.resultMetaData[queryIndex]) {
                state.resultMetaData[queryIndex].hits = state.data[queryIndex];
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

          // The multi-query stream already averages progress across its queries server-side.
          if (response.type === "event_progress") {
            state.loadingProgressPercentage = response?.content?.percent ?? 0;
            state.isPartialData = true;
          }

          if (response.type === "end") {
            state.loading = false;
            state.isPartialData = false;
            saveCurrentStateToCache();
          }
        },
        error: handleSearchError,
        complete: async () => {
          state.loading = false;
          state.isPartialData = false;
          saveCurrentStateToCache();
          removeTraceId(traceId);
        },
        reset: handleSearchReset,
      }),
    );

    // Wait for annotations to complete (started in parallel)
    state.annotations = await annotationsPromise;
  };

  // Lets the loader supersede the running stream as soon as it schedules a rerun, not after its debounce.
  const invalidateRun = () => {
    sqlRunToken++;
    clearHitsBuffer();
  };

  // Kept apart from the run's trace ids so a panel refresh does not kill a download.
  const pendingExports = new Map<string, { reject: (reason: Error) => void; stop: () => void }>();

  const cancelExportTraces = (traceIds: string[]): string[] => {
    const cancelled: string[] = [];
    const exports: { reject: (reason: Error) => void; stop: () => void }[] = [];
    for (const traceId of traceIds) {
      const pending = pendingExports.get(traceId);
      if (!pending) continue;
      pendingExports.delete(traceId);
      cancelled.push(traceId);
      exports.push(pending);
    }
    if (cancelled.length) ctx.cancelExportStreams?.(cancelled);
    for (const { reject, stop } of exports) {
      stop();
      reject(new ExportCancelledError());
    }
    return cancelled;
  };

  // Stops and rejects every running export; returns their trace ids for the server-side cleanup.
  const cancelExports = (): string[] => cancelExportTraces([...pendingExports.keys()]);

  const exportStallTimeoutMs = () => {
    const querySeconds = Number(store?.state?.zoConfig?.query_timeout);
    const seconds = querySeconds > 0 ? querySeconds : SERVER_QUERY_TIMEOUT_DEFAULT_SECONDS;
    return seconds * 1000 + EXPORT_STALL_MARGIN_MS;
  };

  // Runs one executed query again with an explicit size; no panel state is touched.
  const streamExportQuery = (
    queryMeta: ExportQueryMeta,
    queryIndex: number,
    rowLimit: number,
    group: string[],
  ) =>
    new Promise<ExportQueryResult>((resolve, reject) => {
      const { traceId } = generateTraceContext();
      let hits: ExportRow[] = [];
      const partitions: ExportStreamContent[] = [];
      let isLTR: boolean | null = null;
      let orderAsc = false;
      let streamingAggs = false;
      const settle = (finish: () => void) => {
        timer.clear();
        if (pendingExports.delete(traceId)) finish();
        hits = [];
      };
      // Progress arrives only per partition, so silence counts as stalled only past the server's own query timeout.
      const timeoutMs = exportStallTimeoutMs();
      const timer = createActivityTimer(
        () =>
          settle(() => {
            reject(new Error("Table export stream timed out"));
            ctx.cancelExportStreams?.([traceId]);
          }),
        timeoutMs,
        timeoutMs,
      );
      const payload = {
        queryReq: {
          query: {
            sql: queryMeta.query,
            query_fn: buildQueryFn(panelSchema.value.queries?.[queryMeta.panelQueryIndex ?? 0]),
            start_time: queryMeta.startTime,
            end_time: queryMeta.endTime,
            size: rowLimit + 1,
          },
          ...getRegionClusterParams(),
        },
        type: "histogram" as const,
        isPagination: false,
        traceId,
        org_id: store?.state?.selectedOrganization?.identifier,
        pageType: panelSchema.value.queries?.[0]?.fields?.stream_type,
        searchType: searchType.value ?? "dashboards",
        meta: {
          currentQueryIndex: queryIndex,
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
          is_ui_histogram: is_ui_histogram?.value,
        },
        clear_cache: false,
      };
      group.push(traceId);
      pendingExports.set(traceId, {
        reject,
        stop: () => {
          timer.clear();
          hits = [];
        },
      });
      fetchQueryDataWithHttpStream(payload, {
        data: (_payload: unknown, response: ExportStreamResponse) => {
          const results = response?.content?.results;
          if (response?.type === "search_response_metadata") {
            const timeOffset = results?.time_offset ?? response.content?.time_offset;
            isLTR ??= detectChunkingDirection(
              timeOffset?.start_time ?? 0,
              timeOffset?.end_time ?? 0,
              queryMeta.startTime,
              queryMeta.endTime,
            );
            streamingAggs = results?.streaming_aggs ?? response.content?.streaming_aggs ?? false;
            orderAsc = (results?.order_by ?? response.content?.order_by)?.toLowerCase() === "asc";
            partitions.push({ ...(response.content ?? {}), ...(results ?? {}) });
          } else if (response?.type === "search_response_hits") {
            hits = mergeHitsChunk(hits, results?.hits ?? [], {
              streamingAggs,
              isLTR: isLTR ?? false,
              orderAsc,
            });
          } else if (response?.type === "error") {
            settle(() => reject(response.content));
          }
        },
        error: (_payload: unknown, error: { content?: unknown } | undefined) =>
          settle(() => reject(error?.content ?? error)),
        complete: () =>
          settle(() => {
            const queryFn = panelSchema.value.queries?.[queryMeta.panelQueryIndex ?? 0];
            const { serverPartial } = summarizeQueryDiagnostics(partitions, {
              queryHasFunction: !!queryFn?.vrlFunctionQuery?.trim(),
            });
            resolve({ hits, partial: serverPartial, held: false });
          }),
        onActivity: () => timer.touch(),
      });
    });

  // Re-fetches the held result with an explicit row bound; hidden queries are skipped, unexecuted ones keep their rows.
  const fetchExportRows = async (
    metadataQueries: unknown[],
    heldData: unknown[],
    rowLimit: number,
    keptIndexes: number[] | null,
  ): Promise<ExportRowsResult> => {
    const isKept = (index: number) => keptIndexes === null || keptIndexes.includes(index);
    // A server whose default limit is above the bound already holds more rows than the bound would fetch.
    const bound = heldData.reduce<number>(
      (most, rows, index) =>
        isKept(index) && Array.isArray(rows) ? Math.max(most, rows.length) : most,
      rowLimit,
    );
    const group: string[] = [];
    try {
      const results = await Promise.all(
        heldData.map((rows, index): Promise<ExportQueryResult> => {
          const held = { hits: [] as ExportRow[], partial: false, held: false };
          if (!isKept(index)) return Promise.resolve(held);
          const queryMeta = metadataQueries?.[index];
          if (!isExportQueryMeta(queryMeta)) {
            if (Array.isArray(rows)) held.hits = toRaw(rows) as ExportRow[];
            return Promise.resolve({ ...held, held: true });
          }
          return streamExportQuery(queryMeta, index, bound, group);
        }),
      );
      // One row past the bound is asked for, so only a longer result means rows were left behind.
      return {
        data: results.map((result) => (result.held ? result.hits : result.hits.slice(0, bound))),
        capped: results.some((result) => !result.held && result.hits.length > bound),
        partial: results.some((result) => result.partial),
        heldIndexes: results.flatMap((result, index) => (result.held ? [index] : [])),
        rowLimit: bound,
      };
    } catch (error) {
      // One failed query fails its own file only; a concurrent download for other inputs keeps running.
      cancelExportTraces(group);
      throw error;
    }
  };

  return { executeSQL, executeMultiSQL, invalidateRun, fetchExportRows, cancelExports };
};
