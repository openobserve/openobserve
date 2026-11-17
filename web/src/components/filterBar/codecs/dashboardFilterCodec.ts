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
  OPERATORS,
  type FilterCondition,
  type FilterConnector,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import {
  fieldPayload,
  isPlainObject,
  isPristine,
  isTreePristine,
  makeGroup,
  makeRawNode,
  nodeSig,
  operatorFromWire,
  parsedField,
  parsedOperator,
  rawOf,
  stamp,
  toConnector,
  valueStrings,
  type CodecContext,
  type FilterCodec,
} from "./types";

export interface DashboardColumn {
  field: string;
  streamAlias?: string | null;
}

export interface DashboardFilterCondition {
  type: "list" | "condition";
  column: DashboardColumn | string;
  filterType: "condition";
  operator: string | null;
  value: unknown;
  logicalOperator: FilterConnector;
  values: unknown[];
  /** A `x <> ''` that came from SQL: a real filter, unlike a value not entered yet. */
  emptyLiteral?: boolean;
}

export interface DashboardFilterGroup {
  filterType: "group";
  logicalOperator: FilterConnector;
  conditions: (DashboardFilterCondition | DashboardFilterGroup)[];
}

/** Dashboards' own operator names, as the panel SQL builder switches on them. */
export const DASHBOARD_SPELLINGS: Partial<Record<FilterOperatorId, string>> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "IN",
  not_in: "NOT IN",
  contains: "Contains",
  contains_ci: "str_match_ignore_case",
  not_contains: "Not Contains",
  starts_with: "Starts With",
  ends_with: "Ends With",
  regex: "re_match",
  not_regex: "re_not_match",
  is_null: "Is Null",
  is_not_null: "Is Not Null",
  is_empty: "Is Empty",
  is_not_empty: "Is Not Empty",
  match_all: "match_all",
};

/** The field name a dashboard column has in the builder; a joined stream's column is `alias.field`. */
export const dashboardFieldKey = (column: unknown): string => {
  if (typeof column === "string") return column;
  if (!isPlainObject(column)) return "";
  const field = String(column.field ?? "");
  return column.streamAlias ? `${column.streamAlias}.${field}` : field;
};

export const hasVariable = (value: string) => value.includes("$") || value.includes("{{");

const LIST_ITEM = /\s*(?:'([^']*)'|"([^"]*)"|([^,()]+))/y;

// The panel SQL builder pastes an IN text holding a `$variable` in verbatim, so its literals are SQL-quoted.
const SQL_LIST_ITEM = /\s*(?:'((?:[^']|'')*)'|"([^"]*)"|([^,()]+))/y;

// A whole value that the variable substitution replaces; anything else holding `$` is a literal.
const PLACEHOLDER =
  /^(\{\{\s*[\w-]+\s*(:\s*[a-zA-Z]+\s*)?\}\}|\$\{\s*[\w-]+\s*(:\s*[a-zA-Z]+\s*)?\}|\$[\w-]+)$/;

const QUOTED_PLACEHOLDER = new RegExp(`^'${PLACEHOLDER.source.slice(1, -1)}'$`);

const splitWith = (text: string, pattern: RegExp, unescape: (quoted: string) => string) => {
  const values: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (/[\s,()]/.test(text[index])) {
      index++;
      continue;
    }
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) break;
    const item = match[1] !== undefined ? unescape(match[1]) : (match[2] ?? match[3]).trim();
    if (item) values.push(item);
    index = pattern.lastIndex;
  }
  return values;
};

const unescapeSql = (quoted: string) => quoted.replace(/''/g, "'");

// A single-select variable is substituted raw, so a saved `'$env'` keeps its quotes to stay a string.
const keepQuotedPlaceholder = (quoted: string) =>
  PLACEHOLDER.test(quoted) ? `'${quoted}'` : unescapeSql(quoted);

/** An IN list typed as text (`a, b`, `('a','b')`); with a `$variable` in it, the SQL-quoted form `'a',$env`. */
export const splitListText = (value: unknown): string[] => {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!text.trim()) return [];
  if (hasVariable(text)) return splitWith(text, SQL_LIST_ITEM, unescapeSql);
  return splitWith(text, LIST_ITEM, (quoted) => quoted.trim());
};

/** As `splitListText`, but a quoted `'$env'` stays one quoted value, as the panel SQL builder needs it. */
export const splitPanelListText = (value: unknown): string[] => {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!hasVariable(text)) return splitListText(text);
  return splitWith(text, SQL_LIST_ITEM, keepQuotedPlaceholder);
};

/** An IN list's SQL-quoted text, `''`-escaped; the anomaly SQL builder inserts it verbatim. */
export const splitSqlListText = (value: unknown): string[] => {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text.trim() ? splitWith(text, SQL_LIST_ITEM, unescapeSql) : [];
};

