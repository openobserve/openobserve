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

import queryService from "@/services/search";
import { useStore } from "vuex";
import {
  b64EncodeUnicode,
  generateTraceContext,
  isWebSocketEnabled,
  isStreamingEnabled,
} from "@/utils/zincutils";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useHttpStreamingSearch from "../../useStreamingSearch";
import type { PanelState, SearchPayload, ResponseHandlers } from "./types";

export class SearchMethods {
  private store = useStore();

  constructor(
    private state: PanelState,
    private panelSchema: any,
    private dashboardId: any,
    private folderId: any,
    private runId: any,
    private tabId: any,
    private tabName: any,
    private searchType: any,
    private is_ui_histogram: any,
    private addTraceId: (traceId: string) => void,
    private removeTraceId: (traceId: string) => void,
  ) {}

  getHistogramSearchRequest(
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    histogramInterval: number | null | undefined,
  ) {
    return {
      sql: query,
      query_fn: it.vrlFunctionQuery
        ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
        : null,
      start_time: startISOTimestamp,
      end_time: endISOTimestamp,
      size: -1,
      histogram_interval: histogramInterval ?? undefined,
    };
  }

  getFallbackOrderByCol() {
    if (this.panelSchema?.value?.queries?.[0]?.fields?.x) {
      return this.panelSchema.value?.queries[0]?.fields?.x?.[0]?.alias ?? null;
    }
    return null;
  }

