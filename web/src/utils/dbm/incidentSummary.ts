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

/**
 * The copyable incident summary — `dbm-user-insights.md` §4, minute 12–15.
 *
 * The research finding this closes is specific: the benchmark failure is "30
 * minutes elapse with nothing to report", and every number needed for the
 * report is already on screen by minute 12. Nothing composes the sentence, so
 * the responder retypes numbers into Slack and makes transcription errors at
 * 2am. This builds the message instead.
 *
 * Three rules, all of which are about not laundering uncertainty:
 *   • Coverage caveats are part of the summary, not an appendix. A pasted p95
 *     with estimated percentiles behind it must say so, because the message
 *     outlives the page it came from and nobody will re-derive the caveat.
 *   • A missing number is omitted, never rendered as 0 or "—". A summary is
 *     quoted in an incident review weeks later; an invented zero becomes
 *     evidence.
 *   • The window is stated absolutely (ISO), not as "last 60m". "Last hour"
 *     pasted into a channel is unreadable an hour later.
 *
 * Output is markdown because every destination the responder will paste into
 * (Slack, GitHub, Jira, an incident doc) renders it, and it degrades to legible
 * plain text where it does not.
 */

import type { EndpointRow, Freshness, QueryStatsRow } from "@/services/db_monitoring";
import type { DbmDelta } from "@/utils/dbm/insights";
import {
  formatCount,
  formatNs,
  formatPercent,
  formatSignedPercent,
  oneLine,
} from "@/utils/dbm/format";

export interface IncidentSummaryInput {
  row: QueryStatsRow;
  /** Window the numbers describe, microseconds. */
  window: { startTime: number; endTime: number };
  /** Δ of `total_time_ns` vs the previous same-length window. */
  totalTimeDelta?: DbmDelta;
  /** Δ of `p95_ns` vs the previous same-length window. */
  p95Delta?: DbmDelta;
  /** Δ of `calls` vs the previous same-length window. */
  callsDelta?: DbmDelta;
  /** Share of the scope's total database time, `0`–`1`. */
  share?: number;
  /** Top calling endpoints, already ranked. Capped at `MAX_ENDPOINTS`. */
  endpoints?: EndpointRow[];
  /** Per-status-code error counts for this fingerprint. */
  errorClasses?: { status_code: string; errors?: number }[];
  freshness?: Freshness | null;
  /** The response's `top_n_subset` marker — shares do not reconcile when set. */
  topNSubset?: boolean;
  /** `_other` share of scope time, `0`–`1`, when one was computed. */
  otherShare?: number;
  /** A permalink with the window frozen. */
  permalink?: string;
}

/** Beyond this the message stops being skimmable in a chat client. */
const MAX_ENDPOINTS = 3;
const MAX_ERROR_CLASSES = 3;
/** The pasted statement is an identifier, not the payload — keep it quotable. */
const MAX_QUERY_CHARS = 200;

const isoOf = (micros: number): string => new Date(Math.floor(micros / 1000)).toISOString();

/**
 * Render a delta as ` (+42% vs previous window)`, or the arrival/departure
 * states as words. `new` must never print as +100%: "first seen in this window"
 * and "rose by 100%" are different claims, and only one of them is true.
 */
const deltaSuffix = (delta: DbmDelta | undefined): string => {
  if (!delta) return "";
  if (delta.state === "new") return " (first seen in this window)";
  if (delta.state === "gone") return " (absent this window)";
  if (delta.ratio === undefined) return "";
  return ` (${formatSignedPercent(delta.ratio)} vs previous window)`;
};

/** A metric line, or nothing at all when the metric was never emitted. */
const metricLine = (
  label: string,
  value: number | undefined,
  format: (value: number) => string,
  delta?: DbmDelta,
): string | null => {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return `- **${label}:** ${format(value)}${deltaSuffix(delta)}`;
};

/**
 * The coverage caveats that apply to THESE numbers.
 *
 * Only fires the ones that are true for this response, for the same reason the
 * §4.3 panel splits computed from structural: a summary carrying five standing
 * warnings gets its warnings skipped, so the ones that survive must be earned.
 */
