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

export type SqlDroppedPart =
  "columns" | "grouping" | "joins" | "limit" | "distinct" | "with" | "union" | "stream" | "other";

export interface TracesSqlInfo {
  isStatement: boolean;
  /** Top-level WHERE condition sliced from the original text, comments removed. */
  where: string;
  stream: string | null;
  /** FROM target and its alias as typed, so a count over the WHERE resolves the same names. */
  fromClause: string;
  selectAll: boolean;
  plainSelectAll: boolean;
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

const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/** Parses with the shared parser; anything it cannot read comes back as the empty default. */
export function parseTracesSql(sql: string, parser: any): ParsedSQLResult & Record<string, any> {
  try {
    const text = stripCommentLines(sql ?? "");
    if (!parser || maxParenDepth(text) > SQL_PARSE_MAX_DEPTH) return { ...DEFAULT_PARSED_RESULT };
    const parsed = parser.astify(text);
    const ast = Array.isArray(parsed) ? parsed[0] : parsed;
    return ast || { ...DEFAULT_PARSED_RESULT };
  } catch {
    return { ...DEFAULT_PARSED_RESULT };
  }
}

/** Reads the parts of typed SQL the Traces page needs; the WHERE is sliced from the text, never rebuilt. */
export function analyzeTracesSql(sql: string, parser: any): TracesSqlInfo {
  const text = sql ?? "";
  const tokens = tokenize(text);
  const top = tokens.filter((tok) => tok.depth === 0);
  const isWord = (tok: Token | undefined, word: string) =>
    tok?.kind === "word" && tok.text.toLowerCase() === word;
  const first = top[0];
  const firstWord = first?.kind === "word" ? first.text.toLowerCase() : "";
  const explain = firstWord === "explain";
  const isStatement = firstWord === "select" || firstWord === "with" || explain;

  const selectIdx = top.findIndex((tok) => isWord(tok, "select"));
  const fromIdx =
    selectIdx < 0 ? -1 : top.findIndex((tok, i) => i > selectIdx && isWord(tok, "from"));
  const afterFrom = (i: number) => fromIdx >= 0 && i > fromIdx;
  const hasTop = (word: string) => top.some((tok, i) => afterFrom(i) && isWord(tok, word));

  const distinct = selectIdx >= 0 && isWord(top[selectIdx + 1], "distinct");
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
    (tok, i) => afterFrom(i) && isWord(tok, "group") && isWord(top[i + 1], "by"),
  );
  const having = hasTop("having");
  const union = top.some(
    (tok) => isWord(tok, "union") || isWord(tok, "intersect") || isWord(tok, "except"),
  );
  const limitIdx = top.findIndex((tok, i) => afterFrom(i) && isWord(tok, "limit"));
  const limitTok = limitIdx >= 0 ? top[limitIdx + 1] : undefined;
  const limit = limitTok?.kind === "number" ? Number(limitTok.text) : null;

  const where = sliceWhere(text, top, fromIdx);
  const parsed = parseTracesSql(text, parser);
  const columns: any[] = Array.isArray(parsed.columns) ? parsed.columns : [];
  const aggregate =
    columns.length > 0
      ? columns.some((col) => hasAggregate(col?.expr))
      : selectListHasAggregate(tokens, selectIdx >= 0 ? top[selectIdx] : undefined, fromTok);

  const targetIdx = target ? top.indexOf(target) : -1;
  const next = targetIdx >= 0 ? top[targetIdx + 1] : undefined;
  const cleanAfterTarget =
    !next ||
    isWord(next, "where") ||
    isWord(next, "order") ||
    (next.kind === "punct" && next.text === ";");
  const join = hasTop("join");
  const info: TracesSqlInfo = {
    isStatement,
    where,
    stream: fromSubquery ? null : stream,
    fromClause: sliceFrom(text, top, fromIdx),
    selectAll,
    plainSelectAll: false,
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
    selectNames: selectNamesOf(columns),
  };
  info.plainSelectAll =
    firstWord === "select" && selectAll && stream !== null && cleanAfterTarget && isRowQuery(info);
  return info;
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

/** RED charts can describe the query's spans only for a row query the server also accepts. */
export function isRedEligible(info: TracesSqlInfo, serverEligible?: boolean): boolean {
  return isRowQuery(info) && serverEligible !== false;
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

/** The filter text a statement turns into, and what filter mode cannot keep. */
export function sqlToFilter(
  info: TracesSqlInfo,
  selectedStream: string,
): { filter: string; dropped: SqlDroppedPart[] } {
  if (info.plainSelectAll && info.stream === selectedStream) {
    return { filter: info.where, dropped: [] };
  }
  const dropped: SqlDroppedPart[] = [];
  if (!info.selectAll) dropped.push("columns");
  if (info.groupBy || info.aggregate) dropped.push("grouping");
  if (info.join) dropped.push("joins");
  if (info.hasLimit) dropped.push("limit");
  if (info.distinct) dropped.push("distinct");
  if (info.with) dropped.push("with");
  if (info.union) dropped.push("union");
  if (info.stream !== selectedStream) dropped.push("stream");
  if (dropped.length === 0) dropped.push("other");
  return { filter: info.where, dropped };
}

/** "Add trace_id" only makes sense where trace_id can sit next to the other columns. */
export function canAddTraceId(info: TracesSqlInfo): boolean {
  return info.isStatement && !info.groupBy && !info.aggregate && !info.union;
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

/** Result shape from the returned columns: span rows open a span, trace rows open a trace. */
export function resultShape(keys: string[]): TracesSqlShape {
  if (keys.includes("trace_id") && keys.includes("span_id")) return "spans";
  if (keys.includes("trace_id")) return "traces";
  return "rows";
}

/** Every returned column once, in select-list order and then in order of first appearance. */
export function resultKeys(hits: Record<string, unknown>[], selectNames: string[]): string[] {
  const seen = new Set<string>();
  for (const hit of hits) for (const key of Object.keys(hit ?? {})) seen.add(key);
  const ordered = selectNames.filter((name) => seen.has(name));
  const named = new Set(ordered);
  return [...ordered, ...[...seen].filter((key) => !named.has(key))];
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
