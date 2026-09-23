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
        {{ t("iam.groupsPage.subtitle") }}
      </span>
    </template>
    <template #actions>
      <OButton data-test="iam-groups-add-group-btn" variant="primary" size="sm" @click="addGroup">
        {{ t("iam.addGroup") }}
      </OButton>
    </template>
    <!-- Arrived via the service account token popup's "Add to a user group"
         link (?member=<email>): that link used to just redirect here and
         leave the user with no way to actually add the account to anything.
         The Assign column below does the write directly. -->
    <OBanner
      v-if="assignTarget"
      variant="info"
      icon="group"
      inline-actions
      dense
      data-test="iam-groups-assign-banner"
      class="mb-3"
    >
      {{ t("iam.groupsPage.assignBannerText", { member: assignTarget }) }}
      <template #actions>
        <OButton
          data-test="iam-groups-assign-banner-dismiss"
          variant="ghost"
          size="sm"
          @click="clearAssignTarget"
        >
          {{ t("iam.groupsPage.assignBannerDone") }}
        </OButton>
      </template>
    </OBanner>
    <div class="min-h-0 w-full flex-1 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :frame="false"
          data-test="iam-groups-table-section"
          :data="rows"
          :columns="columns"
          row-key="group_name"
          :loading="loading"
          :forbidden="forbidden"
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
            <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('iam.searchGroup')"
                class="flex-1"
                data-test="iam-groups-search-input"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="lastUpdatedAt"
              :loading="fetching"
              shortcut-id="iamGroupsRefresh"
              data-test="iam-groups-refresh-btn"
              @click="refreshGroups"
            />
          </template>
          <template #cell-assign="{ row }">
            <div class="flex items-center justify-center">
              <OBadge v-if="isAssigned(row)" variant="success" icon="check" size="sm">
                {{ t("iam.groupsPage.assignedBadge") }}
              </OBadge>
              <OButton
                v-else
                :data-test="`iam-groups-assign-${row.group_name}-btn`"
                variant="outline"
                size="sm"
                :loading="assigningGroupName === row.group_name"
                @click="assignMemberToGroup(row)"
              >
                {{ t("iam.groupsPage.assignBtn") }}
              </OButton>
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-center">
              <OButton
                :data-test="`iam-groups-edit-${row.group_name}-role-icon`"
                data-row-action="edit"
                variant="ghost"
                size="icon-sm"
                class="max-md:hidden"
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
                class="max-md:hidden"
                :title="t('common.delete')"
                @click="showConfirmDialog(row)"
              >
                <OIcon name="delete" size="sm" />
              </OButton>
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    icon-left="more-vert"
                    variant="ghost"
                    size="icon-xs-sq"
                    class="md:hidden"
                    data-test="iam-groups-row-more-actions"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  icon-left="edit"
                  class="md:hidden"
                  :data-test="`iam-groups-edit-${row.group_name}-role-icon-menu`"
                  @select="editGroup(row)"
                >
                  <span>{{ t("common.edit") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="delete"
                  variant="destructive"
                  class="md:hidden"
                  :data-test="`iam-groups-delete-${row.group_name}-role-icon-menu`"
                  @select="showConfirmDialog(row)"
                >
                  <span>{{ t("common.delete") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-groups"
              :filtered="!!filterQuery"
              @action="(id) => (id === 'create' ? addGroup() : (filterQuery = ''))"
            />
          </template>
          <template #bottom>
            <span class="text-xs font-normal max-md:hidden"
              >{{ rows.length }} {{ t("iam.groups") }}</span
            >
            <OButton
              v-if="selectedGroups.length > 0"
              data-test="iam-groups-bulk-delete-btn"
              variant="outline-destructive"
              size="sm"
              :loading="bulkDeleteLoading"
              @click="openBulkDeleteDialog"
              icon-left="delete"
            >
              {{ t("common.delete") }}
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
      :message="
        t('iam.appGroups.deleteGroupConfirm', { name: deleteConformDialog?.data?.group_name })
      "
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
import { useQuery } from "@tanstack/vue-query";
import { useMutation } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import { deleteGroupMutation, bulkDeleteGroupsMutation } from "@/services/iam.queries";
import { groupsQuery } from "@/services/iam.queries";
import { ref, onBeforeMount, computed, watch } from "vue";
import AddGroup from "./AddGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { cloneDeep } from "lodash-es";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { getGroup, updateGroup } from "@/services/iam";
import users from "@/services/users";
import usePermissions from "@/composables/iam/usePermissions";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useReo } from "@/services/reodotdev_analytics";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";

const showAddGroup = ref(false);

const { t } = useI18nTyped();

const { track } = useReo();

const rows: any = ref([]);

const router = useRouter();
const route = useRoute();

const store = useStore();

const { groupsState } = usePermissions();

// ── Quick-assign (arrived via ?member=<email>) ────────────────────────────
// The service-account token popup's "Add to a user group" link lands here
// with the account's email in the query. Previously nothing read it — this
// now drives the Assign column below.
const assignTarget = computed(() => (route.query.member as string) || "");
const assigningGroupName = ref<string | null>(null);
const assignedGroupNames = ref<string[]>([]);

const loadAssignedGroupNames = async () => {
  if (!assignTarget.value) {
    assignedGroupNames.value = [];
    return;
  }
  try {
    const res = await users.getUserGroups(
      store.state.selectedOrganization.identifier,
      assignTarget.value,
    );
    assignedGroupNames.value = Array.isArray(res.data) ? res.data : [];
  } catch {
    // Silent: worst case a group the member already belongs to still shows an
    // actionable "Add" button — a redundant add_users is a harmless no-op.
    assignedGroupNames.value = [];
  }
};

watch(assignTarget, loadAssignedGroupNames, { immediate: true });

const isAssigned = (row: any): boolean => assignedGroupNames.value.includes(row?.group_name);

const clearAssignTarget = () => {
  const { member: _member, ...rest } = route.query;
  router.replace({ name: "groups", query: rest });
};

const assignMemberToGroup = async (group: any) => {
  if (!assignTarget.value || assigningGroupName.value) return;
  assigningGroupName.value = group.group_name;
  try {
    await updateGroup({
      group_name: group.group_name,
      org_identifier: store.state.selectedOrganization.identifier,
      payload: {
        add_roles: [],
        remove_roles: [],
        add_users: [assignTarget.value],
        remove_users: [],
      },
    });
    assignedGroupNames.value = [...assignedGroupNames.value, group.group_name];
    toast({
      message: t("iam.groupsPage.assignSuccess", {
        member: assignTarget.value,
        group: group.group_name,
      }),
      variant: "success",
    });
  } catch (err: any) {
    if (err?.response?.status != 403) {
      toast({
        message: err?.response?.data?.message || t("iam.groupsPage.assignError"),
        variant: "error",
      });
    }
  } finally {
    assigningGroupName.value = null;
  }
};

const filterQuery = ref("");

const deleteConformDialog = ref({
  show: false,
  data: null as any,
});

const selectedGroups: any = ref([]);
const selectedGroupNames = computed(() => selectedGroups.value.map((g: any) => g.group_name));

const handleSelectedIdsUpdate = (ids: string[]) => {
  const groupsMap = new Map(rows.value.map((g: any) => [g.group_name, g]));
  selectedGroups.value = ids.map((id) => groupsMap.get(id)).filter(Boolean);
};

const confirmBulkDelete = ref(false);
const bulkDeleteLoading = ref(false);

const columns = computed<OTableColumnDef[]>(() => {
  const cols: OTableColumnDef[] = [
    {
      id: "group_name",
      header: t("iam.groupName"),
      accessorKey: "group_name",
      sortable: true,
      meta: { align: "left", autoWidth: true, isName: true },
    },
  ];

  if (assignTarget.value) {
    cols.push({
      id: "assign",
      header: t("iam.groupsPage.assignColumn"),
      sortable: false,
      resizable: false,
      size: 130,
      meta: { align: "center" },
    });
  }

  cols.push({
    id: "actions",
    header: t("alerts.actions"),
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    meta: { align: "center", actionCount: 2 },
  });

  return cols;
});

onBeforeMount(() => {
  setupGroups();
});

const updateTable = () => {
  rows.value = cloneDeep(groupsState.groups);
};

const addGroup = () => {
  track("Button Click", {
    button: "Add Group",
    page: "Groups",
  });
  showAddGroup.value = true;
};

// After a group is created, route straight into EditGroup on the Roles tab so
// the user can start assigning roles instead of being dropped back on the list
// with an empty group.
const onGroupAdded = (payload: { group_name: string; data?: any }) => {
  if (!payload?.group_name) {
    setupGroups(true);
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

const orgIdForList = useOrgId();
const groupsList = useQuery(() =>
  Object.assign(groupsQuery(orgIdForList.value), { enabled: !!orgIdForList.value }),
);

// Bound to the query rather than hand-managed: `isPending` is the cold read,
// `isFetching` is any request in flight.
const loading = groupsList.isPending;
// A request in flight while rows stay on screen — the refresh button's spinner.
// `loading` is the skeleton, which only a cold read wants.
const fetching = groupsList.isFetching;
const lastUpdatedAt = groupsList.dataUpdatedAt;
// A 403 lands in the query's error rather than a loader's catch, so derive the no-access state from it.
const forbidden = computed(() => {
  const e: any = groupsList.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});
// `force` for every reload that follows a write or an explicit refresh —
// an "added" event means the server has something new to show.
// Named handler: binding setupGroups straight to @click puts the MouseEvent
// in `force`.
const refreshGroups = () => setupGroups(true);

const applyGroups = (res: any) => {
  groupsState.groups = res.map((group: string) => ({
    group_name: group,
  }));
  updateTable();
};

// The list is the query now: anything that invalidates the scope repaints these
// rows without this component asking.
watch(
  groupsList.data,
  (rows: any) => {
    if (rows) applyGroups(rows);
  },
  { immediate: true },
);
watch(groupsList.error, (err: any) => {
  if (err) console.log(err);
});

// Only an explicit call reads: refresh, post-write reload, search. Mount and
// invalidation-driven repaints come from the query itself.
const setupGroups = async (force = false) => {
  if (force) await groupsList.refetch();
};

const orgId = useOrgId();
const deleteGroupOne = useMutation(() => deleteGroupMutation(orgId.value));
const bulkDeleteGroupsAll = useMutation(() => bulkDeleteGroupsMutation(orgId.value));

const deleteUserGroup = (group: any) => {
  // Was: invalidate, then delete — the refetch raced the write. The mutation
  // invalidates on success, so the order is now correct by construction.
  deleteGroupOne
    .mutateAsync(group.group_name)
    .then(() => {
      toast({
        message: t("iam.appGroups.groupDeletedSuccess"),
        variant: "success",
      });
      setupGroups(true);
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
const deleteImpactMessage = ref(raw(""));

const fetchGroupMemberCount = async (groupName: string): Promise<number> => {
  const res = await getGroup(groupName, store.state.selectedOrganization.identifier);
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
const bulkDeleteImpactMessage = ref(raw(""));

const openBulkDeleteDialog = async () => {
  confirmBulkDelete.value = true;

  if (selectedGroups.value.length === 1) {
    bulkDeleteImpactMessage.value = t("iam.groupsPage.delete.impact", {
      count: 0,
    });
    try {
      const count = await fetchGroupMemberCount(selectedGroups.value[0].group_name);
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
    const response = await bulkDeleteGroupsAll.mutateAsync(groupNames);

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
          count: successful.length,
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

    await setupGroups(true);
    selectedGroups.value = [];
    confirmBulkDelete.value = false;
  } catch (error: any) {
    if (error.response?.status != 403 || error?.status != 403) {
      toast({
        message:
          error.response?.data?.message || error?.message || t("iam.appGroups.errorDeletingGroups"),
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
    handler: () => {
      if (!isInputFocused()) addGroup();
    },
  },
  {
    id: "iamGroupsRefresh",
    handler: () => {
      if (!isInputFocused()) setupGroups(true);
    },
  },
  {
    id: "iamGroupsFocusSearch",
    handler: () => {
      focusSearchInput("iam-groups-search-input");
    },
  },
]);
</script>
