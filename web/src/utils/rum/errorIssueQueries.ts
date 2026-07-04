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

import {
  escapeSqlString,
  histogramKeyToMicros,
  issueKey,
} from "@/utils/rum/errorIssueUtils";

/** Max issue rows fetched per run (applied via the search payload size). */
export const ISSUES_LIMIT = 200;
/** Trend sparklines are fetched only for the top N issues by impact. */
export const TREND_TOP_N = 20;
/** Messages longer than this are dropped from the trends IN(...) list. */
export const MAX_TREND_MESSAGE_LEN = 4096;

export interface IssueQueryContext {
  streamName: string;
  timestampColumn: string;
  /** Stream schema presence map — optional fields are guarded through it. */
  schema: Record<string, boolean>;
  /** User-entered WHERE fragment from the query editor ("" when empty). */
  userQuery: string;
  /** Service filter value ("" = all services). */
  service: string;
}

/**
 * Distinct-user counting falls back through identity fields, so orgs
 * without user tracking still get a meaningful "affected" count.
 */
export const pickUserField = (
  schema: Record<string, boolean>,
): string | null => {
  if (schema["usr_id"]) return "usr_id";
  if (schema["usr_email"]) return "usr_email";
  if (schema["session_id"]) return "session_id";
  return null;
};

const serviceClause = (ctx: IssueQueryContext): string =>
  ctx.service ? ` AND service='${escapeSqlString(ctx.service)}'` : "";

const userClause = (ctx: IssueQueryContext): string =>
  ctx.userQuery.trim().length ? ` AND (${ctx.userQuery.trim()})` : "";

const groupFields = (ctx: IssueQueryContext): string[] =>
  ["error_type", "error_message", "error_handling"].filter(
    (field) => ctx.schema[field],
  );

/** `error_stack` may live in either column depending on SDK version. */
const stackSelect = (ctx: IssueQueryContext): string | null => {
  const hasStack = ctx.schema["error_stack"];
  const hasHandlingStack = ctx.schema["error_handling_stack"];
  if (hasStack && hasHandlingStack) {
    return "MIN(CASE WHEN error_stack IS NOT NULL THEN error_stack WHEN error_handling_stack IS NOT NULL THEN error_handling_stack ELSE NULL END) AS error_stack";
  }
  if (hasHandlingStack) {
    return "MIN(CASE WHEN error_handling_stack IS NOT NULL THEN error_handling_stack ELSE NULL END) AS error_stack";
  }
  if (hasStack) {
    return "MIN(CASE WHEN error_stack IS NOT NULL THEN error_stack ELSE NULL END) AS error_stack";
  }
  return null;
};

/**
 * Q1 — one row per issue (error signature) with impact aggregates.
 * `zo_sql_timestamp` (= last seen) and `latest_error_id` aliases preserve
 * the row-click contract with ErrorViewer.
 */
export const buildIssuesSql = (ctx: IssueQueryContext): string => {
  const ts = ctx.timestampColumn;
  const userField = pickUserField(ctx.schema);
  const select = [
    `max(${ts}) AS zo_sql_timestamp`,
    `min(${ts}) AS first_seen`,
    "COUNT(*) AS events",
  ];
  if (userField) select.push(`COUNT(DISTINCT ${userField}) AS users_affected`);
  if (ctx.schema["session_id"]) {
    select.push("COUNT(DISTINCT session_id) AS sessions_affected");
  }
  select.push(...groupFields(ctx));
  if (ctx.schema["error_id"]) {
    select.push(
      `FIRST_VALUE(error_id ORDER BY ${ts} DESC) AS latest_error_id`,
    );
  }
  const stack = stackSelect(ctx);
  if (stack) select.push(stack);
  if (ctx.schema["service"]) select.push("max(service) AS service");
  if (ctx.schema["view_url"]) select.push("max(view_url) AS view_url");
  if (ctx.schema["session_id"]) select.push("max(session_id) AS session_id");

  const orderBy = userField ? "users_affected" : "events";
  return (
    `SELECT ${select.join(", ")} FROM "${ctx.streamName}"` +
    ` WHERE type='error'${userClause(ctx)}${serviceClause(ctx)}` +
    ` GROUP BY ${groupFields(ctx).join(", ")}` +
    ` ORDER BY ${orderBy} DESC`
  );
};

/** Q2 — errors over time, stacked by handled/unhandled. */
export const buildErrorsHistogramSql = (
  ctx: IssueQueryContext,
  interval: string,
): string =>
  `SELECT histogram(${ctx.timestampColumn}, '${interval}') AS ts, error_handling, COUNT(*) AS events` +
  ` FROM "${ctx.streamName}" WHERE type='error'${userClause(ctx)}${serviceClause(ctx)}` +
  ` GROUP BY ts, error_handling ORDER BY ts`;

/** Q3 — per-issue histogram for the top issues' trend sparklines. */
export const buildTrendsSql = (
  ctx: IssueQueryContext,
  interval: string,
  messages: string[],
): string | null => {
  const usable = messages.filter(
    (message) => message.length <= MAX_TREND_MESSAGE_LEN,
  );
  if (!usable.length) return null;
  const inList = usable
    .map((message) => `'${escapeSqlString(message)}'`)
    .join(", ");
  const fields = groupFields(ctx);
  return (
    `SELECT histogram(${ctx.timestampColumn}, '${interval}') AS ts, ${fields.join(", ")}, COUNT(*) AS events` +
    ` FROM "${ctx.streamName}" WHERE type='error'${userClause(ctx)}${serviceClause(ctx)}` +
    ` AND error_message IN (${inList})` +
    ` GROUP BY ts, ${fields.join(", ")} ORDER BY ts`
  );
};

