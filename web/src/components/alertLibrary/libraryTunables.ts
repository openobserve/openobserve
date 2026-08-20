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

// Which parts of a library alert are safely editable, and which are not.
//
// The library is built from exports of alerts people really created, so there
// are no placeholders and no substitution engine — the stored query runs
// exactly as written. That splits tuning in two:
//
//   STRUCTURED, editable — `trigger_condition.{threshold, period, frequency,
//   silence}` for every alert, plus `query_condition.promql_condition
//   .{operator, value}` for PromQL. All 69 PromQL alerts carry the latter: the
//   real threshold is a field BESIDE the query, not a number inside it.
//
//   EMBEDDED, read-only — the `HAVING … > N` literal the 18 SQL alerts carry.
//   Rewriting query text from a form field is how a template language starts;
//   the drawer shows it locked and points at "Customize in editor" instead.
//
// Pure and file-in/file-out, so the drawer stays markup and this stays tested.

import type { AlertLibraryFile } from "@/types/alertLibrary";

/** The structured knobs the drawer edits, per alert. */
export interface LibraryTunables {
  threshold: number;
  /** Rolling evaluation window, minutes. */
  period: number;
  /** Evaluation interval, minutes. */
  frequency: number;
  /** Repeat-notification suppression, minutes. */
  silence: number;
  /** PromQL alerts only; `null` means the alert has no structured threshold. */
  promqlOperator: string | null;
  promqlValue: number | null;
}

/**
 * Fallbacks for a field the file does not carry.
 *
 * Deliberately the alert form's OWN defaults (`useAlertForm.defaultAlertValue`)
 * rather than zeroes: a blank `period` must not read as "look at 0 minutes of
 * data", which is an alert that can never fire.
 */
export const DEFAULT_TUNABLES: LibraryTunables = {
  threshold: 3,
  period: 10,
  frequency: 10,
  silence: 10,
  promqlOperator: null,
  promqlValue: null,
};

/**
 * Comparisons offered for the PromQL condition.
 *
 * The numeric subset of the alert form's `triggerOperators` — `Contains` /
 * `NotContains` are string tests and mean nothing against a metric value.
 */
export const NUMERIC_OPERATORS = ["=", "!=", ">=", "<=", ">", "<"] as const;

/** A threshold that lives inside the SQL text, and therefore cannot be a field. */
export interface LockedSqlThreshold {
  /** The whole matched clause, for display. */
  clause: string;
  column: string;
  operator: string;
  /** Kept as text: this is shown, never parsed back into the query. */
  value: string;
}

/**
 * `HAVING <column> <op> <number>` — the one shape the SQL alerts use for a
 * semantic threshold. Loose on the column (it may be a function call) and
 * strict on the literal, because the literal is the only part being reported.
 */
const HAVING_THRESHOLD = /\bhaving\b\s+([\w.()*]+)\s*(>=|<=|!=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?)/i;

/** Everything in a fetched file is untrusted — read through, never index blind. */
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function readTunables(file: AlertLibraryFile): LibraryTunables {
  const trigger = asRecord(file?.trigger_condition);
  const promqlCondition = asRecord(asRecord(file?.query_condition).promql_condition);
  const hasPromqlCondition = Object.keys(promqlCondition).length > 0;

  return {
    threshold: asNumber(trigger.threshold, DEFAULT_TUNABLES.threshold),
    period: asNumber(trigger.period, DEFAULT_TUNABLES.period),
    frequency: asNumber(trigger.frequency, DEFAULT_TUNABLES.frequency),
    silence: asNumber(trigger.silence, DEFAULT_TUNABLES.silence),
    promqlOperator: hasPromqlCondition
      ? typeof promqlCondition.operator === "string"
        ? promqlCondition.operator
        : ">="
      : null,
    promqlValue: hasPromqlCondition ? asNumber(promqlCondition.value, 0) : null,
  };
}

/**
 * A copy of `file` with the edited fields written back.
 *
 * Returns a new object: the caller's copy is the one handed to install and to
 * the preview, and editing in place would let a discarded draft leak into it.
 * `promql_condition` is only written when the file already had one — inventing
 * one on a SQL alert would create a condition the backend never asked for.
 */
export function applyTunables(file: AlertLibraryFile, tunables: LibraryTunables): AlertLibraryFile {
  const next: AlertLibraryFile = { ...file };

  next.trigger_condition = {
    ...asRecord(file?.trigger_condition),
    threshold: tunables.threshold,
    period: tunables.period,
    frequency: tunables.frequency,
    silence: tunables.silence,
  };

  const queryCondition = asRecord(file?.query_condition);
  const promqlCondition = queryCondition.promql_condition;
  next.query_condition =
    promqlCondition && typeof promqlCondition === "object"
      ? {
          ...queryCondition,
          promql_condition: {
            ...asRecord(promqlCondition),
            operator: tunables.promqlOperator ?? ">=",
            value: tunables.promqlValue ?? 0,
          },
        }
      : { ...queryCondition };

  return next;
}

/**
 * The SQL-embedded threshold, if this alert has one.
 *
 * PromQL is excluded by construction rather than by regex: its comparisons in
 * query text are structural guards (`rate(...) > 0` to avoid dividing by zero),
 * not the alert's threshold, and offering to "unlock" one would be wrong.
 */
export function lockedSqlThreshold(file: AlertLibraryFile): LockedSqlThreshold | null {
  const queryCondition = asRecord(file?.query_condition);
  if (queryCondition.type !== "sql") return null;

  const sql = queryCondition.sql;
  if (typeof sql !== "string") return null;

  const match = HAVING_THRESHOLD.exec(sql);
  if (!match) return null;

  return { clause: match[0], column: match[1], operator: match[2], value: match[3] };
}
