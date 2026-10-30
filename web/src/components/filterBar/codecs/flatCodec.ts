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
  newFilterId,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import {
  isPristine,
  isTreePristine,
  leafConditions,
  makeGroup,
  makeRawNode,
  parsedOperator,
  rawOf,
  stamp,
  type CodecContext,
  type FilterCodec,
} from "./types";

export interface FlatCondition {
  field: string;
  operator: FilterOperatorId;
  values: string[];
}

export interface FlatCodecSpec<T> {
  /** The item as a condition; null keeps it locked. */
  read: (item: T) => FlatCondition | null;
  /** Text of a locked item's chip. */
  label: (item: T) => string;
  /** Writes a changed condition onto the item it was loaded from; `sameOperator` lets it keep the saved spelling. */
  write: (
    condition: FlatCondition,
    saved: T | undefined,
    sameOperator: boolean,
    context: CodecContext,
  ) => T;
}

/** Items of the tree in order, nested groups flattened; a flat format ANDs everything. */
const flatItems = (tree: FilterGroup): FilterNode[] =>
  tree.items.flatMap((item) => (item.kind === "group" ? leafConditions(item) : [item]));

/** A flat AND-ed list of items, each one condition. */
export function flatCodec<T>(spec: FlatCodecSpec<T>): FilterCodec<T[]> {
  const toNode = (item: T): FilterNode => {
    const read = spec.read(item);
    if (!read) return stamp(makeRawNode(spec.label(item)), item);
    const condition: FilterCondition = {
      kind: "condition",
      id: newFilterId(),
      connector: "AND",
      ...read,
    };
    return stamp(condition, item);
  };
  return {
    parse: (saved) => {
      const list = Array.isArray(saved) ? saved : [];
      return stamp(makeGroup(list.map(toNode), "AND", "root"), saved ?? null);
    },
    serialize: (tree, context) => {
      if (isTreePristine(tree) && Array.isArray(rawOf(tree))) return rawOf<T[]>(tree)!;
      return flatItems(tree).map((node) => {
        const raw = rawOf<T>(node);
        if (node.kind !== "condition") return raw!;
        if (isPristine(node) && raw !== undefined) return raw;
        const { field, operator, values } = node;
        return spec.write(
          { field, operator, values },
          raw,
          parsedOperator(node) === node.operator,
          context,
        );
      });
    },
  };
}
