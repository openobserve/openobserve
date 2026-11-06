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

import { onBeforeUnmount, ref } from "vue";
import store from "@/stores";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";

export type AlertStreamQueryState = "idle" | "loading" | "ready" | "failed";

export interface AlertStreamQueryRequest {
  sql: string;
  streamType: string;
  startTime: number;
  endTime: number;
  size: number;
}

/** One SQL search over the streaming endpoint, collecting every chunk of hits; a new run cancels the last. */
export function useAlertStreamQuery() {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const state = ref<AlertStreamQueryState>("idle");
  const hits = ref<Record<string, unknown>[]>([]);
  let traceId: string | null = null;

  const cancel = () => {
    if (!traceId) return;
    cancelStreamQueryBasedOnRequestId({
      trace_id: traceId,
      org_id: store.state.selectedOrganization.identifier,
    });
    traceId = null;
  };

  const run = (request: AlertStreamQueryRequest) => {
    cancel();
    const mine = generateTraceContext().traceId;
    traceId = mine;
    hits.value = [];
    state.value = "loading";
    const owns = () => traceId === mine;
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
        traceId: mine,
        org_id: store.state.selectedOrganization.identifier,
        pageType: request.streamType || "logs",
        searchType: "ui",
      },
      {
        data: (_payload: unknown, response: any) => {
          if (!owns() || response?.type !== "search_response_hits") return;
          hits.value = [...hits.value, ...(response.content?.results?.hits ?? [])];
        },
        error: () => {
          if (!owns()) return;
          state.value = "failed";
          traceId = null;
        },
        complete: () => {
          if (!owns()) return;
          state.value = "ready";
          traceId = null;
        },
        reset: () => {},
      },
    );
  };

  onBeforeUnmount(cancel);

  return { state, hits, run, cancel };
}
