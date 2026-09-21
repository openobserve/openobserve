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
import { computed, defineAsyncComponent, nextTick, ref, watch, type Ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { Resource, Entity, Permission } from "@/ts/interfaces";
import { useStore } from "vuex";
import usePermissions from "@/composables/iam/usePermissions";
import useRoleGrants, { buildGrantKey, splitGrantKey } from "@/composables/iam/useRoleGrants";
import ModuleRail, { type RailModule } from "@/components/iam/roles/ModuleRail.vue";
import ModulePane, { type ScopeRow } from "@/components/iam/roles/ModulePane.vue";
import PermissionsViewSwitch from "@/components/iam/roles/PermissionsViewSwitch.vue";
import UnsavedChangesDrawer, {
  type PendingChange,
} from "@/components/iam/roles/UnsavedChangesDrawer.vue";
import RoleSummary, {
  type SummaryAction,
  type SummaryModule,
} from "@/components/iam/roles/RoleSummary.vue";
import {
  buildRoleModules,
  GROUP_LABEL_KEYS,
  STREAM_PARENT_KEY,
} from "@/components/iam/roles/roleModules";
import { useRouter, onBeforeRouteLeave } from "vue-router";
import { onBeforeMount } from "vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { getAllRolePermissions, getRoleUsers } from "@/services/iam";
import { useRoleEntityLoaders } from "@/composables/iam/useRoleEntityLoaders";
import { useRolePermissionRows } from "@/composables/iam/useRolePermissionRows";
import { useSavedGrantExpansion } from "@/composables/iam/useSavedGrantExpansion";
import useStreams from "@/composables/useStreams";
import GroupUsers from "../groups/GroupUsers.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import GroupServiceAccounts from "../groups/GroupServiceAccounts.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

import {
  DBM_MODULE_RESOURCE,
  DBM_VIEWER_STREAM_ROW_PERMS,
  DBM_VIEWER_STREAMS,
  DBM_VIEWER_TYPE_NODE_PERMS,
} from "./dbmViewerPreset";
import {
  K8S_VIEWER_STREAM_ROW_PERMS,
  K8S_VIEWER_STREAMS,
  K8S_VIEWER_TYPE_NODE_PERMS,
} from "./k8sViewerPreset";

// db_monitoring is checked as a plain GET (never LIST), and has no child
// entities for a wildcard relation to reach — unlike the `metrics` type node,
// AllowGet on it grants nothing beyond the module itself.
const DBM_MODULE_PERMS = ["AllowList", "AllowGet"] as const;

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

const typeScope = (resourceKey: string, node: any): ScopeRow => ({
  key: resourceKey,
  node,
  resource: resourceKey,
  covers: [resourceKey],
  label: t("iam.editRole.scopeAllOf", { module: node?.display_name ?? resourceLabel(resourceKey) }),
  hint: t("iam.editRole.scopeIncludesFuture"),
});

const everyStreamScope = (covers: string[]): ScopeRow => ({
  key: STREAM_PARENT_KEY,
  node: resourceMapper.value[STREAM_PARENT_KEY],
  resource: STREAM_PARENT_KEY,
  covers,
  label: t("iam.editRole.scopeEveryStream"),
  hint: t("iam.editRole.scopeEveryStreamHint"),
});

// Stream types are type rows under the `stream` node, so they are the rows the Streams module lists.
const streamTypeKeys = () =>
  (resourceMapper.value[STREAM_PARENT_KEY]?.entities ?? []).map((entity: any) => entity.name);

const moduleScopes = (moduleKey: string): ScopeRow[] => {
  const node = resourceMapper.value[moduleKey];
  if (!node) return [];
  return moduleKey === STREAM_PARENT_KEY
    ? [everyStreamScope(streamTypeKeys())]
    : [typeScope(moduleKey, node)];
};

// A parent scope is edited on its own screen, so a drilled level hides it but still names it as the source of any lock.
const underHiddenParent = (parent: ScopeRow, parentModule: string, own: ScopeRow): ScopeRow[] => {
  const grantsAnything = ACTION_ORDER.some(
    (action) => parent.node && isGranted(parent.node, action),
  );
  return [
    { ...parent, hidden: true },
    grantsAnything
      ? {
          ...own,
          hint: t("iam.editRole.scopeCoveredByParent", {
            scope: parent.label,
            module: moduleLabel(parentModule),
          }),
        }
      : own,
  ];
};

// model.fga defines each action on a folder item as `... or <ACTION> from parent`, so a folder grant reaches its items.
const folderScopes = (moduleKey: string, folder: any): ScopeRow[] => {
  const [moduleScope] = moduleScopes(moduleKey);
  const items = folder.childName ? [folder.childName] : [];
  const thisFolder: ScopeRow = {
    key: `folder-${folder.name}`,
    node: folder,
    resource: moduleKey,
    covers: items,
    label: t("iam.editRole.scopeThisFolder"),
    hint: t("iam.editRole.scopeThisFolderHint"),
  };
  // The type level grant reaches every folder, and through each folder its items.
  return moduleScope
    ? underHiddenParent(
        { ...moduleScope, covers: [...moduleScope.covers, ...items] },
        moduleKey,
        thisFolder,
      )
    : [thisFolder];
};

// A stream type is an `_all_` scope in its own right, so everything beneath it inherits both rows.
const streamTypeScopes = (typeNode: any): ScopeRow[] =>
  underHiddenParent(
    everyStreamScope([typeNode.name]),
    STREAM_PARENT_KEY,
    typeScope(typeNode.name, typeNode),
  );

const activeModuleView = computed(() => {
  const module = moduleOf(activeModule.value);
  if (!module) return null;

  const title = moduleLabel(module.key);

  // An org-wide resource has no items, so its only row is its own grant.
  if (!module.hasEntities) {
    return {
      trail: [title],
      scopes: [] as ScopeRow[],
      entities: [resourceMapper.value[module.key]].filter(Boolean),
    };
  }

  const child = openFolder.value;
  if (child && module.key === STREAM_PARENT_KEY) {
    return {
      trail: [title, raw(child.display_name ?? child.name)],
      scopes: streamTypeScopes(child),
      entities: heavyResourceEntities.value[child.name] ?? [],
    };
  }

  if (child) {
    return {
      trail: [title, raw(child.display_name ?? child.name)],
      scopes: folderScopes(module.key, child),
      entities: child.entities ?? [],
    };
  }

  return {
    trail: [title],
    scopes: moduleScopes(module.key),
    entities: resourceMapper.value[module.key]?.entities ?? [],
  };
});

const openModule = async (moduleKey: string) => {
  openFolder.value = null;
  const module = moduleOf(moduleKey);
  if (!module || !module.hasEntities) return;

  loadingFor.value = moduleKey;
  try {
    await getResourceEntities(resourceMapper.value[module.key]);
  } finally {
    // Only the newest open clears the flag, or a slower module would hide the one on screen.
    if (loadingFor.value === moduleKey) loadingFor.value = "";
  }
};

watch(activeModule, openModule);

const openFolderRow = async (child: any) => {
  openFolder.value = child;
  // A stream type keeps its full list in heavyResourceEntities; its own `entities` is filter-shaped.
  if (activeModule.value === STREAM_PARENT_KEY && heavyResourceEntities.value[child.name]) return;

  loadingFor.value = child.name;
  try {
    await getResourceEntities(child);
  } finally {
    if (loadingFor.value === child.name) loadingFor.value = "";
  }
};

const navigateTrail = (index: number) => {
  if (index === 0) openFolder.value = null;
};

const resourceParent = (resource: string) =>
  permissionsState.resources.find((candidate: any) => candidate.key === resource)?.parent;

// Names come from entities the role load already fetched; an unloaded id shows as itself.
const entityLabel = (resource: string, entity: string) => {
  if (entity === `_all_${getOrgId()}`) {
    return resource === STREAM_PARENT_KEY
      ? t("iam.editRole.scopeEveryStream")
      : t("iam.editRole.scopeAllOf", { module: resourceLabel(resource) });
  }

  const parent = resourceParent(resource);
  const pools = [
    heavyResourceEntities.value[resource],
    resourceMapper.value[resource]?.entities,
    ...(parent ? (resourceMapper.value[parent]?.entities ?? []) : []).map(
      (folder: any) => folder.entities,
    ),
  ];
  for (const pool of pools) {
    const match = pool?.find((candidate: any) => candidate.name === entity);
    if (match) return raw(match.display_name ?? entity);
  }
  return raw(entity);
};

type GrantState = "saved" | "added" | "removed";

// resource -> entity -> grants, including staged removals so they stay reviewable until saved.
const grantsByResource = computed(() => {
  const byResource = new Map<string, Map<string, { action: string; state: GrantState }[]>>();
  const record = (key: string, state: GrantState) => {
    const { resource, entity, permission } = splitGrantKey(key);
    const byEntity = byResource.get(resource) ?? new Map();
    byEntity.set(entity, [...(byEntity.get(entity) ?? []), { action: permission, state }]);
    byResource.set(resource, byEntity);
  };
  selectedPermissionsHash.value.forEach((key: string) =>
    record(key, addedPermissions.value[key] ? "added" : "saved"),
  );
  Object.keys(removedPermissions.value).forEach((key) => record(key, "removed"));
  return byResource;
});

const isWideEntity = (entity: string) => entity === `_all_${getOrgId()}`;

const summaryActions = (actions: Iterable<string>): SummaryAction[] =>
  [...new Set(actions)]
    .sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b))
    .map((action) => ({
      action,
      label: t(ACTION_LABEL_KEYS[action as keyof typeof ACTION_LABEL_KEYS] ?? "iam.all"),
    }));

