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

import type { Resource, Entity, Permission } from "@/ts/interfaces";

type ExpansionDeps = {
  /** The permission tree the saved grants are ticked on. */
  permissionsState: { permissions: Resource[] };
  decodePermission: (object: string) => { resource: string; entity: string };
  getResourceByName: (
    resources: Resource[],
    resourceName: string,
    level?: number,
  ) => Resource | null | undefined;
  /** Loads a row's children, which is how a grant on an unloaded row finds its checkbox. */
  getResourceEntities: (resource: Resource | Entity) => Promise<unknown>;
  getOrgId: () => string;
};

/** Ticks every saved grant on the tree, fetching the rows a grant points at but nothing has loaded. */
export const useSavedGrantExpansion = (deps: ExpansionDeps) => {
  const { permissionsState, decodePermission, getResourceByName, getResourceEntities, getOrgId } =
    deps;

  const updateRolePermissions = async (permissions: Permission[]) => {
    let resourceMapper: { [key: string]: Resource } = {};
    for (let i = 0; i < permissions.length; i++) {
      try {
        let {
          resource,
          entity,
        }: {
          resource: string;
          entity: string;
        } = decodePermission(permissions[i].object);

        if (!resourceMapper[resource]) {
          resourceMapper[resource] = getResourceByName(
            permissionsState.permissions,
            resource,
          ) as Resource;
        }
        // Added it intentionally, as to get parent resource for dashboard, before getting dashboard permissions
        if (!resourceMapper[resource] && resource === "dashboard") {
          if (!resourceMapper["dfolder"]) {
            resourceMapper["dfolder"] = getResourceByName(
              permissionsState.permissions,
              "dfolder",
            ) as Resource;
          }

          await getResourceEntities(resourceMapper["dfolder"]);

          if (!resourceMapper[resource]) {
            resourceMapper[resource] = getResourceByName(
              permissionsState.permissions,
              resource,
            ) as Resource;
          }
        }

        if (!resourceMapper[resource] && resource === "alert") {
          if (!resourceMapper["afolder"]) {
            resourceMapper["afolder"] = getResourceByName(
              permissionsState.permissions,
              "afolder",
            ) as Resource;
          }

          await getResourceEntities(resourceMapper["afolder"]);

          if (!resourceMapper[resource]) {
            resourceMapper[resource] = getResourceByName(
              permissionsState.permissions,
              resource,
            ) as Resource;
          }
        }

        if (!resourceMapper[resource] && resource === "report") {
          if (!resourceMapper["rfolder"]) {
            resourceMapper["rfolder"] = getResourceByName(
              permissionsState.permissions,
              "rfolder",
            ) as Resource;
          }

          await getResourceEntities(resourceMapper["rfolder"]);

          if (!resourceMapper[resource]) {
            resourceMapper[resource] = getResourceByName(
              permissionsState.permissions,
              resource,
            ) as Resource;
          }
        }

        if (!resourceMapper[resource] && resource === "synthetics") {
          if (!resourceMapper["synthetic_folder"]) {
            resourceMapper["synthetic_folder"] = getResourceByName(
              permissionsState.permissions,
              "synthetic_folder",
            ) as Resource;
          }

          await getResourceEntities(resourceMapper["synthetic_folder"]);

          if (!resourceMapper[resource]) {
            resourceMapper[resource] = getResourceByName(
              permissionsState.permissions,
              resource,
            ) as Resource;
          }
        }

        if (!resourceMapper[resource] && resource === "workflows") {
          if (!resourceMapper["workflow_folder"]) {
            resourceMapper["workflow_folder"] = getResourceByName(
              permissionsState.permissions,
              "workflow_folder",
            ) as Resource;
          }

          await getResourceEntities(resourceMapper["workflow_folder"]);

          if (!resourceMapper[resource]) {
            resourceMapper[resource] = getResourceByName(
              permissionsState.permissions,
              resource,
            ) as Resource;
          }
        }

        if (!resourceMapper[resource]) continue;

        if (resourceMapper[resource].parent && !resourceMapper[resourceMapper[resource].parent]) {
          resourceMapper[resourceMapper[resource].parent] = getResourceByName(
            permissionsState.permissions,
            resourceMapper[resource].parent,
          ) as Resource;
        }

        if (entity === "_all_" + getOrgId()) {
          resourceMapper[resource].permission[permissions[i].permission].value = true;

          continue;
        }

        if (resourceMapper[resource].parent)
          await getResourceEntities(resourceMapper[resourceMapper[resource].parent]);

        // This is just to handle dashboard permissions, need to fix this
        if (resource === "dashboard") {
          const [folderId] = entity.split("/");

          const dashResource = resourceMapper["dfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          );
          await getResourceEntities(dashResource as Entity);
        } else if (resource === "alert") {
          const [folderId] = entity.split("/");

          const alertResource = resourceMapper["afolder"].entities.find(
            (e: Entity) => e.name === folderId,
          );
          await getResourceEntities(alertResource as Entity);
        } else if (resource === "report") {
          const [folderId] = entity.split("/");

          const reportResource = resourceMapper["rfolder"].entities.find(
            (e: Entity) => e.name === folderId,
          );
          await getResourceEntities(reportResource as Entity);
        } else if (resource === "synthetics") {
          // Synthetics entities are plain monitor ids (no folder prefix), so the
          // owning folder can't be derived from the entity — load every folder's
          // monitors so the permission can be matched to its row.
          for (const folderEntity of resourceMapper["synthetic_folder"]?.entities ?? []) {
            await getResourceEntities(folderEntity as Entity);
          }
        } else if (resource === "workflows") {
          // Plain workflow ids too, so the same sweep applies.
          for (const folderEntity of resourceMapper["workflow_folder"]?.entities ?? []) {
            await getResourceEntities(folderEntity as Entity);
          }
        } else if (
          resource === "logs" ||
          resource === "metrics" ||
          resource === "traces" ||
          resource === "index"
        ) {
          const streamResource = resourceMapper["stream"].entities.find(
            (e: Entity) => e.name === resource,
          );
          await getResourceEntities(streamResource as Entity);
        } else {
          await getResourceEntities(resourceMapper[resource]);
        }
      } catch (err) {
        console.log(err);
      }
    }

    resourceMapper = {};

    return new Promise((resolve) => {
      resolve(true);
    });
  };

  return {
    updateRolePermissions,
  };
};
