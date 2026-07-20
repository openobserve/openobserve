<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="p-0 h-full flex flex-col">
    <!-- Standard page header: title + actions only. Search moved into the
         table's own toolbar (built-in global filter). -->
    <AppPageHeader
      :title="t('iam.roles')"
      icon="shield"
      class="shrink-0 px-4 border-b border-border-default"
    >
      <template #subtitle>
        <span data-test="iam-roles-subtitle">
          {{ t('iam.rolesPage.subtitle') }}
        </span>
      </template>
      <template #actions>
        <OButton
          data-test="alert-list-add-alert-btn"
          variant="primary"
          size="sm"
          @click="addRole"
        >
          {{ t('iam.addRole') }}
        </OButton>
      </template>
    </AppPageHeader>
    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="card-container h-full">
        <RoleTable
          data-test="iam-roles-table-section"
          :data="rows"
          :loading="loading"
          v-model:global-filter="filterQuery"
          :selected-ids="selectedRoleNames"
          @update:selected-ids="onSelectionChange"
          @edit="editRole"
          @delete="showConfirmDialog"
          @bulk-delete="openBulkDeleteDialog"
          @create="addRole"
        >
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="iam-roles-refresh-btn"
              @click="setupRoles"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="iamRolesRefresh" />
            </OButton>
          </template>
        </RoleTable>
      </div>
    </div>
  </div>
  <AddRole
    v-model:open="showAddGroup"
    @added:role="onRoleAdded"
  />
  <ConfirmDialog
    :title="t('iam.appRoles.deleteRole')"
    :message="t('iam.appRoles.deleteConfirm', { roleName: deleteConformDialog?.data?.role_name })"
    :warning-message="deleteImpactMessage"
    @update:ok="_deleteRole"
    @update:cancel="deleteConformDialog.show = false"
    v-model="deleteConformDialog.show"
  />
  <ConfirmDialog
    :title="t('iam.appRoles.bulkDeleteRoles')"
    :message="t('iam.appRoles.bulkDeleteConfirm', { count: selectedRoleNames.length })"
    :warning-message="bulkDeleteImpactMessage"
    @update:ok="bulkDeleteUserRoles"
    @update:cancel="confirmBulkDelete = false"
    v-model="confirmBulkDelete"
  />
</template>

<script setup lang="ts">
import { onBeforeMount, ref } from "vue";
import AddRole from "./AddRole.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { useI18n } from "vue-i18n";
import RoleTable from "./RoleTable.vue";
import { useRouter } from "vue-router";
import { getRoles, deleteRole, bulkDeleteRoles, getRoleUsers } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";



const { t } = useI18n();

const { track } = useReo();

const filterQuery = ref("");

const showAddGroup = ref(false);

const rows: any = ref([]);

const router = useRouter();

const store = useStore();


const deleteConformDialog = ref({
  show: false,
  data: null as any,
});

const selectedRoleNames = ref<string[]>([]);
const onSelectionChange = (ids: string[]) => { selectedRoleNames.value = ids; };
const confirmBulkDelete = ref(false);



const { rolesState } = usePermissions();

onBeforeMount(() => {
  setupRoles();
});

const updateTable = () => {
   let counter = 1;
  rows.value = rolesState.roles.map((role: { role_name: string }, index: number) => ({
      ...role,
      "#": counter <= 9 ? `0${counter++}` : counter++,
    }));
};

const addRole = () => {
  track("Button Click", {
    button: "Add Role",
    page: "Roles"
  });
  showAddGroup.value = true;
};

// After a role is created, route straight into EditRole on the Permissions tab
// so the user can start assigning permissions instead of being dropped back on
// the list with an empty, useless role. The "Read-only" preset is passed
// through so EditRole can seed the starting permissions.
const onRoleAdded = (payload: { role_name: string; startFrom?: string }) => {
  if (!payload?.role_name) {
    setupRoles();
    return;
  }

  router.push({
    name: "editRole",
    params: {
      role_name: payload.role_name,
    },
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      tab: "permissions",
      ...(payload.startFrom === "readonly" ? { preset: "readonly" } : {}),
    },
  });
};

const editRole = (role: any) => {
  router.push({
    name: "editRole",
    params: {
      role_name: role.role_name,
    },
    query:{
      org_identifier: store.state.selectedOrganization.identifier
    }
  });
};

