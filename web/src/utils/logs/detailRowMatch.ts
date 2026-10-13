// Copyright 2026 OpenObserve Inc.

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import { b64DecodeUnicode } from "@/utils/formatters";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";

export type LogRecord = Record<string, unknown>;

export type TrustworthyFields = string[] | "all";

/** The parts of an executed logs search request that decide which returned fields are stored values. */
export interface ExecutedSearchReq {
  sqlMode: boolean;
  encoding?: string;
  query: { sql?: string; query_fn?: string | null };
}

export interface DetailRowMatchOptions {
  timestampColumn?: string;
}

interface ProjectionColumn {
  expr?: { type?: string; table?: string | null; column?: unknown };
  as?: string | null;
}

const DEFAULT_TIMESTAMP_COLUMN = "_timestamp";
const IDENTIFIER_TYPES = new Set(["default", "double_quote_string", "backticks_quote_string"]);

let parser: Parser | null = null;

export function trustworthyFields(
  executedReq: ExecutedSearchReq,
  options: DetailRowMatchOptions = {},
): TrustworthyFields {
  if (executedReq.query.query_fn) {
    return [options.timestampColumn ?? DEFAULT_TIMESTAMP_COLUMN, "_o2_id"];
  }
  if (!executedReq.sqlMode) return "all";
  const columns = parseProjection(executedSql(executedReq));
  if (columns === "all") return "all";
  return projectionFields(columns, options.timestampColumn ?? DEFAULT_TIMESTAMP_COLUMN);
}

export function matchDetailRow(
  hits: readonly LogRecord[],
  snapshot: LogRecord,
  fields: TrustworthyFields,
  options: DetailRowMatchOptions = {},
): number | null {
  const timestampColumn = options.timestampColumn ?? DEFAULT_TIMESTAMP_COLUMN;
  const identityField = isPresent(snapshot._o2_id)
    ? "_o2_id"
    : isPresent(snapshot[timestampColumn])
      ? timestampColumn
      : null;
  if (identityField === null) return null;
  const survivors: number[] = [];
  hits.forEach((hit, index) => {
    if (snapshot._stream_name !== undefined && hit._stream_name !== snapshot._stream_name) return;
    if (!sameValue(hit[identityField], snapshot[identityField])) return;
    const compared = fields === "all" ? Object.keys(hit) : fields;
    if (compared.every((field) => sameValue(hit[field], snapshot[field]))) survivors.push(index);
  });
  if (survivors.length === 0) return null;
  const first = hits[survivors[0]];
  return survivors.every((index) => sameRecord(hits[index], first)) ? survivors[0] : null;
}

function projectionFields(columns: ProjectionColumn[], timestampColumn: string): TrustworthyFields {
  const aliases = new Set(columns.map((column) => column.as).filter((as): as is string => !!as));
  const bare = columns.map(bareColumnName);
  const hasWildcard = bare.includes("*");
  const hasComputed = bare.includes(null);
  if (hasWildcard && !hasComputed) return "all";
  const named = bare.filter((name): name is string => name !== null && name !== "*");
  const candidates = hasWildcard ? [timestampColumn, "_o2_id", ...named] : named;
  return [...new Set(candidates)].filter((name) => !aliases.has(name));
}

function executedSql(executedReq: ExecutedSearchReq): string {
  const sql = executedReq.query.sql ?? "";
  if (executedReq.encoding !== "base64") return sql;
  return b64DecodeUnicode(sql) ?? "";
}

function parseProjection(sql: string): ProjectionColumn[] | "all" {
  const filtered = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (!filtered.trim() || maxParenDepth(filtered) > SQL_PARSE_MAX_DEPTH) return [];
  try {
    parser ??= new Parser();
    const ast = parser.astify(filtered) as unknown;
    const statement = (Array.isArray(ast) ? ast[0] : ast) as { columns?: unknown } | undefined;
    if (statement?.columns === "*") return "all";
    return Array.isArray(statement?.columns) ? (statement.columns as ProjectionColumn[]) : [];
  } catch {
    return [];
  }
}

function bareColumnName(column: ProjectionColumn): string | null {
  if (column.as) return null;
  const expr = column.expr;
  if (expr?.type !== "column_ref" || expr.table) return null;
  if (typeof expr.column === "string") return expr.column;
  const inner = (expr.column as { expr?: { type?: string; value?: unknown } } | undefined)?.expr;
  if (!inner || !IDENTIFIER_TYPES.has(inner.type ?? "") || typeof inner.value !== "string") {
    return null;
  }
  return inner.value;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function sameRecord(a: LogRecord, b: LogRecord): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameValue(a[key], b[key])) return false;
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  return sameRecord(a as LogRecord, b as LogRecord);
}
