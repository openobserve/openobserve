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
  escapePromRegexLiteral,
  OPERATORS,
  splitPromRegexLiterals,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import { sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import {
  DASHBOARD_SPELLINGS,
  hasVariable,
  joinListText,
  splitListText,
} from "./dashboardFilterCodec";
import { flatCodec, type FlatCondition } from "./flatCodec";
import { operatorFromWire, valueStrings } from "./types";

const firstValue = (condition: FlatCondition) => condition.values[0] ?? "";

const arityOf = (operator: FilterOperatorId) => OPERATORS[operator].arity;

/** Reads a dashboard-spelled `{field, operator, value}` row; IN lists are typed as text. */
const readDashboardRow = (field: unknown, operator: unknown, value: unknown) => {
  const id = operatorFromWire(operator ?? "=");
  if (!id) return null;
  const arity = arityOf(id);
  let values: string[] = [];
  if (arity === "many") values = splitListText(value);
  else if (arity === "one") values = valueStrings(value).filter((v) => v !== "");
  return { field: String(field ?? ""), operator: id, values };
};

const dashboardValue = (condition: FlatCondition): string => {
  const arity = arityOf(condition.operator);
  if (arity === "none") return "";
  return arity === "many" ? joinListText(condition.values) : firstValue(condition);
};

const spell = (
  condition: FlatCondition,
  saved: string | undefined,
  sameOperator: boolean,
  spellings: Partial<Record<FilterOperatorId, string>>,
) => (sameOperator && saved ? saved : (spellings[condition.operator] ?? condition.operator));

export interface VariableFilter {
  name?: string;
  operator: string;
  value: string;
}

/** A dashboard variable's `query_data.filter` rows; same names as panel filters, but `!=` for not-equal. */
export const dashboardVariableCodec = () =>
  flatCodec<VariableFilter>({
    read: (item) => readDashboardRow(item.name, item.operator, item.value),
    label: (item) => [item.name, item.operator, item.value].filter(Boolean).join(" "),
    write: (condition, saved, same) => ({
      ...saved,
      name: condition.field || undefined,
      operator: spell(condition, saved?.operator, same, { ...DASHBOARD_SPELLINGS, neq: "!=" }),
      value: dashboardValue(condition),
    }),
  });

export interface AnomalyFilter {
  field: string;
  operator: string;
  value: string;
}

/** Anomaly config's flat filter rows; IN takes a quoted SQL list, as `buildAnomalyFilterExpression` inserts it verbatim. */
export const anomalyFlatCodec = () =>
  flatCodec<AnomalyFilter>({
    read: (item) => readDashboardRow(item.field, item.operator, item.value),
    label: (item) => [item.field, item.operator, item.value].filter(Boolean).join(" "),
    write: (condition, saved, same) => {
      const arity = arityOf(condition.operator);
      let value = "";
      if (arity === "many") value = condition.values.map(sqlLiteral).join(", ");
      else if (arity === "one") value = firstValue(condition);
      return {
        ...saved,
        field: condition.field,
        operator: spell(condition, saved?.operator, same, DASHBOARD_SPELLINGS),
        value,
      };
    },
  });

const PROM_OPERATORS: Record<string, FilterOperatorId> = {
  "=": "eq",
  "!=": "neq",
  "=~": "regex",
  "!~": "not_regex",
};

const PROM_LIST: Record<string, FilterOperatorId> = { "=~": "in", "!~": "not_in" };

// Dashboard `$variables` are substituted before the query runs, so they sit in an IN alternation unescaped.
const promListItem = (value: string) =>
  hasVariable(value) ? value : escapePromRegexLiteral(value);

const splitPromListText = (text: string): string[] | null => {
  if (!hasVariable(text)) return splitPromRegexLiterals(text);
  const parts = text.split(/(?<!\\)\|/);
  if (parts.length < 2) return null;
  const values: string[] = [];
  for (const part of parts) {
    if (hasVariable(part)) values.push(part);
    else {
      const literal = splitPromRegexLiterals(`${part}|`);
      if (!literal) return null;
      values.push(literal[0]);
    }
  }
  return values;
};

const readMatcher = (label: unknown, op: unknown, value: unknown): FlatCondition | null => {
  const symbol = String(op ?? "=");
  const operator = PROM_OPERATORS[symbol];
  if (!operator) return null;
  const text = String(value ?? "");
  const list = PROM_LIST[symbol] ? splitPromListText(text) : null;
  const resolved = list ? PROM_LIST[symbol] : operator;
  // `label=""` is a real PromQL matcher (label absent), so an empty value is kept for = and !=.
  const keepsEmpty = resolved === "eq" || resolved === "neq";
  return {
    field: String(label ?? ""),
    operator: resolved,
    values: list ?? (text || keepsEmpty ? [text] : []),
  };
};

const writeMatcher = (condition: FlatCondition): { op: string; value: string } => {
  switch (condition.operator) {
    case "neq":
      return { op: "!=", value: firstValue(condition) };
    case "regex":
      return { op: "=~", value: firstValue(condition) };
    case "not_regex":
      return { op: "!~", value: firstValue(condition) };
    case "in":
    case "not_in":
      return {
        op: condition.operator === "in" ? "=~" : "!~",
        value: condition.values.map(promListItem).join("|"),
      };
    default:
      return { op: "=", value: firstValue(condition) };
  }
};

export interface PromqlMatcher {
  label: string;
  op: string;
  value: string;
}

/** The PromQL query builder's `{label, op, value}` matchers; IN is an anchored alternation of escaped literals. */
export const promqlLabelsCodec = () =>
  flatCodec<PromqlMatcher>({
    read: (item) => readMatcher(item.label, item.op, item.value),
    label: (item) => `${item.label}${item.op}${item.value}`,
    write: (condition, saved) => ({ ...saved, label: condition.field, ...writeMatcher(condition) }),
  });

export interface MetricsLabelFilter {
  label: string;
  operator?: string;
  value: string;
}

/** The metrics explorer's `{label, operator, value}` filters. */
export const metricsLabelsCodec = () =>
  flatCodec<MetricsLabelFilter>({
    read: (item) => readMatcher(item.label, item.operator, item.value),
    label: (item) => `${item.label}${item.operator ?? "="}${item.value}`,
    write: (condition, saved) => {
      const { op, value } = writeMatcher(condition);
      return { ...saved, label: condition.field, operator: op, value };
    },
  });

export interface ProfileLabelFilter {
  key: string;
  op: string;
  value: string;
  values?: string[];
}

// Every spelling the profiles API accepts, read case-insensitively.
const PROFILE_OPERATORS: Record<string, FilterOperatorId> = {
  "=": "eq",
  "!=": "neq",
  "<>": "neq",
  "=~": "regex",
  re_match: "regex",
  "!~": "not_regex",
  re_not_match: "not_regex",
  in: "in",
  not_in: "not_in",
  "not in": "not_in",
};

const PROFILE_WIRE: Partial<Record<FilterOperatorId, string>> = {
  eq: "=",
  neq: "!=",
  regex: "=~",
  not_regex: "!~",
  in: "in",
  not_in: "not_in",
};

/** Profiles' label filters; a list operator sends `values` and the server splits `value` on commas otherwise. */
export const profilesCodec = () =>
  flatCodec<ProfileLabelFilter>({
    read: (item) => {
      const operator =
        PROFILE_OPERATORS[
          String(item.op ?? "=")
            .trim()
            .toLowerCase()
        ];
      if (!operator) return null;
      if (arityOf(operator) === "many") {
        const list = item.values?.length
          ? item.values
          : String(item.value ?? "")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
        return { field: item.key, operator, values: [...list] };
      }
      return { field: item.key, operator, values: item.value ? [item.value] : [] };
    },
    label: (item) => `${item.key} ${item.op} ${item.values?.join(", ") ?? item.value}`,
    write: (condition, saved, same) => {
      const rest: Partial<ProfileLabelFilter> = { ...saved };
      delete rest.values;
      const op = same && saved ? saved.op : (PROFILE_WIRE[condition.operator] ?? "=");
      if (arityOf(condition.operator) === "many")
        return { ...rest, key: condition.field, op, value: "", values: [...condition.values] };
      return { ...rest, key: condition.field, op, value: firstValue(condition) };
    },
  });

const SYNTHETICS_OPERATORS: Record<string, FilterOperatorId> = {
  eq: "eq",
  ne: "neq",
  lt: "lt",
  gt: "gt",
  contains: "contains",
  not_contains: "not_contains",
};

const SYNTHETICS_WIRE: Partial<Record<FilterOperatorId, string>> = {
  eq: "eq",
  neq: "ne",
  lt: "lt",
  gt: "gt",
  contains: "contains",
  not_contains: "not_contains",
};

export interface SyntheticsAssertion {
  field: string;
  operator: string;
  value: string;
}

/** HTTP check assertions on the fixed response fields, with the prober's six operators. */
export const syntheticsCodec = () =>
  flatCodec<SyntheticsAssertion>({
    read: (item) => {
      const operator = SYNTHETICS_OPERATORS[item.operator];
      if (!operator) return null;
      return { field: item.field, operator, values: item.value ? [String(item.value)] : [] };
    },
    label: (item) => `${item.field} ${item.operator} ${item.value}`,
    write: (condition, saved) => ({
      ...saved,
      field: condition.field,
      operator: SYNTHETICS_WIRE[condition.operator] ?? condition.operator,
      value: firstValue(condition),
    }),
  });

type MatchOp = "eq" | "in" | "prefix" | "suffix" | "contains" | "regex";

const RUM_OPERATORS: Record<MatchOp, [FilterOperatorId, FilterOperatorId]> = {
  eq: ["in", "not_in"],
  in: ["in", "not_in"],
  contains: ["contains", "not_contains"],
  prefix: ["starts_with", "not_starts_with"],
  suffix: ["ends_with", "not_ends_with"],
  regex: ["regex", "not_regex"],
};

const RUM_WIRE: Partial<Record<FilterOperatorId, { op: MatchOp; not: boolean }>> = {
  in: { op: "in", not: false },
  not_in: { op: "in", not: true },
  contains: { op: "contains", not: false },
  not_contains: { op: "contains", not: true },
  starts_with: { op: "prefix", not: false },
  not_starts_with: { op: "prefix", not: true },
  ends_with: { op: "suffix", not: false },
  not_ends_with: { op: "suffix", not: true },
  regex: { op: "regex", not: false },
  not_regex: { op: "regex", not: true },
};

const readRum = (field: string, op: string, values: unknown, not: boolean) => {
  const pair = RUM_OPERATORS[op as MatchOp];
  if (!pair) return null;
  return { field, operator: pair[not ? 1 : 0], values: valueStrings(values) };
};

export interface RumFunnelFilter {
  field: string;
  op: MatchOp;
  values: string[];
  not?: true;
}

/** Funnel "Filter all steps" rules: any-of values per rule, negated with `not`. */
export const rumFunnelCodec = () =>
  flatCodec<RumFunnelFilter>({
    read: (item) => readRum(item.field, item.op, item.values, item.not === true),
    label: (item) => `${item.field} ${item.not ? "not " : ""}${item.op} ${item.values.join(", ")}`,
    write: (condition, saved, same) => {
      const wire = RUM_WIRE[condition.operator] ?? { op: "in" as MatchOp, not: false };
      const rest: Partial<RumFunnelFilter> = { ...saved };
      delete rest.not;
      return {
        ...rest,
        field: condition.field,
        op: same && saved ? saved.op : wire.op,
        values: [...condition.values],
        ...(wire.not ? { not: true as const } : {}),
      };
    },
  });

export interface RumSessionRule {
  field: string;
  op: MatchOp;
  values: string[];
}

/** App-wide session exclusion rules; the server has no negation for them. */
export const rumExclusionCodec = () =>
  flatCodec<RumSessionRule>({
    read: (item) => readRum(item.field, item.op, item.values, false),
    label: (item) => `${item.field} ${item.op} ${item.values.join(", ")}`,
    write: (condition, saved, same) => ({
      ...saved,
      field: condition.field,
      op: same && saved ? saved.op : (RUM_WIRE[condition.operator]?.op ?? "in"),
      values: [...condition.values],
    }),
  });
