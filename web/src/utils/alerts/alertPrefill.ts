// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Shared machinery behind "create an alert from what I'm looking at".
 *
 * Everything here is PURE — no store, no router, no Vue. Source adapters
 * (utils/alerts/prefill/*) build an AlertPrefill from a plain snapshot of their
 * surface, and `normalizePrefill` is the single place the contract's invariants
 * are enforced, so a misbehaving adapter fails in CI rather than in the form.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";

/**
 * Upper bound on the rolling window we will hand the alert form. A user looking
 * at 30 days of logs does not want a 43 200-minute evaluation window — that is
 * a query the scheduler would run every frequency tick over a month of data.
 * Clamped, and the user is told (warning `periodClamped`).
 */
export const MAX_PERIOD_MINUTES = 1440;
export const MIN_PERIOD_MINUTES = 1;

/** Microseconds per minute — logs/dashboard timestamps are µs. */
const MICROS_PER_MINUTE = 60_000_000;

/**
 * Markers that prove a query is still in *source* syntax rather than the
 * resolved SQL the backend would run. Invariant 1 — an adapter that leaks one of
 * these produces an alert that silently never matches.
 */
const UNRESOLVED_QUERY_MARKERS = [
  "[WHERE_CLAUSE]",
  "[INDEX_NAME]",
  "[FIELD_LIST]",
  "[QUERY_FUNCTIONS]",
];

export const clampPeriodMinutes = (minutes: number): number =>
  Math.min(MAX_PERIOD_MINUTES, Math.max(MIN_PERIOD_MINUTES, Math.round(minutes)));

export const warn = (
  key: string,
  level: AlertPrefillWarning["level"] = "warning",
  params?: Record<string, string | number>,
): AlertPrefillWarning => ({ key, level, ...(params ? { params } : {}) });

/**
 * Relative-period suffixes as the time picker emits them ("15m", "2h", "7d").
 */
const RELATIVE_UNIT_MINUTES: Record<string, number> = {
  s: 1 / 60,
  m: 1,
  h: 60,
  d: 60 * 24,
  w: 60 * 24 * 7,
  M: 60 * 24 * 30,
};

export interface PrefillTimeRange {
  type: "relative" | "absolute";
  /** e.g. "15m" — only meaningful when type is "relative". */
  relativeTimePeriod?: string;
  /** Microseconds. */
  startTime?: number;
  /** Microseconds. */
  endTime?: number;
}

export interface PeriodFromRangeResult {
  minutes: number;
  warnings: AlertPrefillWarning[];
}

/**
 * Convert a surface's time range into the alert's rolling window.
 *
 * An absolute range has no equivalent in alerting — an alert always evaluates
 * "the last N minutes" — so we convert its *duration* and say so out loud rather
 * than pretending the user's fixed window survived.
 */
export const periodMinutesFromRange = (
  range: PrefillTimeRange | null | undefined,
): PeriodFromRangeResult => {
  const warnings: AlertPrefillWarning[] = [];
  const DEFAULT_MINUTES = 15;

  if (!range) return { minutes: DEFAULT_MINUTES, warnings };

  let raw = DEFAULT_MINUTES;

  if (range.type === "relative" && range.relativeTimePeriod) {
    const match = /^(\d+)\s*([smhdwM])$/.exec(range.relativeTimePeriod.trim());
    if (match) {
      raw = Number(match[1]) * RELATIVE_UNIT_MINUTES[match[2]];
    }
  } else if (range.startTime && range.endTime && range.endTime > range.startTime) {
    raw = (range.endTime - range.startTime) / MICROS_PER_MINUTE;
    warnings.push(warn("absoluteToRolling", "warning", { minutes: clampPeriodMinutes(raw) }));
  }

  const minutes = clampPeriodMinutes(raw);
  if (Math.round(raw) > MAX_PERIOD_MINUTES) {
    warnings.push(warn("periodClamped", "warning", { minutes }));
  }

  return { minutes, warnings };
};

export interface StripResult {
  sql: string;
  warnings: AlertPrefillWarning[];
}

/**
 * Find the index of `keyword` at nesting depth 0, scanning from the right and
 * ignoring anything inside parentheses or string literals. This is what makes
 * the strip safe for subqueries: `… WHERE id IN (SELECT id FROM t LIMIT 10)`
 * keeps its inner LIMIT, because that one is at depth 1.
 */
const findTopLevelKeyword = (sql: string, keyword: string): number => {
  const upper = sql.toUpperCase();
  const target = keyword.toUpperCase();
  let depth = 0;
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      if (ch === quote && sql[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && upper.startsWith(target, i)) {
      const before = i === 0 ? " " : sql[i - 1];
      const after = sql[i + target.length] ?? " ";
      // Keyword must stand alone — avoids matching "LIMIT" inside "RATE_LIMITED".
      if (/[\s(),]/.test(before) && /[\s(,;]|$/.test(after)) return i;
    }
  }

  return -1;
};

/**
 * Remove trailing `LIMIT` / `ORDER BY` from a query destined for an alert.
 *
 * Both are display concerns that actively break evaluation: LIMIT caps the row
 * count, so a "fire when more than 500 rows match" threshold can never be
 * reached; ORDER BY costs sort time for output nobody reads. Each removal emits
 * a warning — invariant 4, never silently rewrite the user's query.
 */
export const stripDisplayOnlyClauses = (sqlInput: string): StripResult => {
  const warnings: AlertPrefillWarning[] = [];
  let sql = sqlInput.trim().replace(/;\s*$/, "");

  const limitAt = findTopLevelKeyword(sql, "LIMIT");
  if (limitAt >= 0) {
    sql = sql.slice(0, limitAt).trim();
    warnings.push(warn("limitStripped"));
  }

  const orderAt = findTopLevelKeyword(sql, "ORDER BY");
  if (orderAt >= 0) {
    sql = sql.slice(0, orderAt).trim();
    warnings.push(warn("orderByStripped"));
  }

  return { sql, warnings };
};

/**
 * Detect the histogram time-bucketing the logs/dashboard charts add. An alert
 * evaluates one window, so per-bucket rows are meaningless — the caller decides
 * whether to block or route the user to the panel flow instead.
 */
export const hasHistogramBucketing = (sql: string): boolean => /\bhistogram\s*\(/i.test(sql);

/**
 * Pull the alias of the first aggregate in a SELECT, so a `GROUP BY` query can
 * pre-seed the alert's `having.column`.
 *
 * Lifted out of composables/dashboard/usePanelActions.ts so every adapter gets
 * it rather than the dashboards being the only surface that knows the trick.
 */
export const firstAggregateAlias = (sql: string): string | null => {
  const match =
    /(?:count|sum|avg|min|max|median|approx_percentile_cont)\s*\([^)]*\)\s+as\s+["'`]?([^"'`,\s)]+)["'`]?/i.exec(
      sql,
    );
  return match?.[1] ?? null;
};

/**
 * Turn arbitrary source text (a panel title, a stream name, a pattern) into
 * something usable as an alert name fragment.
 */
export const sanitizeAlertNamePart = (input: string | undefined, fallback = "source"): string => {
  if (!input || !input.trim()) return fallback;
  const sanitized = input
    .replace(/[:#?&%'"\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 200)
    .replace(/_+$/, "");
  return sanitized || fallback;
};

const LEVEL_SEVERITY: Record<AlertPrefillWarning["level"], number> = {
  info: 0,
  warning: 1,
  blocking: 2,
};

/**
 * Deduped by key+params so two adapters agreeing don't say it twice — keeping
 * the MOST SEVERE level of the duplicates. Keeping the first instead would let
 * an earlier advisory mask a later block: the same key legitimately arrives at
 * two severities (e.g. "some patterns were unusable" vs "all of them were"),
 * and silently downgrading it would send the user to a form that cannot work.
 */
const dedupeWarnings = (warnings: AlertPrefillWarning[]): AlertPrefillWarning[] => {
  const byId = new Map<string, AlertPrefillWarning>();

  for (const w of warnings) {
    const id = `${w.key}:${JSON.stringify(w.params ?? {})}`;
    const existing = byId.get(id);
    if (!existing || LEVEL_SEVERITY[w.level] > LEVEL_SEVERITY[existing.level]) {
      byId.set(id, w);
    }
  }

  return [...byId.values()];
};

/**
 * The single enforcement point for the contract's invariants. Every launcher
 * call and every conformance test goes through this, so an adapter cannot ship
 * a prefill that the form would choke on.
 */
export const normalizePrefill = (input: AlertPrefill): AlertPrefill => {
  const warnings = [...(input.warnings ?? [])];

  const sql = input.sql?.trim() || undefined;
  const promql = input.promql?.trim() || undefined;

  // Invariant 1 — resolved query, not source syntax.
  if (sql && UNRESOLVED_QUERY_MARKERS.some((marker) => sql.includes(marker))) {
    warnings.push(warn("unresolvedQuery", "blocking"));
  }

  // Invariant 2 — exactly one stream, or a set of candidates for the dialog.
  const candidates = input.streamCandidates?.length ? input.streamCandidates : undefined;
  let streamName = input.streamName?.trim() ?? "";
  if (!streamName && candidates?.length) {
    streamName = candidates[0].name;
  }
  if (!streamName) {
    warnings.push(warn("noStream", "blocking"));
  }

  // A query type with no query behind it cannot produce an alert.
  if (input.queryType === "sql" && !sql) warnings.push(warn("emptyQuery", "blocking"));
  if (input.queryType === "promql" && !promql) warnings.push(warn("emptyQuery", "blocking"));

  // Invariant 3 — minutes, clamped.
  const periodMinutes =
    input.periodMinutes === undefined ? undefined : clampPeriodMinutes(input.periodMinutes);

  return {
    ...input,
    version: ALERT_PREFILL_VERSION,
    streamName,
    streamCandidates: candidates,
    sql,
    promql,
    periodMinutes,
    frequencyMinutes:
      input.frequencyMinutes === undefined
        ? undefined
        : Math.max(1, Math.round(input.frequencyMinutes)),
    // Same floors the alert form's own schema enforces (threshold >= 1,
    // silence >= 0) — a prefill must not hand the form a value it would then
    // refuse to save. `silence: 0` is legitimate ("notify every time"), so
    // this floors rather than truthy-checks.
    triggerThreshold:
      input.triggerThreshold === undefined
        ? undefined
        : Math.max(1, Math.round(input.triggerThreshold)),
    silenceMinutes:
      input.silenceMinutes === undefined
        ? undefined
        : Math.max(0, Math.round(input.silenceMinutes)),
    warnings: dedupeWarnings(warnings),
  };
};

/** True when the prefill cannot be taken to the form. */
export const isPrefillBlocked = (prefill: AlertPrefill): boolean =>
  prefill.warnings.some((w) => w.level === "blocking");

/**
 * Whether the confirm dialog is worth the extra click.
 *
 * The default is NO: for the common case — one stream, nothing lossy, no
 * choices — the dialog is a speed bump between the user and the form, and every
 * surface pays for it. It earns its click only when there is a decision the
 * user alone can make, or a reason they cannot proceed:
 *
 *   • patterns to fold in — include/exclude is a genuine choice (and pointless
 *     when the page found no patterns, so an empty set skips it too);
 *   • more than one stream — alerts are single-stream, and silently taking the
 *     first is exactly the trap this whole flow exists to avoid;
 *   • a blocking warning — the user needs to be told why, not dropped into a
 *     form that cannot work.
 *
 * Non-blocking warnings do NOT justify a dialog: they ride along and are shown
 * as a banner on the form itself.
 */
export const needsConfirmation = (prefill: AlertPrefill): boolean => {
  if (isPrefillBlocked(prefill)) return true;
  if ((prefill.streamCandidates?.length ?? 0) > 1) return true;

  const patterns = prefill.patternFilter;
  return !!patterns && patterns.visibleCount > 0;
};
