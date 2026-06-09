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
      :title="t('iam.groups')"
      :subtitle="'Group users together to assign roles'"
      icon="group"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    >
      <template #actions>
        <OButton
          data-test="iam-groups-add-group-btn"
          variant="primary"
          size="sm"
          @click="addGroup"
        >
          {{ t('iam.addGroup') }}
        </OButton>
      </template>
    </AppPageHeader>
    <div class="tw:w-full tw:flex-1 tw:min-h-0 tw:overflow-hidden">
      <div class="card-container tw:h-full">
        <OTable
          :frame="false"
          data-test="iam-groups-table-section"
          :data="rows"
          :columns="columns"
          row-key="group_name"
          :loading="loading"
          :selected-ids="selectedGroupNames"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          pagination="client"
          :page-size="20"
          :page-size-options="[20, 50, 100, 250, 500]"
          :footer-title="t('iam.groups')"
          sorting="client"
          selection="multiple"
          filter-mode="client"
          :default-columns="false"
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('iam.searchGroup')"
                class="tw:flex-1"
                data-test="iam-groups-search-input"
              />
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:justify-center">
              <OButton
                :data-test="`iam-groups-edit-${row.group_name}-role-icon`"
                variant="ghost"
                size="icon-sm"
                :title="t('common.edit')"
                @click="editGroup(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                :data-test="`iam-groups-delete-${row.group_name}-role-icon`"
                variant="ghost"
                size="icon-sm"
                :title="t('common.delete')"
                @click="showConfirmDialog(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
            </div>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-groups"
              :filtered="!!filterQuery"
              @action="(id) => id === 'create' ? addGroup() : (filterQuery = '')"
            />
          </template>
          <template #bottom>
            <span class="o2-table-footer-title tw:text-text-primary">{{ rows.length }} {{ t('iam.groups') }}</span>
            <OButton
              v-if="selectedGroups.length > 0"
              data-test="iam-groups-bulk-delete-btn"
              variant="outline-destructive"
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
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups, deleteGroup, bulkDeleteGroups } from "@/services/iam";
import usePermissions from "@/composables/iam/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { TABLE_INDEX_COL_SIZE } from "@/lib/core/Table/OTable.types";

const showAddGroup = ref(false);

const { t } = useI18n();

const { track } = useReo();

const rows: any = ref([]);

const router = useRouter();

const store = useStore();

const { groupsState } = usePermissions();

const filterQuery = ref("");


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
    size: TABLE_INDEX_COL_SIZE,
    minSize: 32,
    maxSize: 40,
    meta: { compactPadding: true, align: "left" },
  },
  {
    id: "group_name",
    header: t("iam.groupName"),
    accessorKey: "group_name",
    sortable: true,
    meta: { align: "left", autoWidth: true, isName: true },
  },
  {
    id: "actions",
    header: t("alerts.actions"),
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    meta: { align: "left", actionCount: 2 },
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

const loading = ref(false);
const setupGroups = async () => {
  loading.value = true;
  await getGroups(store.state.selectedOrganization.identifier)
    .then((res) => {
      groupsState.groups = res.data.map((group: string) => ({
        group_name: group,
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

const hideAddGroup = () => {
  showAddGroup.value = false;
};


const deleteUserGroup = (group: any) => {
  deleteGroup(group.group_name, store.state.selectedOrganization.identifier)
    .then(() => {
      toast({
        message: "Group deleted successfully!",
        variant: "success",
      });
      setupGroups();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        toast({
          message: "Error while deleting group!",
          variant: "error",
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
      toast({
        message: `Successfully deleted ${successful.length} group(s)`,
        variant: "success",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      toast({
        message: `Deleted ${successful.length} group(s). Failed to delete ${unsuccessful.length} group(s)`,
        variant: "warning",
      });
    } else if (unsuccessful.length > 0) {
      toast({
        message: `Failed to delete ${unsuccessful.length} group(s)`,
        variant: "error",
      });
    }

    await setupGroups();
    selectedGroups.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        message: error.response?.data?.message || error?.message || "Error while deleting groups",
        variant: "error",
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

}

</style>
