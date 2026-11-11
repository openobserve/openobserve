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
import { generateTraceContext } from "@/utils/zincutils";

export interface StreamSearchParams {
  org_identifier: string;
  query: { query: Record<string, unknown>; encoding?: string };
  page_type?: string;
  signal?: AbortSignal;
}
export interface StreamSearchResult {
  hits: unknown[];
  is_partial: boolean;
  function_error: string;
}
export interface StreamSearchError extends Error {
  response: {
    status?: number;
    data: { code?: number; message: string; error_detail?: string };
  };
}

// An in-band stream error carries the HTTP status in `code`, so the search error code is read back from its message.
const CODE_BY_MESSAGE: [RegExp, number][] = [[/^Search stream not found/, 20002]];

const toError = (body: Record<string, any>): StreamSearchError => {
  const message = String(body.message ?? body.error ?? body.error_detail ?? "search failed");
  const inBand = body.status === undefined;
  const status = inBand ? body.code : body.status;
  const code = inBand ? CODE_BY_MESSAGE.find(([re]) => re.test(message))?.[1] : body.code;
  const error = new Error(message) as StreamSearchError;
  error.response = {
    status: typeof status === "number" ? status : undefined,
    data: {
      ...(typeof code === "number" ? { code } : {}),
      message,
      ...(body.error_detail ? { error_detail: String(body.error_detail) } : {}),
    },
  };
  return error;
};

const abortError = (): Error => {
  const error = new Error("search aborted");
  error.name = "AbortError";
  return error;
};

/**
 * `searchService.search` over `_search_stream`: resolves `{ data }` once the stream ends and rejects with an axios-shaped error.
 * `onRows` gets the rows so far after each streamed part, before the stream ends.
 */
const search = (
  { org_identifier, query, page_type = "logs", signal }: StreamSearchParams,
  search_type = "ui",
  onRows?: (rows: unknown[]) => void,
): Promise<{ data: StreamSearchResult }> => {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const traceId = generateTraceContext().traceId;
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    let streamingAggs = false;
    let isPartial = false;
    let functionError = "";
    let hits: unknown[] = [];
    const metadataHits: unknown[] = [];

    // A cancelled stream reaches no handler, so the abort settles the promise itself.
    const onAbort = () => {
      cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: org_identifier });
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);

    void fetchQueryDataWithHttpStream(
      {
        queryReq: query,
        type: "search",
        pageType: page_type,
        searchType: search_type,
        traceId,
        org_id: org_identifier,
      },
      {
        data: (_payload: unknown, response: any) => {
          const content = response?.content ?? {};
          const results = content.results ?? {};
          if (response?.type === "search_response_metadata") {
            streamingAggs ||= Boolean(results.streaming_aggs ?? content.streaming_aggs);
            isPartial ||= Boolean(results.is_partial);
            if (results.function_error) functionError = String(results.function_error);
            // A cached response can carry its hits on metadata alone, so they are kept as a fallback.
            if (Array.isArray(results.hits) && results.hits.length) {
              metadataHits.push(...results.hits);
              if (!hits.length) onRows?.([...metadataHits]);
            }
            return;
          }
          if (response?.type !== "search_response_hits") return;
          const chunk = results.hits ?? content.hits;
          if (!Array.isArray(chunk) || !chunk.length) return;
          // A streaming aggregate resends the whole merged result; any other search sends its rows in parts.
          hits = streamingAggs ? [...chunk] : [...hits, ...chunk];
          onRows?.(hits);
        },
        error: (_payload: unknown, response: any) => {
          done();
          reject(toError(response?.content ?? {}));
        },
        complete: () => {
          done();
          resolve({
            data: {
              hits: hits.length ? hits : metadataHits,
              is_partial: isPartial,
              function_error: functionError,
            },
          });
        },
      },
    );
  });
};

export default { search };
