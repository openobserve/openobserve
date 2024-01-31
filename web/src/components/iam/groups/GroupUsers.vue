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
    </div>
  </div>
</template>

<script setup lang="ts">
import AppTable from "@/components/AppTable.vue";
import usePermissions from "@/composables/iam/usePermissions";
import { cloneDeep } from "lodash-es";
import { watch } from "vue";
import type { Ref } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

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
});

const users = ref([
  {
    email: "example@example.com",
  },
  {
    email: "root@example.com",
  },
]);

const rows: Ref<any[]> = ref([]);

const usersDisplay = ref("selected");

const store = useStore();

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

const { usersState } = usePermissions();

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
    name: "email",
    field: "email",
    label: t("iam.userName"),
    align: "left",
    sortable: true,
  },
];

watch(
  () => props.groupUsers,
  () => {
    updateGroupUsers();
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

const updateGroupUsers = () => {
  users.value = cloneDeep(props.groupUsers as string[]).map(
    (userEmail: string, index: number) => {
      groupUsersMap.value.add(userEmail);
      return {
        email: userEmail,
        "#": index + 1,
        isInGroup: true,
      };
    }
  );

  updateUserTable(usersDisplay.value);
};

const getchOrgUsers = async () => {
  // fetch group users
  hasFetchedOrgUsers.value = true;
  return new Promise(async (resolve) => {
    // TODO OK : Add code to fetch org users if not fetched
    const data: any = await usersState.getOrgUsers(
      store.state.selectedOrganization.identifier
    );

    usersState.users = cloneDeep(
      data.map((user: any, index: number) => {
        return {
          email: user.email,
          "#": index + 1,
          isInGroup: groupUsersMap.value.has(user.email),
        };
      })
    );

    users.value = cloneDeep(usersState.users).map(
      (user: any, index: number) => {
        return {
          "#": index + 1,
          email: user.email,
          isInGroup: groupUsersMap.value.has(user.email),
        };
      }
    );
    resolve(true);
  });
};

const toggleUserSelection = (user: any) => {
  if (user.isInGroup && !groupUsersMap.value.has(user.email)) {
    props.addedUsers.add(user.email);
  } else if (!user.isInGroup && groupUsersMap.value.has(user.email)) {
    props.removedUsers.add(user.email);
  }

  if (!user.isInGroup && props.addedUsers.has(user.email)) {
    props.addedUsers.delete(user.email);
  }

  if (!user.isInGroup && props.addedUsers.has(user.email)) {
    props.removedUsers.delete(user.email);
  }
};

updateGroupUsers();
</script>

<style scoped></style>
