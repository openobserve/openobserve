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

import { CUSTOM_VALUE, SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { escapeSingleQuotes, splitQuotedString } from "@/utils/zincutils";
import {
  conditionToLegacyFilter,
  getFilterGroupConditions,
  getVariableFilterGroup,
  renderFilterGroup,
  type LegacyVariableFilter,
  type VariableFilterGroup,
} from "./variableFilterGroupUtils";
import {
  normalizeVariableSyntax,
  replaceVariablePlaceholders,
  type VariableFormat,
} from "./variablesUtils";

export type QueryVariableLanguage = "sql" | "promql";

export const DEFAULT_QUERY_VARIABLE_MAX_RECORDS = 10;

/** Stands in for an empty option list so a filter on it matches no rows. */
export const QUERY_VARIABLE_NO_VALUES = "_o2_no_values_";

export interface QueryVariableOption {
  label: string;
  value: string;
}

export interface QueryVariableOptionsResult {
  options: QueryVariableOption[];
  capped: boolean;
}

export interface SqlRowsOptionsResult extends QueryVariableOptionsResult {
  columns: string[];
}

/** Filter operators an auto PromQL variable can turn into label matchers. */
export const PROMQL_FILTER_OPERATORS: readonly string[] = [
  "=",
  "!=",
  "re_match",
  "re_not_match",
  "IN",
  "NOT IN",
  "Is Null",
  "Is Not Null",
];

export interface QueryVariableData {
  stream_type?: string;
  stream?: string;
  field?: string;
  max_record_size?: unknown;
  filter?: LegacyVariableFilter[] | null;
  filter_group?: VariableFilterGroup | null;
  query_type?: string;
  custom_query?: boolean;
  query?: string;
  value_field?: string | null;
  label_field?: string | null;
}

interface VariableLike {
  type?: string;
  query_data?: QueryVariableData | null;
}

export interface QueryVariableContextEntry {
  name: string;
  type?: string;
  value: any;
  isVariablePartialLoaded?: boolean;
  multiSelect?: boolean;
  options?: { value?: unknown }[];
}

export interface QueryVariableSelectionConfig {
  type?: string;
  query_data?: QueryVariableData | null;
  value?: any;
  multiSelect?: boolean;
  options?: { value?: unknown }[];
  isVariablePartialLoaded?: boolean;
  selectAllValueForMultiSelect?: string;
  customMultiSelectValue?: string[];
}

export type PromVariableQuery =
  | { kind: "label_values"; label: string; match?: string }
  | { kind: "label_names"; match?: string }
  | { kind: "metrics"; regex: string }
  | { kind: "query_result"; expr: string };

export interface PromSeriesResult {
  metric?: Record<string, string>;
  value?: [number | string, string];
}

const LABEL_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PROM_FUNCTION_REGEX = /^([a-z_]+)\s*\(([\s\S]*)\)$/;
const OPENING = "([{";
const CLOSING = ")]}";

/** A query_values variable whose options come from its hand-written query. */
export const isCustomQueryVariable = (variable?: VariableLike | null): boolean =>
  variable?.type === "query_values" && variable.query_data?.custom_query === true;

/** True when options load through the SQL/PromQL query loader rather than the field values stream. */
export const usesQueryVariableLoader = (variable?: VariableLike | null): boolean =>
  isCustomQueryVariable(variable) ||
  (variable?.type === "query_values" && variable.query_data?.query_type === "promql");

export const getQueryVariableLanguage = (variable?: {
  query_data?: { query_type?: string } | null;
}): QueryVariableLanguage => (variable?.query_data?.query_type === "promql" ? "promql" : "sql");

export const getQueryVariableMaxRecords = (variable?: {
  query_data?: { max_record_size?: unknown } | null;
}): number => {
  const size = Number(variable?.query_data?.max_record_size);
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_QUERY_VARIABLE_MAX_RECORDS;
};

const promString = (value: string): string =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const promAlternatives = (value: string): string =>
  (splitQuotedString(value) ?? [])
    .map((item: string) => item.replace(/^['"]|['"]$/g, ""))
    .join("|");

const promMatcher = (filter: { name?: string; operator?: string; value?: string }): string => {
  const name = (filter.name ?? "").trim();
  const value = String(filter.value ?? "");
  // A $variable may expand to several values joined by "|", which only a regex matcher accepts.
  const hasVariable = /\$|\{\{/.test(value);
  switch (filter.operator) {
    case "!=":
      return `${name}${hasVariable ? "!~" : "!="}${promString(value)}`;
    case "re_match":
      return `${name}=~${promString(value)}`;
    case "re_not_match":
      return `${name}!~${promString(value)}`;
    case "IN":
      return `${name}=~${promString(promAlternatives(value))}`;
    case "NOT IN":
      return `${name}!~${promString(promAlternatives(value))}`;
    case "Is Null":
      return `${name}=""`;
    case "Is Not Null":
      return `${name}!=""`;
    default:
      return `${name}${hasVariable ? "=~" : "="}${promString(value)}`;
  }
};

const SINGLE_PLACEHOLDER =
  /^'?(?:\$\{\s*([a-zA-Z0-9_-]+)\s*\}|\$([a-zA-Z0-9_-]+)|\{\{\s*([a-zA-Z0-9_-]+)\s*\}\})'?$/;

/** Turns `= $var` / `!= $var` into IN / NOT IN when `$var` currently holds a list, since `= 'a', 'b'` is invalid SQL. */
export const expandMultiValueFilter = <T extends { operator?: string; value?: string }>(
  filter: T,
  valueOf: (name: string) => unknown,
): T => {
  if (filter.operator !== "=" && filter.operator !== "!=") return filter;
  const match = SINGLE_PLACEHOLDER.exec(String(filter.value ?? "").trim());
  const name = match && (match[1] ?? match[2] ?? match[3]);
  if (!name || !Array.isArray(valueOf(name))) return filter;
  return { ...filter, operator: filter.operator === "=" ? "IN" : "NOT IN" };
};

/** The `label_values(metric{matchers}, label)` query an auto PromQL variable runs. */
export const buildAutoPromqlQuery = (queryData?: QueryVariableData | null): string => {
  const matchers = getFilterGroupConditions(getVariableFilterGroup(queryData))
    .map(conditionToLegacyFilter)
    .filter(
      (filter) =>
        (filter?.name ?? "").trim() && PROMQL_FILTER_OPERATORS.includes(filter.operator ?? ""),
    )
    .map(promMatcher);
  const selector = `${queryData?.stream ?? ""}${matchers.length ? `{${matchers.join(",")}}` : ""}`;
  return `label_values(${selector}, ${queryData?.field ?? ""})`;
};

const sqlString = (value: unknown): string => {
  const text = String(value ?? "");
  const unquoted =
    text.length > 1 && text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text;
  return `'${escapeSingleQuotes(unquoted)}'`;
};

const SQL_FILTER_FUNCTIONS: Record<string, string> = {
  str_match: "str_match",
  Contains: "str_match",
  str_match_ignore_case: "str_match_ignore_case",
  re_match: "re_match",
  re_not_match: "re_not_match",
};

const SQL_COMPARISONS = ["=", "!=", "<>", "<", ">", "<=", ">="];

// Mirrors addLabelToSQlQuery's operator handling, without waiting for the lazily loaded SQL parser.
const sqlCondition = (filter: { name?: string; operator?: string; value?: string }): string => {
  const column = `"${(filter.name ?? "").trim()}"`;
  const operator = filter.operator ?? "";
  const value = filter.value ?? "";
  if (operator === "match_all") return `match_all(${sqlString(value)})`;
  if (SQL_FILTER_FUNCTIONS[operator])
    return `${SQL_FILTER_FUNCTIONS[operator]}(${column}, ${sqlString(value)})`;
  switch (operator) {
    case "Not Contains":
      return `${column} NOT LIKE ${sqlString(`%${value}%`)}`;
    case "Starts With":
      return `${column} LIKE ${sqlString(`${value}%`)}`;
    case "Ends With":
      return `${column} LIKE ${sqlString(`%${value}`)}`;
    case "Is Null":
      return `${column} IS NULL`;
    case "Is Not Null":
      return `${column} IS NOT NULL`;
    case "IN":
    case "NOT IN": {
      const items = (splitQuotedString(value) ?? []).map(sqlString).join(", ");
      return `${column} ${operator} (${items})`;
    }
    default:
      return SQL_COMPARISONS.includes(operator) ? `${column} ${operator} ${sqlString(value)}` : "";
  }
};

const usableSqlFilter = (filter: LegacyVariableFilter): boolean =>
  !!(filter?.name ?? "").trim() || filter?.operator === "match_all";

/** The WHERE expression for a filter group; `mapFilter` rewrites each condition first, e.g. `= $var` to IN. */
export const buildFilterGroupSql = (
  group: VariableFilterGroup,
  mapFilter: (filter: LegacyVariableFilter) => LegacyVariableFilter = (filter) => filter,
): string =>
  renderFilterGroup(group, (condition) => {
    const filter = conditionToLegacyFilter(condition);
    return usableSqlFilter(filter) ? sqlCondition(mapFilter(filter)) : "";
  });

/** The SQL an auto variable stands for, used to prefill the custom editor. */
export const buildAutoSqlQuery = (queryData?: QueryVariableData | null): string => {
  const base = `SELECT DISTINCT "${queryData?.field ?? ""}" FROM "${queryData?.stream ?? ""}"`;
  const where = buildFilterGroupSql(getVariableFilterGroup(queryData));
  return where ? `${base} WHERE ${where}` : base;
};

/** The query text a loader-backed variable runs, before parent values are substituted. */
export const getQueryVariableQuery = (variable?: VariableLike | null): string =>
  isCustomQueryVariable(variable)
    ? (variable?.query_data?.query ?? "")
    : buildAutoPromqlQuery(variable?.query_data);

const holdsAll = (variable?: QueryVariableSelectionConfig | null): boolean =>
  Array.isArray(variable?.value)
    ? variable.value.includes(SELECT_ALL_VALUE)
    : variable?.value === SELECT_ALL_VALUE;

const isEmptySelection = (value: unknown): boolean =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

const listedOptionValues = (variable: QueryVariableSelectionConfig): string[] =>
  (variable.options ?? [])
    .map((option) => option?.value)
    .filter(
      (value): value is string =>
        typeof value === "string" && value !== "" && value !== SELECT_ALL_VALUE,
    );

// A loaded query variable that lists nothing must filter to nothing, never fall back to the unfiltered placeholder.
const hasNoListedValues = (variable: QueryVariableSelectionConfig): boolean =>
  variable.isVariablePartialLoaded !== false &&
  Array.isArray(variable.options) &&
  !listedOptionValues(variable).length;

/** Option values an "All" pick on a multi-select query variable stands for; undefined keeps the placeholder. */
export const getQueryVariableAllValues = (
  variable?: QueryVariableSelectionConfig | null,
): string[] | undefined => {
  if (!isCustomQueryVariable(variable) || !variable?.multiSelect || !holdsAll(variable))
    return undefined;
  const values = listedOptionValues(variable);
  if (values.length) return values;
  return hasNoListedValues(variable) ? [QUERY_VARIABLE_NO_VALUES] : undefined;
};

/** The value panels and child queries should see: "All" on a query variable becomes its listed options. */
export const resolveQueryVariableValue = (variable: QueryVariableSelectionConfig): any => {
  const allValues = getQueryVariableAllValues(variable);
  if (allValues) return allValues;
  if (!isCustomQueryVariable(variable) || !hasNoListedValues(variable)) return variable?.value;
  if (holdsAll(variable) || isEmptySelection(variable.value)) {
    return variable.multiSelect ? [QUERY_VARIABLE_NO_VALUES] : QUERY_VARIABLE_NO_VALUES;
  }
  return variable.value;
};

/** True for a value the user picked themselves: not empty and not "All". */
export const isExplicitQuerySelection = (value: unknown): boolean =>
  !isEmptySelection(value) &&
  !(Array.isArray(value) ? value.includes(SELECT_ALL_VALUE) : value === SELECT_ALL_VALUE);

/** True while an "All" pick still waits for the options it stands for. */
export const isQueryVariableAllPending = (
  variable?: QueryVariableSelectionConfig | null,
): boolean =>
  isCustomQueryVariable(variable) &&
  !!variable?.multiSelect &&
  holdsAll(variable) &&
  variable?.isVariablePartialLoaded === false;

/** Keeps the picks still in the new options, else falls back to the configured default like a fresh load. */
export const reconcileQueryVariableValue = (
  variable: QueryVariableSelectionConfig,
  options: QueryVariableOption[],
): any => {
  const optionValues = new Set(options.map((option) => option.value));
  const current = Array.isArray(variable.value)
    ? variable.value
    : variable.value === null || variable.value === undefined
      ? []
      : [variable.value];
  const kept = current.filter(
    (value: unknown) =>
      value === SELECT_ALL_VALUE ||
      optionValues.has(value as string) ||
      (typeof value === "string" && value.endsWith(CUSTOM_VALUE)),
  );
  const pick = (values: string[]) => (variable.multiSelect ? values : values[0]);
  if (kept.length) return pick(kept);
  if (variable.selectAllValueForMultiSelect === "all") return pick([SELECT_ALL_VALUE]);
  if (
    variable.selectAllValueForMultiSelect === "custom" &&
    (variable.customMultiSelectValue?.length ?? 0) > 0
  ) {
    return pick([...(variable.customMultiSelectValue as string[])]);
  }
  const first = options.find((option) => option.value !== "");
  if (!first) return variable.multiSelect ? [] : null;
  return pick([first.value]);
};

/** `$names` a query references that are neither dashboard variables nor built-ins like `$__interval`. */
export const getUndefinedQueryVariableNames = (
  query: string,
  definedNames: Iterable<string>,
): string[] => {
  const defined = new Set(definedNames);
  const regex =
    /(?:\$\{\s*([a-zA-Z0-9_]+)\s*(?::\s*[a-zA-Z]+\s*)?\})|(?:\$([a-zA-Z_][a-zA-Z0-9_]*))|(?:\{\{\s*([a-zA-Z0-9_]+)\s*(?::\s*[a-zA-Z]+\s*)?\}\})/g;
  const missing = new Set<string>();
  for (const match of (query ?? "").matchAll(regex)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name && !name.startsWith("__") && !defined.has(name)) missing.add(name);
  }
  return [...missing];
};

const stripCustomSuffix = (value: unknown): string => {
  const text = String(value);
  return text.endsWith(CUSTOM_VALUE) ? text.slice(0, -CUSTOM_VALUE.length) : text;
};

const formatSqlValues = (
  values: string[],
  isArray: boolean,
  quoted: boolean,
  format: VariableFormat | undefined,
): string => {
  const escaped = values.map((value) => escapeSingleQuotes(value));
  switch (format) {
    case "csv":
      return values.join(",");
    case "pipe":
      return values.join("|");
    case "doublequote":
      return values.map((value) => `"${value}"`).join(",");
    case "singlequote":
      return escaped.map((value) => `'${value}'`).join(",");
    default:
      if (!isArray) return escaped[0];
      // '$name' already supplies the outer quotes: '$name' -> 'a', 'b'
      return quoted ? escaped.join("', '") : escaped.map((value) => `'${value}'`).join(", ");
  }
};

const formatPromValues = (values: string[], format: VariableFormat | undefined): string => {
  // A regex matcher is the only place an "all" selection can be honoured in PromQL.
  const resolved = values.map((value) => (value === SELECT_ALL_VALUE ? ".*" : value));
  switch (format) {
    case "csv":
      return resolved.join(",");
    case "doublequote":
      return resolved.map((value) => `"${value}"`).join(",");
    case "singlequote":
      return resolved.map((value) => `'${value}'`).join(",");
    default:
      return resolved.join("|");
  }
};

/** Replaces `$var`, `${var}` and `{{var}}` with parent values; unloaded or empty parents keep their placeholder. */
export const substituteQueryVariables = (
  query: string,
  variables: QueryVariableContextEntry[],
  language: QueryVariableLanguage,
): string => {
  if (typeof query !== "string" || !query) return query ?? "";
  const byName = new Map<string, QueryVariableContextEntry>();
  for (const variable of variables ?? []) {
    if (!variable?.name || variable.type === "dynamic_filters") continue;
    const existing = byName.get(variable.name);
    if (
      !existing ||
      (existing.isVariablePartialLoaded === false && variable.isVariablePartialLoaded)
    ) {
      byName.set(variable.name, variable);
    }
  }

  return replaceVariablePlaceholders(
    normalizeVariableSyntax(query),
    byName.keys(),
    ({ name, format, quoted }) => {
      const variable = byName.get(name);
      if (!variable || variable.isVariablePartialLoaded === false) return undefined;
      const resolved = resolveQueryVariableValue(variable);
      const isArray = Array.isArray(resolved);
      const rawValues: unknown[] = isArray ? resolved : [resolved];
      const values = rawValues
        .filter((value) => value !== null && value !== undefined)
        .map(stripCustomSuffix);
      if (!values.length) return undefined;
      return language === "promql"
        ? formatPromValues(values, format)
        : formatSqlValues(values, isArray, quoted, format);
    },
  );
};

const toOptionText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Column names of a result set, in first-seen order. */
export const getSqlResultColumns = (rows: Record<string, unknown>[]): string[] => {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
};

/** Turns SQL rows into deduped, capped options; value defaults to the first column, label to the value. */
export const mapSqlRowsToOptions = (
  rows: Record<string, unknown>[],
  {
    valueField,
    labelField,
    maxRecords = DEFAULT_QUERY_VARIABLE_MAX_RECORDS,
  }: { valueField?: string | null; labelField?: string | null; maxRecords?: number },
): SqlRowsOptionsResult => {
  const columns = getSqlResultColumns(rows);
  const valueColumn = valueField && columns.includes(valueField) ? valueField : columns[0];
  const labelColumn = labelField && columns.includes(labelField) ? labelField : valueColumn;
  if (!valueColumn) return { options: [], columns, capped: false };

  const seen = new Set<string>();
  const options: QueryVariableOption[] = [];
  for (const row of rows ?? []) {
    const value = toOptionText(row?.[valueColumn]);
    if (value === null || seen.has(value)) continue;
    seen.add(value);
    const label = toOptionText(row?.[labelColumn]);
    options.push({ value, label: label === null || label === "" ? value : label });
  }
  return {
    options: options.slice(0, maxRecords),
    columns,
    capped: options.length > maxRecords,
  };
};

/** Dedupes plain values into capped options whose label is the value. */
export const mapValuesToOptions = (
  values: unknown[],
  maxRecords: number = DEFAULT_QUERY_VARIABLE_MAX_RECORDS,
): QueryVariableOptionsResult => {
  const seen = new Set<string>();
  const options: QueryVariableOption[] = [];
  for (const raw of values ?? []) {
    const value = toOptionText(raw);
    if (value === null || seen.has(value)) continue;
    seen.add(value);
    options.push({ label: value, value });
  }
  return { options: options.slice(0, maxRecords), capped: options.length > maxRecords };
};

/** Positions of commas outside brackets and quotes. */
const topLevelCommas = (text: string): number[] => {
  const commas: number[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (OPENING.includes(char)) depth++;
    else if (CLOSING.includes(char)) depth--;
    else if (char === "," && depth === 0) commas.push(i);
  }
  return commas;
};

const unquote = (text: string): string => {
  const trimmed = text.trim();
  const first = trimmed[0];
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseLabelValues = (args: string): PromVariableQuery | null => {
  const commas = topLevelCommas(args);
  if (commas.length > 1) return null;
  const label = (commas.length ? args.slice(commas[0] + 1) : args).trim();
  const match = commas.length ? args.slice(0, commas[0]).trim() : "";
  if (!LABEL_NAME_REGEX.test(label)) return null;
  if (commas.length && !match) return null;
  return match ? { kind: "label_values", label, match } : { kind: "label_values", label };
};

/** Parses a Grafana-style variable query; null when it is not one of the five supported functions. */
export const parsePromVariableQuery = (input: string): PromVariableQuery | null => {
  const parsed = PROM_FUNCTION_REGEX.exec((input ?? "").trim());
  if (!parsed) return null;
  const [, fn, rawArgs] = parsed;
  const args = rawArgs.trim();
  switch (fn) {
    case "label_values":
      return parseLabelValues(args);
    case "label_names":
      if (topLevelCommas(args).length) return null;
      return args ? { kind: "label_names", match: args } : { kind: "label_names" };
    case "metrics":
      return { kind: "metrics", regex: unquote(args) };
    case "query_result":
      return args ? { kind: "query_result", expr: args } : null;
    default:
      return null;
  }
};

/** Renders one instant-query sample the way Grafana's query_result does: `metric{labels} value timestampMs`. */
export const formatPromSeries = (series: PromSeriesResult): string => {
  const { __name__: name = "", ...labels } = series?.metric ?? {};
  const labelText = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  const [timestamp, value] = series?.value ?? [];
  const timestampMs = Math.round(Number(timestamp) * 1000);
  return `${name}{${labelText}} ${value ?? ""} ${Number.isFinite(timestampMs) ? timestampMs : ""}`.trim();
};
