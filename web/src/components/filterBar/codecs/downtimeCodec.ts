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

import type { DimensionCondition, LogicalOp, PairOperator } from "@/services/downtimes";
import {
  newFilterId,
  type FilterCondition,
  type FilterConnector,
  type FilterGroup,
  type FilterNode,
} from "@/utils/query/filterBar";
import {
  isPlainObject,
  isPristine,
  isTreePristine,
  makeGroup,
  makeRawNode,
  rawOf,
  stamp,
  type FilterCodec,
} from "./types";

type Pair = Extract<DimensionCondition, { type: "pair" }>;
type Group = Extract<DimensionCondition, { type: "group" }>;

const toConnector = (op: LogicalOp | undefined): FilterConnector => (op === "or" ? "OR" : "AND");

function parseNode(node: DimensionCondition, connector: FilterConnector): FilterNode {
  if (node.type === "group" && Array.isArray(node.items)) {
    const own = toConnector(node.op);
    return stamp(
      makeGroup(
        node.items.map((item) => parseNode(item, own)),
        connector,
      ),
      node,
    );
  }
  if (node.type === "pair" && (node.operator === "=" || node.operator === "!=")) {
    const condition: FilterCondition = {
      kind: "condition",
      id: newFilterId(),
      connector,
      field: String(node.key ?? ""),
      operator: node.operator === "=" ? "eq" : "neq",
      values: node.value ? [String(node.value)] : [],
    };
    return stamp(condition, node);
  }
  return stamp(makeRawNode(JSON.stringify(node), connector), node);
}

// A group's own `op` lives on its items' connectors, since every item of a downtime group joins the same way.
const groupOp = (group: FilterGroup): LogicalOp => {
  const joined = group.items[1] ?? group.items[0];
  return joined?.connector === "OR" ? "or" : "and";
};

function serializeNode(node: FilterNode): DimensionCondition {
  const raw = rawOf<DimensionCondition>(node);
  if (node.kind === "raw") return raw!;
  if (node.kind === "condition") {
    if (isPristine(node) && raw) return raw;
    const base = raw?.type === "pair" ? raw : undefined;
    const pair: Pair = {
      ...(base ?? { type: "pair" }),
      type: "pair",
      key: node.field.trim(),
      operator: (node.operator === "neq" ? "!=" : "=") as PairOperator,
      value: (node.values[0] ?? "").trim(),
    };
    return pair;
  }
  if (isTreePristine(node) && raw) return raw;
  const base = raw?.type === "group" ? raw : undefined;
  const group: Group = {
    ...(base ?? { type: "group" }),
    type: "group",
    op: groupOp(node),
    items: node.items.map(serializeNode),
  };
  return group;
}

/** Downtime dimension conditions (`pair` / `group` with one `op` per group); an empty tree saves as null. */
export function downtimeCodec(): FilterCodec<DimensionCondition | null> {
  return {
    parse: (saved) => {
      if (!isPlainObject(saved)) return stamp(makeGroup([], "AND", "root"), saved ?? null);
      if (saved.type === "group" && Array.isArray(saved.items)) {
        const own = toConnector(saved.op);
        const items = saved.items.map((item) => parseNode(item, own));
        return stamp(makeGroup(items, own, "root"), saved);
      }
      return stamp(makeGroup([parseNode(saved, "AND")], "AND", "root"), saved);
    },
    serialize: (tree) => {
      if (isTreePristine(tree)) return rawOf<DimensionCondition | null>(tree) ?? null;
      if (!tree.items.length) return null;
      const raw = rawOf<DimensionCondition>(tree);
      if (raw && raw.type === "pair" && tree.items.length === 1 && tree.items[0].kind !== "group") {
        return serializeNode(tree.items[0]);
      }
      const base = raw?.type === "group" ? raw : undefined;
      return {
        ...(base ?? { type: "group" }),
        type: "group",
        op: groupOp(tree),
        items: tree.items.map(serializeNode),
      } as Group;
    },
  };
}
