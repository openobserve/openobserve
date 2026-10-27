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

import type { I18nKey } from "@/types/i18n";
import { sqlIsNull, sqlLike, sqlLiteral } from "@/utils/query/sqlFilterBuilder";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";

export type FilterFieldType = "string" | "number" | "boolean";

/** Which query language the filters compile to; PromQL label matchers cannot express OR. */
export type FilterDialect = "sql" | "promql";

export type FilterConnector = "AND" | "OR";

export type FilterOperatorId =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "in"
  | "not_in"
  | "regex"
  | "not_regex"
  | "is_null"
  | "is_not_null"
  | "match_all";

export interface FilterField {
  name: string;
  type: FilterFieldType;
}

export interface FilterOperatorDef {
  id: FilterOperatorId;
  /** Short form drawn on the chip; symbols and SQL words stay untranslated. */
  symbol: string;
  labelKey: I18nKey;
  /** How many values the operator takes. */
  arity: "none" | "one" | "many";
}

export interface FilterCondition {
  kind: "condition";
  id: string;
  /** Joins this node to the previous sibling; ignored on the first node of a group. */
  connector: FilterConnector;
  field: string;
  operator: FilterOperatorId;
  values: string[];
}

export interface FilterGroup {
  kind: "group";
  id: string;
  connector: FilterConnector;
  items: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export const OPERATORS: Record<FilterOperatorId, FilterOperatorDef> = {
  eq: { id: "eq", symbol: "=", labelKey: "filterBar.operators.eq", arity: "one" },
  neq: { id: "neq", symbol: "!=", labelKey: "filterBar.operators.neq", arity: "one" },
  gt: { id: "gt", symbol: ">", labelKey: "filterBar.operators.gt", arity: "one" },
  gte: { id: "gte", symbol: ">=", labelKey: "filterBar.operators.gte", arity: "one" },
  lt: { id: "lt", symbol: "<", labelKey: "filterBar.operators.lt", arity: "one" },
  lte: { id: "lte", symbol: "<=", labelKey: "filterBar.operators.lte", arity: "one" },
  contains: {
    id: "contains",
    symbol: "contains",
    labelKey: "filterBar.operators.contains",
    arity: "one",
  },
  not_contains: {
    id: "not_contains",
    symbol: "not contains",
    labelKey: "filterBar.operators.notContains",
    arity: "one",
  },
  starts_with: {
    id: "starts_with",
    symbol: "starts with",
    labelKey: "filterBar.operators.startsWith",
    arity: "one",
  },
  ends_with: {
    id: "ends_with",
    symbol: "ends with",
    labelKey: "filterBar.operators.endsWith",
    arity: "one",
  },
  in: { id: "in", symbol: "in", labelKey: "filterBar.operators.in", arity: "many" },
  not_in: { id: "not_in", symbol: "not in", labelKey: "filterBar.operators.notIn", arity: "many" },
  regex: { id: "regex", symbol: "=~", labelKey: "filterBar.operators.regex", arity: "one" },
  not_regex: {
    id: "not_regex",
    symbol: "!~",
    labelKey: "filterBar.operators.notRegex",
    arity: "one",
  },
  is_null: {
    id: "is_null",
    symbol: "is null",
    labelKey: "filterBar.operators.isNull",
    arity: "none",
  },
  is_not_null: {
    id: "is_not_null",
    symbol: "is not null",
    labelKey: "filterBar.operators.isNotNull",
    arity: "none",
  },
  match_all: {
    id: "match_all",
    symbol: "matches",
    labelKey: "filterBar.operators.matchAll",
    arity: "one",
  },
};

const SQL_OPERATORS: Record<FilterFieldType, FilterOperatorId[]> = {
  string: [
    "eq",
    "neq",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
    "regex",
    "not_regex",
    "is_null",
    "is_not_null",
  ],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "is_not_null"],
  boolean: ["eq", "neq", "is_null", "is_not_null"],
};

const PROMQL_OPERATORS: FilterOperatorId[] = ["eq", "neq", "regex", "not_regex", "in", "not_in"];

const NUMERIC_TYPES = new Set([
  "int8",
  "int16",
  "int32",
  "int64",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float16",
  "float32",
  "float64",
  "decimal",
  "integer",
  "long",
  "double",
  "float",
  "number",
]);

const NUMBER_PATTERN = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

let idCounter = 0;

/** Maps a stream schema type (Utf8, Int64, Float64, Boolean, ...) onto the bar's three kinds. */
export const toFilterFieldType = (schemaType: string | undefined): FilterFieldType => {
  const normalized = (schemaType ?? "").toLowerCase();
  if (normalized === "boolean" || normalized === "bool") return "boolean";
  if (NUMERIC_TYPES.has(normalized)) return "number";
  return "string";
};

