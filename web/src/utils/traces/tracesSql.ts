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

import { maskedSpanEnd, stripCommentLines, stripSqlComments } from "@/utils/query/sqlComments";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";
import type { ParsedSQLResult } from "@/ts/interfaces";

export type TracesSqlShape = "spans" | "traces" | "rows";

/** Why Use WHERE from SQL is off: the text does not parse, or it has no WHERE the Traces view can run. */
export type SqlWhereProblem = "unreadable" | "noWhere";

export interface TracesSqlInfo {
  isStatement: boolean;
  /** Top-level WHERE condition sliced from the original text, comments removed. */
  where: string;
  stream: string | null;
  /** FROM target and its alias as typed, so a count over the WHERE resolves the same names. */
  fromClause: string;
  selectAll: boolean;
  groupBy: boolean;
  aggregate: boolean;
  join: boolean;
  with: boolean;
  union: boolean;
  distinct: boolean;
  hasLimit: boolean;
  limit: number | null;
  fromSubquery: boolean;
  explain: boolean;
  selectNames: string[];
  /** Every select item has a name and none is a star, so the result has exactly `selectNames`. */
  selectExplicit: boolean;
}

/** A clause of typed SQL the RED charts leave out, which the caption names. */
export type RedDroppedClause =
  | "groupBy"
  | "having"
  | "distinct"
  | "orderBy"
  | "limit"
  | "offset"
  | "window"
  | "qualify"
  | "outerWhere"
  | "bothSidesWhere"
  | "join";

/** Which spans the RED charts describe, as the caption says it. */
export type SpanSetSubject =
  "matched" | "cte" | "branches" | "joinMatched" | "joinLeft" | "inner" | "stream";

/** The spans the RED charts describe: FROM and WHERE sliced from the typed text, never rebuilt. */
export interface SpanSet {
  kind: "set";
  subject: SpanSetSubject;
  /** The WITH clause the RED query keeps in front, as typed. */
  with: string;
  from: string;
  where: string;
  dropped: RedDroppedClause[];
  /** The RED query keeps a subquery or CTE, so it must stay one partition. */
  keepsSubquery: boolean;
  cte?: string;
  branches?: number;
}

/** No span set: the text does not parse, reads a stream that is not traces, or has a shape the ladder cannot read. */
export interface NoSpanSet {
  kind: "none";
  reason: "unreadable" | "notTraces" | "shape";
  stream?: string;
}

export type SpanSetResult = SpanSet | NoSpanSet;

interface SpanSetContext {
  isTracesStream: (name: string) => boolean;
  /** CTEs in scope by lower-cased name. */
  ctes: Map<string, CteEntry>;
}

interface CteEntry {
  body: string;
  /** CTEs the body may read: only those defined before it, so a body never resolves to itself. */
  scope: Map<string, CteEntry>;
}

interface Token {
  kind: "word" | "quoted" | "string" | "number" | "punct";
  text: string;
  start: number;
  end: number;
  depth: number;
}

const DEFAULT_PARSED_RESULT: ParsedSQLResult = {
  columns: [],
  from: [],
  orderby: null,
  limit: null,
  groupby: null,
  where: null,
};

// Clause keywords that end a top-level WHERE.
const WHERE_END_WORDS = new Set([
  "group",
  "having",
  "order",
  "limit",
  "offset",
  "fetch",
  "union",
  "intersect",
  "except",
  "window",
  "qualify",
]);

// DataFusion aggregates the parser types as plain functions rather than aggr_func.
const AGGREGATE_FUNCTIONS = new Set([
  "count",
  "sum",
  "min",
  "max",
  "avg",
  "mean",
  "median",
  "approx_distinct",
  "approx_median",
  "approx_percentile_cont",
  "approx_percentile_cont_with_weight",
  "array_agg",
  "string_agg",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "var",
  "var_pop",
  "var_samp",
  "variance",
  "corr",
  "covar",
  "covar_pop",
  "covar_samp",
  "first_value",
  "last_value",
  "bit_and",
  "bit_or",
  "bit_xor",
  "bool_and",
  "bool_or",
]);

const STRAY_BEFORE_WHERE = new Set(["and", "or", "not"]);

const DROPPED_ORDER: RedDroppedClause[] = [
  "groupBy",
  "having",
  "distinct",
  "orderBy",
  "limit",
  "offset",
  "window",
  "qualify",
  "outerWhere",
  "bothSidesWhere",
  "join",
];

const JOIN_WORDS = new Set(["inner", "left", "right", "full", "outer", "cross", "natural", "join"]);

const SET_OPERATORS = new Set(["union", "intersect", "except"]);

// Results, the count and the RED strip read the same run's text, so they share its parse.
let lastParse: { text: string; parser: any; ast: ParsedSQLResult & Record<string, any> } | null =
  null;

/** The column match_all is rewritten to search when the stream has no full-text fields. */
export const MATCH_ALL_FALLBACK_FIELD = "operation_name";

const FIELD_UNITS: Record<string, string> = { duration: "µs", start_time: "ns", end_time: "ns" };

const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/** Parses with the shared parser; anything it cannot read comes back as the empty default. Callers must not mutate the result. */
export function parseTracesSql(sql: string, parser: any): ParsedSQLResult & Record<string, any> {
  const text = stripCommentLines(sql ?? "");
  if (lastParse && lastParse.text === text && lastParse.parser === parser) return lastParse.ast;
  const ast = astOf(text, parser);
  lastParse = { text, parser, ast };
  return ast;
}

