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

    <template v-if="activeTab === 'users'">
      <GroupUsers :groupUsers="groupDetails.users" :activeTab="activeTab" />
    </template>
    <template v-if="activeTab === 'roles'">
      <GroupRoles :roles="groupDetails.roles" :activeTab="activeTab" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import GroupRoles from "./GroupRoles.vue";
import GroupUsers from "./GroupUsers.vue";
import { cloneDeep } from "lodash-es";
import AppTabs from "@/components/common/AppTabs.vue";

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

const groupDetails = ref({
  group_name: "dev",
  roles: [],
  users: [],
});

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
</script>

<style scoped></style>
