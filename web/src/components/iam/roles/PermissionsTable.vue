<template>
  <div style="font-size: 16px">Permissions</div>
  <div>
    <AppTable :rows="rows" :columns="columns" class="q-mt-sm">
      <template v-slot:expand="slotProps">
        <q-icon
          :name="
            expandedPermissions.has(slotProps.column.row.object)
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
          v-model="slotProps.column.row.permission"
          :val="slotProps.columnName"
          class="filter-check-box cursor-pointer"
        />
      </template>

      <template v-slot:entity_table="slotProps">
        <entity-permission-table :permissions="entities" />
      </template>
    </AppTable>
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
        @click="updateRolePermissions"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import AppTable from "@/components/AppTable.vue";
import EntityPermissionTable from "@/components/iam/roles/EntityPermissionTable.vue";

const props = defineProps({
  permissions: {
    type: Array,
    default: () => [],
  },
});

const entities = [{ name: "default" }, { name: "k8s" }];

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
    slot: true,
    slotName: "expand",
    style: "width: 45px",
  },
  {
    name: "object",
    field: "object",
    label: t("iam.permissionName"),
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
    name: "AllowList",
    field: "permission",
    label: t("iam.list"),
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
    name: "AllowPost",
    field: "permission",
    label: t("iam.create"),
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

const expandPermission = (permission: any) => {
  if (expandedPermissions.value.has(permission.object)) {
    expandedPermissions.value.delete(permission.object);
  } else {
    expandedPermissions.value.add(permission.object);
  }

  // Updating expand key in table
  rows.value.forEach((row: any) => {
    if (row.object === permission.object) {
      row.expand = !row.expand;
      row.slotName = "entity_table";
    }
  });
};

const setPermissionTable = () => {
  rows.value = cloneDeep(
    props.permissions.map((permission: any, index: number) => ({
      ...permission,
      permission: [],
      "#": index + 1,
    }))
  );
};

const updateRolePermissions = () => {};

const cancelPermissionsUpdate = () => {};

setPermissionTable();
</script>

<style scoped></style>
