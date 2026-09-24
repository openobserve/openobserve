// Copyright 2026 OpenObserve Inc.
//
// eventQuery.ts — the Events page SQL, built in one place so the rows, the
// timeline and the top values always describe the same filters.

import { toOcsfSeverity } from "./ocsf";
import { toneOfSeverityId, type SeverityTone } from "./severity";

export type FilterOp = "=" | "!=" | "contains" | "not_contains";

export interface FieldFilter {
  field: string;
  op: FilterOp | string;
  value: string;
}

export type SeverityValue = number | string;

export interface EventFilters {
  severityField: string | null;
  severityNumeric: boolean;
  severity: SeverityValue[];
  filters: FieldFilter[];
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** Backslash is the engine's default LIKE escape, so a typed `%` or `_` stays literal. */
const likePattern = (value: string) => quoteString(`%${value.replace(/[\\%_]/g, "\\$&")}%`);

export function filterClause(filter: FieldFilter): string {
  const field = quoteIdent(filter.field);
  switch (filter.op) {
    // Negations keep rows where the field is absent: `NULL != 'x'` is not true,
    // so without the IS NULL arm "exclude x" would also hide every row lacking it.
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
  if (!f.severityField || !f.severity.length) return null;
  const values = f.severityNumeric
    ? f.severity.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : f.severity.map((v) => quoteString(String(v)));
  if (!values.length) return null;
  const field = quoteIdent(f.severityField);
  return values.length === 1 ? `${field} = ${values[0]}` : `${field} IN (${values.join(", ")})`;
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

export function eventsSql(stream: string, parts: string[]): string {
  return `SELECT * FROM ${quoteIdent(stream)}${whereOf(parts)} ORDER BY _timestamp DESC`;
}

/**
 * Counts per time bucket, split by the raw severity value when there is one.
 * The severity facet is left out of `parts` by the caller so the chart shows
 * the whole distribution the severity tiles select from.
 */
export function histogramSql(
  stream: string,
  parts: string[],
  severityField: string | null,
  interval: string,
): string {
  const sev = severityField ? `, ${quoteIdent(severityField)} AS zo_sev` : "";
  const groupSev = severityField ? ", zo_sev" : "";
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
  /** Raw severity values seen per tone, so a tone can be turned back into a filter. */
  rawByTone: Record<SeverityTone, string[]>;
  /** Count per raw severity value, so a severity filter's total is exact. */
  rawCounts: Record<string, number>;
  total: number;
}

/**
 * Folds histogram rows onto severity tones. With no severity field every row
 * lands in "info", which reads as neutral volume rather than as a severity.
 */
export function foldHistogram(
  hits: Record<string, unknown>[],
  hasSeverity: boolean,
): HistogramResult {
  const empty = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 });
  const totals: Record<SeverityTone, number> = empty();
  const raw: Record<SeverityTone, Set<string>> = {
    critical: new Set(),
    high: new Set(),
    medium: new Set(),
    low: new Set(),
    info: new Set(),
    unknown: new Set(),
  };
  const byTs = new Map<number, Record<string, number>>();
  const rawCounts: Record<string, number> = {};
  let total = 0;
  for (const hit of hits) {
    const ts = histogramKeyToMs(hit.zo_ts);
    if (ts === null) continue;
    const n = Number(hit.zo_n ?? 0) || 0;
    const tone: SeverityTone = hasSeverity ? toneOfSeverityId(toOcsfSeverity(hit.zo_sev)) : "info";
    if (hasSeverity && hit.zo_sev != null && hit.zo_sev !== "") {
      const key = String(hit.zo_sev);
      raw[tone].add(key);
      rawCounts[key] = (rawCounts[key] ?? 0) + n;
    }
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
    rawByTone: Object.fromEntries(
      Object.entries(raw).map(([tone, set]) => [tone, [...set]]),
    ) as Record<SeverityTone, string[]>,
    rawCounts,
    total,
  };
}

/**
 * WHERE that pins one stored row. `_timestamp` alone is not an identity —
 * sources with second-precision clocks put many events on one timestamp — so
 * the row's scalar fields are matched too.
 */
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

/**
 * Adds a condition to a hand-written query, keeping its WHERE and ORDER BY.
 * Keywords are found outside string literals and quoted names only, so a value
 * like 'a ORDER BY b' is never mistaken for a clause. Returns null for any
 * shape this cannot edit safely (aggregates, joins, limits, sub-queries).
 */
export function addToSqlWhere(sql: string, clause: string): string | null {
  const text = sql.trim();
  // Uppercase copy with every quoted span blanked, so keyword search skips them.
  let masked = "";
  let quote: string | null = null;
  // By UTF-16 index, so `masked` and `text` stay index-aligned for slicing.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      masked += " ";
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      masked += " ";
    } else {
      masked += ch.toUpperCase();
    }
  }
  if (quote) return null;
  if (
    !/^SELECT\s/.test(masked) ||
    /\b(GROUP\s+BY|LIMIT|UNION|JOIN|HAVING)\b|\(\s*SELECT\b/.test(masked)
  ) {
    return null;
  }
  const from = masked.search(/\sFROM\s/);
  if (from === -1) return null;
  const orderAt = masked.search(/\sORDER\s+BY\s/);
  const whereAt = masked.search(/\sWHERE\s/);
  const end = orderAt === -1 ? text.length : orderAt;
  const tail = text.slice(end);
  if (whereAt === -1 || whereAt > end) {
    return `${text.slice(0, end)} WHERE ${clause}${tail}`;
  }
  const where = text.slice(whereAt + " WHERE ".length, end).trim();
  return `${text.slice(0, whereAt)} WHERE (${where}) AND ${clause}${tail}`;
}
