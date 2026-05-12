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

import { toRaw, markRaw } from "vue";
import {
  detectChunkingDirection,
  shouldPrependChunk,
} from "@/utils/dashboard/chunkingDirection";

/**
 * Composable that encapsulates all streaming search response event handlers
 * for histogram / SQL panel queries.
 *
 * All handlers receive `state` by reference (it is the same reactive object
 * created in usePanelDataLoader) so mutations here are equivalent to
 * mutations in the original closure ΓÇö no behavioural change.
 */
export const usePanelSearchHandlers = ({
  state,
  processApiError,
  saveCurrentStateToCache,
  loadData,
  removeTraceId,
}: {
  state: any;
  processApiError: (error: any, type: any) => void;
  saveCurrentStateToCache: () => void;
  loadData: () => void;
  removeTraceId: (traceId: string) => void;
}) => {
  // Track chunking direction per query index.
  // LTR: first chunk starts at user's start → data arrives left-to-right.
  // RTL: first chunk ends at user's end → data arrives right-to-left.
  const chunkingLeftToRight: Map<number, boolean> = new Map();

  // Microtask-based hit batching: buffers search_response_hits per query
  // and flushes in a single state.data mutation via queueMicrotask.
  // When the worker sends batched events in one postMessage, multiple hits
  // are dispatched in the same macrotask, and queueMicrotask coalesces them.
  const hitsBuffer: Map<
    number,
    { hits: any[][]; streamingAggs: boolean; orderAsc: boolean; isLTR: boolean }
  > = new Map();
  let flushScheduled = false;
  let pendingProgressPercent: number | null = null;

  function scheduleFlush() {
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushHitsBuffer);
    }
  }

  function flushHitsBuffer() {
    flushScheduled = false;

    for (const [queryIndex, buffer] of hitsBuffer) {
      if (buffer.hits.length === 0) continue;

      if (buffer.streamingAggs) {
        // streaming_aggs mode: data is replaced, use only the last batch
        const lastBatch = buffer.hits[buffer.hits.length - 1];
        if (lastBatch.length > 0) {
          state.data[queryIndex] = markRaw([...lastBatch]);
        }
      } else {
        // Combine all buffered hit arrays into one flat array
        const allNewHits: any[] = [];
        for (const batch of buffer.hits) {
          for (const hit of batch) {
            allNewHits.push(hit);
          }
        }

        const shouldPrepend = shouldPrependChunk(buffer.isLTR, buffer.orderAsc);

        if (shouldPrepend) {
          state.data[queryIndex] = markRaw([
            ...allNewHits,
            ...toRaw(state.data[queryIndex] ?? []),
          ]);
        } else {
          state.data[queryIndex] = markRaw([
            ...toRaw(state.data[queryIndex] ?? []),
            ...allNewHits,
          ]);
        }
      }

      buffer.hits.length = 0; // clear buffer after flush
    }

    if (pendingProgressPercent !== null) {
      state.loadingProgressPercentage = pendingProgressPercent;
      state.isPartialData = true;
      pendingProgressPercent = null;
    }
  }

  function clearHitsBuffer() {
    hitsBuffer.clear();
    chunkingLeftToRight.clear();
    flushScheduled = false;
    pendingProgressPercent = null;
  }

  // Low-level streaming event handlers

  const handleHistogramResponse = async (payload: any, searchRes: any) => {
    // remove past error detail
    state.errorDetail = {
      message: "",
      code: "",
    };

    // is streaming aggs
    const streaming_aggs = searchRes?.content?.streaming_aggs ?? false;

    const queryIndex = payload?.meta?.currentQueryIndex;

    // Initialize data array if not exists
    if (!state.data[queryIndex]) {
      state.data[queryIndex] = [];
    }

    // Detect chunking direction on first chunk for this query
    if (
      !state.resultMetaData[queryIndex] ||
      state.resultMetaData[queryIndex].length === 0
    ) {
      // time_offset may be at content.results.time_offset (search_response)
      // or at content.time_offset (search_response_metadata format)
      const direction = detectChunkingDirection(
        searchRes?.content?.results?.time_offset?.start_time ??
          searchRes?.content?.time_offset?.start_time ??
          0,
        searchRes?.content?.results?.time_offset?.end_time ??
          searchRes?.content?.time_offset?.end_time ??
          0,
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

    const isLTR = chunkingLeftToRight.get(queryIndex) ?? false;
    const orderAsc =
      searchRes?.content?.results?.order_by?.toLowerCase() === "asc";
    const shouldPrepend = shouldPrependChunk(isLTR, orderAsc);

    // if streaming aggs, replace the state data
    if (streaming_aggs) {
      state.data[queryIndex] = markRaw([
        ...(searchRes?.content?.results?.hits ?? {}),
      ]);
    } else if (shouldPrepend) {
      state.data[queryIndex] = markRaw([
        ...(searchRes?.content?.results?.hits ?? {}),
        ...toRaw(state.data[queryIndex] ?? []),
      ]);
    } else {
      state.data[queryIndex] = markRaw([
        ...toRaw(state.data[queryIndex] ?? []),
        ...(searchRes?.content?.results?.hits ?? {}),
      ]);
    }

    // Push metadata for each partition
    state.resultMetaData[queryIndex].push(searchRes?.content?.results ?? {});

    // If we have data and loading is complete, set isPartialData to false
    if (state.data[queryIndex]?.length > 0 && !state.loading) {
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

    // Detect chunking direction from the first metadata entry for this query
    if (state.resultMetaData[currentQueryIndex].length === 0) {
      const metaContent = {
        ...(searchRes?.content ?? {}),
        ...(searchRes?.content?.results ?? {}),
      };
      const direction = detectChunkingDirection(
        metaContent?.time_offset?.start_time ?? 0,
        metaContent?.time_offset?.end_time ?? 0,
        state.metadata?.queries?.[currentQueryIndex]?.startTime ??
          state.metadata?.queries?.[0]?.startTime ??
          0,
        state.metadata?.queries?.[currentQueryIndex]?.endTime ??
          state.metadata?.queries?.[0]?.endTime ??
          0,
      );
      if (direction !== null) {
        chunkingLeftToRight.set(currentQueryIndex, direction);
      }
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

    const queryIndex = payload?.meta?.currentQueryIndex;

    // Initialize data array if not exists
    if (!state.data[queryIndex]) {
      state.data[queryIndex] = [];
    }

    const lastPartitionIndex = Math.max(
      state?.resultMetaData?.[queryIndex]?.length - 1,
      0,
    );
    // is streaming aggs
    const streaming_aggs =
      state?.resultMetaData?.[queryIndex]?.[lastPartitionIndex]
        ?.streaming_aggs ?? false;
    const orderAsc =
      state?.resultMetaData?.[queryIndex]?.[lastPartitionIndex]
        ?.order_by?.toLowerCase() === "asc";

    const hits = searchRes?.content?.results?.hits ?? [];

    // update result metadata - update the first partition result
    if (state.resultMetaData[queryIndex]?.[lastPartitionIndex]) {
      state.resultMetaData[queryIndex][lastPartitionIndex].hits = hits;
    }

    // Buffer hits for batched state.data mutation
    const isLTR = chunkingLeftToRight.get(queryIndex) ?? false;
    if (!hitsBuffer.has(queryIndex)) {
      hitsBuffer.set(queryIndex, {
        hits: [],
        streamingAggs: streaming_aggs,
        orderAsc,
        isLTR,
      });
    }
    const buffer = hitsBuffer.get(queryIndex)!;
    buffer.hits.push(hits);
    buffer.streamingAggs = streaming_aggs;
    buffer.orderAsc = orderAsc;
    buffer.isLTR = isLTR;

    scheduleFlush();
  };

  // Top-level dispatch handler

  // Limit, aggregation, vrl function, pagination, function error and query error
  const handleSearchResponse = (payload: any, response: any) => {
    try {
      if (response.type === "search_response_metadata") {
        handleStreamingHistogramMetadata(payload, response);
      }

      if (response.type === "search_response_hits") {
        handleStreamingHistogramHits(payload, response);
      }

      if (response.type === "search_response") {
        handleHistogramResponse(payload, response);
      }

      if (response.type === "error") {
        clearHitsBuffer();
        state.loading = false;
        state.loadingTotal = 0;
        state.loadingCompleted = 0;
        state.loadingProgressPercentage = 0;
        state.isOperationCancelled = false;
        state.isPartialData = false;
        processApiError(response?.content, "sql");
      }

      if (response.type === "end") {
        // Flush any pending buffered hits before marking complete
        flushHitsBuffer();

        state.loading = false;
        state.loadingTotal = 0;
        state.loadingCompleted = 0;
        state.loadingProgressPercentage = 100; // Set to 100% when complete
        state.isOperationCancelled = false;
        state.isPartialData = false; // Explicitly set to false when complete
        saveCurrentStateToCache();
      }

      if (response.type === "event_progress") {
        pendingProgressPercent = response?.content?.percent ?? 0;
        scheduleFlush();
      }
    } catch (error: any) {
      clearHitsBuffer();
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

  // Connection lifecycle handlers

  const handleSearchClose = (payload: any, response: any) => {
    clearHitsBuffer();
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
    clearHitsBuffer();
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

  return {
    handleHistogramResponse,
    handleStreamingHistogramMetadata,
    handleStreamingHistogramHits,
    handleSearchResponse,
    handleSearchClose,
    handleSearchReset,
    handleSearchError,
  };
};
