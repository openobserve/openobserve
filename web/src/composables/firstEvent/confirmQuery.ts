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
const HOUR_MS = 60 * 60 * 1000;
const QUARTER_HOUR_US = 15 * 60 * 1_000_000;

/** The server defaults (ZO_INGEST_ALLOWED_UPTO, ZO_INGEST_ALLOWED_IN_FUTURE) for a /config that predates the fields. */
export const DEFAULT_INGEST_ALLOWED_UPTO_H = 5;
export const DEFAULT_INGEST_ALLOWED_IN_FUTURE_H = 24;

const SQL_WORDS = new Set([
  "and",
  "or",
  "not",
  "is",
  "null",
  "in",
  "like",
  "ilike",
  "between",
  "true",
  "false",
  "match_all",
  "str_match",
  "re_match",
]);

export interface IngestWindowConfig {
  ingestAllowedUptoH: number;
  ingestAllowedInFutureH: number;
  maxQueryRangeH: number;
}

export interface TimeWindowUs {
  startUs: number;
  endUs: number;
}

/** The span the ingester accepts on both sides, plus an hour of clock skew, so a back-dated or future-stamped first batch still confirms. */
export function ingestWindow(nowMs: number, cfg: IngestWindowConfig): TimeWindowUs {
  let startMs = nowMs - (cfg.ingestAllowedUptoH + 1) * HOUR_MS;
  let endMs = nowMs + (cfg.ingestAllowedInFutureH + 1) * HOUR_MS;
  const maxMs = cfg.maxQueryRangeH * HOUR_MS;
  // the engine narrows an over-wide range by keeping its end, so trim the future first
  if (maxMs > 0 && endMs - startMs > maxMs) {
    endMs = Math.max(nowMs + HOUR_MS, startMs + maxMs);
    if (endMs - startMs > maxMs) startMs = endMs - maxMs;
  }
  return { startUs: startMs * 1000, endUs: endMs * 1000 };
}

/** From the server anchor to the browser-elapsed time since it, plus an hour of skew. */
export function sinceWindow(zoNowUs: number, elapsedMs: number): TimeWindowUs {
  return { startUs: zoNowUs, endUs: zoNowUs + (elapsedMs + HOUR_MS) * 1000 };
}

/** Thirty minutes around a record, the range Open in Logs, Metrics and Traces receive. */
export function recordRange(tsUs: number): TimeWindowUs {
  return { startUs: tsUs - QUARTER_HOUR_US, endUs: tsUs + QUARTER_HOUR_US };
}

export function quoteStream(stream: string): string {
  return `"${stream.replaceAll('"', '""')}"`;
}

const whereClause = (filter?: string, sinceUs?: number): string => {
  const parts: string[] = [];
  if (filter?.trim()) parts.push(`(${filter.trim()})`);
  if (sinceUs !== undefined) parts.push(`_timestamp >= ${Math.trunc(sinceUs)}`);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
};

export function confirmSql(stream: string, filter?: string, sinceUs?: number): string {
  return `SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM ${quoteStream(stream)}${whereClause(filter, sinceUs)}`;
}

/** Returns a row even over an empty window, so zo_now is always the server clock. */
export function anchorSql(stream: string): string {
  return `SELECT COUNT(*) AS zo_count, CAST(to_unixtime(now()) AS BIGINT) AS zo_now FROM ${quoteStream(stream)}`;
}

export function firstRecordSql(stream: string, fromUs: number, filter?: string): string {
  return `SELECT * FROM ${quoteStream(stream)}${whereClause(filter, fromUs)} ORDER BY _timestamp ASC LIMIT 1`;
}

/** The column names an authored WHERE fragment reads, so the bar can check them against the schema first. */
export function filterFields(filter?: string): string[] {
  if (!filter?.trim()) return [];
  const withoutLiterals = filter.replace(/'(?:[^']|'')*'/g, " ").replace(/\b\d+(\.\d+)?\b/g, " ");
  const fields = new Set<string>();
  for (const m of withoutLiterals.matchAll(/"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = m[1] ?? m[2];
    if (m[2] && SQL_WORDS.has(name.toLowerCase())) continue;
    fields.add(name);
  }
  return [...fields];
}

/** Logs and Traces read from/to in microseconds; the Metrics explorer's picker reads milliseconds. */
export function rangeRoute(
  org: string,
  streamType: string,
  stream: string,
  range?: TimeWindowUs,
): { name: string; query: Record<string, string> } {
  const time: Record<string, string> = {};
  if (range && streamType === "metrics") {
    time.from = String(Math.trunc(range.startUs / 1000));
    time.to = String(Math.trunc(range.endUs / 1000));
  } else if (range) {
    time.from = String(range.startUs);
    time.to = String(range.endUs);
  }
  if (streamType === "metrics") {
    return { name: "metrics", query: { org_identifier: org, metric: stream, ...time } };
  }
  if (streamType === "traces") {
    return { name: "traces", query: { org_identifier: org, stream, ...time } };
  }
  return { name: "logs", query: { org_identifier: org, stream, stream_type: "logs", ...time } };
}
