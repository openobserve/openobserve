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

import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { orgKey } from "@/composables/query/keys";

import { listOrgRcaRuns, type OrgRcaRunsParams } from "./rca_runs_org";

// Under the incidents scope, so an incident write that starts or cancels a run refreshes these lists too.
export const orgRcaRunsKey = (org: string, params: OrgRcaRunsParams) =>
  orgKey(org, "incidents", "rca_runs_org", { ...params });

export const orgRcaRunsQuery = (org: string, params: OrgRcaRunsParams = {}) =>
  queryOptions({
    queryKey: orgRcaRunsKey(org, params),
    queryFn: async () => (await listOrgRcaRuns(org, params)).data,
    staleTime: LIVE_STALE_TIME,
  });
