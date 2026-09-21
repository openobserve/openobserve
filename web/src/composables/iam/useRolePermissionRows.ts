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
import type { Resource, Entity } from "@/ts/interfaces";

type RowDeps = {
  /** The permission tree the rows are pushed onto. */
  permissionsState: { permissions: Resource[] };
  /** The full entity list per stream type, which the pane reads instead of the filtered one. */
  heavyResourceEntities: Ref<{ [key: string]: Entity[] }>;
  /** The grants the checkboxes show, so a new row starts ticked when the role already holds it. */
  selectedPermissionsHash: Ref<Set<string>>;
  getPermissionHash: (resourceName: string, permission: string, entity?: string) => string;
  getResourceByName: (
    resources: Resource[],
    resourceName: string,
    level?: number,
  ) => Resource | null | undefined;
  store: any;
};

/** Turns one API list into permission rows: their FGA names, and which boxes start ticked. */
export const useRolePermissionRows = (deps: RowDeps) => {
  const {
    permissionsState,
    heavyResourceEntities,
    selectedPermissionsHash,
    getPermissionHash,
    getResourceByName,
    store,
  } = deps;

  const updateEntityEntities = (
    entity: Entity | Resource,
    entityNameKeys: string[],
    data: any[],
    hasEntities: boolean = false,
    displayNameKey?: string,
  ) => {
    if (!entity) return;

    const entities: Entity[] = data.map((_entity: any) => {
      let entityName = "";
      if (typeof _entity === "string") entityName = _entity;

      if (typeof _entity === "object") {
        entityName = entityNameKeys.reduce((acc, curr) => {
          return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
        }, "");

        if (entity.childName === "dashboard") {
          entityName = entity["name"] + "/" + _entity["dashboardId"];
        }
        if (entity.childName === "alert") {
          entityName = entity["name"] + "/" + _entity["alert_id"];
        }
        if (entity.childName === "report") {
          entityName = entity["name"] + "/" + _entity["report_id"];
        }
      }

      return {
        name: entityName,
        permission: {
          AllowAll: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowAll", entityName),
            ),
            show: true,
          },
          AllowGet: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowGet", entityName),
            ),
            show: true,
          },
          AllowDelete: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowDelete", entityName),
            ),
            show: true,
          },
          AllowPut: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowPut", entityName),
            ),
            show: true,
          },
          AllowList: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowList", entityName),
            ),
            show: hasEntities,
          },
          AllowPost: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.childName as string, "AllowPost", entityName),
            ),
            show: hasEntities,
          },
        },
        entities: [],
        type: "Resource",
        resourceName: entity.childName as string,
        has_entities: hasEntities,
        display_name: displayNameKey ? _entity[displayNameKey] : entityName,
        show: true,
        top_level: false,
      };
    });

    if (
      entity.name === "logs" ||
      entity.name === "metrics" ||
      entity.name === "traces" ||
      entity.name === "index"
    ) {
      heavyResourceEntities.value[entity.name] = [...entities];
      if (entity.entities) entity.entities.push(...entities);
    } else {
      if (entity.entities) entity.entities.push(...entities);
    }
  };

  const updateResourceEntities = (
    resourceName: string,
    entityNameKeys: string[],
    data: any[],
    hasEntities: boolean = false,
    displayNameKey?: string,
    childName?: string,
  ) => {
    const resource: Resource | null | undefined = getResourceByName(
      permissionsState.permissions,
      resourceName,
    );

    if (!resource) return;

    data.forEach((_entity: any) => {
      let entityName = "";
      if (typeof _entity === "string") entityName = _entity;

      if (typeof _entity === "object") {
        entityName = entityNameKeys.reduce((acc, curr) => {
          return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
        }, "");
      }

      resource.entities.push({
        name: entityName,
        permission: {
          AllowAll: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowAll", entityName),
            ),
            show: true,
          },
          AllowGet: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowGet", entityName),
            ),
            show: true,
          },
          AllowDelete: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowDelete", entityName),
            ),
            show: true,
          },
          AllowPut: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowPut", entityName),
            ),
            show: true,
          },
          AllowList: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowList", entityName),
            ),
            show: hasEntities,
          },
          AllowPost: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(resourceName, "AllowPost", entityName),
            ),
            show: hasEntities,
          },
        },
        entities: [],
        type: "Resource",
        resourceName: resourceName,
        has_entities: hasEntities,
        display_name: displayNameKey ? _entity[displayNameKey] : entityName,
        show: true,
        childName: childName || "",
        top_level: !!resource.childs.find((child) => child.name === childName)?.top_level,
      });
      // Hide non-applicable permissions for logs_pattern and logs_insights entities
      if (resourceName === "logs_pattern" || resourceName === "logs_insights") {
        const entity = resource.entities[resource.entities.length - 1];
        entity.permission.AllowList.show = false;
        entity.permission.AllowDelete.show = false;
        entity.permission.AllowPost.show = false;
        entity.permission.AllowPut.show = false;
      }
      // Hide non-applicable permissions for logs_cache entities (only All and Delete)
      if (resourceName === "logs_cache") {
        const entity = resource.entities[resource.entities.length - 1];
        entity.permission.AllowList.show = false;
        entity.permission.AllowGet.show = false;
        entity.permission.AllowPost.show = false;
        entity.permission.AllowPut.show = false;
      }
    });
  };

  const updateResourceResource = (
    resourceName: string,
    parentResourceName: string,
    entityNameKeys: string[],
    data: any[],
    hasEntities: boolean = false,
    displayNameKey?: string,
  ) => {
    const resource: Resource | null | undefined = getResourceByName(
      permissionsState.permissions,
      parentResourceName,
    );

    if (!resource) return;

    data.forEach((_entity: any) => {
      let entityName = "";
      if (typeof _entity === "string") entityName = _entity;

      if (typeof _entity === "object") {
        entityName = entityNameKeys.reduce((acc, curr) => {
          return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
        }, "");
      }

      resource.entities.push({
        name: entityName,
        permission: {
          AllowAll: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowAll",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: true,
          },
          AllowGet: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowGet",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: true,
          },
          AllowDelete: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowDelete",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: true,
          },
          AllowPut: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowPut",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: true,
          },
          AllowList: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowList",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: hasEntities,
          },
          AllowPost: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                resourceName,
                "AllowPost",
                "_all_" + store.state.selectedOrganization.identifier,
              ),
            ),
            show: hasEntities,
          },
        },
        entities: [],
        type: "Type",
        resourceName: resourceName,
        has_entities: hasEntities,
        childName: resourceName,
        display_name: displayNameKey ? _entity[displayNameKey] : entityName,
        show: true,
        top_level: true,
      });
    });
  };

  return {
    updateEntityEntities,
    updateResourceEntities,
    updateResourceResource,
  };
};
