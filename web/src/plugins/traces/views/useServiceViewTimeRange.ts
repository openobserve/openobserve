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

import type { Router } from "vue-router";

/**
 * Apply `?period=` / `?from=`+`?to=` from the URL to the shared traces datetime.
 *
 * The Traces page has always supported these params (see `restoreUrlQueryParams`
 * in plugins/traces/Index.vue). When Service Graph and Services Catalog were
 * tabs on that page they inherited the behaviour for free; now that each is its
 * own route, they have to read the params themselves — otherwise a link like
 * `/traces/services?period=7d` silently renders the 15-minute default.
 *
 * @returns true when the URL specified a range (so the caller can skip its own
 *          default), false when it did not.
 */
export function applyUrlTimeRange(router: Router, datetime: Record<string, any>): boolean {
  const q = router.currentRoute.value.query;

  const from = typeof q.from === "string" ? Number(q.from) : NaN;
  const to = typeof q.to === "string" ? Number(q.to) : NaN;
  if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > 0) {
    datetime.startTime = from;
    datetime.endTime = to;
    datetime.type = "absolute";
    datetime.relativeTimePeriod = null;
    return true;
  }

  const period = typeof q.period === "string" ? q.period.trim() : "";
  if (period) {
    datetime.relativeTimePeriod = period;
    datetime.type = "relative";
    return true;
  }

  return false;
}
