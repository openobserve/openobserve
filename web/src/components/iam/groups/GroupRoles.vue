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
  <div data-test="iam-roles-selection-section" class="tw:flex tw:flex-col tw:h-full q-pa-none" >
    <div
      class="flex justify-start q-px-md q-py-sm card-container tw:flex-shrink-0"
      :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
    >
      <div class="q-mr-md">
        <div
          data-test="iam-roles-selection-show-toggle"
          class="flex items-center"
        >
          <span
            data-test="iam-roles-selection-show-text"
            style="font-size: 14px"
          >
            Show
          </span>
          <div
            class="q-ml-xs"
            style="
              border: 1px solid #d7d7d7;
              width: fit-content;
              border-radius: 0.3rem;
              padding: 2px;
            "
          >
            <template v-for="visual in usersDisplayOptions" :key="visual.value">
              <OButton
                :data-test="`iam-roles-selection-show-${visual.value}-btn`"
                variant="ghost"
                :active="visual.value === usersDisplay"
                size="xs"
                @click="updateUserTable(visual.value)"
              >
                {{ visual.label }}
              </OButton>
            </template>
          </div>
        </div>
      </div>
      <div
        data-test="iam-roles-selection-search-input"
        class="q-mr-md"
        style="width: 400px"
      >
        <OInput
          data-test="alert-list-search-input"
          v-model="userSearchKey"
          class="no-border o2-search-input tw:h-[36px] tw:w-[200px]"
          placeholder="Search Roles"
        >
          <template #prepend>
            <OIcon name="search" size="sm" class="cursor-pointer o2-search-input-icon" />
          </template>
        </OInput>
      </div>
    </div>
    <div data-test="iam-roles-selection-table" class="tw:flex-1 tw:min-h-0 card-container">
      <template v-if="rows.length">
        <OTable
          :data="rows"
          :columns="columns"
          row-key="role_name"
          :global-filter="userSearchKey"
          pagination="client"
          :page-size="100"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          dense
        >
          <template #cell-select="{ row }">
            <OCheckbox
              :data-test="`iam-roles-selection-table-body-row-${row.role_name}-checkbox`"
              :model-value="row.isInGroup"
              class="filter-check-box cursor-pointer"
              @update:model-value="toggleUserSelection(row)"
            />
          </template>
        </OTable>
      </template>
      <div
        data-test="iam-roles-selection-table-no-users-text"
        v-if="!rows.length"
        class="text-bold q-pl-md q-py-md"
      >
        No users added
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onBeforeMount, computed } from "vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { cloneDeep } from "lodash-es";
import type { Ref } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { getRoles } from "@/services/iam";
import { useStore } from "vuex";

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
    size: 36,
    minSize: 32,
    maxSize: 40,
    meta: { align: "center", compactPadding: true },
  },
  {
    id: "role_name",
    header: t("iam.roleName"),
    accessorKey: "role_name",
    sortable: true,
    meta: { align: "left" },
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
  if (user.isInGroup && !groupUsersMap.value.has(user.role_name)) {
    props.addedRoles.add(user.role_name);
  } else if (!user.isInGroup && groupUsersMap.value.has(user.role_name)) {
    props.removedRoles.add(user.role_name);
  }

  if (!user.isInGroup && props.addedRoles.has(user.role_name)) {
    props.addedRoles.delete(user.role_name);
  }

  if (user.isInGroup && props.removedRoles.has(user.role_name)) {
    props.removedRoles.delete(user.role_name);
  }
};

</script>

<style scoped></style>
