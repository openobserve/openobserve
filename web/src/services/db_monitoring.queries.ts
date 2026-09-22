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

import dbMonitoringService, { type DbmInstanceHit } from "./db_monitoring";
import { dbMonitoringKeys } from "./db_monitoring.querykeys";
import { MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

// The `/badges` declaration lives beside its fold in composables/dbm/useDbmTabCounts.ts, or the two would import each other.

/**
 * The org's engines, as `/instances` names them.
 *
 * MEDIUM: the roster only moves when an engine starts or stops reporting, and
 * six routes render the same picker — one entry answers all of them. The key
 * buckets the window because every page re-pins its anchor on load; the request
 * still carries the caller's exact bounds.
 */
export const dbmInstancesQuery = (org: string, startTime?: number, endTime?: number) =>
  queryOptions({
    queryKey: dbMonitoringKeys.instances(org, startTime, endTime),
    queryFn: async (): Promise<DbmInstanceHit[]> =>
      (await dbMonitoringService.getInstances(org, { startTime, endTime }))?.data?.hits ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });
