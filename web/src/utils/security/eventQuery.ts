// Copyright 2026 OpenObserve Inc.

// Built in one place so the rows, timeline and top values always describe the same filters.

import { toneOfSeverityId, type SeverityTone } from "./severity";
import { quoteIdent, quoteString } from "./sql";

export type FilterOp = "=" | "!=" | "contains" | "not_contains";

export interface FieldFilter {
  field: string;
  op: FilterOp | string;
  value: string;
}

/** An OCSF severity_id. */
export type SeverityValue = number;

/** Column alias the rows query projects the server's severity as. */
export const SEVERITY_ALIAS = "zo_severity_id";

export interface EventFilters {
  /** The server's OCSF severity expression; null when the stream says nothing about severity. */
  severitySql: string | null;
  severity: SeverityValue[];
  filters: FieldFilter[];
}

/** Backslash is the engine's default LIKE escape, so a typed `%` or `_` stays literal. */
const likePattern = (value: string) => quoteString(`%${value.replace(/[\\%_]/g, "\\$&")}%`);

export function filterClause(filter: FieldFilter): string {
  const field = quoteIdent(filter.field);
  switch (filter.op) {
    // `NULL != 'x'` is not true, so without the IS NULL arm excluding x would also hide rows lacking it.
    case "!=":
      return `(${field} != ${quoteString(filter.value)} OR ${field} IS NULL)`;
    // Cast so "contains" also works on numeric columns (LIKE on Int64 is a type error).
    case "contains":
      return `CAST(${field} AS VARCHAR) LIKE ${likePattern(filter.value)}`;
    case "not_contains":
      return `(CAST(${field} AS VARCHAR) NOT LIKE ${likePattern(filter.value)} OR ${field} IS NULL)`;
    default:
      return `${field} = ${quoteString(filter.value)}`;
  }
}

export function severityClause(f: EventFilters): string | null {
  if (!f.severitySql || !f.severity.length) return null;
  const values = f.severity.map(Number).filter((n) => Number.isInteger(n));
  if (!values.length) return null;
  const expr = `(${f.severitySql})`;
  return values.length === 1 ? `${expr} = ${values[0]}` : `${expr} IN (${values.join(", ")})`;
}

/** WHERE parts for the current filters; `withSeverity: false` drops the severity facet. */
export function whereParts(f: EventFilters, withSeverity = true): string[] {
  const parts: string[] = [];
  const severity = withSeverity ? severityClause(f) : null;
  if (severity) parts.push(severity);
  for (const filter of f.filters) parts.push(filterClause(filter));
  return parts;
}

const whereOf = (parts: string[]) => (parts.length ? ` WHERE ${parts.join(" AND ")}` : "");

export interface EventSort {
  field: string;
  order: "asc" | "desc";
}

/** Rows for the table, each with the server's severity; a column sort runs on the server. */
export function eventsSql(
  stream: string,
  parts: string[],
  sort?: EventSort | null,
  severitySql?: string | null,
): string {
  const dir = sort?.order === "asc" ? "ASC" : "DESC";
  // The severity is computed, so it sorts by its expression rather than a stored column.
  const key =
    sort?.field === SEVERITY_ALIAS && severitySql
      ? `(${severitySql})`
      : quoteIdent(sort?.field ?? "");
  const order =
    !sort || sort.field === "_timestamp"
      ? `_timestamp ${dir}`
      : `${key} ${dir} NULLS LAST, _timestamp DESC`;
  const severity = severitySql ? `, (${severitySql}) AS ${SEVERITY_ALIAS}` : "";
  return `SELECT *${severity} FROM ${quoteIdent(stream)}${whereOf(parts)} ORDER BY ${order}`;
}

/** Takes the projected severity off each row, so the rest is exactly what the stream stored. */
export function splitSeverity(hits: Record<string, unknown>[]): {
  rows: Record<string, unknown>[];
  severity: (number | null)[];
} {
  const severity: (number | null)[] = [];
  const rows = hits.map((hit) => {
    if (!(SEVERITY_ALIAS in hit)) {
      severity.push(null);
      return hit;
    }
    const { [SEVERITY_ALIAS]: id, ...row } = hit;
    const n = Number(id);
    severity.push(id === null || id === undefined || !Number.isFinite(n) ? null : n);
    return row;
  });
  return { rows, severity };
}

