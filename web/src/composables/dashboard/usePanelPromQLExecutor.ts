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

import { markRaw } from "vue";
import { generateTraceContext } from "@/utils/zincutils";
import { createPromQLChunkProcessor } from "./promqlChunkProcessor";

export const usePanelPromQLExecutor = (ctx: {
  state: any;
  panelSchema: any;
  store: any;
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
  shouldFetchAnnotations: () => boolean;
  refreshAnnotations: (start: any, end: any) => Promise<any>;
  saveCurrentStateToCache: () => Promise<void>;
  addTraceId: (traceId: string) => void;
  removeTraceId: (traceId: string) => void;
}) => {
  const {
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
  } = ctx;

  const executePromQL = async (
    startISOTimestamp: any,
    endISOTimestamp: any,
    abortControllerRef: any,
  ) => {
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
            await applyDynamicVariables(query1, panelSchema.value.queryType);

          const query = query2;
          const metadata = {
            originalQuery: it.query,
            query: query,
            startTime: startISOTimestamp,
            endTime: endISOTimestamp,
            queryType: panelSchema.value.queryType,
            variables: [...(metadata1 || []), ...(metadata2 || [])],
            tabName: it.tabName,
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
            }
            if (res?.type === "promql_metadata") {
              // Store PromQL metadata (step in µs, trace_id, etc.)
              if (!state.resultMetaData[queryIndex]) {
                state.resultMetaData[queryIndex] = [];
              }
              state.resultMetaData[queryIndex][0] = {
                ...(state.resultMetaData[queryIndex]?.[0] ?? {}),
                ...res.content,
              };
            }
            if (res?.type === "promql_response") {
              const newData = res?.content?.results;

              // Process chunk using extracted processor module
              queryResults[queryIndex] = chunkProcessor.processChunk(
                queryResults[queryIndex],
                newData,
              );

              // Update state with accumulated results
              state.data = markRaw([...queryResults]);
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
              err?.content?.message || err?.content?.error || "Unknown error";
            const errorCode = err?.content?.code || "";

            state.errorDetail = {
              message: errorMessage,
              code: errorCode,
            };

            removeTraceId(traceId);

            // Only mark loading as complete when ALL queries are done
            if (completedQueries.size === panelSchema.value.queries.length) {
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
            state.data = markRaw([...queryResults]);
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
            if (completedQueries.size === panelSchema.value.queries.length) {
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
  };

  return { executePromQL };
};