/** Q4a — error-side KPI aggregates (user + service filters apply). */
export const buildErrorKpisSql = (ctx: IssueQueryContext): string => {
  const userField = pickUserField(ctx.schema);
  const select = ["COUNT(*) AS total_errors"];
  if (ctx.schema["session_id"]) {
    select.push("COUNT(DISTINCT session_id) AS error_sessions");
  }
  if (userField) select.push(`COUNT(DISTINCT ${userField}) AS users_affected`);
  return (
    `SELECT ${select.join(", ")} FROM "${ctx.streamName}"` +
    ` WHERE type='error'${userClause(ctx)}${serviceClause(ctx)}`
  );
};

/**
 * Q4b — crash-free / users-affected denominators over ALL traffic.
 * The user's editor query is intentionally NOT applied: it is written
 * against error rows and would zero out the denominators.
 */
export const buildDenominatorsSql = (ctx: IssueQueryContext): string => {
  const userField = pickUserField(ctx.schema);
  const select = ["COUNT(DISTINCT session_id) AS total_sessions"];
  if (userField) select.push(`COUNT(DISTINCT ${userField}) AS total_users`);
  return (
    `SELECT ${select.join(", ")} FROM "${ctx.streamName}"` +
    ` WHERE session_id IS NOT NULL${serviceClause(ctx)}`
  );
};

/** Q5 — deploy detection: first in-window appearance of each version. */
export const buildDeploysSql = (ctx: IssueQueryContext): string =>
  `SELECT version, MIN(${ctx.timestampColumn}) AS first_seen` +
  ` FROM "${ctx.streamName}" WHERE version IS NOT NULL${serviceClause(ctx)}` +
  ` GROUP BY version ORDER BY first_seen DESC LIMIT 10`;

/**
 * Q6 — deploy verification: did the candidate version already produce
 * events BEFORE the window? Run against a lookback range preceding the
 * window; any hit means the version predates it (its in-window MIN was
 * just sparse traffic, not a deploy) and no marker should be shown.
 */
export const buildDeployLookbackSql = (
  ctx: IssueQueryContext,
  version: string,
): string =>
  `SELECT COUNT(*) AS prior_events FROM "${ctx.streamName}"` +
  ` WHERE version='${escapeSqlString(version)}'${serviceClause(ctx)}`;

// ── Pivots ──────────────────────────────────────────────────────────

export interface StackedBucket {
  /** Bucket start, µs. */
  ts: number;
  handled: number;
  unhandled: number;
}

const alignedStart = (windowStart: number, intervalMicros: number): number =>
  Math.floor(windowStart / intervalMicros) * intervalMicros;

const bucketCount = (
  windowStart: number,
  windowEnd: number,
  intervalMicros: number,
): number =>
  Math.max(
    1,
    Math.ceil(
      (windowEnd - alignedStart(windowStart, intervalMicros)) / intervalMicros,
    ),
  );

/** Pivot Q2 hits into a zero-filled stacked series across the window. */
export const pivotStackedHistogram = (
  hits: Array<{ ts: string | number; error_handling?: string; events: number }>,
  windowStart: number,
  windowEnd: number,
  intervalMicros: number,
): StackedBucket[] => {
  const start = alignedStart(windowStart, intervalMicros);
  const count = bucketCount(windowStart, windowEnd, intervalMicros);
  const buckets: StackedBucket[] = Array.from({ length: count }, (_, i) => ({
    ts: start + i * intervalMicros,
    handled: 0,
    unhandled: 0,
  }));
  for (const hit of hits) {
    const index = Math.floor(
      (histogramKeyToMicros(hit.ts) - start) / intervalMicros,
    );
    if (index < 0 || index >= count) continue;
    // Anything not explicitly "handled" (including null) counts as unhandled.
    if (hit.error_handling === "handled") {
      buckets[index].handled += Number(hit.events) || 0;
    } else {
      buckets[index].unhandled += Number(hit.events) || 0;
    }
  }
  return buckets;
};

/** Pivot Q3 hits into zero-filled per-issue bucket arrays keyed by issueKey. */
export const pivotTrends = (
  hits: Array<{
    ts: string | number;
    error_type?: string;
    error_message?: string;
    error_handling?: string;
    events: number;
  }>,
  windowStart: number,
  windowEnd: number,
  intervalMicros: number,
): Record<string, number[]> => {
  const start = alignedStart(windowStart, intervalMicros);
  const count = bucketCount(windowStart, windowEnd, intervalMicros);
  const trends: Record<string, number[]> = {};
  for (const hit of hits) {
    const index = Math.floor(
      (histogramKeyToMicros(hit.ts) - start) / intervalMicros,
    );
    if (index < 0 || index >= count) continue;
    const key = issueKey(hit);
    if (!trends[key]) trends[key] = new Array(count).fill(0);
    trends[key][index] += Number(hit.events) || 0;
  }
  return trends;
};