const loading = ref(false);
const setupRoles = async () => {
  loading.value = true;
  await getRoles(store.state.selectedOrganization.identifier)
    .then((res) => {
      rolesState.roles = res.data.map((role: string) => ({
        role_name: role,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    })
    .finally(() => {
      loading.value = false;
    });
};

const hideForm = () => {
  showAddGroup.value = false;
};

const deleteUserRole = (role: any) => {
  deleteRole(role.role_name, store.state.selectedOrganization.identifier)
    .then(() => {
      toast({
        message: t("iam.appRoles.roleDeletedSuccess"),
        variant: "success",
      });
      setupRoles();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        toast({
          message: t("iam.appRoles.roleDeleteError"),
          variant: "error",
        });
      }
    });
};

// Blast-radius warning for the single-role delete dialog. We resolve the live
// user count with one getRoleUsers call on delete-click (the list payload has
// no counts), and always warn about bound service accounts via static copy
// since there is no role→service-accounts count endpoint.
const deleteImpactMessage = ref("");

const showConfirmDialog = async (row: any) => {
  deleteConformDialog.value.show = true;
  deleteConformDialog.value.data = row;
  deleteImpactMessage.value = t("iam.rolesPage.delete.impact", { count: 0 });

  try {
    const res = await getRoleUsers(
      row.role_name,
      store.state.selectedOrganization.identifier,
    );
    const userCount = Array.isArray(res.data) ? res.data.length : 0;
    deleteImpactMessage.value = t("iam.rolesPage.delete.impact", {
      count: userCount,
    });
  } catch (err) {
    // If the count lookup fails, keep the generic static warning rather than
    // blocking the delete.
    console.log(err);
  }
};

const _deleteRole = () => {
  deleteUserRole(deleteConformDialog.value.data);
  deleteConformDialog.value.data = null;
};

// Blast-radius warning for the bulk-delete dialog. With exactly one role
// selected we resolve its live user count (one getRoleUsers call), matching the
// per-row delete. For 2+ roles we keep static copy to avoid N requests.
const bulkDeleteImpactMessage = ref("");

const openBulkDeleteDialog = async () => {
  confirmBulkDelete.value = true;

  if (selectedRoleNames.value.length === 1) {
    bulkDeleteImpactMessage.value = t("iam.rolesPage.delete.impact", {
      count: 0,
    });
    try {
      const res = await getRoleUsers(
        selectedRoleNames.value[0],
        store.state.selectedOrganization.identifier,
      );
      const userCount = Array.isArray(res.data) ? res.data.length : 0;
      bulkDeleteImpactMessage.value = t("iam.rolesPage.delete.impact", {
        count: userCount,
      });
    } catch (err) {
      console.log(err);
    }
  } else {
    bulkDeleteImpactMessage.value = t("iam.rolesPage.bulkDelete.impact");
  }
};

const bulkDeleteUserRoles = async () => {
  const roleNames = selectedRoleNames.value;

  try {
    const response = await bulkDeleteRoles(store.state.selectedOrganization.identifier, {
      ids: roleNames,
    });

    const { successful = [], unsuccessful = [], err } = response.data || {};

    if (err) {
      throw new Error(err);
    }

    if (successful.length > 0 && unsuccessful.length === 0) {
      toast({
        message: t("iam.appRoles.bulkDeleteSuccess", { count: successful.length }),
        variant: "success",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      toast({
        message: t("iam.appRoles.bulkDeletePartial", { successful: successful.length, unsuccessful: unsuccessful.length }),
        variant: "warning",
      });
    } else if (unsuccessful.length > 0) {
      toast({
        message: t("iam.appRoles.bulkDeleteFailed", { count: unsuccessful.length }),
        variant: "error",
      });
    }

    await setupRoles();
    selectedRoleNames.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        message: error.response?.data?.message || error?.message || t("iam.appRoles.bulkDeleteRolesError"),
        variant: "error",
      });
    }
    confirmBulkDelete.value = false;
  }
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────
useShortcuts([
  {
    id: "iamRolesAdd",
    handler: () => { if (!isInputFocused()) addRole(); },
  },
  {
    id: "iamRolesRefresh",
    handler: () => { if (!isInputFocused()) setupRoles(); },
  },
  {
    id: "iamRolesFocusSearch",
    handler: () => {
      focusSearchInput("iam-roles-search-input");
    },
  },
]);

</script>
