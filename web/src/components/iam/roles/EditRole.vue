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
    class="pb-2.5"
    data-test="edit-role-page"
    :title="raw(editingRole)"
    :back="{ label: t('iam.roles'), onClick: cancelPermissionsUpdate }"
    bleed
  >
    <!-- TODO OK : Add button to delete role in toolbar -->
    <div data-test="edit-role-title" class="shrink-0">
      <div class="bg-card-glass-bg flex flex-col py-2">
        <AppTabs
          data-test="edit-role-tabs"
          :tabs="tabs"
          :active-tab="activeTab"
          :dirty-title="t('iam.editRole.unsavedDot.title')"
          @update:active-tab="updateActiveTab"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <GroupUsers
        data-test="edit-role-users-section"
        v-show="activeTab === 'users'"
        :groupUsers="roleUsers"
        :activeTab="activeTab"
        :added-users="addedUsers"
        :removed-users="removedUsers"
        context="role"
      />
      <GroupServiceAccounts
        v-if="store.state.zoConfig.service_account_enabled"
        data-test="edit-role-users-section"
        v-show="activeTab === 'serviceAccounts'"
        :groupUsers="roleUsers"
        :activeTab="activeTab"
        :added-users="addedServiceAccounts"
        :removed-users="removedServiceAccounts"
      />

      <div
        v-show="activeTab === 'permissions'"
        data-test="edit-role-permissions-section"
        class="bg-card-glass-bg flex h-full min-h-0"
      >
        <ModuleRail
          v-show="permissionsUiType === 'table'"
          v-model="activeModule"
          :modules="railModules"
        />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            v-if="permissionsUiType === 'json'"
            class="bg-surface-base flex flex-shrink-0 items-center justify-end gap-2 px-3 pt-3 pb-2"
          >
            <OButton
              variant="ghost"
              size="sm"
              icon-left="help"
              data-test="edit-role-json-help-btn"
              @click="toggleHelpSection"
            >
              {{ t("iam.editRole.help") }}
            </OButton>
            <PermissionsViewSwitch
              :count="selectedPermissionsHash.size"
              :model-value="permissionsUiType"
              @update:model-value="updatePermissionsUi"
            />
          </div>

          <div
            data-test="edit-role-permissions-table-section"
            class="rounded-default min-h-0 flex-1 overflow-y-auto"
          >
            <ModulePane
              v-if="permissionsUiType === 'table' && activeModuleView"
              class="h-full"
              :trail="activeModuleView.trail"
              :scopes="activeModuleView.scopes"
              :entities="activeModuleView.entities"
              :loading="moduleLoading || isFetchingInitialRoles"
              :is-granted="isGranted"
              :is-pending-removal="isPendingRemoval"
              :icon="activeRailModule?.icon"
              :added="activeRailModule?.added"
              :removed="activeRailModule?.removed"
              @change="(change) => handlePermissionBatchChange([change])"
              @open="openFolderRow"
              @navigate="navigateTrail"
            >
              <template #actions>
                <PermissionsViewSwitch
                  :count="selectedPermissionsHash.size"
                  :model-value="permissionsUiType"
                  @update:model-value="updatePermissionsUi"
                />
              </template>
            </ModulePane>
            <RoleSummary
              v-else-if="permissionsUiType === 'table'"
              class="h-full"
              :modules="summaryModules"
              :loading="isFetchingInitialRoles"
              @open="(moduleKey) => (activeModule = moduleKey)"
              @preset="applyPreset"
            >
              <template #actions>
                <PermissionsViewSwitch
                  :count="selectedPermissionsHash.size"
                  :model-value="permissionsUiType"
                  @update:model-value="updatePermissionsUi"
                />
              </template>
            </RoleSummary>
            <div v-show="permissionsUiType === 'json'">
              <div class="flex flex-nowrap">
                <div :style="isHelpOpen ? { width: 'calc(100% - 21.875rem)' } : { width: '100%' }">
                  <!-- eslint-disable local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
                  <QueryEditor
                    data-test="logs-vrl-function-editor"
                    editor-id="add-function-editor"
                    class="mt-2"
                    language="json"
                    ref="permissionJsonEditorRef"
                    v-model:query="permissionsJsonValue"
                    style="height: calc(100vh - var(--navbar-height) - 295px)"
                  />
                  <!-- eslint-enable local/no-hardcoded-px -->
                </div>
                <div v-if="isHelpOpen" style="width: 21.875rem" class="p-2">
                  <div class="flex items-center justify-between px-2">
                    <div style="font-size: var(--text-base)">
                      {{ t("iam.editRole.quickReference") }}
                    </div>
                    <OIcon
                      class="cursor-pointer"
                      name="close"
                      size="xs"
                      :title="t('common.close')"
                      @click="toggleHelpSection"
                    />
                  </div>
                  <OSeparator class="mt-2 mb-4" />
                  <div class="mt-2 px-2">
                    <div>
                      {{ t("iam.editRole.jsonConfigHelp") }}
                    </div>
                    <pre style="font-size: var(--text-xs)">{{ raw(jsonPermissionSample) }}</pre>
                    <div>
                      <span class="font-bold">{{ t("iam.editRole.childResource") }}</span> <br />
                      {{ t("iam.editRole.specificInstanceOr") }}
                      <span class="font-bold">{{ raw("organizationID") }}</span>
                      {{ t("iam.editRole.forAllInstances") }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="z-2 mt-2.5 flex w-full flex-shrink-0 justify-end">
      <div
        class="bg-card-glass-bg border-border-default flex w-full items-center justify-end gap-2 border-t px-3 py-2"
      >
        <!-- Sits beside Save because that is where the eye goes before committing. -->
        <OButton
          v-if="pendingChanges.length"
          variant="outline"
          size="sm-action"
          data-test="edit-role-review-changes-btn"
          @click="unsavedDrawerOpen = true"
        >
          {{ t("iam.editRole.reviewChanges") }}
          <OBadge
            variant="warning-soft"
            size="sm"
            class="ms-1.5"
            data-test="edit-role-unsaved-count"
          >
            {{ raw(String(pendingChanges.length)) }}
          </OBadge>
        </OButton>
        <OButton
          data-test="edit-role-cancel-btn"
          variant="outline"
          size="sm-action"
          @click="cancelPermissionsUpdate"
        >
          {{ t("alerts.cancel") }}
        </OButton>
        <OButton
          data-test="edit-role-save-btn"
          variant="primary"
          size="sm-action"
          @click="saveRole"
        >
          {{ t("alerts.save") }}
        </OButton>
      </div>
    </div>
  </OPageLayout>
  <UnsavedChangesDrawer
    v-model:open="unsavedDrawerOpen"
    :changes="pendingChanges"
    @undo="(keys) => keys.forEach(updatePermissionMappings)"
  />
  <ConfirmDialog
    :title="t('iam.editRole.leaveConfirm.title')"
    :message="t('iam.editRole.leaveConfirm.message')"
    @update:ok="onLeaveConfirm(true)"
    @update:cancel="onLeaveConfirm(false)"
    v-model="leaveConfirm.show"
  />
</template>

<script setup lang="ts">
import { updateRoleMutation } from "@/services/iam.queries";
import { useOrgId } from "@/composables/query/useOrgId";
import { useMutation } from "@tanstack/vue-query";
import { resourcesQuery } from "@/services/iam.queries";
import { queryClient } from "@/composables/query/queryClient";
import { computed, defineAsyncComponent, nextTick, ref, type Ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import useRoleGrants, { buildGrantKey } from "@/composables/iam/useRoleGrants";
import ModuleRail, { type RailModule } from "@/components/iam/roles/ModuleRail.vue";
import ModulePane from "@/components/iam/roles/ModulePane.vue";
import PermissionsViewSwitch from "@/components/iam/roles/PermissionsViewSwitch.vue";
import UnsavedChangesDrawer from "@/components/iam/roles/UnsavedChangesDrawer.vue";
import RoleSummary from "@/components/iam/roles/RoleSummary.vue";
import { buildRoleModules, GROUP_LABEL_KEYS } from "@/components/iam/roles/roleModules";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { onBeforeMount } from "vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { getAllRolePermissions, getRoleUsers } from "@/services/iam";
import { useRoleEntityLoaders } from "@/composables/iam/useRoleEntityLoaders";
import { useRolePermissionRows } from "@/composables/iam/useRolePermissionRows";
import { useSavedGrantExpansion } from "@/composables/iam/useSavedGrantExpansion";
import { useRoleScopes } from "@/composables/iam/useRoleScopes";
import { useModuleNavigation } from "@/composables/iam/useModuleNavigation";
import { useRoleSummary } from "@/composables/iam/useRoleSummary";
import { useRolePresets } from "@/composables/iam/useRolePresets";
import { useRoleJsonView } from "@/composables/iam/useRoleJsonView";
import { useRoleSave } from "@/composables/iam/useRoleSave";
import useStreams from "@/composables/useStreams";
import GroupUsers from "../groups/GroupUsers.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import GroupServiceAccounts from "../groups/GroupServiceAccounts.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

onBeforeMount(() => {
  permissionsState.permissions = [];
  editingRole.value = router.currentRoute.value.params.role_name as string;
  getRoleDetails();
});

const { t } = useI18nTyped();

const { permissionsState } = usePermissions();

const router = useRouter();

const store = useStore();

const isHelpOpen = ref(false);

const jsonPermissionSample = `{
  "object": "MainResource:ChildResource",
  "permission": "AccessType"
}`;

const permissionJsonEditorRef: any = ref(null);

const activeTab = ref("permissions");

const editingRole = ref("");

const permissions: Ref<Permission[]> = ref([]);

const grants = useRoleGrants();

// These aliases are the state surface the specs reach through `wrapper.vm`, so the names stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const permissionsHash = grants.saved; // Saved permissions of role

const selectedPermissionsHash = grants.current; // Saved + new added permission hash

const addedPermissions = grants.added;

const resourceMapper: Ref<{ [key: string]: Resource }> = ref({});

const removedPermissions = grants.removed;

const isFetchingInitialRoles = ref(false);

const heavyResourceEntities: Ref<{ [key: string]: Entity[] }> = ref({});
const permissionsJsonValue = ref("");

const addedUsers = ref(new Set());
const removedUsers = ref(new Set());

// Service-account membership is staged in its own pair of sets so the Users and
// Service Accounts tabs track dirty state independently (they're sent together
// as users in the save payload, since the backend treats both as principals).
const addedServiceAccounts = ref(new Set());
const removedServiceAccounts = ref(new Set());

const roleUsers: Ref<string[]> = ref([]);

const permissionsUiType = ref("table");

const { getStreams } = useStreams(t);

// Per-tab unsaved-changes flags. Each tab tracks only its own pending changes.
const isPermissionsDirty = grants.isDirty;

const isUsersDirty = computed(() => addedUsers.value.size > 0 || removedUsers.value.size > 0);

const isServiceAccountsDirty = computed(
  () => addedServiceAccounts.value.size > 0 || removedServiceAccounts.value.size > 0,
);

const isAnyDirty = computed(
  () => isPermissionsDirty.value || isUsersDirty.value || isServiceAccountsDirty.value,
);

// Route-leave guard: warn before discarding unsaved permission/membership
// changes. The pending navigation is held until the user resolves the dialog.
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
      value: "permissions",
      label: t("iam.editRole.permissions"),
      icon: "shield",
      dirty: isPermissionsDirty.value,
    },
    {
      value: "users",
      label: t("iam.editRole.users"),
      icon: "group",
      dirty: isUsersDirty.value,
    },
  ];

  if (store.state.zoConfig.service_account_enabled) {
    baseTabs.push({
      value: "serviceAccounts",
      label: t("iam.editRole.serviceAccounts"),
      icon: "smart-toy",
      dirty: isServiceAccountsDirty.value,
    });
  }

  return baseTabs;
});

