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
          v-model="filter.searchKey"
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
          use-input
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
  searchKey: "",
  permissions: "selected",
});

const resources = computed(() => permissionsState.resources);

const getRoleDetails = () => {
  getResources(store.state.selectedOrganization.identifier).then(
    async (res) => {
      const resources = [
        {
          key: "stream",
          display_value: "Stream",
          has_entities: false,
          order: 1,
          parent: null,
        },
        {
          key: "dashboard",
          display_value: "Dashboard",
          has_entities: false,
          order: 3,
          parent: null,
        },
        {
          key: "folder",
          display_value: "Folder",
          has_entities: false,
          order: 6,
          parent: "dashboard",
        },
        {
          key: "syslog-route",
          display_value: "Syslog-route",
          has_entities: false,
          order: 7,
          parent: null,
        },
        {
          key: "org",
          display_value: "Org",
          has_entities: false,
          order: 8,
          parent: null,
        },
        {
          key: "rumtoken",
          display_value: "Rumtoken",
          has_entities: false,
          order: 9,
          parent: null,
        },
        {
          key: "role",
          display_value: "Role",
          has_entities: false,
          order: 10,
          parent: null,
        },
        {
          key: "enrichment_table",
          display_value: "Enrichment table",
          has_entities: false,
          order: 11,
          parent: null,
        },
        {
          key: "group",
          display_value: "Group",
          has_entities: false,
          order: 12,
          parent: null,
        },
        {
          key: "template",
          display_value: "Template",
          has_entities: false,
          order: 13,
          parent: null,
        },
        {
          key: "function",
          display_value: "Function",
          has_entities: false,
          order: 14,
          parent: null,
        },
        {
          key: "destination",
          display_value: "Destination",
          has_entities: false,
          order: 15,
          parent: null,
        },
        {
          key: "user",
          display_value: "User",
          has_entities: false,
          order: 16,
          parent: null,
        },
        {
          key: "settings",
          display_value: "Settings",
          has_entities: false,
          order: 17,
          parent: null,
        },
        {
          key: "savedviews",
          display_value: "Savedviews",
          has_entities: false,
          order: 18,
          parent: null,
        },
        {
          key: "alert",
          display_value: "Alert",
          has_entities: false,
          order: 19,
          parent: null,
        },
      ];

      permissionsState.resources = resources.sort((a, b) => a.order - b.order);
      setDefaultPermissions();
      await getResourcePermissions();
      updateRolePermissions();
    }
  );
};

const getResourceByName = (resourceName: string) => {
  return permissionsState.permissions.find(
    (resource: Resource) => resource.resourceName === resourceName
  );
};

