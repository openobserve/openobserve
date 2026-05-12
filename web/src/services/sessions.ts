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

/** Single session row returned by the backend's session endpoint. */
export interface SessionApiHit {
  session_id: string;
  /** Earliest span `start_time` in the session (microseconds). */
  start_time: number;
  /** Latest span `end_time` in the session (microseconds). */
  end_time: number;
  /** end_time - start_time (microseconds). */
  duration: number;
  /** Distinct trace_ids in the session = number of conversation turns. */
  trace_count: number;
  gen_ai_usage_input_tokens: number;
  gen_ai_usage_output_tokens: number;
  gen_ai_usage_total_tokens: number;
  gen_ai_usage_cost: number;
}

export interface SessionApiResponse {
  took: number;
  total: number;
  from: number;
  size: number;
  hits: SessionApiHit[];
  trace_id?: string;
  function_error?: string;
}

const sessions = {
  /**
   * Fetch the paginated session list from
   * `GET /api/{org_id}/{stream_name}/traces/session`.
   *
   * Server expects microsecond timestamps for `start_time`/`end_time` and
   * does the GROUP BY + per-session aggregation in two phases (session →
   * trace_id list, then per-trace gen_ai usage rollup) so the frontend
   * doesn't need to build the SQL itself.
   *
   * @example
   *   await sessions.list({
   *     orgId: "default",
   *     streamName: "default",
   *     startTime: 1700000000000000,
   *     endTime:   1700001000000000,
   *     page: 0,
   *     pageSize: 25,
   *   });
   */
  list: ({
    orgId,
    streamName,
    startTime,
    endTime,
    page = 0,
    pageSize = 25,
    filter = "",
    timeout,
  }: {
    orgId: string;
    streamName: string;
    startTime: number;
    endTime: number;
    page?: number;
    pageSize?: number;
    filter?: string;
    timeout?: number;
  }) => {
    const params = new URLSearchParams({
      from: String(page * pageSize),
      size: String(pageSize),
      start_time: String(startTime),
      end_time: String(endTime),
    });
    if (filter) params.set("filter", filter);
    if (timeout) params.set("timeout", String(timeout));
    const url = `/api/${orgId}/${encodeURIComponent(
      streamName,
    )}/traces/session?${params.toString()}`;
    return http().get<SessionApiResponse>(url);
  },
};

export default sessions;