// Only a loaded list has a known size, so coverage reads "N of M" when it can and "N" otherwise.
const knownTotal = (resource: string): number | undefined =>
  heavyResourceEntities.value[resource]?.length ??
  (resourceMapper.value[resource]?.entities?.length || undefined);

const heldGrants = (resource: string) =>
  [...(grantsByResource.value.get(resource)?.entries() ?? [])]
    .map(
      ([entity, grants]) => [entity, grants.filter((grant) => grant.state !== "removed")] as const,
    )
    .filter(([, grants]) => grants.length);

const actionsOf = (held: ReturnType<typeof heldGrants>) =>
  summaryActions(held.flatMap(([, grants]) => grants.map((grant) => grant.action)));

// "N of M" when the list is loaded, a plain count otherwise.
const specificReach = (resource: string, count: number) => {
  const total = knownTotal(resource);
  return total
    ? t("iam.editRole.summaryReachSome", {
        count: count.toLocaleString(),
        total: total.toLocaleString(),
      })
    : t("iam.editRole.summaryGrantCount", { count }, count);
};

const moduleDescription = (moduleKey: string, countedKeys: string[]): I18nText => {
  const rootWide = heldGrants(moduleKey).some(([entity]) => isWideEntity(entity));
  if (rootWide) {
    return moduleKey === STREAM_PARENT_KEY
      ? t("iam.editRole.summaryReachEveryStream")
      : t("iam.editRole.summaryReachAllOf", { module: resourceLabel(moduleKey) });
  }

  const granted = countedKeys
    .map((key) => ({ key, held: heldGrants(key) }))
    .filter(({ held }) => held.length);
  if (granted.length !== 1) {
    return raw(granted.map(({ key }) => resourceLabel(key)).join(", "));
  }

  const [{ key, held }] = granted;
  const specific = held.filter(([entity]) => !isWideEntity(entity));
  return t("iam.editRole.summaryReachOne", {
    label: resourceLabel(key),
    reach: specific.length
      ? specificReach(key, specific.length)
      : t("iam.editRole.summaryReachAll"),
  });
};

