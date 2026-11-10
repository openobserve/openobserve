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

/** 1 when the grouped trace has an errored span, else 0. Use inside `GROUP BY trace_id`. */
export const TRACE_ERRORED_SQL = "max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)";

/** Number of errored spans in the grouped trace. */
export const TRACE_ERROR_SPANS_SQL = "sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END)";

export type TraceStatus = "error" | "ok";

export function traceStatus(errorSpans: unknown): TraceStatus {
  return Number(errorSpans) > 0 ? "error" : "ok";
}
