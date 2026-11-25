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

import type { FilterGroup, FilterNode } from "@/utils/query/filterBar";
import { isFlatAnd } from "./anomalyCodec";
import {
  dashboardFilterCodec,
  type DashboardFilterCondition,
  type DashboardFilterGroup,
} from "./dashboardFilterCodec";
import { dashboardVariableCodec, type VariableFilter } from "./listCodecs";
import { isPlainObject, isTreePristine, rawOf, stamp, type FilterCodec } from "./types";

/** A variable's `query_data` filter keys; only one of them is ever written. */
export interface VariableFilterValue {
  filter?: VariableFilter[];
  filter_group?: DashboardFilterGroup;
}

const hasRawLeaf = (group: FilterGroup): boolean =>
  group.items.some((item) => item.kind === "raw" || (item.kind === "group" && hasRawLeaf(item)));

const toPanelLeaf = (item: VariableFilter, connector: string): DashboardFilterCondition => ({
  type: "condition",
  column: { field: item.name ?? "" },
  filterType: "condition",
  operator: item.operator,
  value: item.value,
  logicalOperator: connector === "OR" ? "OR" : "AND",
  values: [],
});

// A stamp holds the other shape's payload, so moved nodes are written fresh; a locked flat row becomes a panel leaf.
const restamped = (node: FilterNode): FilterNode => {
  const { meta: _meta, ...rest } = node;
  if (rest.kind === "group") return { ...rest, items: rest.items.map(restamped) };
  if (rest.kind === "condition") return rest;
  const saved = rawOf<VariableFilter>(node);
  return isPlainObject(saved) ? stamp(rest, toPanelLeaf(saved, rest.connector)) : rest;
};

/** Variable filters: the legacy flat `filter` rows while AND-only, a panel-shaped `filter_group` once OR or nesting is used. */
export function dashboardVariableFilterCodec(): FilterCodec<VariableFilterValue> {
  const flat = dashboardVariableCodec();
  const grouped = dashboardFilterCodec();
  return {
    parse: (saved, context) =>
      isPlainObject(saved?.filter_group)
        ? grouped.parse(saved.filter_group, context)
        : flat.parse(saved?.filter, context),
    serialize: (tree, context) => {
      const fromGroup = isPlainObject(rawOf(tree));
      if (isTreePristine(tree) && fromGroup)
        return { filter_group: rawOf<DashboardFilterGroup>(tree)! };
      // A locked panel leaf has no flat row, so a tree holding one stays a group.
      const flatFits = isFlatAnd(tree) && !(fromGroup && hasRawLeaf(tree));
      if (!flatFits) {
        const source = fromGroup ? tree : (restamped(tree) as FilterGroup);
        return { filter_group: grouped.serialize(source, context)! };
      }
      return {
        filter: flat.serialize(fromGroup ? (restamped(tree) as FilterGroup) : tree, context),
      };
    },
  };
}
