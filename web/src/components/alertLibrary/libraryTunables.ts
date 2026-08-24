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
//   Query text is never rewritten from a form field; "Customize in editor"
//   opens the alert editor instead.
//
// Pure and file-in/file-out, so the install wizard stays markup and this stays
// tested.

import type { AlertLibraryFile } from "@/types/alertLibrary";

/** The structured knobs the install wizard edits, per alert. */
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

/** Everything in a fetched file is untrusted — read through, never index blind. */
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** The file's PromQL condition, or null when it has none — `{}` counts as none. */
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
