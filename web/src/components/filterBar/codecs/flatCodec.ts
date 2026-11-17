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

import { filterGroupsOf } from "@/components/promql/labelBoolean";
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

/** A list item that may sit in one of the PromQL label groups. */
export interface GroupedItem {
  group?: number;
  negate?: boolean;
}

/** Items of the tree in order, nested groups flattened; a flat format ANDs everything. */
const flatItems = (tree: FilterGroup): FilterNode[] =>
  tree.items.flatMap((item) => (item.kind === "group" ? leafConditions(item) : [item]));

const itemToNode = <T>(spec: FlatCodecSpec<T>, item: T): FilterNode => {
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

const nodeToItem = <T>(spec: FlatCodecSpec<T>, node: FilterNode, context: CodecContext): T => {
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
};

/** A flat AND-ed list of items, each one condition. */
export function flatCodec<T>(spec: FlatCodecSpec<T>): FilterCodec<T[]> {
  return {
    parse: (saved) => {
      const list = Array.isArray(saved) ? saved : [];
      return stamp(
        makeGroup(
          list.map((item) => itemToNode(spec, item)),
          "AND",
          "root",
        ),
        saved ?? null,
      );
    },
    serialize: (tree, context) => {
      if (isTreePristine(tree) && Array.isArray(rawOf(tree))) return rawOf<T[]>(tree)!;
      return flatItems(tree).map((node) => nodeToItem(spec, node, context));
    },
  };
}

const placeItem = <T extends GroupedItem>(item: T, group?: number, negate?: boolean): T => {
  const out = { ...item };
  delete out.group;
  delete out.negate;
  if (group) out.group = group;
  if (group && negate) out.negate = true;
  return out;
};

/** A flat list whose items may carry `group`/`negate`: base items AND (group OR group ...); see `compileLabelFilters`. */
export function labelGroupsCodec<T extends GroupedItem>(spec: FlatCodecSpec<T>): FilterCodec<T[]> {
  return {
    parse: (saved) => {
      const list = Array.isArray(saved) ? saved : [];
      const base = list.filter((item) => (item.group ?? 0) <= 0);
      const groups = filterGroupsOf(list).map(({ group, negate, members }) => {
        const node = makeGroup(members.map((item) => itemToNode(spec, item)));
        if (negate) node.negate = true;
        return stamp(node, { group });
      });
      const items = [...base.map((item) => itemToNode(spec, item)), ...groups];
      return stamp(makeGroup(items, "AND", "root"), saved ?? null);
    },
    serialize: (tree, context) => {
      if (isTreePristine(tree) && Array.isArray(rawOf(tree))) return rawOf<T[]>(tree)!;
      const groups = tree.items.filter((item): item is FilterGroup => item.kind === "group");
      const numberOf = (group: FilterGroup) => rawOf<{ group?: number }>(group)?.group ?? 0;
      // A group keeps its number, which the explorer's filter keys and shared links carry.
      let next = Math.max(0, ...groups.map(numberOf));
      const base = flatItems({ ...tree, items: tree.items.filter((i) => i.kind !== "group") });
      return [
        ...base.map((node) => placeItem(nodeToItem(spec, node, context))),
        ...groups.flatMap((group) => {
          const number = numberOf(group) || ++next;
          return flatItems(group).map((node) =>
            placeItem(nodeToItem(spec, node, context), number, group.negate),
          );
        }),
      ];
    },
  };
}
