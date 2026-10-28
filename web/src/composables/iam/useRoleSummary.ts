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
import { getIntlLocale } from "@/locales";
import { buildGrantKey, splitGrantKey } from "@/composables/iam/useRoleGrants";
import { useRoleScopes } from "@/composables/iam/useRoleScopes";
import { moduleIcon, STREAM_PARENT_KEY, type RoleModule } from "@/components/iam/roles/roleModules";
import { findCompanionGaps, type CompanionGap } from "@/components/iam/roles/roleCompanions";
import type { RailModule } from "@/components/iam/roles/ModuleRail.vue";
import type { ScopeRow } from "@/components/iam/roles/ModulePane.vue";
import type { PendingChange, PendingGroup } from "@/components/iam/roles/UnsavedChangesDrawer.vue";
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
  /** Closed here once nothing is left to review and nothing is missing. */
  unsavedDrawerOpen: Ref<boolean>;
  resourceLabel: (key: string) => string;
  moduleLabel: (key: string) => I18nText;
  getOrgId: () => string;
  t: (key: string, named?: Record<string, unknown>, plural?: number) => I18nText;
  ACTION_ORDER: readonly string[];
  ACTION_LABEL_KEYS: Readonly<Record<string, string>>;
};

/** Group of a change whose resource is in no rail module, so it is still listed and undone. */
export const OTHER_MODULE_KEY = "other";

// A sentence per resource reads better than "{name} in {module}": `afolder:f1` -> "alerts in the f1 folder".
const TARGET_KEYS: Record<string, { all?: string; one: string }> = {
  afolder: {
    all: "iam.editRole.targetAlertsEveryFolder",
    one: "iam.editRole.targetAlertsInFolder",
  },
  alert: { one: "iam.editRole.targetOneAlert" },
  dfolder: {
    all: "iam.editRole.targetDashboardsEveryFolder",
    one: "iam.editRole.targetDashboardsInFolder",
  },
  dashboard: { one: "iam.editRole.targetOneDashboard" },
  rfolder: {
    all: "iam.editRole.targetReportsEveryFolder",
    one: "iam.editRole.targetReportsInFolder",
  },
  report: { one: "iam.editRole.targetOneReport" },
  destination: {
    all: "iam.editRole.targetEveryDestination",
    one: "iam.editRole.targetOneDestination",
  },
  template: { all: "iam.editRole.targetEveryTemplate", one: "iam.editRole.targetOneTemplate" },
};

// List results are filtered by per-item Get (alerts/destinations.rs, templates.rs), so List alone loads only the list.
const FILTERED_LISTS: Record<string, { can: string; cannot: string; note: string }> = {
  destination: {
    can: "iam.editRole.effectCanLoadDestinations",
    cannot: "iam.editRole.effectCannotLoadDestinations",
    note: "iam.editRole.noteDestinationsFiltered",
  },
  template: {
    can: "iam.editRole.effectCanLoadTemplates",
    cannot: "iam.editRole.effectCannotLoadTemplates",
    note: "iam.editRole.noteTemplatesFiltered",
  },
};

