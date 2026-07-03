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

import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import usersService from "@/services/users";
import config from "@/aws-exports";

/**
 * Query key factory — every users query/mutation is scoped to the current org
 * so switching orgs produces a different cache entry (no cross-org leakage) and
 * invalidation is a single call.
 */
export const usersKeys = {
  all: (orgId: string) => ["users", orgId] as const,
  detail: (orgId: string, email: string) => ["users", orgId, email] as const,
  // Roles caches live under their OWN top-level namespaces (not nested under
  // ['users', orgId]) so invalidating the users list never wipes them.
  //
  // Two distinct resources at two granularities:
  //  - rolesAll: the batched getAllUserRoles map, used by the LIST.
  //  - userRoles: one user's roles from the per-user getUserRoles API, used by
  //    the EDIT dialog — each user gets its OWN key.
  // The namespaces differ ("user-roles-all" vs "user-roles") so they do not
  // prefix-collide with each other.
  rolesAll: (orgId: string) => ["user-roles-all", orgId] as const,
  userRoles: (orgId: string, email: string) =>
    ["user-roles", orgId, email] as const,
};

/**
 * TanStack Query wrapper around the users service. Components consume this
 * instead of calling `usersService` directly, so the org users list is cached,
 * de-duplicated, and refetched automatically after any mutation.
 */
const useUsers = () => {
  const store = useStore();
  const queryClient = useQueryClient();

  // Reactive org id — the query key depends on it, so switching orgs refetches
  // for the new org automatically.
  const orgId = computed(
    () => store.state.selectedOrganization?.identifier ?? "",
  );

  // Fetch org members. On cloud the pending invites are merged in, matching the
  // existing behaviour of the users list.
  const fetchOrgUsers = async (): Promise<any[]> => {
    const res = await usersService.orgUsers(orgId.value);
    let users: any[] = Array.isArray(res.data?.data) ? [...res.data.data] : [];

    if (config.isCloud === "true") {
      try {
        const invited = await usersService.invitedUsers(orgId.value);
        if (invited?.status === 200 && Array.isArray(invited.data)) {
          users = [...users, ...invited.data];
        }
      } catch {
        // Invited-members fetch is best-effort; fall back to org members only.
      }
    }

    return users;
  };

  const usersQuery = useQuery({
    queryKey: computed(() => usersKeys.all(orgId.value)),
    queryFn: fetchOrgUsers,
    // Don't fire until an org is selected.
    enabled: computed(() => !!orgId.value),
  });

  // Invalidates ONLY the users list (['users', orgId]) — not the roles caches.
  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });

  // Invalidates the roles caches after a mutation that changes role assignments.
  // Always refreshes the batched map; if an email is given, only that user's
  // per-user entry is invalidated, otherwise every per-user entry is.
  const invalidateUserRoles = (email?: string) => {
    queryClient.invalidateQueries({ queryKey: usersKeys.rolesAll(orgId.value) });
    queryClient.invalidateQueries({
      queryKey: email
        ? usersKeys.userRoles(orgId.value, email)
        : ["user-roles", orgId.value], // prefix → all per-user entries
    });
  };

  // Batched roles map for the LIST — one getAllUserRoles call, cached under
  // ['user-roles-all', orgId]. Served from cache while fresh; only refetched
  // when missing or stale.
  const ensureAllUserRoles = (): Promise<Record<string, string[]>> =>
    queryClient.ensureQueryData({
      queryKey: usersKeys.rolesAll(orgId.value),
      queryFn: async () => {
        const res = await usersService.getAllUserRoles(orgId.value);
        return (res?.data ?? {}) as Record<string, string[]>;
      },
      staleTime: 1000 * 60 * 5,
    });

  // One user's roles for the EDIT dialog — its OWN key ['user-roles', orgId,
  // email]. Reopening the same user reuses this entry. It is first seeded from
  // the batched list map (inheriting that fetch's age), so when the list already
  // loaded this user's roles NO per-user API call is made; only a genuine miss
  // or a stale entry fires the single-user getUserRoles API.
  const ensureUserRoles = (email: string): Promise<string[]> => {
    const key = usersKeys.userRoles(orgId.value, email);
    if (queryClient.getQueryData(key) === undefined) {
      const batch = queryClient.getQueryState(usersKeys.rolesAll(orgId.value));
      const seeded = batch?.data
        ? (batch.data as Record<string, string[]>)[email]
        : undefined;
      if (seeded !== undefined) {
        queryClient.setQueryData(key, seeded, {
          updatedAt: batch?.dataUpdatedAt,
        });
      }
    }
    return queryClient.ensureQueryData({
      queryKey: key,
      queryFn: async () => {
        const res = await usersService.getUserRoles(orgId.value, email);
        return (res?.data ?? []) as string[];
      },
      staleTime: 1000 * 60 * 5,
    });
  };

  // ---- Mutations: each invalidates the list on success so the table refetches ----
  //
  // Create/update accept an optional `org` because the add-user dialog can
  // target a different org ("other"/encoded) than the currently selected one.
  // We always invalidate the *current* org's list — that's the table on screen.

  // Role-changing mutations invalidate BOTH the list and the roles cache so the
  // updated roles are reflected. Delete/bulk-delete only touch the list.

  const createUserMutation = useMutation({
    mutationFn: ({ payload, org }: { payload: any; org?: string }) =>
      usersService.create(payload, org ?? orgId.value),
    onSuccess: () => {
      invalidateUsers();
      invalidateUserRoles();
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({
      email,
      payload,
      org,
    }: {
      email: string;
      payload: any;
      org?: string;
    }) => usersService.update(payload, org ?? orgId.value, email),
    onSuccess: (_data, variables) => {
      invalidateUsers();
      invalidateUserRoles(variables.email);
    },
  });

  // Adding an already-existing platform user to this org (role-only payload).
  const updateExistingUserMutation = useMutation({
    mutationFn: ({
      email,
      payload,
      org,
    }: {
      email: string;
      payload: any;
      org?: string;
    }) => usersService.updateexistinguser(payload, org ?? orgId.value, email),
    onSuccess: (_data, variables) => {
      invalidateUsers();
      invalidateUserRoles(variables.email);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (email: string) => usersService.delete(orgId.value, email),
    onSuccess: () => invalidateUsers(),
  });

  const bulkDeleteUserMutation = useMutation({
    mutationFn: (emails: string[]) =>
      usersService.bulkDelete(orgId.value, { ids: emails }),
    onSuccess: () => invalidateUsers(),
  });

  return {
    usersKeys,
    orgId,
    usersQuery,
    invalidateUsers,
    invalidateUserRoles,
    ensureAllUserRoles,
    ensureUserRoles,
    createUserMutation,
    updateUserMutation,
    updateExistingUserMutation,
    deleteUserMutation,
    bulkDeleteUserMutation,
  };
};

export default useUsers;
