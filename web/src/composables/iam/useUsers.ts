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
  roles: (orgId: string) => ["users", orgId, "roles"] as const,
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

  const invalidateUsers = () =>
    // Prefix match — invalidates ['users', orgId] AND ['users', orgId, 'roles'].
    queryClient.invalidateQueries({ queryKey: usersKeys.all(orgId.value) });

  // Roles for every user in the org, cached under ['users', orgId, 'roles'] and
  // shared by BOTH the list and the edit form. `ensureQueryData` returns the
  // cached map when it is still fresh (within staleTime) and only fires the
  // batched `getAllUserRoles` API when the cache is missing or stale. This is
  // the "use the cache directly, refetch only when stale" path: the list fills
  // this cache, so opening the edit form reuses it with no extra request.
  const ensureAllUserRoles = (): Promise<Record<string, string[]>> =>
    queryClient.ensureQueryData({
      queryKey: usersKeys.roles(orgId.value),
      queryFn: async () => {
        const res = await usersService.getAllUserRoles(orgId.value);
        return (res?.data ?? {}) as Record<string, string[]>;
      },
      staleTime: 1000 * 60 * 5,
    });

  // ---- Mutations: each invalidates the list on success so the table refetches ----
  //
  // Create/update accept an optional `org` because the add-user dialog can
  // target a different org ("other"/encoded) than the currently selected one.
  // We always invalidate the *current* org's list — that's the table on screen.

  const createUserMutation = useMutation({
    mutationFn: ({ payload, org }: { payload: any; org?: string }) =>
      usersService.create(payload, org ?? orgId.value),
    onSuccess: () => invalidateUsers(),
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
    onSuccess: () => invalidateUsers(),
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
    onSuccess: () => invalidateUsers(),
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
    ensureAllUserRoles,
    createUserMutation,
    updateUserMutation,
    updateExistingUserMutation,
    deleteUserMutation,
    bulkDeleteUserMutation,
  };
};

export default useUsers;
