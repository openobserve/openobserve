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

// Links between a trace and its profiles: the padded request window for a trace-filtered
// page, and the "Top traces" query (profile -> trace).

import type { ProfileFilter } from "@/services/profiles";
import { quoteSqlIdentifier, quoteSqlLiteral } from "@/utils/telemetryCorrelation";

export interface TimeRange {
  startTime: number;
  endTime: number;
}

/**
 * Assumes the profiler's 60 s upload window (the agent stamps a profile at the start of the window):
 * a sample for a span that ended just inside the chosen range can be stored up to one window later,
 * and one that began just before it up to two windows earlier. A profiler with another window length
 * needs other pads. Microseconds.
 */
export const TRACE_FILTER_PAD_BEFORE_US = 120_000_000;
export const TRACE_FILTER_PAD_AFTER_US = 60_000_000;
/**
 * The pad around a trace's profile timestamps when opening it: 15 minutes, the same inline
 * `900000000` as the Logs "View Trace" action. That action's route builder, `traceDetailsLocation`
 * (an exported function in composables/useLogs/useViewTraceAction.ts), is not reused here for two
 * reasons: it reads a log record and store state (the configured timestamp and trace id field names,
 * the selected organization) and pads one timestamp both ways, where this list has the trace id and
 * the first and last profile timestamps; and that module imports the store, `useStreams` and the
 * license lock, which this plain helper file must not. The pad is not exported as a constant there.
 * Keep the two in step.
 */
export const OPEN_TRACE_PAD_US = 900_000_000;
export const TOP_TRACES_LIMIT = 20;
/** Only these profile types link samples to spans. */
export const TRACE_LINKED_PROFILE_TYPES = ["cpu", "wall"];

export const isTraceLinkedProfileType = (profileType: string | null | undefined): boolean =>
  !!profileType && TRACE_LINKED_PROFILE_TYPES.includes(profileType.toLowerCase());

/** A filter that keeps only named traces (`=` or `in`, the forms a trace link writes). */
export const hasTraceIdFilter = (filters: readonly ProfileFilter[]): boolean =>
  filters.some(
    (filter) =>
      filter.key === "trace_id" &&
      ((filter.op === "=" && !!filter.value) ||
        (filter.op === "in" && (!!filter.values?.length || !!filter.value))),
  );

/**
 * The window to send to the server. Always pass the window the user chose (never a padded one):
 * with a trace_id filter it is widened, otherwise it is returned unchanged. The URL, the share link
 * and the chart keep the chosen window, so a reload does not widen it again.
 */
export const requestRange = (range: TimeRange, filters: readonly ProfileFilter[]): TimeRange =>
  hasTraceIdFilter(filters)
    ? {
        // Never a non-positive start, as in openTraceLocation.
        startTime: Math.max(1, range.startTime - TRACE_FILTER_PAD_BEFORE_US),
        endTime: range.endTime + TRACE_FILTER_PAD_AFTER_US,
      }
    : range;

/**
 * Mirrors `is_safe_filter_key` (src/core/src/profiles/query.rs): 1-128 chars of letters, digits, `_`, `.` and `-`.
 * Reserved profile columns pass this check; the server rejects them (`is_filterable_column`), so a
 * filter on one fails the same way here as for the page's own queries.
 */
export const isSafeFilterKey = (name: string): boolean =>
  name.length > 0 && name.length <= 128 && /^[A-Za-z0-9_.-]+$/.test(name);

/** A dotted resource key is stored as the snake_case column (`normalize_tag_key`). */
const normalizeTagKey = (key: string) => key.replace(/\./g, "_");

export interface TopTracesQuery {
  stream: string;
  profileType: string;
  profileUnit?: string;
  service?: string | null;
  filters: readonly ProfileFilter[];
}

