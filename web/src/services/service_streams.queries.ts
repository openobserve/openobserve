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
import serviceStreamsApi, { type FieldAlias, type ServiceIdentityConfig } from "./service_streams";
import { serviceStreamKeys } from "./service_streams.querykeys";
import { CONFIG_STALE_TIME, SESSION_STALE_TIME } from "@/composables/query/cachePolicy";

/** `retry: false` because both callers treat a miss as "no config" and carry on, so retries would only hold the traces field list behind backoffs. */
export const semanticGroupsQuery = (org: string) =>
  queryOptions({
    queryKey: serviceStreamKeys.semanticGroups(org),
    queryFn: async (): Promise<FieldAlias[]> =>
      (await serviceStreamsApi.getSemanticGroups(org)).data,
    staleTime: CONFIG_STALE_TIME,
    // Read through `getQueryData` by callers that never load, so it must outlive the default 5 min GC as the old map did.
    gcTime: SESSION_STALE_TIME,
    retry: false,
  });

export const identityConfigQuery = (org: string) =>
  queryOptions({
    queryKey: serviceStreamKeys.identityConfig(org),
    queryFn: async (): Promise<ServiceIdentityConfig> =>
      (await serviceStreamsApi.getIdentityConfig(org)).data,
    staleTime: CONFIG_STALE_TIME,
    gcTime: SESSION_STALE_TIME,
    retry: false,
  });
