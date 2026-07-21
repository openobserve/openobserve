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
    <div class="flex flex-col h-full">
      <div
        data-test="iam-service-accounts-selection-filters"
       class="flex justify-start px-3 py-2 bg-card-glass-bg shrink-0"
      >
        <div data-test="iam-service-accounts-selection-show-toggle" class="mr-3">
          <div class="flex items-center">
            <span
              data-test="iam-service-accounts-selection-show-text"
              style="font-size: var(--text-sm)"
            >
              {{ t('iam.groupServiceAccounts.show') }}
            </span>
            <OToggleGroup
              class="ml-1"
              :model-value="usersDisplay"
              @update:model-value="(v) => updateUserTable(v as string)"
            >
              <OToggleGroupItem
                v-for="visual in usersDisplayOptions"
                :key="visual.value"
                :value="visual.value"
                size="sm"
                :data-test="`iam-service-accounts-selection-show-${visual.value}-btn`"
              >
                {{ visual.label }}
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
        </div>
        <div
          data-test="iam-service-accounts-selection-search-input"
          class="mr-3"
        >
          <OSearchInput
            data-test="service-accounts-list-search-input"
            v-model="userSearchKey"
            class="h-9 w-50"
            :placeholder="t('iam.groupServiceAccounts.searchServiceAccounts')"
          />
        </div>
      </div>
      <div data-test="iam-service-accounts-selection-table" class="flex-1 min-h-0 bg-card-glass-bg">
        <OTable
          :data="rows"
          :columns="columns"
          row-key="email"
          :loading="props.loading"
          :global-filter="userSearchKey"
          pagination="client"
          :page-size="100"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          :footer-title="t('serviceAccounts.header')"
          dense
        >
          <template #cell-select="{ row }">
            <OCheckbox
              :data-test="`iam-service-accounts-selection-table-body-row-${row.email}-checkbox`"
              :model-value="row.isInGroup"
              class="filter-check-box cursor-pointer"
              @update:model-value="toggleUserSelection(row)"
            />
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-service-accounts"
              :filtered="!!userSearchKey"
              :hide-action="!userSearchKey"
              @action="(id) => id === 'clear-filters' ? (userSearchKey = '') : null"
            />
          </template>
        </OTable>
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  import OTable from "@/lib/core/Table/OTable.vue";
  import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
  import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
  import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
  import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
  import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
  import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
  import usePermissions from "@/composables/iam/usePermissions";
  import { cloneDeep } from "lodash-es";
  import { watch } from "vue";
  import type { Ref } from "vue";
  import { ref, onBeforeMount } from "vue";
  import { useI18n } from "vue-i18n";
  import { useStore } from "vuex";
  import { TABLE_CHECKBOX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";
  
  // show selected users in the table
  // Add is_selected to the user object
  
  const props = defineProps({
    groupUsers: {
      type: Array,
      default: () => [],
    },
    activeTab: {
      type: String,
      default: "users",
    },
    addedUsers: {
      type: Set,
      default: () => new Set(),
    },
    removedUsers: {
      type: Set,
      default: () => new Set(),
    },
    loading: {
      type: Boolean,
      default: false,
    },
  });
  
  const users: Ref<any[]> = ref([]);
  
  const rows: Ref<any[]> = ref([]);
  
  const usersDisplay = ref("selected");
  
  const store = useStore();

  const { t } = useI18n();

  const usersDisplayOptions = [
    {
      label: t("iam.groupServiceAccounts.all"),
      value: "all",
    },
    {
      label: t("iam.groupServiceAccounts.selected"),
      value: "selected",
    },
  ];

  const userSearchKey = ref("");
  
  const hasFetchedOrgServiceAccounts = ref(false);
  
  const groupUsersMap = ref(new Set());
  
  const { serviceAccountsState } = usePermissions();
  
  const columns: OTableColumnDef[] = [
    {
      id: "select",
      header: "",
      accessorKey: "isInGroup",
    cell: (info: any) => info.getValue(),
    size: TABLE_CHECKBOX_COL_SIZE,
      minSize: 32,
      maxSize: 40,
      meta: { align: "center", compactPadding: true },
    },
    {
      id: "email",
      header: t("iam.serviceAccountsName"),
      accessorKey: "email",
      sortable: true,
      size: COL.email,
      meta: { align: "left" , autoWidth: true },
    },
  ];
  
  onBeforeMount(async () => {
    groupUsersMap.value = new Set(props.groupUsers);
    await fetchOrgServiceAccounts();
    updateUserTable(usersDisplay.value);
  });
  
  watch(
    () => props.groupUsers,
    async () => {
      hasFetchedOrgServiceAccounts.value = false;
      groupUsersMap.value = new Set(props.groupUsers);

      await fetchOrgServiceAccounts();
      updateUserTable(usersDisplay.value);
    },
    {
      deep: true,
    }
  );
  
  const updateUserTable = async (value: string) => {
    usersDisplay.value = value;
  
    if (!hasFetchedOrgServiceAccounts.value && value === "all") {
      await fetchOrgServiceAccounts();
    }
  
    if (usersDisplay.value === "all") {
      rows.value = users.value;
    } else {
      rows.value = users.value.filter((user: any) => user.isInGroup);
    }
  };
  
  const fetchOrgServiceAccounts = async () => {
    // fetch group users
    hasFetchedOrgServiceAccounts.value = true;
    return new Promise(async (resolve) => {
      const data: any = await serviceAccountsState.getServiceAccounts(
        store.state.selectedOrganization.identifier
      );
  
      serviceAccountsState.service_accounts_users = cloneDeep(
        data
          .filter((user: any) => user.is_system !== true) // Filter out system accounts
          .map((user: any) => {
            return {
              email: user.email,
              isInGroup: groupUsersMap.value.has(user.email),
            };
          })
      );
  
      users.value = cloneDeep(serviceAccountsState.service_accounts_users).map(
        (user: any) => {
          return {
            email: user.email,
            isInGroup: groupUsersMap.value.has(user.email),
          };
        }
      );
      resolve(true);
    });
  };
  
  const toggleUserSelection = (user: any) => {
    user.isInGroup = !user.isInGroup;

    if (user.isInGroup) {
      // Newly selected
      if (!groupUsersMap.value.has(user.email)) {
        // Not originally in group — stage for addition
        props.addedUsers.add(user.email);
      } else {
        // Was originally in group — undo pending removal
        props.removedUsers.delete(user.email);
      }
    } else {
      // Newly deselected
      if (groupUsersMap.value.has(user.email)) {
        // Was originally in group — stage for removal
        props.removedUsers.add(user.email);
      } else {
        // Was not originally in group — undo pending addition
        props.addedUsers.delete(user.email);
      }
    }
  };
  
  </script>
  