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

import { shallowRef, toRaw, watch, type Ref } from "vue";
import type {
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterRawNode,
} from "@/utils/query/filterBar";
import type { FilterConnectorMode } from "./filterProfiles";

/** Groups at this level or deeper (the root being 1) start folded when a saved filter loads. */
export const FOLD_FROM_LEVEL = 4;

/** How many of a folded group's items its summary writes out before "N more". */
const SUMMARY_ITEMS = 2;

export interface FilterGroupSummaryText {
  /** One condition or locked part as text, e.g. `path = /api`. */
  describe: (node: FilterCondition | FilterRawNode) => string;
  /** The tail for items not written out, e.g. `2 more`. */
  more: (count: number) => string;
  connectorMode: FilterConnectorMode;
}

/** A folded group's one-line summary: its first items with their connectors, nested groups as `(…)`, then `AND 3 more`. */
export function groupSummary(group: FilterGroup, text: FilterGroupSummaryText): string {
  const connector = (node: FilterNode) =>
    text.connectorMode === "and-only" ? "AND" : node.connector;
  const parts = group.items.slice(0, SUMMARY_ITEMS).map((item, index) => {
    const body = item.kind === "group" ? "(…)" : text.describe(item);
    return index ? `${connector(item)} ${body}` : body;
  });
  const rest = group.items.length - SUMMARY_ITEMS;
  if (rest > 0) parts.push(`${connector(group.items[SUMMARY_ITEMS])} ${text.more(rest)}`);
  return parts.join(" ");
}

/** Ids of the groups that hold node `id`, outermost first, and `id` itself when it is a group; empty when absent. */
export function enclosingGroupIds(root: FilterGroup, id: string): string[] {
  for (const item of root.items) {
    if (item.id === id) return item.kind === "group" ? [item.id] : [];
    if (item.kind === "group" && containsNode(item, id)) {
      return [item.id, ...enclosingGroupIds(item, id)];
    }
  }
  return [];
}

export function containsNode(group: FilterGroup, id: string): boolean {
  return group.items.some(
    (item) => item.id === id || (item.kind === "group" && containsNode(item, id)),
  );
}

/** Which groups of the vertical layout are folded; UI state only, never part of the saved filter. */
export function useFilterBarFolds(tree: Ref<FilterGroup>) {
  const folded = shallowRef<Set<string>>(new Set());
  // Trees the bar itself emitted; any other tree arriving is a load, which folds deep groups again.
  const own = new WeakSet<FilterGroup>();

  watch(
    tree,
    (next) => {
      if (!own.has(toRaw(next))) folded.value = deepGroupIds(next, 1, new Set());
    },
    { immediate: true },
  );

  function markOwn(next: FilterGroup) {
    own.add(toRaw(next));
  }

  function setFolded(id: string, value: boolean) {
    if (folded.value.has(id) === value) return;
    const next = new Set(folded.value);
    if (value) next.add(id);
    else next.delete(id);
    folded.value = next;
  }

  /** Unfolds every group around node `id`, and `id` itself when it is a group. */
  function reveal(id: string | null | undefined) {
    if (!id || id === tree.value.id) return;
    const ids = enclosingGroupIds(tree.value, id).filter((group) => folded.value.has(group));
    if (!ids.length) return;
    const next = new Set(folded.value);
    ids.forEach((group) => next.delete(group));
    folded.value = next;
  }

  return { folded, markOwn, setFolded, reveal };
}

function deepGroupIds(group: FilterGroup, level: number, into: Set<string>): Set<string> {
  for (const item of group.items) {
    if (item.kind !== "group") continue;
    if (level + 1 >= FOLD_FROM_LEVEL) into.add(item.id);
    deepGroupIds(item, level + 1, into);
  }
  return into;
}
