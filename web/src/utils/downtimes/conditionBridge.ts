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

import { getUUID } from "@/utils/zincutils";
import type { V2Condition, V2Group } from "@/utils/alerts/alertDataTransforms";
import type { DimensionCondition, LogicalOp, PairOperator } from "@/services/downtimes";

export const DOWNTIME_OPERATORS: PairOperator[] = ["=", "!="];

export const MAX_CONDITION_DEPTH = 3;
export const MAX_CONDITION_PAIRS = 32;

type BuilderNode = V2Condition | V2Group;

const isGroupNode = (node: BuilderNode): node is V2Group => node.filterType === "group";

const toOp = (value: string | undefined): LogicalOp =>
  String(value ?? "AND").toUpperCase() === "OR" ? "or" : "and";

const toBuilderOp = (op: LogicalOp): "AND" | "OR" => (op === "or" ? "OR" : "AND");

/** The builder's operator names are already the wire names; anything else is not a downtime operator. */
export const toPairOperator = (operator: string): PairOperator | null =>
  DOWNTIME_OPERATORS.includes(operator as PairOperator) ? (operator as PairOperator) : null;

const nodeToCondition = (node: BuilderNode, isRoot = false): DimensionCondition => {
  if (isGroupNode(node)) {
    const op: LogicalOp = isRoot ? "and" : toOp(node.logicalOperator);
    return { type: "group", op, items: node.conditions.map((c) => nodeToCondition(c)) };
  }
  return {
    type: "pair",
    key: String(node.column ?? "").trim(),
    operator: (toPairOperator(node.operator) ?? node.operator) as PairOperator,
    value: String(node.value ?? "").trim(),
  };
};

/** Forward bridge: the root is always AND (its toggle is a dummy), a nested group's toggle is its `op`. */
export function builderToCondition(root: V2Group | null | undefined): DimensionCondition | null {
  if (!root || !Array.isArray(root.conditions) || root.conditions.length === 0) return null;
  return nodeToCondition(root, true);
}

const conditionToNode = (cond: DimensionCondition, connector: "AND" | "OR"): BuilderNode => {
  if (cond.type === "pair") {
    return {
      filterType: "condition",
      column: cond.key,
      operator: cond.operator,
      value: cond.value,
      values: [],
      logicalOperator: connector,
      id: getUUID(),
    };
  }
  const op = toBuilderOp(cond.op);
  return {
    filterType: "group",
    logicalOperator: op,
    groupId: getUUID(),
    conditions: cond.items.map((c) => conditionToNode(c, op)),
  };
};

/** Reverse bridge: a non-AND root is wrapped in an AND root, because the builder's root is fixed. */
export function conditionToBuilder(cond: DimensionCondition | null | undefined): V2Group {
  const root: V2Group = {
    filterType: "group",
    logicalOperator: "AND",
    groupId: getUUID(),
    conditions: [],
  };
  if (!cond) return root;
  if (cond.type === "group" && cond.op === "and") {
    root.conditions = cond.items.map((c) => conditionToNode(c, "AND"));
  } else {
    root.conditions = [conditionToNode(cond, "AND")];
  }
  return root;
}

/** A starting tree: one AND group with one empty pair. */
export function emptyBuilderGroup(): V2Group {
  return conditionToBuilder({
    type: "group",
    op: "and",
    items: [{ type: "pair", key: "", operator: "=", value: "" }],
  });
}

const findGroup = (node: BuilderNode, id: string | undefined): V2Group | null => {
  if (!isGroupNode(node)) return null;
  if (node.groupId === id) return node;
  for (const child of node.conditions) {
    const hit = findGroup(child, id);
    if (hit) return hit;
  }
  return null;
};

const flippedRowConnector = (next: V2Group, prev: V2Group | null): "AND" | "OR" | null => {
  if (!prev) return null;
  const before = findGroup(prev, next.groupId);
  if (!before) return null;
  for (const child of next.conditions) {
    if (isGroupNode(child)) continue;
    const old = before.conditions.find((c) => !isGroupNode(c) && c.id === child.id);
    if (old && old.logicalOperator !== child.logicalOperator) return child.logicalOperator;
  }
  return null;
};

const normalizeGroup = (group: V2Group, prev: V2Group | null, isRoot: boolean): V2Group => {
  const flipped = isRoot ? null : flippedRowConnector(group, prev);
  const op: "AND" | "OR" = isRoot ? "AND" : (flipped ?? toBuilderOp(toOp(group.logicalOperator)));
  return {
    ...group,
    logicalOperator: op,
    conditions: group.conditions.map((child) =>
      isGroupNode(child) ? normalizeGroup(child, prev, false) : { ...child, logicalOperator: op },
    ),
  };
};

/** Rows show their group's `op`; a row's swap button flips its nested group, and does nothing on the root. */
export function normalizeConnectors(next: V2Group, prev: V2Group | null): V2Group {
  return normalizeGroup(next, prev, true);
}

const sameConnectors = (a: BuilderNode, b: BuilderNode): boolean => {
  if (a.logicalOperator !== b.logicalOperator) return false;
  if (!isGroupNode(a) || !isGroupNode(b)) return isGroupNode(a) === isGroupNode(b);
  return (
    a.conditions.length === b.conditions.length &&
    a.conditions.every((c, i) => sameConnectors(c, b.conditions[i]))
  );
};

/** True when normalizing changed nothing, so writing it back would loop. */
export function connectorsEqual(a: V2Group, b: V2Group): boolean {
  return sameConnectors(a, b);
}

const isResourceGroupOn = (c: DimensionCondition, key: string): boolean =>
  c.type === "group" &&
  c.op === "or" &&
  c.items.length > 0 &&
  c.items.every((i) => i.type === "pair" && i.key === key && i.operator === "=");

/** The ticked resources become an OR group of `=` pairs on that key, replacing any earlier one. */
export function applyResources(
  cond: DimensionCondition | null,
  key: string,
  values: string[],
): DimensionCondition {
  const base: DimensionCondition[] =
    cond?.type === "group" && cond.op === "and" ? cond.items : cond ? [cond] : [];
  const kept = base.filter(
    (c) => !isResourceGroupOn(c, key) && !(c.type === "pair" && c.key === key),
  );
  const pairs: DimensionCondition[] = values.map((value) => ({
    type: "pair",
    key,
    operator: "=",
    value,
  }));
  if (pairs.length === 0) return { type: "group", op: "and", items: kept };
  const refinement: DimensionCondition =
    pairs.length === 1 ? pairs[0] : { type: "group", op: "or", items: pairs };
  return { type: "group", op: "and", items: [...kept, refinement] };
}

/** The `=` pairs reachable through AND groups from the root, which is what `resources` looks up. */
export function andEqPairs(cond: DimensionCondition | null): Array<{ key: string; value: string }> {
  if (!cond) return [];
  if (cond.type === "pair") {
    return cond.operator === "=" ? [{ key: cond.key, value: cond.value }] : [];
  }
  if (cond.op !== "and") return [];
  return cond.items.flatMap((c) => andEqPairs(c));
}
