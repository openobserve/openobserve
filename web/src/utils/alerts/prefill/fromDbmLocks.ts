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
 * Lock contention (blocking chains, deadlocks) → AlertPrefill.
 *
 * WHY THIS IS NOT `fromDbm`. That adapter alerts on `_o2_db_stats`, the rollup
 * of CLIENT-OBSERVED spans — latency and errors as the application experienced
 * them. These two conditions come from somewhere else entirely: the engine's
 * own lock views, polled by the collector and written to the shared
 * server-vantage stream `dbm_server`. Different stream, different columns,
 * different vantage. Folding them into one builder would mean switching all
 * three on a `kind` field, and the pairing is exactly the thing that must not
 * be gettable wrong.
 *
 * THE PROVENANCE RULE. A span-latency alert and a lock-wait alert can both be
 * about `orders-db` and sit next to each other in the alert list, where the
 * reader will compare them. They are not comparable: one is what the client
 * waited, one is what the server reported holding. So the vantage is stated
 * three times over — in the alert NAME, in a warning the form renders, and in
 * the column names of the query itself, which are unmistakably `o2_dbm_*`
 * server records.
 *
 * WHAT IS DELIBERATELY ABSENT. Connection saturation is not here. The honest
 * scalar for it (`utils/dbm/healthScalar.ts`) returns `no-limit` for every
 * MySQL instance, because mysqlreceiver publishes no `max_connections`, and it
 * refuses to fall back to the raw count. An alert thresholding a share would
 * therefore be un-armable on MySQL, and one thresholding a count would compare
 * a count against a share the moment both engines are in the fleet. Neither is
 * shippable, so the condition is left out rather than half-built.
 *
 * Pure and synchronous (invariant 5): a plain snapshot in, a plain object out.
 */

import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import { sanitizeAlertNamePart, warn } from "../alertPrefill";

/**
 * The shared server-vantage logs stream. Deadlocks, blocking, activity and
 * top-query records all land here and are told apart by `o2_dbm_kind` — which
 * is why every query this module builds carries that predicate.
 */
export const DBM_SERVER_STREAM = "dbm_server";

/** What the user asked to be alerted about. */
export type DbmLockAlertKind = "blocking" | "deadlocks";

export interface DbmLockPrefillInput {
  kind: DbmLockAlertKind;
  dbSystem?: string | null;
  dbInstance?: string | null;
  /** Longest wait currently on screen, in SECONDS — the threshold's basis. */
  observedWaitSeconds?: number | null;
  /** Deadlocks currently on screen, for the same reason. */
  observedEvents?: number | null;
  /** The window the user is looking at, so the alert evaluates the same span. */
  periodMinutes?: number | null;
}

/** The wire value of `o2_dbm_kind`. The UI's plural is not the record's name. */
const KIND_PREDICATE: Record<DbmLockAlertKind, string> = {
  blocking: "blocking",
  deadlocks: "deadlock",
};

/** SQL string literal escaping — single quotes doubled, per the alert builders. */
const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Same 1.5x headroom as the latency sibling, so the two surfaces behave alike. */
const HEADROOM = 1.5;

/** No observation to scale from: a wait this long is trouble on any engine. */
const DEFAULT_WAIT_SECONDS = 30;

/** Likewise — enough deadlocks in a window to be a pattern, not an accident. */
const DEFAULT_DEADLOCK_EVENTS = 10;

/** Default evaluation window when the surface did not say what it was showing. */
const DEFAULT_PERIOD_MINUTES = 15;

/**
 * Suggested blocking threshold: 1.5x the longest wait on screen, whole seconds.
 *
 * Deliberately NOT the observed value, for the reason the latency sibling
 * documents: an alert armed at exactly what we just watched fires on the next
 * ordinary lock, gets muted, and is never re-armed.
 */
export const suggestedWaitSeconds = (observed: number | null | undefined): number => {
  const seconds = typeof observed === "number" && observed > 0 ? observed : 0;
  if (!seconds) return DEFAULT_WAIT_SECONDS;
  return Math.max(1, Math.round(seconds * HEADROOM));
};

/**
 * Suggested deadlock threshold: above the count on screen, never below the
 * floor.
 *
 * A deadlock is a normal outcome of concurrency — the engine resolves it by
 * killing a victim and the client retries. One is not an incident, so arming
 * at one would page somebody for a database working as designed. What makes it
 * an incident is RATE, which is why this thresholds a count over the window.
 */
