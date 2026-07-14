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
import { computeStepSeconds } from "@/utils/metrics/metricDefaults";
import { HEATMAP_MAX_COLUMNS } from "@/utils/dashboard/heatmapDefaults";
import { parseSearchError } from "@/utils/query/searchError";

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

          // "0" is not a step — it is the panel schema's way of saying "no step
          // set, let the server decide", and it is what a dashboard panel
          // carries by default. Treating it as an explicit value made it beat
          // the heatmap cap below (the metrics editor's blob has `null` here,
          // which is why the same heatmap was bounded there and unbounded on a
          // dashboard). Normalising it to `undefined` changes nothing else: the
          // fallback at the end sends "0" anyway.
          const explicitStep = (value?: string) => {
            const trimmed = value?.trim();
            return trimmed && trimmed !== "0" ? trimmed : undefined;
          };

          const queryStepValue = explicitStep(it.config?.step_value);
          const panelStepValue = explicitStep(
            panelSchema.value.config?.step_value,
          );

          // A heatmap's cost is COLUMNS x ROWS, and `step: "0"` hands the column
          // count to the backend — which returns ~300 points regardless of
          // range. Against a ~24-bucket histogram that is ~7,000 cells for a
          // full-size panel, and ECharts falls over drawing them. Nothing is
          // gained by it either: you cannot see more columns than the panel has
          // pixels.
          //
          // So a heatmap without an explicit step gets one that bounds the
          // columns. EVERY heatmap, not only the Prometheus-histogram mode that
          // prompted this: the argument is about pixels, not about buckets, so
          // it holds for a `sum by (pod)` heatmap just as well, and a rule that
          // applied to one chart and not another would be a rule nobody could
          // predict. A saved panel therefore redraws at up to 120 columns rather
          // than ~300 — coarser, but only in a dimension the panel was never
          // wide enough to show. An explicit `step_value` still wins.
          //
          // Same helper the Metrics Explorer cards use (a coarse step is why the
          // same metric renders fine on a card and kills the editor), so the two
          // cannot drift.
          const isHeatmap = panelSchema.value?.type === "heatmap";
          const heatmapStepValue =
            isHeatmap && !queryStepValue && !panelStepValue
              ? `${computeStepSeconds(
                  // MILLISECONDS. `usePanelDataLoader` builds these with
                  // `new Date(...).getTime()` (:408), and only the request payload
                  // converts to the microseconds the backend wants — these raw
                  // values never are. Dividing by 1e6 made the range look ~1000x
                  // shorter, so the step collapsed to MIN_STEP_SECONDS and the cap
                  // silently inverted: 15s columns at ANY range. A 24h heatmap asked
                  // for 5,760 columns instead of 120 — worse than no cap at all,
                  // because the backend's own default would have returned ~300.
                  (endISOTimestamp - startISOTimestamp) / 1000,
                  HEATMAP_MAX_COLUMNS,
                )}s`
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
                  : (heatmapStepValue ?? "0"),
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

            // Through the shared reader. The backend hands back its internal
            // envelope ("Error during planning: ErrorCode# {...}") rather than a
            // sentence, and reading `content.message` raw is what put that in
            // front of users. This is the path a dashboard actually takes —
            // `usePanelDataLoader.processApiError` handles the axios path and is
            // never called for a streaming query, so unwrapping there alone left
            // the envelope on screen exactly where it is most often seen.
            const parsed = parseSearchError(err, "Unknown error");

            state.errorDetail = {
              message: parsed.message,
              code: parsed.code ?? "",
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
