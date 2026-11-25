// Copyright 2026 OpenObserve Inc.

import { addToSqlWhere, whereParts, type FieldFilter } from "@/utils/security/eventQuery";
import type { ActiveFilterValues } from "../activeFilterValues";
import { MISSING_VALUE_KEY, valueKeyLabel } from "../valueFilterExpression";
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

interface Span {
  start: number;
  end: number;
}

interface LocatedWhere {
  text: string;
  /** Uppercase copy with quoted spans masked, index-aligned with `text`. */
  masked: string;
  /** Index of the whitespace before WHERE. */
  whereAt: number;
  where: Span | null;
}

interface ValueClause {
  field: string;
  include: string[];
  exclude: string[];
}

interface Walked {
  /** Every conjunct under the span was dropped. */
  all: boolean;
  cuts: Span[];
}

const WHERE_TOKEN = /\sWHERE\s/;
const ATOM = /^("(?:[^"]|"")+")\s*(?:(!=|=)\s*([\s\S]+)|IS\s+(NOT\s+)?NULL)$/i;
const VALUE_PIECE = /\s*(?:'((?:[^']|'')*)'|chr\(92\)|repeat\(chr\(92\),\s*(\d+)\))\s*/iy;

// Neither space nor word character, so trimming keeps a quoted name and keyword bounds still see it.
const QUOTED = "#";

/** Whether the values list writes and reads this filter, as opposed to a typed one such as contains. */
export const isValueFilter = (filter: FieldFilter): boolean => Object.hasOwn(VALUE_OPS, filter.op);

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
    return { key: NULL_VALUE_KEY, label: valueKeyLabel(NULL_VALUE_KEY), count };
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

/** Writes one field's picks into a hand-written query, replacing that field's value conditions; null when the query's shape cannot take them. */
export function writeSqlValueFilters(
  current: string,
  field: string,
  include: string[],
  exclude: string[],
): string | null {
  const query = locateWhere(current);
  if (!query) return null;
  let sql = query.text;
  if (query.where) {
    const walked = walkConjuncts(query, query.where, (clause) => clause.field === field);
    if (walked.all) sql = `${sql.slice(0, query.whereAt)}${sql.slice(query.where.end)}`;
    else if (walked.cuts.length) sql = unwrapWhere(applyCuts(sql, walked.cuts));
  }
  const clause = valueFilterClause(field, include, exclude);
  return clause ? addToSqlWhere(sql, clause) : sql;
}

/** Values the query's own WHERE filters each field to and away from, read from the panel's condition format. */
export function activeSqlValueFilters(current: string): ActiveFilterValues {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  const query = locateWhere(current);
  if (!query?.where) return { include, exclude };
  walkConjuncts(query, query.where, (clause) => {
    include[clause.field] ??= [];
    exclude[clause.field] ??= [];
    for (const key of clause.include) push(include, clause.field, key);
    for (const key of clause.exclude) push(exclude, clause.field, key);
    return false;
  });
  return { include, exclude };
}

// Mirrors `addToSqlWhere`'s refusals, so a clause is only owned where the panel could also rewrite it.
function maskQuoted(text: string): string | null {
  let masked = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") return null;
      masked += QUOTED;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      masked += QUOTED;
    } else {
      masked += ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch;
    }
  }
  return quote ? null : masked;
}

function locateWhere(sql: string): LocatedWhere | null {
  const text = sql.trim();
  const masked = maskQuoted(text);
  if (masked === null || masked.includes("--") || masked.includes("/*")) return null;
  if (!/^SELECT\s/.test(masked) || /\b(UNION|JOIN)\b|\(\s*SELECT\b/.test(masked)) return null;
  const from = masked.search(/\sFROM\s/);
  if (from === -1) return null;
  const tails = [/\sGROUP\s+BY\s/, /\sHAVING\s/, /\sORDER\s+BY\s/, /\sLIMIT\s/]
    .map((re) => masked.search(re))
    .filter((i) => i > from);
  const end = tails.length ? Math.min(...tails) : text.length;
  const whereAt = masked.search(WHERE_TOKEN);
  if (whereAt === -1 || whereAt > end) return { text, masked, whereAt, where: null };
  const where = trimSpan(masked, { start: whereAt + " WHERE ".length, end });
  return { text, masked, whereAt, where };
}

function trimSpan(masked: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(masked[start])) start += 1;
  while (end > start && /\s/.test(masked[end - 1])) end -= 1;
  return { start, end };
}

/** The span without the parentheses that wrap all of it, however many layers. */
function unwrap(masked: string, span: Span): Span {
  let current = span;
  while (masked[current.start] === "(") {
    let depth = 0;
    let close = -1;
    for (let i = current.start; i < current.end && close === -1; i++) {
      if (masked[i] === "(") depth += 1;
      else if (masked[i] === ")") depth -= 1;
      if (depth === 0) close = i;
    }
    if (close !== current.end - 1) break;
    current = trimSpan(masked, { start: current.start + 1, end: current.end - 1 });
  }
  return current;
}

const isWordAt = (masked: string, at: number, word: string) =>
  masked.startsWith(word, at) &&
  !/\w/.test(masked[at - 1] ?? "") &&
  !/\w/.test(masked[at + word.length] ?? "");