/** Reads the parts of typed SQL the Traces page needs; the WHERE is sliced from the text, never rebuilt. */
export function analyzeTracesSql(sql: string, parser: any): TracesSqlInfo {
  const text = sql ?? "";
  const tokens = tokenize(text);
  const top = tokens.filter((tok) => tok.depth === 0);
  const first = top[0];
  const firstWord = first?.kind === "word" ? first.text.toLowerCase() : "";
  const explain = firstWord === "explain";
  const isStatement = firstWord === "select" || firstWord === "with" || explain;

  const selectIdx = top.findIndex((tok) => isKeyword(tok, "select"));
  const fromIdx =
    selectIdx < 0 ? -1 : top.findIndex((tok, i) => i > selectIdx && isKeyword(tok, "from"));
  const afterFrom = (i: number) => fromIdx >= 0 && i > fromIdx;
  const hasTop = (word: string) => top.some((tok, i) => afterFrom(i) && isKeyword(tok, word));

  const distinct = selectIdx >= 0 && isKeyword(top[selectIdx + 1], "distinct");
  const selectList = selectIdx >= 0 && fromIdx >= 0 ? top.slice(selectIdx + 1, fromIdx) : [];
  const selectAll =
    selectList.length === 1 && selectList[0].kind === "punct" && selectList[0].text === "*";

  // The FROM target is the token right after FROM, at any depth, so "(" means a subquery.
  const fromTok = fromIdx >= 0 ? top[fromIdx] : undefined;
  const target = fromTok ? tokens.find((tok) => tok.start >= fromTok.end) : undefined;
  const fromSubquery = target?.kind === "punct" && target.text === "(";
  const stream =
    target?.kind === "word"
      ? target.text
      : target?.kind === "quoted"
        ? target.text.slice(1, -1).replaceAll('""', '"')
        : null;

  const groupBy = top.some(
    (tok, i) => afterFrom(i) && isKeyword(tok, "group") && isKeyword(top[i + 1], "by"),
  );
  const having = hasTop("having");
  const union = top.some(
    (tok) => isKeyword(tok, "union") || isKeyword(tok, "intersect") || isKeyword(tok, "except"),
  );
  const limitIdx = top.findIndex((tok, i) => afterFrom(i) && isKeyword(tok, "limit"));
  const limitTok = limitIdx >= 0 ? top[limitIdx + 1] : undefined;
  const limit = limitTok?.kind === "number" ? Number(limitTok.text) : null;

  const where = sliceWhere(text, top, fromIdx);
  const parsed = parseTracesSql(text, parser);
  const columns: any[] = Array.isArray(parsed.columns) ? parsed.columns : [];
  const aggregate =
    columns.length > 0
      ? columns.some((col) => hasAggregate(col?.expr))
      : selectListHasAggregate(tokens, selectIdx >= 0 ? top[selectIdx] : undefined, fromTok);

  const selectNames = selectNamesOf(columns);

  const join = hasTop("join");
  return {
    isStatement,
    where,
    stream: fromSubquery ? null : stream,
    fromClause: sliceFrom(text, top, fromIdx),
    selectAll,
    groupBy: groupBy || having,
    aggregate,
    join,
    with: firstWord === "with",
    union,
    distinct,
    hasLimit: limitIdx >= 0,
    limit,
    fromSubquery,
    explain,
    selectNames,
    selectExplicit: !selectAll && columns.length > 0 && selectNames.length === columns.length,
  };
}

/** True when every result row is one span, so the WHERE count and paging describe the rows. */
export function isRowQuery(info: TracesSqlInfo): boolean {
  return (
    info.isStatement &&
    !info.explain &&
    !info.with &&
    !info.union &&
    !info.join &&
    !info.groupBy &&
    !info.aggregate &&
    !info.distinct &&
    !info.hasLimit &&
    !info.fromSubquery &&
    info.stream !== null
  );
}

/** True when result rows are groups, which the server can still change until the stream ends. */
export function mergesAcrossPartitions(info: TracesSqlInfo): boolean {
  return info.groupBy || info.aggregate || info.distinct;
}

/** The span set the RED charts describe for typed SQL: the first rule of the ladder that fits. */
export function deriveSpanSet(
  sql: string,
  parser: any,
  options: { isTracesStream?: (name: string) => boolean } = {},
): SpanSetResult {
  const text = statementText(sql ?? "");
  const first = tokenize(text)[0];
  if (!isKeyword(first, "select") && !isKeyword(first, "with")) return noSpanSet("unreadable");
  if (parseTracesSql(withoutQualify(text), parser).type !== "select") {
    return noSpanSet("unreadable");
  }
  return spanSetOf(text, {
    isTracesStream: options.isTracesStream ?? (() => true),
    ctes: new Map(),
  });
}

/** histogram() with a subquery or CTE is split by time partition on the stream path and can lose spans. */
export function histogramLosesSpans(sql: string): boolean {
  const tokens = tokenize(sql ?? "");
  const histogram = tokens.some(
    (tok, i) => isKeyword(tok, "histogram") && tokens[i + 1]?.text === "(",
  );
  const cte = isKeyword(tokens[0], "with");
  const subquery = tokens.some((tok) => tok.depth > 0 && isKeyword(tok, "select"));
  return histogram && (cte || subquery);
}

/** The request window for typed SQL: grouped or limited rows come in one request, row queries page. */
export function sqlPaging(
  info: TracesSqlInfo,
  rowsPerPage: number,
  currentPage: number,
): { from: number; size: number; paged: boolean } {
  if (info.limit !== null) return { from: 0, size: info.limit, paged: false };
  if (!isRowQuery(info)) return { from: 0, size: -1, paged: false };
  return { from: currentPage * rowsPerPage, size: rowsPerPage, paged: true };
}

/** The statement SQL mode starts from: the filter as the WHERE, newest spans first. */
export function buildTracesSql(stream: string, filter: string): string {
  const where = filter.trim() ? ` WHERE ${filter.trim()}` : "";
  return `SELECT * FROM "${stream.replaceAll('"', '""')}"${where} ORDER BY start_time DESC`;
}

/** "Add trace_id" only makes sense where trace_id can sit next to the other columns. */
export function canAddTraceId(info: TracesSqlInfo): boolean {
  return info.isStatement && !info.groupBy && !info.aggregate && !info.union && !info.distinct;
}

/** Puts trace_id first in the top-level select list, or returns null for text that is not a SELECT. */
export function insertTraceIdColumn(sql: string): string | null {
  const top = tokenize(sql).filter((tok) => tok.depth === 0);
  const selectIdx = top.findIndex(
    (tok) => tok.kind === "word" && tok.text.toLowerCase() === "select",
  );
  if (selectIdx < 0) return null;
  const next = top[selectIdx + 1];
  const anchor =
    next?.kind === "word" && ["distinct", "all"].includes(next.text.toLowerCase())
      ? next
      : top[selectIdx];
  return `${sql.slice(0, anchor.end)} trace_id,${sql.slice(anchor.end)}`;
}

