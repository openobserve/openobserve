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

import { onScopeDispose } from "vue";

import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";

import type { IdentityValues } from "./streamCandidates";

const WINDOW_US = 24 * 60 * 60 * 1_000_000;
const TOP_VALUES = 10;

/** Top values of a stream's identity fields over the streaming endpoint; a failure proves nothing. */
export function useStreamValues(org: string) {
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
  const running = new Set<string>();

  const readValues = (stream: string, fields: string[], type = "logs") =>
    new Promise<IdentityValues>((resolve) => {
      const traceId = generateTraceContext()?.traceId ?? "";
      const end = Date.now() * 1000;
      const found: IdentityValues = {};
      const finish = () => {
        running.delete(traceId);
        resolve(found);
      };
      running.add(traceId);
      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            stream_name: stream,
            start_time: end - WINDOW_US,
            end_time: end,
            fields,
            size: TOP_VALUES,
            stream_type: type,
            use_cache: false,
            no_count: false,
            sql: "",
          },
          type: "values",
          traceId,
          org_id: org,
          pageType: type,
          searchType: "UI",
        },
        {
          data: (_request, response) => {
            if (response.type !== "search_response_hits") return;
            for (const hit of response.content?.results?.hits ?? []) {
              const values = (hit.values ?? []).map((row: any) => String(row.zo_sql_key));
              found[hit.field] = [...new Set([...(found[hit.field] ?? []), ...values])];
            }
          },
          error: finish,
          complete: finish,
        },
      );
    });

  onScopeDispose(() => {
    for (const trace_id of running) cancelStreamQueryBasedOnRequestId({ trace_id, org_id: org });
  });

  return { readValues };
}
