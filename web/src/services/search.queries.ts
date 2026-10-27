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
import { traceDagKeys } from "./search.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

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