/** The top-level WHERE of SQL text as a Traces filter, sliced as typed, or why there is none to run. */
export function tracesFilterFromSql(
  sql: string,
  parser: any,
): { filter: string; problem: SqlWhereProblem | null } {
  const none = (problem: SqlWhereProblem) => ({ filter: "", problem });
  const info = analyzeTracesSql(sql, parser);
  if (!info.isStatement || parseTracesSql(sql, parser).type !== "select") return none("unreadable");
  if (!info.where || info.with || info.union || info.join || info.fromSubquery) {
    return none("noWhere");
  }
  // A subquery would run once per partition on the trace list, and a qualified name means nothing on one stream.
  const tokens = tokenize(info.where);
  const subquery = tokens.some((tok) => tok.kind === "word" && tok.text.toLowerCase() === "select");
  const qualified = tokens.some(
    (tok, i) =>
      tok.kind === "punct" &&
      tok.text === "." &&
      tokens[i - 1]?.end === tok.start &&
      tokens[i + 1]?.start === tok.end,
  );
  if (subquery || qualified) return none("noWhere");
  return { filter: info.where, problem: null };
}

/** Result shape from the returned columns: span rows open a span, trace rows open a trace. */
export function resultShape(keys: string[]): TracesSqlShape {
  if (keys.includes("trace_id") && keys.includes("span_id")) return "spans";
  if (keys.includes("trace_id")) return "traces";
  return "rows";
}

/** Every returned column once, in select-list order and then in order of first appearance. */
export function resultKeys(
  hits: Record<string, unknown>[],
  selectNames: string[],
  explicit = false,
): string[] {
  const seen = new Set<string>();
  for (const hit of hits) for (const key of Object.keys(hit ?? {})) seen.add(key);
  // The server omits a null value's key and adds keys like _timestamp, so hits alone misreport the columns.
  if (explicit) {
    const keyOf = (name: string) =>
      seen.has(name)
        ? name
        : ([...seen].find((key) => key.toLowerCase() === name.toLowerCase()) ?? name);
    return [...new Set(selectNames.map(keyOf))];
  }
  const ordered = selectNames.filter((name) => seen.has(name));
  const named = new Set(ordered);
  return [...ordered, ...[...seen].filter((key) => !named.has(key))];
}

/** Fields with their stored time unit in `type`, which autocomplete shows as the detail. */
export function withFieldUnits<T extends { name: string; dataType?: string }>(
  fields: T[],
): (T & { type?: string })[] {
  return fields.map((field) => {
    const unit = FIELD_UNITS[field.name];
    if (!unit) return field;
    return { ...field, type: field.dataType ? `${field.dataType} · ${unit}` : unit };
  });
}

/** Renames a column wherever it is an identifier; strings and comments keep their text. */
export function replaceSqlIdentifier(sql: string, from: string, to: string): string {
  const bare = from.toLowerCase();
  const hits = tokenize(sql).filter(
    (tok) =>
      (tok.kind === "word" && tok.text.toLowerCase() === bare) ||
      (tok.kind === "quoted" && tok.text === `"${from}"`),
  );
  return hits.reduceRight(
    (out, tok) =>
      out.slice(0, tok.start) + (tok.kind === "quoted" ? `"${to}"` : to) + out.slice(tok.end),
    sql,
  );
}

/** Adds a condition to the top-level WHERE by slicing the text; null when there is no single statement WHERE to add to. */
export function insertWhereCondition(sql: string, condition: string): string | null {
  const text = sql ?? "";
  const clause = topLevelWhere(text);
  if (!clause) return null;
  const { whereTok, body } = clause;
  const first = body[0];
  const last = body[body.length - 1];
  if (!whereTok) return `${text.slice(0, last.end)} WHERE ${condition}${text.slice(last.end)}`;
  // A top-level OR binds looser than AND, so the typed condition is wrapped to stay whole.
  const hasOr = body.some((tok) => tok.depth === 0 && isKeyword(tok, "or"));
  const typed = text.slice(first.start, last.end);
  const kept = hasOr ? `(${typed})` : typed;
  return `${text.slice(0, first.start)}${kept} AND ${condition}${text.slice(last.end)}`;
}

/** Swaps the top-level WHERE's value conditions on one field for `condition` (empty removes them); null when nothing changes. */
export function replaceFieldConditions(
  sql: string,
  field: string,
  condition: string,
  ref?: string,
): string | null {
  const text = sql ?? "";
  const clause = topLevelWhere(text);
  const parts =
    clause?.whereTok && !clause.body.some((tok) => tok.depth === 0 && isKeyword(tok, "or"))
      ? splitTopAnd(clause.body)
      : [];
  const spellings = [field, ref ?? ""].filter(Boolean).map(spelling);
  const families = parts.map((part) => fieldValueFamily(part.tokens, field, spellings));
  const found = new Set(families.filter(Boolean));
  if (!clause?.whereTok || found.size === 0) {
    return condition ? insertWhereCondition(text, condition) : null;
  }
  // A typed mix of included and excluded values is the user's own; one tick must not rewrite it.
  if (found.size > 1 || found.has("mixed")) return null;
  const first = clause.body[0];
  const last = clause.body[clause.body.length - 1];
  const keptAt = families.findIndex((family) => family === null);
  if (keptAt < 0) {
    if (condition) return `${text.slice(0, first.start)}${condition}${text.slice(last.end)}`;
    return `${text.slice(0, clause.whereTok.start).trimEnd()}${text.slice(last.end)}`;
  }
  // Only the removed conditions and their AND are cut, so comments and the user's spelling stay.
  const cuts: [number, number][] = [];
  if (keptAt > 0) cuts.push([first.start, parts[keptAt].and!.end]);
  parts.forEach((part, i) => {
    if (i > keptAt && families[i])
      cuts.push([part.and!.start, part.tokens[part.tokens.length - 1].end]);
  });
  let out = condition ? `${text.slice(0, last.end)} AND ${condition}${text.slice(last.end)}` : text;
  for (const [start, end] of cuts.reverse()) {
    const spaced = /\s/.test(out[start - 1] ?? "") && (end >= out.length || /\s/.test(out[end]));
    out = out.slice(0, spaced ? start - 1 : start) + out.slice(end);
  }
  return out;
}

