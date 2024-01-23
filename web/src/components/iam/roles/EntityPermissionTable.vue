<template>
  <AppTable :rows="rows" :columns="columns" :hide-header="true" class="q-mt-sm">
    <template v-slot:permission="slotProps">
      <q-checkbox
        size="xs"
        v-model="slotProps.column.row.permission"
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

const props = defineProps({
  permissions: {
    type: Array,
    default: () => [],
  },
});

const { t } = useI18n();

const rows: any = ref([]);

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
  rows.value = cloneDeep(
    props.permissions.map((permission: any, index: number) => ({
      ...permission,
      permission: [],
      "#": index + 1,
    }))
  );
};

const getUpdatedPermissions = () => {
  return cloneDeep(
    rows.value.map((permission: any) => ({
      entity: permission.object,
      permission: permission.permission,
    }))
  );
};
setPermissionTable();
</script>

<style scoped></style>
