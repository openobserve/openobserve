<template>
  <AppTable :rows="rows" :columns="columns" class="q-mt-sm">
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
    name: "name",
    field: "name",
    label: t("iam.entityName"),
    align: "left",
    sortable: true,
  },
  {
    name: "AllowAll",
    field: "permission",
    label: t("iam.all"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 100px",
  },
  {
    name: "AllowGet",
    field: "permission",
    label: t("iam.get"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 100px",
  },
  {
    name: "AllowDelete",
    field: "permission",
    label: t("iam.delete"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 100px",
  },
  {
    name: "AllowPut",
    field: "permission",
    label: t("iam.update"),
    align: "center",
    slot: true,
    slotName: "permission",
    style: "width: 100px",
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

setPermissionTable();
</script>

<style scoped></style>
