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
  fieldPayload,
  isPristine,
  isTreePristine,
  leafConditions,
  makeGroup,
  makeRawNode,
  rawOf,
  restoreScalar,
  stamp,
  valueStrings,
  type CodecContext,
  type FilterCodec,
} from "./types";

export interface TierCondition {
  usage_key?: string;
  operator?: string;
  value?: number | string;
}

export interface TierRule {
  keys: string[];
  op: string;
  values?: string[];
  value?: number;
}

/** A pricing tier's restriction: one usage condition plus AND-ed rules. */
export interface ModelPricingFilter {
  condition?: TierCondition | null;
  rules?: TierRule[];
}

/** The id the tier's single usage condition keeps in the tree, so it is written back to `condition`. */
export const TIER_CONDITION_ID = "tier-condition";

const CONDITION_OPERATORS: Record<string, FilterOperatorId> = {
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  eq: "eq",
  neq: "neq",
};

const RULE_OPERATORS: Record<string, FilterOperatorId> = {
  in: "in",
  not_in: "not_in",
  exists: "is_not_null",
  not_exists: "is_null",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
};

const RULE_WIRE: Partial<Record<FilterOperatorId, string>> = {
  in: "in",
  not_in: "not_in",
  is_not_null: "exists",
  is_null: "not_exists",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
};

/** Operators only the usage condition can hold; a rule has no equality. */
export const TIER_CONDITION_ONLY: FilterOperatorId[] = ["eq", "neq"];

/** Operators a plain usage key takes: the usage condition's, since a rule reads usage only as `usage.<key>`. */
export const TIER_USAGE_OPERATORS: FilterOperatorId[] = Object.values(CONDITION_OPERATORS);

/** Operators a rule takes; the server's RuleOp has no `eq`/`neq`, equality on an attribute is IN / NOT IN. */
export const TIER_RULE_OPERATORS: FilterOperatorId[] = Object.values(RULE_OPERATORS);

/** Field payload marking a plain usage key (`input`), as opposed to an attribute key. */
export const TIER_USAGE_PAYLOAD = { target: "usage" } as const;

const isUsageField = (context: CodecContext, name: string) =>
  (fieldPayload(context, name) as { target?: string } | undefined)?.target === "usage";

const keysOf = (field: string) =>
  field
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

function parseCondition(condition: TierCondition): FilterNode {
  const operator = CONDITION_OPERATORS[String(condition.operator ?? "")];
  if (!operator) {
    const label = `${condition.usage_key ?? ""} ${condition.operator ?? ""} ${condition.value ?? ""}`;
    return stamp({ ...makeRawNode(label.trim()), id: TIER_CONDITION_ID }, condition);
  }
  const node: FilterCondition = {
    kind: "condition",
    id: TIER_CONDITION_ID,
    connector: "AND",
    field: String(condition.usage_key ?? ""),
    operator,
    values: valueStrings(condition.value).filter((v) => v !== ""),
  };
  return stamp(node, condition);
}

function parseRule(rule: TierRule): FilterNode {
  const operator = RULE_OPERATORS[rule.op];
  const field = (rule.keys ?? []).join(", ");
  if (!operator) return stamp(makeRawNode(`${field} ${rule.op}`), rule);
  const set = operator === "in" || operator === "not_in";
  const node: FilterCondition = {
    kind: "condition",
    id: newFilterId(),
    connector: "AND",
    field,
    operator,
    values: set ? valueStrings(rule.values) : valueStrings(rule.value),
  };
  return stamp(node, rule);
}

function writeRule(node: FilterCondition, usageKey: boolean): TierRule {
  const raw = rawOf<TierRule>(node);
  if (isPristine(node) && raw) return raw;
  const op = RULE_WIRE[node.operator] ?? node.operator;
  const keys = keysOf(node.field).map((key) => (usageKey ? `usage.${key}` : key));
  const out: TierRule = { keys, op };
  const threshold = (node.values[0] ?? "").trim();
  if (node.operator === "in" || node.operator === "not_in") out.values = [...node.values];
  else if (["gt", "gte", "lt", "lte"].includes(node.operator) && threshold !== "")
    out.value = Number(threshold);
  return out;
}

function writeCondition(node: FilterCondition): TierCondition {
  const raw = rawOf<TierCondition>(node);
  if (isPristine(node) && raw) return raw;
  return {
    ...raw,
    usage_key: node.field,
    operator: node.operator,
    value: restoreScalar(node.values[0] ?? "", true),
  };
}

/** A pricing tier's `condition` and `rules`; equality goes to the single usage condition, everything else to rules. */
export function modelPricingCodec(): FilterCodec<ModelPricingFilter> {
  return {
    parse: (saved) => {
      const items: FilterNode[] = [];
      if (saved?.condition) items.push(parseCondition(saved.condition));
      (saved?.rules ?? []).forEach((rule) => items.push(parseRule(rule)));
      return stamp(makeGroup(items, "AND", "root"), saved ?? null);
    },
    serialize: (tree: FilterGroup, context) => {
      const raw = rawOf<ModelPricingFilter>(tree);
      if (isTreePristine(tree) && raw) return raw;
      let condition: TierCondition | null = null;
      const rules: TierRule[] = [];
      for (const node of tree.items.flatMap((item) =>
        item.kind === "group" ? leafConditions(item) : [item],
      )) {
        if (node.kind === "raw") {
          if (node.id === TIER_CONDITION_ID) condition = rawOf<TierCondition>(node)!;
          else rules.push(rawOf<TierRule>(node)!);
          continue;
        }
        const usage = isUsageField(context, node.field);
        const isCondition =
          !condition &&
          (node.id === TIER_CONDITION_ID || usage || TIER_CONDITION_ONLY.includes(node.operator)) &&
          Object.hasOwn(CONDITION_OPERATORS, node.operator);
        if (isCondition) condition = writeCondition(node);
        else rules.push(writeRule(node, usage && !node.field.startsWith("usage.")));
      }
      const out: ModelPricingFilter = { ...raw, condition };
      if (rules.length || raw?.rules) out.rules = rules;
      return out;
    },
  };
}