const summaryModules = computed<SummaryModule[]>(() => {
  const heldResources = new Set(
    [...grantsByResource.value.keys()].filter((resource) => heldGrants(resource).length),
  );

  return roleModules.value
    .filter((module) => module.countedKeys.some((key) => heldResources.has(key)))
    .map((module) => {
      const rail = railModules.value.find((candidate) => candidate.key === module.key);
      return {
        moduleKey: module.key,
        label: rail?.label ?? moduleLabel(module.key),
        icon: module.icon,
        group: module.group,
        granted: rail?.granted ?? 0,
        description: moduleDescription(module.key, module.countedKeys),
        actions: actionsOf(module.countedKeys.flatMap((key) => heldGrants(key))),
      };
    });
});

const pendingChanges = computed<PendingChange[]>(() => {
  const changes: PendingChange[] = [];
  grantsByResource.value.forEach((byEntity, resource) => {
    byEntity.forEach((grants, entity) => {
      (["added", "removed"] as const).forEach((state) => {
        const ofState = grants.filter((grant) => grant.state === state);
        if (!ofState.length) return;
        changes.push({
          id: `${resource}-${entity}-${state}`,
          state,
          label: entityLabel(resource, entity),
          moduleLabel: raw(resourceLabel(resource)),
          actions: summaryActions(ofState.map((grant) => grant.action)),
          keys: ofState.map((grant) => buildGrantKey(resource, grant.action, entity)),
        });
      });
    });
  });
  return changes;
});
// Nothing left to review once the last change is undone, so the drawer gets out of the way.
watch(
  () => pendingChanges.value.length,
  (count) => {
    if (!count) unsavedDrawerOpen.value = false;
  },
);

