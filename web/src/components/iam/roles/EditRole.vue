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
    :title="editingRole"
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
        class="bg-card-glass-bg flex h-full flex-col"
      >
        <div class="bg-surface-base flex flex-shrink-0 items-center justify-between">
          <div
            v-show="permissionsUiType === 'table'"
            data-test="edit-role-permissions-filters"
            class="sticky top-0 z-2 flex items-start justify-start gap-3 px-3 py-2"
          >
            <div data-test="edit-role-permissions-show-toggle" class="flex items-center">
              <span data-test="edit-role-permissions-show-text" style="font-size: var(--text-sm)">
                {{ t("iam.editRole.show") }}
              </span>
              <OToggleGroup
                class="ml-1"
                :model-value="filter.permissions"
                @update:model-value="(v) => updateTableData(v as string)"
              >
                <OToggleGroupItem
                  v-for="visual in permissionDisplayOptions"
                  :key="visual.value"
                  :value="visual.value"
                  size="sm"
                  :data-test="`edit-role-permissions-show-${visual.value}-btn`"
                >
                  {{ visual.label }}
                </OToggleGroupItem>
              </OToggleGroup>
            </div>
            <div data-test="edit-role-permissions-search-input">
              <OInput
                v-model="filter.value"
                :debounce="500"
                class="no-border o2-search-input h-9 w-50"
                :placeholder="t('iam.editRole.searchPermissions')"
                @update:model-value="onResourceChange"
              >
                <template #icon-left>
                  <OIcon name="search" size="sm" />
                </template>
              </OInput>
            </div>
            <div data-test="edit-role-permissions-resource-select-input">
              <OSelect
                v-model="filter.resource"
                :options="resourceOptions"
                :placeholder="t('iam.editRole.selectResource')"
                clearable
                searchable
                style="width: 200px"
                @update:model-value="onResourceChange"
              />
            </div>
          </div>
          <div></div>
          <div class="flex items-center gap-2">
            <span data-test="edit-role-permissions-count" class="text-sm font-bold">
              {{ t("iam.editRole.permissionsCount", { count: selectedPermissionsHash.size }) }}
            </span>
            <OToggleGroup
              data-test="edit-role-permissions-ui-type-toggle"
              class="my-1 mr-3"
              :model-value="permissionsUiType"
              @update:model-value="(v) => updatePermissionsUi(v as string)"
            >
              <OToggleGroupItem
                v-for="visual in permissionUiOptions"
                :key="visual.value"
                :value="visual.value"
                size="sm"
                :data-test="`edit-role-permissions-show-${visual.value}-btn`"
              >
                {{ visual.label }}
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
        </div>

        <div
          data-test="edit-role-permissions-table-section"
          class="rounded-default min-h-0 flex-1 overflow-y-auto"
        >
          <div v-show="permissionsUiType === 'table'">
            <PermissionsTable
              ref="permissionTableRef"
              :rows="permissionsState.permissions"
              :customFilteredPermissions="filteredPermissions"
              :filter="filter"
              :visibleResourceCount="countOfVisibleResources"
              :selected-permissions-hash="selectedPermissionsHash"
              :loading="isFetchingInitialRoles"
              @updated:permission="handlePermissionChange"
              @updated:permission-batch="handlePermissionBatchChange"
              @expand:row="expandPermission"
              @update:filter="onClearFilter"
            />
          </div>
          <div v-show="permissionsUiType === 'json'">
            <div class="flex items-center justify-between">
              <div class="mb-3 font-bold">
                {{
                  t("iam.editRole.permissionCountSingular", { count: selectedPermissionsHash.size })
                }}
              </div>
              <div
                class="flex cursor-pointer items-center"
                :title="t('menu.help')"
                @click="toggleHelpSection"
              >
                <OIcon name="help" size="sm" />
                <span class="ml-1"> {{ t("iam.editRole.help") }} </span>
              </div>
            </div>
            <div class="flex flex-nowrap">
              <div :style="isHelpOpen ? { width: 'calc(100% - 350px)' } : { width: '100%' }">
                <QueryEditor
                  data-test="logs-vrl-function-editor"
                  editor-id="add-function-editor"
                  class="mt-2"
                  language="json"
                  ref="permissionJsonEditorRef"
                  v-model:query="permissionsJsonValue"
                  style="height: calc(100vh - var(--navbar-height) - 295px)"
                />
              </div>
              <div v-if="isHelpOpen" style="width: 350px" class="p-2">
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
                  <pre style="font-size: var(--text-xs)">
{
  "object": "MainResource:ChildResource",
  "permission": "AccessType"
}</pre
                  >
                  <div>
                    <span class="font-bold">{{ t("iam.editRole.childResource") }}</span> <br />
                    {{ t("iam.editRole.specificInstanceOr") }}
                    <span class="font-bold">organizationID</span>
                    {{ t("iam.editRole.forAllInstances") }}
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
        class="bg-card-glass-bg border-border-default flex w-full justify-end gap-2 border-t px-3 py-2"
      >
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
  <ConfirmDialog
    :title="t('iam.editRole.leaveConfirm.title')"
    :message="t('iam.editRole.leaveConfirm.message')"
    @update:ok="onLeaveConfirm(true)"
    @update:cancel="onLeaveConfirm(false)"
    v-model="leaveConfirm.show"
  />
</template>

