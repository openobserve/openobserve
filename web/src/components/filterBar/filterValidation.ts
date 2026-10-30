// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  countConditions,
  isConditionComplete,
  type FilterGroup,
  type FilterNode,
} from "@/utils/query/filterBar";
import { isPristine, leafConditions } from "./codecs/types";
import type { FilterIssue, FilterProfile, FilterValidationContext } from "./filterProfiles";

/** The tree without unfinished conditions; a group left empty goes too, but a part kept as loaded never does. */
export function pruneIncomplete(group: FilterGroup): FilterGroup {
  const items = group.items
    .map((item): FilterNode | null => {
      if (item.kind === "condition")
        return isConditionComplete(item) || isPristine(item) ? item : null;
      if (item.kind === "raw") return item;
      const pruned = pruneIncomplete(item);
      return pruned.items.length ? pruned : null;
    })
    .filter((item): item is FilterNode => item !== null);
  return items.length === group.items.length && items.every((item, i) => item === group.items[i])
    ? group
    : { ...group, items };
}

/** Every problem the profile finds in the tree: unfinished chips, limits, and its own rules. */
export function filterIssues(
  tree: FilterGroup,
  profile: FilterProfile,
  context: FilterValidationContext,
): FilterIssue[] {
  const { t } = context;
  const issues: FilterIssue[] = [];
  const leaves = leafConditions(tree);
  if (profile.validation === "requireComplete") {
    for (const leaf of leaves) {
      if (!isConditionComplete(leaf)) {
        issues.push({ nodeId: leaf.id, message: t("filterBar.validation.incomplete") });
      }
    }
  }
  if (
    profile.required &&
    !leaves.some(isConditionComplete) &&
    !tree.items.some((i) => i.kind === "raw")
  ) {
    issues.push({ nodeId: null, message: t("filterBar.validation.required") });
  }
  const { maxConditions, maxValues } = profile.limits;
  if (maxConditions !== undefined && countConditions(tree) > maxConditions) {
    issues.push({
      nodeId: null,
      message: t("filterBar.limits.conditions", { count: maxConditions }, maxConditions),
    });
  }
  if (maxValues !== undefined) {
    for (const leaf of leaves) {
      if (leaf.values.length > maxValues) {
        issues.push({
          nodeId: leaf.id,
          message: t("filterBar.limits.values", { count: maxValues }, maxValues),
        });
      }
    }
  }
  if (profile.validate) issues.push(...profile.validate(tree, context));
  return issues;
}
