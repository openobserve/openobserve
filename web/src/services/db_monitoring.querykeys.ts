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

import { orgKey } from "@/composables/query/keys";
import { quantizeRange } from "@/composables/query/queryClient";

/**
 * Keys only, so a write in another domain can drop this scope without importing
 * this domain's transport.
 *
 * Almost every DB-monitoring read is a window-scoped search and stays uncached;
 * what is here are the two reads that answer the same question for every tab —
 * the badge counts and the fleet roster.
 */
export const dbMonitoringKeys = {
  all: (org: string) => orgKey(org, "db_monitoring"),

  /**
   * The range the reader CHOSE, not the bounds it resolved to: the list pages
   * re-pin the anchor on every load, so a key built from the timestamps would
   * fork on each visit and never hit.
   */
  badges: (
    org: string,
    range: { type: string; startTime?: number; endTime?: number; relativeTimePeriod?: string },
    filters: Record<string, unknown>,
  ) =>
    orgKey(
      org,
      "db_monitoring",
      "badges",
      range.type === "absolute"
        ? { abs: quantizeRange(range.startTime ?? 0, range.endTime ?? 0) }
        : { rel: range.relativeTimePeriod ?? "" },
      filters,
    ),

  /** Bucketed: the picker's window is re-pinned on every refresh, to the microsecond. */
  instances: (org: string, startTime?: number, endTime?: number) =>
    orgKey(
      org,
      "db_monitoring",
      "instances",
      startTime === undefined || endTime === undefined ? "all" : quantizeRange(startTime, endTime),
    ),
};