<script setup lang="ts">
import { cloneDeep } from "lodash-es";
import { computed, defineAsyncComponent, nextTick, ref, type Ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18n } from "vue-i18n";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import PermissionsTable from "@/components/iam/roles/PermissionsTable.vue";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { onBeforeMount } from "vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { updateRole, getResources, getAllRolePermissions, getRoleUsers } from "@/services/iam";
import pipelineService from "@/services/pipelines";
import alertService from "@/services/alerts";
import reportService from "@/services/reports";
import templateService from "@/services/alert_templates";
import actions from "@/services/action_scripts";
import destinationService from "@/services/alert_destination";
import jsTransformService from "@/services/jstransform";
import organizationsService from "@/services/organizations";
import savedviewsService from "@/services/saved_views";
import dashboardService from "@/services/dashboards";
import serviceAccountService from "@/services/service_accounts";
import useStreams from "@/composables/useStreams";
import { getGroups, getRoles } from "@/services/iam";
import GroupUsers from "../groups/GroupUsers.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import GroupServiceAccounts from "../groups/GroupServiceAccounts.vue";
import cipherKeysService from "@/services/cipher_keys";
import RePatternsService from "@/services/regex_pattern";
import commonService from "@/services/common";
import syntheticsService from "@/services/synthetics";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import onlineEvalsService from "@/services/online-evals.service";

const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

onBeforeMount(() => {
  permissionsState.permissions = [];
  editingRole.value = router.currentRoute.value.params.role_name as string;
  getRoleDetails();
});

const permissionTableRef: any = ref(null);

const { t } = useI18n();

const { permissionsState } = usePermissions();

const router = useRouter();

const store = useStore();

const isHelpOpen = ref(false);

const permissionJsonEditorRef: any = ref(null);

const activeTab = ref("permissions");

const editingRole = ref("");

const permissions: Ref<Permission[]> = ref([]);

const permissionsHash = ref(new Set()); // Saved permissions of role

const selectedPermissionsHash = ref(new Set()); // Saved + new added permission hash

const addedPermissions: any = ref({});

const resourceMapper: Ref<{ [key: string]: Resource }> = ref({});

const removedPermissions: any = ref({});

const countOfVisibleResources = ref(0);

const isFetchingInitialRoles = ref(false);

const filteredPermissions: Ref<{ [key: string]: Entity[] }> = ref({});

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

const { getStreams } = useStreams();

// Per-tab unsaved-changes flags. Each tab tracks only its own pending changes.
const isPermissionsDirty = computed(
  () =>
    Object.keys(addedPermissions.value).length > 0 ||
    Object.keys(removedPermissions.value).length > 0,
);

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

const permissionDisplayOptions = [
  {
    label: t("iam.editRole.all"),
    value: "all",
    icon: "format-list-bulleted",
  },
  {
    label: t("iam.editRole.selected"),
    value: "selected",
    icon: "check-box",
  },
];

const permissionUiOptions = [
  {
    label: t("iam.editRole.table"),
    value: "table",
    icon: "table-chart",
  },
  {
    label: t("iam.editRole.json"),
    value: "json",
    icon: "data-object",
  },
];

const filter = ref({
  resource: "",
  value: "",
  permissions: "selected",
  method: filterResources,
});

const filteredResources: Ref<any[]> = ref([]);

const resourceOptions: Ref<any[]> = ref([]);

const updateActiveTab = (tab: string) => {
  if (!tab) return;
  activeTab.value = tab;
};