/** True when the top-level GROUP BY is trace_id alone, so each result row is one trace. */
export function groupsByTraceIdOnly(sql: string): boolean {
  const top = tokenize(sql ?? "").filter((tok) => tok.depth === 0);
  const at = top.findIndex((tok, i) => isKeyword(tok, "group") && isKeyword(top[i + 1], "by"));
  if (at < 0) return false;
  const keys: Token[] = [];
  for (const tok of top.slice(at + 2)) {
    if (isPunct(tok, ";") || (tok.kind === "word" && WHERE_END_WORDS.has(tok.text.toLowerCase())))
      break;
    keys.push(tok);
  }
  return keys.length === 1 && nameOf(keys[0]) === "trace_id";
}

/** Names fields stored in the _all column by their json_get expression; strings and other names keep their text. */
export function withAllFieldRefs(condition: string, refs: Map<string, string>): string {
  if (refs.size === 0) return condition;
  const hits = tokenize(condition).filter((tok) => tok.kind === "word" && refs.has(tok.text));
  return hits.reduceRight(
    (out, tok) => out.slice(0, tok.start) + refs.get(tok.text) + out.slice(tok.end),
    condition,
  );
}

/** Every match_all('x') rewritten as str_match(field, 'x'); null when there is none. */
export function matchAllToStrMatch(
  sql: string,
  field: string,
): { sql: string; call: string } | null {
  const tokens = tokenize(sql);
  const calls: { start: number; end: number; call: string }[] = [];
  tokens.forEach((tok, i) => {
    const [open, literal, close] = tokens.slice(i + 1, i + 4);
    if (
      tok.kind === "word" &&
      tok.text.toLowerCase() === "match_all" &&
      open?.text === "(" &&
      literal?.kind === "string" &&
      close?.text === ")"
    ) {
      calls.push({
        start: tok.start,
        end: close.end,
        call: `str_match(${field}, ${literal.text})`,
      });
    }
  });
  if (calls.length === 0) return null;
  const rewritten = calls.reduceRight(
    (out, c) => out.slice(0, c.start) + c.call + out.slice(c.end),
    sql,
  );
  return { sql: rewritten, call: calls[0].call };
}

/** AND/OR/NOT between the FROM target and WHERE, which the server drops instead of rejecting. */
export function strayKeywordBeforeWhere(
  sql: string,
): { start: number; end: number; word: string } | null {
  const top = tokenize(sql).filter((tok) => tok.depth === 0);
  const fromIdx = top.findIndex((tok) => isKeyword(tok, "from"));
  const whereIdx = top.findIndex((tok, i) => i > fromIdx && isKeyword(tok, "where"));
  if (fromIdx < 0 || whereIdx < 0) return null;
  const between = top.slice(fromIdx + 2, whereIdx);
  if (between.some((tok) => isKeyword(tok, "join") || isKeyword(tok, "on"))) return null;
  const stray = between.find(
    (tok) => tok.kind === "word" && STRAY_BEFORE_WHERE.has(tok.text.toLowerCase()),
  );
  return stray ? { start: stray.start, end: stray.end, word: stray.text } : null;
}

/** FROM followed directly by WHERE, so the stream name is missing. */
export function missingStreamAfterFrom(sql: string): boolean {
  const tokens = tokenize(sql);
  return tokens.some((tok, i) => isKeyword(tok, "from") && isKeyword(tokens[i + 1], "where"));
}

export function sqlJoinKeyword(sql: string): { start: number; end: number } | null {
  const tok = tokenize(sql).find((t) => t.kind === "word" && t.text.toLowerCase() === "join");
  return tok ? { start: tok.start, end: tok.end } : null;
}

function sliceFrom(text: string, top: Token[], fromIdx: number): string {
  if (fromIdx < 0) return "";
  const end = top.find(
    (tok, i) =>
      i > fromIdx &&
      ((tok.kind === "word" &&
        (tok.text.toLowerCase() === "where" || WHERE_END_WORDS.has(tok.text.toLowerCase()))) ||
        (tok.kind === "punct" && tok.text === ";")),
  );
  return stripSqlComments(text.slice(top[fromIdx].end, end ? end.start : text.length)).trim();
}

function sliceWhere(text: string, top: Token[], fromIdx: number): string {
  if (fromIdx < 0) return "";
  const whereIdx = top.findIndex(
    (tok, i) => i > fromIdx && tok.kind === "word" && tok.text.toLowerCase() === "where",
  );
  if (whereIdx < 0) return "";
  const end = top.find(
    (tok, i) =>
      i > whereIdx &&
      ((tok.kind === "word" && WHERE_END_WORDS.has(tok.text.toLowerCase())) ||
        (tok.kind === "punct" && tok.text === ";")),
  );
  return stripSqlComments(text.slice(top[whereIdx].end, end ? end.start : text.length)).trim();
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const masked = maskedSpanEnd(text, i);
    if (masked !== null) {
      if (ch === "'" || ch === '"') {
        const kind = ch === "'" ? "string" : "quoted";
        tokens.push({ kind, text: text.slice(i, masked), start: i, end: masked, depth });
      }
      i = masked;
      continue;
    }
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && WORD_CHAR.test(text[j])) j++;
      tokens.push({ kind: "word", text: text.slice(i, j), start: i, end: j, depth });
      i = j;
      continue;
    }
    if (DIGIT.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      tokens.push({ kind: "number", text: text.slice(i, j), start: i, end: j, depth });
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ")") depth = Math.max(0, depth - 1);
    tokens.push({ kind: "punct", text: ch, start: i, end: i + 1, depth });
    if (ch === "(") depth++;
    i++;
  }
  return tokens;
}

