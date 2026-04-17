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

import { ref, type Ref } from "vue";
import store from "@/stores";
import { generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { captureFromValuesApi } from "@/composables/useFieldValueStore";

export interface FieldValueEntry {
  key: string;
  count: number;
}

export interface FieldValuesState {
  isLoading: boolean;
  values: FieldValueEntry[];
  hasMore: boolean;
  errMsg: string;
}

/**
 * Shared composable for streaming field values across logs, traces, and pipeline.
 *
 * Manages per-field state (loading, values, hasMore, errMsg) and per-stream
 * value accumulation so callers get cross-stream aggregation for free.
 *
 * Usage:
 *   const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
 *     useFieldValuesStream();
 */
const useFieldValuesStream = () => {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();

  // Public state: fieldName → { isLoading, values, hasMore, errMsg }
  const fieldValues: Ref<Record<string, FieldValuesState>> = ref({});

  // Internal per-stream values for cross-stream aggregation:
  // fieldName → streamName → { values, hasMore }
  const streamFieldValues: Ref<
    Record<
      string,
      Record<string, { values: FieldValueEntry[]; hasMore: boolean }>
    >
  > = ref({});

  // Finalized values from previous "load more" pages (immutable during streaming)
  const fieldValuesFinalizedValues: Ref<Record<string, FieldValueEntry[]>> =
    ref({});

  // Cumulative size requested per field (grows on "load more")
  const fieldValuesCurrentSize: Ref<Record<string, number>> = ref({});

  // Active trace IDs per field (supports multiple concurrent streams per field)
  const traceIdMapper: Ref<Record<string, string[]>> = ref({});

  // ─── Trace ID helpers ────────────────────────────────────────────────────

  const addTraceId = (field: string, traceId: string) => {
    if (!traceIdMapper.value[field]) traceIdMapper.value[field] = [];
    traceIdMapper.value[field].push(traceId);
  };

  const removeTraceId = (field: string, traceId: string) => {
    if (traceIdMapper.value[field]) {
      traceIdMapper.value[field] = traceIdMapper.value[field].filter(
        (id) => id !== traceId,
      );
    }
  };

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Cancel all active streams for a field. */
  const cancelFieldStream = (fieldName: string) => {
    const traceIds = traceIdMapper.value[fieldName];
    if (traceIds?.length) {
      traceIds.forEach((traceId) =>
        cancelStreamQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store.state.selectedOrganization.identifier,
        }),
      );
      traceIdMapper.value[fieldName] = [];
    }
  };

  /** Reset field state; pass isLoading=true when a new fetch is about to start. */
  const resetFieldValues = (fieldName: string, isLoading = false) => {
    fieldValues.value[fieldName] = {
      values: [],
      isLoading,
      hasMore: false,
      errMsg: "",
    };
    streamFieldValues.value[fieldName] = {};
    delete fieldValuesFinalizedValues.value[fieldName];
  };

  /** Kick off a streaming values fetch for the given payload. */
  const fetchFieldValues = (payload: any) => {
    const { traceId } = generateTraceContext();
    const wsPayload = {
      queryReq: payload,
      type: "values" as const,
      traceId,
      org_id: store.state.selectedOrganization.identifier,
      meta: payload,
    };

    fetchQueryDataWithHttpStream(wsPayload, {
      data: handleResponse,
      error: handleError,
      complete: handleClose,
      reset: handleReset,
    });

    addTraceId(payload.fields[0], traceId);
  };

  // ─── Stream handlers ─────────────────────────────────────────────────────

  const handleResponse = (payload: any, response: any) => {
    const fieldName = payload?.queryReq?.fields[0];
    const streamName = payload?.queryReq?.stream_name;
    const pageSize = store.state.zoConfig?.query_values_default_num || 10;

    if (!fieldName) return;

    try {
      if (response.type === "cancel_response") {
        removeTraceId(fieldName, response.content.trace_id);
        return;
      }
      if (response.type !== "search_response_hits") return;

      if (!fieldValues.value[fieldName]) resetFieldValues(fieldName);
      if (!streamFieldValues.value[fieldName])
        streamFieldValues.value[fieldName] = {};
      if (!streamFieldValues.value[fieldName][streamName])
        streamFieldValues.value[fieldName][streamName] = {
          values: [],
          hasMore: false,
        };

      if (response.content?.results?.hits?.length) {
        const chunkValues: FieldValueEntry[] = [];
        response.content.results.hits.forEach((item: any) => {
          item.values?.forEach((subItem: any) => {
            chunkValues.push({
              key: subItem.zo_sql_key ? subItem.zo_sql_key : "null",
              count: parseInt(subItem.zo_sql_num),
            });
          });
        });

        // [NEW] Background capture — does not block handleResponse return
        if (chunkValues.length > 0 && fieldName) {
          captureFromValuesApi(
            {
              org: store.state.selectedOrganization.identifier,
              streamType: payload?.queryReq?.stream_type ?? "logs",
              streamName: streamName ?? "",
            },
            fieldName,
            chunkValues,
          );
        }

        // The backend returns the full cumulative result set (from rank 0 to
        // from+size), so always replace per-stream values rather than appending.
        streamFieldValues.value[fieldName][streamName].values = chunkValues;

        // Aggregate values across all streams and sort by count descending.
        const aggregated: Record<string, number> = {};
        Object.values(streamFieldValues.value[fieldName]).forEach(
          ({ values }) => {
            values.forEach(({ key, count }) => {
              aggregated[key] = (aggregated[key] ?? 0) + count;
            });
          },
        );

        const aggregatedArray = Object.entries(aggregated)
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count);

        // Merge with finalized values from previous pages.
        const finalized = fieldValuesFinalizedValues.value[fieldName] || [];
        const currentSize =
          fieldValuesCurrentSize.value[fieldName] || pageSize;

        if (finalized.length > 0) {
          const finalizedKeys = new Set(finalized.map((v) => v.key));
          const merged = [...finalized];
          for (const item of aggregatedArray) {
            if (!finalizedKeys.has(item.key)) {
              merged.push(item);
            }
          }
          merged.sort((a, b) => b.count - a.count);
          fieldValues.value[fieldName].values = merged;
        } else {
          fieldValues.value[fieldName].values = aggregatedArray;
        }

        fieldValues.value[fieldName].hasMore =
          aggregatedArray.length >= currentSize;
      }

      fieldValues.value[fieldName].isLoading = false;
    } catch {
      if (fieldValues.value[fieldName]) {
        fieldValues.value[fieldName].errMsg = "Failed to fetch field values";
        fieldValues.value[fieldName].isLoading = false;
      }
    }
  };

  const handleError = (payload: any) => {
    const fieldName = payload?.queryReq?.fields[0];
    if (fieldName && fieldValues.value[fieldName]) {
      fieldValues.value[fieldName].isLoading = false;
      fieldValues.value[fieldName].errMsg = "Failed to fetch field values";
    }
    if (fieldName) removeTraceId(fieldName, payload.traceId);
  };

  const handleClose = (payload: any) => {
    const fieldName = payload?.queryReq?.fields[0];
    if (fieldName && fieldValues.value[fieldName]) {
      fieldValues.value[fieldName].isLoading = false;
    }
    if (fieldName) removeTraceId(fieldName, payload.traceId);
  };

  const handleReset = (data: any) => {
    const fieldName = data?.queryReq?.fields[0];
    if (fieldName) {
      resetFieldValues(fieldName, true);
      traceIdMapper.value[fieldName] = [];
      fetchFieldValues(data.queryReq);
    }
  };

  return {
    fieldValues,
    fieldValuesFinalizedValues,
    fieldValuesCurrentSize,
    fetchFieldValues,
    cancelFieldStream,
    resetFieldValues,
  };
};

export default useFieldValuesStream;
