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
 * The vocabulary of the visual PromQL builder.
 *
 * A builder query is a metric, a set of label matchers, and an ordered list of
 * STEPS. Each step wraps the expression built so far — `[rate, sum]` renders as
 * `sum(rate(metric{...}[5m]))` — so the list reads in the order a person would
 * describe it and renders inside-out.
 *
 * `PromqlStep`'s field names (`id`, `params`) are the panel's WIRE FORMAT: a
 * dashboard persists them verbatim under `fields.promql_operations` (see
 * `PromQLOperation` in src/config/src/meta/dashboards/v8). They cannot be
 * renamed without a stored-dashboard migration. Everything else here is
 * in-memory only and free to change.
 */

/** A single `label="value"` matcher inside the selector braces. */
export interface PromqlLabelMatcher {
  label: string;
  /** The four matchers PromQL defines: equal, not-equal, regex, negated regex. */
  op: "=" | "!=" | "=~" | "!~";
  value: string;
}

/** One step in the chain. PERSISTED — see the note above. */
export interface PromqlStep {
  /** A {@link PromqlStepId} value. Typed as a bare string because panels persist it. */
  id: string;
  params: PromqlStepArg[];
}

/** A step's argument. `string[]` carries the label list of a `by (...)` clause. */
export type PromqlStepArg = string | number | boolean | string[];

/** How the editor should present one argument of a step. */
export interface PromqlStepArgSpec {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  /**
   * A fixed list of choices, or `true` to mean "offer the metric's own labels".
   * Absent means free text.
   */
  options?: Array<string | number> | boolean;
  optional?: boolean;
  placeholder?: string;
  description?: string;
}

/** The catalog entry for a step: what it is called, and what it takes. */
export interface PromqlStepSpec {
  id: string;
  name: string;
  params: PromqlStepArgSpec[];
  defaultParams: PromqlStepArg[];
  group: string;
  documentation?: string;
}

/** A query as the builder holds it, before it is rendered to PromQL text. */
export interface PromqlBuilderQuery {
  metric: string;
  labels: PromqlLabelMatcher[];
  operations: PromqlStep[];
}

/**
 * How the step picker groups the catalog.
 *
 * Grouping is ours to choose — PromQL has no notion of it. We cut it by what a
 * step DOES to the data, which is the question someone building a query is
 * actually asking: turn a counter into a rate, collapse series together, do
 * arithmetic, ask about the clock.
 */
export enum PromqlStepGroup {
  /** Counter -> per-second rate, and anything else that reads over a window. */
  RateAndRange = "Rate & range",
  /** Collapse many series into fewer. */
  Aggregation = "Aggregation",
  /** Element-wise math on a single series. */
  Math = "Math",
  /** Arithmetic against a constant. */
  ScalarMath = "Scalar math",
  Trigonometry = "Trigonometry",
  TimeAndDate = "Time & date",
}

/**
 * Every step the builder can render.
 *
 * The values are PromQL function names, so a step id renders as itself — except
 * for the scalar-arithmetic steps. Those have no function name in PromQL (they
 * render as the operators `+`, `*`, …), so they need an id of our own coining;
 * `scalar_*` says what they are.
 */
export enum PromqlStepId {
  // Rate & range
  Rate = "rate",
  Irate = "irate",
  Increase = "increase",
  Delta = "delta",
  Idelta = "idelta",
  AvgOverTime = "avg_over_time",
  MinOverTime = "min_over_time",
  MaxOverTime = "max_over_time",
  SumOverTime = "sum_over_time",
  CountOverTime = "count_over_time",
  StddevOverTime = "stddev_over_time",
  QuantileOverTime = "quantile_over_time",
  LastOverTime = "last_over_time",

  // Aggregation
  Sum = "sum",
  Avg = "avg",
  Max = "max",
  Min = "min",
  Count = "count",
  Stddev = "stddev",
  TopK = "topk",
  BottomK = "bottomk",
  Quantile = "quantile",

  // Math
  HistogramQuantile = "histogram_quantile",
  Abs = "abs",
  Ceil = "ceil",
  Floor = "floor",
  Round = "round",
  Sqrt = "sqrt",
  Exp = "exp",
  Ln = "ln",
  Log2 = "log2",
  Log10 = "log10",
  Sort = "sort",
  SortDesc = "sort_desc",
  Clamp = "clamp",
  ClampMax = "clamp_max",
  ClampMin = "clamp_min",

  // Time & date
  Hour = "hour",
  Minute = "minute",
  Month = "month",
  Year = "year",
  DayOfMonth = "day_of_month",
  DayOfWeek = "day_of_week",
  DaysInMonth = "days_in_month",

  // Trigonometry
  Sin = "sin",
  Cos = "cos",
  Tan = "tan",
  Asin = "asin",
  Acos = "acos",
  Atan = "atan",
  Sinh = "sinh",
  Cosh = "cosh",
  Tanh = "tanh",
  Asinh = "asinh",
  Acosh = "acosh",
  Atanh = "atanh",
  Deg = "deg",
  Rad = "rad",
  Pi = "pi",

  // Scalar math
  Addition = "scalar_add",
  Subtraction = "scalar_subtract",
  MultiplyBy = "scalar_multiply",
  DivideBy = "scalar_divide",
  Modulo = "scalar_modulo",
  Exponent = "scalar_power",
}

/**
 * Step ids as panels saved before the scalar-math steps were renamed.
 *
 * A dashboard persists the step id verbatim, so an id that has ever been
 * written to a panel cannot simply stop being understood — a panel saved last
 * year has to keep rendering. Every id is therefore READ through
 * {@link normalizeStepId}, and the builder rewrites what it reads (see
 * {@link normalizeSteps}), so a panel is upgraded to the current ids the next
 * time it is saved.
 *
 * That is the path to RETIRING this table — but it is not retirable yet, and it
 * cannot be retired on the strength of frontend saves alone. A panel only
 * migrates when someone opens it in the builder and the dashboard is then
 * saved; a panel nobody edits keeps its old ids indefinitely. Removing an entry
 * here is therefore safe only once a backfill has been run over stored
 * dashboards and none is left holding one. Until then, deleting an entry
 * silently breaks every panel that still has it: the scalar step stops
 * resolving and vanishes from the rendered query, changing the numbers on the
 * chart with nothing to indicate it happened.
 */
const LEGACY_STEP_IDS: Readonly<Record<string, PromqlStepId>> = {
  __addition: PromqlStepId.Addition,
  __subtraction: PromqlStepId.Subtraction,
  __multiply_by: PromqlStepId.MultiplyBy,
  __divide_by: PromqlStepId.DivideBy,
  __modulo: PromqlStepId.Modulo,
  __exponent: PromqlStepId.Exponent,
};

/**
 * Maps a persisted step id onto the id the catalog knows it by today.
 *
 * `Object.hasOwn`, not `LEGACY_STEP_IDS[id] ?? id`: a plain object inherits from
 * `Object.prototype`, so indexing it with an id like `"constructor"` or
 * `"toString"` — which a hand-edited or imported dashboard can perfectly well
 * contain — would return a FUNCTION rather than a string. That value then flows
 * into {@link normalizeSteps}, gets written back into the panel, and is dropped
 * on save, because `JSON.stringify` omits function-valued properties: the step
 * would come back with no id at all.
 */
export function normalizeStepId(id: string): string {
  return Object.hasOwn(LEGACY_STEP_IDS, id) ? LEGACY_STEP_IDS[id] : id;
}

/**
 * Upgrades a saved operations array to the current step ids.
 *
 * Applied wherever the builder loads state OUT of a panel, so its in-memory
 * state is always canonical; the builder then writes that state straight back,
 * which is what migrates the stored panel.
 *
 * Returns the ARRAY IT WAS GIVEN when nothing needed upgrading. The builder
 * hangs a deep watcher off this state and copies it into the panel on every
 * change, so handing back a fresh array each time would make every panel look
 * dirty the moment it was opened. Identity is the signal that nothing happened.
 */
export function normalizeSteps<T extends { id: string }>(steps: T[]): T[] {
  if (!Array.isArray(steps)) return [];

  let changed = false;
  const upgraded = steps.map((step) => {
    const id = normalizeStepId(step?.id);
    if (step && id !== step.id) {
      changed = true;
      return { ...step, id };
    }
    return step;
  });

  return changed ? upgraded : steps;
}

/** Renders builder state to PromQL text. */
export interface PromqlRenderer {
  renderQuery(query: PromqlBuilderQuery): string;
  renderLabels(labels: PromqlLabelMatcher[]): string;
  getStepSpec(id: string): PromqlStepSpec | undefined;
  getStepsForGroup(group: string): PromqlStepSpec[];
  getGroups(): string[];
  getAllSteps(): PromqlStepSpec[];
}
