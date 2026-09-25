// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, watch, type ComputedRef, type Ref } from "vue";
import { raw, type I18nText } from "@/types/i18n";
import { buildGrantKey, splitGrantKey } from "@/composables/iam/useRoleGrants";
import { STREAM_PARENT_KEY, type RoleModule } from "@/components/iam/roles/roleModules";
import type { RailModule } from "@/components/iam/roles/ModuleRail.vue";
import type { PendingChange } from "@/components/iam/roles/UnsavedChangesDrawer.vue";
import type { SummaryAction, SummaryModule } from "@/components/iam/roles/RoleSummary.vue";
import type { Resource, Entity } from "@/ts/interfaces";

type SummaryDeps = {
  /** Every grant the checkboxes show, saved or staged. */
  selectedPermissionsHash: Ref<Set<string>>;
  addedPermissions: Ref<Record<string, unknown>>;
  removedPermissions: Ref<Record<string, unknown>>;
  permissionsState: { resources: any[] };
  resourceMapper: Ref<{ [key: string]: Resource }>;
  heavyResourceEntities: Ref<{ [key: string]: Entity[] }>;
  roleModules: ComputedRef<RoleModule[]>;
  railModules: ComputedRef<RailModule[]>;
  /** Closed here once nothing is left to review. */
  unsavedDrawerOpen: Ref<boolean>;
  resourceLabel: (key: string) => string;
  moduleLabel: (key: string) => I18nText;
  getOrgId: () => string;
  t: (key: string, named?: Record<string, unknown>, plural?: number) => I18nText;
  ACTION_ORDER: readonly string[];
  ACTION_LABEL_KEYS: Readonly<Record<string, string>>;
};

/** What the role grants, per module, and every change staged since it loaded. */
export const useRoleSummary = (deps: SummaryDeps) => {
  const {
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
  } = deps;

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
        ([entity, grants]) =>
          [entity, grants.filter((grant) => grant.state !== "removed")] as const,
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

  return {
    resourceParent,
    entityLabel,
    grantsByResource,
    isWideEntity,
    summaryActions,
    knownTotal,
    heldGrants,
    actionsOf,
    specificReach,
    moduleDescription,
    summaryModules,
    pendingChanges,
  };
};