// The top-level WHERE keyword (null when there is none) and the tokens of its condition, or of the FROM target without one.
function topLevelWhere(text: string): { whereTok: Token | null; body: Token[] } | null {
  const tokens = tokenize(text);
  const top = tokens.filter((tok) => tok.depth === 0);
  if (top.some((tok) => tok.kind === "word" && SET_OPERATORS.has(tok.text.toLowerCase()))) {
    return null;
  }
  const selectIdx = top.findIndex((tok) => isKeyword(tok, "select"));
  const fromIdx =
    selectIdx < 0 ? -1 : top.findIndex((tok, i) => i > selectIdx && isKeyword(tok, "from"));
  if (fromIdx < 0) return null;
  const whereIdx = top.findIndex((tok, i) => i > fromIdx && isKeyword(tok, "where"));
  const start = whereIdx >= 0 ? whereIdx : fromIdx;
  const endTok = top.find(
    (tok, i) =>
      i > start &&
      ((tok.kind === "word" && WHERE_END_WORDS.has(tok.text.toLowerCase())) || isPunct(tok, ";")),
  );
  const clauseEnd = endTok ? endTok.start : text.length;
  const body = tokens.filter((tok) => tok.start >= top[start].end && tok.end <= clauseEnd);
  if (body.length === 0) return null;
  return { whereTok: whereIdx >= 0 ? top[whereIdx] : null, body };
}

// The AND of BETWEEN x AND y joins its bounds, not two conditions.
function splitTopAnd(body: Token[]): { and: Token | null; tokens: Token[] }[] {
  const parts: { and: Token | null; tokens: Token[] }[] = [{ and: null, tokens: [] }];
  let between = false;
  for (const tok of body) {
    if (tok.depth === 0 && isKeyword(tok, "between")) between = true;
    if (tok.depth === 0 && isKeyword(tok, "and")) {
      if (!between) {
        parts.push({ and: tok, tokens: [] });
        continue;
      }
      between = false;
    }
    parts[parts.length - 1].tokens.push(tok);
  }
  return parts.filter((part) => part.tokens.length > 0);
}

// SQL words are case-insensitive, so a typed JSON_GET_STR matches json_get_str.
function spellingOf(tokens: Token[]): string {
  return tokens.map((tok) => (tok.kind === "word" ? tok.text.toLowerCase() : tok.text)).join(" ");
}

function spelling(text: string): string {
  return spellingOf(tokenize(text));
}

type ValueFamily = "include" | "exclude" | "mixed";

// `field = v` / `IS NULL` include, `field != v` / `IS NOT NULL` exclude; a bracketed AND/OR of those takes their family.
function fieldValueFamily(part: Token[], field: string, spellings: string[]): ValueFamily | null {
  const close = isPunct(part[0], "(") ? matchingClose(part, part[0]) : undefined;
  const inner = close === part[part.length - 1] ? part.slice(1, -1) : part;
  if (inner.length === 0) return null;
  const depth = inner[0].depth;
  const atoms: Token[][] = [[]];
  for (const tok of inner) {
    if (tok.depth === depth && (isKeyword(tok, "and") || isKeyword(tok, "or"))) atoms.push([]);
    else atoms[atoms.length - 1].push(tok);
  }
  const families = new Set(atoms.map((atom) => fieldValueAtomFamily(atom, field, spellings)));
  if (families.has(null)) return null;
  return families.size > 1 ? "mixed" : [...families][0];
}

function fieldValueAtomFamily(
  atom: Token[],
  field: string,
  spellings: string[],
): ValueFamily | null {
  if (atom.length === 0) return null;
  const depth = atom[0].depth;
  const opIdx = atom.findIndex(
    (tok) =>
      tok.depth === depth &&
      (isKeyword(tok, "is") || (tok.kind === "punct" && "=!<>".includes(tok.text))),
  );
  if (opIdx <= 0) return null;
  const lhs = atom.slice(0, opIdx);
  const named =
    (lhs.length === 1 || (lhs.length === 3 && isPunct(lhs[1], ".") && nameOf(lhs[0]) !== null)) &&
    nameOf(lhs[lhs.length - 1]) === field;
  if (!named && !spellings.includes(spellingOf(lhs))) return null;
  const rest = atom.slice(opIdx);
  if (isKeyword(rest[0], "is")) {
    const negated = isKeyword(rest[1], "not");
    const tail = rest.slice(negated ? 2 : 1);
    if (tail.length !== 1 || !isKeyword(tail[0], "null")) return null;
    return negated ? "exclude" : "include";
  }
  const opLen = rest.findIndex((tok) => tok.kind !== "punct");
  const op = rest
    .slice(0, opLen)
    .map((tok) => tok.text)
    .join("");
  const value = rest.slice(opLen);
  const literal =
    value.length === 1 &&
    (value[0].kind === "string" ||
      value[0].kind === "number" ||
      isKeyword(value[0], "true") ||
      isKeyword(value[0], "false"));
  if (!literal || !["=", "!=", "<>"].includes(op)) return null;
  return op === "=" ? "include" : "exclude";
}

// Subqueries ("ast") are their own statements, so their aggregates are not this query's.
function hasAggregate(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasAggregate);
  if (node.type === "aggr_func") return true;
  if (node.type === "function" && AGGREGATE_FUNCTIONS.has(functionName(node))) return true;
  return Object.entries(node).some(([key, value]) => key !== "ast" && hasAggregate(value));
}

function functionName(node: any): string {
  const name = node?.name;
  if (typeof name === "string") return name.toLowerCase();
  const part = Array.isArray(name?.name) ? name.name[0]?.value : undefined;
  return typeof part === "string" ? part.toLowerCase() : "";
}

function selectListHasAggregate(
  tokens: Token[],
  selectTok: Token | undefined,
  fromTok: Token | undefined,
): boolean {
  if (!selectTok || !fromTok) return false;
  const list = tokens.filter((tok) => tok.start >= selectTok.end && tok.end <= fromTok.start);
  return list.some(
    (tok, i) =>
      tok.kind === "word" &&
      AGGREGATE_FUNCTIONS.has(tok.text.toLowerCase()) &&
      list[i + 1]?.kind === "punct" &&
      list[i + 1]?.text === "(",
  );
}

function selectNamesOf(columns: any[]): string[] {
  const names: string[] = [];
  for (const col of columns) {
    const alias = typeof col?.as === "string" ? col.as : null;
    const ref = col?.expr?.type === "column_ref" ? col.expr.column : null;
    const refName = typeof ref === "string" ? ref : ref?.expr?.value;
    const name = alias ?? (typeof refName === "string" ? refName : null);
    if (name && name !== "*") names.push(name);
  }
  return names;
}