const setDefaultPermissions = () => {
  //TODO: Need to make it recursive to support multi level nested resources
  permissionsState.resources.forEach((resource: any) => {
    const resourcePermission = getDefaultResource();
    resourcePermission.name = resource.display_value;
    resourcePermission.resourceName = resource.key;

    resourcePermission.parent = resource.parent;

    if (resource.parent) {
      const parentResource = getResourceByName(resource.parent);
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
  permissionsState.resources.forEach((resourceName) => {
    promises.push(
      getResourcePermission({
        role_name: editingRole.value,
        org_identifier: store.state.selectedOrganization.identifier,
        resource: resourceName,
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
      AllowAll: false,
      AllowList: false,
      AllowGet: false,
      AllowDelete: false,
      AllowPost: false,
      AllowPut: false,
    },
    parent: "",
    childs: [],
    type: "resource",
    resourceName: "",
    isSelected: false,
    entities: [],
  };
};

const getOrgId = () => {
  return store.state.selectedOrganization.identifier;
};

const updateRolePermissions = () => {
  console.log("updateRolePermissions");
  let resourceMapper: { [key: string]: any } = {};

  permissionsState.permissions.forEach(
    (resource: Resource, index) =>
      (resourceMapper[resource.resourceName] =
        permissionsState.permissions[index])
  );

  permissions.value.forEach((permission: Permission) => {
    const { resource, entity } = decodePermission(permission.object);

    if (resourceMapper[resource]) {
      // Creating permissions hash to check if permission is selected at the time of save as we need to send only added and removed permissions
      const permissionHash = `${resource}:${entity}:${permission.permission}`;
      permissionsHash.value.add(permissionHash);
      selectedPermissionsHash.value.add(permissionHash);

      // Check if entity is org_id
      if (entity === getOrgId()) {
        resourceMapper[resource].permission[permission.permission] = true;
      } else {
        let _entity: Entity | null = resourceMapper[resource].entities.find(
          (e: Entity) => e.name === entity
        );

        const isEntityPresent = !!_entity;

        if (!_entity) {
          _entity = {
            name: entity,
            permission: {
              AllowAll: false,
              AllowGet: false,
              AllowDelete: false,
              AllowPut: false,
            },
            type: "entity",
            resourceName: resource,
            isSelected: true,
          };
        }

        _entity.permission[
          permission.permission as
            | "AllowAll"
            | "AllowGet"
            | "AllowDelete"
            | "AllowPut"
        ] = true;

        if (!isEntityPresent)
          resourceMapper[resource].entities.push(cloneDeep(_entity));
        _entity = null;
      }
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
    permissionTableRows.value = permissionsState.permissions.filter(
      (permission: any) => {
        const showResource = Object.values(permission.permission).some(
          (permission: any) => permission
        );

        const showEntity = Object.values(permission.entities).some(
          (entity: any) =>
            Object.values(entity.permission).some(
              (permission: any) => permission
            )
        );

        permission.has_entities = showEntity;
        permission.expand = false;

        return showResource || showEntity;
      }
    );
  }
};

const onResourceChange = () => {
  if (!filter.value.resource) return updateTableData();
  permissionTableRows.value = permissionTableRows.value.filter(
    (row: any) => row.resourceName === filter.value.resource
  );
};

const expandPermission = async (resource: any) => {
  if (
    filter.value.permissions === "all" &&
    resource.type === "resource" &&
    !resource.parent &&
    !resource.expand
  )
    await getResourceEntities(resource.resourceName);

  resource.expand = !resource.expand;

  if (resource.childs.length) {
    resource.slotName = "resource_table";
  } else {
    resource.slotName = "entity_table";
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

const getResourceEntities = (resource: string) => {
  const listEntitiesFnMap: {
    [key: string]: () => Promise<any>;
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
    dashboard: getDashboards,
  };

  return new Promise(async (resolve, reject) => {
    console.log("2");
    await listEntitiesFnMap[resource]();
    console.log("6");
    resolve(true);
  });
};

const getEnrichmentTables = () => {
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

const getDashboards = () => {
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
  console.log("3");

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
    console.log("5");
    resolve(true);
  });
};

const updateResourceEntities = (
  resourceName: string,
  entityNameKeys: string[],
  data: any[]
) => {
  const resourceIndex = permissionsState.permissions.findIndex(
    (row: any) => row.resourceName === resourceName
  );

  permissionsState.permissions[resourceIndex].entities.length = 0;
  permissionsState.permissions[resourceIndex].entities = [];

  data.forEach((_entity: any) => {
    let entityName = "";
    if (typeof _entity === "string") entityName = _entity;

    if (typeof _entity === "object") {
      entityName = entityNameKeys.reduce((acc, curr) => {
        return acc ? acc + "_" + (_entity[curr] || curr) : _entity[curr];
      }, "");
    }

    permissionsState.permissions[resourceIndex].entities.push({
      name: entityName,
      permission: {
        AllowAll: selectedPermissionsHash.value.has(
          getPermissionHash(resourceName, "AllowAll", entityName)
        ),
        AllowGet: selectedPermissionsHash.value.has(
          getPermissionHash(resourceName, "AllowGet", entityName)
        ),
        AllowDelete: selectedPermissionsHash.value.has(
          getPermissionHash(resourceName, "AllowDelete", entityName)
        ),
        AllowPut: selectedPermissionsHash.value.has(
          getPermissionHash(resourceName, "AllowPut", entityName)
        ),
      },
      type: "entity",
      resourceName: resourceName,
      isSelected: false,
    });
  });
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
