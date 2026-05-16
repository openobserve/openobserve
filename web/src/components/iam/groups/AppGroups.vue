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
  <div class="tw:rounded-md q-pa-none" style="min-height: inherit; height: calc(100vh - 44px);">
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
    <div class="tw:flex tw:items-center tw:justify-end tw:gap-3">
        <div data-test="iam-groups-search-input">
          <q-input
              v-model="filterQuery"
              borderless
              dense
              class="q-ml-auto no-border o2-search-input tw:h-[36px]"
              :placeholder="t('iam.searchGroup')"
            >
              <template #prepend>
                <OIcon class="o2-search-input-icon" name="search" size="sm" />
              </template>
            </q-input>
        </div>
        <OButton
          data-test="iam-groups-add-group-btn"
          variant="primary"
          size="sm"
          @click="addGroup"
        >
          {{ t('iam.addGroup') }}
        </OButton>
      </div>
    </div>
    </div>
    <div class="tw:w-full tw:h-full">
      <div class="card-container"  style="height: calc(100vh - var(--navbar-height) - 92px)">      
        <OTable
          data-test="iam-groups-table-section"
          :data="rows"
          :columns="columns"
          row-key="group_name"
          :selected-ids="selectedGroupNames"
          :global-filter="filterQuery"
          pagination="client"
          :page-size="20"
          sorting="client"
          selection="multiple"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:gap-2 tw:justify-center">
              <OButton
                :data-test="`iam-groups-edit-${row.group_name}-role-icon`"
                variant="ghost"
                size="icon-circle-sm"
                :title="t('common.edit')"
                @click="editGroup(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                :data-test="`iam-groups-delete-${row.group_name}-role-icon`"
                variant="ghost"
                size="icon-circle-sm"
                :title="t('common.delete')"
                @click="showConfirmDialog(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </div>
          </template>
          <template #bottom>
            <OButton
              v-if="selectedGroups.length > 0"
              data-test="iam-groups-bulk-delete-btn"
              variant="outline"
              size="sm"
              @click="openBulkDeleteDialog"
              icon-left="delete"
            >
              {{ t('common.delete') }}
            </OButton>
          </template>
        </OTable>
    </div>
    </div>
    </div>
    <AddGroup
      v-model:open="showAddGroup"
      :org_identifier="store.state.selectedOrganization.identifier"
      @added:group="setupGroups"
    />
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
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from "vue";
import AddGroup from "./AddGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups, deleteGroup, bulkDeleteGroups } from "@/services/iam";
import usePermissions from "@/composables/iam/usePermissions";
import { useQuasar } from "quasar";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
const selectedGroupNames = computed(() =>
  selectedGroups.value.map((g: any) => g.group_name),
);

const handleSelectedIdsUpdate = (ids: string[]) => {
  const groupsMap = new Map(rows.value.map((g: any) => [g.group_name, g]));
  selectedGroups.value = ids.map((id) => groupsMap.get(id)).filter(Boolean);
};

const confirmBulkDelete = ref(false);

const columns: OTableColumnDef[] = [
  {
    id: "#",
    header: "#",
    accessorFn: (row: any) => row["#"],
    size: 36,
    minSize: 32,
    maxSize: 40,
    meta: { compactPadding: true, align: "left" },
  },
  {
    id: "group_name",
    header: t("iam.groupName"),
    accessorKey: "group_name",
    sortable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "actions",
    header: t("alerts.actions"),
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    meta: { align: "left" },
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
