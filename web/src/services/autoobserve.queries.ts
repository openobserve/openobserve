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
import autoobserve, {
  type AutoObserveCoverage,
  type AutoObserveCoverageView,
  type AutoObserveSuggestionList,
} from "./autoobserve";
import { autoobserveKeys } from "./autoobserve.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

export const autoobserveCoverageQuery = (org: string, view: AutoObserveCoverageView) =>
  queryOptions({
    queryKey: autoobserveKeys.coverage(org, view),
    queryFn: async (): Promise<AutoObserveCoverage> => (await autoobserve.coverage(org, view)).data,
    staleTime: LIVE_STALE_TIME,
  });

// One page of proposed suggestions in the panel's rank order; total counts every proposed one.
export const autoobserveSuggestionsPageQuery = (org: string, limit: number, offset: number) =>
  queryOptions({
    queryKey: autoobserveKeys.suggestionsPage(org, limit, offset),
    queryFn: async (): Promise<AutoObserveSuggestionList> =>
      (
        await autoobserve.suggestions(org, {
          status: "proposed",
          sort: "priority",
          limit,
          offset,
        })
      ).data,
    staleTime: LIVE_STALE_TIME,
  });