function astOf(text: string, parser: any): ParsedSQLResult & Record<string, any> {
  try {
    if (!parser || maxParenDepth(text) > SQL_PARSE_MAX_DEPTH) return { ...DEFAULT_PARSED_RESULT };
    const parsed = parser.astify(text);
    const ast = Array.isArray(parsed) ? parsed[0] : parsed;
    return ast || { ...DEFAULT_PARSED_RESULT };
  } catch {
    return { ...DEFAULT_PARSED_RESULT };
  }
}

function isKeyword(tok: Token | undefined, word: string): boolean {
  return tok?.kind === "word" && tok.text.toLowerCase() === word;
}

function isPunct(tok: Token | undefined, text: string): boolean {
  return tok?.kind === "punct" && tok.text === text;
}

function nameOf(tok: Token | undefined): string | null {
  if (tok?.kind === "word") return tok.text;
  if (tok?.kind === "quoted") return tok.text.slice(1, -1).replaceAll('""', '"');
  return null;
}

function sliceText(text: string, start: number, end: number): string {
  return stripSqlComments(text.slice(start, end)).trim();
}

function noSpanSet(reason: NoSpanSet["reason"], stream?: string): NoSpanSet {
  return stream === undefined ? { kind: "none", reason } : { kind: "none", reason, stream };
}

function mergeDropped(...lists: RedDroppedClause[][]): RedDroppedClause[] {
  const all = new Set(lists.flat());
  return DROPPED_ORDER.filter((clause) => all.has(clause));
}

function joinWhere(a: string, b: string): string {
  return a && b ? `(${a}) AND (${b})` : a || b;
}

function hasSubquery(where: string): boolean {
  return tokenize(where).some((tok) => isKeyword(tok, "select"));
}

function matchingClose(tokens: Token[], open: Token): Token | undefined {
  return tokens.find(
    (tok) => tok.start > open.start && isPunct(tok, ")") && tok.depth === open.depth,
  );
}

// EXPLAIN shows a plan, but its charts describe the statement it explains.
function statementText(text: string): string {
  const top = tokenize(text).filter((tok) => tok.depth === 0);
  if (!isKeyword(top[0], "explain")) return text;
  const start = top.find((tok) => isKeyword(tok, "select") || isKeyword(tok, "with"));
  return start ? text.slice(start.start) : "";
}

// The parser cannot read QUALIFY, which the charts drop anyway.
function withoutQualify(text: string): string {
  const top = tokenize(text).filter((tok) => tok.depth === 0);
  const at = top.findIndex((tok) => isKeyword(tok, "qualify"));
  if (at < 0) return text;
  const end = top.find(
    (tok, i) =>
      i > at &&
      (isPunct(tok, ";") ||
        ["order", "limit", "offset", "fetch", "window"].some((word) => isKeyword(tok, word))),
  );
  return `${text.slice(0, top[at].start)} ${end ? text.slice(end.start) : ""}`;
}

function spanSetOf(text: string, ctx: SpanSetContext): SpanSetResult {
  const tokens = tokenize(text);
  const top = tokens.filter((tok) => tok.depth === 0);
  if (isKeyword(top[0], "with")) return cteSpanSet(text, tokens, top, ctx);
  const setOps = top.filter(
    (tok) => tok.kind === "word" && SET_OPERATORS.has(tok.text.toLowerCase()),
  );
  if (setOps.length) return unionSpanSet(text, top, setOps, ctx);
  return selectSpanSet(text, tokens, top, ctx);
}

function selectSpanSet(
  text: string,
  tokens: Token[],
  top: Token[],
  ctx: SpanSetContext,
): SpanSetResult {
  const selectIdx = top.findIndex((tok) => isKeyword(tok, "select"));
  const fromIdx = top.findIndex((tok, i) => i > selectIdx && isKeyword(tok, "from"));
  if (selectIdx < 0 || fromIdx < 0) return noSpanSet("shape");
  const dropped = droppedClauses(top, selectIdx, fromIdx);
  const where = sliceWhere(text, top, fromIdx);
  const target = tokens.find((tok) => tok.start >= top[fromIdx].end);
  const fromEnd = top.findIndex(
    (tok, i) =>
      i > fromIdx &&
      (isKeyword(tok, "where") ||
        isPunct(tok, ";") ||
        (tok.kind === "word" && WHERE_END_WORDS.has(tok.text.toLowerCase()))),
  );
  const region = top.slice(fromIdx + 1, fromEnd < 0 ? top.length : fromEnd);
  const joined = region.some((tok) => isKeyword(tok, "join") || isPunct(tok, ","));
  if (isPunct(target, "(")) {
    const outer = joined ? mergeDropped(dropped, ["join"]) : dropped;
    return fromSubquerySpanSet(text, tokens, target!, where, outer, ctx);
  }
  if (joined) return joinSpanSet(text, region, where, dropped, ctx);
  const stream = nameOf(target);
  if (stream === null) return noSpanSet("shape");
  const from = sliceFrom(text, top, fromIdx);
  const cte = ctx.ctes.get(stream.toLowerCase());
  if (cte !== undefined) return cteReadSpanSet(stream, cte, from, where, dropped, ctx);
  if (!ctx.isTracesStream(stream)) return noSpanSet("notTraces", stream);
  return {
    kind: "set",
    subject: "matched",
    with: "",
    from,
    where,
    dropped,
    keepsSubquery: hasSubquery(where),
  };
}

function droppedClauses(top: Token[], selectIdx: number, fromIdx: number): RedDroppedClause[] {
  const after = (word: string) => top.some((tok, i) => i > fromIdx && isKeyword(tok, word));
  const pair = (word: string) =>
    top.some((tok, i) => i > fromIdx && isKeyword(tok, word) && isKeyword(top[i + 1], "by"));
  const over = top.some((tok, i) => i > selectIdx && i < fromIdx && isKeyword(tok, "over"));
  const found: Record<RedDroppedClause, boolean> = {
    groupBy: pair("group"),
    having: after("having"),
    distinct: isKeyword(top[selectIdx + 1], "distinct"),
    orderBy: pair("order"),
    limit: after("limit") || after("fetch"),
    offset: after("offset"),
    window: over || after("window"),
    qualify: after("qualify"),
    outerWhere: false,
    bothSidesWhere: false,
    join: false,
  };
  return DROPPED_ORDER.filter((clause) => found[clause]);
}

