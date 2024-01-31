<template>
  <div>
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingRole }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div
      class="q-px-md q-py-md"
      style="height: calc(100vh - 101px); overflow-y: auto"
    >
      <div class="o2-input flex items-end q-mb-sm justify-start">
        <q-input
          data-test="alert-list-search-input"
          v-model="filter.value"
          borderless
          filled
          dense
          class="q-mb-xs no-border q-mr-sm"
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
      <div class="flex items-center q-mb-md">
        <span style="font-size: 14px"> Show </span>
        <div
          class="q-mx-sm"
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
        <span style="font-size: 14px"> Permissions </span>
      </div>
      <permissions-table
        ref="permissionTableRef"
        :rows="permissionTableRows"
        :filter="filter"
        @updated:permission="handlePermissionChange"
        @expand:row="expandPermission"
      />
      <div class="flex justify-end q-mt-lg">
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
          @click="saveRolePermissions"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  Resource,
  Entity,
  Permission,
  PermissionType,
} from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import { useRouter } from "vue-router";
import { onBeforeMount } from "vue";
import {
  updateRole,
  getResources,
  getResourcePermission,
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

const editingRole = ref("");

const permissions: Ref<Permission[]> = ref([]);

const permissionsHash = ref(new Set()); // Saved permissions of role

const selectedPermissionsHash = ref(new Set()); // Saved + new added permission hash

const addedPermissions: any = ref({});

const removedPermissions: any = ref({});

const permissionTableRows: Ref<Resource[]> = ref([]);

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

const getRoleDetails = () => {
  getResources(store.state.selectedOrganization.identifier).then(
    async (res) => {
      permissionsState.resources = res.data
        .sort((a: any, b: any) => a.order - b.order)
        .filter((resource: any) => resource.visible);
      setDefaultPermissions();
      await getResourcePermissions();
      updateRolePermissions();
      updateTableData();
    }
  );
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
    resourcePermission.name = resource.display_name;
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

    permissionsState.permissions.push(resourcePermission as Resource);
  });

  permissionsState.permissions = permissionsState.permissions.filter(
    (resource) => !resource.parent
  );
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

