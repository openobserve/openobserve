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
      data-test="iam-groups-section-title"
      class="q-table__title tw:font-[600]"
    >
      {{ t("iam.groups") }}
    </div>
    <div class=" row items-center justify-end">
        <div data-test="iam-groups-search-input">
          <q-input
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw:h-[36px]"
              :placeholder="t('iam.searchGroup')"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
        </div>
        <q-btn
          data-test="iam-groups-add-group-btn"
          class="q-ml-sm o2-primary-button tw:h-[36px]"
          flat
          no-caps
          :label="t(`iam.addGroup`)"
          @click="addGroup"
        />
      </div>
    </div>
    </div>
    <div class="tw:w-full tw:h-full">
      <div class="card-container tw:h-[calc(100vh-127px)]">      
        <app-table
        data-test="iam-groups-table-section"
        class="iam-table o2-quasar-app-table o2-quasar-table-header-sticky"
        :tableStyle="hasVisibleRows ? 'height: calc(100vh - 127px); overflow-y: auto;' : ''"
        :rows="visibleRows"
        :columns="columns"
        pagination
        :rows-per-page="20"
        :filter="{
          value: filterQuery,
          method: filterGroups,
        }"
        :bordered="false"
        :title="t('iam.groups')"
        :hideTopPagination="true"
        :showBottomPaginationWithTitle="true"
        selection="multiple"
        row-key="group_name"
        v-model:selected="selectedGroups"
        :theme="store.state.theme"
      >
        <template  v-slot:actions="slotProps: any">
          <div class="tw:flex tw:items-center tw:gap-2 tw:justify-center">
            <q-btn
              :data-test="`iam-groups-edit-${slotProps.column.row.group_name}-role-icon`"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              icon="edit"
              :title="t('common.edit')"
              @click="editGroup(slotProps.column.row)"
            >
            </q-btn>
            <q-btn
              :data-test="`iam-groups-delete-${slotProps.column.row.group_name}-role-icon`"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              :icon="outlinedDelete"
              :title="t('common.delete')"
              @click="showConfirmDialog(slotProps.column.row)"
            >
            </q-btn>
          </div>
        </template>
        <template v-slot:bottom-actions>
          <q-btn
            v-if="selectedGroups.length > 0"
            data-test="iam-groups-bulk-delete-btn"
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
      <AddGroup
        style="width: 30vw"
        :org_identifier="store.state.selectedOrganization.identifier"
        @cancel:hideform="hideAddGroup"
        @added:group="setupGroups"
      />
    </q-dialog>
    <ConfirmDialog
      title="Delete Group"
      :message="`Are you sure you want to delete '${deleteConformDialog?.data?.group_name as string}'?`"
      @update:ok="_deleteGroup"
      @update:cancel="deleteConformDialog.show = false"
      v-model="deleteConformDialog.show"
    />
    <ConfirmDialog
      title="Bulk Delete Groups"
      :message="`Are you sure you want to delete ${selectedGroups.length} group(s)?`"
      @update:ok="bulkDeleteUserGroups"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
  </q-page>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from "vue";
import AddGroup from "./AddGroup.vue";
import { useI18n } from "vue-i18n";
import AppTable from "@/components/AppTable.vue";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups, deleteGroup, bulkDeleteGroups } from "@/services/iam";
import usePermissions from "@/composables/iam/usePermissions";
import { useQuasar } from "quasar";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";

const showAddGroup = ref(false);

const { t } = useI18n();

const { track } = useReo();

const rows: any = ref([]);

const router = useRouter();

const store = useStore();

const { groupsState } = usePermissions();

const filterQuery = ref("");

const q = useQuasar();

const deleteConformDialog = ref({
  show: false,
  data: null as any,
});

const selectedGroups: any = ref([]);
const confirmBulkDelete = ref(false);

const columns: any = [
  {
    name: "#",
    label: "#",
    field: "#",
    align: "left",
    style: "width: 67px;",
  },
  {
    name: "group_name",
    field: "group_name",
    label: t("iam.groupName"),
    align: "left",
    sortable: true,
  },
  {
    name: "actions",
    field: "actions",
    label: t("alerts.actions"),
    align: "center",
    sortable: false,
    slot: true,
    slotName: "actions",
    classes: "actions-column",
  },
];

const groups = ref([]);

onBeforeMount(() => {
  setupGroups();
});

const updateTable = () => {
  let counter = 1;
  rows.value = cloneDeep(
    groupsState.groups.map((group: { group_name: string }, index: number) => ({
      ...group,
      "#": counter <= 9 ? `0${counter++}` : counter++,
    }))
  );
};

const addGroup = () => {
  track("Button Click", {
    button: "Add Group",
    page: "Groups"
  });
  showAddGroup.value = true;
};

const editGroup = (group: any) => {
  router.push({
    name: "editGroup",
    params: {
      group_name: group.group_name,
    },
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

const setupGroups = async () => {
  await getGroups(store.state.selectedOrganization.identifier)
    .then((res) => {
      groupsState.groups = res.data.map((group: string) => ({
        group_name: group,
      }));
      updateTable();
    })
    .catch((err) => {
      console.log(err);
    });
};

const hideAddGroup = () => {
  showAddGroup.value = false;
};

const filterGroups = (rows: any, terms: any) => {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["group_name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
    }
  }
  return filtered;
};

const deleteUserGroup = (group: any) => {
  deleteGroup(group.group_name, store.state.selectedOrganization.identifier)
    .then(() => {
      q.notify({
        message: "Group deleted successfully!",
        color: "positive",
        position: "bottom",
      });
      setupGroups();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        q.notify({
          message: "Error while deleting group!",
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

const _deleteGroup = () => {
  deleteUserGroup(deleteConformDialog.value.data);
  deleteConformDialog.value.data = null;
};

const openBulkDeleteDialog = () => {
  confirmBulkDelete.value = true;
};

const bulkDeleteUserGroups = async () => {
  const groupNames = selectedGroups.value.map((group: any) => group.group_name);

  try {
    const response = await bulkDeleteGroups(store.state.selectedOrganization.identifier, {
      ids: groupNames,
    });

    const { successful = [], unsuccessful = [], err } = response.data || {};

    if (err) {
      throw new Error(err);
    }

    if (successful.length > 0 && unsuccessful.length === 0) {
      q.notify({
        message: `Successfully deleted ${successful.length} group(s)`,
        color: "positive",
        position: "bottom",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      q.notify({
        message: `Deleted ${successful.length} group(s). Failed to delete ${unsuccessful.length} group(s)`,
        color: "warning",
        position: "bottom",
      });
    } else if (unsuccessful.length > 0) {
      q.notify({
        message: `Failed to delete ${unsuccessful.length} group(s)`,
        color: "negative",
        position: "bottom",
      });
    }

    await setupGroups();
    selectedGroups.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      q.notify({
        message: error.response?.data?.message || error?.message || "Error while deleting groups",
        color: "negative",
        position: "bottom",
      });
    }
    confirmBulkDelete.value = false;
  }
};

const visibleRows = computed(() => {
  if (!filterQuery.value) return rows.value || []
  return filterGroups(rows.value || [], filterQuery.value)
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