function cteSpanSet(
  text: string,
  tokens: Token[],
  top: Token[],
  ctx: SpanSetContext,
): SpanSetResult {
  const mainIdx = top.findIndex((tok) => isKeyword(tok, "select"));
  if (mainIdx < 0 || isKeyword(top[1], "recursive")) return noSpanSet("shape");
  const ctes = new Map(ctx.ctes);
  top.slice(0, mainIdx).forEach((tok, i) => {
    const open = top[i + 1];
    if (!isKeyword(tok, "as") || !isPunct(open, "(")) return;
    const close = matchingClose(tokens, open);
    // A column list sits between the name and AS: name (a, b) AS (...).
    const nameTok = isPunct(top[i - 1], ")") ? top[i - 3] : top[i - 1];
    const name = nameOf(nameTok);
    if (!name || !close) return;
    ctes.set(name.toLowerCase(), { body: text.slice(open.end, close.start), scope: new Map(ctes) });
  });
  const result = spanSetOf(text.slice(top[mainIdx].start), { ...ctx, ctes });
  if (result.kind === "none") return result;
  const readsCte = tokenize(`${result.from} ${result.where}`).some((tok) =>
    ctes.has((nameOf(tok) ?? "").toLowerCase()),
  );
  if (!readsCte) return result;
  return { ...result, with: sliceText(text, 0, top[mainIdx].start), keepsSubquery: true };
}

// A body that selects every column of plain rows can be read by name; any other body gives its own span set.
function cteReadSpanSet(
  name: string,
  cte: CteEntry,
  from: string,
  where: string,
  dropped: RedDroppedClause[],
  ctx: SpanSetContext,
): SpanSetResult {
  const { body } = cte;
  const inner = spanSetOf(body, { ...ctx, ctes: cte.scope });
  if (inner.kind === "none") return inner;
  const bodyTop = tokenize(body).filter((tok) => tok.depth === 0);
  const select = bodyTop.findIndex((tok) => isKeyword(tok, "select"));
  const selectsAll = isPunct(bodyTop[select + 1], "*") && isKeyword(bodyTop[select + 2], "from");
  if (selectsAll && inner.subject === "matched" && inner.dropped.length === 0) {
    return {
      kind: "set",
      subject: "cte",
      cte: name,
      with: "",
      from,
      where,
      dropped,
      keepsSubquery: true,
    };
  }
  return {
    ...inner,
    subject: "cte",
    cte: name,
    dropped: mergeDropped(inner.dropped, dropped, where ? ["outerWhere"] : []),
  };
}

function unionSpanSet(
  text: string,
  top: Token[],
  setOps: Token[],
  ctx: SpanSetContext,
): SpanSetResult {
  if (setOps.some((tok) => !isKeyword(tok, "union"))) return noSpanSet("shape");
  const starts = [
    0,
    ...setOps.map((op) => {
      const next = top[top.indexOf(op) + 1];
      return isKeyword(next, "all") || isKeyword(next, "distinct") ? next.end : op.end;
    }),
  ];
  const ends = [...setOps.map((op) => op.start), text.length];
  const sets: SpanSet[] = [];
  for (let i = 0; i < starts.length; i++) {
    const branch = spanSetOf(text.slice(starts[i], ends[i]), ctx);
    if (branch.kind === "none") return branch;
    if (branch.subject !== "matched" || branch.with) return noSpanSet("shape");
    sets.push(branch);
  }
  const from = canonicalFrom(sets[0].from);
  if (sets.some((set) => canonicalFrom(set.from) !== from)) return noSpanSet("shape");
  return {
    kind: "set",
    subject: "branches",
    branches: sets.length,
    with: "",
    from,
    where: sets.some((set) => !set.where) ? "" : sets.map((set) => `(${set.where})`).join(" OR "),
    dropped: mergeDropped(...sets.map((set) => set.dropped)),
    keepsSubquery: sets.some((set) => set.keepsSubquery),
  };
}

// A bare or quoted stream name reads the same stream either way.
function canonicalFrom(from: string): string {
  const tokens = tokenize(from);
  const name = tokens.length === 1 ? nameOf(tokens[0]) : null;
  return name === null ? from.replace(/\s+/g, " ") : `"${name.replaceAll('"', '""')}"`;
}

function fromSubquerySpanSet(
  text: string,
  tokens: Token[],
  open: Token,
  where: string,
  dropped: RedDroppedClause[],
  ctx: SpanSetContext,
): SpanSetResult {
  const close = matchingClose(tokens, open);
  if (!close) return noSpanSet("unreadable");
  const innerText = text.slice(open.end, close.start);
  const inner = spanSetOf(innerText, ctx);
  if (inner.kind === "none") return inner;
  const outerKept = !!where && !namesComputedColumn(where, innerText);
  return {
    ...inner,
    subject: "inner",
    where: outerKept ? joinWhere(inner.where, where) : inner.where,
    dropped: mergeDropped(inner.dropped, dropped, where && !outerKept ? ["outerWhere"] : []),
    keepsSubquery: inner.keepsSubquery || (outerKept && hasSubquery(where)),
  };
}

// An outer WHERE on a column the inner query computes, or on its alias, has no meaning for spans.
function namesComputedColumn(where: string, innerText: string): boolean {
  const computed = computedColumnNames(innerText);
  const tokens = tokenize(where).filter((tok) => tok.depth === 0);
  return tokens.some((tok) => isPunct(tok, ".") || computed.has((nameOf(tok) ?? "").toLowerCase()));
}