const getDefaultEntity = (): Entity => {
  return {
    name: "",
    permission: {
      AllowAll: {
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
      AllowPut: {
        show: true,
        value: false,
      },
      AllowList: {
        show: false,
        value: false,
      },
    },
    display_name: "",
    type: "entity",
    resourceName: "",
    isSelected: false,
  };
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
    type: "resource",
    resourceName: "",
    isSelected: false,
    entities: [],
    has_entities: false,
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

const updateRolePermissions = () => {
  savePermissionHash();

  let resourceMapper: { [key: string]: Resource } = {};

  permissions.value.forEach((permission: Permission) => {
    const {
      resource,
      entity,
    }: {
      resource: string;
      entity: string;
    } = decodePermission(permission.object);

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

    // Check if entity is org_id
    if (entity === getOrgId()) {
      resourceMapper[resource].permission[permission.permission].value = true;
    } else {
      let _entity: Entity | undefined = resourceMapper[resource].entities.find(
        (e: Entity) => e.name === entity
      );

      const isEntityPresent = !!_entity;

      if (!_entity) {
        _entity = getDefaultEntity();
        _entity.name = entity;
        _entity.resourceName = resource;
        _entity.isSelected = true;
      }

      _entity.permission[
        permission.permission as
          | "AllowAll"
          | "AllowGet"
          | "AllowDelete"
          | "AllowPut"
      ].value = true;

      if (!isEntityPresent)
        resourceMapper[resource].entities.push(cloneDeep(_entity));
      _entity = undefined;
    }
  });

  resourceMapper = {};
};

const decodePermission = (permission: string) => {
  const [resource, entity] = permission.split(":");
  return { resource, entity };
};

const cancelPermissionsUpdate = () => {};

const handlePermissionChange = (row: any, permission: string) => {
  let entity = "";

  if (row.type === "resource")
    entity = store.state.selectedOrganization.identifier;
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

const updateTableData = (value: string = filter.value.permissions) => {
  filter.value.permissions = value;

  if (value === "all") {
    permissionTableRows.value = permissionsState.permissions;
  } else {
    permissionTableRows.value = filterSelectedPermissions(
      permissionsState.permissions
    ) as Resource[];
  }
};

const filterSelectedPermissions = (
  permissions: (Resource | Entity)[]
): (Resource | Entity)[] => {
  return permissions.filter((permission: Entity | Resource) => {
    // Check if any permission value is true
    const showResource = Object.values(permission.permission).some(
      (permDetail) => permDetail.value
    );

    // Check if any entity should be shown by recursively filtering
    const filteredEntities = permission.entities?.length
      ? filterSelectedPermissions(permission.entities)
      : [];
    const showEntity = filteredEntities.length > 0;

    // Modify the permission object to add `has_entities` and `expand` properties
    // permission.has_entities = showEntity;
    permission.expand = false;

    // Return true if either the permission should be shown or it has entities to be shown
    return showResource || showEntity;
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
  if (!filter.value.resource) return updateTableData();
  updateTableData();
  permissionTableRows.value = filterRowsByResourceName(
    permissionTableRows.value,
    filter.value.resource
  ) as Resource[];
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
  if (!resource.expand) await getResourceEntities(resource);

  resource.expand = !resource.expand;
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
const getResourceEntities = (resource: Resource) => {
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
    folder: getFolders,
    dashboard: getDashboards,
  };

  return new Promise(async (resolve, reject) => {
    await listEntitiesFnMap[resource.resourceName](resource);
    resolve(true);
  });
};

const getEnrichmentTables = () => {
  return new Promise((resolve) => {
    resolve(true);
  });
};

const getDashboards = async (resource: Entity | Resource) => {
  const dashboards = await dashboardService.list(
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
  const folders = await dashboardService.list_Folders(
    store.state.selectedOrganization.identifier
  );
  updateResourceEntities(
    "folder",
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
        return acc ? acc + "_" + (_entity[curr] || curr) : _entity[curr];
      }, "");
    }

    if (entity.entities)
      entity.entities.push({
        name: entityName,
        permission: {
          AllowAll: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.resourceName, "AllowAll", entityName)
            ),
            show: true,
          },
          AllowGet: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.resourceName, "AllowGet", entityName)
            ),
            show: true,
          },
          AllowDelete: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.resourceName, "AllowDelete", entityName)
            ),
            show: true,
          },
          AllowPut: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.resourceName, "AllowPut", entityName)
            ),
            show: true,
          },
          AllowList: {
            value: selectedPermissionsHash.value.has(
              getPermissionHash(entity.resourceName, "AllowList", entityName)
            ),
            show: hasEntities,
          },
        },
        entities: [],
        type: "entity",
        resourceName: hasEntities
          ? entity.entities[0].resourceName
          : entity.resourceName,
        isSelected: false,
        has_entities: hasEntities,
        display_name: displayNameKey ? _entity[displayNameKey] : entityName,
      });
  });

  if (filter.value.permissions === "selected") {
    entity.entities = filterSelectedPermissions(entity.entities) as Entity[];
  }
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
        return acc ? acc + "_" + (_entity[curr] || curr) : _entity[curr];
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
      },
      entities: [],
      type: "entity",
      resourceName: hasEntities
        ? resource.childs[0].resourceName
        : resourceName,
      isSelected: false,
      has_entities: hasEntities,
      display_name: displayNameKey ? _entity[displayNameKey] : entityName,
    });
  });

  if (filter.value.permissions === "selected") {
    resource.entities = filterSelectedPermissions(
      resource.entities
    ) as Entity[];
  }
};

const saveRolePermissions = () => {
  const payload = {
    add: Object.values(addedPermissions.value),
    remove: Object.values(removedPermissions.value),
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
