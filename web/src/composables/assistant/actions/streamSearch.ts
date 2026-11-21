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

import type useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode } from "@/utils/zincutils";

import type { SearchRequest } from "./registry";

export type SearchStream = Pick<
  ReturnType<typeof useHttpStreaming>,
  "fetchQueryDataWithHttpStream" | "cancelStreamQueryBasedOnRequestId"
>;

interface StreamFrame {
  type?: string;
  content?: { results?: unknown } & Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** One SQL search over `_search_stream`, folded into the one-shot response shape; rejects like axios (`response.status`, `response.data`). */
export function streamSearch(
  stream: SearchStream,
  request: SearchRequest,
  traceId: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException("Aborted", "AbortError"));
    if (request.signal.aborted) return aborted();
    const hits: Record<string, unknown>[] = [];
    // A partitioned stream sends metadata per partition; Logs sums them the same way.
    const totals = { total: 0, took: 0, scan_size: 0, seen: false };
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => {
      stream.cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: request.org });
      finish(aborted);
    };
    request.signal.addEventListener("abort", onAbort);
    void stream.fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(request.sql),
            start_time: request.startTime,
            end_time: request.endTime,
            from: 0,
            size: request.size,
            quick_mode: false,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: request.org,
        pageType: request.streamType,
        searchType: "ui",
      },
      {
        data: (_request: unknown, frame: StreamFrame) => {
          const results = frame.content?.results;
          if (settled || !isRecord(results) || !frame.type?.startsWith("search_response")) return;
          if (frame.type === "search_response_metadata") {
            totals.seen = true;
            totals.total += numberOr(results.total, 0);
            totals.took += numberOr(results.took, 0);
            totals.scan_size += numberOr(results.scan_size, 0);
          }
          if (Array.isArray(results.hits) && hits.length < request.size)
            hits.push(...results.hits.filter(isRecord).slice(0, request.size - hits.length));
        },
        error: (_request: unknown, frame: StreamFrame) => {
          const { trace_id: _trace, ...data } = frame?.content ?? {};
          const status = numberOr(data.status, numberOr(data.code, 0)) || undefined;
          finish(() => reject({ response: { status, data } }));
        },
        complete: () => {
          const { seen, ...sums } = totals;
          finish(() => resolve({ hits, ...(seen ? sums : { total: hits.length }) }));
        },
      },
    );
  });
}