const coverageNotes = (input: IncidentSummaryInput): string[] => {
  const notes: string[] = [];
  const freshness = input.freshness;

  if (input.topNSubset) {
    notes.push("Scope is a subset — shares do not reconcile to database totals.");
  } else if (input.otherShare !== undefined && input.otherShare > 0) {
    notes.push(
      `${formatPercent(input.otherShare)} of database time is in queries below the top-N cut.`,
    );
  }

  if (freshness) {
    // The genuine uncovered range: the rollup stalled past the tail cap, so
    // neither source covers the gap between them.
    if (freshness.tail_covers_from !== null && freshness.data_through > 0) {
      if (freshness.tail_covers_from > freshness.data_through) {
        notes.push("Coverage gap — the rollup stalled beyond the live-tail window.");
      }
    }
    if (freshness.data_through === 0) {
      notes.push("Not aggregated yet — numbers come from the live tail only.");
    }
    if (freshness.tail_truncated) notes.push("Live tail hit its row cap, so it is partial.");
    if (freshness.percentiles_estimated) {
      notes.push("Percentiles are fused across windows — estimates, not true quantiles.");
    }
    if (freshness.traces_upper_bound) notes.push("Trace counts are an upper bound.");
  }

  notes.push(
    "Only completed, instrumented client calls are counted — a query blocked on a lock right now is not here.",
  );
  return notes;
};

/**
 * Compose the summary. Pure and synchronous so it is unit-testable and so the
 * button cannot fail halfway through a clipboard write.
 */
export const buildIncidentSummary = (input: IncidentSummaryInput): string => {
  const { row, window } = input;
  const lines: string[] = [];

  const queryText = oneLine(row.query_norm) || row.fingerprint;
  const truncated = queryText.length > MAX_QUERY_CHARS;
  const shownQuery = truncated ? `${queryText.slice(0, MAX_QUERY_CHARS)}…` : queryText;

  lines.push(`**Database query — ${row.db_system} on ${row.db_instance}**`);
  lines.push("");
  lines.push("```sql");
  lines.push(shownQuery);
  lines.push("```");
  if (truncated || row.truncated) {
    lines.push("");
    lines.push("_Statement shortened — open the query in Database Monitoring for the full text._");
  }
  lines.push("");

  // Scope: only the dimensions that were actually resolved.
  const scope: string[] = [`fingerprint \`${row.fingerprint}\``];
  if (row.db_namespace) scope.push(`database \`${row.db_namespace}\``);
  if (row.env) scope.push(`env \`${row.env}\``);
  lines.push(`**Scope:** ${scope.join(" · ")}`);
  lines.push(`**Window:** ${isoOf(window.startTime)} → ${isoOf(window.endTime)}`);
  lines.push("");

  const metrics = [
    metricLine("p95", row.p95_ns, formatNs, input.p95Delta),
    metricLine("p99", row.p99_ns, formatNs),
    metricLine("Max", row.max_ns, formatNs),
    metricLine("Calls", row.calls, formatCount, input.callsDelta),
    metricLine("Errors", row.errors, formatCount),
    metricLine("Total time", row.total_time_ns, formatNs, input.totalTimeDelta),
  ].filter((line): line is string => line !== null);

  if (input.share !== undefined && Number.isFinite(input.share)) {
    metrics.push(`- **Share of database time:** ${formatPercent(input.share)}`);
  }
  if (metrics.length) {
    lines.push(...metrics);
    lines.push("");
  }

  const endpoints = (input.endpoints ?? []).slice(0, MAX_ENDPOINTS);
  if (endpoints.length) {
    lines.push("**Top calling endpoints**");
    for (const endpoint of endpoints) {
      // A null service/endpoint is a real result: the DB span's trace root was
      // outside the window or missing, so the caller is genuinely unattributed.
      const caller = endpoint.service_name ?? "unattributed";
      const path = endpoint.endpoint ? ` ${endpoint.endpoint}` : "";
      lines.push(`- ${caller}${path} — ${formatCount(endpoint.calls)} calls`);
    }
    lines.push("");
  }

  const errorClasses = (input.errorClasses ?? [])
    .filter((entry) => (entry.errors ?? 0) > 0)
    .slice(0, MAX_ERROR_CLASSES);
  if (errorClasses.length) {
    lines.push("**Error codes**");
    for (const entry of errorClasses) {
      lines.push(`- \`${entry.status_code}\` — ${formatCount(entry.errors)}`);
    }
    lines.push("");
  }

  lines.push("**What this does not show**");
  for (const note of coverageNotes(input)) lines.push(`- ${note}`);

  if (input.permalink) {
    lines.push("");
    lines.push(`[Open in Database Monitoring](${input.permalink})`);
  }

  return lines.join("\n");
};
