import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";

// ----------- Groups -------------
export const getGroups = (org_identifier: string) => {
  const url = `/api/${org_identifier}/groups`;
  return http().get(url);
};

export const getGroup = (group_name: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/groups/${group_name}`;
  return http().get(url);
};

export const deleteGroup = (group_name: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/groups/${group_name}`;
  return http().delete(url);
};

export const bulkDeleteGroups = (org_identifier: string, data: any) => {
  const url = `/api/${org_identifier}/groups/bulk`;
  return http().delete(url, { data });
};

export const createGroup = (group_name: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/groups`;
  return http({}).post(url, {
    name: group_name,
    users: [],
    roles: [],
  });
};

export const updateGroup = (group: {
  group_name: string;
  org_identifier: string;
  payload: {
    add_roles: string[];
    remove_roles: string[];
    add_users: string[];
    remove_users: string[];
  };
}) => {
  const url = `/api/${group.org_identifier}/groups/${group.group_name}`;
  return http().put(url, group.payload);
};

// ----------- Roles -------------

export const getRoles = (org_identifier: string) => {
  const url = `/api/${org_identifier}/roles`;
  return http().get(url);
};

export const getRole = (role_id: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/roles/${role_id}`;
  return http().get(url);
};

export const deleteRole = (role_id: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/roles/${role_id}`;
  return http().delete(url);
};

export const bulkDeleteRoles = (org_identifier: string, data: any) => {
  const url = `/api/${org_identifier}/roles/bulk`;
  return http().delete(url, { data });
};

export const createRole = (role_id: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/roles`;
  return http({}).post(url, {
    role: role_id,
  });
};

export const updateRole = (role: { role_id: string; org_identifier: string; payload: any }) => {
  const url = `/api/${role.org_identifier}/roles/${role.role_id}`;
  return http().put(url, role.payload);
};

export const getResources = (org_identifier: string) => {
  const url = `/api/${org_identifier}/resources`;
  return http().get(url);
};

export const getRoleUsers = (role_name: string, org_identifier: string) => {
  const url = `/api/${org_identifier}/roles/${role_name}/users`;
  return http().get(url);
};

// ----------- Permissions -------------

export const getResourcePermission = ({
  role_name,
  org_identifier,
  resource,
}: {
  role_name: string;
  org_identifier: string;
  resource: string;
}) => {
  const url = `/api/${org_identifier}/roles/${role_name}/permissions/${resource}`;
  return http().get(url);
};

export const getAllRolePermissions = ({
  role_name,
  org_identifier,
}: {
  role_name: string;
  org_identifier: string;
}) => {
  const url = `/api/${org_identifier}/roles/${role_name}/permissions`;
  return http().get(url);
};

/**
 * Groups and roles are read from six places — both list pages, the role editor,
 * the group editor, the service-account form and the quota page.
 */
export const groupsQuery = defineQuery<[], any>({
  key: ["iam", "groups"],
  fetch: async (org) => (await getGroups(org)).data,
  tier: "ENTITY_LIST",
  scope: ["iam", "groups"],
});

export const rolesQuery = defineQuery<[], any>({
  key: ["iam", "roles"],
  fetch: async (org) => (await getRoles(org)).data,
  tier: "ENTITY_LIST",
  scope: ["iam", "roles"],
});

/** Enum-like: it enumerates what the product can grant permissions on. */
export const resourcesQuery = defineQuery<[], any>({
  key: ["iam", "resources"],
  fetch: async (org) => (await getResources(org)).data,
  tier: "ORG_CONFIG",
  scope: ["iam", "resources"],
});

export const rolePermissionsQuery = defineQuery<[roleName: string], any>({
  key: (roleName) => ["iam", "roles", "permissions", roleName],
  fetch: async (org, roleName) =>
    (await getAllRolePermissions({ role_name: roleName, org_identifier: org })).data,
  tier: "ENTITY_DETAIL",
  scope: ["iam", "roles"],
});
