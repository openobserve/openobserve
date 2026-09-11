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
import queryFunctions from "./query_functions";
import { queryFunctionKeys } from "./query_functions.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const queryFunctionsQuery = (org: string) =>
  queryOptions({
    queryKey: queryFunctionKeys.catalogue(org),
    queryFn: async (): Promise<any[]> => {
      try {
        return (await queryFunctions.list(org)).data?.list ?? [];
      } catch (e: any) {
        // A backend older than the catalogue endpoint answers 404. That is a
        // stable fact about the deployment, not a transient failure — cache the
        // empty catalogue so it is asked once instead of on every staleTime
        // boundary. Autocomplete falls back to its local list either way.
        if (e?.response?.status === 404) return [];
        throw e;
      }
    },
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });
