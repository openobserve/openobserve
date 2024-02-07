<!-- Copyright 2023 Zinc Labs Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div>
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingRole }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <AppTabs
      :tabs="tabs"
      :active-tab="activeTab"
      @update:active-tab="updateActiveTab"
    />

    <q-separator />

    <template v-if="isFetchingIntitialRoles">
      <div style="margin-top: 64px">
        <q-spinner-hourglass
          color="primary"
          size="40px"
          style="margin: 0 auto; display: block"
        />
        <div class="text-center full-width">
          Hold on tight, we're fetching your role details...
        </div>
      </div>
    </template>
    <template v-else>
      <GroupUsers
        v-show="activeTab === 'users'"
        :groupUsers="roleUsers"
        :activeTab="activeTab"
        :added-users="addedUsers"
        class="q-mt-xs"
        :removed-users="removedUsers"
      />

      <div v-show="activeTab === 'permissions'" class="q-pa-md">
        <div class="o2-input flex items-end q-mb-md justify-start">
          <div class="flex items-center q-mb-sm q-mr-md">
            <span style="font-size: 14px"> Show </span>
            <div
              class="q-ml-xs"
              style="
                border: 1px solid #d7d7d7;
                width: fit-content;
                border-radius: 2px;
              "
            >
              <template
                v-for="visual in permissionDisplayOptions"
                :key="visual.value"
              >
                <q-btn
                  :color="visual.value === filter.permissions ? 'primary' : ''"
                  :flat="visual.value === filter.permissions ? false : true"
                  dense
                  no-caps
                  size="11px"
                  class="q-px-md visual-selection-btn"
                  @click="updateTableData(visual.value)"
                >
                  {{ visual.label }}</q-btn
                >
              </template>
            </div>
          </div>
          <q-input
            data-test="alert-list-search-input"
            v-model="filter.value"
            borderless
            filled
            dense
            class="q-mb-xs no-border q-mr-md"
            :placeholder="t('common.search')"
            style="width: 300px"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
          <q-select
            v-model="filter.resource"
            :options="resources"
            color="input-border"
            bg-color="input-bg"
            class="q-py-xs q-mr-sm"
            placeholder="Select Resource"
            map-options
            use-input
            emit-value
            fill-input
            hide-selected
            outlined
            filled
            dense
            clearable
            style="width: 200px"
            @update:model-value="onResourceChange"
          />
        </div>

        <permissions-table
          ref="permissionTableRef"
          :rows="permissionsState.permissions"
          :filter="filter"
          :visibleResourceCount="countOfVisibleResources"
          :selected-permissions-hash="selectedPermissionsHash"
          @updated:permission="handlePermissionChange"
          @expand:row="expandPermission"
        />
      </div>
      <div class="flex justify-end q-mt-lg q-px-md">
        <q-btn
          data-test="add-alert-cancel-btn"
          class="text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
          @click="cancelPermissionsUpdate"
        />
        <q-btn
          data-test="add-alert-submit-btn"
          :label="t('alerts.save')"
          class="text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
          @click="saveRole"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import { useRouter } from "vue-router";
import { onBeforeMount } from "vue";
import {
  updateRole,
  getResources,
  getResourcePermission,
  getRoleUsers,
} from "@/services/iam";
import { useQuasar } from "quasar";
import type { AxiosPromise } from "axios";
import { computed } from "vue";
import streamService from "@/services/stream";
import alertService from "@/services/alerts";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import jsTransformService from "@/services/jstransform";
import organizationsService from "@/services/organizations";
import savedviewsService from "@/services/saved_views";
import dashboardService from "@/services/dashboards";

import { getGroups, getRoles } from "@/services/iam";
import AppTabs from "@/components/common/AppTabs.vue";
import GroupUsers from "../groups/GroupUsers.vue";
import { nextTick } from "vue";

onBeforeMount(() => {
  permissionsState.permissions = [];
  editingRole.value = router.currentRoute.value.params.role_name as string;
  getRoleDetails();
});

const permissionTableRef: any = ref(null);

const { t } = useI18n();

const { permissionsState } = usePermissions();

const router = useRouter();

const q = useQuasar();

const store = useStore();

const activeTab = ref("permissions");

const editingRole = ref("");

const permissions: Ref<Permission[]> = ref([]);

const permissionsHash = ref(new Set()); // Saved permissions of role

const selectedPermissionsHash = ref(new Set()); // Saved + new added permission hash

const addedPermissions: any = ref({});

const removedPermissions: any = ref({});

const countOfVisibleResources = ref(0);

const isFetchingIntitialRoles = ref(false);

const addedUsers = ref(new Set());
const removedUsers = ref(new Set());

const roleUsers = ref([]);

const tabs = [
  {
    value: "permissions",
    label: "Permissions",
  },
  {
    value: "users",
    label: "Users",
  },
];

const permissionDisplayOptions = [
  {
    label: "All",
    value: "all",
  },
  {
    label: "Selected",
    value: "selected",
  },
];

const filter = ref({
  resource: "",
  value: "",
  permissions: "selected",
  method: filterResources,
});

const resources = computed(() =>
  permissionsState.resources.map((r) => {
    return {
      label: r.display_name,
      value: r.key,
    };
  })
);

const updateActiveTab = (tab: string) => {
  if (!tab) return;
  activeTab.value = tab;
};

const getRoleDetails = () => {
  getResources(store.state.selectedOrganization.identifier).then(
    async (res) => {
      permissionsState.resources = res.data
        .sort((a: any, b: any) => a.order - b.order)
        .filter((resource: any) => resource.visible);
      setDefaultPermissions();

      isFetchingIntitialRoles.value = true;
      await getResourcePermissions();
      await getUsers();
      await updateRolePermissions();
      setTimeout(() => {
        isFetchingIntitialRoles.value = false;
      }, 3000);

      updateTableData();
    }
  );
};

const getUsers = () => {
  return new Promise((resolve, reject) => {
    getRoleUsers(editingRole.value, store.state.selectedOrganization.identifier)
      .then((res) => {
        roleUsers.value = res.data;
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
};

const getResourceByName = (
  resources: Resource[],
  resourceName: string,
  level: number = 0
): Resource | null | undefined => {
  for (let i = 0; i < resources.length; i++) {
    if (resources[i].resourceName === resourceName) return resources[i];
    else if (resources[i].childs.length) {
      const isFound = getResourceByName(
        resources[i].childs,
        resourceName,
        level + 1
      );
      if (isFound) return isFound;
    }
  }

  if (!level) return null;
};

const setDefaultPermissions = () => {
  //TODO: Need to make it recursive to support multi level nested resources
  permissionsState.resources.forEach((resource: any) => {
    const resourcePermission = getDefaultResource();
    resourcePermission.name = resource.key;
    resourcePermission.resourceName = resource.key;
    resourcePermission.display_name = resource.display_name;
    if (resource.has_entities) resourcePermission.has_entities = true;

    resourcePermission.parent = resource.parent;

    if (resource.parent) {
      const parentResource = getResourceByName(
        permissionsState.permissions,
        resource.parent
      );
      if (parentResource) {
        parentResource.childs.push(resourcePermission as Resource);
        return;
      }
    }

    modifyResourcePermissions(resourcePermission);

    permissionsState.permissions.push(resourcePermission as Resource);
  });

  permissionsState.permissions = permissionsState.permissions.filter(
    (resource) => !resource.parent
  );
};

const modifyResourcePermissions = (resource: Resource) => {
  if (resource.resourceName === "settings") {
    resource.permission.AllowList.show = false;
    resource.permission.AllowDelete.show = false;
    resource.permission.AllowPost.show = false;
  }
};

const getResourcePermissions = () => {
  const promises: AxiosPromise<any>[] = [];
  permissionsState.resources.forEach((resource) => {
    promises.push(
      getResourcePermission({
        role_name: editingRole.value,
        org_identifier: store.state.selectedOrganization.identifier,
        resource: resource.key,
      })
    );
  });

  return new Promise((resolve, reject) => {
    Promise.all(promises)
      .then((res) => {
        res.forEach((resourcePermissions: { data: Permission[] }) => {
          permissions.value.push(...resourcePermissions.data);
        });
        promises.length = 0;
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
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
    isSelected: false,
    entities: [],
    has_entities: false,
    is_loading: false,
  };
};

const getOrgId = () => {
  return store.state.selectedOrganization.identifier;
};

const savePermissionHash = () => {
  permissions.value.forEach((permission: Permission) => {
    const { resource, entity } = decodePermission(permission.object);

    // Creating permissions hash to check if permission is selected at the time of save as we need to send only added and removed permissions
    const permissionHash = `${resource}:${entity}:${permission.permission}`;
    permissionsHash.value.add(permissionHash);
    selectedPermissionsHash.value.add(permissionHash);
  });
};

const updateRolePermissions = async () => {
  savePermissionHash();

  let resourceMapper: { [key: string]: Resource } = {};

  for (let i = 0; i < permissions.value.length; i++) {
    let {
      resource,
      entity,
    }: {
      resource: string;
      entity: string;
    } = decodePermission(permissions.value[i].object);

    if (!resourceMapper[resource]) {
      resourceMapper[resource] = getResourceByName(
        permissionsState.permissions,
        resource
      ) as Resource;
    }

    if (!resourceMapper[resource]) return;

    if (
      resourceMapper[resource].parent &&
      !resourceMapper[resourceMapper[resource].parent]
    ) {
      resourceMapper[resourceMapper[resource].parent] = getResourceByName(
        permissionsState.permissions,
        resourceMapper[resource].parent
      ) as Resource;
    }

    if (entity === getOrgId()) {
      resourceMapper[resource].permission[
        permissions.value[i].permission
      ].value = true;

      continue;
    }

    if (resourceMapper[resource].parent)
      await getResourceEntities(
        resourceMapper[resourceMapper[resource].parent]
      );

    // This is just to handle dashboard permissions, need to fix this
    if (resource === "dashboard") {
      const [folderId, dashboardId] = entity.split("/");

      const dashResource = resourceMapper["dfolder"].entities.find(
        (e: Entity) => e.name === folderId
      );
      await getResourceEntities(dashResource as Entity);
    } else {
      await getResourceEntities(resourceMapper[resource]);
    }
  }

  resourceMapper = {};

  return new Promise((resolve) => {
    resolve(true);
  });
};

const decodePermission = (permission: string) => {
  const [resource, entity] = permission.split(":");
  return { resource, entity };
};

const cancelPermissionsUpdate = () => {
  router.push({ name: "roles" });
};

const handlePermissionChange = (row: any, permission: string) => {
  let entity = "";

  if (row.type === "Type") entity = store.state.selectedOrganization.identifier;
  else entity = row.name;

  const permissionHash = `${row.resourceName}:${entity}:${permission}`;
  const object = `${row.resourceName}:${entity}`;

  // Add permission to addedPermissions if not present
  if (
    !addedPermissions.value[permissionHash] &&
    !permissionsHash.value.has(permissionHash)
  ) {
    selectedPermissionsHash.value.add(permissionHash);
    addedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };
    return;
  }

  // Remove permission from removedPermissions if present
  if (removedPermissions.value[permissionHash]) {
    delete removedPermissions.value[permissionHash];
    return;
  }

  // Remove permission from addedPermissions if present
  if (permissionsHash.value.has(permissionHash)) {
    selectedPermissionsHash.value.delete(permissionHash);
    removedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };

    return;
  }

  // Remove permission from addedPermissions if present
  if (addedPermissions.value[permissionHash]) {
    selectedPermissionsHash.value.delete(permissionHash);
    delete addedPermissions.value[permissionHash];
    return;
  }
};

const updateTableData = async (value: string = filter.value.permissions) => {
  filter.value.permissions = value;

  await nextTick();

  updatePermissionVisibility(permissionsState.permissions);
  countVisibleResources(permissionsState.permissions);
};

const updateExpandedResources = (resources: (Resource | Entity)[]) => {
  resources.forEach(async (resource) => {
    // Check if the current item is an object and has the 'expand' key
    if (
      typeof resource === "object" &&
      resource.expand &&
      resource.has_entities
    ) {
      resource.is_loading = true;
      await getResourceEntities(resource);
      resource.is_loading;
      // Perform additional actions as needed
    }

    // If the item itself contains a nested array, call the function recursively
    if (Array.isArray(resource.entities)) {
      updateExpandedResources(resource.entities);
    }
  });
};

const countVisibleResources = (permissions: (Resource | Entity)[]): number => {
  let count = 0;

  permissions.forEach((permission: Entity | Resource) => {
    if (permission.show) {
      count += 1;
    }

    // Recursively count in nested entities
    if (permission.entities?.length) {
      count += countVisibleResources(permission.entities);
    }
  });

  countOfVisibleResources.value = count;
  return count;
};

const updatePermissionVisibility = (
  permissions: (Resource | Entity)[]
): void => {
  permissions.forEach((permission: Entity | Resource) => {
    // Check if any permission value is true
    const showResource = Object.values(permission.permission).some(
      (permDetail) => permDetail.value
    );

    // Recursively update the show property for entities
    if (permission.entities?.length) {
      updatePermissionVisibility(permission.entities);
    }
    const showEntity = permission.entities?.some((entity) => entity.show);

    // Update the permission object to add `show` property

    let appliedFilter = true;
    if (filter.value.resource)
      appliedFilter = filter.value.resource === permission.resourceName;

    permission.show =
      filter.value.permissions === "all"
        ? true && appliedFilter
        : (showResource || showEntity) && appliedFilter;
  });
};

const filterRowsByResourceName = (
  rows: (Resource | Entity)[],
  resourceName: string
) => {
  return rows.reduce(
    (filteredRows: (Resource | Entity)[], row: Resource | Entity) => {
      // Check if the current row matches the filter
      if (row.resourceName === resourceName) {
        // If the row has nested rows, filter those as well
        if (row.entities && row.entities.length) {
          row.entities = filterRowsByResourceName(
            row.entities,
            resourceName
          ) as Entity[];
        }
        // Add the row to the filtered list
        filteredRows.push(row);
      } else if (row.entities && row.entities.length) {
        // Even if the current row doesn't match, there might be nested rows that do
        const filteredEntities = filterRowsByResourceName(
          row.entities,
          resourceName
        );
        // Only add the row if it has matching nested rows
        if (filteredEntities.length) {
          // Optionally, you might want to clone the row here to avoid mutating the original
          const newRow = { ...row, entities: filteredEntities };
          filteredRows.push(newRow as Resource);
        }
      }
      return filteredRows;
    },
    []
  );
};

const onResourceChange = () => {
  updatePermissionVisibility(permissionsState.permissions);
  countVisibleResources(permissionsState.permissions);
};

function filterResources(rows: any, terms: any) {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    let isAdded = false;
    if (rows[i]["name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
      isAdded = true;
      continue;
    }
    for (var j = 0; j < rows[i].entities.length; j++) {
      if (
        !isAdded &&
        rows[i].entities[j]["name"].toLowerCase().includes(terms)
      ) {
        filtered.push(rows[i]);
        break;
      }
    }
  }
  return filtered;
}

const expandPermission = async (resource: any) => {
  const expand = !resource.expand;

  resource.expand = expand;
  if (expand) {
    try {
      await getResourceEntities(resource);
    } catch (err) {
      console.log(err);
    }
  }
};

const getPermissionHash = (
  resourceName: string,
  permission: string,
  entity?: string
) => {
  if (!entity) entity = store.state.selectedOrganization.identifier;

  return `${resourceName}:${entity}:${permission}`;
};

/**
 *
 * @param resource
 * @param typeOf - Type to assign the new entities that we get from the server
 */
const getResourceEntities = (resource: Resource | Entity) => {
  const listEntitiesFnMap: {
    [key: string]: (resource: Resource | Entity) => Promise<any>;
  } = {
    stream: getStreams,
    alert: getAlerts,
    template: getTemplates,
    destination: getDestinations,
    enrichment_table: getEnrichmentTables,
    function: getFunctions,
    org: getOrgs,
    savedviews: getSavedViews,
    group: _getGroups,
    role: _getRoles,
    dfolder: getFolders,
    dashboard: getDashboards,
  };

  return new Promise(async (resolve, reject) => {
    if (!resource.entities?.length) {
      resource.is_loading = true;
      if (resource.childName) {
        await listEntitiesFnMap[resource.childName](resource);
      } else {
        await listEntitiesFnMap[resource.resourceName](resource);
      }
      resource.is_loading = false;
    }

    resolve(true);
  });
};

const getEnrichmentTables = () => {
  return new Promise((resolve) => {
    resolve(true);
  });
};

const getDashboards = async (resource: Entity | Resource) => {
  let dashboards: any = await dashboardService.list(
    0,
    10000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier,
    resource.name
  );

  updateEntityEntities(
    resource,
    ["dashboardId"],
    [
      ...dashboards.data.dashboards.map(
        (dash: any) => Object.values(dash).filter((dash) => dash)[0]
      ),
    ],
    false,
    "title"
  );

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getOrgs = async () => {
  const orgs = await organizationsService.list(0, 10000, "name", false, "");

  updateResourceEntities("org", ["identifier"], [...orgs.data.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getSavedViews = async () => {
  const savedViews = await savedviewsService.get(
    store.state.selectedOrganization.identifier
  );
  updateResourceEntities("savedviews", ["name"], [...savedViews.data.views]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getFolders = async () => {
  const folders: any = await dashboardService.list_Folders(
    store.state.selectedOrganization.identifier
  );

  let isDefaultPresent = folders.data.list.find(
    (folder: any) => folder.folderId === "default"
  );

  if (!isDefaultPresent) {
    folders.data.list.unshift({ folderId: "default", name: "default" });
  }

  updateResourceEntities(
    "dfolder",
    ["folderId"],
    [...folders.data.list],
    true,
    "name"
  );
  return new Promise((resolve) => {
    resolve(true);
  });
};

const _getGroups = async () => {
  const groups = await getGroups(store.state.selectedOrganization.identifier);
  updateResourceEntities("group", [], [...groups.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const _getRoles = async () => {
  const roles = await getRoles(store.state.selectedOrganization.identifier);
  updateResourceEntities("role", [], [...roles.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getFunctions = async () => {
  const functions = await jsTransformService.list(
    1,
    100000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier
  );

  updateResourceEntities("function", ["name"], [...functions.data.list]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getDestinations = async () => {
  const destinations = await destinationService.list({
    sort_by: "name",
    org_identifier: store.state.selectedOrganization.identifier,
  });

  updateResourceEntities("destination", ["name"], [...destinations.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getTemplates = async () => {
  const templates = await templateService.list({
    org_identifier: store.state.selectedOrganization.identifier,
  });

  updateResourceEntities("template", ["name"], [...templates.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getAlerts = async () => {
  const alerts = await alertService.list(
    1,
    10000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier
  );

  updateResourceEntities("alert", ["name"], [...alerts.data.list]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getStreams = async () => {
  const logs = await streamService.nameList(
    store.state.selectedOrganization.identifier,
    "logs",
    false
  );
  const traces = await streamService.nameList(
    store.state.selectedOrganization.identifier,
    "traces",
    false
  );
  const metrics = await streamService.nameList(
    store.state.selectedOrganization.identifier,
    "metrics",
    false
  );

  updateResourceEntities(
    "stream",
    ["stream_type", "name"],
    [...logs.data.list, ...metrics.data.list, ...traces.data.list]
  );

  return new Promise((resolve, reject) => {
    resolve(true);
  });
};

const updateEntityEntities = (
  entity: Entity | Resource,
  entityNameKeys: string[],
  data: any[],
  hasEntities: boolean = false,
  displayNameKey?: string
) => {
  if (!entity) return;

  if (entity.entities) entity.entities.length = 0;
  entity.entities = [];

  data.forEach((_entity: any) => {
    let entityName = "";
    if (typeof _entity === "string") entityName = _entity;

    if (typeof _entity === "object") {
      entityName = entityNameKeys.reduce((acc, curr) => {
        return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
      }, "");

      if (entity.childName === "dashboard") {
        entityName = entity["name"] + "/" + _entity["dashboardId"];
      }
    }

    if (entity.entities)
      entity.entities.push({
        name: entityName,
        permission: {
          AllowAll: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowAll",
                entityName
              )
            ),
            show: true,
          },
          AllowGet: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowGet",
                entityName
              )
            ),
            show: true,
          },
          AllowDelete: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowDelete",
                entityName
              )
            ),
            show: true,
          },
          AllowPut: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowPut",
                entityName
              )
            ),
            show: true,
          },
          AllowList: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowList",
                entityName
              )
            ),
            show: hasEntities,
          },
          AllowPost: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(
                entity.childName as string,
                "AllowPost",
                entityName
              )
            ),
            show: hasEntities,
          },
        },
        entities: [],
        type: "Resource",
        resourceName: entity.childName as string,
        isSelected: false,
        has_entities: hasEntities,
        display_name: displayNameKey ? _entity[displayNameKey] : entityName,
        show: true,
      });
  });

  updatePermissionVisibility(permissionsState.permissions);
};

const updateResourceEntities = (
  resourceName: string,
  entityNameKeys: string[],
  data: any[],
  hasEntities: boolean = false,
  displayNameKey?: string
) => {
  const resource: Resource | null | undefined = getResourceByName(
    permissionsState.permissions,
    resourceName
  );

  if (!resource) return;

  resource.entities.length = 0;
  resource.entities = [];

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
            getPermissionHash(resourceName, "AllowAll", entityName)
          ),
          show: true,
        },
        AllowGet: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowGet", entityName)
          ),
          show: true,
        },
        AllowDelete: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowDelete", entityName)
          ),
          show: true,
        },
        AllowPut: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowPut", entityName)
          ),
          show: true,
        },
        AllowList: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowList", entityName)
          ),
          show: hasEntities,
        },
        AllowPost: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowPost", entityName)
          ),
          show: hasEntities,
        },
      },
      entities: [],
      type: "Resource",
      resourceName: resourceName,
      isSelected: false,
      has_entities: hasEntities,
      display_name: displayNameKey ? _entity[displayNameKey] : entityName,
      show: true,
      childName: hasEntities ? resource.childs[0].resourceName : "",
    });
  });

  updatePermissionVisibility(permissionsState.permissions);
};

const saveRole = () => {
  const payload = {
    add: Object.values(addedPermissions.value),
    remove: Object.values(removedPermissions.value),
    add_users: Array.from(addedUsers.value) as string[],
    remove_users: Array.from(removedUsers.value) as string[],
  };

  updateRole({
    role_id: editingRole.value,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then((res) => {
      q.notify({
        type: "positive",
        message: `Updated "${editingRole.value}" role permissions successfully!"`,
        timeout: 3000,
      });
      router.push({
        name: "roles",
        params: {
          org_name: store.state.selectedOrganization.name,
        },
      });
    })
    .catch((err) => {
      q.notify({
        type: "negative",
        message: `Error While updating "${editingRole.value}" role permissions!`,
        timeout: 3000,
      });
      console.log(err);
    });
};
</script>

<style scoped></style>