export const operatorsFor = (type: FilterFieldType, dialect: FilterDialect): FilterOperatorDef[] =>
  (dialect === "promql" ? PROMQL_OPERATORS : SQL_OPERATORS[type]).map((id) => OPERATORS[id]);

export const newFilterId = (): string => `f${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export const emptyFilterGroup = (): FilterGroup => ({
  kind: "group",
  id: "root",
  connector: "AND",
  items: [],
});

/** A condition is complete when its operator has all the values it needs. */
export const isConditionComplete = (condition: FilterCondition): boolean => {
  const arity = OPERATORS[condition.operator].arity;
  if (arity === "none") return true;
  return condition.values.length > 0;
};

export const countConditions = (node: FilterNode): number =>
  node.kind === "condition"
    ? 1
    : node.items.reduce((total, child) => total + countConditions(child), 0);

const sqlValue = (value: string, type: FilterFieldType): string => {
  if (type === "number" && NUMBER_PATTERN.test(value.trim())) return value.trim();
  if (type === "boolean" && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase();
  return sqlLiteral(value);
};

const conditionToSql = (condition: FilterCondition, fieldTypes: Map<string, FilterFieldType>) => {
  const column = quoteSqlIdentifierIfNeeded(condition.field);
  const type = fieldTypes.get(condition.field) ?? "string";
  const [first = ""] = condition.values;
  switch (condition.operator) {
    case "eq":
      return `${column} = ${sqlValue(first, type)}`;
    case "neq":
      return `${column} != ${sqlValue(first, type)}`;
    case "gt":
      return `${column} > ${sqlValue(first, type)}`;
    case "gte":
      return `${column} >= ${sqlValue(first, type)}`;
    case "lt":
      return `${column} < ${sqlValue(first, type)}`;
    case "lte":
      return `${column} <= ${sqlValue(first, type)}`;
    case "contains":
      return `str_match(${column}, ${sqlLiteral(first)})`;
    case "not_contains":
      return sqlLike(column, first, "contains", true);
    case "starts_with":
      return sqlLike(column, first, "start");
    case "ends_with":
      return sqlLike(column, first, "end");
    case "in":
    case "not_in": {
      const list = condition.values.map((value) => sqlValue(value, type)).join(", ");
      return `${column} ${condition.operator === "in" ? "IN" : "NOT IN"} (${list})`;
    }
    case "regex":
      return `re_match(${column}, ${sqlLiteral(first)})`;
    case "not_regex":
      return `re_not_match(${column}, ${sqlLiteral(first)})`;
    case "is_null":
      return sqlIsNull(column);
    case "is_not_null":
      return sqlIsNull(column, true);
    case "match_all":
      return `match_all(${sqlLiteral(first)})`;
  }
};

const groupToSql = (
  group: FilterGroup,
  fieldTypes: Map<string, FilterFieldType>,
  nested: boolean,
): string => {
  const parts: string[] = [];
  for (const item of group.items) {
    const sql =
      item.kind === "condition"
        ? isConditionComplete(item)
          ? conditionToSql(item, fieldTypes)
          : ""
        : groupToSql(item, fieldTypes, true);
    if (!sql) continue;
    parts.push(parts.length ? `${item.connector} ${sql}` : sql);
  }
  if (!parts.length) return "";
  const joined = parts.join(" ");
  return nested && parts.length > 1 ? `(${joined})` : joined;
};

/** Compiles the tree into a SQL boolean expression (no leading WHERE); empty when nothing is set. */
export const filterTreeToSql = (root: FilterGroup, fields: FilterField[]): string =>
  groupToSql(root, new Map(fields.map((field) => [field.name, field.type])), false);

const escapePromValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export const escapePromRegexLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const conditionToPromMatcher = (condition: FilterCondition): string => {
  const [first = ""] = condition.values;
  const label = condition.field;
  switch (condition.operator) {
    case "neq":
      return `${label}!="${escapePromValue(first)}"`;
    case "regex":
      return `${label}=~"${escapePromValue(first)}"`;
    case "not_regex":
      return `${label}!~"${escapePromValue(first)}"`;
    case "in":
    case "not_in": {
      const alternation = condition.values.map(escapePromRegexLiteral).join("|");
      return `${label}${condition.operator === "in" ? "=~" : "!~"}"${escapePromValue(alternation)}"`;
    }
    default:
      return `${label}="${escapePromValue(first)}"`;
  }
};

const flattenConditions = (node: FilterNode): FilterCondition[] =>
  node.kind === "condition" ? [node] : node.items.flatMap(flattenConditions);

/** Builds a condition with a fresh id. */
export const makeCondition = (
  field: string,
  operator: FilterOperatorId,
  values: string[],
  connector: FilterConnector = "AND",
): FilterCondition => ({
  kind: "condition",
  id: newFilterId(),
  connector,
  field,
  operator,
  values,
});

/** PromQL label matchers for the complete conditions; connectors are ignored because PromQL ANDs every matcher. */
export const filterTreeToPromMatchers = (root: FilterGroup): string[] =>
  flattenConditions(root).filter(isConditionComplete).map(conditionToPromMatcher);

/** Wraps a metric selector with the matchers, merging them into any matchers it already has. */
export const applyPromMatchers = (metric: string, matchers: string[]): string => {
  if (!matchers.length) return metric;
  const open = metric.indexOf("{");
  if (open === -1) return `${metric}{${matchers.join(", ")}}`;
  const close = metric.lastIndexOf("}");
  const existing = metric.slice(open + 1, close).trim();
  const merged = existing ? [existing, ...matchers] : matchers;
  return `${metric.slice(0, open)}{${merged.join(", ")}}${metric.slice(close + 1)}`;
};

/** Removes every connector except AND and every group, so a tree built in advanced mode fits basic mode. */
export const flattenToBasic = (root: FilterGroup): FilterGroup => ({
  ...root,
  items: flattenConditions(root).map((condition) => ({ ...condition, connector: "AND" })),
});

/** True when the tree uses anything basic mode cannot draw (an OR or a nested group). */
export const needsAdvancedMode = (root: FilterGroup): boolean =>
  root.items.some((item, index) => item.kind === "group" || (index > 0 && item.connector === "OR"));

const mapGroup = (group: FilterGroup, fn: (items: FilterNode[]) => FilterNode[]): FilterGroup => ({
  ...group,
  items: fn(group.items).map((item) => (item.kind === "group" ? mapGroup(item, fn) : item)),
});

/** Returns a copy of the tree with the node `id` replaced. */
export const replaceNode = (root: FilterGroup, id: string, next: FilterNode): FilterGroup =>
  mapGroup(root, (items) => items.map((item) => (item.id === id ? next : item)));

/** Returns a copy of the tree without node `id`; a group left empty is removed too, unless it is `keepGroupId`. */
export const removeNode = (
  root: FilterGroup,
  id: string,
  keepGroupId?: string | null,
): FilterGroup => {
  const prune = (group: FilterGroup): FilterGroup => ({
    ...group,
    items: group.items
      .filter((item) => item.id !== id)
      .map((item) => (item.kind === "group" ? prune(item) : item))
      .filter(
        (item) => item.kind === "condition" || item.items.length > 0 || item.id === keepGroupId,
      ),
  });
  return prune(root);
};

/** Returns a copy of the tree with `node` appended to the group `groupId` (the root when absent). */
export const appendNode = (
  root: FilterGroup,
  node: FilterNode,
  groupId?: string | null,
): FilterGroup => {
  if (!groupId || groupId === root.id) return { ...root, items: [...root.items, node] };
  return mapGroup(root, (items) =>
    items.map((item) =>
      item.id === groupId && item.kind === "group"
        ? { ...item, items: [...item.items, node] }
        : item,
    ),
  );
};

export const findNode = (group: FilterGroup, id: string): FilterNode | undefined => {
  for (const item of group.items) {
    if (item.id === id) return item;
    if (item.kind === "group") {
      const found = findNode(item, id);
      if (found) return found;
    }
  }
  return undefined;
};

export const toggleConnector = (root: FilterGroup, id: string): FilterGroup => {
  const node = findNode(root, id);
  if (!node) return root;
  return replaceNode(root, id, { ...node, connector: node.connector === "AND" ? "OR" : "AND" });
};

/** The value shown on a chip: `a, b` for lists, nothing for null checks. */
export const conditionValueLabel = (condition: FilterCondition): string =>
  OPERATORS[condition.operator].arity === "none" ? "" : condition.values.join(", ");

/** Field-list rows as the bar needs them; stream header rows and duplicates across streams are dropped. */
export const toFilterFields = (
  rows: { name?: string; dataType?: string; type?: string; label?: boolean }[],
): FilterField[] => {
  const seen = new Map<string, FilterField>();
  for (const row of rows) {
    if (!row?.name || row.label || seen.has(row.name)) continue;
    seen.set(row.name, { name: row.name, type: toFilterFieldType(row.dataType ?? row.type) });
  }
  return [...seen.values()];
};
