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
  | "contains_ci"
  | "not_contains"
  | "starts_with"
  | "not_starts_with"
  | "ends_with"
  | "not_ends_with"
  | "in"
  | "not_in"
  | "regex"
  | "not_regex"
  | "is_null"
  | "is_not_null"
  | "is_empty"
  | "is_not_empty"
  | "match_all";

export type FilterArity = "none" | "one" | "many";

export interface FilterField {
  name: string;
  type: FilterFieldType;
  /** Display name when it differs from `name` (a workflow's dotted path for a flattened column). */
  label?: string;
  /** Opaque page data a codec writes back for this field, e.g. a dashboard column's stream alias. */
  payload?: unknown;
  /** Narrows the profile's operators for this one field. */
  operators?: FilterOperatorId[];
}

/** The saved payload a node was parsed from, so a codec can write an untouched node back unchanged. */
export interface FilterNodeMeta {
  raw: unknown;
  /** The node's editable state when it was parsed; a differing state means the user changed it. */
  sig: string;
}

export interface FilterOperatorDef {
  id: FilterOperatorId;
  /** Name shown on the chip and picker, as dashboards and alerts write it; symbols and SQL words stay untranslated. */
  symbol: string;
  /** Translated name used instead of `symbol` for word operators. */
  nameKey?: I18nKey;
  /** PromQL's own spelling, where it differs from the SQL name. */
  promqlSymbol?: string;
  /** Plain-language hint shown beside the name. */
  labelKey: I18nKey;
  /** How many values the operator takes. */
  arity: FilterArity;
}

export interface FilterCondition {
  kind: "condition";
  id: string;
  /** Joins this node to the previous sibling; ignored on the first node of a group. */
  connector: FilterConnector;
  field: string;
  operator: FilterOperatorId;
  values: string[];
  /** Keywords of a parsed `IS [NOT] TRUE|FALSE`, kept because `!= true` drops NULLs and `IS NOT TRUE` keeps them. */
  isSpelling?: FilterIsSpelling;
  meta?: FilterNodeMeta;
}

/** The words of a boolean `IS` test as typed, so it compiles back byte for byte. */
export interface FilterIsSpelling {
  is: string;
  not: string;
  literal: string;
}

export interface FilterGroup {
  kind: "group";
  id: string;
  connector: FilterConnector;
  items: FilterNode[];
  meta?: FilterNodeMeta;
}

/** A saved part the codec cannot show as a condition; drawn locked, removable, and saved back as loaded. */
export interface FilterRawNode {
  kind: "raw";
  id: string;
  connector: FilterConnector;
  label: string;
  /** The SQL it stands for, when the bar compiles to SQL. */
  sql?: string;
  meta?: FilterNodeMeta;
}

export type FilterNode = FilterCondition | FilterGroup | FilterRawNode;

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
    nameKey: "dashboard.filterOperators.contains",
    labelKey: "filterBar.operators.contains",
    arity: "one",
  },
  contains_ci: {
    id: "contains_ci",
    symbol: "contains ignore case",
    nameKey: "filterBar.operatorNames.containsIgnoreCase",
    labelKey: "filterBar.operators.containsIgnoreCase",
    arity: "one",
  },
  not_contains: {
    id: "not_contains",
    symbol: "not contains",
    nameKey: "dashboard.filterOperators.notContains",
    labelKey: "filterBar.operators.notContains",
    arity: "one",
  },
  starts_with: {
    id: "starts_with",
    symbol: "starts with",
    nameKey: "dashboard.filterOperators.startsWith",
    labelKey: "filterBar.operators.startsWith",
    arity: "one",
  },
  not_starts_with: {
    id: "not_starts_with",
    symbol: "not starts with",
    nameKey: "filterBar.operatorNames.notStartsWith",
    labelKey: "filterBar.operators.notStartsWith",
    arity: "one",
  },
  ends_with: {
    id: "ends_with",
    symbol: "ends with",
    nameKey: "dashboard.filterOperators.endsWith",
    labelKey: "filterBar.operators.endsWith",
    arity: "one",
  },
  not_ends_with: {
    id: "not_ends_with",
    symbol: "not ends with",
    nameKey: "filterBar.operatorNames.notEndsWith",
    labelKey: "filterBar.operators.notEndsWith",
    arity: "one",
  },
  in: { id: "in", symbol: "IN", labelKey: "filterBar.operators.in", arity: "many" },
  not_in: { id: "not_in", symbol: "NOT IN", labelKey: "filterBar.operators.notIn", arity: "many" },
  regex: {
    id: "regex",
    symbol: "re_match",
    promqlSymbol: "=~",
    labelKey: "filterBar.operators.regex",
    arity: "one",
  },
  not_regex: {
    id: "not_regex",
    symbol: "re_not_match",
    promqlSymbol: "!~",
    labelKey: "filterBar.operators.notRegex",
    arity: "one",
  },
  is_null: {
    id: "is_null",
    symbol: "is null",
    nameKey: "dashboard.filterOperators.isNull",
    labelKey: "filterBar.operators.isNull",
    arity: "none",
  },
  is_not_null: {
    id: "is_not_null",
    symbol: "is not null",
    nameKey: "dashboard.filterOperators.isNotNull",
    labelKey: "filterBar.operators.isNotNull",
    arity: "none",
  },
  is_empty: {
    id: "is_empty",
    symbol: "is empty",
    nameKey: "filterBar.operatorNames.isEmpty",
    labelKey: "filterBar.operators.isEmpty",
    arity: "none",
  },
  is_not_empty: {
    id: "is_not_empty",
    symbol: "is not empty",
    nameKey: "filterBar.operatorNames.isNotEmpty",
    labelKey: "filterBar.operators.isNotEmpty",
    arity: "none",
  },
  match_all: {
    id: "match_all",
    symbol: "match_all",
    labelKey: "filterBar.operators.matchAll",
    arity: "one",
  },
};

