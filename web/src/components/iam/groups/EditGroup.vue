<template>
  <div>
    <div style="font-size: 18px" class="q-py-sm q-px-md">
      {{ editingGroup.group_name }}
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

const activeTab = ref("users");

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

const editingGroup = ref(cloneDeep(props.group));

const updateActiveTab = (tab: string) => {
  activeTab.value = tab;
};

const saveGroupChanges = () => {
  console.log("save group changes");
  const payload = {
    added_users: Array.from(addedUsers.value),
    removed_users: Array.from(removedUsers.value),
    added_roles: Array.from(addedRoles.value),
    removed_roles: Array.from(removedRoles.value),
  };
  console.log(payload);
};

const cancelEditGroup = () => {
  router.push({ name: "groups" });
};
</script>

<style scoped></style>