export const suggestedDeadlockEvents = (observed: number | null | undefined): number => {
  const events = typeof observed === "number" && observed > 0 ? observed : 0;
  return Math.max(DEFAULT_DEADLOCK_EVENTS, Math.round(events * HEADROOM));
};

/**
 * The WHERE clause. `o2_dbm_kind` is not optional: the one stream holds four
 * record families, so a query without it counts activity samples and top-query
 * rows as though they were locks.
 */
const scopeClauses = (input: DbmLockPrefillInput): string[] => {
  const clauses: string[] = [`o2_dbm_kind = ${q(KIND_PREDICATE[input.kind] ?? input.kind)}`];
  if (input.dbSystem) clauses.push(`o2_dbm_engine = ${q(input.dbSystem)}`);
  if (input.dbInstance) clauses.push(`o2_dbm_instance = ${q(input.dbInstance)}`);
  return clauses;
};

/**
 * The alert name, carrying the VANTAGE.
 *
 * `server` is in here on purpose and is not decoration. Without it this alert
 * and a span-latency alert on the same database produce two similarly-named
 * entries measuring different things from different sides of the connection,
 * and the alert list is precisely where someone compares them.
 */
const nameFor = (input: DbmLockPrefillInput): string => {
  const where = sanitizeAlertNamePart(input.dbInstance || input.dbSystem || "database", "database");
  const what = input.kind === "deadlocks" ? "deadlocks" : "lock_waits";
  return sanitizeAlertNamePart(`db_server_${where}_${what}`, `db_server_${what}`);
};

export const buildDbmLockPrefill = (input: DbmLockPrefillInput): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];

  const where = scopeClauses(input).join(" AND ");

  // A deadlock has no duration to threshold: by the time it is recorded the
  // engine has already broken it by killing a victim. Counting is the only
  // honest aggregate, and reading a wait column here would return nulls.
  const isDeadlocks = input.kind === "deadlocks";
  const metric = isDeadlocks ? "COUNT(*)" : "MAX(o2_dbm_wait_seconds)";
  const threshold = isDeadlocks
    ? suggestedDeadlockEvents(input.observedEvents)
    : suggestedWaitSeconds(input.observedWaitSeconds);

  const sql =
    `SELECT ${metric} AS value FROM "${DBM_SERVER_STREAM}" ` +
    `WHERE ${where} HAVING ${metric} > ${threshold}`;

  // Stated every time, not only when something went wrong: the vantage is a
  // permanent property of this alert, and the reader needs it most when the
  // alert fires months from now beside one built from client spans.
  warnings.push(warn("dbmServerVantage", "info"));

  // These surfaces are POLLED. The collector wakes on an interval and records
  // what it finds, so a lock that opened and closed in between was never
  // written. The alert can therefore miss real contention, and silence here
  // is not proof of health.
  warnings.push(warn("dbmLockSampling", "info"));

  // Fleet-wide rather than one database. It still runs, so this degrades
  // instead of blocking — but an unannounced widening would leave the user
  // believing they armed an alert on the instance they were looking at.
  if (!input.dbInstance) warnings.push(warn("dbmNoInstance", "warning"));

  const periodMinutes =
    typeof input.periodMinutes === "number" && input.periodMinutes > 0
      ? Math.round(input.periodMinutes)
      : DEFAULT_PERIOD_MINUTES;

  return {
    version: ALERT_PREFILL_VERSION,
    source: "dbmlocks",
    sourceLabel: "Database Monitoring — server vantage",
    name: nameFor(input),
    streamType: "logs",
    streamName: DBM_SERVER_STREAM,
    queryType: "sql",
    sql,
    periodMinutes,
    frequencyMinutes: periodMinutes,
    thresholdShape: "count",
    warnings,
    meta: {
      dbSystem: input.dbSystem ?? null,
      dbInstance: input.dbInstance ?? null,
      kind: input.kind,
      // Named for what it is: a reading the ENGINE reported, never a
      // client-side span measurement.
      serverObservedWaitSeconds: input.observedWaitSeconds ?? null,
      serverObservedEvents: input.observedEvents ?? null,
    },
  };
};