const applyPreset = async (presetId: string) => {
  if (presetId === "readonly") seedReadonlyPreset();
  else if (presetId === "dbm") await seedDbmViewerPreset();
  else if (presetId === "k8s") await seedK8sViewerPreset();
};

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

// Seed AllowList + AllowGet on every visible top-level resource. Mirrors a
// user manually checking those two columns, so the changes flow through the
// normal added/removed-permission bookkeeping and the Save payload.
const seedReadonlyPreset = () => {
  const readonlyPerms = ["AllowList", "AllowGet"];
  permissionsState.permissions.forEach((resource: Resource) => {
    readonlyPerms.forEach((perm) => {
      const permDetail = resource.permission?.[perm as "AllowList"];
      // Held grants are the source of truth: `value` survives an undo and would make the preset a no-op.
      if (!permDetail || !permDetail.show || grants.has(permissionHashFor(resource, perm))) return;
      permDetail.value = true;
      handlePermissionChange(resource, perm);
    });
  });
};

const collectVisibleReadGrants = (row: Entity, perms: readonly (keyof Entity["permission"])[]) =>
  perms
    .filter((perm) => {
      const permDetail = row.permission?.[perm];
      return !!permDetail && permDetail.show && !grants.has(permissionHashFor(row, perm as string));
    })
    .map((perm) => ({ row, permission: perm as string, newValue: true }));

// Stream rows are lazily loaded CHILDREN of the `stream` resource, so both the
// `stream` node and its `metrics` child must be expanded (which fetches the
// org's streams) before any row exists to tick. `db_monitoring` is a separate,
// module-level toggle resource with no entities of its own — it is ticked
// directly off resourceMapper, no expand needed.
const seedDbmViewerPreset = async () => {
  const changes: { row: any; permission: string; newValue: boolean }[] = [];

  const dbMonitoringResource = resourceMapper.value[DBM_MODULE_RESOURCE];
  if (dbMonitoringResource) {
    changes.push(...collectVisibleReadGrants(dbMonitoringResource, DBM_MODULE_PERMS));
  }

  const streamResource = resourceMapper.value["stream"];
  let matched = 0;
  if (streamResource) {
    if (!streamResource.expand) await expandPermission(streamResource);

    const metricsEntity = streamResource.entities?.find(
      (entity: Entity) => entity.name === "metrics",
    );
    if (metricsEntity) {
      if (!metricsEntity.expand) await expandPermission(metricsEntity);

      // `metrics.entities` only holds rows visible under the current filter, so seeding off it would silently miss streams.
      const rows = heavyResourceEntities.value["metrics"] ?? [];
      const curated = new Set(DBM_VIEWER_STREAMS);
      const matchedRows = rows.filter((row: Entity) => curated.has(row.name));
      matched = matchedRows.length;
      changes.push(
        ...matchedRows.flatMap((row: Entity) =>
          collectVisibleReadGrants(row, DBM_VIEWER_STREAM_ROW_PERMS),
        ),
      );

      // GET /{org}/streams is checked against `metrics:_all_<org>`, never the per-stream objects, and FGA's LIST relation does not accept ALLOW_GET; ALLOW_GET here would instead wildcard every metric stream in the org, so the type node is LIST-only.
      if (matchedRows.length) {
        changes.push(...collectVisibleReadGrants(metricsEntity, DBM_VIEWER_TYPE_NODE_PERMS));
      }
    }
  }

  if (changes.length) {
    handlePermissionBatchChange(changes);
  }

  reportDbmViewerSeeding(matched, DBM_VIEWER_STREAMS.length);
};

