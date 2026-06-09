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
  <div data-test="edit-group-section" class="tw:flex tw:flex-col tw:h-full">
    <!-- Sub-page header: the listing's icon becomes a Back button (→ Groups). -->
    <AppPageHeader
      :title="groupDetails.group_name"
      :back="{ label: t('iam.groups'), onClick: cancelEditGroup }"
      class="tw:shrink-0 tw:px-4 tw:border-b tw:border-border-default"
    />
    <div
      data-test="edit-group-section-title"
      class="tw:px-2.5 tw:pt-2.5 tw:pb-[0.625rem] tw:flex-shrink-0"
    >
    <div class="card-container tw:py-3">
    <AppTabs
      data-test="edit-group-tabs"
      :tabs="tabs"
      :active-tab="activeTab"
      @update:active-tab="updateActiveTab"
    />
    </div>
    </div>
    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden">
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
      <GroupServiceAccounts
        v-if="store.state.zoConfig.service_account_enabled"
        v-show="activeTab === 'serviceAccounts'"
        :groupUsers="groupDetails.users"
        :activeTab="activeTab"
        :added-users="addedUsers"
        :removed-users="removedUsers"
      />
    </div>
    <div
      data-test="edit-group-footer"
    class="tw:flex tw:justify-end tw:w-full tw:flex-shrink-0"
      style="z-index: 2"
    >
      <div class="card-container tw:w-full tw:py-2 tw:px-3 tw:justify-end tw:flex tw:gap-2 tw:border-t tw:border-border-default">
      <OButton
        data-test="edit-group-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="cancelEditGroup"
      >
        {{ t('alerts.cancel') }}
      </OButton>
      <OButton
        data-test="edit-group-submit-btn"
        variant="primary"
        size="sm-action"
        @click="saveGroupChanges"
      >
        {{ t('alerts.save') }}
      </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import GroupRoles from "./GroupRoles.vue";
import GroupUsers from "./GroupUsers.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { onBeforeMount } from "vue";
import { getGroup, updateGroup } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import GroupServiceAccounts from "./GroupServiceAccounts.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

onBeforeMount(() => {
  getGroupDetails();
});

const { groupsState } = usePermissions();

const activeTab = ref("roles");

const store = useStore();

const router = useRouter();

const { t } = useI18n();


const groupDetails = ref({
  group_name: "dev",
  roles: [] as string[],
  users: [] as string[],
});

const addedUsers = ref(new Set());
const removedUsers = ref(new Set());

const addedRoles = ref(new Set());
const removedRoles = ref(new Set());

const tabs = computed(() => {
  const baseTabs = [
    {
      value: "roles",
      label: "Roles",
      icon: "shield",
    },
    {
      value: "users",
      label: "Users",
      icon: "group",
    },
  ];

  if (store.state.zoConfig.service_account_enabled) {
    baseTabs.push({
      value: "serviceAccounts",
      label: "Service Accounts",
      icon: "smart-toy",
    });
  }

  return baseTabs;
});

const getGroupDetails = () => {
  const groupName: string = router.currentRoute.value.params
    .group_name as string;

  getGroup(groupName, store.state.selectedOrganization.identifier)
    .then((res) => {
      console.log(res,'res in get group')
      groupDetails.value = {
        ...res.data,
        group_name: res.data.name,
      };
      groupsState.groups[groupName] = groupDetails.value;
    })
    .catch((err) => {
      console.log(err);
      toast({
        message: err?.message || "Group not found or has been deleted. Redirecting to groups list.",
        variant: "error",
      });
      router.push({
        name: "groups",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
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

  if (
    !(
      payload.add_users.length ||
      payload.remove_users.length ||
      payload.add_roles.length ||
      payload.remove_roles.length
    )
  ) {
    toast({
      variant: "info",
      message: `No updates detected.`,
    });

    return;
  }

  updateGroup({
    group_name: groupDetails.value.group_name,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then((res) => {
      toast({
        variant: "success",
        message: `Updated group successfully!`,
      });

      // Reset Roles
      groupDetails.value.roles = groupDetails.value.roles.filter(
        (user) => !removedRoles.value.has(user)
      );

      addedRoles.value.forEach((value: any) => {
        groupDetails.value.roles.push(value as string);
      });

      addedRoles.value = new Set([]);

      removedRoles.value = new Set([]);

      // Reset Users
      groupDetails.value.users = groupDetails.value.users.filter(
        (user) => !removedUsers.value.has(user)
      );

      addedUsers.value.forEach((value: any) => {
        groupDetails.value.users.push(value as string);
      });

      addedUsers.value = new Set([]);

      removedUsers.value = new Set([]);
    })
    .catch((err) => {
      if(err.response.status != 403){
        toast({
          variant: "error",
          message: "Error while updating group!",
        });
      }
    });
};

const cancelEditGroup = () => {
  router.push(
    { name: "groups", 
    query: 
      { 
        org_identifier: store.state.selectedOrganization.identifier 
      }
    }
  );
};
</script>

<style scoped></style>
