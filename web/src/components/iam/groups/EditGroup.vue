<template>
  <div>
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ groupDetails.group_name }}
    </div>

    <div class="full-width bg-grey-4" style="height: 1px" />

    <AppTabs
      :tabs="tabs"
      :active-tab="activeTab"
      @update:active-tab="updateActiveTab"
    />

    <q-separator />

    <GroupUsers
      v-show="activeTab === 'users'"
      :groupUsers="groupDetails.users"
      :activeTab="activeTab"
      :added-users="addedUsers"
      :removed-users="removedUsers"
    />

    <GroupRoles
      v-show="activeTab === 'roles'"
      :groupRoles="groupDetails.roles"
      :activeTab="activeTab"
      :added-roles="addedRoles"
      :removed-roles="removedRoles"
    />

    <div class="flex justify-end q-mt-lg q-px-md">
      <q-btn
        data-test="add-alert-cancel-btn"
        class="text-bold"
        :label="t('alerts.cancel')"
        text-color="light-text"
        padding="sm md"
        no-caps
        @click="cancelEditGroup"
      />
      <q-btn
        data-test="add-alert-submit-btn"
        :label="t('alerts.save')"
        class="text-bold no-border q-ml-md"
        color="secondary"
        padding="sm xl"
        no-caps
        @click="saveGroupChanges"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import GroupRoles from "./GroupRoles.vue";
import GroupUsers from "./GroupUsers.vue";
import { cloneDeep } from "lodash-es";
import AppTabs from "@/components/common/AppTabs.vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { onBeforeMount } from "vue";
import { getGroup, updateGroup } from "@/services/iam";
import { useStore } from "vuex";

const props = defineProps({
  group: {
    type: Object,
    default: () => ({
      group_name: "dev",
      roles: [],
      users: [],
    }),
  },
});

onBeforeMount(() => {
  getGroupDetails();
});

const activeTab = ref("users");

const store = useStore();

const router = useRouter();

const { t } = useI18n();

const groupDetails = ref({
  group_name: "dev",
  roles: [],
  users: [],
});

const addedUsers = ref(new Set());
const removedUsers = ref(new Set());

const addedRoles = ref(new Set());
const removedRoles = ref(new Set());

const tabs = [
  {
    value: "users",
    label: "Users",
  },
  {
    value: "roles",
    label: "Roles",
  },
];

const getGroupDetails = () => {
  const groupName: string = router.currentRoute.value.params
    .group_name as string;

  getGroup(groupName, store.state.selectedOrganization.identifier)
    .then((res) => {
      groupDetails.value = {
        ...res.data,
        group_name: res.data.name,
      };
    })
    .catch((err) => {
      console.log(err);
    });
};

const updateActiveTab = (tab: string) => {
  if (!tab) return;
  activeTab.value = tab;
};

const saveGroupChanges = () => {
  const payload = {
    add_users: Array.from(addedUsers.value) as string[],
    remove_users: Array.from(removedUsers.value) as string[],
    add_roles: Array.from(addedRoles.value) as string[],
    remove_roles: Array.from(removedRoles.value) as string[],
  };

  updateGroup({
    group_name: groupDetails.value.group_name,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then((res) => {
      console.log(res);
      router.push({ name: "groups" });
    })
    .catch((err) => {
      console.log(err);
    });
};

const cancelEditGroup = () => {
  router.push({ name: "groups" });
};
</script>

<style scoped></style>
