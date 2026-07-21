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
      data-test="iam-users-selection-filters"
      class="flex justify-start px-3 py-2 bg-card-glass-bg flex-shrink-0"
    >
      <div data-test="iam-users-selection-show-toggle" class="mr-3">
        <div class="flex items-center">
          <span
            data-test="iam-users-selection-show-text"
            style="font-size: var(--text-sm)"
          >
            {{ t("iam.groupUsers.show") }}
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
              :data-test="`iam-users-selection-show-${visual.value}-btn`"
            >
              {{ visual.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </div>
      <div
        data-test="iam-users-selection-search-input"
        class="mr-3"
      >
        <OSearchInput
          data-test="alert-list-search-input"
          v-model="userSearchKey"
          class="h-9 w-50"
          :placeholder="t('iam.groupUsers.searchUser')"
        />
      </div>

      <div
          class="mx-2 current-organization"
        >
        <OSelect
          v-if="
            store.state.selectedOrganization.identifier ===
              store.state.zoConfig.meta_org &&
            usersDisplay == 'all'
          "
          v-model="selectedOrgValue"
          :options="orgOptions"
          labelKey="label"
          valueKey="value"
          searchable
          class="organizationlist"
          @update:model-value="updateOrganization"
          :placeholder="t('iam.groupUsers.selectOrganization')"
        />

        </div>
    </div>
    <div data-test="iam-users-selection-table" class="flex-1 min-h-0 bg-card-glass-bg">
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
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="iam-group-users"
        :show-global-filter="false"
        :footer-title="t('iam.basicUsers')"
        dense
      >
        <template #cell-select="{ row }">
          <OCheckbox
            :data-test="`iam-users-selection-table-body-row-${row.email}-checkbox`"
            :model-value="row.isInGroup"
            class="filter-check-box cursor-pointer"
            @update:model-value="toggleUserSelection(row)"
          />
        </template>
        <template #cell-email="{ row }">
          <div class="flex items-center">
            <OUserCell :value="row.email" />
            <OTooltip v-if="shouldShowWarning(row)" side="right">
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer"
                :data-test="`iam-external-user-warning-icon-${row.email}`"
              />
              <template #content>
                <div style="font-size: var(--text-xs); line-height: 1.5;">
                  <strong>{{ t("iam.externalUserWarningTitle") }}</strong>
                  <div class="mt-1">{{ t("iam.externalUserWarningMessage") }}</div>
                </div>
              </template>
            </OTooltip>
          </div>
        </template>
        <template #empty>
          <OEmptyState
            size="hero"
            preset="no-users"
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
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { cloneDeep } from "lodash-es";
import { computed, watch } from "vue";
import type { Ref } from "vue";
import { ref, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  context: {
    type: String,
    default: "group", // "group" or "role"
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
// Org option rows: the "All" entry carries a `value`; real-org entries carry
// identifier/id and other metadata, so every non-label field is optional.
interface OrgOption {
  label: string;
  value?: string;
  id?: string;
  identifier?: string;
  user_email?: string;
  ingest_threshold?: number;
  search_threshold?: number;
  subscription_type?: string;
  status?: string;
  note?: string;
}
const orgOptions = ref<OrgOption[]>([
  { label: t("iam.groupUsers.all"), value: "all" },
]);
const selectedOrg = ref<OrgOption>(orgOptions.value[0]);
// OSelect's v-model is the primitive option value; keep `selectedOrg` (the full
// option object) as the source of truth and bridge the two here.
const selectedOrgValue = computed<SelectModelValue>({
  get: () => selectedOrg.value?.value,
  set: (val) => {
    const match = orgOptions.value.find((org) => org.value === val);
    if (match) selectedOrg.value = match;
  },
});
const orgList = ref<OrgOption[]>([...orgOptions.value]);
const usersDisplayOptions = [
  {
    label: t("iam.groupUsers.all"),
    value: "all",
  },
  {
    label: t("iam.groupUsers.selected"),
    value: "selected",
  },
];
const filterOrganizations = (val: string, update: (fn: () => void) => void) => {
  // Filter logic
  update(() => {
    const needle = val.toLowerCase();
    orgList.value = orgOptions.value.filter((org) =>
      org.label.toLowerCase().includes(needle)
    );
  });
};

const userSearchKey = ref("");

const hasFetchedOrgUsers = ref(false);

const groupUsersMap = ref(new Set());

const { usersState } = usePermissions();



const columns = computed<OTableColumnDef[]>(() => {
  const baseColumns: OTableColumnDef[] = [
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
      header: t("iam.userName"),
      accessorKey: "email",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.email,
      minSize: 160,
      meta: { align: "left" , flex: true},
    },
  ];

  // Add "Organizations" column only if the selected organization is "meta"
  if (store.state.selectedOrganization.identifier === store.state.zoConfig.meta_org) {
    baseColumns.push({
      id: "organization",
      header: t("iam.groupUsers.organizations"),
      accessorKey: "org",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.owner,
      meta: { align: "left" },
    });
  }

  return baseColumns;
});


onBeforeMount(async () => {  
  groupUsersMap.value = new Set(props.groupUsers);
  await getchOrgUsers();
  updateUserTable(usersDisplay.value);

  if (store.state.organizations.length > 0) {
    const otherOrgOptions = store.state.organizations.map((data: any) => ({
      label: data.name,
      id: data.id,
      identifier: data.identifier,
      user_email: store.state.userInfo.email,
      ingest_threshold: data.ingest_threshold,
      search_threshold: data.search_threshold,
      subscription_type: data.CustomerBillingObj?.subscription_type || "",
      status: data.status,
      note: data.CustomerBillingObj?.note || "",
    }));

    // Sort the organization options alphabetically by label
    otherOrgOptions.sort((a:any, b:any) => a.label.localeCompare(b.label));

    // Prepend "All" option to the sorted list
    orgOptions.value = [{ label: t("iam.groupUsers.all"), value: "all" }, ...otherOrgOptions];
  }
  selectedOrg.value = orgOptions.value[0]; // Default to "All"
});


watch(
  () => props.groupUsers,
  async () => {
    hasFetchedOrgUsers.value = false;
    groupUsersMap.value = new Set(props.groupUsers);
    await getchOrgUsers();
    updateUserTable(usersDisplay.value);
    selectedOrg.value = orgOptions.value[0];
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

const updateOrganization = () => {
  if (selectedOrg.value.value === "all") {
    // Show all users when "All" is selected
    rows.value =
      usersDisplay.value === "all"
        ? users.value
        : users.value.filter((user) => user.isInGroup);
  } else {
    // Filter users based on selected organization or root role
    rows.value = users.value.filter((user) => {
      const isRootRole = user.role === "root"; // Check if user has "root" role
      const matchesOrg = user.org.includes(selectedOrg.value.label); // Match organization name
      return isRootRole || matchesOrg; // Include if "root" or matches org
    });
  }
};

const getchOrgUsers = async () => {
  // fetch group users
  hasFetchedOrgUsers.value = true;
  return new Promise((resolve, reject) => {
    (async () => {
    const data: any = await usersState.getOrgUsers(
      store.state.selectedOrganization.identifier , { list_all: true }
    );

    usersState.users = cloneDeep(
      data.map((user: any) => {
        return {
          email: user.email,
          isInGroup: groupUsersMap.value.has(user.email),
          org: user.orgs?.length > 0 ? user.orgs.map((org:{ org_name: string }) => org.org_name).join(", ") : "", // Set default "N/A" for users with no orgs
          role: user.role,
          is_external: user.is_external || false
        };
      })
    );

    users.value = cloneDeep(usersState.users).map(
      (user: any) => {
        return {
          email: user.email,
          isInGroup: groupUsersMap.value.has(user.email),
          org: user.org,
          role: user.role,
          is_external: user.is_external || false
        };
      }
    );
    resolve(true);
    })().catch(reject);
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

const shouldShowWarning = (user: any) => {
  // Show warning icon for external users being newly added to roles
  // Warning conditions:
  // 1. context === "role" - Only show for roles, not for groups
  // 2. user.is_external - User is marked as external (e.g., from AD/LDAP)
  // 3. user.isInGroup - User is currently selected/checked in the UI
  // 4. !groupUsersMap.has(email) - User was NOT already in the role (newly added)
  //
  // Note: We don't warn for users already in the role as they might have
  // been added through AD groups and we don't want to show false warnings
  return (
    props.context === "role" &&
    user.is_external &&
    user.isInGroup &&
    !groupUsersMap.value.has(user.email)
  );
};

</script>

