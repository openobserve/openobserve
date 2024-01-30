<template>
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
    <!-- <q-select
      v-model="filter.type"
      :options="permissionTypes"
      color="input-border"
      bg-color="input-bg"
      class="q-py-xs q-mr-sm"
      placeholder="Select Type"
      use-input
      fill-input
      hide-selected
      outlined
      filled
      dense
      emit-value
      clearable
      style="width: 200px"
    /> -->
    <q-select
      v-model="filter.resource"
      :options="getResources"
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
      style="border: 1px solid #d7d7d7; width: fit-content; border-radius: 2px"
    >
      <template v-for="visual in permissionDisplayOptions" :key="visual.value">
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
  <div class="q-mb-md text-bold">
    {{ permissionsState.permissions.length }} Permissions
  </div>
  <div class="iam-permissions-table">
    <AppTable
      :rows="rows"
      :columns="columns"
      :dense="true"
      class="q-mt-sm"
      :filter="{
        value: filter.searchKey,
        method: filterResources,
      }"
    >
      <template v-slot:expand="slotProps">
        <q-icon
          v-if="
            (filter.permissions === 'selected' &&
              slotProps.column.row.has_entities) ||
            filter.permissions === 'all'
          "
          :name="
            slotProps.column.row.expand
              ? 'keyboard_arrow_up'
              : 'keyboard_arrow_down'
          "
          class="cursor-pointer"
          :title="t('common.expand')"
          @click="() => expandPermission(slotProps.column.row)"
        />
      </template>

      <template v-slot:permission="slotProps">
        <q-checkbox
          size="xs"
          v-model="slotProps.column.row.permission[slotProps.columnName]"
          :val="slotProps.columnName"
          class="filter-check-box cursor-pointer"
          @update:model-value="
            handlePermissionChange(slotProps.column.row, slotProps.columnName)
          "
        />
      </template>

      <template v-slot:entity_table="slotProps">
        <entity-permission-table
          :entity="slotProps.row.row"
          :show-selected="filter.permissions === 'selected'"
          :searchKey="filter.searchKey"
          @updated:permission="handlePermissionChange"
        />
      </template>
    </AppTable>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, defineEmits, computed } from "vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import EntityPermissionTable from "@/components/iam/roles/EntityPermissionTable.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { useStore } from "vuex";
import streamService from "@/services/stream";
import alertService from "@/services/alerts";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import jsTransformService from "@/services/jstransform";
import organizationsService from "@/services/organizations";
import savedviewsService from "@/services/saved_views";
import { getGroups, getRoles } from "@/services/iam";

const props = defineProps({
  selectedPermissionsHash: {
    type: Set,
    default: () => new Set(),
  },
});

const emits = defineEmits(["updated:permission"]);

const { permissionsState } = usePermissions();

const store = useStore();

const permissionTypes = [
  {
    label: "Resource",
    value: "resource",
  },
  {
    label: "Entity",
    value: "entity",
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
const { t } = useI18n();

const rows: any = ref([]);

const expandedPermissions = ref(new Set());

const filter = ref({
  resource: "",
  type: "",
  searchKey: "",
  permissions: "selected",
});

const rolePermissions = [
  "AllowAll",
  "AllowDelete",
  "AllowGet",
  "AllowList",
  "AllowPost",
  "AllowPut",
  "None",
];

const columns: any = [
  {
    name: "expand",
    label: "",
    field: "expand",
    align: "center",
    slot: true,
    slotName: "expand",
    style: "width: 45px",
  },
  {
    name: "name",
    field: "name",
    label: t("common.name"),
    align: "left",
    sortable: true,
  },
  {
    name: "type",
    field: "type",
    label: t("common.type"),
    align: "left",
    style: "width: 100px",
  },
  {
    name: "resourceName",
    field: "resourceName",
    label: t("iam.resourceName"),
    align: "left",
    style: "width: 200px",
  },
  {
    name: "AllowAll",
    field: "permission",
    label: t("iam.all"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowList",
    field: "permission",
    label: t("iam.list"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowGet",
    field: "permission",
    label: t("iam.get"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowDelete",
    field: "permission",
    label: t("iam.delete"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowPost",
    field: "permission",
    label: t("iam.create"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
  {
    name: "AllowPut",
    field: "permission",
    label: t("iam.update"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 80px",
  },
];

const expandPermission = async (resource: any) => {
  const resourceIndex = rows.value.findIndex(
    (row: any) => row.name === resource.name
  );

  if (filter.value.permissions === "all" && !rows.value[resourceIndex].expand)
    await getResourceEntities(resource.name);

  if (expandedPermissions.value.has(resource.name)) {
    expandedPermissions.value.delete(resource.name);
  } else {
    expandedPermissions.value.add(resource.name);
  }

  // Updating expand key in table
  rows.value[resourceIndex].expand = !rows.value[resourceIndex].expand;
  rows.value[resourceIndex].slotName = "entity_table";
};

const getResources = computed(() => permissionsState.resources);

const getUpdatedPermissions = () => {
  return cloneDeep(
    rows.value.map((permission: any) => ({
      object: permission.object,
      permission: permission.permission,
    }))
  );
};

const updateTableData = (value: string = filter.value.permissions) => {
  filter.value.permissions = value;

  if (value === "all") {
    rows.value = permissionsState.permissions;
  } else {
    rows.value = permissionsState.permissions.filter((permission: any) => {
      const showResource = Object.values(permission.permission).some(
        (permission: any) => permission
      );

      const showEntity = Object.values(permission.entities).some(
        (entity: any) =>
          Object.values(entity.permission).some((permission: any) => permission)
      );

      permission.has_entities = showEntity;
      permission.expand = false;

      return showResource || showEntity;
    });
  }
  console.log(rows.value);
};

const handlePermissionChange = (row: any, permission: string) => {
  emits("updated:permission", row, permission);
};

const onResourceChange = () => {
  if (!filter.value.resource) return updateTableData();
  rows.value = rows.value.filter(
    (row: any) => row.name === filter.value.resource
  );
};

const filterResources = (rows: any, terms: any) => {
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
    (row: any) => row.name === resourceName
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
        AllowAll: props.selectedPermissionsHash.has(
          getPermissionHash(resourceName, "AllowAll", entityName)
        ),
        AllowGet: props.selectedPermissionsHash.has(
          getPermissionHash(resourceName, "AllowGet", entityName)
        ),
        AllowDelete: props.selectedPermissionsHash.has(
          getPermissionHash(resourceName, "AllowDelete", entityName)
        ),
        AllowPut: props.selectedPermissionsHash.has(
          getPermissionHash(resourceName, "AllowPut", entityName)
        ),
      },
      type: "entity",
      resourceName: resourceName,
      isSelected: false,
    });
  });
};

defineExpose({
  updateTableData,
});
</script>

<style scoped></style>
<style lang="scss">
.iam-permissions-table {
  .q-table--bordered {
    border: none;
  }
}
</style>
