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

import { queryErrorCodeFromText } from "@/utils/query/sqlDiagnostics";
import {
  MATCH_ALL_FALLBACK_FIELD,
  matchAllToStrMatch,
  missingStreamAfterFrom,
  sqlJoinKeyword,
  strayKeywordBeforeWhere,
} from "@/utils/traces/tracesSql";

export const ONE_HOUR_US = 3_600_000_000;

/** The one fix a SQL-mode error card offers. */
export type TracesSqlErrorFix =
  | { kind: "suggestion"; field: string; suggestion: string }
  | { kind: "lastHour" }
  | { kind: "missingStream" }
  | { kind: "strMatch"; sql: string; call: string };

/** An editor check on typed SQL, located by character offsets. */
export interface TracesSqlGuard {
  kind: "strayKeyword" | "joinLongRange";
  word: string;
  start: number;
  end: number;
}

const UNKNOWN_FIELD_PATTERNS = [
  /No field named (?:"([^"]+)"|([\w.]+?))\.(?:\s|$)/,
  /unknown field '([^']+)'/,
];
const OUT_OF_MEMORY = /resources exhausted|out of memory|failed to allocate/i;
const MISSING_STREAM = /stream not found:\s*where(?!\w)/i;
const MATCH_ALL_NO_FTS =
  /match_all\(\) should only apply to the stream that have full text search fields/i;

/** App error code; the search stream sends an HTTP status, so the message names the code then. */
export function sqlErrorCode(code: unknown, text: string): number {
  const numeric = Number(code) || 0;
  if (numeric >= 10000) return numeric;
  return queryErrorCodeFromText(text) ?? 0;
}

/** The column the server could not find, without a table qualifier. */
export function unknownFieldName(text: string): string | null {
  for (const pattern of UNKNOWN_FIELD_PATTERNS) {
    const match = pattern.exec(text);
    const name = match?.[1] ?? match?.[2];
    if (name) return name.split(".").pop() ?? name;
  }
  return null;
}

/** The nearest stream field to a typo, by edit distance, skipping system fields. */
export function closestField(name: string, fields: string[]): string | null {
  const target = name.toLowerCase();
  const threshold = Math.max(2, Math.floor(target.length / 3));
  let best: { field: string; dist: number } | null = null;
  for (const field of fields) {
    if (field.startsWith("_") || field.toLowerCase() === target) continue;
    const dist = editDistance(target, field.toLowerCase());
    if (dist > threshold) continue;
    if (!best || dist < best.dist || (dist === best.dist && field.length < best.field.length)) {
      best = { field, dist };
    }
  }
  return best?.field ?? null;
}

/** The fix card for a SQL-mode search error, or null when the server message is all there is. */
export function tracesSqlErrorFix(input: {
  code: unknown;
  text: string;
  suggestions: string[];
  fields: string[];
  rangeUs: number;
  /** The SQL that failed, for errors only the query text explains. */
  query?: string;
}): TracesSqlErrorFix | null {
  const code = sqlErrorCode(input.code, input.text);
  const query = input.query ?? "";
  if ((code === 20001 || code === 20002) && missingStreamAfterFrom(query)) {
    return { kind: "missingStream" };
  }
  if (code === 20001 && MATCH_ALL_NO_FTS.test(input.text)) {
    const rewrite = matchAllToStrMatch(query, MATCH_ALL_FALLBACK_FIELD);
    return rewrite ? { kind: "strMatch", ...rewrite } : null;
  }
  if (code === 20002) return MISSING_STREAM.test(input.text) ? { kind: "missingStream" } : null;
  if (code === 20004) {
    const field = unknownFieldName(input.text);
    const suggestion = input.suggestions[0] ?? (field ? closestField(field, input.fields) : null);
    return field && suggestion ? { kind: "suggestion", field, suggestion } : null;
  }
  if (code === 20008 && OUT_OF_MEMORY.test(input.text) && input.rangeUs > ONE_HOUR_US) {
    return { kind: "lastHour" };
  }
  return null;
}

/** Editor checks for SQL the server would run in a surprising way; rangeUs is the picked time range. */
export function tracesSqlGuards(sql: string, rangeUs: number): TracesSqlGuard[] {
  const guards: TracesSqlGuard[] = [];
  const stray = strayKeywordBeforeWhere(sql);
  if (stray) guards.push({ kind: "strayKeyword", ...stray });
  const join = sqlJoinKeyword(sql);
  if (join && rangeUs > ONE_HOUR_US) {
    guards.push({ kind: "joinLongRange", word: sql.slice(join.start, join.end), ...join });
  }
  return guards;
}

export function offsetRange(
  text: string,
  start: number,
  end: number,
): { startLine: number; endLine: number; column: number; endColumn: number } {
  const at = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return { line: before.length, column: before[before.length - 1].length + 1 };
  };
  const from = at(start);
  const to = at(end);
  return { startLine: from.line, endLine: to.line, column: from.column, endColumn: to.column };
}

export function allNullColumns(hits: Record<string, unknown>[], keys: string[]): string[] {
  if (hits.length === 0) return [];
  return keys.filter((key) => hits.every((hit) => hit?.[key] === null || hit?.[key] === undefined));
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}
