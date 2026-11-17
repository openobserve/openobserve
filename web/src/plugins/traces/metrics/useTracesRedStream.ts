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
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

export interface RedStreamRequest {
  sql: string;
  size: number;
  startTime: number;
  endTime: number;
}

/** Runs one RED query at a time over _search_stream; a new run cancels the last, whose callbacks never fire. */
export function useTracesRedStream() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  let current: string | null = null;

  const orgId = () => store.state.selectedOrganization?.identifier;

  const cancel = () => {
    if (!current) return;
    cancelStreamQueryBasedOnRequestId({ trace_id: current, org_id: orgId() });
    current = null;
  };

  const run = (
    request: RedStreamRequest,
    done: (hits: Record<string, unknown>[]) => void,
    failed: (message: string) => void,
  ) => {
    cancel();
    const { traceId } = generateTraceContext();
    current = traceId;
    let hits: Record<string, unknown>[] = [];
    // A streaming aggregate sends its running total each partition; anything else sends new rows.
    let replace = false;
    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          query: {
            sql: b64EncodeUnicode(request.sql),
            start_time: request.startTime,
            end_time: request.endTime,
            from: 0,
            size: request.size,
          },
          encoding: "base64",
        },
        type: "search",
        traceId,
        org_id: orgId(),
        pageType: "traces",
        searchType: "ui",
      },
      {
        data: (_payload: unknown, response: any) => {
          if (current !== traceId) return;
          const results = response?.content?.results;
          if (response?.type === "search_response_metadata") {
            replace ||= !!(results?.streaming_aggs ?? response?.content?.streaming_aggs);
            return;
          }
          if (response?.type !== "search_response_hits") return;
          const batch = results?.hits ?? response?.content?.hits ?? [];
          hits = replace ? [...batch] : [...hits, ...batch];
        },
        error: (_payload: unknown, err: any) => {
          if (current !== traceId) return;
          current = null;
          failed(String(err?.content?.message || err?.message || ""));
        },
        complete: () => {
          if (current !== traceId) return;
          current = null;
          done(hits);
        },
      },
    );
  };

  onBeforeUnmount(cancel);

  return { run, cancel };
}
