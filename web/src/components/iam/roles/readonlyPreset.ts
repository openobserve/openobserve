// Copyright 2026 OpenObserve Inc.
//
// Headless "read-only" role seeding — the programmatic equivalent of picking
// the "Read-only" preset in AddRole and saving on the EditRole page
// (seedReadonlyPreset + Save), for callers that create a role without
// navigating there (e.g. the service-account create flow). Grants AllowList +
// AllowGet on every visible top-level resource of the org, so a freshly
// created role is immediately usable for querying instead of silently empty.

import { getResources, updateRole } from "@/services/iam";

export interface RolePermission {
  object: string;
  permission: string;
}

const READONLY_PERMS = ["AllowList", "AllowGet"];

// Per-resource exclusions mirroring EditRole's modifyResourcePermissions()
// (the permission checkboxes it hides). Kept in sync BY HAND — when a resource
// gains/loses a hidden read permission there, update this map too.
const HIDDEN_READONLY_PERMS: Record<string, string[]> = {
  settings: ["AllowList"],
  logs_pattern: ["AllowList"],
  logs_insights: ["AllowList"],
  logs_cache: ["AllowList", "AllowGet"],
};

// Same permission-object format EditRole saves: `<resource>:_all_<org>` for a
// top-level (whole-resource-type) grant. `isMetaOrg` mirrors EditRole's
// setPermission guard: the `org` resource is only grantable from the meta org
// (EditRole skips it entirely otherwise), so a non-meta seeding must exclude
// it or it would grant a permission the Roles UI can neither show nor revoke.
export const buildReadonlyPermissions = (
  resources: Array<{ key: string; visible?: boolean; parent?: string }>,
  orgId: string,
  isMetaOrg: boolean,
): RolePermission[] => {
  const entity = `_all_${orgId}`;
  const permissions: RolePermission[] = [];
  resources
    .filter((resource) => resource.visible && !resource.parent)
    .filter((resource) => resource.key !== "org" || isMetaOrg)
    .forEach((resource) => {
      READONLY_PERMS.forEach((permission) => {
        if (HIDDEN_READONLY_PERMS[resource.key]?.includes(permission)) return;
        permissions.push({
          object: `${resource.key}:${entity}`,
          permission,
        });
      });
    });
  return permissions;
};

// Returns the number of permissions granted (0 = nothing applicable, no save
// performed) so callers can report an honest outcome instead of assuming
// success meant a usable role.
export const seedReadonlyRolePermissions = async (
  roleName: string,
  orgId: string,
  isMetaOrg: boolean,
): Promise<number> => {
  const res = await getResources(orgId);
  const add = buildReadonlyPermissions(res.data ?? [], orgId, isMetaOrg);
  if (!add.length) return 0;
  await updateRole({
    role_id: roleName,
    org_identifier: orgId,
    payload: { add, remove: [], add_users: [], remove_users: [] },
  });
  return add.length;
};