/** The inverse of `splitListText`, in the comma-only form the dashboard SQL builder's own splitter reads. */
export const joinListText = (values: string[]): string => {
  if (values.length === 1 && hasVariable(values[0])) return values[0];
  return values
    .map((value) => {
      if (!/[,()'"]/.test(value) && value === value.trim()) return value;
      return value.includes("'") ? `"${value}"` : `'${value}'`;
    })
    .join(",");
};

// A typed `($env)` is the same variable; the SQL builder drops the parentheses of a lone one.
const placeholderOf = (value: string): string | null => {
  const inner = value
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  return PLACEHOLDER.test(inner) ? inner : null;
};

/** A panel IN leaf's text: as `joinListText`, but with a `$variable` every other value is SQL-quoted. */
export const joinPanelListText = (values: string[]): string => {
  if (!values.some(hasVariable)) return joinListText(values);
  if (values.length === 1 && placeholderOf(values[0])) return values[0];
  return values
    .map((value) => {
      if (QUOTED_PLACEHOLDER.test(value)) return value;
      return placeholderOf(value) ?? `'${value.replace(/'/g, "''")}'`;
    })
    .join(",");
};

function parseLeaf(item: Record<string, unknown>): FilterNode {
  const connector = toConnector(item.logicalOperator);
  const field = dashboardFieldKey(item.column);
  let operator: FilterOperatorId | null;
  let values: string[];
  if (item.type === "list") {
    operator = "in";
    values = valueStrings(item.values);
  } else {
    operator = item.operator == null ? "eq" : operatorFromWire(item.operator);
    if (!operator) {
      const label = [field, item.operator, item.value]
        .filter((p) => p != null && p !== "")
        .join(" ");
      return stamp(makeRawNode(label, connector), item);
    }
    const arity = OPERATORS[operator].arity;
    if (arity === "none" || item.operator == null) values = [];
    else if (arity === "many") values = splitPanelListText(item.value);
    else values = valueStrings(item.value).filter((v) => v !== "" || item.emptyLiteral);
  }
  const condition: FilterCondition = {
    kind: "condition",
    id: newFilterId(),
    connector,
    field,
    operator,
    values,
  };
  return stamp(condition, item);
}

function parseGroup(group: Record<string, unknown>, id?: string): FilterGroup {
  const list = Array.isArray(group.conditions) ? group.conditions : [];
  const items = list.map((item): FilterNode => {
    if (isPlainObject(item) && item.filterType === "group") return parseGroup(item);
    if (isPlainObject(item)) return parseLeaf(item);
    return stamp(makeRawNode(JSON.stringify(item)), item);
  });
  return stamp(makeGroup(items, toConnector(group.logicalOperator), id), group);
}

function columnOf(
  node: FilterCondition,
  raw: DashboardFilterCondition | undefined,
  context: CodecContext,
) {
  if (raw && parsedField(node) === node.field) return raw.column;
  const payload = fieldPayload(context, node.field);
  if (isPlainObject(payload) && typeof payload.field === "string")
    return payload as unknown as DashboardColumn;
  return { field: node.field };
}

function serializeLeaf(node: FilterCondition, context: CodecContext): DashboardFilterCondition {
  const raw = rawOf<DashboardFilterCondition>(node);
  if (isPristine(node) && raw) return raw;
  // Re-serializing unchanged values would rewrite a saved `prod,$env` as `'prod',$env` and change the SQL.
  if (raw && onlyConnectorChanged(node)) return { ...raw, logicalOperator: node.connector };
  const sameOperator = parsedOperator(node) === node.operator;
  const base: DashboardFilterCondition = raw ?? {
    type: "condition",
    column: { field: "" },
    filterType: "condition",
    operator: null,
    value: null,
    logicalOperator: "AND",
    values: [],
  };
  const out: DashboardFilterCondition = {
    ...base,
    column: columnOf(node, raw, context),
    logicalOperator: node.connector,
  };
  if (node.values.length !== 1 || node.values[0] !== "") delete out.emptyLiteral;
  // A list leaf quotes each value, so a `$variable` (possibly multi-select) needs the condition form.
  const listType =
    node.operator === "in" && (!raw || raw.type === "list") && !node.values.some(hasVariable);
  if (listType) {
    out.type = "list";
    out.values = [...node.values];
    if (!raw) out.operator = null;
    return out;
  }
  out.type = "condition";
  out.operator =
    sameOperator && raw?.type === "condition" && typeof raw.operator === "string"
      ? raw.operator
      : (DASHBOARD_SPELLINGS[node.operator] ?? node.operator);
  const arity = OPERATORS[node.operator].arity;
  if (arity === "none") out.value = "";
  else if (arity === "many") out.value = joinPanelListText(node.values);
  else out.value = node.values[0] ?? "";
  return out;
}

const onlyConnectorChanged = (node: FilterCondition): boolean => {
  if (!node.meta) return false;
  const loadedConnector = (JSON.parse(node.meta.sig) as unknown[])[4] as FilterConnector;
  return nodeSig({ ...node, connector: loadedConnector }) === node.meta.sig;
};

// A locked leaf keeps its saved payload; only its AND/OR can change.
function serializeRaw(item: FilterNode): DashboardFilterCondition {
  const saved = rawOf<DashboardFilterCondition>(item)!;
  if (isPristine(item) || !isPlainObject(saved)) return saved;
  return { ...saved, logicalOperator: item.connector };
}

function serializeGroup(group: FilterGroup, context: CodecContext): DashboardFilterGroup {
  const raw = rawOf<DashboardFilterGroup>(group);
  if (isTreePristine(group) && raw) return raw;
  const conditions = group.items.map((item) => {
    if (item.kind === "group") return serializeGroup(item, context);
    if (item.kind === "condition") return serializeLeaf(item, context);
    return serializeRaw(item);
  });
  if (raw) return { ...raw, logicalOperator: group.connector, conditions };
  return { conditions, filterType: "group", logicalOperator: group.connector };
}

/** A panel query's `fields.filter` tree: `list` and `condition` leaves, nested groups and `$variables` in values. */
export function dashboardFilterCodec(): FilterCodec<DashboardFilterGroup | null> {
  return {
    parse: (saved) =>
      isPlainObject(saved)
        ? parseGroup(saved, "root")
        : stamp(makeGroup([], "AND", "root"), saved ?? null),
    serialize: (tree, context) => {
      if (isTreePristine(tree)) return rawOf<DashboardFilterGroup | null>(tree) ?? null;
      const raw = rawOf<DashboardFilterGroup>(tree);
      const out = serializeGroup(tree, context);
      return raw ? { ...out, logicalOperator: raw.logicalOperator } : out;
    },
  };
}
