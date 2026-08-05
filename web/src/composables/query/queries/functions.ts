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

import TransformService from "@/services/jstransform";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";
import { useOrgQuery } from "../useOrgQuery";

export interface TransformFunction {
  name: string;
  function: string;
  [extra: string]: unknown;
}

// The endpoint is paginated but every consumer wants the whole list, so it is
// requested in one page — as it was before this went through the query cache.
const PAGE_SIZE = 100000;

export const functionsQueryOptions = (org: string) => ({
  queryKey: qk.functions.list(org),
  queryFn: async (): Promise<TransformFunction[]> =>
    (await TransformService.list(1, PAGE_SIZE, "name", false, "", org)).data.list ?? [],
  ...tierOptions("ORG_CONFIG"),
});

export const fetchFunctions = (org: string): Promise<TransformFunction[]> =>
  queryClient.fetchQuery(functionsQueryOptions(org));

export const invalidateFunctions = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.functions.root(org) });

export const useFunctionsList = () =>
  useOrgQuery<TransformFunction[]>({
    key: (org) => qk.functions.list(org),
    fetch: (org) => functionsQueryOptions(org).queryFn(),
    tier: "ORG_CONFIG",
  });
