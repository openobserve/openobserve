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

import type { FilterCondition } from "@/utils/query/filterBar";
import type { AlertGroup } from "@/ts/interfaces/alert";

export type GroupFilterCondition = Pick<FilterCondition, "field" | "operator" | "values">;

const sortedUnique = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b));

const holds = (group: AlertGroup, { field, values }: GroupFilterCondition) =>
  (group.labels ?? []).some((label) => label.name === field && values.includes(label.value));

const matches = (group: AlertGroup, condition: GroupFilterCondition) => {
  switch (condition.operator) {
    case "match_all": {
      const needle = (condition.values[0] ?? "").trim().toLowerCase();
      return (group.group_labels ?? "").toLowerCase().includes(needle);
    }
    // A group without the label is not one of the excluded values, as in PromQL.
    case "neq":
    case "not_in":
      return !holds(group, condition);
    default:
      return holds(group, condition);
  }
};

/** Whether a group passes every condition of the table's filter. */
export const matchesGroupFilter = (group: AlertGroup, conditions: GroupFilterCondition[]) =>
  conditions.every((condition) => matches(group, condition));

/** The label names the groups carry, for the filter's field list. */
export const groupLabelNames = (groups: AlertGroup[]) =>
  sortedUnique(groups.flatMap((group) => (group.labels ?? []).map((label) => label.name)));

/** The values one label takes across the groups, narrowed by the typed text. */
export const groupLabelValues = (groups: AlertGroup[], name: string, search: string) => {
  const needle = search.trim().toLowerCase();
  return sortedUnique(
    groups.flatMap((group) =>
      (group.labels ?? [])
        .filter((label) => label.name === name && label.value.toLowerCase().includes(needle))
        .map((label) => label.value),
    ),
  );
};
