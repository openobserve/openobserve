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

import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/auth";
import { searchFailed } from "@/utils/searchComplete";

export interface StreamRowsRequest {
  org: string;
  sql: string;
  startTime: number;
  endTime: number;
  size: number;
  signal?: AbortSignal;
}

interface StreamResults {
  hits?: unknown;
  is_partial?: boolean;
  function_error?: unknown;
  error?: unknown;
}

interface StreamEvent {
  type?: string;
  content?: { results?: StreamResults; streaming_aggs?: boolean };
}

export class IncompleteStreamError extends Error {}

/** Reads every row of a trace SQL over `_search_stream`; rejects on an error, a partial answer or an abort. */
export function streamTraceRows<T>(request: StreamRowsRequest): Promise<T[]> {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const { traceId } = generateTraceContext();
  return new Promise<T[]>((resolve, reject) => {
    let rows: T[] = [];
    let snapshot: T[] | null = null;
    let partial = false;
    const cancel = () => {
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: request.org });
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (request.signal?.aborted) return cancel();
    request.signal?.addEventListener("abort", cancel, { once: true });
    const done = () => request.signal?.removeEventListener("abort", cancel);
    void fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: request.sql,
            start_time: request.startTime,
            end_time: request.endTime,
            from: 0,
            size: request.size,
          },
        },
        type: "search",
        traceId,
        org_id: request.org,
        pageType: "traces",
        searchType: "ui",
      },
      {
        data: (_request: unknown, event: StreamEvent) => {
          const results = event?.content?.results;
          if (searchFailed(results as Record<string, unknown> | undefined)) partial = true;
          if (event?.type === "search_response_metadata") {
            snapshot = event.content?.streaming_aggs === true ? [] : null;
            return;
          }
          if (event?.type !== "search_response_hits" || !Array.isArray(results?.hits)) return;
          const hits = results.hits as T[];
          if (!snapshot) rows = rows.concat(hits);
          else {
            // Each streaming-aggregation snapshot repeats every row so far, so the newest non-empty one wins.
            snapshot = snapshot.concat(hits);
            if (snapshot.length) rows = snapshot;
          }
        },
        error: (_request: unknown, error: unknown) => {
          done();
          reject(error instanceof Error ? error : new Error("Stream search failed"));
        },
        complete: () => {
          done();
          if (partial) reject(new IncompleteStreamError("Incomplete stream search"));
          else resolve(rows);
        },
      },
    );
  });
}
