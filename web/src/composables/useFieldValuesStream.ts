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

import { ref, getCurrentScope, onScopeDispose, type Ref } from "vue";
import type { I18nText, TranslateFn } from "@/types/i18n";
import store from "@/stores";
import { generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { captureFromValuesApi } from "@/composables/fieldValueStore";
import { removeFieldCondition } from "@/utils/traces/filterUtils";
import {
  MISSING_VALUE_KEY,
  valueKeyLabel,
} from "@/components/common/fieldPanel/valueFilterExpression";

export interface FieldValueEntry {
  key: string;
  count: number;
  /** Shown and copied in place of `key`, for a key that is not the value's own text. */
  label?: I18nText;
}

export interface FieldValuesState {
  isLoading: boolean;
  values: FieldValueEntry[];
  hasMore: boolean;
  errMsg: string;
  /** The field's latest fetch; every per-stream request of one fetch shares it. */
  generation?: number;
  /** The latest fetch whose every request completed or failed; equal to `generation` once nothing is in flight. */
  settled?: number;
}

/** One `_values_stream` request; a field spread over several streams sends one per stream and the counts are summed. */
export interface FieldValuesRequest {
  fields: string[];
  /** Cumulative page: the backend returns ranks 0 to `size`, so "load more" re-sends a larger size. */
  size: number;
  from?: number;
  no_count: boolean;
  regions?: string[];
  clusters?: string[];
  /** Base64 VRL applied before the values are counted. */
  vrl_fn?: string;
  start_time: number;
  end_time: number;
  timeout: number;
  stream_name: string;
  stream_type: string;
  use_cache: boolean;
  /** Base64 SQL whose FROM and WHERE scope the values. */
  sql: string;
  keyword?: string;
}

export interface EnrichmentStats {
  doc_time_min: number;
  doc_time_max: number;
}

const ENRICHMENT_WINDOW_PAD_US = 5 * 60 * 1_000_000;

// Whole milliseconds, as the request has always been sent.
const toMsPrecision = (micros: number) => Math.floor(micros / 1000) * 1000;

/** An enrichment table has no live range, so its values are read around the documents it holds. */
export const enrichmentValuesRange = (stats: EnrichmentStats) => ({
  startTime: toMsPrecision(stats.doc_time_min - ENRICHMENT_WINDOW_PAD_US),
  endTime: toMsPrecision(stats.doc_time_max + ENRICHMENT_WINDOW_PAD_US),
});

/** Drops `fieldName`'s own conditions from a WHERE string so its value counts are not narrowed to the picked values. */
export const stripFieldCondition = (whereClause: string, fieldName: string): string => {
  if (!whereClause?.trim()) return "";
  return removeFieldCondition(whereClause, fieldName).trim();
};

/**
 * Shared composable for streaming field values across logs, traces, and pipeline.
 *
 * Manages per-field state (loading, values, hasMore, errMsg) and per-stream
 * value accumulation so callers get cross-stream aggregation for free.
 *
 * Usage:
 *   const { fieldValues, fetchFieldValues, cancelFieldStream, resetFieldValues } =
 *     useFieldValuesStream(t);
 */
const useFieldValuesStream = (t: TranslateFn) => {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

  // Public state: fieldName → { isLoading, values, hasMore, errMsg }
  const fieldValues: Ref<Record<string, FieldValuesState>> = ref({});

  // Internal per-stream values for cross-stream aggregation:
  // fieldName → streamName → { values, hasMore }
  const streamFieldValues: Ref<
    Record<string, Record<string, { values: FieldValueEntry[]; hasMore: boolean }>>
  > = ref({});

  // Finalized values from previous "load more" pages (immutable during streaming)
  const fieldValuesFinalizedValues: Ref<Record<string, FieldValueEntry[]>> = ref({});

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
      traceIdMapper.value[field] = traceIdMapper.value[field].filter((id) => id !== traceId);
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

  const cancelAllFieldStreams = () => {
    Object.keys(traceIdMapper.value).forEach((fieldName) => cancelFieldStream(fieldName));
  };

  if (getCurrentScope()) onScopeDispose(cancelAllFieldStreams);

  // Per field: the latest fetch and the trace ids of it still in flight.
  const generations: Record<string, number> = {};
  const inFlight: Record<string, Set<string>> = {};
  // Per field: what a fetch asks apart from keyword and page, so a snapshot is only restored into the list it came from.
  const requestScopes: Record<string, string> = {};
  const unfiltered: Record<
    string,
    { values: FieldValueEntry[]; hasMore: boolean; cursor: number; scope: string }
  > = {};
  const loadMoreBase: Record<
    string,
    { generation: number; length: number; hasMore: boolean; rollback?: () => void }
  > = {};
  const failedGeneration: Record<string, number> = {};

  // Keyword and page change within one list; anything else (stream, filter, range) makes another list.
  const scopeOf = (payloads: FieldValuesRequest[]) =>
    JSON.stringify(payloads.map(({ keyword: _k, size: _s, from: _f, ...rest }) => rest));

  // Per field: values kept on screen from before a refetch, dropped if the refetch brings none.
  const staleValues: Record<string, boolean> = {};

  /** Reset field state; pass isLoading=true when a new fetch is about to start, and keepValues to show the old list until the new one lands. */
  const resetFieldValues = (fieldName: string, isLoading = false, keepValues = false) => {
    const kept = keepValues ? (fieldValues.value[fieldName]?.values ?? []) : [];
    if (kept.length) staleValues[fieldName] = true;
    else delete staleValues[fieldName];
    fieldValues.value[fieldName] = {
      values: kept,
      isLoading,
      hasMore: false,
      errMsg: "",
      generation: generations[fieldName],
      settled: fieldValues.value[fieldName]?.settled,
    };
    streamFieldValues.value[fieldName] = {};
    delete fieldValuesFinalizedValues.value[fieldName];
  };

  /** Settles a field with an error the caller found before any request was sent. */
  const setFieldError = (fieldName: string, message: string) => {
    if (!fieldValues.value[fieldName]) resetFieldValues(fieldName);
    fieldValues.value[fieldName].isLoading = false;
    fieldValues.value[fieldName].errMsg = message;
  };

  /** Starts one fetch: one request per stream, settled once all of them end; `key` names the state slot, the field name unless two rows share it. */
  const fetchFieldValues = (
    request: FieldValuesRequest | FieldValuesRequest[],
    key: string = (Array.isArray(request) ? request[0] : request)?.fields?.[0],
  ) => {
    const payloads = Array.isArray(request) ? request : [request];
    const generation = (generations[key] ?? 0) + 1;
    generations[key] = generation;
    inFlight[key] = new Set();
    delete loadMoreBase[key];
    requestScopes[key] = scopeOf(payloads);
    if (unfiltered[key] && unfiltered[key].scope !== requestScopes[key]) delete unfiltered[key];
    if (fieldValues.value[key]) fieldValues.value[key].generation = generation;
    payloads.forEach((payload) => sendFieldValues(payload, key, generation));
  };

  const isFetchSettled = (key: string) => !inFlight[key]?.size;

  const fetchMoreFieldValues = (
    request: FieldValuesRequest | FieldValuesRequest[],
    key: string = (Array.isArray(request) ? request[0] : request)?.fields?.[0],
    rollback?: () => void,
  ) => {
    const shown = fieldValues.value[key]?.values ?? [];
    const hadMore = fieldValues.value[key]?.hasMore ?? true;
    fieldValuesFinalizedValues.value[key] = [...shown];
    if (fieldValues.value[key]) fieldValues.value[key].errMsg = "";
    fetchFieldValues(request, key);
    loadMoreBase[key] = {
      generation: generations[key],
      length: shown.length,
      hasMore: hadMore,
      rollback,
    };
  };

  /** Keeps the unfiltered list when a value search starts; later keystrokes of the same search keep the first copy. */
  const rememberUnfiltered = (key: string, cursor: number) => {
    const state = fieldValues.value[key];
    if (unfiltered[key] || !state?.values.length || !isFetchSettled(key)) return;
    unfiltered[key] = {
      values: [...state.values],
      hasMore: state.hasMore,
      cursor,
      scope: requestScopes[key] ?? "",
    };
  };

  /** Puts the list from before the search back as it was, `hasMore` included; returns its cursor, or null when there is none. */
  const restoreUnfiltered = (key: string): number | null => {
    const snapshot = unfiltered[key];
    if (!snapshot) return null;
    delete unfiltered[key];
    cancelFieldStream(key);
    // A new generation, so a late answer to the cancelled search cannot overwrite the restored list.
    generations[key] = (generations[key] ?? 0) + 1;
    inFlight[key] = new Set();
    delete loadMoreBase[key];
    delete fieldValuesFinalizedValues.value[key];
    fieldValues.value[key] = {
      isLoading: false,
      values: [...snapshot.values],
      hasMore: snapshot.hasMore,
      errMsg: "",
      generation: generations[key],
      settled: generations[key],
    };
    return snapshot.cursor;
  };

  const forgetUnfiltered = (key: string) => {
    delete unfiltered[key];
  };

  const sendFieldValues = (payload: FieldValuesRequest, key: string, generation: number) => {
    const { traceId } = generateTraceContext();
    // `size` is the cumulative page, so "load more" only shows once a page is full.
    if (key && Number(payload.size) > 0) {
      fieldValuesCurrentSize.value[key] = Number(payload.size);
    }
    const wsPayload = {
      queryReq: payload,
      type: "values" as const,
      traceId,
      org_id: store.state.selectedOrganization.identifier,
      meta: payload,
      fieldKey: key,
      generation,
    };

    fetchQueryDataWithHttpStream(wsPayload, {
      data: handleResponse,
      error: handleError,
      complete: handleClose,
      reset: handleReset,
    });

    addTraceId(key, traceId);
    if (generations[key] === generation) inFlight[key]?.add(traceId);
  };

  const stateKeyOf = (
    payload: { fieldKey?: string; queryReq?: { fields?: string[] } } | undefined,
  ): string | undefined => payload?.fieldKey ?? payload?.queryReq?.fields?.[0];

  const isCurrent = (key: string, payload: { generation?: number } | undefined) =>
    payload?.generation === generations[key];

  // An older fetch ending says nothing about the current one, which settles only when its last request ends.
  const markSettled = (key: string, payload: { generation?: number; traceId?: string }) => {
    if (!isCurrent(key, payload)) return;
    const pending = inFlight[key];
    if (payload.traceId) pending?.delete(payload.traceId);
    if (pending?.size) return;
    const state = fieldValues.value[key];
    if (!state) return;
    if (staleValues[key]) {
      delete staleValues[key];
      state.values = [];
    }
    const base = loadMoreBase[key];
    // A failed page proves nothing about what is left, so the button stays to retry it.
    if (base?.generation === payload.generation && failedGeneration[key] === payload.generation) {
      state.hasMore = base.hasMore;
      base.rollback?.();
    } else if (base?.generation === payload.generation && state.values.length <= base.length) {
      state.hasMore = false;
    }
    state.settled = payload.generation;
  };

  // ─── Stream handlers ─────────────────────────────────────────────────────

  const handleResponse = (payload: any, response: any) => {
    const columnName = payload?.queryReq?.fields[0];
    const fieldName = stateKeyOf(payload);
    const streamName = payload?.queryReq?.stream_name;
    const pageSize = store.state.zoConfig?.query_values_default_num || 10;

    if (!fieldName) return;

    try {
      if (response.type === "cancel_response") {
        removeTraceId(fieldName, response.content.trace_id);
        return;
      }
      if (response.type !== "search_response_hits") return;
      // A late answer to a superseded fetch would overwrite the current one's values.
      if (!isCurrent(fieldName, payload)) return;

      if (!fieldValues.value[fieldName]) resetFieldValues(fieldName);
      if (!streamFieldValues.value[fieldName]) streamFieldValues.value[fieldName] = {};
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
              key: subItem.zo_sql_key ? subItem.zo_sql_key : MISSING_VALUE_KEY,
              count: parseInt(subItem.zo_sql_num),
            });
          });
        });

        // Background capture — does not block handleResponse return
        const capturable = chunkValues.filter(({ key }) => key !== MISSING_VALUE_KEY);
        if (capturable.length > 0 && columnName) {
          captureFromValuesApi(
            {
              org: store.state.selectedOrganization.identifier,
              streamType: payload?.queryReq?.stream_type ?? "logs",
              streamName: streamName ?? "",
            },
            columnName,
            capturable,
          );
        }

        // The backend returns the full cumulative result set (from rank 0 to
        // from+size), so always replace per-stream values rather than appending.
        streamFieldValues.value[fieldName][streamName].values = chunkValues;

        // Aggregate values across all streams and sort by count descending.
        const aggregated: Record<string, number> = {};
        Object.values(streamFieldValues.value[fieldName]).forEach(({ values }) => {
          values.forEach(({ key, count }) => {
            aggregated[key] = (aggregated[key] ?? 0) + count;
          });
        });

        const aggregatedArray = Object.entries(aggregated)
          .map(([key, count]): FieldValueEntry => {
            const label = valueKeyLabel(key);
            return label === undefined ? { key, count } : { key, label, count };
          })
          .sort((a, b) => b.count - a.count);

        // Merge with finalized values from previous pages.
        const finalized = fieldValuesFinalizedValues.value[fieldName] || [];
        const currentSize = fieldValuesCurrentSize.value[fieldName] || pageSize;

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
        delete staleValues[fieldName];

        fieldValues.value[fieldName].hasMore = aggregatedArray.length >= currentSize;
      }

      // Old values stay marked busy until new ones replace them or the fetch ends.
      if (!staleValues[fieldName]) fieldValues.value[fieldName].isLoading = false;
    } catch {
      if (fieldValues.value[fieldName]) {
        fieldValues.value[fieldName].errMsg = t("search.failedToFetchFieldValues");
        fieldValues.value[fieldName].isLoading = false;
      }
    }
  };

  const handleError = (payload: any) => {
    const fieldName = stateKeyOf(payload);
    if (fieldName && fieldValues.value[fieldName] && isCurrent(fieldName, payload)) {
      fieldValues.value[fieldName].isLoading = false;
      fieldValues.value[fieldName].errMsg = t("search.failedToFetchFieldValues");
      failedGeneration[fieldName] = payload.generation;
    }
    if (fieldName) markSettled(fieldName, payload);
    if (fieldName) removeTraceId(fieldName, payload.traceId);
  };

  const handleClose = (payload: any) => {
    const fieldName = stateKeyOf(payload);
    if (fieldName && fieldValues.value[fieldName] && isCurrent(fieldName, payload)) {
      fieldValues.value[fieldName].isLoading = false;
    }
    if (fieldName) markSettled(fieldName, payload);
    if (fieldName) removeTraceId(fieldName, payload.traceId);
  };

  const handleReset = (data: any) => {
    const fieldName = stateKeyOf(data);
    if (fieldName && isCurrent(fieldName, data)) {
      resetFieldValues(fieldName, true);
      traceIdMapper.value[fieldName] = [];
      inFlight[fieldName]?.delete(data.traceId);
      sendFieldValues(data.queryReq, fieldName, data.generation ?? generations[fieldName]);
    }
  };

  return {
    fieldValues,
    fieldValuesFinalizedValues,
    fieldValuesCurrentSize,
    fetchFieldValues,
    fetchMoreFieldValues,
    isFetchSettled,
    rememberUnfiltered,
    restoreUnfiltered,
    forgetUnfiltered,
    cancelFieldStream,
    cancelAllFieldStreams,
    resetFieldValues,
    setFieldError,
  };
};

export default useFieldValuesStream;
