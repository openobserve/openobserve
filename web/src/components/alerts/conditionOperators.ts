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

import type { ComputedRef, InjectionKey } from "vue";
import type { I18nText } from "@/types/i18n";
import type { ComboboxOption } from "@/lib/forms/Combobox/OCombobox.types";

/** ConditionBuilder hands its `operators` down to every FilterCondition, through FilterGroup. */
export const CONDITION_OPERATORS_KEY: InjectionKey<ComputedRef<string[] | undefined>> =
  Symbol("ConditionOperators");

/** An `=` pair of another row, which narrows the values offered for this one. */
export interface ConditionValuePair {
  key: string;
  value: string;
}

/** What a value box shows: the options, and an optional note under it that never blocks save. */
export interface ConditionValueSuggestions {
  options: ComputedRef<ComboboxOption[]>;
  hint: ComputedRef<I18nText | undefined>;
}

/** Called once per row in its setup, with getters, so the provider can run a query per row. */
export type ConditionValueSuggest = (
  column: () => string,
  prefix: () => string,
  siblingPairs: () => ConditionValuePair[],
) => ConditionValueSuggestions;

/** With a provider the value box becomes a free-text combobox; without one it stays an input. */
export const CONDITION_VALUE_SUGGEST_KEY: InjectionKey<ConditionValueSuggest> =
  Symbol("ConditionValueSuggest");

interface TreeNode {
  filterType?: string;
  logicalOperator?: string;
  id?: string;
  column?: unknown;
  operator?: unknown;
  value?: unknown;
  conditions?: TreeNode[];
}

const spinePairs = (
  node: TreeNode,
  ownId: string | undefined,
  isRoot: boolean,
): ConditionValuePair[] => {
  if (node.filterType === "group") {
    const isAnd = isRoot || String(node.logicalOperator ?? "AND").toUpperCase() === "AND";
    return isAnd ? (node.conditions ?? []).flatMap((c) => spinePairs(c, ownId, false)) : [];
  }
  const key = String(node.column ?? "").trim();
  const value = String(node.value ?? "").trim();
  if (node.id === ownId || node.operator !== "=" || !key || !value) return [];
  return [{ key, value }];
};

/** The complete `=` rows reachable through AND groups, without the row being edited. */
export function siblingAndPairs(root: unknown, ownId: string | undefined): ConditionValuePair[] {
  if (!root || typeof root !== "object") return [];
  return spinePairs(root as TreeNode, ownId, true);
}
