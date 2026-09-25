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

import { nextTick, type Ref } from "vue";
import type { Resource, Entity, Permission } from "@/ts/interfaces";

type JsonViewDeps = {
  /** "table" or "json"; which of the two views is on screen. */
  permissionsUiType: Ref<string>;
  /** The editor text, which is the source of truth while the JSON view is open. */
  permissionsJsonValue: Ref<string>;
  permissionJsonEditorRef: Ref<any>;
  selectedPermissionsHash: Ref<Set<string>>;
  resourceMapper: Ref<{ [key: string]: Resource }>;
  /** Stages a grant exactly as a checkbox click would. */
  updatePermissionMappings: (permissionHash: string) => void;
  updateEntityPermission: (
    resource: Resource | Entity,
    resourceName: string,
    entityName: string,
    permission: "AllowAll" | "AllowList" | "AllowGet" | "AllowDelete" | "AllowPost",
  ) => void;
  updateRolePermissions: (permissions: Permission[]) => Promise<unknown>;
  getPermissionHash: (resourceName: string, permission: string, entity?: string) => string;
  getOrgId: () => string;
};

/** Switches between the checkbox table and the raw JSON, staging whatever the JSON added or dropped. */
export const useRoleJsonView = (deps: JsonViewDeps) => {
  const {
    permissionsUiType,
    permissionsJsonValue,
    permissionJsonEditorRef,
    selectedPermissionsHash,
    resourceMapper,
    updatePermissionMappings,
    updateEntityPermission,
    updateRolePermissions,
    getPermissionHash,
    getOrgId,
  } = deps;

  const updatePermissionsUi = async (value: string) => {
    permissionsUiType.value = value;
    if (value === "json") {
      const permissions: {
        object: string;
        permission: string;
      }[] = [];
      selectedPermissionsHash.value.forEach((permission: any) => {
        const [resource, entity, _permission] = permission.split(":");
        permissions.push({
          object: `${resource}:${entity}`,
          permission: _permission,
        });
      });

      permissionsJsonValue.value = JSON.stringify(permissions);
      permissionJsonEditorRef.value.setValue(permissionsJsonValue.value);
      await nextTick();
      permissionJsonEditorRef.value.formatDocument();
    } else if (value === "table") {
      updateJsonInTable();
    }
  };

  const updateJsonInTable = () => {
    const permissions = JSON.parse(permissionsJsonValue.value);

    const permissionsHash = new Set(permissions.map((p: any) => p.object + ":" + p.permission));
    let hash = "";
    let permission;
    let resource = "";
    let entity = "";
    let resourceDetails: Entity | Resource;

    // Update added permissions
    updateRolePermissions(permissions);

    permissions.forEach((permission: any) => {
      [resource, entity] = permission.object.split(":");
      hash = permission.object + ":" + permission.permission;
      if (!selectedPermissionsHash.value.has(hash)) {
        updatePermissionMappings(hash);

        resourceDetails = resourceMapper.value[resource];

        if (resource === "dashboard") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["dfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (resource === "alert") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["afolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (resource === "report") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["rfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (resource === "synthetics") {
          // Plain-id entity — locate the folder whose loaded monitors contain it.
          resourceDetails = resourceMapper.value["synthetic_folder"].entities.find((f: Entity) =>
            (f.entities ?? []).some((e: Entity) => e.name === entity),
          ) as Entity;
        } else if (resource === "workflows") {
          resourceDetails = resourceMapper.value["workflow_folder"].entities.find((f: Entity) =>
            (f.entities ?? []).some((e: Entity) => e.name === entity),
          ) as Entity;
        } else if (entity === "_all_" + getOrgId()) {
          resourceDetails.permission[permission.permission as "AllowAll"].value =
            selectedPermissionsHash.value.has(
              getPermissionHash(resource, permission.permission, entity),
            );
        } else if (
          resource === "logs" ||
          resource === "metrics" ||
          resource === "traces" ||
          resource === "index"
        ) {
          resourceDetails = resourceMapper.value["stream"].entities.find(
            (e: Entity) => e.name === resource,
          ) as Entity;
        }

        updateEntityPermission(resourceDetails, resource, entity, permission.permission);
      }
    });

    // Update removed permissions
    selectedPermissionsHash.value.forEach(async (permissionHash: any) => {
      permission = permissionHash.split(":");
      resource = permission[0];
      entity = permission[1];
      permission = {
        object: permission[0] + ":" + permission[1],
        permission: permission[2] as "AllowAll",
      };

      if (!permissionsHash.has(permissionHash)) {
        updatePermissionMappings(permissionHash);

        resourceDetails = resourceMapper.value[resource];

        if (resource === "dashboard") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["dfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (resource === "alert") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["afolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (resource === "synthetics") {
          // Plain-id entity — locate the folder whose loaded monitors contain it.
          resourceDetails = resourceMapper.value["synthetic_folder"].entities.find((f: Entity) =>
            (f.entities ?? []).some((e: Entity) => e.name === entity),
          ) as Entity;
        } else if (resource === "workflows") {
          resourceDetails = resourceMapper.value["workflow_folder"].entities.find((f: Entity) =>
            (f.entities ?? []).some((e: Entity) => e.name === entity),
          ) as Entity;
        } else if (resource === "report") {
          const [folderId] = entity.split("/");

          resourceDetails = resourceMapper.value["rfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          ) as Entity;
        } else if (entity === "_all_" + getOrgId()) {
          resourceDetails.permission[permission.permission as "AllowAll"].value =
            selectedPermissionsHash.value.has(
              getPermissionHash(resource, permission.permission, entity),
            );
        } else if (
          resource === "logs" ||
          resource === "metrics" ||
          resource === "traces" ||
          resource === "index"
        ) {
          resourceDetails = resourceMapper.value["stream"].entities.find(
            (e: Entity) => e.name === resource,
          ) as Entity;
        }

        updateEntityPermission(resourceDetails, resource, entity, permission.permission);
      }
    });
  };

  return {
    updatePermissionsUi,
    updateJsonInTable,
  };
};
