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

import { buildGrantKey, splitGrantKey } from "@/composables/iam/useRoleGrants";
import type { PermissionType } from "@/ts/interfaces";

export type CompanionAction = "AllowList" | "AllowGet";

export type CompanionGap = {
  module: string;
  actions: CompanionAction[];
  neededBy: { module: string; reasonKey: string }[];
};

type CompanionRule = {
  trigger: string;
  on: readonly PermissionType[];
  needs: { module: string; actions: CompanionAction[]; reasonKey: string }[];
};

const WRITES: readonly PermissionType[] = ["AllowAll", "AllowPost", "AllowPut"];

const ACTION_ORDER: CompanionAction[] = ["AllowList", "AllowGet"];

// Alert save checks stream access (background_access/mod.rs), the alert form lists destinations, every destination needs a template, and opening or building a dashboard queries its panels' streams; destination and template lists keep only items the user can Get.
const COMPANION_RULES: CompanionRule[] = [
  {
    trigger: "afolder",
    on: WRITES,
    needs: [
      {
        module: "stream",
        actions: ["AllowList", "AllowGet"],
        reasonKey: "iam.editRole.companionReasonAlertStreams",
      },
      {
        module: "destination",
        actions: ["AllowList", "AllowGet"],
        reasonKey: "iam.editRole.companionReasonAlertDestinations",
      },
    ],
  },
  {
    trigger: "destination",
    on: WRITES,
    needs: [
      {
        module: "template",
        actions: ["AllowList", "AllowGet"],
        reasonKey: "iam.editRole.companionReasonDestinationTemplates",
      },
    ],
  },
  {
    trigger: "dfolder",
    on: ["AllowAll", "AllowGet", "AllowPost", "AllowPut"],
    needs: [
      {
        module: "stream",
        actions: ["AllowList", "AllowGet"],
        reasonKey: "iam.editRole.companionReasonDashboardStreams",
      },
    ],
  },
];

const STREAM_TYPES = ["logs", "metrics", "traces", "index"];

// Item grants live on child resources, so a saved `alert:f1/a9` or `metrics:cpu` counts even before its list loads.
const RESOURCES_OF: Record<string, string[]> = {
  afolder: ["afolder", "alert"],
  dfolder: ["dfolder", "dashboard"],
  stream: ["stream", ...STREAM_TYPES],
};

// The drawer patches a hand-built role whose streams were picked one by one, so its Add never widens to every stream; a job preset does only after its detail says so.
const PICK_ITEMS_INSTEAD: Record<string, CompanionAction[]> = { stream: ["AllowGet"] };

type ActionIndex = Map<string, Set<string>>;

const indexAction = (index: ActionIndex, resource: string, action: string) => {
  const actions = index.get(resource) ?? new Set<string>();
  actions.add(action);
  index.set(resource, actions);
};

const holds = (index: ActionIndex, resource: string, actions: readonly string[]) =>
  actions.some((action) => index.get(resource)?.has(action));

const holdsAny = (index: ActionIndex, module: string, actions: readonly string[]) =>
  (RESOURCES_OF[module] ?? [module]).some((resource) => holds(index, resource, actions));

// FGA checks List per stream type, so List on metrics lists none of the logs streams the role can read.
const listsReadStreams = (anyItem: ActionIndex, moduleWide: ActionIndex) => {
  const list = ["AllowList", "AllowAll"];
  const read = ["AllowGet", "AllowAll"];
  if (holds(moduleWide, "stream", list)) return true;
  // The stream wildcard's Get reads every type, so each type must list.
  const readTypes = holds(moduleWide, "stream", read)
    ? STREAM_TYPES
    : STREAM_TYPES.filter((type) => holds(anyItem, type, read));
  return readTypes.length
    ? readTypes.every((type) => holds(moduleWide, type, list))
    : STREAM_TYPES.some((type) => holds(moduleWide, type, list));
};

/** Modules a role's grants need to work but lacks: List needs an org-wide grant (per read stream type for Streams), Get any item's, All counting for both. */
export function findCompanionGaps(
  keys: ReadonlySet<string>,
  availableModules: ReadonlySet<string>,
  orgId: string,
): CompanionGap[] {
  // Exact match: a stream may be named `_all_x`, so a prefix test would read it as the wildcard.
  const wildcard = `_all_${orgId}`;
  // One pass over the grants, so a role with thousands of them is scanned once, not once per rule.
  const anyItem: ActionIndex = new Map();
  const moduleWide: ActionIndex = new Map();
  keys.forEach((key) => {
    const { resource, entity, permission } = splitGrantKey(key);
    indexAction(anyItem, resource, permission);
    if (entity === wildcard) indexAction(moduleWide, resource, permission);
  });

  const gaps = new Map<string, CompanionGap>();
  COMPANION_RULES.filter(
    (rule) => availableModules.has(rule.trigger) && holdsAny(anyItem, rule.trigger, rule.on),
  ).forEach((rule) =>
    rule.needs
      // A module this org lacks can be neither granted nor added, so flagging it is noise.
      .filter((need) => availableModules.has(need.module))
      .forEach((need) => {
        // FGA checks List on the org wildcard, so one item's grant opens that item but lists nothing.
        const missing = need.actions.filter((action) =>
          action === "AllowList" && need.module === "stream"
            ? !listsReadStreams(anyItem, moduleWide)
            : !holdsAny(action === "AllowList" ? moduleWide : anyItem, need.module, [
                action,
                "AllowAll",
              ]),
        );
        if (!missing.length) return;
        const gap = gaps.get(need.module) ?? { module: need.module, actions: [], neededBy: [] };
        gap.actions = ACTION_ORDER.filter(
          (action) => gap.actions.includes(action) || missing.includes(action),
        );
        gap.neededBy.push({ module: rule.trigger, reasonKey: need.reasonKey });
        gaps.set(need.module, gap);
      }),
  );
  return [...gaps.values()];
}

/** The module-wide keys an Add stages for a gap; Streams Get is left for the admin to pick per stream. */
export function companionAddKeys(gap: CompanionGap, orgId: string): string[] {
  return gap.actions
    .filter((action) => !PICK_ITEMS_INSTEAD[gap.module]?.includes(action))
    .map((action) => buildGrantKey(gap.module, action, `_all_${orgId}`));
}