const WRITE_VERB_KEYS: [string, string][] = [
  ["AllowPost", "iam.editRole.verbCreate"],
  ["AllowPut", "iam.editRole.verbEdit"],
  ["AllowDelete", "iam.editRole.verbDelete"],
];

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

  // resource -> entity -> grants, staged removals included so they stay reviewable until saved: saved `logs:_all_default:AllowGet` + removed `metrics:_all_default:AllowGet` -> { logs: { _all_default: [{ AllowGet, saved }] }, metrics: { _all_default: [{ AllowGet, removed }] } }.
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

  // Held item grants per resource, built once per change so a row never rescans the whole grant set.
  const heldItemsByResource = computed(() => {
    const byResource = new Map<string, string[]>();
    grantsByResource.value.forEach((byEntity, resource) => {
      const held = [...byEntity.entries()]
        .filter(
          ([entity, grants]) => !isWideEntity(entity) && grants.some((g) => g.state !== "removed"),
        )
        .map(([entity]) => entity);
      if (held.length) byResource.set(resource, held);
    });
    return byResource;
  });

  // A drill-in row cannot show grants one level down, so it reports them; only the few names a tooltip shows are labelled.
  const innerGrants = (node: any, nameLimit: number): { count: number; names: string[] } => {
    if (!node?.has_entities || !node.childName) return { count: 0, names: [] };
    const prefix = `${node.name}/`;
    const loaded = new Map<string, string>(
      (node.entities ?? []).map((item: any) => [item.name, item.display_name ?? item.name]),
    );
    // Dashboard, alert and report ids carry their folder as `folderId/id`; synthetics, workflow and prompt ids are plain, so only the folder's loaded items place them.
    const inside = (heldItemsByResource.value.get(node.childName) ?? []).filter(
      (entity) => node.type === "Type" || entity.startsWith(prefix) || loaded.has(entity),
    );
    const names = inside.slice(0, nameLimit).map((entity) => {
      const label = loaded.get(entity) ?? String(entityLabel(node.childName, entity));
      return label === entity && entity.startsWith(prefix) ? entity.slice(prefix.length) : label;
    });
    return { count: inside.length, names };
  };

  // An All Modules row shows only the module-wide grant, so it reports every other grant the module holds: `logs:_all_` and `dashboard:f1/d1` both count.
  const moduleInnerGrants = (node: any, nameLimit: number): { count: number; names: string[] } => {
    const module = roleModules.value.find((candidate) => candidate.key === node?.name);
    if (!module) return { count: 0, names: [] };
    const inside = module.countedKeys.flatMap((resource) =>
      heldGrants(resource)
        .filter(([entity]) => resource !== module.key || !isWideEntity(entity))
        .map(([entity]) => ({ resource, entity })),
    );
    const names = inside
      .slice(0, nameLimit)
      .map(({ resource, entity }) => String(entityLabel(resource, entity)));
    return { count: inside.length, names };
  };

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
          added: rail?.added ?? 0,
          removed: rail?.removed ?? 0,
          description: moduleDescription(module.key, module.countedKeys),
          actions: actionsOf(module.countedKeys.flatMap((key) => heldGrants(key))),
        };
      });
  });

  // resource -> rail module, so `logs` reads under Streams and `alert` under Alert Folders.
  const moduleOfResource = computed(
    () =>
      new Map(
        roleModules.value.flatMap((module) =>
          module.countedKeys.map((key) => [key, module.key] as const),
        ),
      ),
  );

  const moduleKeyOf = (resource: string) =>
    moduleOfResource.value.get(resource) ?? OTHER_MODULE_KEY;

  const availableModules = computed(() => new Set(Object.keys(resourceMapper.value)));

  /** Modules the live grants need to work but lack; judged on `current`, so a staged removal can raise one. */
  const companionGaps = computed<CompanionGap[]>(() =>
    findCompanionGaps(selectedPermissionsHash.value, availableModules.value, getOrgId()),
  );

  const listOf = (items: string[]) =>
    raw(new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(items));

  const verbsOf = (actions: string[]) => {
    if (actions.includes("AllowAll"))
      return listOf(
        ["iam.editRole.verbView", ...WRITE_VERB_KEYS.map(([, key]) => key)].map((key) => t(key)),
      );
    const list = actions.includes("AllowList");
    const get = actions.includes("AllowGet");
    const verbs: string[] = [];
    if (list && get) verbs.push(t("iam.editRole.verbView"));
    else if (list)
      verbs.push(t(actions.length === 1 ? "iam.editRole.verbSeeListOf" : "iam.editRole.verbList"));
    else if (get) verbs.push(t("iam.editRole.verbOpen"));
    WRITE_VERB_KEYS.forEach(([action, key]) => {
      if (actions.includes(action)) verbs.push(t(key));
    });
    return listOf(verbs);
  };

  const targetOf = (resource: string, entity: string) => {
    const wide = isWideEntity(entity);
    const name = entityLabel(resource, entity);
    if (resource === STREAM_PARENT_KEY && wide) return t("iam.editRole.targetEveryStream");
    if (resourceParent(resource) === STREAM_PARENT_KEY) {
      const type = resourceLabel(resource).toLowerCase();
      return wide
        ? t("iam.editRole.targetTypeStreams", { type })
        : t("iam.editRole.targetOneStream", { name, type });
    }
    const keys = TARGET_KEYS[resource];
    if (wide)
      return keys?.all
        ? t(keys.all)
        : t("iam.editRole.targetAllOf", { module: resourceLabel(resource) });
    return keys
      ? t(keys.one, { name })
      : t("iam.editRole.targetItemIn", { name, module: resourceLabel(resource) });
  };

  // Only each scope's `resource`, `node` and `covers` are read, so its labels and hints are never shown.
  const { moduleScopes, folderScopes, streamTypeScopes } = useRoleScopes({
    resourceMapper,
    isGranted: () => false,
    resourceLabel,
    moduleLabel,
    t,
    ACTION_ORDER,
  });

  // Dashboard, alert and report ids carry their folder as `folderId/id`; any other id is placed by its folder's loaded items.
  const folderIdOf = (parent: string, entity: string): string =>
    entity.includes("/")
      ? entity.split("/")[0]
      : ((resourceMapper.value[parent]?.entities ?? []).find((folder: any) =>
          folder.entities?.some((item: any) => item.name === entity),
        )?.name ?? "");

  // The objects whose grants lock this row in the pane, from the scope rows useModuleNavigation pins above it: `logs:app` -> `stream:_all_`, `logs:_all_`.
  const widerObjects = (resource: string, entity: string) => {
    const parent = resourceParent(resource);
    const covering = (scopes: ScopeRow[], folder?: { name: string }) =>
      scopes
        .filter((scope) => scope.covers.includes(resource))
        .map((scope) => ({
          resource: scope.resource,
          entity: folder && scope.node === folder ? folder.name : `_all_${getOrgId()}`,
        }));
    // The catalogue parent names the type, so `stream:_all_` covers it before Streams loads its types; for `logs:_all_` the type row is the grant itself.
    if (parent === STREAM_PARENT_KEY) return covering(streamTypeScopes({ name: resource }));
    if (isWideEntity(entity)) return [];
    if (!parent) return covering(moduleScopes(resource));
    const folder = { name: folderIdOf(parent, entity), childName: resource };
    return covering(folderScopes(parent, folder), folder);
  };

  // Removed actions nothing left allows, by the pane's lock rule (ModulePane isInherited) plus the row's own AllowAll.
  const lostActions = (resource: string, entity: string, actions: string[]) => {
    const current = selectedPermissionsHash.value;
    const holders = [{ resource, entity }, ...widerObjects(resource, entity)];
    // model.fga defines every action as `ALLOW_ALL or ALLOW_<ACTION>`, so a removed AllowAll loses only what nothing else allows.
    const each = actions.includes("AllowAll")
      ? ACTION_ORDER.filter((action) => action !== "AllowAll")
      : actions;
    const lost = each.filter(
      (action) =>
        !holders.some((holder) =>
          [action, "AllowAll"].some((held) =>
            current.has(buildGrantKey(holder.resource, held, holder.entity)),
          ),
        ),
    );
    return lost.length === each.length ? actions : lost;
  };

  const effectOf = (resource: string, entity: string, state: GrantState, granted: string[]) => {
    const actions = state === "removed" ? lostActions(resource, entity, granted) : granted;
    if (!actions.length) return t("iam.editRole.effectStillAllowed");
    const filtered = FILTERED_LISTS[resource];
    if (filtered && isWideEntity(entity) && actions.length === 1 && actions[0] === "AllowList")
      return t(state === "added" ? filtered.can : filtered.cannot);
    return t(state === "added" ? "iam.editRole.effectCan" : "iam.editRole.effectCannot", {
      actions: verbsOf(actions),
      target: targetOf(resource, entity),
    });
  };

  // "Dash Folders needs this to load panel data." for a change that meets, or no longer meets, another module's need.
  const companionNotes = (
    gap: CompanionGap | undefined,
    actions: string[],
    key: "iam.editRole.companionNeedsThis" | "iam.editRole.companionStillNeedsThis",
  ) =>
    gap && (actions.includes("AllowAll") || gap.actions.some((a) => actions.includes(a)))
      ? gap.neededBy.map((need) =>
          t(key, { module: resourceLabel(need.module), reason: t(need.reasonKey) }),
        )
      : [];

  const pendingChanges = computed<PendingChange[]>(() => {
    const current = selectedPermissionsHash.value;
    const orgWide = `_all_${getOrgId()}`;
    // What would be missing without a module's grants, so an added grant can say who needs it; one scan per module, not per row.
    const gapsWithout = new Map<string, CompanionGap[]>();
    const gapsIfMissing = (module: string) => {
      if (!gapsWithout.has(module)) {
        const rest = new Set(
          [...current].filter((key) => moduleKeyOf(splitGrantKey(key).resource) !== module),
        );
        gapsWithout.set(module, findCompanionGaps(rest, availableModules.value, getOrgId()));
      }
      return gapsWithout.get(module)!.find((gap) => gap.module === module);
    };

    const notesOf = (resource: string, entity: string, state: GrantState, actions: string[]) => {
      const module = moduleKeyOf(resource);
      const filtered = FILTERED_LISTS[resource];
      const listOnly =
        state === "added" &&
        filtered &&
        isWideEntity(entity) &&
        actions.includes("AllowList") &&
        !current.has(buildGrantKey(resource, "AllowGet", orgWide)) &&
        !current.has(buildGrantKey(resource, "AllowAll", orgWide));
      return [
        ...(listOnly ? [t(filtered.note)] : []),
        ...(state === "added"
          ? companionNotes(gapsIfMissing(module), actions, "iam.editRole.companionNeedsThis")
          : companionNotes(
              companionGaps.value.find((gap) => gap.module === module),
              actions,
              "iam.editRole.companionStillNeedsThis",
            )),
      ];
    };

    const changes: PendingChange[] = [];
    grantsByResource.value.forEach((byEntity, resource) => {
      byEntity.forEach((grants, entity) => {
        (["added", "removed"] as const).forEach((state) => {
          const ofState = grants.filter((grant) => grant.state === state);
          if (!ofState.length) return;
          const actions = ofState.map((grant) => grant.action);
          changes.push({
            id: `${resource}-${entity}-${state}`,
            state,
            label: entityLabel(resource, entity),
            moduleLabel: raw(resourceLabel(resource)),
            moduleKey: moduleKeyOf(resource),
            actions: summaryActions(actions),
            keys: ofState.map((grant) => buildGrantKey(resource, grant.action, entity)),
            effect: effectOf(resource, entity, state, actions),
            notes: notesOf(resource, entity, state, actions),
          });
        });
      });
    });
    return changes;
  });

  // Rail order, with resources outside every module last, so nothing staged goes unlisted.
  const pendingGroups = computed<PendingGroup[]>(() => {
    const byModule = new Map<string, PendingChange[]>();
    pendingChanges.value.forEach((change) => {
      const group = byModule.get(change.moduleKey) ?? [];
      group.push(change);
      byModule.set(change.moduleKey, group);
    });
    const order = [...roleModules.value.map((module) => module.key), OTHER_MODULE_KEY];
    return [...byModule.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([key, changes]) => ({
        key,
        label: key === OTHER_MODULE_KEY ? t("iam.editRole.changeOtherGroup") : moduleLabel(key),
        icon: roleModules.value.find((module) => module.key === key)?.icon ?? moduleIcon(key),
        changes,
      }));
  });

  // Nothing left to review once the last change is undone, unless a missing module still needs adding.
  watch(
    () => !pendingChanges.value.length && !companionGaps.value.length,
    (settled) => {
      if (settled) unsavedDrawerOpen.value = false;
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
    innerGrants,
    moduleInnerGrants,
    actionsOf,
    specificReach,
    moduleDescription,
    summaryModules,
    pendingChanges,
    pendingGroups,
    companionGaps,
    moduleKeyOf,
  };
};
