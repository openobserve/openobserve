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

import type { TraceTimeRange } from "@/ts/interfaces/traces/traceTimeRange.types";

// A found range can be a lower bound (`partial`), and span timestamps sit at
// its very edges — pad before querying with it.
export const TRACE_RANGE_PADDING_US = 60_000_000; // ±1 min

/** The window to query a trace over: its indexed range padded, else the caller's. */
export function traceQueryWindow(
  range: TraceTimeRange | undefined,
  fallbackStartUs: number,
  fallbackEndUs: number,
): { startTime: number; endTime: number } {
  if (!range) return { startTime: fallbackStartUs, endTime: fallbackEndUs };
  return {
    startTime: range.start_time - TRACE_RANGE_PADDING_US,
    endTime: range.end_time + TRACE_RANGE_PADDING_US,
  };
}
