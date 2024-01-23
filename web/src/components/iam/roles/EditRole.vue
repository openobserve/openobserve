<template>
  <div>
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingRole.role_name }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <div
      class="q-px-md q-py-md"
      style="height: calc(100vh - 101px); overflow-y: auto"
    >
      <permissions-table :permissions="permissions" />
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
  </div>
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { defineProps } from "vue";
import type { Permission } from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";

const props = defineProps({
  role: {
    type: Object,
    default: () => ({
      role_name: "dev",
      permissions: [],
    }),
  },
});

const { t } = useI18n();

const permissions: any[] = [
  {
    name: "stream",
    permission: [],
    type: "Resource",
    resourceName: "stream",
  },
  {
    name: "functions",
    permission: [],
    type: "Resource",
    resourceName: "stream",
  },
  {
    name: "alerts",
    permission: [],
    type: "Resource",
    resourceName: "Alerts",
  },
];
const editingRole = ref(cloneDeep(props.role));

const setEditingRole = () => {
  editingRole.value = cloneDeep(props.role);
  editingRole.value.permissions = permissions;
};

const updateRolePermissions = () => {
  console.log(permissions);
};

const cancelPermissionsUpdate = () => {};

setEditingRole();
</script>

<style scoped></style>
