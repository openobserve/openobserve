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
  <div data-test="iam-roles-selection-section" class="tw:flex tw:flex-col tw:h-full tw:p-0" >
    <div
      class="tw:flex tw:justify-start tw:px-3 tw:py-2 card-container tw:flex-shrink-0"
      :class="store.state.theme === 'dark' ? 'tw:bg-[var(--o2-bg-card-dark,#1a1a1a)]' : 'tw:bg-white'"
    >
      <div class="tw:mr-3">
        <div
          data-test="iam-roles-selection-show-toggle"
          class="tw:flex tw:items-center"
        >
          <span
            data-test="iam-roles-selection-show-text"
            style="font-size: 14px"
          >
            Show
          </span>
          <OToggleGroup
            class="tw:ml-1"
            :model-value="usersDisplay"
            @update:model-value="(v) => updateUserTable(v as string)"
          >
            <OToggleGroupItem
              v-for="visual in usersDisplayOptions"
              :key="visual.value"
              :value="visual.value"
              size="sm"
              :data-test="`iam-roles-selection-show-${visual.value}-btn`"
            >
              {{ visual.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </div>
      <div
        data-test="iam-roles-selection-search-input"
        class="tw:mr-3"
      >
        <OSearchInput
          data-test="alert-list-search-input"
          v-model="userSearchKey"
          class="tw:h-[36px] tw:w-[200px]"
          placeholder="Search Roles"
        />
      </div>
    </div>
    <div data-test="iam-roles-selection-table" class="tw:flex-1 tw:min-h-0 card-container">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="role_name"
        :loading="props.loading"
        :global-filter="userSearchKey"
        pagination="client"
        :page-size="100"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        :show-global-filter="false"
        :footer-title="t('iam.roles')"
        dense
      >
        <template #cell-select="{ row }">
          <OCheckbox
            :data-test="`iam-roles-selection-table-body-row-${row.role_name}-checkbox`"
            :model-value="row.isInGroup"
            class="filter-check-box tw:cursor-pointer"
            @update:model-value="toggleUserSelection(row)"
          />
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-roles"
            :filtered="!!userSearchKey"
            :hide-action="!userSearchKey"
            @action="(id) => id === 'clear-filters' && (userSearchKey = '')"
          />
        </template>
      </OTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onBeforeMount, computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { cloneDeep } from "lodash-es";
import type { Ref } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { getRoles } from "@/services/iam";
import { useStore } from "vuex";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

// show selected users in the table
// Add is_selected to the user object

const props = defineProps({
  groupRoles: {
    type: Array,
    default: () => [],
  },
  activeTab: {
    type: String,
    default: "users",
  },
  addedRoles: {
    type: Set,
    default: () => new Set(),
  },
  removedRoles: {
    type: Set,
    default: () => new Set(),
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emits = defineEmits(["add", "remove"]);

const users = ref([]);

const { rolesState, groupsState } = usePermissions();

const rows: Ref<any[]> = ref([]);

const userSearchKey = ref("");

const usersDisplay = ref("selected");

const usersDisplayOptions = [
  {
    label: "All",
    value: "all",
  },
  {
    label: "Selected",
    value: "selected",
  },
];

const { t } = useI18n();

const hasFetchedOrgUsers = ref(false);

const store = useStore();

const groupUsersMap = ref(new Set());

const columns: OTableColumnDef[] = [
  {
    id: "select",
    header: "",
    accessorKey: "isInGroup",
    cell: (info: any) => info.getValue(),
    size: TABLE_INDEX_COL_SIZE,
    minSize: 32,
    maxSize: 40,
    meta: { align: "center", compactPadding: true },
  },
  {
    id: "role_name",
    header: t("iam.roleName"),
    accessorKey: "role_name",
    sortable: true,
    size: COL.role,
    meta: { align: "left", autoWidth: true },
  },
];

onBeforeMount(async () => {
  groupUsersMap.value = new Set(props.groupRoles);
  await getchOrgUsers();
  updateUserTable(usersDisplay.value);
});

watch(
  () => props.groupRoles,
  async () => {
    hasFetchedOrgUsers.value = false;
    groupUsersMap.value = new Set(props.groupRoles);
    await getchOrgUsers();
    updateUserTable(usersDisplay.value);
  },
  {
    deep: true,
  }
);

const updateUserTable = async (value: string) => {
  usersDisplay.value = value;

  if (!hasFetchedOrgUsers.value && value === "all") {
    await getchOrgUsers();
  }

  if (usersDisplay.value === "all") {
    rows.value = users.value;
  } else {
    rows.value = users.value.filter((user: any) => user.isInGroup);
  }
};

const getchOrgUsers = async () => {
  // fetch group users
  hasFetchedOrgUsers.value = true;
  return new Promise(async (resolve) => {
    const data: any = await getRoles(
      store.state.selectedOrganization.identifier
    );

    users.value = cloneDeep(data.data).map((role: any, index: number) => {
      return {
        role_name: role,
        "#": index + 1,
        isInGroup: groupUsersMap.value.has(role),
      };
    });
    resolve(true);
  });
};

const toggleUserSelection = (user: any) => {
  user.isInGroup = !user.isInGroup;

  if (user.isInGroup) {
    // Newly selected
    if (!groupUsersMap.value.has(user.role_name)) {
      // Not originally in group — stage for addition
      props.addedRoles.add(user.role_name);
    } else {
      // Was originally in group — undo pending removal
      props.removedRoles.delete(user.role_name);
    }
  } else {
    // Newly deselected
    if (groupUsersMap.value.has(user.role_name)) {
      // Was originally in group — stage for removal
      props.removedRoles.add(user.role_name);
    } else {
      // Was not originally in group — undo pending addition
      props.addedRoles.delete(user.role_name);
    }
  }
};

</script>

<style scoped></style>