// "" is the summary: the landing pane that lists what the role grants.
const activeModule = ref("");

// The module or folder whose entities are in flight, so a slower one cannot clear the newer spinner.
const loadingFor = ref("");

const unsavedDrawerOpen = ref(false);

// The folder opened inside a folder module, or null at the module's top level.
const openFolder = ref<any>(null);

const moduleLoading = computed(
  () => loadingFor.value === activeModule.value || loadingFor.value === openFolder.value?.name,
);

// Mirrors setPermission's guard: `org` is grantable from the meta org only.
const grantableResources = computed(() =>
  permissionsState.resources.filter(
    (resource: any) =>
      resource.key !== "org" ||
      store.state.selectedOrganization.identifier === store.state.zoConfig.meta_org,
  ),
);

const roleModules = computed(() => buildRoleModules(grantableResources.value));

const resourceLabel = (key: string) =>
  permissionsState.resources.find((resource: any) => resource.key === key)?.display_name ?? key;

const moduleLabel = (key: string) => raw(resourceLabel(key));

const railModules = computed<RailModule[]>(() =>
  roleModules.value.map((module) => {
    const totals = module.countedKeys.reduce(
      (sum, key) => {
        const stat = grants.statFor(key);
        return {
          granted: sum.granted + stat.granted,
          added: sum.added + stat.added,
          removed: sum.removed + stat.removed,
        };
      },
      { granted: 0, added: 0, removed: 0 },
    );
    return {
      key: module.key,
      label: moduleLabel(module.key),
      icon: module.icon,
      groupId: module.group,
      groupLabel: t(GROUP_LABEL_KEYS[module.group]),
      ...totals,
    };
  }),
);

