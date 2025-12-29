<!-- Copyright 2023 OpenObserve Inc.

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
  <q-page class="q-pa-none" style="min-height: inherit; height: calc(100vh - 44px);">
    <div>
      <div class="card-container tw:mb-[0.625rem]">
      <div class="tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px]"
        >
        <div
          data-test="iam-roles-section-title"
          class="q-table__title tw:font-[600]"
        >
          {{ t("iam.roles") }}
        </div>
        <div class="row items-center justify-end">
            <div data-test="iam-roles-search-input">
              <q-input
                v-model="filterQuery"
                borderless
                dense
                class="q-ml-auto no-border o2-search-input tw:h-[36px]"
                :placeholder="t('iam.searchRole')"
              >
                <template #prepend>
                  <q-icon class="o2-search-input-icon" name="search" />
                </template>
              </q-input>
            </div>

            <q-btn
              data-test="alert-list-add-alert-btn"
              class="q-ml-sm o2-primary-button tw:h-[36px]"
              flat
              no-caps
              :label="t(`iam.addRole`)"
              @click="addRole"
            />
          </div>
      </div>
    </div>
      <div class="tw:w-full tw:h-full">
      <div class="card-container tw:h-[calc(100vh-127px)]">
    <app-table
      data-test="iam-roles-table-section"
      class="iam-table o2-quasar-app-table o2-quasar-table-header-sticky"
      :tableStyle="hasVisibleRows ? 'height: calc(100vh - 127px); overflow-y: auto;' : ''"
      :rows="visibleRows"
      :columns="columns"
      pagination
      :rows-per-page="20"
      :filter="{
        value: filterQuery,
        method: filterRoles,
      }"
      :bordered="false"
      :title="t('iam.roles')"
      :hideTopPagination="true"
      :showBottomPaginationWithTitle="true"
      selection="multiple"
      row-key="role_name"
      v-model:selected="selectedRoles"
      :theme="store.state.theme"
    >
      <template v-slot:actions="slotProps: any">
        <div class="tw:flex tw:items-center tw:gap-2 tw:justify-center">
          <q-btn
            :data-test="`iam-roles-edit-${slotProps.column.row.role_name}-role-icon`"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            icon="edit"
            :title="t('common.edit')"
            @click="() => editRole(slotProps.column.row)"
          >
          </q-btn>
          <q-btn
            :data-test="`iam-roles-delete-${slotProps.column.row.role_name}-role-icon`"
            padding="sm"
            unelevated
            size="sm"
            round
            flat
            :icon="outlinedDelete"
            :title="t('common.delete')"
            @click="() => showConfirmDialog(slotProps.column.row)"
          >
          </q-btn>
        </div>
      </template>
      <template v-slot:bottom-actions>
        <q-btn
          v-if="selectedRoles.length > 0"
          data-test="iam-roles-bulk-delete-btn"
          class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
          :class="
            store.state.theme === 'dark'
              ? 'o2-secondary-button-dark'
              : 'o2-secondary-button-light'
          "
          no-caps
          dense
          @click="openBulkDeleteDialog"
        >
          <q-icon name="delete" size="16px" />
          <span class="tw:ml-2">{{ t('common.delete') }}</span>
        </q-btn>
      </template>
    </app-table>
  </div>
  </div>
  </div>
  <q-dialog v-model="showAddGroup" position="right" full-height maximized>
    <AddRole
      style="width: 30vw"
      @cancel:hideform="hideForm"
      @added:role="setupRoles"
    />
  </q-dialog>
  <ConfirmDialog
    title="Delete Role"
    :message="`Are you sure you want to delete '${deleteConformDialog?.data?.role_name as string}' role?`"
    @update:ok="_deleteRole"
    @update:cancel="deleteConformDialog.show = false"
    v-model="deleteConformDialog.show"
  />
  <ConfirmDialog
    title="Bulk Delete Roles"
    :message="`Are you sure you want to delete ${selectedRoles.length} role(s)?`"
    @update:ok="bulkDeleteUserRoles"
    @update:cancel="confirmBulkDelete = false"
    v-model="confirmBulkDelete"
  />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref } from "vue";
import AddRole from "./AddRole.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { getRoles, deleteRole, bulkDeleteRoles } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import { useQuasar } from "quasar";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

const { t } = useI18n();

const { track } = useReo();

const showAddGroup = ref(false);

const rows: any = ref([]);

const router = useRouter();

const store = useStore();

const q = useQuasar();

const deleteConformDialog = ref({
  show: false,
  data: null as any,
});

const selectedRoles: any = ref([]);
const confirmBulkDelete = ref(false);

const columns: any = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
    style: "width: 67px"
  },
  {
    name: "role_name",
    field: "role_name",
    label: t("iam.roleName"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("common.actions"),
    align: "center",
    sortable: false,
    slot: true,
    slotName: "actions",
    classes: "actions-column",
  },
];

const { rolesState } = usePermissions();

onBeforeMount(() => {
  setupRoles();
});

const filterQuery = ref("");

const updateTable = () => {
   let counter = 1;
  rows.value = cloneDeep(
    rolesState.roles.map((role: { role_name: string }, index) => ({
      ...role,
      // "#": index + 1,
       "#": counter <= 9 ? `0${counter++}` : counter++,
    }))
  );
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

const setupRoles = async () => {
  await getRoles(store.state.selectedOrganization.identifier)
    .then((res) => {
      rolesState.roles = res.data.map((role: string) => ({
        role_name: role,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    });
};

const filterRoles = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["role_name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};

const hideForm = () => {
  showAddGroup.value = false;
};

const deleteUserRole = (role: any) => {
  deleteRole(role.role_name, store.state.selectedOrganization.identifier)
    .then(() => {
      q.notify({
        message: "Role deleted successfully!",
        color: "positive",
        position: "bottom",
      });
      setupRoles();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        q.notify({
          message: "Error while deleting role!",
          color: "negative",
          position: "bottom",
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
  const roleNames = selectedRoles.value.map((role: any) => role.role_name);

  try {
    const response = await bulkDeleteRoles(store.state.selectedOrganization.identifier, {
      ids: roleNames,
    });

    const { successful = [], unsuccessful = [], err } = response.data || {};

    if (err) {
      throw new Error(err);
    }

    if (successful.length > 0 && unsuccessful.length === 0) {
      q.notify({
        message: `Successfully deleted ${successful.length} role(s)`,
        color: "positive",
        position: "bottom",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      q.notify({
        message: `Deleted ${successful.length} role(s). Failed to delete ${unsuccessful.length} role(s)`,
        color: "warning",
        position: "bottom",
      });
    } else if (unsuccessful.length > 0) {
      q.notify({
        message: `Failed to delete ${unsuccessful.length} role(s)`,
        color: "negative",
        position: "bottom",
      });
    }

    await setupRoles();
    selectedRoles.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      q.notify({
        message: error.response?.data?.message || error?.message || "Error while deleting roles",
        color: "negative",
        position: "bottom",
      });
    }
    confirmBulkDelete.value = false;
  }
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return rows.value || []
  return filterRoles(rows.value || [], filterQuery.value)
})

const hasVisibleRows = computed(() => visibleRows.value.length > 0)
</script>

<style scoped></style>
<style lang="scss">
.iam-table {
  .thead-sticky,
  .tfoot-sticky {
    position: sticky;
    top: 0;
    opacity: 1;
    z-index: 1;
    background: transparent !important;
  }

  .q-table--dark .thead-sticky,
  .q-table--dark .tfoot-sticky {
    background: transparent !important;
  }
}
</style>
