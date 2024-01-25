<template>
  <AppTable :rows="rows" :columns="columns" :hide-header="true" class="q-mt-sm">
    <template v-slot:permission="slotProps">
      <q-checkbox
        size="xs"
        v-model="slotProps.column.row.permission[slotProps.columnName]"
        :val="slotProps.columnName"
        class="filter-check-box cursor-pointer"
      />
    </template>
  </AppTable>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import AppTable from "@/components/AppTable.vue";
import usePermissions from "@/composables/iam/usePermissions";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import { watch } from "vue";

const props = defineProps({
  entity: {
    type: Object,
    default: () => {},
  },
  showSelected: {
    type: Boolean,
    default: false,
  },
});

const { t } = useI18n();

const rows: any = ref([]);

const { permissionsState } = usePermissions();

const expandedPermissions = ref(new Set());

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
    style: "width: 45px",
  },
  {
    name: "name",
    field: "name",
    label: t("iam.entityName"),
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

const setPermissionTable = () => {
  rows.value =
    permissionsState.permissions.find(
      (r: any) => r.resourceName === props.entity.resourceName
    )?.entities || [];
};

const getResourceEntities = () => {
  return Object.values(
    permissionsState.permissions.find(
      (r: any) => r.resourceName === props.entity.resourceName
    )?.entities || {}
  );
};

const updateTableData = () => {
  if (!props.showSelected) {
    rows.value = getResourceEntities();
  } else {
    rows.value = getResourceEntities().filter((entity: Entity) => {
      const showEntity = Object.values(entity.permission).some(
        (permission: any) => permission
      );

      return showEntity;
    });
  }
};

watch(
  () => props.showSelected,
  () => {
    updateTableData();
  }
);

updateTableData();
</script>

<style scoped></style>
