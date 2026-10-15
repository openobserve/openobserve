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

import { queryOptions } from "@tanstack/vue-query";
import search from "./search";
import sessions, { type SessionDetailsApiHit } from "./sessions";
import {
  sessionTurnsKeys,
  traceDagKeys,
  traceDetailsKeys,
  traceTimeRangeKeys,
} from "./search.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import type { TraceTimeRangeResult } from "@/ts/interfaces/traces/traceTimeRange.types";

/**
 * Where a trace or a session ran and its exact time range, from the trace time index.
 * `partialCoverage` means a "not_found" is not proof of absence (no index, no permission).
 */
export const traceTimeRangeQuery = (
  org: string,
  kind: "trace" | "session",
  id: string,
  hintTs: number,
) =>
  queryOptions({
    queryKey: traceTimeRangeKeys.detail(org, kind, id),
    queryFn: async (): Promise<{
      result: TraceTimeRangeResult | null;
      partialCoverage: boolean;
    }> => {
      const data = (
        await search.get_trace_time_ranges({
          org_identifier: org,
          ...(kind === "session" ? { session_ids: [id] } : { trace_ids: [id] }),
          hint_ts: hintTs,
        })
      ).data;
      return { result: data?.results?.[0] ?? null, partialCoverage: !!data?.partial_coverage };
    },
    staleTime: MEDIUM_STALE_TIME,
  });

/** A session's turns (one per trace, with its start and end), read from a window that holds the session. */
export const sessionTurnsQuery = (
  org: string,
  streamName: string,
  sessionId: string,
  startTime: number,
  endTime: number,
) =>
  queryOptions({
    queryKey: sessionTurnsKeys.detail(org, streamName, sessionId),
    queryFn: async (): Promise<SessionDetailsApiHit[]> =>
      (await sessions.details({ orgId: org, streamName, sessionId, startTime, endTime })).data
        ?.hits ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });

export const traceDagQuery = (
  org: string,
  streamName: string,
  traceId: string,
  startTime: number,
  endTime: number,
) =>
  queryOptions({
    queryKey: traceDagKeys.detail(org, streamName, traceId, startTime, endTime),
    queryFn: async () =>
      (await search.getTraceDAG(org, streamName, traceId, startTime, endTime)).data,
    // Memory only, and it expires: a trace still receiving spans would otherwise
    // keep serving the partial DAG, and this tab has no refresh control.
    staleTime: MEDIUM_STALE_TIME,
  });

/** A trace's spans, read from a window in microseconds that holds the trace. */
export const traceDetailsQuery = (
  org: string,
  streamName: string,
  traceId: string,
  startTime: number,
  endTime: number,
) =>
  queryOptions({
    queryKey: traceDetailsKeys.detail(org, streamName, traceId),
    queryFn: async (): Promise<Record<string, unknown>[]> =>
      (
        await search.get_trace_details({
          org_identifier: org,
          stream_name: streamName,
          trace_id: traceId,
          start_time: startTime,
          end_time: endTime,
          hint_ts: startTime + Math.floor((endTime - startTime) / 2),
        })
      ).data?.hits ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });
