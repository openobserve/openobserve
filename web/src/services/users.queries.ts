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
import users, { type AllUsersParams } from "./users";
import type { UserListPage } from "@/ts/interfaces";
import { userKeys } from "./users.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { stableFilters } from "@/composables/query/queryClient";

export const orgUsersQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.users(org),
    queryFn: async (): Promise<any[]> => (await users.orgUsers(org)).data?.data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/** Org configuration — the same option list for every user form and the list page. */
export const assignableRolesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.assignableRoles(org),
    queryFn: async () => (await users.getRoles(org)).data,
    staleTime: NORMAL_STALE_TIME,
  });

/** Read by both the users list and the roles list — one entry, not one each. */
export const allUserRolesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.allUserRoles(org),
    queryFn: async () => (await users.getAllUserRoles(org)).data ?? null,
    staleTime: NORMAL_STALE_TIME,
  });

export const allUsersQuery = (metaOrg: string, params: AllUsersParams) => {
  const filters = stableFilters({ ...params });
  return queryOptions({
    queryKey: userKeys.allUsers(metaOrg, filters),
    queryFn: async (): Promise<UserListPage> => {
      const page = (await users.listAllUsers(metaOrg, filters)).data;
      return { data: page?.data ?? [], total: page?.total ?? 0 };
    },
    staleTime: NORMAL_STALE_TIME,
  });
};
