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

import type { QueryRef, RouteTarget } from "@/composables/assistant/pure";
import { b64EncodeUnicode } from "@/utils/formatters";

export type Explorer = "logs" | "metrics" | "traces";

/** The route names the explorer targets use; the navigation allowlist accepts them too. */
export const EXPLORER_ROUTE_NAMES: Record<Explorer, string> = {
  logs: "logs",
  metrics: "metricsEditor",
  traces: "traces",
};

/** Tells an explorer page to apply the params without running them. */
export const AI_CHAT_QUERY = "ai_chat_query";

// An unknown range still opens on a window, never on the page's auto-run default.
const FALLBACK_PERIOD = "15m";

const STREAM_TYPES: ReadonlySet<string> = new Set(["logs", "metrics", "traces"]);

const CLAUSE_END = /^(group\s+by|order\s+by|limit|having)\b/i;

const FROM_STREAM = /\bfrom\s+["'`]?([^"'`\s,()]+)["'`]?/i;

/** The stream type a URL or the search API may carry; anything else is dropped. */
export function streamTypeOf(value: unknown): Explorer | undefined {
  return typeof value === "string" && STREAM_TYPES.has(value) ? (value as Explorer) : undefined;
}

/** The stream a statement reads from, so a step without a stream argument is still named by it. */
export function sqlStreamOf(sql: unknown): string | undefined {
  return typeof sql === "string" ? FROM_STREAM.exec(sql)?.[1] : undefined;
}

/** PromQL and metrics streams open in Metrics, traces streams in Traces, the rest in Logs. */
export function explorerOf(query: Pick<QueryRef, "language" | "streamType">): Explorer {
  if (query.language === "promql" || query.streamType === "metrics") return "metrics";
  if (query.streamType === "traces") return "traces";
  return "logs";
}

/** A query's route in its explorer; the nonce `t` makes a second link re-apply on the same page. */
export function explorerTarget(query: QueryRef, explorer: Explorer, nonce: string): RouteTarget {
  const base: Record<string, string> = { org_identifier: query.org, type: AI_CHAT_QUERY, t: nonce };
  if (explorer === "metrics")
    return { name: EXPLORER_ROUTE_NAMES.metrics, query: metrics(query, base) };
  if (explorer === "traces")
    return { name: EXPLORER_ROUTE_NAMES.traces, query: traces(query, base) };
  return { name: EXPLORER_ROUTE_NAMES.logs, query: logs(query, base) };
}

/** A search time in epoch ms; the wire sends microseconds, which no millisecond value reaches. */
export function epochMs(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? Math.round(n / 1000) : n;
}

/** The top-level WHERE clause of a statement, or null when quotes, comments or parentheses do not balance or a UNION joins it. */
export function whereClauseOf(sql: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < sql.length; i++) {
    const skipped = skipSpan(sql, i);
    if (skipped === null) return null;
    if (skipped > i) {
      i = skipped - 1;
      continue;
    }
    const char = sql[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && /[\s)]/.test(sql[i - 1] ?? " ")) {
      const rest = sql.slice(i);
      if (/^union\b/i.test(rest)) return null;
      if (start < 0 && /^where\b/i.test(rest)) start = i + 5;
      else if (start >= 0 && CLAUSE_END.test(rest))
        return clean(withoutComments(sql.slice(start, i)));
    }
  }
  if (depth !== 0 || start < 0) return null;
  return clean(withoutComments(sql.slice(start)));
}

function logs(query: QueryRef, base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    ...base,
    stream_type: streamTypeOf(query.streamType) ?? "logs",
    sql_mode: "true",
    quick_mode: "false",
    show_histogram: "true",
    refresh: "0",
    fn_editor: "false",
  };
  if (query.stream) out.stream = query.stream;
  const encoded = b64EncodeUnicode(query.text);
  if (encoded) out.query = encoded;
  return { ...out, ...microRange(query) };
}

function traces(query: QueryRef, base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (query.stream) out.stream = query.stream;
  // The Traces editor holds a filter, not a statement, so only the WHERE clause carries over.
  const filter = whereClauseOf(query.text);
  const encoded = filter ? b64EncodeUnicode(filter) : null;
  if (encoded) out.query = encoded;
  return { ...out, ...microRange(query) };
}

function metrics(query: QueryRef, base: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    ...base,
    query_type: query.language === "promql" ? "promql" : "sql",
  };
  if (query.stream) out.stream_name = query.stream;
  const encoded = b64EncodeUnicode(query.text);
  if (encoded) out.query = encoded;
  // The Metrics page reads its URL range in milliseconds.
  if (query.from && query.to) return { ...out, from: String(query.from), to: String(query.to) };
  return { ...out, period: FALLBACK_PERIOD };
}

function microRange(query: QueryRef): Record<string, string> {
  if (!query.from || !query.to) return { period: FALLBACK_PERIOD };
  return { from: String(query.from * 1000), to: String(query.to * 1000) };
}

function clean(clause: string): string | null {
  const text = clause.trim().replace(/;$/, "").trim();
  return text || null;
}

// Traces wraps the filter in its own SQL, so a kept `--` would swallow what follows; literals stay as written.
function withoutComments(clause: string): string {
  let out = "";
  let code = "";
  for (let i = 0; i < clause.length;) {
    const end = skipSpan(clause, i) ?? clause.length;
    if (end === i) code += clause[i++];
    else if (clause[i] === "'" || clause[i] === '"') {
      out += code.replace(/\s+/g, " ") + clause.slice(i, end);
      code = "";
      i = end;
    } else {
      code += " ";
      i = end;
    }
  }
  return out + code.replace(/\s+/g, " ");
}

// Where a quoted literal or a comment starting at `i` ends (`i` when none starts there), or null when it never ends.
function skipSpan(sql: string, i: number): number | null {
  const char = sql[i];
  if (char === "'" || char === '"') {
    for (let j = i + 1; j < sql.length; j++) {
      if (sql[j] !== char) continue;
      if (sql[j + 1] === char) j++;
      else return j + 1;
    }
    return null;
  }
  if (sql.startsWith("--", i)) {
    const eol = sql.indexOf("\n", i);
    return eol < 0 ? sql.length : eol + 1;
  }
  if (sql.startsWith("/*", i)) {
    const close = sql.indexOf("*/", i + 2);
    return close < 0 ? null : close + 2;
  }
  return i;
}
