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
import users from "./users";
import { userKeys } from "./users.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";

export const orgUsersQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.users(org),
    queryFn: async (): Promise<any[]> => (await users.orgUsers(org)).data?.data ?? [],
    refetchOnWindowFocus: true,
  });

/** Org configuration — the same option list for every user form and the list page. */
export const assignableRolesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.assignableRoles(org),
    queryFn: async () => (await users.getRoles(org)).data,
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
  });

/** Read by both the users list and the roles list — one entry, not one each. */
export const allUserRolesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.allUserRoles(org),
    queryFn: async () => (await users.getAllUserRoles(org)).data ?? null,
    refetchOnWindowFocus: true,
  });

export const pendingInvitesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.invitations(org),
    queryFn: async () => (await users.getPendingInvites()).data,
    refetchOnWindowFocus: true,
  });