const ACTION_ORDER = ["AllowAll", "AllowList", "AllowGet", "AllowPost", "AllowPut", "AllowDelete"];

const ACTION_LABEL_KEYS = {
  AllowAll: "iam.all",
  AllowList: "iam.list",
  AllowGet: "iam.get",
  AllowPost: "iam.create",
  AllowPut: "iam.update",
  AllowDelete: "iam.delete",
} as const;

const activeRailModule = computed(() =>
  railModules.value.find((module) => module.key === activeModule.value),
);

const moduleOf = (moduleKey: string) =>
  roleModules.value.find((candidate) => candidate.key === moduleKey);

const isGranted = (node: any, action: string) =>
  selectedPermissionsHash.value.has(permissionHashFor(node, action));

const isPendingRemoval = (node: any, action: string) =>
  !!grants.removed.value[permissionHashFor(node, action)];

// The scope ladder lives in its own file: which rows are pinned, and what each one covers.
const { moduleScopes, folderScopes, streamTypeScopes } = useRoleScopes({
  resourceMapper,
  isGranted,
  resourceLabel,
  moduleLabel,
  t,
  ACTION_ORDER,
});

const orgId = useOrgId();
const updateRoleOne = useMutation(() => updateRoleMutation(orgId.value));

const updateActiveTab = (tab: string) => {
  if (!tab) return;
  activeTab.value = tab;
};

