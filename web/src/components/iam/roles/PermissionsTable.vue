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
    <q-select
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
      style="width: 200px"
    />
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
      emit-value
      style="width: 200px"
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
    <AppTable :rows="rows" :columns="columns"
:dense="true" class="q-mt-sm">
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
        />
      </template>
    </AppTable>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref, defineEmits } from "vue";
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import AppTable from "@/components/AppTable.vue";
import EntityPermissionTable from "@/components/iam/roles/EntityPermissionTable.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { useStore } from "vuex";

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

const expandPermission = (permission: any) => {
  if (expandedPermissions.value.has(permission.name)) {
    expandedPermissions.value.delete(permission.name);
  } else {
    expandedPermissions.value.add(permission.name);
  }

  // Updating expand key in table
  rows.value.forEach((row: any) => {
    if (row.name === permission.name) {
      row.expand = !row.expand;
      row.slotName = "entity_table";
    }
  });
};

const getResources = [
  {
    label: "Stream",
    value: "stream",
  },
  {
    label: "Functions",
    value: "functions",
  },
];

const getUpdatedPermissions = () => {
  return cloneDeep(
    rows.value.map((permission: any) => ({
      object: permission.object,
      permission: permission.permission,
    }))
  );
};

const updateTableData = (value: string) => {
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
};

const handlePermissionChange = (row: any, permission: string) => {
  emits("updated:permission", row, permission);
};
updateTableData(filter.value.permissions);
</script>

<style scoped></style>
<style lang="scss">
.iam-permissions-table {
  .q-table--bordered {
    border: none;
  }
}
</style>