  async callWithAbortController<T>(
    fn: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const result = fn();

      signal.addEventListener("abort", () => {
        reject();
      });

      result
        .then((res) => {
          resolve(res);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  async getDataThroughPartitions(
    query: string,
    metadata: any,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    pageType: string,
    abortControllerRef: AbortController,
    shouldSkipSearchDueToEmptyVariables: () => boolean,
    saveCurrentStateToCache: () => Promise<void>,
    processApiError: (error: any, type: string) => void,
  ) {
    const { traceparent, traceId } = generateTraceContext();
    this.addTraceId(traceId);

    this.state.loadingTotal = 0;
    this.state.loadingCompleted = 0;
    this.state.loadingProgressPercentage = 0;

    try {
      const res: any = await this.callWithAbortController(
        async () =>
          queryService.partition({
            org_identifier: this.store.state.selectedOrganization.identifier,
            query: {
              sql: this.store.state.zoConfig.sql_base64_enabled
                ? b64EncodeUnicode(query)
                : query,
              ...(this.store.state.zoConfig.sql_base64_enabled
                ? { encoding: "base64" }
                : {}),
              query_fn: it.vrlFunctionQuery
                ? b64EncodeUnicode(it.vrlFunctionQuery.trim())
                : null,
              start_time: startISOTimestamp,
              end_time: endISOTimestamp,
              size: -1,
              streaming_output: true,
            },
            page_type: pageType,
            traceparent,
            enable_align_histogram: this.is_ui_histogram.value ?? false,
          }),
        abortControllerRef.signal,
      );

      if (shouldSkipSearchDueToEmptyVariables()) {
        return;
      }

      if (abortControllerRef?.signal?.aborted) {
        this.state.isPartialData = true;
        await saveCurrentStateToCache();
        return;
      }

      const order_by = res?.data?.order_by ?? "asc";
      const partitionArr = res?.data?.partitions ?? [];
      const totalSteps = partitionArr.length;
      
      this.state.loadingTotal = totalSteps;
      this.state.loadingCompleted = 0;
      this.state.loadingProgressPercentage = 0;

      partitionArr.sort((a: any, b: any) => a[0] - b[0]);

      const max_query_range = res?.data?.max_query_range ?? 0;
      const histogramInterval = res?.data?.histogram_interval ?? undefined;

      this.state.data.push([]);
      this.state.resultMetaData.push({});

      const currentQueryIndex = this.state.data.length - 1;
      let remainingQueryRange = max_query_range;

      for (let i = partitionArr.length - 1; i >= 0; i--) {
        this.state.loading = true;
        const partition = partitionArr[i];

        if (abortControllerRef?.signal?.aborted) {
          break;
        }

        const { traceparent, traceId } = generateTraceContext();
        this.addTraceId(traceId);

        try {
          const searchRes = await this.callWithAbortController(
            async () =>
              await queryService.search(
                {
                  org_identifier: this.store.state.selectedOrganization.identifier,
                  query: {
                    query: {
                      ...this.getHistogramSearchRequest(
                        query,
                        it,
                        partition[0],
                        partition[1],
                        histogramInterval,
                      ),
                      streaming_output: res?.data?.streaming_aggs ?? false,
                      streaming_id: res?.data?.streaming_id ?? null,
                    },
                    ...(this.store.state.zoConfig.sql_base64_enabled
                      ? { encoding: "base64" }
                      : {}),
                  },
                  page_type: pageType,
                  traceparent,
                  dashboard_id: this.dashboardId?.value,
                  folder_id: this.folderId?.value,
                  panel_id: this.panelSchema.value.id,
                  panel_name: this.panelSchema.value.title,
                  run_id: this.runId?.value,
                  tab_id: this.tabId?.value,
                  tab_name: this.tabName?.value,
                  is_ui_histogram: this.is_ui_histogram.value,
                },
                this.searchType.value ?? "dashboards",
              ),
            abortControllerRef.signal,
          );

          this.state.loadingCompleted = this.state.loadingCompleted + 1;
          this.state.loadingProgressPercentage = Math.round(
            (this.state.loadingCompleted / totalSteps) * 100,
          );

          this.state.errorDetail = {
            message: "",
            code: "",
          };

          if (abortControllerRef?.signal?.aborted) {
            break;
          }

          if (res?.data?.streaming_aggs) {
            this.state.data[currentQueryIndex] = [...searchRes.data.hits];
          } else if (order_by.toLowerCase() === "desc") {
            this.state.data[currentQueryIndex] = [
              ...(this.state.data[currentQueryIndex] ?? []),
              ...searchRes.data.hits,
            ];
          } else {
            this.state.data[currentQueryIndex] = [
              ...searchRes.data.hits,
              ...(this.state.data[currentQueryIndex] ?? []),
            ];
          }

          this.state.resultMetaData[currentQueryIndex] = searchRes.data ?? {};

          if (searchRes.data.is_partial == true) {
            this.state.resultMetaData[currentQueryIndex].new_end_time =
              endISOTimestamp;
            await saveCurrentStateToCache();
            break;
          }

          if (max_query_range != 0) {
            const timeRange = (partition[1] - partition[0]) / 3600000000;
            const resultCacheRatio = searchRes.data.result_cache_ratio ?? 0;
            const queriedTimeRange =
              timeRange * ((100 - resultCacheRatio) / 100);

            remainingQueryRange = remainingQueryRange - queriedTimeRange;

            if (remainingQueryRange < 0 && i != 0) {
              this.state.resultMetaData[currentQueryIndex].is_partial = true;
              this.state.resultMetaData[currentQueryIndex].function_error =
                `Query duration is modified due to query range restriction of ${max_query_range} hours`;
              this.state.resultMetaData[currentQueryIndex].new_end_time =
                endISOTimestamp;
              this.state.resultMetaData[currentQueryIndex].new_start_time =
                partition[0];
              await saveCurrentStateToCache();
              break;
            }
          }
        } finally {
          this.removeTraceId(traceId);
        }

        if (i == 0) {
          await saveCurrentStateToCache();
        }
      }
    } catch (error) {
      processApiError(error, "sql");
      return { result: null, metadata: metadata };
    } finally {
      this.state.loading = false;
      this.removeTraceId(traceId);
    }
  }

  async getDataThroughWebSocket(
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    pageType: string,
    currentQueryIndex: number,
    shouldSkipSearchDueToEmptyVariables: () => boolean,
    responseHandlers: ResponseHandlers,
  ) {
    try {
      const { traceId } = generateTraceContext();
      this.addTraceId(traceId);

      const payload: SearchPayload = {
        queryReq: {
          query,
          it,
          startISOTimestamp,
          endISOTimestamp,
          currentQueryIndex,
          ...(this.store.state.zoConfig.sql_base64_enabled
            ? { encoding: "base64" }
            : {}),
        },
        type: "histogram",
        isPagination: false,
        traceId,
        org_id: this.store?.state?.selectedOrganization?.identifier,
        pageType,
        meta: {
          currentQueryIndex,
          panel_id: this.panelSchema.value.id,
          panel_name: this.panelSchema.value.title,
          run_id: this.runId?.value,
          tab_id: this.tabId?.value,
          tab_name: this.tabName?.value,
        },
      };

      if (shouldSkipSearchDueToEmptyVariables()) {
        return;
      }

      const { fetchQueryDataWithWebSocket } = useSearchWebSocket();
      fetchQueryDataWithWebSocket(payload, responseHandlers);

      this.addTraceId(traceId);
    } catch (e: any) {
      this.state.errorDetail = {
        message: e?.message || e,
        code: e?.code ?? "",
      };
      this.state.loading = false;
      this.state.isOperationCancelled = false;
    }
  }

  async getDataThroughStreaming(
    query: string,
    it: any,
    startISOTimestamp: string,
    endISOTimestamp: string,
    pageType: string,
    currentQueryIndex: number,
    abortControllerRef: any,
    shouldSkipSearchDueToEmptyVariables: () => boolean,
    saveCurrentStateToCache: () => Promise<void>,
    responseHandlers: ResponseHandlers,
  ) {
    try {
      const { traceId } = generateTraceContext();

      const payload: SearchPayload = {
        queryReq: {
          query: {
            ...this.getHistogramSearchRequest(
              query,
              it,
              startISOTimestamp,
              endISOTimestamp,
              null,
            ),
          },
        },
        type: "histogram",
        isPagination: false,
        traceId,
        org_id: this.store?.state?.selectedOrganization?.identifier,
        pageType,
        searchType: this.searchType.value ?? "dashboards",
        meta: {
          currentQueryIndex,
          dashboard_id: this.dashboardId?.value,
          folder_id: this.folderId?.value,
          panel_id: this.panelSchema.value.id,
          panel_name: this.panelSchema.value.title,
          run_id: this.runId?.value,
          tab_id: this.tabId?.value,
          tab_name: this.tabName?.value,
          fallback_order_by_col: this.getFallbackOrderByCol(),
          is_ui_histogram: this.is_ui_histogram.value,
        },
      };

      if (abortControllerRef?.signal?.aborted) {
        this.state.isPartialData = true;
        await saveCurrentStateToCache();
        return;
      }

      if (shouldSkipSearchDueToEmptyVariables()) {
        return;
      }

      const { fetchQueryDataWithHttpStream } = useHttpStreamingSearch();
      fetchQueryDataWithHttpStream(payload, responseHandlers);

      this.addTraceId(traceId);
    } catch (e: any) {
      this.state.errorDetail = {
        message: e?.message || e,
        code: e?.code ?? "",
      };
      this.state.loading = false;
      this.state.isOperationCancelled = false;
    }
  }
}