const SQL_OPERATORS: Record<FilterFieldType, FilterOperatorId[]> = {
  string: [
    "eq",
    "neq",
    "contains",
    "contains_ci",
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

/** A condition is complete when it names a field (free text excepted) and has every value its operator needs. */
export const isConditionComplete = (condition: FilterCondition): boolean => {
  if (!OPERATORS[condition.operator]) return false;
  if (!condition.field && condition.operator !== "match_all") return false;
  const arity = OPERATORS[condition.operator].arity;
  if (arity === "none") return true;
  return condition.values.length > 0;
};

/** Conditions and locked parts in the tree; groups only count what they hold. */
export const countConditions = (node: FilterNode): number =>
  node.kind === "group"
    ? node.items.reduce((total, child) => total + countConditions(child), 0)
    : 1;

/** How many group levels the tree has, the root included; a flat list is 1. */
export const treeDepth = (group: FilterGroup): number =>
  1 + Math.max(0, ...group.items.map((item) => (item.kind === "group" ? treeDepth(item) : 0)));

const sqlValue = (value: string, type: FilterFieldType): string => {
  if (type === "number" && NUMBER_PATTERN.test(value.trim())) return value.trim();
  if (type === "boolean" && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase();
  return sqlLiteral(value);
};

const isTestSql = (condition: FilterCondition, column: string, value: string): string | null => {
  const spelling = condition.isSpelling;
  if (!spelling || (condition.operator !== "eq" && condition.operator !== "neq")) return null;
  const lower = value.trim().toLowerCase();
  if (lower !== "true" && lower !== "false") return null;
  const literal = spelling.literal.toLowerCase() === lower ? spelling.literal : lower;
  const keyword = condition.operator === "neq" ? `${spelling.is} ${spelling.not}` : spelling.is;
  return `${column} ${keyword} ${literal}`;
};

const conditionToSql = (condition: FilterCondition, fieldTypes: Map<string, FilterFieldType>) => {
  const column = quoteSqlIdentifierIfNeeded(condition.field);
  const type = fieldTypes.get(condition.field) ?? "string";
  const [first = ""] = condition.values;
  const isTest = isTestSql(condition, column, first);
  if (isTest) return isTest;
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
    case "contains_ci":
      return `str_match_ignore_case(${column}, ${sqlLiteral(first)})`;
    case "not_contains":
      return sqlLike(column, first, "contains", true);
    case "starts_with":
      return sqlLike(column, first, "start");
    case "not_starts_with":
      return sqlLike(column, first, "start", true);
    case "ends_with":
      return sqlLike(column, first, "end");
    case "not_ends_with":
      return sqlLike(column, first, "end", true);
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
    case "is_empty":
      return `(${sqlIsNull(column)} OR ${column} = '')`;
    case "is_not_empty":
      return `(${sqlIsNull(column, true)} AND ${column} != '')`;
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
    let sql = "";
    if (item.kind === "raw") sql = item.sql ? `(${item.sql})` : "";
    else if (item.kind === "group") sql = groupToSql(item, fieldTypes, true);
    else if (isConditionComplete(item)) sql = conditionToSql(item, fieldTypes);
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

const PROM_REGEX_META = ".*+?^${}()|[]\\";

/** The values of a regex made only of escaped literals joined by `|`, as `is any of` writes it; null otherwise. */
export const splitPromRegexLiterals = (pattern: string): string[] | null => {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[++i];
      if (next === undefined || !PROM_REGEX_META.includes(next)) return null;
      current += next;
    } else if (char === "|") {
      parts.push(current);
      current = "";
    } else if (PROM_REGEX_META.includes(char)) {
      return null;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.length > 1 ? parts : null;
};

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

const flattenConditions = (node: FilterNode): FilterCondition[] => {
  if (node.kind === "raw") return [];
  return node.kind === "condition" ? [node] : node.items.flatMap(flattenConditions);
};

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
      .filter((item) => item.kind !== "group" || item.items.length > 0 || item.id === keepGroupId),
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

/** Returns a copy of the tree with `node` placed at `index` of group `groupId` (the root when absent); past the end appends. */
export const insertNode = (
  root: FilterGroup,
  node: FilterNode,
  groupId: string | null | undefined,
  index: number,
): FilterGroup => {
  const place = (items: FilterNode[]) => {
    const at = Math.max(0, Math.min(index, items.length));
    return [...items.slice(0, at), node, ...items.slice(at)];
  };
  if (!groupId || groupId === root.id) return { ...root, items: place(root.items) };
  return mapGroup(root, (items) =>
    items.map((item) =>
      item.id === groupId && item.kind === "group" ? { ...item, items: place(item.items) } : item,
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

/** The group holding node `id`; the root for a top-level node. */
export const findParent = (root: FilterGroup, id: string): FilterGroup | undefined => {
  if (root.items.some((item) => item.id === id)) return root;
  for (const item of root.items) {
    if (item.kind !== "group") continue;
    const found = findParent(item, id);
    if (found) return found;
  }
  return undefined;
};

/** The group's level, the root being 1; 0 when the id is not a group in the tree. */
export const groupLevel = (root: FilterGroup, id: string, level = 1): number => {
  if (root.id === id) return level;
  for (const item of root.items) {
    if (item.kind !== "group") continue;
    const found = groupLevel(item, id, level + 1);
    if (found) return found;
  }
  return 0;
};

/** Sets every connector inside group `id` after its first item, as a group-wide AND/OR does. */
export const setGroupConnector = (
  root: FilterGroup,
  id: string,
  connector: FilterConnector,
): FilterGroup => {
  const apply = (group: FilterGroup): FilterGroup => ({
    ...group,
    items: group.items.map((item, index) =>
      index === 0 || item.connector === connector ? item : { ...item, connector },
    ),
  });
  if (root.id === id) return apply(root);
  const group = findNode(root, id);
  return group?.kind === "group" ? replaceNode(root, id, apply(group)) : root;
};

/** Lifts a group's items into its parent in place; the first one takes the group's own connector. */
export const ungroupNode = (root: FilterGroup, id: string): FilterGroup => {
  const parent = findParent(root, id);
  const group = parent?.items.find((item) => item.id === id);
  if (!parent || group?.kind !== "group") return root;
  const lifted = group.items.map((item, index) =>
    index === 0 && item.connector !== group.connector
      ? { ...item, connector: group.connector }
      : item,
  );
  const items = parent.items.flatMap((item) => (item.id === id ? lifted : [item]));
  const next = { ...parent, items };
  return parent.id === root.id ? next : replaceNode(root, parent.id, next);
};

/** Whether lifting group `id` into its parent keeps the filter's meaning; `perGroup` allows one AND/OR per group. */
export const canUngroupNode = (root: FilterGroup, id: string, perGroup = false): boolean => {
  const parent = findParent(root, id);
  const index = parent ? parent.items.findIndex((item) => item.id === id) : -1;
  const group = parent?.items[index];
  if (!parent || group?.kind !== "group") return false;
  if (group.items.length <= 1) return true;
  const inner = group.items.slice(1).map((item) => item.connector);
  if (perGroup) {
    const outer = parent.items.slice(1).map((item) => item.connector);
    return outer.every((connector) => connector === inner[0]);
  }
  // AND binds tighter than OR, so an all-AND group reads the same unbracketed; an OR inside needs OR on both sides.
  if (inner.every((connector) => connector === "AND")) return true;
  const before = index > 0 ? group.connector : "OR";
  const after = parent.items[index + 1]?.connector ?? "OR";
  return before === "OR" && after === "OR";
};

/** A node's position as indexes from the root, joined by `-`; used for stable test ids. */
export const nodePath = (root: FilterGroup, id: string, prefix = ""): string | null => {
  for (const [index, item] of root.items.entries()) {
    const path = prefix ? `${prefix}-${index}` : String(index);
    if (item.id === id) return path;
    if (item.kind === "group") {
      const found = nodePath(item, id, path);
      if (found) return found;
    }
  }
  return null;
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
