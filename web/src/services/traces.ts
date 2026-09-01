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

import http from "./http";

// ─── Response contract ───────────────────────────────────────────────────────
// Mirrors `OrgTraceTimeRangeResponse` in
// `src/api/search/src/traces/time_index.rs`. Every optional field is omitted
// by the server rather than nulled, so absence is the normal case.

/** At most this many ids per request (`MAX_LOOKUP_KEYS` server-side). */
export const TRACE_TIME_RANGE_MAX_IDS = 100;

/**
 * `not_found` means the searched window was fully scanned without a hit;
 * `timeout` means the scan gave up, so the key may still exist.
 */
export type TraceTimeRangeStatus = "found" | "not_found" | "timeout";

/** Microseconds, matching the index's stored `min_ts`/`max_ts`. */
export interface TraceTimeRange {
  start_time: number;
  end_time: number;
}

export interface TraceTimeRangeResult {
  trace_id?: string;
  session_id?: string;
  stream?: string;
  status: TraceTimeRangeStatus;
  /** The scan timed out while expanding, so `range` is a lower bound. */
  partial?: boolean;
  range?: TraceTimeRange;
}

export interface OrgTraceTimeRangeResponse {
  results: TraceTimeRangeResult[];
  searched_range?: TraceTimeRange;
  /**
   * A candidate stream was skipped (no index, no permission, indexing
   * disabled) or a lookup ran without index coverage, so `not_found` in this
   * response is not proof of absence.
   */
  partial_coverage: boolean;
}

export interface TraceTimeRangeOptions {
  traceIds: string[];
  /** µs; sent only together with `endTime` — the server rejects a lone bound. */
  startTime?: number;
  endTime?: number;
  /** µs anchor the server's locate pass probes first. */
  hintTs?: number;
  /** Narrows the search to these trace streams. */
  streams?: string[];
}

type QueryParams = Record<string, string | number>;

const traces = {
  /** Which stream holds each trace id, and the time range it actually ran in. */
  getTraceTimeRanges: (orgId: string, options: TraceTimeRangeOptions) => {
    const params: QueryParams = { trace_id: options.traceIds.join(",") };
    if (options.startTime != null && options.endTime != null) {
      params.start_time = options.startTime;
      params.end_time = options.endTime;
    }
    if (options.hintTs != null) params.hint_ts = options.hintTs;
    if (options.streams?.length) params.streams = options.streams.join(",");
    return http().get<OrgTraceTimeRangeResponse>(`/api/${orgId}/traces/time_range`, { params });
  },
};

export default traces;
