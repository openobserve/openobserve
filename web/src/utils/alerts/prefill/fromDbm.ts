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
 * Database Monitoring row → AlertPrefill.
 *
 * WHY THIS EXISTS. "Alert me if this slows" used to push the user at the bare
 * alert list with nothing carried over, so the label promised a workflow the
 * code did not implement: the user still had to find the stream, remember the
 * fingerprint, and hand-write the threshold for the query they were just
 * looking at. This adapter carries that context across.
 *
 * WHAT IT ALERTS ON. The rollup stream (`_o2_db_stats`), not raw spans — it is
 * pre-aggregated per window, so a p95 threshold reads one row instead of
 * re-percentiling every span on every evaluation.
 *
 * TWO BOUNDS THE CALLER MUST RESPECT, both from the DBM design notes:
 *
 *  1. Alerts lag by `rollup_interval + evaluation_interval` (the rollup default
 *     is 900s). An alert here is not a real-time page.
 *  2. Fingerprints are stable only WITHIN an `fp_version`. A normalizer bump
 *     re-buckets traffic, so an alert pinned to a raw hash goes silently dark.
 *     We therefore match on `fp_version` too and warn, rather than pretending
 *     the hash is forever.
 *
 * Pure and synchronous (invariant 5): a plain snapshot in, a plain object out.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { sanitizeAlertNamePart, warn } from "../alertPrefill";

/** The rollup stream the DBM read endpoints aggregate from. */
export const DBM_STATS_STREAM = "_o2_db_stats";

/** What the user asked to be alerted about. */
export type DbmAlertKind = "latency" | "errors";

export interface DbmPrefillInput {
  /** Fingerprint of the normalized statement — the alert's identity. */
  fingerprint?: string | null;
  /** Normalized statement, for the alert NAME only (never for matching). */
  queryNorm?: string | null;
  /** Fingerprint schema version in force when the row was read. */
  fpVersion?: number | string | null;
  dbSystem?: string | null;
  dbInstance?: string | null;
  /** Whole-database alert (Databases page) rather than one query. */
  scope: "query" | "database";
  kind: DbmAlertKind;
  /** Observed p95 in NANOseconds — the basis for the suggested threshold. */
  p95Ns?: number | null;
  /** Rollup window in seconds, so the evaluation period can match it. */
  rollupIntervalSecs?: number | null;
}

/** SQL string literal escaping — single quotes doubled, per the alert builders. */
const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Suggested latency threshold: 1.5× the observed p95, rounded to a whole
 * millisecond.
 *
 * Deliberately NOT the observed value. An alert armed exactly at today's p95
 * fires on the next ordinary fluctuation, and an alert that cries wolf on day
 * one gets muted and never re-armed. The headroom makes the first firing mean
 * something. The user can still edit it in the form — this is a starting point,
 * not a verdict.
 */
export const suggestedLatencyMs = (p95Ns: number | null | undefined): number => {
  const ns = typeof p95Ns === "number" && p95Ns > 0 ? p95Ns : 0;
  if (!ns) return 1000;
  return Math.max(1, Math.round((ns * 1.5) / 1_000_000));
};

/**
 * Build the WHERE clause identifying the thing being alerted on.
 *
 * `fp_version` is part of the match, not decoration: comparing a p95 across a
 * normalizer bump compares two different populations of statements.
 */
const scopeClauses = (input: DbmPrefillInput): string[] => {
  const clauses: string[] = [`record_type = ${q("query_stats")}`];

  if (input.scope === "query" && input.fingerprint) {
    clauses.push(`fingerprint = ${q(input.fingerprint)}`);
    if (input.fpVersion !== null && input.fpVersion !== undefined && input.fpVersion !== "") {
      clauses.push(`fp_version = ${q(String(input.fpVersion))}`);
    }
  }
  if (input.dbSystem) clauses.push(`db_system = ${q(input.dbSystem)}`);
  if (input.dbInstance) clauses.push(`db_instance = ${q(input.dbInstance)}`);

  return clauses;
};

/**
 * A readable alert name. The normalized statement is far too long to be one, so
 * the identity comes from engine + instance and, for a query alert, a short
 * fingerprint prefix — enough to tell two alerts on the same database apart.
 */
const nameFor = (input: DbmPrefillInput): string => {
  const what = input.kind === "errors" ? "errors" : "slow";
  const where = sanitizeAlertNamePart(input.dbInstance || input.dbSystem || "database", "database");
  if (input.scope === "database") return `db_${where}_${what}`;
  const fp = (input.fingerprint || "").slice(0, 8);
  return sanitizeAlertNamePart(`db_${where}_${fp}_${what}`, `db_${where}_${what}`);
};

export const buildDbmPrefill = (input: DbmPrefillInput): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];

  // A query-scoped alert with no fingerprint has nothing stable to match on;
  // degrade to the database scope rather than emitting a query alert that
  // silently covers the whole instance.
  const scope: DbmPrefillInput["scope"] =
    input.scope === "query" && !input.fingerprint ? "database" : input.scope;
  if (scope !== input.scope) warnings.push(warn("dbmNoFingerprint", "warning"));

  const resolved: DbmPrefillInput = { ...input, scope };
  const where = scopeClauses(resolved).join(" AND ");

  // The rollup already carries the percentile, so the alert reads it rather
  // than recomputing one. MAX over the window keeps a multi-row scope honest:
  // one slow database in the group should still fire.
  const metric = resolved.kind === "errors" ? "SUM(errors)" : "MAX(p95_ns)";
  const threshold = resolved.kind === "errors" ? 0 : suggestedLatencyMs(resolved.p95Ns) * 1_000_000;
  const operator = ">";

  const sql =
    `SELECT ${metric} AS value FROM "${DBM_STATS_STREAM}" ` +
    `WHERE ${where} HAVING ${metric} ${operator} ${threshold}`;

  // Evaluate no faster than the rollup produces data — a shorter period reads a
  // window that does not exist yet and evaluates to nothing.
  const rollupMinutes = Math.max(
    1,
    Math.round(
      (resolved.rollupIntervalSecs && resolved.rollupIntervalSecs > 0
        ? resolved.rollupIntervalSecs
        : 900) / 60,
    ),
  );
  warnings.push(warn("dbmRollupLag", "info", { minutes: rollupMinutes }));
  if (scope === "query") warnings.push(warn("dbmFingerprintVersion", "info"));

  return {
    version: ALERT_PREFILL_VERSION,
    source: "dbm",
    sourceLabel: "Database Monitoring",
    name: nameFor(resolved),
    streamType: "logs",
    streamName: DBM_STATS_STREAM,
    queryType: "sql",
    sql,
    periodMinutes: rollupMinutes,
    frequencyMinutes: rollupMinutes,
    thresholdShape: "count",
    warnings,
    meta: {
      fingerprint: resolved.fingerprint ?? null,
      fpVersion: resolved.fpVersion ?? null,
      dbSystem: resolved.dbSystem ?? null,
      dbInstance: resolved.dbInstance ?? null,
      scope,
      kind: resolved.kind,
      observedP95Ns: resolved.p95Ns ?? null,
    },
  };
};