/** Splits at a keyword outside parentheses. */
function splitTop(masked: string, span: Span, word: "AND" | "OR"): Span[] {
  const parts: Span[] = [];
  let depth = 0;
  let from = span.start;
  for (let i = span.start; i < span.end; i++) {
    if (masked[i] === "(") depth += 1;
    else if (masked[i] === ")") depth -= 1;
    else if (depth === 0 && isWordAt(masked, i, word)) {
      parts.push(trimSpan(masked, { start: from, end: i }));
      from = i + word.length;
      i = from - 1;
    }
  }
  parts.push(trimSpan(masked, { start: from, end: span.end }));
  return parts;
}

/** A value as `quoteString` writes it: literals, `chr(92)` and `repeat(chr(92), n)` joined by `||`. */
function decodeValue(expr: string): string | null {
  const trimmed = expr.trim();
  const body = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
  let value = "";
  let at = 0;
  for (;;) {
    VALUE_PIECE.lastIndex = at;
    const piece = VALUE_PIECE.exec(body);
    if (!piece) return null;
    at = VALUE_PIECE.lastIndex;
    if (piece[1] !== undefined) value += piece[1].replace(/''/g, "'");
    else value += "\\".repeat(piece[2] ? Number(piece[2]) : 1);
    if (at === body.length) return value;
    if (!body.startsWith("||", at)) return null;
    at += 2;
  }
}

function parseAtom(text: string): FieldFilter | null {
  const match = text.match(ATOM);
  if (!match) return null;
  const field = match[1].slice(1, -1).replace(/""/g, '"');
  if (!match[2]) {
    return { field, op: match[4] ? "is_not_null" : "is_null", value: NULL_CHIP_TEXT };
  }
  const value = decodeValue(match[3]);
  return value === null ? null : { field, op: match[2], value };
}

/** One condition as `valueFilterClause` writes it: an OR of a field's included values, or one excluded value. */
function valueClause(query: LocatedWhere, span: Span): ValueClause | null {
  const atoms: FieldFilter[] = [];
  for (const part of splitTop(query.masked, unwrap(query.masked, span), "OR")) {
    const inner = unwrap(query.masked, part);
    const atom = parseAtom(query.text.slice(inner.start, inner.end));
    if (!atom) return null;
    atoms.push(atom);
  }
  const field = atoms[0].field;
  if (atoms.some((atom) => atom.field !== field)) return null;
  if (atoms.every((atom) => atom.op === "=" || atom.op === "is_null")) {
    return { field, include: atoms.map(keyOf), exclude: [] };
  }
  const [first, second] = atoms;
  if (atoms.length === 1 && first.op === "is_not_null") {
    return { field, include: [], exclude: [NULL_VALUE_KEY] };
  }
  if (atoms.length === 2 && first.op === "!=" && second.op === "is_null") {
    return { field, include: [], exclude: [keyOf(first)] };
  }
  return null;
}

/** Visits the WHERE's AND-ed value conditions, nested groups included; `drop` picks which to cut out. */
function walkConjuncts(
  query: LocatedWhere,
  span: Span,
  drop: (clause: ValueClause) => boolean,
): Walked {
  const inner = unwrap(query.masked, span);
  const parts = splitTop(query.masked, inner, "AND");
  // AND binds tighter than OR, so a level with a top-level OR is one condition, not a list of them.
  if (parts.length === 1 || splitTop(query.masked, inner, "OR").length > 1) {
    const clause = valueClause(query, inner);
    return { all: clause !== null && drop(clause), cuts: [] };
  }
  const walked = parts.map((part) => walkConjuncts(query, part, drop));
  const keptAt = walked.findIndex((part) => !part.all);
  if (keptAt === -1) return { all: true, cuts: [] };
  const kept = parts[keptAt];
  const nested = walked.flatMap((part) => (part.all ? [] : part.cuts));
  if (walked.filter((part) => !part.all).length === 1 && inner.start !== span.start) {
    return {
      all: false,
      cuts: [{ start: span.start, end: kept.start }, ...nested, { start: kept.end, end: span.end }],
    };
  }
  const cuts = walked.flatMap((part, i): Span[] => {
    if (!part.all) return [];
    return i < keptAt
      ? [{ start: parts[i].start, end: parts[i + 1].start }]
      : [{ start: parts[i - 1].end, end: parts[i].end }];
  });
  return { all: false, cuts: [...cuts, ...nested] };
}

const applyCuts = (text: string, cuts: Span[]) =>
  [...cuts]
    .sort((a, b) => b.start - a.start)
    .reduce((out, cut) => `${out.slice(0, cut.start)}${out.slice(cut.end)}`, text);

// `WHERE (x)` means `WHERE x`, so a cut never leaves the analyst's condition in a wrapper the panel added.
function unwrapWhere(sql: string): string {
  const query = locateWhere(sql);
  if (!query?.where) return sql;
  const inner = unwrap(query.masked, query.where);
  if (inner.start === query.where.start) return sql;
  const { text, where } = query;
  return `${text.slice(0, where.start)}${text.slice(inner.start, inner.end)}${text.slice(where.end)}`;
}
