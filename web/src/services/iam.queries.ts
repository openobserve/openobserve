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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import {
  getGroups,
  getRoles,
  getResources,
  getAllRolePermissions,
  createGroup,
  updateGroup,
  deleteGroup,
  bulkDeleteGroups,
  createRole,
  updateRole,
  deleteRole,
  bulkDeleteRoles,
} from "./iam";
import { iamKeys } from "./iam.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const groupsQuery = (org: string) =>
  queryOptions({
    queryKey: iamKeys.groups(org),
    queryFn: async () => (await getGroups(org)).data,
    refetchOnWindowFocus: true,
  });

export const rolesQuery = (org: string) =>
  queryOptions({
    queryKey: iamKeys.roles(org),
    queryFn: async () => (await getRoles(org)).data,
    refetchOnWindowFocus: true,
  });

export const resourcesQuery = (org: string) =>
  queryOptions({
    queryKey: iamKeys.resources(org),
    queryFn: async () => (await getResources(org)).data,
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

export const rolePermissionsQuery = (org: string, roleName: string) =>
  queryOptions({
    queryKey: iamKeys.rolePermissions(org, roleName),
    queryFn: async () =>
      (await getAllRolePermissions({ role_name: roleName, org_identifier: org })).data,
  });

// ── Writes ──────────────────────────────────────────────────────────────────
//
// Each declares the scope it drops. Call sites use `useMutation(x(org))` and
// never touch the cache themselves.

export const createGroupMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name: string) => createGroup(name, org),
    meta: { invalidates: [iamKeys.groupsAll(org)], silentError: true },
  });

export const updateGroupMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { group_name: string; payload: any }) =>
      updateGroup({ group_name: vars.group_name, org_identifier: org, payload: vars.payload }),
    meta: { invalidates: [iamKeys.groupsAll(org)], silentError: true },
  });

export const deleteGroupMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name: string) => deleteGroup(name, org),
    meta: { invalidates: [iamKeys.groupsAll(org)], silentError: true },
  });

export const bulkDeleteGroupsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (names: string[]) => bulkDeleteGroups(org, { ids: names }),
    meta: { invalidates: [iamKeys.groupsAll(org)], silentError: true },
  });

export const createRoleMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name: string) => createRole(name, org),
    meta: { invalidates: [iamKeys.rolesAll(org)], silentError: true },
  });

export const updateRoleMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { role_id: string; payload: any }) =>
      updateRole({ role_id: vars.role_id, org_identifier: org, payload: vars.payload }),
    meta: { invalidates: [iamKeys.rolesAll(org)], silentError: true },
  });

export const deleteRoleMutation = (org: string) =>
  mutationOptions({
    mutationFn: (roleId: string) => deleteRole(roleId, org),
    meta: { invalidates: [iamKeys.rolesAll(org)], silentError: true },
  });

export const bulkDeleteRolesMutation = (org: string) =>
  mutationOptions({
    mutationFn: (names: string[]) => bulkDeleteRoles(org, { ids: names }),
    meta: { invalidates: [iamKeys.rolesAll(org)], silentError: true },
  });
