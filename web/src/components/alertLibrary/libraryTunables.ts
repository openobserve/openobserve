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

/** The knobs bound to a number input, and therefore edited as text. */
export type NumericTunableKey = "threshold" | "period" | "frequency" | "silence" | "promqlValue";

/**
 * Smallest value each knob may hold; `null` means unbounded.
 *
 * These are the alert form's own validation floors (`AlertSettings.schema`
 * period ≥ 1, `QueryConfig.schema` threshold/frequency ≥ 1, `AddAlert.schema`
 * silence ≥ 0) rather than new rules — a value the drawer accepts must still
 * save. `promqlValue` is unbounded because it is compared against a metric,
 * and a metric is legitimately zero or negative.
 */
const TUNABLE_MINIMUM: Record<NumericTunableKey, number | null> = {
  threshold: 1,
  period: 1,
  frequency: 1,
  silence: 0,
  promqlValue: null,
};

/**
 * One number-input edit → a value that is safe to store.
 *
 * OInput emits the raw string and does not coerce, so a CLEARED field arrives
 * as `""` — and `Number("")` is `0`, which would quietly turn "evaluation
 * window" into "look at 0 minutes of data": an alert that can never fire, with
 * nothing on screen to say so. Flooring here is what makes that unreachable.
 */
export const coerceTunable = (key: NumericTunableKey, value: string | number): number => {
  const minimum = TUNABLE_MINIMUM[key];
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return minimum ?? 0;
  return minimum === null ? parsed : Math.max(minimum, parsed);
};

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

/**
 * The file's PromQL condition, or null when it has none.
 *
 * ONE definition, shared by the reader and the writer. They used to disagree:
 * the reader treated `{}` / `[]` as "no condition" (so the drawer showed no
 * threshold row), while the writer treated them as truthy objects and wrote a
 * fabricated `{ operator: ">=", value: 0 }` into the installed alert — a
 * threshold nothing on screen had offered, firing on every evaluation of any
 * non-negative metric.
 */
const promqlConditionOf = (file: AlertLibraryFile): Record<string, unknown> | null => {
  const condition = asRecord(asRecord(file?.query_condition).promql_condition);
  return Object.keys(condition).length > 0 ? condition : null;
};

export function readTunables(file: AlertLibraryFile): LibraryTunables {
  const trigger = asRecord(file?.trigger_condition);
  const promqlCondition = promqlConditionOf(file);

  // Floored on the way IN, not only on edit. These numbers come from a remote
  // file, and a value the user never touches reached install untouched: a
  // published `period: 0` installed an alert that looks at zero minutes of
  // data, and `threshold: 0` one that fires every evaluation — the exact
  // states `coerceTunable` exists to make unreachable.
  return {
    threshold: coerceTunable("threshold", asNumber(trigger.threshold, DEFAULT_TUNABLES.threshold)),
    period: coerceTunable("period", asNumber(trigger.period, DEFAULT_TUNABLES.period)),
    frequency: coerceTunable("frequency", asNumber(trigger.frequency, DEFAULT_TUNABLES.frequency)),
    silence: coerceTunable("silence", asNumber(trigger.silence, DEFAULT_TUNABLES.silence)),
    promqlOperator: promqlCondition
      ? typeof promqlCondition.operator === "string"
        ? promqlCondition.operator
        : ">="
      : null,
    // Unbounded by design: compared against a metric, which is legitimately
    // zero or negative.
    promqlValue: promqlCondition ? asNumber(promqlCondition.value, 0) : null,
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
  // Same predicate the reader used, so the writer can only ever edit a
  // condition the drawer actually offered.
  const promqlCondition = promqlConditionOf(file);
  next.query_condition = promqlCondition
    ? {
        ...queryCondition,
        promql_condition: {
          ...promqlCondition,
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
