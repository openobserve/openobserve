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
  <OPageLayout
    data-test="edit-group-section"
    :title="groupDetails.group_name"
    :back="{ label: t('iam.groups'), onClick: cancelEditGroup }"
    bleed
  >
    <div
      data-test="edit-group-section-title"
      class="px-page-edge pt-2.5 pb-2.5 flex-shrink-0"
    >
    <div class="bg-card-glass-bg py-3">
    <AppTabs
      data-test="edit-group-tabs"
      :tabs="tabs"
      :active-tab="activeTab"
      :dirty-title="t('iam.editGroup.unsavedDot.title')"
      @update:active-tab="updateActiveTab"
    />
    </div>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden">
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
        :added-users="addedServiceAccounts"
        :removed-users="removedServiceAccounts"
      />
    </div>
    <div
      data-test="edit-group-footer"
    class="flex justify-end w-full flex-shrink-0 z-2"
    >
      <div class="bg-card-glass-bg w-full py-2 px-page-edge justify-end flex gap-2 border-t border-border-default">
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
    <ConfirmDialog
      :title="t('iam.editGroup.leaveConfirm.title')"
      :message="t('iam.editGroup.leaveConfirm.message')"
      @update:ok="onLeaveConfirm(true)"
      @update:cancel="onLeaveConfirm(false)"
      v-model="leaveConfirm.show"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import GroupRoles from "./GroupRoles.vue";
import GroupUsers from "./GroupUsers.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useI18n } from "vue-i18n";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { onBeforeMount } from "vue";
import { getGroup, updateGroup } from "@/services/iam";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import GroupServiceAccounts from "./GroupServiceAccounts.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
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

// Service-account membership is staged separately from users so the Users and
// Service Accounts tabs track dirty state independently (they're sent together
// as users in the save payload, since the backend treats both as principals).
const addedServiceAccounts = ref(new Set());
const removedServiceAccounts = ref(new Set());

// Per-tab unsaved-changes flags. Each tab tracks only its own pending changes.
const isRolesDirty = computed(
  () => addedRoles.value.size > 0 || removedRoles.value.size > 0,
);

const isUsersDirty = computed(
  () => addedUsers.value.size > 0 || removedUsers.value.size > 0,
);

const isServiceAccountsDirty = computed(
  () =>
    addedServiceAccounts.value.size > 0 ||
    removedServiceAccounts.value.size > 0,
);

const isAnyDirty = computed(
  () =>
    isRolesDirty.value || isUsersDirty.value || isServiceAccountsDirty.value,
);

// Route-leave guard: warn before discarding unsaved role/membership changes.
// The pending navigation is held until the user resolves the dialog.
const leaveConfirm = ref<{
  show: boolean;
  resolve: ((proceed: boolean) => void) | null;
}>({ show: false, resolve: null });

const onLeaveConfirm = (proceed: boolean) => {
  leaveConfirm.value.show = false;
  leaveConfirm.value.resolve?.(proceed);
  leaveConfirm.value.resolve = null;
};

onBeforeRouteLeave(() => {
  if (!isAnyDirty.value) return true;

  return new Promise<boolean>((resolve) => {
    leaveConfirm.value.resolve = resolve;
    leaveConfirm.value.show = true;
  });
});

const tabs = computed(() => {
  const baseTabs = [
    {
      value: "roles",
      label: t('iam.editGroup.roles'),
      icon: "shield",
      dirty: isRolesDirty.value,
    },
    {
      value: "users",
      label: t('iam.editGroup.users'),
      icon: "group",
      dirty: isUsersDirty.value,
    },
  ];

  if (store.state.zoConfig.service_account_enabled) {
    baseTabs.push({
      value: "serviceAccounts",
      label: t('iam.editGroup.serviceAccounts'),
      icon: "smart-toy",
      dirty: isServiceAccountsDirty.value,
    });
  }

  return baseTabs;
});

const getGroupDetails = () => {
  const groupName: string = router.currentRoute.value.params
    .group_name as string;

  getGroup(groupName, store.state.selectedOrganization.identifier)
    .then((res) => {
      groupDetails.value = {
        ...res.data,
        group_name: res.data.name,
      };
      groupsState.groups[groupName] = groupDetails.value;
    })
    .catch((err) => {
      console.log(err);
      toast({
        message: err?.message || t('iam.editGroup.groupNotFound'),
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
  // Users and service accounts are both sent as users; merge the two staging
  // sets (dedup via Set) for the request payload.
  const payload = {
    add_users: Array.from(
      new Set([...addedUsers.value, ...addedServiceAccounts.value]),
    ) as string[],
    remove_users: Array.from(
      new Set([...removedUsers.value, ...removedServiceAccounts.value]),
    ) as string[],
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
      message: t('iam.editGroup.noUpdates'),
    });

    return;
  }

  updateGroup({
    group_name: groupDetails.value.group_name,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then(() => {
      toast({
        variant: "success",
        message: t('iam.editGroup.updateSuccess'),
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

      // Reset Users + Service Accounts (both stored in groupDetails.users)
      groupDetails.value.users = groupDetails.value.users.filter(
        (user) =>
          !removedUsers.value.has(user) &&
          !removedServiceAccounts.value.has(user)
      );

      addedUsers.value.forEach((value: any) => {
        groupDetails.value.users.push(value as string);
      });

      addedServiceAccounts.value.forEach((value: any) => {
        groupDetails.value.users.push(value as string);
      });

      addedUsers.value = new Set([]);

      removedUsers.value = new Set([]);

      addedServiceAccounts.value = new Set([]);

      removedServiceAccounts.value = new Set([]);
    })
    .catch((err) => {
      if(err.response.status != 403){
        toast({
          variant: "error",
          message: t('iam.editGroup.updateError'),
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
