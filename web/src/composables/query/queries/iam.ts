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

/**
 * IAM reads. Groups and roles are requested from half a dozen places — the two
 * list pages, the role editor, the group editor, the service-account form and
 * the quota page — so they are the clearest dedup win in this area.
 *
 * The resource catalogue is an enum in practice: it enumerates what the product
 * can grant permissions on, which only changes with a release.
 */

import { getGroups, getRoles, getResources, getAllRolePermissions } from "@/services/iam";
import usersService from "@/services/users";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

const groupsOptions = (org: string) => ({
  queryKey: qk.iam.groups(org),
  queryFn: async (): Promise<any> => (await getGroups(org)).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchGroups = (org: string): Promise<any> =>
  queryClient.fetchQuery(groupsOptions(org));

export const refetchGroups = (org: string): Promise<any> =>
  queryClient.fetchQuery({ ...groupsOptions(org), staleTime: 0 });

export const invalidateGroups = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.iam.groups(org) });

const rolesOptions = (org: string) => ({
  queryKey: qk.iam.roles(org),
  queryFn: async (): Promise<any> => (await getRoles(org)).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchRoles = (org: string): Promise<any> => queryClient.fetchQuery(rolesOptions(org));

export const refetchRoles = (org: string): Promise<any> =>
  queryClient.fetchQuery({ ...rolesOptions(org), staleTime: 0 });

export const invalidateRoles = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.iam.roles(org) });

const resourcesOptions = (org: string) => ({
  queryKey: [...qk.iam.root(org), "resources"] as const,
  queryFn: async (): Promise<any> => (await getResources(org)).data,
  // Enum-like and needed before the role editor can paint.
  ...tierOptions("ORG_CONFIG"),
});

export const fetchResources = (org: string): Promise<any> =>
  queryClient.fetchQuery(resourcesOptions(org));

const rolePermissionsOptions = (org: string, roleName: string) => ({
  queryKey: [...qk.iam.roles(org), "permissions", roleName] as const,
  queryFn: async (): Promise<any> =>
    (await getAllRolePermissions({ role_name: roleName, org_identifier: org })).data,
  ...tierOptions("ENTITY_DETAIL"),
});

export const fetchRolePermissions = (org: string, roleName: string): Promise<any> =>
  queryClient.fetchQuery(rolePermissionsOptions(org, roleName));

export const invalidateRolePermissions = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.iam.roles(org) });

const invitesOptions = (org: string) => ({
  queryKey: qk.iam.invitations(org),
  queryFn: async (): Promise<any> => (await usersService.getPendingInvites()).data,
  ...tierOptions("ENTITY_LIST"),
});

export const fetchPendingInvites = (org: string): Promise<any> =>
  queryClient.fetchQuery(invitesOptions(org));

export const refetchPendingInvites = (org: string): Promise<any> =>
  queryClient.fetchQuery({ ...invitesOptions(org), staleTime: 0 });

export const invalidateInvitations = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.iam.invitations(org) });