function computedColumnNames(selectText: string): Set<string> {
  const top = tokenize(selectText).filter((tok) => tok.depth === 0);
  const selectIdx = top.findIndex((tok) => isKeyword(tok, "select"));
  const fromIdx = top.findIndex((tok, i) => i > selectIdx && isKeyword(tok, "from"));
  const names = new Set<string>();
  if (selectIdx < 0 || fromIdx < 0) return names;
  let item: Token[] = [];
  const close = () => {
    const asAt = item.findIndex((tok) => isKeyword(tok, "as"));
    const expr = asAt >= 0 ? item.slice(0, asAt) : item.slice(0, -1);
    const alias = asAt >= 0 ? item[asAt + 1] : item.length > 1 ? item[item.length - 1] : undefined;
    const name = nameOf(alias);
    const plainColumn = expr.length === 1 && nameOf(expr[0])?.toLowerCase() === name?.toLowerCase();
    if (name && !plainColumn) names.add(name.toLowerCase());
    item = [];
  };
  for (const tok of top.slice(selectIdx + 1, fromIdx)) {
    if (isPunct(tok, ",")) close();
    else if (!isKeyword(tok, "distinct")) item.push(tok);
  }
  close();
  return names;
}

interface JoinItem {
  text: string;
  name: string | null;
  /** The name the WHERE qualifies its columns with. */
  qualifier: string;
  /** The prefix that qualifies trace_id for this side. */
  prefix: string;
}

function joinItem(text: string, tokens: Token[]): JoinItem | null {
  if (!tokens.length) return null;
  const name = nameOf(tokens[0]);
  const last = tokens[tokens.length - 1];
  const alias = tokens.length > 1 && last !== tokens[0] ? nameOf(last) : null;
  return {
    text: sliceText(text, tokens[0].start, last.end),
    name: isPunct(tokens[0], "(") ? null : name,
    qualifier: (alias ?? name ?? "").toLowerCase(),
    prefix: alias ? `${alias}.` : "",
  };
}

// R1 (d) for an inner join on trace_id; (a), the left WHERE alone, for any other join.
function joinSpanSet(
  text: string,
  region: Token[],
  where: string,
  dropped: RedDroppedClause[],
  ctx: SpanSetContext,
): SpanSetResult {
  const leftEnd = region.findIndex(
    (tok) => isPunct(tok, ",") || (tok.kind === "word" && JOIN_WORDS.has(tok.text.toLowerCase())),
  );
  const left = joinItem(text, region.slice(0, leftEnd));
  if (!left?.name) return noSpanSet("shape");
  if (!ctx.isTracesStream(left.name)) return noSpanSet("notTraces", left.name);
  const joinAt = region.findIndex((tok) => isKeyword(tok, "join"));
  const onAt = region.findIndex((tok) => isKeyword(tok, "on") || isKeyword(tok, "using"));
  const right = joinItem(text, region.slice(joinAt + 1, onAt < 0 ? region.length : onAt));
  const typeWords = region.slice(leftEnd, joinAt).map((tok) => tok.text.toLowerCase());
  const single =
    region.filter((tok) => isKeyword(tok, "join")).length === 1 &&
    !region.some((tok) => isPunct(tok, ","));
  const inner = typeWords.every((word) => word === "inner");
  const onText = onAt < 0 ? "" : text.slice(region[onAt].end, region[region.length - 1].end);
  const keyed =
    !!right &&
    onAt >= 0 &&
    (isKeyword(region[onAt], "using")
      ? tokenize(onText).some((tok) => isKeyword(tok, "trace_id"))
      : joinsOnTraceId(onText));
  const sides = splitAnd(where).map((cond) => ({ cond, side: conditionSide(cond, left, right) }));
  const leftConds = sides.filter((s) => s.side === "left").map((s) => s.cond);
  if (!(single && inner && keyed && right)) {
    return {
      kind: "set",
      subject: "joinLeft",
      with: "",
      from: left.text,
      where: leftConds.join(" AND "),
      dropped: mergeDropped(dropped, ["join"]),
      keepsSubquery: hasSubquery(leftConds.join(" ")),
    };
  }
  const rightConds = sides.filter((s) => s.side === "right").map((s) => s.cond);
  const rightWhere = rightConds.length ? ` WHERE ${rightConds.join(" AND ")}` : "";
  const matched = `${left.prefix}trace_id IN (SELECT DISTINCT ${right.prefix}trace_id FROM ${right.text}${rightWhere})`;
  return {
    kind: "set",
    subject: "joinMatched",
    with: "",
    from: left.text,
    where: [...leftConds, matched].join(" AND "),
    dropped: mergeDropped(dropped, sides.some((s) => s.side === "both") ? ["bothSidesWhere"] : []),
    keepsSubquery: true,
  };
}

function joinsOnTraceId(onText: string): boolean {
  const top = tokenize(onText).filter((tok) => tok.depth === 0);
  const qualifiedTraceId = (i: number) =>
    isPunct(top[i + 1], ".") && isKeyword(top[i + 2], "trace_id")
      ? nameOf(top[i])?.toLowerCase()
      : null;
  return top.some((tok, i) => {
    const a = qualifiedTraceId(i);
    const b = isPunct(top[i + 3], "=") ? qualifiedTraceId(i + 4) : null;
    return !!a && !!b && a !== b;
  });
}

// Bracketed when it holds a top-level OR, so joining conditions with AND keeps each one whole.
function splitAnd(where: string): string[] {
  const top = tokenize(where).filter((tok) => tok.depth === 0);
  const parts: string[] = [];
  let start = 0;
  let between = false;
  for (const tok of top) {
    if (isKeyword(tok, "between")) between = true;
    if (!isKeyword(tok, "and")) continue;
    if (between) {
      between = false;
      continue;
    }
    parts.push(where.slice(start, tok.start));
    start = tok.end;
  }
  parts.push(where.slice(start));
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      tokenize(part).some((tok) => tok.depth === 0 && isKeyword(tok, "or")) ? `(${part})` : part,
    );
}

// Unqualified columns read the left side, as the left FROM is what the charts keep.
function conditionSide(
  cond: string,
  left: JoinItem,
  right: JoinItem | null,
): "left" | "right" | "both" {
  const tokens = tokenize(cond).filter((tok) => tok.depth === 0);
  const qualifiers = new Set(
    tokens
      .filter((tok, i) => isPunct(tokens[i + 1], ".") && tokens[i + 1].start === tok.end)
      .map((tok) => (nameOf(tok) ?? "").toLowerCase()),
  );
  const readsRight = !!right && qualifiers.has(right.qualifier);
  const readsLeft = qualifiers.has(left.qualifier);
  if (readsRight && readsLeft) return "both";
  return readsRight ? "right" : "left";
}
