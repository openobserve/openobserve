<template>
  <div class="q-px-md row">
    <div class="col q-pr-xs">
      <div class="flex justify-start bordered q-mt-sm q-mb-md">
        <div class="o2-input q-mr-md" style="width: 400px">
          <q-input
            data-test="alert-list-search-input"
            v-model="userSearchKey"
            borderless
            filled
            dense
            class="q-ml-auto q-mb-xs no-border"
            placeholder="Search"
          >
            <template #prepend>
              <q-icon name="search" class="cursor-pointer" />
            </template>
          </q-input>
        </div>
        <div class="flex items-center" style="margin-bottom: 2px">
          <span style="font-size: 14px"> Show </span>
          <div
            class="q-mx-sm"
            style="
              border: 1px solid #d7d7d7;
              width: fit-content;
              border-radius: 2px;
            "
          >
            <template v-for="visual in usersDisplayOptions" :key="visual.value">
              <q-btn
                :color="visual.value === usersDisplay ? 'primary' : ''"
                :flat="visual.value === usersDisplay ? false : true"
                dense
                no-caps
                size="11px"
                class="q-px-md visual-selection-btn"
                @click="updateUserTable(visual.value)"
              >
                {{ visual.label }}</q-btn
              >
            </template>
          </div>
          <span style="font-size: 14px"> Users </span>
        </div>
      </div>
      <div class="q-ml-sm q-mb-sm text-bold">{{ rows.length }} Permissions</div>
      <template v-if="rows.length">
        <app-table
          :rows="rows"
          :columns="columns"
          :dense="true"
          style="height: fit-content"
        >
          <template v-slot:select="slotProps">
            <q-checkbox
              size="xs"
              v-model="slotProps.column.row.isInGroup"
              class="filter-check-box cursor-pointer"
              @click="toggleUserSelection(slotProps.column.row)"
            />
          </template>
        </app-table>
      </template>
      <div v-if="!rows.length" class="q-mt-md text-bold q-pl-md">
        No users added
      </div>

      <div class="flex justify-end q-mt-lg">
        <q-btn
          data-test="add-alert-cancel-btn"
          class="text-bold"
          :label="t('alerts.cancel')"
          text-color="light-text"
          padding="sm md"
          no-caps
        />
        <q-btn
          data-test="add-alert-submit-btn"
          :label="t('alerts.save')"
          class="text-bold no-border q-ml-md"
          color="secondary"
          padding="sm xl"
          no-caps
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import type { Ref } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

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
});

const users = ref([
  {
    role_name: "example@example.com",
  },
  {
    role_name: "root@example.com",
  },
]);

const rows: Ref<any[]> = ref([]);

const usersDisplay = ref("selected");

const removedUsers = ref(new Set());
const addedUsers = ref(new Set());

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

const userSearchKey = ref("");

const hasFetchedOrgUsers = ref(false);

const groupUsersMap = ref(new Set());

const columns = [
  {
    name: "select",
    field: "",
    label: "",
    align: "left",
    sortable: true,
    slot: true,
    slotName: "select",
  },
  {
    name: "role_name",
    field: "role_name",
    label: t("iam.roleName"),
    align: "left",
    sortable: true,
  },
];

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

const updateGroupUsers = () => {
  users.value = props.groupRoles.map((user: any, index: number) => {
    groupUsersMap.value.add(user.role_name);
    return {
      ...user,
      "#": index + 1,
      isInGroup: true,
    };
  });

  updateUserTable(usersDisplay.value);
};

const getchOrgUsers = async () => {
  // fetch group users
  hasFetchedOrgUsers.value = true;
  return new Promise((resolve) => {
    const _users = [
      {
        role_name: "developers1",
      },
      {
        role_name: "developers2",
      },
      {
        role_name: "developers3",
      },
      {
        role_name: "developers4",
      },
    ];
    users.value = _users.map((user: any, index: number) => {
      return {
        ...user,
        "#": index + 1,
        isInGroup: groupUsersMap.value.has(user.role_name),
      };
    });
    resolve(true);
  });
};

const toggleUserSelection = (user: any) => {
  if (user.isInGroup && !groupUsersMap.value.has(user.role_name)) {
    addedUsers.value.add(user.role_name);
  } else if (!user.isInGroup && groupUsersMap.value.has(user.role_name)) {
    removedUsers.value.add(user.role_name);
  }

  if (!user.isInGroup && addedUsers.value.has(user.role_name)) {
    addedUsers.value.delete(user.role_name);
  }
};

updateGroupUsers();
</script>

<style scoped></style>
