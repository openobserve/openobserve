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

import type { DimensionCondition, PairOperator } from "@/services/downtimes";

export const DOWNTIME_OPERATORS: PairOperator[] = ["=", "!="];

export const MAX_CONDITION_DEPTH = 3;
export const MAX_CONDITION_PAIRS = 32;

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
