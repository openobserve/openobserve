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

export const orgUsersQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.users(org),
    queryFn: async (): Promise<any[]> => (await users.orgUsers(org)).data?.data ?? [],
    refetchOnWindowFocus: true,
  });

export const pendingInvitesQuery = (org: string) =>
  queryOptions({
    queryKey: userKeys.invitations(org),
    queryFn: async () => (await users.getPendingInvites()).data,
    refetchOnWindowFocus: true,
  });
