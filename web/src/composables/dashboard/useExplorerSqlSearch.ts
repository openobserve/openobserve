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

import { onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/auth";
import { b64EncodeUnicode } from "@/utils/formatters";

export interface ExplorerSqlQuery {
  sql: string;
  start_time: number;
  end_time: number;
  from: number;
  size: number;
  track_total_hits?: boolean;
}

/** The explorer drawer's SQL searches over _search_stream, one in flight per purpose. */
export function useExplorerSqlSearch(pageType: () => string) {
  const store = useStore();
  const orgId = () => store.state.selectedOrganization.identifier;
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const inFlight = new Map<string, { traceId: string; settle: () => void }>();

  function cancelSearch(key: string) {
    const running = inFlight.get(key);
    if (!running) return;
    inFlight.delete(key);
    cancelStreamQueryBasedOnRequestId({ trace_id: running.traceId, org_id: orgId() });
    running.settle();
  }

  /** One SQL search; null when a newer search of `key` or unmounting cancels it. */
  function streamSearch(key: string, query: ExplorerSqlQuery): Promise<{ hits: any[] } | null> {
    cancelSearch(key);
    const { traceId } = generateTraceContext();
    const useBase64 = store.state.zoConfig?.sql_base64_enabled;
    return new Promise((resolve, reject) => {
      inFlight.set(key, { traceId, settle: () => resolve(null) });
      const isCurrent = () => inFlight.get(key)?.traceId === traceId;
      let streamingAggs = false;
      let hits: any[] = [];
      const metadataHits: any[] = [];
      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: { ...query, sql: useBase64 ? b64EncodeUnicode(query.sql) : query.sql },
            ...(useBase64 ? { encoding: "base64" } : {}),
          },
          type: "search",
          pageType: pageType(),
          searchType: "ui",
          traceId,
          org_id: orgId(),
        },
        {
          data: (_payload: unknown, response: any) => {
            const content = response?.content ?? {};
            const results = content.results ?? {};
            if (response?.type === "search_response_metadata") {
              streamingAggs ||= Boolean(results.streaming_aggs ?? content.streaming_aggs);
              // A cached response can carry its hits on metadata alone, so keep them as a fallback.
              if (Array.isArray(results.hits)) metadataHits.push(...results.hits);
              return;
            }
            if (response?.type !== "search_response_hits") return;
            const chunk: any[] = results.hits ?? content.hits ?? [];
            if (!Array.isArray(chunk) || !chunk.length) return;
            // A streaming aggregate resends its whole result with every chunk.
            hits = streamingAggs ? [...chunk] : [...hits, ...chunk];
          },
          error: (_payload: unknown, response: any) => {
            if (!isCurrent()) return;
            inFlight.delete(key);
            const body = response?.content ?? response ?? {};
            const error: any = new Error(
              String(body.error ?? body.message ?? body.error_detail ?? "Search failed"),
            );
            error.response = { data: body };
            reject(error);
          },
          complete: () => {
            if (!isCurrent()) return;
            inFlight.delete(key);
            resolve({ hits: hits.length ? hits : metadataHits });
          },
        },
      );
    });
  }

  // A streamed search reports only the rows it sent, so the match count is its own request.
  async function countMatches(
    sql: string,
    range: { start_time: number; end_time: number },
  ): Promise<number | null> {
    try {
      const res = await streamSearch("count", {
        sql,
        ...range,
        from: 0,
        size: 0,
        track_total_hits: true,
      });
      return res ? res.hits.reduce((sum, hit) => sum + (Number(hit?.zo_sql_num) || 0), 0) : null;
    } catch {
      return null;
    }
  }

  const cancelAll = () => [...inFlight.keys()].forEach(cancelSearch);
  onBeforeUnmount(cancelAll);

  return { streamSearch, countMatches, cancelSearch, cancelAll };
}
