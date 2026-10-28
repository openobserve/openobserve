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
import overview from "./overview";
import { overviewKeys } from "./overview.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import type { OrgOverview } from "@/ts/interfaces/overview";

export const OVERVIEW_TOP = 5;

// `refresh` stays out of the key so a forced read replaces the cached entry instead of forking it.
export const orgOverviewQuery = (org: string, opts: { top?: number; refresh?: boolean } = {}) => {
  const top = opts.top ?? OVERVIEW_TOP;
  return queryOptions({
    queryKey: overviewKeys.data(org, top),
    queryFn: async (): Promise<OrgOverview> =>
      (await overview.getOrgOverview(org, { top, refresh: opts.refresh })).data,
    staleTime: LIVE_STALE_TIME,
  });
};