const getRoleDetails = () => {
  isFetchingInitialRoles.value = true;

  queryClient
    .fetchQuery(resourcesQuery(store.state.selectedOrganization.identifier))
    .then(async (res: any) => {
      permissionsState.resources = res
        .sort((a: any, b: any) => a.order - b.order)
        .filter((resource: any) => resource.visible);

      setDefaultPermissions();

      await getResourcePermissions();
      await getUsers();
      savePermissionHash();
      await updateRolePermissions(permissions.value);
      isFetchingInitialRoles.value = false;

      if (selectedPermissionsHash.value.size === 0) {
        // A preset only stages PENDING "added" permissions, so the user can still tweak them before saving.
        const preset = router.currentRoute.value.query.preset;
        if (preset === "readonly") {
          seedReadonlyPreset();
        } else if (preset === "dbm") {
          await seedDbmViewerPreset();
        } else if (preset === "k8s") {
          await seedK8sViewerPreset();
        }
      }
    })
    .catch((error) => {
      isFetchingInitialRoles.value = false;
      toast({
        message:
          error?.response?.status === 404
            ? t("iam.editRole.roleNotFound")
            : error?.message || t("iam.editRole.loadFailed"),
        variant: "error",
      });
      router.push({
        name: "roles",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
};

const getUsers = () => {
  return new Promise((resolve, reject) => {
    getRoleUsers(editingRole.value, store.state.selectedOrganization.identifier)
      .then((res) => {
        roleUsers.value = res.data;
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
};

const getResourceByName = (
  resources: Resource[],
  resourceName: string,
  level: number = 0,
): Resource | null | undefined => {
  for (let i = 0; i < resources.length; i++) {
    if (resources[i].resourceName === resourceName) return resources[i];
    else if (resources[i].childs.length) {
      const isFound = getResourceByName(resources[i].childs, resourceName, level + 1);
      if (isFound) return isFound;
    }
  }

  if (!level) return null;
  return undefined;
};

const setPermission = (resource: any, visited: Set<string>) => {
  if (!resource || !resource.key) {
    return;
  }

  // Prevent infinite recursion by tracking visited resources
  if (visited.has(resource.key)) {
    return;
  }
  visited.add(resource.key);

  const resourcePermission = getDefaultResource();
  resourcePermission.name = resource.key;
  resourcePermission.resourceName = resource.key;
  resourcePermission.display_name = resource.display_name;
  resourcePermission.top_level = resource.top_level;

  if (resource.has_entities) resourcePermission.has_entities = true;

  resourcePermission.parent = resource.parent;

  resourceMapper.value[resourcePermission.name] = resourcePermission;

  if (resource.parent) {
    const parentResource = getResourceByName(permissionsState.permissions, resource.parent);

    if (parentResource) {
      parentResource.childs.push(resourcePermission as Resource);
      return;
    } else {
      // Find parent in resources array
      const _parentResource = permissionsState.resources.find((r) => r.key === resource.parent);

      if (_parentResource && !visited.has(_parentResource.key)) {
        // Process parent first
        setPermission(_parentResource, visited);

        // Get the processed parent resource
        const processedParentResource = getResourceByName(
          permissionsState.permissions,
          resource.parent,
        );

        if (processedParentResource) {
          processedParentResource.childs.push(resourcePermission as Resource);
        }
      }
    }
  }

  modifyResourcePermissions(resourcePermission);
  if (
    resourcePermission.name === "org" &&
    store.state.selectedOrganization.identifier !== store.state.zoConfig.meta_org
  ) {
    return; // Skip adding 'org' resource if the organization is not _meta
  }
  permissionsState.permissions.push(resourcePermission as Resource);
};

const setDefaultPermissions = () => {
  // Create a single visited set to be shared across all recursive calls
  const visited = new Set<string>();

  // Process resources in order of their parent relationships
  const processResource = (resource: any) => {
    if (!visited.has(resource.key)) {
      setPermission(resource, visited);
    }
  };

  // First process resources without parents
  permissionsState.resources.filter((resource: any) => !resource.parent).forEach(processResource);

  // Then process resources with parents
  permissionsState.resources.filter((resource: any) => resource.parent).forEach(processResource);

  // Filter out child resources from the top level
  permissionsState.permissions = permissionsState.permissions.filter(
    (resource) => !resource.parent,
  );
};
const modifyResourcePermissions = (resource: Resource) => {
  if (resource.resourceName === "settings") {
    resource.permission.AllowList.show = false;
    resource.permission.AllowDelete.show = false;
    resource.permission.AllowPost.show = false;
  }
  if (resource.resourceName === "logs_pattern" || resource.resourceName === "logs_insights") {
    resource.permission.AllowList.show = false;
    resource.permission.AllowDelete.show = false;
    resource.permission.AllowPost.show = false;
    resource.permission.AllowPut.show = false;
  }
  if (resource.resourceName === "logs_cache") {
    resource.permission.AllowList.show = false;
    resource.permission.AllowGet.show = false;
    resource.permission.AllowPost.show = false;
    resource.permission.AllowPut.show = false;
  }
};

const getResourcePermissions = () => {
  // Single request returns the role's permissions across all resource types.
  // Backend returns a flat Permission[].
  return new Promise((resolve, reject) => {
    getAllRolePermissions({
      role_name: editingRole.value,
      org_identifier: store.state.selectedOrganization.identifier,
    })
      .then((res: { data: Permission[] }) => {
        permissions.value.push(...res.data);
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
};

const getDefaultResource = (): Resource => {
  return {
    name: "",
    permission: {
      AllowAll: {
        show: true,
        value: false,
      },
      AllowList: {
        show: true,
        value: false,
      },
      AllowGet: {
        show: true,
        value: false,
      },
      AllowDelete: {
        show: true,
        value: false,
      },
      AllowPost: {
        show: true,
        value: false,
      },
      AllowPut: {
        show: true,
        value: false,
      },
    },
    display_name: "",
    parent: "",
    childs: [],
    type: "Type",
    resourceName: "",
    entities: [],
    has_entities: false,
    is_loading: false,
    top_level: true,
  };
};

const getOrgId = () => {
  return store.state.selectedOrganization.identifier;
};

// What the role grants and what changed since load live in their own file.
const { summaryModules, pendingChanges } = useRoleSummary({
  selectedPermissionsHash,
  addedPermissions,
  removedPermissions,
  permissionsState,
  resourceMapper,
  heavyResourceEntities,
  roleModules,
  railModules,
  unsavedDrawerOpen,
  resourceLabel,
  moduleLabel,
  getOrgId,
  t,
  ACTION_ORDER,
  ACTION_LABEL_KEYS,
});

const savePermissionHash = () => {
  grants.seedSaved(
    permissions.value.map((permission: Permission) => {
      const { resource, entity } = decodePermission(permission.object);
      return buildGrantKey(resource, permission.permission, entity);
    }),
  );
};

const decodePermission = (permission: string) => {
  const [resource, entity] = permission.split(":");
  return { resource, entity };
};

const cancelPermissionsUpdate = () => {
  router.push({
    name: "roles",
    query: {
      org_identifier: store.state.selectedOrganization.identifier,
    },
  });
};

// The pane reads with the same key the toggle writes, so the two can never disagree.
const permissionHashFor = (row: any, permission: string) => {
  let entity = "";
  let resourceName = row.resourceName;

  // As there can be conflict in resource name and org id, as they can be same.
  // So we are adding _all_ prefix to org id to differentiate between org id and resource name

  if (row.type === "Type") entity = "_all_" + store.state.selectedOrganization.identifier;
  else entity = row.name;

  if (row.type === "Resource" && row.top_level) {
    resourceName = row.name;
    entity = "_all_" + store.state.selectedOrganization.identifier;
  }

  return `${resourceName}:${entity}:${permission}`;
};

const handlePermissionChange = (row: any, permission: string) => {
  updatePermissionMappings(permissionHashFor(row, permission));
};

const handlePermissionBatchChange = (
  changes: { row: any; permission: string; newValue: boolean }[],
) => {
  changes.forEach(({ row, permission, newValue }) => {
    row.permission[permission].value = newValue;
    handlePermissionChange(row, permission);
  });
};

const updatePermissionMappings = (permissionHash: string) => grants.toggle(permissionHash);

const expandPermission = async (resource: any) => {
  const expand = !resource.expand;

  resource.expand = expand;
  if (expand) {
    try {
      await getResourceEntities(resource);
    } catch (err) {
      console.log(err);
    }
  }
};

// The three presets live in their own file; they stage through the same handlers a click does.
const { seedReadonlyPreset, seedDbmViewerPreset, seedK8sViewerPreset, applyPreset } =
  useRolePresets({
    permissionsState,
    resourceMapper,
    heavyResourceEntities,
    grants,
    permissionHashFor,
    handlePermissionChange,
    handlePermissionBatchChange,
    expandPermission,
    t,
  });

const getPermissionHash = (resourceName: string, permission: string, entity?: string) => {
  if (!entity) entity = "_all_" + store.state.selectedOrganization.identifier;

  return `${resourceName}:${entity}:${permission}`;
};

/**
 *
 * @param resource
 * @param typeOf - Type to assign the new entities that we get from the server
 */
// Row building lives in its own file; it needs the tree and the grant store.
const { updateEntityEntities, updateResourceEntities, updateResourceResource } =
  useRolePermissionRows({
    permissionsState,
    heavyResourceEntities,
    selectedPermissionsHash,
    getPermissionHash,
    getResourceByName,
    store,
  });

// The list requests live in their own file; the row builders they feed stay here.
const { getResourceEntities } = useRoleEntityLoaders({
  store,
  getStreams,
  t,
  updateResourceEntities,
  updateEntityEntities,
  updateResourceResource,
});

// The view of the open module and folder lives in its own file, with the moves that change it.
const { activeModuleView, openFolderRow, navigateTrail } = useModuleNavigation({
  activeModule,
  openFolder,
  loadingFor,
  resourceMapper,
  heavyResourceEntities,
  moduleOf,
  moduleLabel,
  moduleScopes,
  folderScopes,
  streamTypeScopes,
  getResourceEntities,
});

// Expanding saved grants onto the tree lives in its own file; it may fetch rows to do it.
const { updateRolePermissions } = useSavedGrantExpansion({
  permissionsState,
  decodePermission,
  getResourceByName,
  getResourceEntities,
  getOrgId,
});

const updateEntityPermission = (
  resource: Resource | Entity,
  resourceName: string,
  entityName: string,
  permission: "AllowAll" | "AllowList" | "AllowGet" | "AllowDelete" | "AllowPost",
) => {
  if (resource?.entities)
    resource.entities.forEach((entity: Entity) => {
      if (entity.name === entityName) {
        entity.permission[permission].value = selectedPermissionsHash.value.has(
          getPermissionHash(resourceName, permission, entityName),
        );
      }
    });
};

// Table <-> JSON lives in its own file; the JSON is reconciled through the same staging a click uses.
const { updatePermissionsUi, updateJsonInTable } = useRoleJsonView({
  permissionsUiType,
  permissionsJsonValue,
  permissionJsonEditorRef,
  selectedPermissionsHash,
  resourceMapper,
  updatePermissionMappings,
  updateEntityPermission,
  updateRolePermissions,
  getPermissionHash,
  getOrgId,
});

// Sending the changes lives in its own file; it reads the grant store and the member staging.
const { saveRole } = useRoleSave({
  editingRole,
  permissionsUiType,
  updateJsonInTable,
  grants,
  addedUsers,
  removedUsers,
  addedServiceAccounts,
  removedServiceAccounts,
  roleUsers,
  updateRoleOne,
  t,
});

const toggleHelpSection = async () => {
  isHelpOpen.value = !isHelpOpen.value;

  await nextTick();
  await nextTick();

  permissionJsonEditorRef.value.resetEditorLayout();
};
</script>
