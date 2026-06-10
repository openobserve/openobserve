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
  <div class="tw:rounded-md tw:p-0 tw:h-full tw:flex tw:flex-col">
    <!-- Standard page header: title + actions only. Search moved into the
         table's own toolbar (built-in global filter). -->
    <AppPageHeader
      :title="t('iam.roles')"
      icon="shield"
      :subtitle="'Define permissions and access policies'"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
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
    <div class="tw:w-full tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <div class="card-container tw:h-full">
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
        />
      </div>
    </div>
  </div>
  <AddRole
    v-model:open="showAddGroup"
    @added:role="setupRoles"
  />
  <ConfirmDialog
    title="Delete Role"
    :message="`Are you sure you want to delete '${deleteConformDialog?.data?.role_name as string}' role?`"
    @update:ok="_deleteRole"
    @update:cancel="deleteConformDialog.show = false"
    v-model="deleteConformDialog.show"
  />
  <ConfirmDialog
    title="Bulk Delete Roles"
    :message="`Are you sure you want to delete ${selectedRoleNames.length} role(s)?`"
    @update:ok="bulkDeleteUserRoles"
    @update:cancel="confirmBulkDelete = false"
    v-model="confirmBulkDelete"
  />
</template>

<script setup lang="ts">
import { onBeforeMount, ref } from "vue";
import AddRole from "./AddRole.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { useI18n } from "vue-i18n";
import RoleTable from "./RoleTable.vue";
import { useRouter } from "vue-router";
import { getRoles, deleteRole, bulkDeleteRoles } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";



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
        message: "Role deleted successfully!",
        variant: "success",
      });
      setupRoles();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        toast({
          message: "Error while deleting role!",
          variant: "error",
        });
      }
    });
};

const showConfirmDialog = (row: any) => {
  deleteConformDialog.value.show = true;
  deleteConformDialog.value.data = row;
};

const _deleteRole = () => {
  deleteUserRole(deleteConformDialog.value.data);
  deleteConformDialog.value.data = null;
};

const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
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
        message: `Successfully deleted ${successful.length} role(s)`,
        variant: "success",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      toast({
        message: `Deleted ${successful.length} role(s). Failed to delete ${unsuccessful.length} role(s)`,
        variant: "warning",
      });
    } else if (unsuccessful.length > 0) {
      toast({
        message: `Failed to delete ${unsuccessful.length} role(s)`,
        variant: "error",
      });
    }

    await setupRoles();
    selectedRoleNames.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        message: error.response?.data?.message || error?.message || "Error while deleting roles",
        variant: "error",
      });
    }
    confirmBulkDelete.value = false;
  }
};


</script>

<style scoped></style>
