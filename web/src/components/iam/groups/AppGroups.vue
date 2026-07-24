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
  <OPageLayout :title="t('iam.groups')" icon="group" bleed>
      <template #subtitle>
        <span data-test="iam-groups-subtitle">
          {{ t('iam.groupsPage.subtitle') }}
        </span>
      </template>
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
    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
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
          show-index
          @update:selected-ids="handleSelectedIdsUpdate"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('iam.searchGroup')"
                class="flex-1"
                data-test="iam-groups-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="iam-groups-refresh-btn"
              @click="setupGroups"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="iamGroupsRefresh" />
            </OButton>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-center">
              <OButton
                :data-test="`iam-groups-edit-${row.group_name}-role-icon`"
                data-row-action="edit"
                variant="ghost"
                size="icon-sm"
                :title="t('common.edit')"
                @click="editGroup(row)"
              >
                <OIcon name="edit" size="sm" />
              </OButton>
              <OButton
                :data-test="`iam-groups-delete-${row.group_name}-role-icon`"
                data-row-action="delete"
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
            <span class="text-xs font-normal">{{ rows.length }} {{ t('iam.groups') }}</span>
            <OButton
              v-if="selectedGroups.length > 0"
              data-test="iam-groups-bulk-delete-btn"
              variant="outline-destructive"
              size="sm"
              :loading="bulkDeleteLoading"
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
      @added:group="onGroupAdded"
    />
    <ConfirmDialog
      :title="t('iam.appGroups.deleteGroupTitle')"
      :message="t('iam.appGroups.deleteGroupConfirm', { name: deleteConformDialog?.data?.group_name })"
      :warning-message="deleteImpactMessage"
      @update:ok="_deleteGroup"
      @update:cancel="deleteConformDialog.show = false"
      v-model="deleteConformDialog.show"
    />
    <ConfirmDialog
      :title="t('iam.appGroups.bulkDeleteGroupsTitle')"
      :message="t('iam.appGroups.bulkDeleteGroupsConfirm', { count: selectedGroups.length })"
      :warning-message="bulkDeleteImpactMessage"
      @update:ok="bulkDeleteUserGroups"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from "vue";
import AddGroup from "./AddGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useI18n } from "vue-i18n";
import { cloneDeep } from "lodash-es";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroups, deleteGroup, bulkDeleteGroups, getGroup } from "@/services/iam";
import usePermissions from "@/composables/iam/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";

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
const bulkDeleteLoading = ref(false);

const columns: OTableColumnDef[] = [
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
    meta: { align: "center", actionCount: 2 },
  },
];

onBeforeMount(() => {
  setupGroups();
});

const updateTable = () => {
  rows.value = cloneDeep(groupsState.groups);
};

const addGroup = () => {
  track("Button Click", {
    button: "Add Group",
    page: "Groups"
  });
  showAddGroup.value = true;
};

// After a group is created, route straight into EditGroup on the Roles tab so
// the user can start assigning roles instead of being dropped back on the list
// with an empty group.
const onGroupAdded = (payload: { group_name: string; data?: any }) => {
  if (!payload?.group_name) {
    setupGroups();
    return;
  }

  router.push({
    name: "editGroup",
    params: {
      group_name: payload.group_name,
    },
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
      tab: "roles",
    },
  });
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

const deleteUserGroup = (group: any) => {
  deleteGroup(group.group_name, store.state.selectedOrganization.identifier)
    .then(() => {
      toast({
        message: t("iam.appGroups.groupDeletedSuccess"),
        variant: "success",
      });
      setupGroups();
    })
    .catch((error: any) => {
      if (error.response.status != 403) {
        toast({
          message: t("iam.appGroups.errorDeletingGroup"),
          variant: "error",
        });
      }
    });
};

// Blast-radius warning for the single-group delete dialog. We resolve the live
// member count with one getGroup call on delete-click (the group detail payload
// carries the users array; the list payload does not).
const deleteImpactMessage = ref("");

const fetchGroupMemberCount = async (groupName: string): Promise<number> => {
  const res = await getGroup(
    groupName,
    store.state.selectedOrganization.identifier,
  );
  return Array.isArray(res.data?.users) ? res.data.users.length : 0;
};

const showConfirmDialog = async (row: any) => {
  deleteConformDialog.value.show = true;
  deleteConformDialog.value.data = row;
  deleteImpactMessage.value = t("iam.groupsPage.delete.impact", { count: 0 });

  try {
    const count = await fetchGroupMemberCount(row.group_name);
    deleteImpactMessage.value = t("iam.groupsPage.delete.impact", { count });
  } catch (err) {
    // If the count lookup fails, keep the generic warning rather than blocking.
    console.log(err);
  }
};

const _deleteGroup = () => {
  deleteUserGroup(deleteConformDialog.value.data);
  deleteConformDialog.value.data = null;
};

// Blast-radius warning for the bulk-delete dialog. With exactly one group
// selected we resolve its live member count, matching the per-row delete. For
// 2+ groups we keep static copy to avoid N requests.
const bulkDeleteImpactMessage = ref("");

const openBulkDeleteDialog = async () => {
  confirmBulkDelete.value = true;

  if (selectedGroups.value.length === 1) {
    bulkDeleteImpactMessage.value = t("iam.groupsPage.delete.impact", {
      count: 0,
    });
    try {
      const count = await fetchGroupMemberCount(
        selectedGroups.value[0].group_name,
      );
      bulkDeleteImpactMessage.value = t("iam.groupsPage.delete.impact", {
        count,
      });
    } catch (err) {
      console.log(err);
    }
  } else {
    bulkDeleteImpactMessage.value = t("iam.groupsPage.bulkDelete.impact");
  }
};

const bulkDeleteUserGroups = async () => {
  bulkDeleteLoading.value = true;
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
        message: t("iam.appGroups.bulkDeleteSuccess", { count: successful.length }),
        variant: "success",
      });
    } else if (successful.length > 0 && unsuccessful.length > 0) {
      toast({
        message: t("iam.appGroups.bulkDeletePartial", {
          successCount: successful.length,
          failCount: unsuccessful.length,
        }),
        variant: "warning",
      });
    } else if (unsuccessful.length > 0) {
      toast({
        message: t("iam.appGroups.bulkDeleteFailed", { count: unsuccessful.length }),
        variant: "error",
      });
    }

    await setupGroups();
    selectedGroups.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        message: error.response?.data?.message || error?.message || t("iam.appGroups.errorDeletingGroups"),
        variant: "error",
      });
    }
    confirmBulkDelete.value = false;
  } finally {
    bulkDeleteLoading.value = false;
  }
};

// ── Keyboard shortcuts ────────────────────────────────────────────────────
useShortcuts([
  {
    id: "iamGroupsAdd",
    handler: () => { if (!isInputFocused()) addGroup(); },
  },
  {
    id: "iamGroupsRefresh",
    handler: () => { if (!isInputFocused()) setupGroups(); },
  },
  {
    id: "iamGroupsFocusSearch",
    handler: () => {
      focusSearchInput("iam-groups-search-input");
    },
  },
]);

</script>

