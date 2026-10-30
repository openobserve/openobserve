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

import { getCurrentInstance, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

type Row = Record<string, unknown>;

export interface UsageSearchOptions {
  /** Microseconds. */
  start: number;
  end: number;
  size: number;
  /** A new call with the same key cancels the previous one on the server. */
  key?: string;
  /** The rows so far after each streamed chunk, for a caller that renders progressively. */
  onRows?: (rows: Row[]) => void;
}

/** `usage` SQL over `_search_stream`; a call cancelled by a newer same-key call or by unmount never settles. */
export function useUsageSearch() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

  const inFlight = new Map<string, string>();

  const cancel = (key: string) => {
    const traceId = inFlight.get(key);
    if (!traceId) return;
    inFlight.delete(key);
    cancelStreamQueryBasedOnRequestId({
      trace_id: traceId,
      org_id: store.state.selectedOrganization.identifier,
    });
  };

  const cancelAll = () => [...inFlight.keys()].forEach(cancel);

  if (getCurrentInstance()) onBeforeUnmount(cancelAll);

  let anonymous = 0;

  const search = (sql: string, options: UsageSearchOptions): Promise<Row[]> => {
    const key = options.key ?? `anonymous-${++anonymous}`;
    cancel(key);
    const traceId = generateTraceContext().traceId;
    inFlight.set(key, traceId);
    const isCurrent = () => inFlight.get(key) === traceId;
    const useBase64 = store.state.zoConfig?.sql_base64_enabled;

    return new Promise((resolve, reject) => {
      let streamingAggs = false;
      let rows: Row[] = [];
      const metadataRows: Row[] = [];

      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: {
              sql: useBase64 ? b64EncodeUnicode(sql) : sql,
              start_time: options.start,
              end_time: options.end,
              from: 0,
              size: options.size,
            },
            ...(useBase64 ? { encoding: "base64" } : {}),
          },
          type: "search",
          pageType: "logs",
          searchType: "ui",
          traceId,
          org_id: store.state.selectedOrganization.identifier,
        },
        {
          data: (_payload: unknown, response: any) => {
            const content = response?.content ?? {};
            const results = content.results ?? {};
            if (response?.type === "search_response_metadata") {
              streamingAggs ||= Boolean(results.streaming_aggs ?? content.streaming_aggs);
              // A cached response can carry its hits on metadata alone, so keep them as a fallback.
              if (Array.isArray(results.hits)) metadataRows.push(...results.hits);
              return;
            }
            if (response?.type !== "search_response_hits") return;
            const hits: Row[] = results.hits ?? content.hits ?? [];
            if (!Array.isArray(hits) || !hits.length) return;
            // Same merge as the dashboards executor: a streaming aggregate resends the whole result.
            rows = streamingAggs ? [...hits] : [...rows, ...hits];
            if (isCurrent()) options.onRows?.(rows);
          },
          error: (_payload: unknown, response: any) => {
            if (!isCurrent()) return;
            inFlight.delete(key);
            const body = response?.content ?? response ?? {};
            const error: any = new Error(
              String(body.message ?? body.error ?? body.error_detail ?? "search failed"),
            );
            error.status = body.status;
            error.code = body.code;
            error.response = { data: body };
            reject(error);
          },
          complete: () => {
            if (!isCurrent()) return;
            inFlight.delete(key);
            resolve(rows.length ? rows : metadataRows);
          },
        },
      );
    });
  };

  return { search, cancel, cancelAll };
}