const reportDbmViewerSeeding = (matched: number, total: number) => {
  toast(
    matched
      ? { variant: "info", message: t("iam.editRole.dbmPresetSeeded", { matched, total }) }
      : { variant: "warning", message: t("iam.editRole.dbmPresetNoMatch", { total }) },
  );
};

// Stream rows are lazily loaded CHILDREN of the `stream` resource, so both the `stream` node and its `metrics` child must be expanded (which fetches the org's streams) before any row exists to tick.
const seedK8sViewerPreset = async () => {
  const streamResource = resourceMapper.value["stream"];
  if (!streamResource) return;

  // expandPermission toggles, so only call it on a node that is still collapsed.
  if (!streamResource.expand) await expandPermission(streamResource);

  const metricsEntity = streamResource.entities?.find(
    (entity: Entity) => entity.name === "metrics",
  );
  if (!metricsEntity) return;

  if (!metricsEntity.expand) await expandPermission(metricsEntity);

  // `metrics.entities` only holds rows visible under the current filter, so seeding off it would silently miss streams.
  const rows = heavyResourceEntities.value["metrics"] ?? [];
  const curated = new Set(K8S_VIEWER_STREAMS);
  const matched = rows.filter((row: Entity) => curated.has(row.name));
  const changes = matched.flatMap((row: Entity) =>
    collectVisibleReadGrants(row, K8S_VIEWER_STREAM_ROW_PERMS),
  );

  // GET /{org}/streams is checked against `metrics:_all_<org>`, never the per-stream objects, and FGA's LIST relation does not accept ALLOW_GET; ALLOW_GET here would instead wildcard every metric stream in the org, so the type node is LIST-only.
  if (matched.length) {
    changes.push(...collectVisibleReadGrants(metricsEntity, K8S_VIEWER_TYPE_NODE_PERMS));
  }

  if (changes.length) {
    handlePermissionBatchChange(changes);
  }

  reportK8sViewerSeeding(matched.length, K8S_VIEWER_STREAMS.length);
};

const reportK8sViewerSeeding = (matched: number, total: number) => {
  toast(
    matched
      ? { variant: "info", message: t("iam.editRole.k8sPresetSeeded", { matched, total }) }
      : { variant: "warning", message: t("iam.editRole.k8sPresetNoMatch", { total }) },
  );
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
      } else if (resource === "workflows") {
        resourceDetails = resourceMapper.value["workflow_folder"].entities.find((f: Entity) =>
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
      } else if (resource === "workflows") {
        resourceDetails = resourceMapper.value["workflow_folder"].entities.find((f: Entity) =>
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

// Expanding saved grants onto the tree lives in its own file; it may fetch rows to do it.
const { updateRolePermissions } = useSavedGrantExpansion({
  permissionsState,
  decodePermission,
  getResourceByName,
  getResourceEntities,
  getOrgId,
});

const saveRole = () => {
  if (permissionsUiType.value === "json") updateJsonInTable();

  // Users and service accounts are both sent as users; merge the two staging
  // sets (dedup via Set) for the request payload.
  const payload = {
    ...grants.payload(),
    add_users: Array.from(
      new Set([...addedUsers.value, ...addedServiceAccounts.value]),
    ) as string[],
    remove_users: Array.from(
      new Set([...removedUsers.value, ...removedServiceAccounts.value]),
    ) as string[],
  };

  if (!(
    payload.add.length ||
    payload.remove.length ||
    payload.add_users.length ||
    payload.remove_users.length
  )) {
    toast({
      variant: "info",
      message: t("iam.editRole.noUpdatesDetected"),
    });

    return;
  }

  // Was: invalidate, then update — the refetch raced the write.
  updateRoleOne
    .mutateAsync({ role_id: editingRole.value, payload })
    .then(async () => {
      // combine permissionsHash and selectedPermissionsHash

      toast({
        variant: "success",
        message: t("iam.editRole.updateSuccess"),
      });

      // Resetting permissions state on save

      grants.commit();

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
