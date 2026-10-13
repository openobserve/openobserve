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

import type { I18nKey } from "@/types/i18n";
import type { DimensionCondition } from "@/services/downtimes";
import { DOWNTIME_OPERATORS, MAX_CONDITION_DEPTH, MAX_CONDITION_PAIRS } from "./conditionBridge";

const depth = (c: DimensionCondition): number =>
  c.type === "pair" ? 0 : 1 + Math.max(0, ...c.items.map(depth));

const pairCount = (c: DimensionCondition): number =>
  c.type === "pair" ? 1 : c.items.reduce((sum, i) => sum + pairCount(i), 0);

/** Every way to satisfy the tree holds an `=` pair, so `!=` alone cannot silence an org. */
export const requiresEq = (c: DimensionCondition): boolean => {
  if (c.type === "pair") return c.operator === "=";
  if (c.op === "and") return c.items.some(requiresEq);
  return c.items.length > 0 && c.items.every(requiresEq);
};

const pairError = (c: Extract<DimensionCondition, { type: "pair" }>): I18nKey | null => {
  if (!c.key) return "alerts.downtimes.validation.pairKey";
  if (!DOWNTIME_OPERATORS.includes(c.operator)) return "alerts.downtimes.validation.pairOperator";
  if (!c.value) return "alerts.downtimes.validation.pairValue";
  if (c.value === "*") return "alerts.downtimes.validation.loneStar";
  if (c.value.slice(0, -1).includes("*")) return "alerts.downtimes.validation.innerStar";
  return null;
};

const nodeError = (c: DimensionCondition): I18nKey | null => {
  if (c.type === "pair") return pairError(c);
  if (c.items.length === 0) return "alerts.downtimes.validation.emptyGroup";
  for (const item of c.items) {
    const err = nodeError(item);
    if (err) return err;
  }
  return null;
};

/** The page twin of the backend `validate_condition`; returns the first broken rule as a key. */
export function conditionError(cond: DimensionCondition | null): I18nKey | null {
  if (!cond) return "alerts.downtimes.validation.conditionRequired";
  if (depth(cond) > MAX_CONDITION_DEPTH) return "alerts.downtimes.validation.tooDeep";
  if (pairCount(cond) > MAX_CONDITION_PAIRS) return "alerts.downtimes.validation.tooManyPairs";
  const node = nodeError(cond);
  if (node) return node;
  if (!requiresEq(cond)) return "alerts.downtimes.validation.needsEq";
  return null;
}