/** The SQL for one filter, as the profiles API builds it (filter_predicate in src/api/search/src/profiles). */
const filterPredicate = (column: string, filter: ProfileFilter): string | null => {
  const value = filter.value ?? "";
  switch (filter.op) {
    case "=":
    case "!=":
      return `${column} ${filter.op} ${quoteSqlLiteral(value)}`;
    case "=~":
    case "!~":
      return `${filter.op === "!~" ? "NOT " : ""}regexp_like(${column}, ${quoteSqlLiteral(value)})`;
    case "in":
    case "not_in": {
      const values = filter.values?.length
        ? filter.values
        : value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
      if (!values.length) return null;
      const list = values.map(quoteSqlLiteral).join(", ");
      return `${column} ${filter.op === "not_in" ? "NOT IN" : "IN"} (${list})`;
    }
    default:
      return null;
  }
};

export const buildTopTracesSql = (query: TopTracesQuery): string => {
  const conditions = [
    `profile_type = ${quoteSqlLiteral(query.profileType)}`,
    ...(query.profileUnit ? [`profile_unit = ${quoteSqlLiteral(query.profileUnit)}`] : []),
    // The rows the merge counts (merge.rs load_stacks and load_full_total), so shares add up to its total.
    `${quoteSqlIdentifier("stack")} IS NOT NULL`,
    "trace_id IS NOT NULL",
    "trace_id != ''",
    ...(query.service ? [`service_name = ${quoteSqlLiteral(query.service)}`] : []),
  ];
  for (const filter of query.filters) {
    if (!isSafeFilterKey(filter.key)) continue;
    const predicate = filterPredicate(quoteSqlIdentifier(normalizeTagKey(filter.key)), filter);
    if (predicate) conditions.push(predicate);
  }
  return (
    `SELECT trace_id, SUM(${quoteSqlIdentifier("value")}) AS total, MIN(_timestamp) AS first_ts, MAX(_timestamp) AS last_ts ` +
    `FROM ${quoteSqlIdentifier(query.stream)} WHERE ${conditions.join(" AND ")} ` +
    `GROUP BY trace_id ORDER BY total DESC LIMIT ${TOP_TRACES_LIMIT}`
  );
};

/**
 * A `_search` answer with `is_partial` or a `function_error` has dropped rows, so its sums under-count.
 * The profiles API refuses such answers (`reject_partial_search_response`, src/api/search/src/profiles);
 * the Top traces list does the same instead of showing them as complete.
 */
export const isIncompleteSearchResponse = (
  data: { is_partial?: unknown; function_error?: unknown } | null | undefined,
): boolean => {
  if (!data) return false;
  const functionError = data.function_error;
  return (
    data.is_partial === true ||
    (Array.isArray(functionError) ? functionError.length > 0 : !!functionError)
  );
};

export interface TopTraceRow {
  traceId: string;
  total: number;
  firstTs: number;
  lastTs: number;
}

export const parseTopTraceRows = (hits: Record<string, unknown>[]): TopTraceRow[] =>
  hits
    .map((hit) => ({
      traceId: String(hit.trace_id ?? ""),
      total: Number(hit.total) || 0,
      firstTs: Number(hit.first_ts) || 0,
      lastTs: Number(hit.last_ts) || 0,
    }))
    .filter((row) => row.traceId);

/** The `traceDetails` route for a trace, as the Logs "View Trace" action builds it, around the trace's profile timestamps (microseconds). */
export const openTraceLocation = (
  org: string,
  tracesStream: string,
  row: Pick<TopTraceRow, "traceId" | "firstTs" | "lastTs">,
) => ({
  name: "traceDetails",
  query: {
    stream: tracesStream,
    trace_id: row.traceId,
    from: Math.max(1, row.firstTs - OPEN_TRACE_PAD_US),
    to: row.lastTs + OPEN_TRACE_PAD_US,
    refresh: 0,
    org_identifier: org,
    reload: "true",
  },
});

/** First 8 characters of a trace id, enough to tell rows apart. */
export const shortTraceId = (traceId: string) =>
  traceId.length > 12 ? `${traceId.slice(0, 8)}…` : traceId;
