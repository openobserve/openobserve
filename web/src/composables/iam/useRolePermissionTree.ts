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

import type { Ref } from "vue";
import type { Resource } from "@/ts/interfaces";

type TreeDeps = {
  /** `resources` is the catalogue from the API; `permissions` is the tree built from it. */
  permissionsState: { resources: any[]; permissions: Resource[] };
  /** Every built node by key, which the rest of the page looks rows up in. */
  resourceMapper: Ref<{ [key: string]: Resource }>;
  /** Read for the meta-org check, which decides whether `org` belongs in the tree. */
  store: any;
};

/** Builds the permission tree from the resource catalogue, and finds nodes in it. */
export const useRolePermissionTree = (deps: TreeDeps) => {
  const { permissionsState, resourceMapper, store } = deps;

  const getResourceByName = (
    resources: Resource[],
    resourceName: string,
    level: number = 0,
  ): Resource | null | undefined => {
    for (let i = 0; i < resources.length; i++) {
      if (resources[i].resourceName === resourceName) return resources[i];
      else if (resources[i].childs.length) {
        const isFound = getResourceByName(resources[i].childs, resourceName, level + 1);
        if (isFound) return isFound;
      }
    }

    if (!level) return null;
    return undefined;
  };

  const setPermission = (resource: any, visited: Set<string>) => {
    if (!resource || !resource.key) {
      return;
    }

    // Prevent infinite recursion by tracking visited resources
    if (visited.has(resource.key)) {
      return;
    }
    visited.add(resource.key);

    const resourcePermission = getDefaultResource();
    resourcePermission.name = resource.key;
    resourcePermission.resourceName = resource.key;
    resourcePermission.display_name = resource.display_name;
    resourcePermission.top_level = resource.top_level;

    if (resource.has_entities) resourcePermission.has_entities = true;

    resourcePermission.parent = resource.parent;

    resourceMapper.value[resourcePermission.name] = resourcePermission;

    if (resource.parent) {
      const parentResource = getResourceByName(permissionsState.permissions, resource.parent);

      if (parentResource) {
        parentResource.childs.push(resourcePermission as Resource);
        return;
      } else {
        // Find parent in resources array
        const _parentResource = permissionsState.resources.find((r) => r.key === resource.parent);

        if (_parentResource && !visited.has(_parentResource.key)) {
          // Process parent first
          setPermission(_parentResource, visited);

          // Get the processed parent resource
          const processedParentResource = getResourceByName(
            permissionsState.permissions,
            resource.parent,
          );

          if (processedParentResource) {
            processedParentResource.childs.push(resourcePermission as Resource);
          }
        }
      }
    }

    modifyResourcePermissions(resourcePermission);
    if (
      resourcePermission.name === "org" &&
      store.state.selectedOrganization.identifier !== store.state.zoConfig.meta_org
    ) {
      return; // Skip adding 'org' resource if the organization is not _meta
    }
    permissionsState.permissions.push(resourcePermission as Resource);
  };

  const setDefaultPermissions = () => {
    // Create a single visited set to be shared across all recursive calls
    const visited = new Set<string>();

    // Process resources in order of their parent relationships
    const processResource = (resource: any) => {
      if (!visited.has(resource.key)) {
        setPermission(resource, visited);
      }
    };

    // First process resources without parents
    permissionsState.resources.filter((resource: any) => !resource.parent).forEach(processResource);

    // Then process resources with parents
    permissionsState.resources.filter((resource: any) => resource.parent).forEach(processResource);

    // Filter out child resources from the top level
    permissionsState.permissions = permissionsState.permissions.filter(
      (resource) => !resource.parent,
    );
  };

  const modifyResourcePermissions = (resource: Resource) => {
    if (resource.resourceName === "settings") {
      resource.permission.AllowList.show = false;
      resource.permission.AllowDelete.show = false;
      resource.permission.AllowPost.show = false;
    }
    if (resource.resourceName === "logs_pattern" || resource.resourceName === "logs_insights") {
      resource.permission.AllowList.show = false;
      resource.permission.AllowDelete.show = false;
      resource.permission.AllowPost.show = false;
      resource.permission.AllowPut.show = false;
    }
    if (resource.resourceName === "logs_cache") {
      resource.permission.AllowList.show = false;
      resource.permission.AllowGet.show = false;
      resource.permission.AllowPost.show = false;
      resource.permission.AllowPut.show = false;
    }
  };

  const getDefaultResource = (): Resource => {
    return {
      name: "",
      permission: {
        AllowAll: {
          show: true,
          value: false,
        },
        AllowList: {
          show: true,
          value: false,
        },
        AllowGet: {
          show: true,
          value: false,
        },
        AllowDelete: {
          show: true,
          value: false,
        },
        AllowPost: {
          show: true,
          value: false,
        },
        AllowPut: {
          show: true,
          value: false,
        },
      },
      display_name: "",
      parent: "",
      childs: [],
      type: "Type",
      resourceName: "",
      entities: [],
      has_entities: false,
      is_loading: false,
      top_level: true,
    };
  };

  return {
    getResourceByName,
    setPermission,
    setDefaultPermissions,
    modifyResourcePermissions,
    getDefaultResource,
  };
};