const getRoleDetails = () => {
  isFetchingInitialRoles.value = true;

  getResources(store.state.selectedOrganization.identifier)
    .then(async (res) => {
      permissionsState.resources = res.data
        .sort((a: any, b: any) => a.order - b.order)
        .filter((resource: any) => resource.visible);

      setDefaultPermissions();

      filteredResources.value = permissionsState.resources
        .map((r) => {
          return {
            label: r.display_name,
            value: r.key,
          };
        })
        .filter((r) => r.value !== "dashboard");

      resourceOptions.value = cloneDeep(filteredResources.value);

      await getResourcePermissions();
      await getUsers();
      savePermissionHash();
      await updateRolePermissions(permissions.value);
      isFetchingInitialRoles.value = false;

      // A brand-new role has no saved permissions, so the default "Selected"
      // filter renders an empty matrix that looks broken. Default to "All" so
      // the user sees the full permission grid to start checking boxes.
      if (selectedPermissionsHash.value.size === 0) {
        filter.value.permissions = "all";

        // "Read-only" preset (from the Add Role dialog) seeds AllowList +
        // AllowGet across all top-level resources so evaluators get a safe,
        // non-empty starting point. These land as pending "added" permissions
        // the user can still tweak before saving.
        if (router.currentRoute.value.query.preset === "readonly") {
          seedReadonlyPreset();
        }
      }

      updateTableData();
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

const savePermissionHash = () => {
  permissions.value.forEach((permission: Permission) => {
    const { resource, entity } = decodePermission(permission.object);

    // Creating permissions hash to check if permission is selected at the time of save as we need to send only added and removed permissions
    const permissionHash = `${resource}:${entity}:${permission.permission}`;
    permissionsHash.value.add(permissionHash);
    selectedPermissionsHash.value.add(permissionHash);
  });
};

const updateRolePermissions = async (permissions: Permission[]) => {
  let resourceMapper: { [key: string]: Resource } = {};
  for (let i = 0; i < permissions.length; i++) {
    try {
      let {
        resource,
        entity,
      }: {
        resource: string;
        entity: string;
      } = decodePermission(permissions[i].object);

      if (!resourceMapper[resource]) {
        resourceMapper[resource] = getResourceByName(
          permissionsState.permissions,
          resource,
        ) as Resource;
      }
      // Added it intentionally, as to get parent resource for dashboard, before getting dashboard permissions
      if (!resourceMapper[resource] && resource === "dashboard") {
        if (!resourceMapper["dfolder"]) {
          resourceMapper["dfolder"] = getResourceByName(
            permissionsState.permissions,
            "dfolder",
          ) as Resource;
        }

        await getResourceEntities(resourceMapper["dfolder"]);

        if (!resourceMapper[resource]) {
          resourceMapper[resource] = getResourceByName(
            permissionsState.permissions,
            resource,
          ) as Resource;
        }
      }

      if (!resourceMapper[resource] && resource === "alert") {
        if (!resourceMapper["afolder"]) {
          resourceMapper["afolder"] = getResourceByName(
            permissionsState.permissions,
            "afolder",
          ) as Resource;
        }

        await getResourceEntities(resourceMapper["afolder"]);

        if (!resourceMapper[resource]) {
          resourceMapper[resource] = getResourceByName(
            permissionsState.permissions,
            resource,
          ) as Resource;
        }
      }

      if (!resourceMapper[resource] && resource === "report") {
        if (!resourceMapper["rfolder"]) {
          resourceMapper["rfolder"] = getResourceByName(
            permissionsState.permissions,
            "rfolder",
          ) as Resource;
        }

        await getResourceEntities(resourceMapper["rfolder"]);

        if (!resourceMapper[resource]) {
          resourceMapper[resource] = getResourceByName(
            permissionsState.permissions,
            resource,
          ) as Resource;
        }
      }

      if (!resourceMapper[resource] && resource === "synthetics") {
        if (!resourceMapper["synthetic_folder"]) {
          resourceMapper["synthetic_folder"] = getResourceByName(
            permissionsState.permissions,
            "synthetic_folder",
          ) as Resource;
        }

        await getResourceEntities(resourceMapper["synthetic_folder"]);

        if (!resourceMapper[resource]) {
          resourceMapper[resource] = getResourceByName(
            permissionsState.permissions,
            resource,
          ) as Resource;
        }
      }

      if (!resourceMapper[resource]) continue;

      if (resourceMapper[resource].parent && !resourceMapper[resourceMapper[resource].parent]) {
        resourceMapper[resourceMapper[resource].parent] = getResourceByName(
          permissionsState.permissions,
          resourceMapper[resource].parent,
        ) as Resource;
      }

      if (entity === "_all_" + getOrgId()) {
        resourceMapper[resource].permission[permissions[i].permission].value = true;

        continue;
      }

      if (resourceMapper[resource].parent)
        await getResourceEntities(resourceMapper[resourceMapper[resource].parent]);

      // This is just to handle dashboard permissions, need to fix this
      if (resource === "dashboard") {
        const [folderId] = entity.split("/");

        const dashResource = resourceMapper["dfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        );
        await getResourceEntities(dashResource as Entity);
      } else if (resource === "alert") {
        const [folderId] = entity.split("/");

        const alertResource = resourceMapper["afolder"].entities.find(
          (e: Entity) => e.name === folderId,
        );
        await getResourceEntities(alertResource as Entity);
      } else if (resource === "report") {
        const [folderId] = entity.split("/");

        const reportResource = resourceMapper["rfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        );
        await getResourceEntities(reportResource as Entity);
      } else if (resource === "synthetics") {
        // Synthetics entities are plain monitor ids (no folder prefix), so the
        // owning folder can't be derived from the entity — load every folder's
        // monitors so the permission can be matched to its row.
        for (const folderEntity of resourceMapper["synthetic_folder"]?.entities ?? []) {
          await getResourceEntities(folderEntity as Entity);
        }
      } else if (
        resource === "logs" ||
        resource === "metrics" ||
        resource === "traces" ||
        resource === "index"
      ) {
        const streamResource = resourceMapper["stream"].entities.find(
          (e: Entity) => e.name === resource,
        );
        await getResourceEntities(streamResource as Entity);
      } else {
        await getResourceEntities(resourceMapper[resource]);
      }
    } catch (err) {
      console.log(err);
    }
  }

  resourceMapper = {};

  return new Promise((resolve) => {
    resolve(true);
  });
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

// Seed AllowList + AllowGet on every visible top-level resource. Mirrors a
// user manually checking those two columns, so the changes flow through the
// normal added/removed-permission bookkeeping and the Save payload.
const seedReadonlyPreset = () => {
  const readonlyPerms = ["AllowList", "AllowGet"];
  permissionsState.permissions.forEach((resource: Resource) => {
    readonlyPerms.forEach((perm) => {
      const permDetail = resource.permission?.[perm as "AllowList"];
      // Only seed permissions the resource actually exposes and that are not
      // already selected.
      if (!permDetail || !permDetail.show || permDetail.value) return;
      permDetail.value = true;
      handlePermissionChange(resource, perm);
    });
  });
};

const handlePermissionChange = (row: any, permission: string) => {
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

  const permissionHash = `${resourceName}:${entity}:${permission}`;

  // Add permission to addedPermissions if not present
  updatePermissionMappings(permissionHash);
};

const handlePermissionBatchChange = (
  changes: { row: any; permission: string; newValue: boolean }[],
) => {
  changes.forEach(({ row, permission, newValue }) => {
    row.permission[permission].value = newValue;
    handlePermissionChange(row, permission);
  });
};

const updatePermissionMappings = (permissionHash: string) => {
  const permissionSplit = permissionHash.split(":");
  const object = permissionSplit[0] + ":" + permissionSplit[1];
  const permission = permissionSplit[2];

  if (!addedPermissions.value[permissionHash] && !permissionsHash.value.has(permissionHash)) {
    selectedPermissionsHash.value.add(permissionHash);
    addedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };
    return;
  }

  // Remove permission from removedPermissions if present
  if (
    removedPermissions.value[permissionHash] &&
    permissionsHash.value.has(permissionHash) &&
    !selectedPermissionsHash.value.has(permissionHash)
  ) {
    delete removedPermissions.value[permissionHash];
    selectedPermissionsHash.value.add(permissionHash);
    return;
  }

  // Remove permission from removedPermissions if present
  if (removedPermissions.value[permissionHash]) {
    delete removedPermissions.value[permissionHash];
    return;
  }

  // Remove permission from addedPermissions if present
  if (permissionsHash.value.has(permissionHash)) {
    selectedPermissionsHash.value.delete(permissionHash);
    removedPermissions.value[permissionHash] = {
      object,
      permission: permission,
    };

    return;
  }

  // Remove permission from addedPermissions if present
  if (addedPermissions.value[permissionHash]) {
    selectedPermissionsHash.value.delete(permissionHash);
    delete addedPermissions.value[permissionHash];
    return;
  }
};

const updateTableData = async (value: string = filter.value.permissions) => {
  filter.value.permissions = value;

  await nextTick();

  setTimeout(() => {
    updatePermissionVisibility(permissionsState.permissions);
    countVisibleResources(permissionsState.permissions);
  }, 0);
};

const updatePermissionsUi = async (value: string) => {
  permissionsUiType.value = value;
  if (value === "json") {
    const permissions: {
      object: string;
      permission: string;
    }[] = [];
    selectedPermissionsHash.value.forEach((permission: any) => {
      const [resource, entity, _permission] = permission.split(":");
      permissions.push({
        object: `${resource}:${entity}`,
        permission: _permission,
      });
    });

    permissionsJsonValue.value = JSON.stringify(permissions);
    permissionJsonEditorRef.value.setValue(permissionsJsonValue.value);
    await nextTick();
    permissionJsonEditorRef.value.formatDocument();
  } else if (value === "table") {
    updateJsonInTable();
  }
};

const updateJsonInTable = () => {
  const permissions = JSON.parse(permissionsJsonValue.value);

  const permissionsHash = new Set(permissions.map((p: any) => p.object + ":" + p.permission));
  let hash = "";
  let permission;
  let resource = "";
  let entity = "";
  let resourceDetails: Entity | Resource;

  // Update added permissions
  updateRolePermissions(permissions);

  permissions.forEach((permission: any) => {
    [resource, entity] = permission.object.split(":");
    hash = permission.object + ":" + permission.permission;
    if (!selectedPermissionsHash.value.has(hash)) {
      updatePermissionMappings(hash);

      resourceDetails = resourceMapper.value[resource];

      if (resource === "dashboard") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["dfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (resource === "alert") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["afolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (resource === "report") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["rfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (resource === "synthetics") {
        // Plain-id entity — locate the folder whose loaded monitors contain it.
        resourceDetails = resourceMapper.value["synthetic_folder"].entities.find((f: Entity) =>
          (f.entities ?? []).some((e: Entity) => e.name === entity),
        ) as Entity;
      } else if (entity === "_all_" + getOrgId()) {
        resourceDetails.permission[permission.permission as "AllowAll"].value =
          selectedPermissionsHash.value.has(
            getPermissionHash(resource, permission.permission, entity),
          );
      } else if (
        resource === "logs" ||
        resource === "metrics" ||
        resource === "traces" ||
        resource === "index"
      ) {
        resourceDetails = resourceMapper.value["stream"].entities.find(
          (e: Entity) => e.name === resource,
        ) as Entity;
      }

      updateEntityPermission(resourceDetails, resource, entity, permission.permission);
    }
  });

  // Update removed permissions
  selectedPermissionsHash.value.forEach(async (permissionHash: any) => {
    permission = permissionHash.split(":");
    resource = permission[0];
    entity = permission[1];
    permission = {
      object: permission[0] + ":" + permission[1],
      permission: permission[2] as "AllowAll",
    };

    if (!permissionsHash.has(permissionHash)) {
      updatePermissionMappings(permissionHash);

      resourceDetails = resourceMapper.value[resource];

      if (resource === "dashboard") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["dfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (resource === "alert") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["afolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (resource === "synthetics") {
        // Plain-id entity — locate the folder whose loaded monitors contain it.
        resourceDetails = resourceMapper.value["synthetic_folder"].entities.find((f: Entity) =>
          (f.entities ?? []).some((e: Entity) => e.name === entity),
        ) as Entity;
      } else if (resource === "report") {
        const [folderId] = entity.split("/");

        resourceDetails = resourceMapper.value["rfolder"].entities.find(
          (e: Entity) => e.name === folderId,
        ) as Entity;
      } else if (entity === "_all_" + getOrgId()) {
        resourceDetails.permission[permission.permission as "AllowAll"].value =
          selectedPermissionsHash.value.has(
            getPermissionHash(resource, permission.permission, entity),
          );
      } else if (
        resource === "logs" ||
        resource === "metrics" ||
        resource === "traces" ||
        resource === "index"
      ) {
        resourceDetails = resourceMapper.value["stream"].entities.find(
          (e: Entity) => e.name === resource,
        ) as Entity;
      }

      updateEntityPermission(resourceDetails, resource, entity, permission.permission);
    }
  });
};

const countVisibleResources = (permissions: (Resource | Entity)[]): number => {
  let count = 0;

  permissions.forEach((permission: Entity | Resource) => {
    if (permission.show) {
      count += 1;
    }

    // Recursively count in nested entities only when the parent row is expanded
    if (permission.entities?.length && permission.expand) {
      count += countVisibleResources(permission.entities);
    }
  });

  countOfVisibleResources.value = count;
  return count;
};

const updatePermissionVisibility = (
  permissions: (Resource | Entity)[],
  forceShow: boolean = false,
  level: number = 0,
  relations: string[] = [],
): void => {
  permissions.forEach((permission: Entity | Resource) => {
    // Check if any permission value is true

    const parentRelations = [...relations];

    if (permission.type === "Type") parentRelations.push(permission.resourceName);

    const showResource = Object.values(permission.permission).some(
      (permDetail) => permDetail.value,
    );

    let isResourceFiltered = true;

    if (filter.value.resource) isResourceFiltered = parentRelations.includes(filter.value.resource);

    if (filter.value.value) {
      isResourceFiltered =
        isResourceFiltered &&
        (permission.display_name || permission.name)
          .toLowerCase()
          .includes(filter.value.value.toLowerCase());
    }

    permission.show =
      filter.value.permissions === "all" ? isResourceFiltered : showResource && isResourceFiltered;

    if (forceShow) permission.show = true;

    // Recursively update the show property for entities
    if (!permission.entities?.length) return;

    if (
      permission.name === "logs" ||
      permission.name === "metrics" ||
      permission.name === "traces" ||
      permission.name === "index"
    ) {
      updatePermissionVisibility(
        heavyResourceEntities.value[permission.name] || [],
        permission.show,
        level + 1,
        parentRelations,
      );
    } else {
      if (permission.entities?.length)
        updatePermissionVisibility(
          permission.entities || [],
          permission.show,
          level + 1,
          parentRelations,
        );
    }

    let filteredEntities: Entity[] = [];

    if (
      permission.name === "logs" ||
      permission.name === "metrics" ||
      permission.name === "traces" ||
      permission.name === "index"
    ) {
      filteredEntities =
        heavyResourceEntities.value[permission.name]?.filter((entity: any) => entity.show) || [];
    } else {
      filteredEntities = permission.entities?.filter((entity) => entity.show) || [];
    }

    // Update the permission object to add `show` property

    // If we need to show child by default show parent

    if (filteredEntities?.length) {
      permission.show = true;
    }

    if (
      permission.show &&
      (permission.name === "logs" ||
        permission.name === "metrics" ||
        permission.name === "traces" ||
        permission.name === "index")
    ) {
      permission.entities =
        filter.value.permissions === "all"
          ? [...filteredEntities.slice(0, 50)]
          : [...filteredEntities];
    }

    filteredEntities.length = 0;
  });
};

// const updateFilteredPermissions = (
//   permissions: (Resource | Entity)[]
// ): void => {
//   permissions.forEach((permission: Entity | Resource) => {
//     // Check if any permission value is true
//     const showResource = Object.values(permission.permission).some(
//       (permDetail) => permDetail.value
//     );

//     // Recursively update the show property for entities
//     if (permission.entities?.length) {
//       updatePermissionVisibility(permission.entities);
//     }

//     const filteredEntities = permission.entities?.filter(
//       (entity) => entity.show
//     );

//     // Update the permission object to add `show` property

//     let isResourceFiltered = true;
//     if (filter.value.resource)
//       isResourceFiltered = filter.value.resource === permission.resourceName;

//     if (filter.value.value) {
//       isResourceFiltered =
//         isResourceFiltered &&
//         (permission.display_name || permission.name)
//           .toLowerCase()
//           .includes(filter.value.value.toLowerCase());
//     }

//     // If we need to show child by default show parent
//     if (filteredEntities) {
//       permission.entities = [...filteredEntities];
//     } else {
//       permission.show =
//         filter.value.permissions === "all"
//           ? isResourceFiltered
//           : showResource && isResourceFiltered;
//     }
//   });
// };

const onResourceChange = async () => {
  updatePermissionVisibility(permissionsState.permissions);
  countVisibleResources(permissionsState.permissions);
};

const onClearFilter = () => {
  filter.value.value = "";
  filter.value.resource = "";
  onResourceChange();
};

function filterResources(rows: any, terms: any) {
  var filtered = [];
  terms = terms.toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    let isAdded = false;
    if (rows[i]["display_name"].toLowerCase().includes(terms)) {
      filtered.push(rows[i]);
      isAdded = true;
      continue;
    }
    for (var j = 0; j < rows[i].entities.length; j++) {
      if (!isAdded && rows[i].entities[j]["display_name"].toLowerCase().includes(terms)) {
        filtered.push(rows[i]);
        break;
      }
    }
  }
  return filtered;
}

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

const getPermissionHash = (resourceName: string, permission: string, entity?: string) => {
  if (!entity) entity = "_all_" + store.state.selectedOrganization.identifier;

  return `${resourceName}:${entity}:${permission}`;
};

/**
 *
 * @param resource
 * @param typeOf - Type to assign the new entities that we get from the server
 */
const getResourceEntities = (resource: Resource | Entity) => {
  if (!resource) return Promise.resolve(true);

  const listEntitiesFnMap: {
    [key: string]: (resource: Resource | Entity) => Promise<any>;
  } = {
    stream: getStreamsTypes,
    stream_type: getStreamsTypes,
    logs: getLogs,
    metrics: getMetrics,
    traces: getTraces,
    index: getIndexStreams,
    alert: getAlerts,
    template: getTemplates,
    destination: getDestinations,
    pipeline: getPipelines,
    enrichment_table: getEnrichmentTables,
    function: getFunctions,
    org: getOrgs,
    savedviews: getSavedViews,
    group: _getGroups,
    role: _getRoles,
    dfolder: getFolders,
    dashboard: getDashboards,
    metadata: getMetadataStreams,
    report: getReports,
    service_accounts: getServiceAccounts,
    action_scripts: getActionScripts,
    cipher_keys: getCipherKeys,
    afolder: getAlertFolders,
    rfolder: getReportFolders,
    synthetic_folder: getSyntheticsFolders,
    synthetics: getSynthetics,
    re_patterns: getRePatterns,
    provider: getProviders,
    score_config: getScoreConfigs,
    scorer: getScorers,
    eval_job: getEvalJobs,
    logs_pattern: getLogsPatternStreams,
    logs_insights: getLogsInsightsStreams,
    logs_cache: getLogsCacheStreams,
  };

  return new Promise((resolve, reject) => {
    (async () => {
      try {
        if (!resource.entities?.length) {
          resource.is_loading = true;
          try {
            const listEntities = resource.childName
              ? listEntitiesFnMap[resource.childName]
              : listEntitiesFnMap[resource.resourceName];

            if (listEntities) {
              await listEntities(resource);
            }
          } finally {
            resource.is_loading = false;
          }

          // unncecessaryly we are updating the all resource entities, fix to update the current resource
          updatePermissionVisibility(permissionsState.permissions);
        }

        resolve(true);
      } catch (err) {
        reject(err);
      }
    })();
  });
};

const getEnrichmentTables = async () => {
  const data: any = await getStreams("enrichment_tables", false);

  updateResourceEntities("enrichment_table", ["name"], data.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getDashboards = async (resource: Entity | Resource) => {
  let dashboards: any = await dashboardService.list(
    0,
    10000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier,
    resource.name,
    "",
  );

  updateEntityEntities(
    resource,
    ["dashboardId"],
    [
      ...dashboards.data.dashboards.map(
        (dash: any) => Object.values(dash).filter((dash) => dash)[0],
      ),
    ],
    false,
    "title",
  );

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getOrgs = async () => {
  const orgs = await organizationsService.list(0, 100000, "name", false, "");

  updateResourceEntities("org", ["identifier"], [...orgs.data.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getSavedViews = async () => {
  const savedViews = await savedviewsService.get(store.state.selectedOrganization.identifier);
  updateResourceEntities("savedviews", ["view_id"], [...savedViews.data.views], false, "view_name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getFolders = async () => {
  const folders: any = await dashboardService.list_Folders(
    store.state.selectedOrganization.identifier,
  );

  let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

  if (!isDefaultPresent) {
    folders.data.list.unshift({ folderId: "default", name: "default" });
  }

  updateResourceEntities(
    "dfolder",
    ["folderId"],
    [...folders.data.list],
    true,
    "name",
    "dashboard",
  );
  return new Promise((resolve) => {
    resolve(true);
  });
};
const getAlertFolders = async () => {
  //this is exaclty same as getFolders, but we are using different endpoint
  const folders: any = await commonService.list_Folders(
    store.state.selectedOrganization.identifier,
    "alerts",
  );

  let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

  if (!isDefaultPresent) {
    folders.data.list.unshift({ folderId: "default", name: "default" });
  }

  updateResourceEntities("afolder", ["folderId"], [...folders.data.list], true, "name", "alert");
  return new Promise((resolve) => {
    resolve(true);
  });
};
const getSyntheticsFolders = async () => {
  // Same shape as getAlertFolders — synthetics folders live under folder type "synthetics".
  const folders: any = await commonService.list_Folders(
    store.state.selectedOrganization.identifier,
    "synthetics",
  );

  let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

  if (!isDefaultPresent) {
    folders.data.list.unshift({ folderId: "default", name: "default" });
  }

  updateResourceEntities(
    "synthetic_folder",
    ["folderId"],
    [...folders.data.list],
    true,
    "name",
    "synthetics",
  );
  return new Promise((resolve) => {
    resolve(true);
  });
};
const getSynthetics = async (resource: Entity | Resource) => {
  // Monitors of one folder. Unlike alerts, synthetics FGA entities are plain
  // monitor ids (no folder prefix) — matches backend set_ownership objects.
  const res: any = await syntheticsService.listByFolderId(
    store.state.selectedOrganization.identifier,
    resource.name,
  );

  updateEntityEntities(resource, ["id"], [...(res.data?.monitors ?? [])], false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};
const _getGroups = async () => {
  const groups = await getGroups(store.state.selectedOrganization.identifier);
  updateResourceEntities("group", [], [...groups.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const _getRoles = async () => {
  const roles = await getRoles(store.state.selectedOrganization.identifier);
  updateResourceEntities("role", [], [...roles.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getFunctions = async () => {
  const functions = await jsTransformService.list(
    1,
    100000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier,
  );

  updateResourceEntities("function", ["name"], [...functions.data.list]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getDestinations = async () => {
  const destinations = await destinationService.list({
    sort_by: "name",
    org_identifier: store.state.selectedOrganization.identifier,
  });

  updateResourceEntities("destination", ["name"], [...destinations.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getTemplates = async () => {
  const templates = await templateService.list({
    org_identifier: store.state.selectedOrganization.identifier,
  });

  updateResourceEntities("template", ["name"], [...templates.data]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getPipelines = async () => {
  const pipelines = await pipelineService.getPipelines(store.state.selectedOrganization.identifier);

  updateResourceEntities("pipeline", ["pipeline_id"], [...pipelines.data.list], false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getAlerts = async (resource: Entity | Resource) => {
  let alerts: any = await alertService.listByFolderId(
    0,
    10000,
    "name",
    false,
    "",
    store.state.selectedOrganization.identifier,
    resource.name,
    "",
  );

  updateEntityEntities(resource, ["alertId"], [...alerts.data.list], false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getLogs = async (resource: Resource | Entity) => {
  const logs: any = await getStreams("logs", false);

  updateEntityEntities(resource, ["name"], logs.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getLogsPatternStreams = async () => {
  const logs: any = await getStreams("logs", false);

  updateResourceEntities("logs_pattern", ["name"], logs.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getLogsInsightsStreams = async () => {
  const logs: any = await getStreams("logs", false);

  updateResourceEntities("logs_insights", ["name"], logs.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getLogsCacheStreams = async () => {
  const logs: any = await getStreams("logs", false);

  updateResourceEntities("logs_cache", ["name"], logs.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getIndexStreams = async (resource: Resource | Entity) => {
  const indices: any = await getStreams("index", false);

  updateEntityEntities(resource, ["name"], indices.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getMetrics = async (resource: Resource | Entity) => {
  const metrics: any = await getStreams("metrics", false);

  updateEntityEntities(resource, ["name"], metrics.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getTraces = async (resource: Resource | Entity) => {
  const traces: any = await getStreams("traces", false);

  updateEntityEntities(resource, ["name"], traces.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getMetadataStreams = async () => {
  const metadata: any = await getStreams("metadata", false);

  updateResourceEntities("metadata", ["name"], metadata.list);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getActionScripts = async () => {
  const actionScripts = await actions.list(store.state.selectedOrganization.identifier);

  updateResourceEntities("action_scripts", ["id"], [...actionScripts.data], false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getStreamsTypes = async () => {
  const streams = [
    { stream_type: "logs", name: "Logs" },
    { stream_type: "traces", name: "Traces" },
    { stream_type: "metrics", name: "Metrics" },
    { stream_type: "index", name: "Indices" },
  ];

  streams.forEach((stream) => {
    updateResourceResource(stream.stream_type, "stream", ["stream_type"], [stream], true, "name");
  });

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getReportFolders = async () => {
  const folders: any = await commonService.list_Folders(
    store.state.selectedOrganization.identifier,
    "reports",
  );

  let isDefaultPresent = folders.data.list.find((folder: any) => folder.folderId === "default");

  if (!isDefaultPresent) {
    folders.data.list.unshift({ folderId: "default", name: "default" });
  }

  updateResourceEntities("rfolder", ["folderId"], [...folders.data.list], true, "name", "report");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getReports = async (resource: Entity | Resource) => {
  const reports: any = await reportService.listByFolderId(
    store.state.selectedOrganization.identifier,
    resource.name,
  );

  updateEntityEntities(
    resource,
    ["report_id"],
    [...(reports.data.list ?? reports.data)],
    false,
    "name",
  );

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getServiceAccounts = async () => {
  const accounts = await serviceAccountService.list(store.state.selectedOrganization.identifier);

  updateResourceEntities("service_accounts", ["email"], accounts.data.data);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getCipherKeys = async () => {
  const data: any = await cipherKeysService.list(store.state.selectedOrganization.identifier);

  updateResourceEntities("cipher_keys", ["name"], [...data.data.keys]);

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getRePatterns = async () => {
  const data: any = await RePatternsService.list(store.state.selectedOrganization.identifier);

  updateResourceEntities("re_patterns", ["id"], [...data.data.patterns], false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getProviders = async () => {
  const providers = await onlineEvalsService.providers.list(
    store.state.selectedOrganization.identifier,
  );

  updateResourceEntities("provider", ["id"], providers, false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getScoreConfigs = async () => {
  const scoreConfigs = await onlineEvalsService.scoreConfigs.list(
    store.state.selectedOrganization.identifier,
  );

  updateResourceEntities(
    "score_config",
    ["entityId"],
    scoreConfigs.map((scoreConfig: any) => ({
      ...scoreConfig,
      entityId: scoreConfig.entityId ?? scoreConfig.entity_id ?? scoreConfig.id,
    })),
    false,
    "name",
  );

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getScorers = async () => {
  const scorers = await onlineEvalsService.scorers.list(
    store.state.selectedOrganization.identifier,
  );

  updateResourceEntities(
    "scorer",
    ["entityId"],
    scorers.map((scorer: any) => ({
      ...scorer,
      entityId: scorer.entityId ?? scorer.entity_id ?? scorer.id,
    })),
    false,
    "name",
  );

  return new Promise((resolve) => {
    resolve(true);
  });
};

const getEvalJobs = async () => {
  const evalJobs = await onlineEvalsService.jobs.list(store.state.selectedOrganization.identifier);

  updateResourceEntities("eval_job", ["id"], evalJobs, false, "name");

  return new Promise((resolve) => {
    resolve(true);
  });
};

const updateEntityEntities = (
  entity: Entity | Resource,
  entityNameKeys: string[],
  data: any[],
  hasEntities: boolean = false,
  displayNameKey?: string,
) => {
  if (!entity) return;

  const entities: Entity[] = data.map((_entity: any) => {
    let entityName = "";
    if (typeof _entity === "string") entityName = _entity;

    if (typeof _entity === "object") {
      entityName = entityNameKeys.reduce((acc, curr) => {
        return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
      }, "");

      if (entity.childName === "dashboard") {
        entityName = entity["name"] + "/" + _entity["dashboardId"];
      }
      if (entity.childName === "alert") {
        entityName = entity["name"] + "/" + _entity["alert_id"];
      }
      if (entity.childName === "report") {
        entityName = entity["name"] + "/" + _entity["report_id"];
      }
    }

    return {
      name: entityName,
      permission: {
        AllowAll: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowAll", entityName),
          ),
          show: true,
        },
        AllowGet: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowGet", entityName),
          ),
          show: true,
        },
        AllowDelete: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowDelete", entityName),
          ),
          show: true,
        },
        AllowPut: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowPut", entityName),
          ),
          show: true,
        },
        AllowList: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowList", entityName),
          ),
          show: hasEntities,
        },
        AllowPost: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(entity.childName as string, "AllowPost", entityName),
          ),
          show: hasEntities,
        },
      },
      entities: [],
      type: "Resource",
      resourceName: entity.childName as string,
      has_entities: hasEntities,
      display_name: displayNameKey ? _entity[displayNameKey] : entityName,
      show: true,
      top_level: false,
    };
  });

  if (
    entity.name === "logs" ||
    entity.name === "metrics" ||
    entity.name === "traces" ||
    entity.name === "index"
  ) {
    heavyResourceEntities.value[entity.name] = [...entities];
    if (entity.entities) entity.entities.push(...entities.slice(0, 50));
  } else {
    if (entity.entities) entity.entities.push(...entities);
  }
};

const updateResourceEntities = (
  resourceName: string,
  entityNameKeys: string[],
  data: any[],
  hasEntities: boolean = false,
  displayNameKey?: string,
  childName?: string,
) => {
  const resource: Resource | null | undefined = getResourceByName(
    permissionsState.permissions,
    resourceName,
  );

  if (!resource) return;

  data.forEach((_entity: any) => {
    let entityName = "";
    if (typeof _entity === "string") entityName = _entity;

    if (typeof _entity === "object") {
      entityName = entityNameKeys.reduce((acc, curr) => {
        return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
      }, "");
    }

    resource.entities.push({
      name: entityName,
      permission: {
        AllowAll: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowAll", entityName),
          ),
          show: true,
        },
        AllowGet: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowGet", entityName),
          ),
          show: true,
        },
        AllowDelete: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowDelete", entityName),
          ),
          show: true,
        },
        AllowPut: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowPut", entityName),
          ),
          show: true,
        },
        AllowList: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowList", entityName),
          ),
          show: hasEntities,
        },
        AllowPost: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(resourceName, "AllowPost", entityName),
          ),
          show: hasEntities,
        },
      },
      entities: [],
      type: "Resource",
      resourceName: resourceName,
      has_entities: hasEntities,
      display_name: displayNameKey ? _entity[displayNameKey] : entityName,
      show: true,
      childName: childName || "",
      top_level: !!resource.childs.find((child) => child.name === childName)?.top_level,
    });
    // Hide non-applicable permissions for logs_pattern and logs_insights entities
    if (resourceName === "logs_pattern" || resourceName === "logs_insights") {
      const entity = resource.entities[resource.entities.length - 1];
      entity.permission.AllowList.show = false;
      entity.permission.AllowDelete.show = false;
      entity.permission.AllowPost.show = false;
      entity.permission.AllowPut.show = false;
    }
    // Hide non-applicable permissions for logs_cache entities (only All and Delete)
    if (resourceName === "logs_cache") {
      const entity = resource.entities[resource.entities.length - 1];
      entity.permission.AllowList.show = false;
      entity.permission.AllowGet.show = false;
      entity.permission.AllowPost.show = false;
      entity.permission.AllowPut.show = false;
    }
  });
};

const updateResourceResource = (
  resourceName: string,
  parentResourceName: string,
  entityNameKeys: string[],
  data: any[],
  hasEntities: boolean = false,
  displayNameKey?: string,
) => {
  const resource: Resource | null | undefined = getResourceByName(
    permissionsState.permissions,
    parentResourceName,
  );

  if (!resource) return;

  data.forEach((_entity: any) => {
    let entityName = "";
    if (typeof _entity === "string") entityName = _entity;

    if (typeof _entity === "object") {
      entityName = entityNameKeys.reduce((acc, curr) => {
        return acc ? acc + "/" + (_entity[curr] || curr) : _entity[curr];
      }, "");
    }

    resource.entities.push({
      name: entityName,
      permission: {
        AllowAll: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowAll",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: true,
        },
        AllowGet: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowGet",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: true,
        },
        AllowDelete: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowDelete",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: true,
        },
        AllowPut: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowPut",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: true,
        },
        AllowList: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowList",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: hasEntities,
        },
        AllowPost: {
          value: selectedPermissionsHash.value.has(
            getPermissionHash(
              resourceName,
              "AllowPost",
              "_all_" + store.state.selectedOrganization.identifier,
            ),
          ),
          show: hasEntities,
        },
      },
      entities: [],
      type: "Type",
      resourceName: resourceName,
      has_entities: hasEntities,
      childName: resourceName,
      display_name: displayNameKey ? _entity[displayNameKey] : entityName,
      show: true,
      top_level: true,
    });
  });
};

const saveRole = () => {
  if (permissionsUiType.value === "json") updateJsonInTable();

  // Users and service accounts are both sent as users; merge the two staging
  // sets (dedup via Set) for the request payload.
  const payload = {
    add: Object.values(addedPermissions.value),
    remove: Object.values(removedPermissions.value),
    add_users: Array.from(
      new Set([...addedUsers.value, ...addedServiceAccounts.value]),
    ) as string[],
    remove_users: Array.from(
      new Set([...removedUsers.value, ...removedServiceAccounts.value]),
    ) as string[],
  };

  if (
    !(
      payload.add.length ||
      payload.remove.length ||
      payload.add_users.length ||
      payload.remove_users.length
    )
  ) {
    toast({
      variant: "info",
      message: t("iam.editRole.noUpdatesDetected"),
    });

    return;
  }

  updateRole({
    role_id: editingRole.value,
    org_identifier: store.state.selectedOrganization.identifier,
    payload,
  })
    .then(async () => {
      // combine permissionsHash and selectedPermissionsHash

      toast({
        variant: "success",
        message: t("iam.editRole.updateSuccess"),
      });

      // Resetting permissions state on save

      Object.keys(removedPermissions.value).forEach((permission) => {
        if (permissionsHash.value.has(permission)) permissionsHash.value.delete(permission);

        if (selectedPermissionsHash.value.has(permission))
          selectedPermissionsHash.value.delete(permission);
      });

      permissionsHash.value = new Set([
        ...Array.from(permissionsHash.value),
        ...Array.from(selectedPermissionsHash.value),
      ]);

      selectedPermissionsHash.value = cloneDeep(permissionsHash.value);

      addedPermissions.value = {};

      removedPermissions.value = {};

      roleUsers.value = roleUsers.value.filter(
        (user) => !removedUsers.value.has(user) && !removedServiceAccounts.value.has(user),
      );

      addedUsers.value.forEach((value: any) => {
        roleUsers.value.push(value);
      });

      addedServiceAccounts.value.forEach((value: any) => {
        roleUsers.value.push(value);
      });

      addedUsers.value = new Set([]);

      removedUsers.value = new Set([]);

      addedServiceAccounts.value = new Set([]);

      removedServiceAccounts.value = new Set([]);
    })
    .catch((err) => {
      if (err.response.status != 403) {
        toast({
          variant: "error",
          message: t("iam.editRole.updateError"),
        });
      }
      console.log(err);
    });
};

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

const toggleHelpSection = async () => {
  isHelpOpen.value = !isHelpOpen.value;

  await nextTick();
  await nextTick();

  permissionJsonEditorRef.value.resetEditorLayout();
};
</script>
