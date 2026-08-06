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

/**
 * Trace DAG — the strongest cache candidate in the app.
 *
 * A trace is immutable once written, so the DAG for a given trace id can never
 * change: `staleTime: Infinity`, and persisted to IndexedDB rather than
 * localStorage because a wide trace's graph is large. Re-opening a trace you
 * looked at earlier — including after a reload — costs nothing.
 */

import searchService from "@/services/search";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const traceDagOptions = (
  org: string,
  streamName: string,
  traceId: string,
  startTime: number,
  endTime: number,
) => ({
  // The window is part of the key: the endpoint bounds which spans it walks, so
  // a different start/end can legitimately yield a different graph. Only the
  // trace being immutable is what makes each window cacheable forever.
  queryKey: [...qk.traces.dag(org, traceId), streamName, startTime, endTime] as const,
  queryFn: async (): Promise<any> =>
    (await searchService.getTraceDAG(org, streamName, traceId, startTime, endTime)).data,
  ...tierOptions("HEAVY_RESULT"),
  // The tier's staleTime of 0 is for panel results, which re-run against a
  // moving time range. A trace never changes, so this one never goes stale.
  staleTime: Infinity,
});

export const fetchTraceDag = (
  org: string,
  streamName: string,
  traceId: string,
  startTime: number,
  endTime: number,
): Promise<any> =>
  queryClient.fetchQuery(traceDagOptions(org, streamName, traceId, startTime, endTime));
