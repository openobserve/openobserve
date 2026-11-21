// Copyright 2026 OpenObserve Inc.

import { addToSqlWhere, whereParts, type FieldFilter } from "@/utils/security/eventQuery";
import type { ActiveFilterValues } from "../activeFilterValues";
import { MISSING_VALUE_KEY } from "../valueFilterExpression";
import type { FieldValueEntry } from "@/composables/useFieldValuesStream";
import type { ValueFilterMode } from "../fieldPanel.types";
import { raw } from "@/types/i18n";

const ESCAPE = "\u0000";

/** Key of the missing value in the values list; `keyOfValue` escapes every stored string, so none can equal it. */
export const NULL_VALUE_KEY = MISSING_VALUE_KEY;

/** Text a filter chip shows for the missing value. */
const NULL_CHIP_TEXT = "null";

const VALUE_OPS: Record<string, ValueFilterMode> = {
  "=": "include",
  is_null: "include",
  "!=": "exclude",
  is_not_null: "exclude",
};

/** Whether the values list writes and reads this filter, as opposed to a typed one such as contains. */
export const isValueFilter = (filter: FieldFilter): boolean => Object.hasOwn(VALUE_OPS, filter.op);

export interface SqlValueFilters {
  /** The query before the panel first wrote into it. */
  base: string;
  /** The query as the panel last wrote it; any other text means it was edited since. */
  written: string;
  fields: Record<string, { include: string[]; exclude: string[] }>;
}

export const EMPTY_SQL_VALUE_FILTERS: SqlValueFilters = { base: "", written: "", fields: {} };

/** A stored string's key: itself, or with one more leading escape when it starts with one, so no key but the missing value's is the escape plus "null". */
export const keyOfValue = (value: string): string =>
  value.startsWith(ESCAPE) ? `${ESCAPE}${value}` : value;

const valueOfKey = (key: string): string => (key.startsWith(ESCAPE) ? key.slice(1) : key);

const keyOf = (filter: FieldFilter) =>
  filter.op === "is_null" || filter.op === "is_not_null"
    ? NULL_VALUE_KEY
    : keyOfValue(filter.value);

const toFilter = (field: string, key: string, mode: ValueFilterMode): FieldFilter => {
  if (key === NULL_VALUE_KEY) {
    return { field, op: mode === "include" ? "is_null" : "is_not_null", value: NULL_CHIP_TEXT };
  }
  return { field, op: mode === "include" ? "=" : "!=", value: valueOfKey(key) };
};

/** One row of a values query: SQL NULL, the empty string and a literal "null" each stay their own value, so a pick filters exactly the rows it counted. */
export const valueEntry = (value: unknown, count: number): FieldValueEntry => {
  if (value === null || value === undefined)
    return { key: NULL_VALUE_KEY, label: raw("null"), count };
  const text = String(value);
  const key = keyOfValue(text);
  if (text === "") return { key, label: raw('""'), count };
  return key === text ? { key, count } : { key, label: raw(text), count };
};

const push = (target: Record<string, string[]>, field: string, key: string) => {
  target[field] ??= [];
  if (!target[field].includes(key)) target[field].push(key);
};

/** Values each field is filtered to and away from by the builder's value filters. */
export function activeValueFilters(filters: FieldFilter[]): ActiveFilterValues {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  for (const filter of filters) {
    const mode = VALUE_OPS[filter.op];
    if (mode) push(mode === "include" ? include : exclude, filter.field, keyOf(filter));
  }
  return { include, exclude };
}

/** Sets one field's value filters to the picked values; a kept or flipped value keeps its place, other filters stay. */
export function applyValueFilters(
  filters: FieldFilter[],
  field: string,
  include: string[],
  exclude: string[],
): FieldFilter[] {
  const wanted = new Map<string, FieldFilter>();
  const picked = [
    ...include.map((value) => toFilter(field, value, "include")),
    ...exclude.map((value) => toFilter(field, value, "exclude")),
  ];
  for (const filter of picked) {
    if (!wanted.has(keyOf(filter))) wanted.set(keyOf(filter), filter);
  }
  const next: FieldFilter[] = [];
  for (const filter of filters) {
    if (filter.field !== field || !VALUE_OPS[filter.op]) {
      next.push(filter);
      continue;
    }
    const kept = wanted.get(keyOf(filter));
    if (!kept) continue;
    next.push(kept);
    wanted.delete(keyOf(filter));
  }
  return [...next, ...wanted.values()];
}

/** One field's picked values as one condition in the page's filter syntax. */
export function valueFilterClause(field: string, include: string[], exclude: string[]): string {
  const filters = applyValueFilters([], field, include, exclude);
  return whereParts({ severitySql: null, severity: [], filters }).join(" AND ");
}

/** Writes the panel's value filters into a hand-written query; null when the query's shape cannot take them. */
export function writeSqlValueFilters(
  state: SqlValueFilters,
  current: string,
  field: string,
  include: string[],
  exclude: string[],
): SqlValueFilters | null {
  // An edited query is the new base, so the analyst's own text is never rewritten.
  const fresh = current !== state.written;
  const base = fresh ? current : state.base;
  const fields = { ...(fresh ? {} : state.fields) };
  if (include.length || exclude.length) {
    fields[field] = { include: [...include], exclude: [...exclude] };
  } else {
    delete fields[field];
  }
  let sql = base;
  for (const [name, picked] of Object.entries(fields)) {
    const next = addToSqlWhere(sql, valueFilterClause(name, picked.include, picked.exclude));
    if (next === null) return null;
    sql = next;
  }
  return { base, written: sql, fields };
}

/** Values the panel wrote into the query, while the query is still as it wrote it. */
export function activeSqlValueFilters(state: SqlValueFilters, current: string): ActiveFilterValues {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  if (current !== state.written) return { include, exclude };
  for (const [field, picked] of Object.entries(state.fields)) {
    include[field] = [...picked.include];
    exclude[field] = [...picked.exclude];
  }
  return { include, exclude };
}