/** Callers omit the severity facet from `parts` so the chart shows the distribution the tiles select from. */
export function histogramSql(
  stream: string,
  parts: string[],
  severitySql: string | null,
  interval: string,
): string {
  const sev = severitySql ? `, (${severitySql}) AS zo_sev` : "";
  const groupSev = severitySql ? ", zo_sev" : "";
  return (
    `SELECT histogram(_timestamp, '${interval}') AS zo_ts${sev}, COUNT(*) AS zo_n ` +
    `FROM ${quoteIdent(stream)}${whereOf(parts)} GROUP BY zo_ts${groupSev} ORDER BY zo_ts`
  );
}

export function topValuesSql(stream: string, parts: string[], field: string, limit = 10): string {
  const col = quoteIdent(field);
  return (
    `SELECT ${col} AS zo_value, COUNT(*) AS zo_n FROM ${quoteIdent(stream)}${whereOf(parts)} ` +
    `GROUP BY zo_value ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

const INTERVALS: { sql: string; ms: number }[] = [
  { sql: "10 second", ms: 10_000 },
  { sql: "30 second", ms: 30_000 },
  { sql: "1 minute", ms: 60_000 },
  { sql: "5 minute", ms: 300_000 },
  { sql: "15 minute", ms: 900_000 },
  { sql: "30 minute", ms: 1_800_000 },
  { sql: "1 hour", ms: 3_600_000 },
  { sql: "3 hour", ms: 10_800_000 },
  { sql: "6 hour", ms: 21_600_000 },
  { sql: "12 hour", ms: 43_200_000 },
  { sql: "1 day", ms: 86_400_000 },
];

/** The smallest interval that keeps the chart at or under ~60 bars. */
export function histogramInterval(windowMs: number): { sql: string; ms: number } {
  return INTERVALS.find((i) => windowMs / i.ms <= 60) ?? INTERVALS[INTERVALS.length - 1];
}

/** A histogram key is an ISO string without zone (UTC) or epoch microseconds. */
export function histogramKeyToMs(key: unknown): number | null {
  if (typeof key === "number" && Number.isFinite(key)) return key > 1e14 ? key / 1000 : key;
  const text = String(key ?? "");
  if (!text) return null;
  if (/^\d+$/.test(text)) return histogramKeyToMs(Number(text));
  const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface HistogramResult {
  buckets: { ts: number; counts: Record<string, number> }[];
  totals: Record<SeverityTone, number>;
  /** Count per OCSF severity_id, so a severity filter's total is exact. */
  idCounts: Record<number, number>;
  total: number;
}

/** OCSF severity ids a tone stands for. */
export const TONE_SEVERITY_IDS: Record<SeverityTone, number[]> = {
  critical: [5, 6],
  high: [4],
  medium: [3],
  low: [2],
  info: [1],
  unknown: [0, 99],
};

/** With no severity every row lands in "info", read as neutral volume rather than a severity. */
export function foldHistogram(
  hits: Record<string, unknown>[],
  hasSeverity: boolean,
): HistogramResult {
  const empty = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 });
  const totals: Record<SeverityTone, number> = empty();
  const byTs = new Map<number, Record<string, number>>();
  const idCounts: Record<number, number> = {};
  let total = 0;
  for (const hit of hits) {
    const ts = histogramKeyToMs(hit.zo_ts);
    if (ts === null) continue;
    const n = Number(hit.zo_n ?? 0) || 0;
    const id = hasSeverity && hit.zo_sev != null && hit.zo_sev !== "" ? Number(hit.zo_sev) : null;
    const tone: SeverityTone = hasSeverity ? toneOfSeverityId(id) : "info";
    if (id !== null && Number.isFinite(id)) idCounts[id] = (idCounts[id] ?? 0) + n;
    const counts = byTs.get(ts) ?? empty();
    counts[tone] += n;
    byTs.set(ts, counts);
    totals[tone] += n;
    total += n;
  }
  return {
    buckets: [...byTs.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, counts]) => ({ ts, counts })),
    totals,
    idCounts,
    total,
  };
}

/** `_timestamp` alone is not unique (second-precision sources), so the row's scalar fields are matched too. */
export function eventMatchWhere(row: Record<string, unknown>, maxFields = 24): string {
  const parts = [`_timestamp = ${Number(row._timestamp)}`];
  for (const [field, value] of Object.entries(row)) {
    if (parts.length > maxFields) break;
    if (field === "_timestamp" || value === null || value === undefined) continue;
    // Past 2^53 the parsed number is not the stored one; matching on it would miss.
    if (
      typeof value === "number" &&
      Number.isSafeInteger(Math.trunc(value)) &&
      Number.isFinite(value)
    ) {
      parts.push(`${quoteIdent(field)} = ${value}`);
    } else if (typeof value === "string" && value.length <= 512) {
      parts.push(`${quoteIdent(field)} = ${quoteString(value)}`);
    }
  }
  return parts.join(" AND ");
}

/** Stable identity for a fetched row, for highlighting and refresh matching. */
export function eventKey(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const text = JSON.stringify(row, Object.keys(row).sort());
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  return `${row._timestamp ?? ""}:${(hash >>> 0).toString(36)}`;
}

/** Uppercase copy with every quoted span blanked, index-aligned with `text`; null when unsafe to edit. */
function maskSql(text: string): string | null {
  let masked = "";
  let quote: string | null = null;
  // By UTF-16 index, so `masked` and `text` stay index-aligned for slicing.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      // The engine honours backslash escapes, which this masker does not track.
      if (ch === "\\") return null;
      masked += " ";
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      masked += " ";
    } else {
      masked += ch.toUpperCase();
    }
  }
  return quote ? null : masked;
}

const AGGREGATE_CALL =
  /\b(COUNT|SUM|AVG|MIN|MAX|APPROX_[A-Z_]+|ARRAY_AGG|STRING_AGG|MEDIAN|STDDEV[A-Z_]*|VAR_[A-Z_]+|VARIANCE|HISTOGRAM)\s*\(/;

/** Whether a hand-written query returns computed rows rather than stored events. */
export function isAggregateSql(sql: string): boolean {
  const masked = maskSql(sql.trim());
  if (masked === null) return false;
  const fromAt = masked.search(/\sFROM\s/);
  const select = fromAt === -1 ? masked : masked.slice(0, fromAt);
  return (
    /\bGROUP\s+BY\b/.test(masked) || /\bDISTINCT\b/.test(select) || AGGREGATE_CALL.test(select)
  );
}

/** Result columns in the order the server returned them, else the hit keys in first-seen order. */
export function resultColumns(columns: unknown, hits: Record<string, unknown>[]): string[] {
  if (Array.isArray(columns) && columns.length && columns.every((c) => typeof c === "string")) {
    return columns as string[];
  }
  const seen = new Set<string>();
  for (const hit of hits) for (const key of Object.keys(hit)) seen.add(key);
  return [...seen];
}

/** Keywords are found outside literals and quoted names; returns null for shapes it cannot edit safely. */
export function addToSqlWhere(sql: string, clause: string): string | null {
  const text = sql.trim();
  const masked = maskSql(text);
  if (masked === null) return null;
  // An appended clause could land inside a comment and silently not filter.
  if (masked.includes("--") || masked.includes("/*")) return null;
  if (!/^SELECT\s/.test(masked) || /\b(UNION|JOIN)\b|\(\s*SELECT\b/.test(masked)) return null;
  const from = masked.search(/\sFROM\s/);
  if (from === -1) return null;
  // The WHERE ends at the first clause that follows it.
  const tails = [/\sGROUP\s+BY\s/, /\sHAVING\s/, /\sORDER\s+BY\s/, /\sLIMIT\s/]
    .map((re) => masked.search(re))
    .filter((i) => i > from);
  const end = tails.length ? Math.min(...tails) : text.length;
  const whereAt = masked.search(/\sWHERE\s/);
  const tail = text.slice(end);
  if (whereAt === -1 || whereAt > end) {
    return `${text.slice(0, end)} WHERE ${clause}${tail}`;
  }
  const where = text.slice(whereAt + " WHERE ".length, end).trim();
  return `${text.slice(0, whereAt)} WHERE (${where}) AND ${clause}${tail}`;
}
