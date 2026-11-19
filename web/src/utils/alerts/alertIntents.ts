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

// Intent-first start (P9): generic alert shapes whose slots fill from the picked stream's schema
// by type and value shape. No field, label or metric name is written into this logic.

import type { ValueCount } from "@/composables/alerts/useStreamDiscovery";
import type { AnomalyIntervalUnit } from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.schema";
import type { SeriesLabels } from "./promqlNoSeries";
import { promqlByLabels, sqlGroupByLabels } from "./queryGroupLabels";

export type IntentId =
  | "countWhere"
  | "percentile"
  | "anyEvent"
  | "unusualVolume"
  | "compareLastWeek"
  | "metricAbove"
  | "ratio"
  | "unusualChange"
  | "promql";

export type FieldKind = "string" | "number" | "boolean" | "other";

export interface SchemaField {
  name: string;
  type?: string;
}

/** What one search over the last hour says about a field's values. */
export interface FieldShape {
  name: string;
  kind: FieldKind;
  /** Share of events carrying the field, 0–1. */
  coverage: number;
  /** Events carrying the field. */
  present: number;
  distinct?: number;
  /** Share of the field's events holding its most common value. */
  topShare?: number;
  /** Share of its values that read as words rather than numbers, times or addresses. */
  wordShare?: number;
  /** Entropy of its values in bits: how many ways, and how evenly, they split the events. */
  entropy?: number;
  p50?: number;
  p99?: number;
}

export interface IntentSlots {
  field?: string;
  values?: string[];
  /** The values typed as a pattern such as "5xx"; every other value matches literally. */
  patterns?: string[];
  group?: string;
  measure?: string;
  factor?: number;
  label?: string;
}

/** A metric stream of the org, as the stream list carries it. */
export interface MetricStreamInfo {
  name: string;
  metrics_meta?: { metric_type?: string; metric_family_name?: string };
}

/** A metric that reads the same thing under other names, with its own spellings of the share's label;
 * `whole` when every series carries one of them, so the denominator needs no presence filter. */
export interface MetricFamilyMember {
  metric: string;
  labels: string[];
  whole: boolean;
}

/** What applying an intent writes: form paths, plus the mode switches the form owns outside its values. */
export interface IntentFill {
  intent: IntentId;
  howItChecks: "false" | "true" | "anomaly";
  values: Record<string, unknown>;
  aggregation: boolean;
  vrl: boolean;
  anomaly?: Record<string, unknown>;
}

export const EVENT_INTENTS: readonly IntentId[] = [
  "countWhere",
  "percentile",
  "anyEvent",
  "unusualVolume",
  "compareLastWeek",
];
export const METRIC_INTENTS: readonly IntentId[] = [
  "metricAbove",
  "ratio",
  "unusualChange",
  "promql",
];
const ANOMALY_INTENTS = new Set<IntentId>(["unusualVolume", "unusualChange"]);

/** Fields asked about in the one shape search; a wider stream ranks its first ones only. */
export const SHAPE_STRING_CAP = 24;
export const SHAPE_NUMBER_CAP = 8;
export const SHAPE_WINDOW_US = 60 * 60 * 1_000_000;
/** The org alert count from which cards fold to one line (D-PO5). */
export const CARDS_FOLD_AT = 10;
export const DEFAULT_FACTOR = 2;
/** Anomaly histograms bucket by 5 minutes unless changed in section 2. */
export const ANOMALY_BUCKET_MINUTES = 5;

// Value-shape bounds from the starter design (phase2 §2.5).
const CATEGORY_MAX_DISTINCT = 20;
const GROUP_MAX_DISTINCT = 200;
const CATEGORY_MIN_COVERAGE = 0.9;
const GROUP_MIN_COVERAGE = 0.8;
const GROUP_FULL_COVERAGE = 0.95;
const GROUP_MIN_DISTINCT = 3;
// A filter only needs the events it selects, so a field on a third of them still qualifies.
const FILTER_MIN_COVERAGE = 0.3;
const MAJORITY_SHARE = 0.6;
const FIXED_BY_GROUP = 0.75;
/** Commonest values per text field the shape search returns, for hour-wide shares. */
export const SHAPE_TOP_VALUES = 10;
const MEASURE_MIN_COVERAGE = 0.5;
const HEAVY_TAIL_RATIO = 5;
const MIN_WORD_SHARE = 0.8;
const NEAR_TIE = 0.9;
// A name word on more than this share of the labels (a namespace like k8s_) names no one entity.
const ENTITY_TOKEN_MAX_SHARE = 0.25;

/**
 * Intents offered for a stream type; the "unusual" ones only where anomaly detection is usable, and no
 * per-event one under When unusual, which cannot check each event.
 */
export function intentsFor(
  streamType: string,
  opts: { anomaly: boolean; howItChecks?: string },
): IntentId[] {
  const all = streamType === "metrics" ? METRIC_INTENTS : EVENT_INTENTS;
  return all
    .filter((id) => opts.anomaly || !ANOMALY_INTENTS.has(id))
    .filter((id) => opts.howItChecks !== "anomaly" || id !== "anyEvent");
}

export function fieldKind(type: string | undefined): FieldKind {
  const t = (type ?? "").toLowerCase();
  if (/^(u?int|float|double|decimal)/.test(t)) return "number";
  if (t.startsWith("bool")) return "boolean";
  if (/utf8|string|text|varchar/.test(t)) return "string";
  return "other";
}

/** Fields of a kind a slot can take: never the timestamp, internal `_` columns or the all-fields column. */
export function slotFields(
  fields: readonly SchemaField[],
  kind: FieldKind,
  exclude: readonly string[] = [],
): string[] {
  const skip = new Set(exclude.filter(Boolean));
  return fields
    .filter((f) => f.name && !f.name.startsWith("_") && !skip.has(f.name))
    .filter((f) => fieldKind(f.type) === kind)
    .map((f) => f.name);
}

/** Recent events read to choose which fields the shape search asks about; a wide schema is mostly sparse. */
export const SAMPLE_ROWS = 100;

/** Fields in order of how many sampled events carry a value for them; fields no sample carries are left out. */
export function fieldsBySamplePresence(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
): string[] {
  const present = (field: string) =>
    rows.filter((row) => row[field] !== undefined && row[field] !== null && row[field] !== "")
      .length;
  return fields
    .map((field, index) => ({ field, index, count: present(field) }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((f) => f.field);
}

const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** One aggregate search giving coverage, distinct count and commonest values per string field and
 * p50/p99 per number field. */
export function shapeQuerySql(stream: string, strings: string[], numbers: string[]): string {
  const parts = ['count(*) AS "t"'];
  strings.forEach((f, i) =>
    parts.push(
      `count(${quoteId(f)}) AS "c${i}"`,
      `approx_distinct(${quoteId(f)}) AS "d${i}"`,
      `approx_topk(${quoteId(f)}, ${SHAPE_TOP_VALUES}) AS "v${i}"`,
    ),
  );
  numbers.forEach((f, i) =>
    parts.push(
      `count(${quoteId(f)}) AS "k${i}"`,
      `approx_percentile_cont(${quoteId(f)}, 0.5) AS "m${i}"`,
      `approx_percentile_cont(${quoteId(f)}, 0.99) AS "q${i}"`,
    ),
  );
  return `SELECT ${parts.join(", ")} FROM ${quoteId(stream)}`;
}

const num = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n)
    ? undefined
    : n;
};

/** Value counts of a field: the search's commonest values over the hour, else the sampled events. */
const valueCounts = (
  top: unknown,
  rows: readonly Record<string, unknown>[],
  field: string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  const add = (value: unknown, n: number) => {
    if (value === undefined || value === null || value === "" || !(n > 0)) return;
    counts.set(String(value), (counts.get(String(value)) ?? 0) + n);
  };
  if (Array.isArray(top)) top.forEach((v) => add(v?.value, num(v?.count) ?? 0));
  else rows.forEach((row) => add(row[field], 1));
  return counts;
};

const WORD_DIGIT_SHARE = 0.3;
const isWord = (v: string) => (v.match(/\d/g)?.length ?? 0) / v.length < WORD_DIGIT_SHARE;

/** Top share, word share and entropy; values past the listed ones spread evenly over the rest. */
const valueShape = (counts: Map<string, number>, present: number, distinct: number | undefined) => {
  const listed = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!listed) return {};
  const total = Math.max(present, listed);
  const rest = total - listed;
  const restValues = Math.max(1, (distinct ?? counts.size) - counts.size);
  const bits = (n: number, spread = 1) =>
    n > 0 ? -(n / total) * Math.log2(n / total / spread) : 0;
  const words = [...counts.entries()].filter(([v]) => isWord(v)).reduce((a, [, n]) => a + n, 0);
  return {
    topShare: Math.max(...counts.values()) / total,
    wordShare: words / listed,
    entropy: [...counts.values()].reduce((h, n) => h + bits(n), 0) + bits(rest, restValues),
  };
};

/** Reads `shapeQuerySql`'s one row back into shapes, in the order the fields were asked. */
export function readFieldShapes(
  row: Record<string, unknown> | undefined,
  strings: string[],
  numbers: string[],
  sample: readonly Record<string, unknown>[] = [],
): FieldShape[] {
  const total = num(row?.t) ?? 0;
  const share = (n: unknown) => (total > 0 ? Math.min(1, (num(n) ?? 0) / total) : 0);
  return [
    ...strings.map((name, i) => {
      const counts = valueCounts(row?.[`v${i}`], sample, name);
      const present = num(row?.[`c${i}`]) ?? 0;
      const distinct = num(row?.[`d${i}`]);
      const fromSearch = Array.isArray(row?.[`v${i}`]);
      return {
        name,
        kind: "string" as const,
        coverage: share(row?.[`c${i}`]),
        present,
        distinct,
        ...valueShape(counts, fromSearch ? present : 0, fromSearch ? distinct : undefined),
      };
    }),
    ...numbers.map((name, i) => ({
      name,
      kind: "number" as const,
      coverage: share(row?.[`k${i}`]),
      present: num(row?.[`k${i}`]) ?? 0,
      p50: num(row?.[`m${i}`]),
      p99: num(row?.[`q${i}`]),
    })),
  ];
}

/** A slot's candidates: `fit` pass the slot's rule and are the only ones it may default to; `all` lists
 * them first, then the rest for the picker. */
export interface Ranked {
  fit: string[];
  all: string[];
}

const ranked = (fit: string[], candidates: readonly string[]): Ranked => ({
  fit,
  all: [...fit, ...candidates.filter((name) => !fit.includes(name))],
});

/** Drops names from both lists, e.g. the field another slot already holds. */
export const without = (r: Ranked, ...names: (string | undefined)[]): Ranked => ({
  fit: r.fit.filter((n) => !names.includes(n)),
  all: r.all.filter((n) => !names.includes(n)),
});

const byShape = (
  candidates: string[],
  shapes: readonly FieldShape[],
  qualifies: (s: FieldShape) => boolean,
  order: (a: FieldShape, b: FieldShape) => number,
): Ranked => {
  const known = new Map(shapes.map((s) => [s.name, s]));
  const fit = candidates
    .map((name) => known.get(name))
    .filter((s): s is FieldShape => !!s && qualifies(s))
    .sort(order)
    .map((s) => s.name);
  return ranked(fit, candidates);
};

/** Repeating word values (not numbers, times, ids or one-per-event text) on enough events. */
const isCategory = (s: FieldShape, minCoverage: number, minDistinct: number) =>
  s.coverage >= minCoverage &&
  (s.distinct ?? 0) >= minDistinct &&
  (s.distinct ?? 0) <= GROUP_MAX_DISTINCT &&
  (s.distinct ?? 0) * 2 <= s.present &&
  (s.wordShare ?? 1) >= MIN_WORD_SHARE;

const byEntropy = (a: FieldShape, b: FieldShape) =>
  (b.entropy ?? 0) - (a.entropy ?? 0) || (a.distinct ?? 0) - (b.distinct ?? 0);

/** How far a group's value predicts a field's minority values: 1 when each group holds a single value
 * of the field, 0 when knowing the group says nothing beyond the field's commonest value. */
export function fixedByGroup(
  rows: readonly Record<string, unknown>[],
  field: string,
  group: string,
): number {
  const byGroup = new Map<string, Map<string, number>>();
  const overall = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    const key = String(row[group] ?? "");
    const counts = byGroup.get(key) ?? new Map<string, number>();
    counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
    byGroup.set(key, counts);
    overall.set(String(value), (overall.get(String(value)) ?? 0) + 1);
    total += 1;
  }
  if (field === group) return 1;
  if (!total) return 0;
  const top = Math.max(...overall.values()) / total;
  if (top >= 1) return 1;
  const held = [...byGroup.values()].reduce((sum, c) => sum + Math.max(...c.values()), 0) / total;
  return Math.max(0, (held - top) / (1 - top));
}

export type CategoryWant = "split" | "variety";

const isSplit = (s: FieldShape) => (s.topShare ?? 0) >= MAJORITY_SHARE && (s.topShare ?? 1) < 1;

/** Filter fields. "split" (a count, a comparison) needs a big majority beside a small minority, the most
 * lopsided first; "variety" (one kind of event) leads with the field naming the most kinds. */
export const rankCategory = (
  candidates: string[],
  shapes: readonly FieldShape[],
  want: CategoryWant = "split",
): Ranked =>
  want === "variety"
    ? byShape(candidates, shapes, (s) => isCategory(s, FILTER_MIN_COVERAGE, 2), byEntropy)
    : byShape(
        candidates,
        shapes,
        (s) => isCategory(s, FILTER_MIN_COVERAGE, 2) && isSplit(s),
        (a, b) => (b.topShare ?? 0) - (a.topShare ?? 0),
      );

/** Group fields: several word values, none holding most events; those on (nearly) every event lead,
 * then the ones the org's alerts already group by, then the most even split. */
export const rankGroup = (
  candidates: string[],
  shapes: readonly FieldShape[],
  orgUse: ReadonlyMap<string, number> = new Map(),
): Ranked =>
  byShape(
    candidates,
    shapes,
    (s) =>
      isCategory(s, GROUP_MIN_COVERAGE, GROUP_MIN_DISTINCT) && (s.topShare ?? 0) < MAJORITY_SHARE,
    (a, b) =>
      Number(b.coverage >= GROUP_FULL_COVERAGE) - Number(a.coverage >= GROUP_FULL_COVERAGE) ||
      (orgUse.get(b.name) ?? 0) - (orgUse.get(a.name) ?? 0) ||
      byEntropy(a, b),
  );

const tailRatio = (s: FieldShape) =>
  s.p50 !== undefined && s.p99 !== undefined && s.p50 > 0 ? s.p99 / s.p50 : 0;

/** Heavy-tailed numbers first (p99 at least 5 times p50), the heaviest leading. */
export const rankMeasure = (candidates: string[], shapes: readonly FieldShape[]): Ranked =>
  byShape(
    candidates,
    shapes,
    (s) => s.coverage >= MEASURE_MIN_COVERAGE && tailRatio(s) >= HEAVY_TAIL_RATIO,
    (a, b) => tailRatio(b) - tailRatio(a),
  );

const spellingOf = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x.startsWith(y) || y.startsWith(x);
};

/** Minority values (the other side of a 60 % majority) that are not a spelling of the majority, largest
 * first, those seen in `recent` ahead so the preview has something to show. */
function starterCandidates(
  values: readonly ValueCount[],
  recent: readonly ValueCount[],
): ValueCount[] {
  const seen = values.filter((v) => v.value !== "" && v.count > 0);
  const total = seen.reduce((sum, v) => sum + v.count, 0);
  if (seen.length < 2 || !total) return [];
  const [top, ...rest] = [...seen].sort((a, b) => b.count - a.count);
  const minority = rest.filter(
    (v) => v.count / total <= 1 - MAJORITY_SHARE && !spellingOf(v.value, top.value),
  );
  const isRecent = (v: ValueCount) => recent.some((r) => r.value === v.value && r.count > 0);
  return [...minority.filter(isRecent), ...minority.filter((v) => !isRecent(v))];
}

/** The largest minority that is not a spelling of the majority, preferring values seen in `recent`. */
export function starterValue(
  values: readonly ValueCount[],
  recent: readonly ValueCount[] = [],
): string | undefined {
  return starterCandidates(values, recent)[0]?.value;
}

/** The runner-up when the data cannot tell it from the starter value (within 10 %), offered as a swap. */
export function starterAlternative(
  values: readonly ValueCount[],
  recent: readonly ValueCount[] = [],
): string | undefined {
  const [first, second] = starterCandidates(values, recent);
  return first && second && second.count >= NEAR_TIE * first.count ? second.value : undefined;
}

/** Other spellings of the picked values in the data (WARN beside Warning), not yet picked. */
export function spellingVariants(picked: readonly string[], seen: readonly ValueCount[]): string[] {
  return seen
    .map((v) => v.value)
    .filter((v) => v !== "" && !picked.includes(v))
    .filter((v) => picked.some((p) => Math.min(p.length, v.length) >= 3 && spellingOf(p, v)));
}

/** A picker's new values and suggestion: a first pick replaces a suggestion; an emit that changes
 * nothing (a re-select) keeps the suggestion, so the next pick still replaces it. */
export function pickedValues(
  picked: readonly string[],
  previous: readonly string[],
  seeded: readonly string[],
): { values: string[]; seeded: string[] } {
  const same = picked.length === previous.length && picked.every((v) => previous.includes(v));
  if (same) return { values: [...previous], seeded: [...seeded] };
  const added = picked.some((v) => !previous.includes(v));
  return { values: picked.filter((v) => !added || !seeded.includes(v)), seeded: [] };
}

/** The picked values plus every seen value that differs from one only in case. */
export function withCaseVariants(picked: readonly string[], seen: readonly ValueCount[]): string[] {
  const lower = new Set(picked.map((v) => v.toLowerCase()));
  const variants = seen.map((v) => v.value).filter((v) => lower.has(v.toLowerCase()));
  return [...new Set([...picked, ...variants])];
}

/** Whether two seen values differ only in case, so a pick there also adds the other spelling. */
export function hasCaseVariants(seen: readonly ValueCount[]): boolean {
  const lower = seen.map((v) => v.value.toLowerCase());
  return new Set(lower).size < lower.length;
}

const engineCondition = (field: string, values: string[], id: string) => ({
  filterType: "condition",
  column: field,
  operator: values.length > 1 ? "in" : "=",
  value: values.length > 1 ? [...values] : (values[0] ?? ""),
  values: [],
  logicalOperator: "AND",
  id,
});

/** The builder's filter tree for "field is value(s)"; empty when no field is chosen. */
export function conditionsFor(slots: IntentSlots, id: () => string) {
  const values = (slots.values ?? []).filter((v) => v !== "");
  return {
    filterType: "group",
    logicalOperator: "AND",
    groupId: id(),
    conditions: slots.field && values.length ? [engineCondition(slots.field, values, id())] : [],
  };
}

const groupAggregation = (
  fn: string,
  column: string,
  group: string | undefined,
  having: { operator: string; value: unknown },
) => ({
  function: fn,
  having: { column, operator: having.operator, value: having.value },
  group_by: group ? [group] : [],
  multi_alert: !!group,
});

/** A logs/traces intent as the values it writes; value and per-group count thresholds stay empty for
 * the user to type, so nothing reads as firing at a number nobody chose. */
export function buildEventFill(
  intent: IntentId,
  slots: IntentSlots,
  ctx: { stream: string; id: () => string },
): IntentFill {
  const conditions = conditionsFor(slots, ctx.id);
  const filters = {
    "query_condition.type": "custom",
    "query_condition.conditions": conditions,
    "query_condition.multi_time_range": [],
    "query_condition.vrl_function": null,
  };
  if (intent === "percentile") {
    const measure = slots.measure ?? "";
    return {
      intent,
      howItChecks: "false",
      aggregation: true,
      vrl: false,
      values: {
        ...filters,
        "query_condition.aggregation": groupAggregation("p95", measure, slots.group, {
          operator: ">",
          value: "",
        }),
        logGroupBy: slots.group ? [slots.group] : [],
      },
    };
  }
  if (intent === "anyEvent") {
    return {
      intent,
      howItChecks: "true",
      aggregation: false,
      vrl: false,
      values: {
        ...filters,
        "trigger_condition.operator": ">=",
        "trigger_condition.threshold": 1,
      },
    };
  }
  if (intent === "unusualVolume") {
    return {
      intent,
      howItChecks: "anomaly",
      aggregation: false,
      vrl: false,
      values: {},
      anomaly: {
        query_mode: "filters",
        detection_function: "count",
        detection_function_field: "",
        filters: anomalyFilterRows(slots),
        ...anomalySchedule(),
      },
    };
  }
  if (intent === "compareLastWeek") {
    return {
      intent,
      howItChecks: "false",
      aggregation: false,
      vrl: true,
      values: {
        "query_condition.type": "sql",
        "query_condition.sql": compareSql(ctx.stream, slots),
        "query_condition.multi_time_range": [{ offSet: "1w", uuid: ctx.id() }],
        "query_condition.vrl_function": compareFunction(slots.factor ?? DEFAULT_FACTOR),
        "trigger_condition.operator": ">=",
        "trigger_condition.threshold": 1,
      },
    };
  }
  // countWhere: a count per group needs a measure, so grouping counts the group field.
  const group = slots.group;
  return {
    intent,
    howItChecks: "false",
    aggregation: !!group,
    vrl: false,
    values: {
      ...filters,
      "query_condition.aggregation": group
        ? groupAggregation("count", group, group, { operator: ">", value: "" })
        : null,
      logGroupBy: group ? [group] : [],
    },
  };
}

/** Checks once per bucket, so an unusual bucket waits at most one bucket, over the window the anomaly
 * form recommends for that schedule: twice (check + bucket) plus the 10-minute absence allowance. */
export function anomalySchedule(bucketMinutes = ANOMALY_BUCKET_MINUTES) {
  const recommended = 2 * (bucketMinutes + bucketMinutes) + 10;
  return {
    histogram_interval_value: bucketMinutes,
    histogram_interval_unit: "m" as AnomalyIntervalUnit,
    schedule_interval_value: bucketMinutes,
    schedule_interval_unit: "m" as AnomalyIntervalUnit,
    detection_window_value: Math.ceil(recommended / bucketMinutes) * bucketMinutes,
    detection_window_unit: "m" as AnomalyIntervalUnit,
  };
}

/** The anomaly builder's filter rows for "field is value(s)"; none when no field or value is chosen. */
export function anomalyFilterRows(slots: IntentSlots) {
  const values = (slots.values ?? []).filter((v) => v !== "");
  if (!slots.field || !values.length) return [];
  return values.length === 1
    ? [{ field: slots.field, operator: "=", value: values[0] }]
    : [{ field: slots.field, operator: "IN", value: values.map(quoteText).join(", ") }];
}

const COMPARE_ALIAS = "events";
const COMPARE_ALL_ALIAS = "all_events";

/** The comparison's query, run once for now and once for each past window: the matching count, and
 * with a filter also the stream's whole count, so a past window with no events reads apart from zero matches. */
export function compareSql(stream: string, slots: IntentSlots): string {
  const values = (slots.values ?? []).filter((v) => v !== "");
  const from = quoteId(stream);
  if (!slots.field || !values.length) return `SELECT count(*) AS ${COMPARE_ALIAS} FROM ${from}`;
  const match = `${quoteId(slots.field)} ${
    values.length > 1 ? `IN (${values.map(quoteText).join(", ")})` : `= ${quoteText(values[0])}`
  }`;
  return `SELECT count(*) FILTER (WHERE ${match}) AS ${COMPARE_ALIAS}, count(*) AS ${COMPARE_ALL_ALIAS} FROM ${from}`;
}

const factorText = (f: number) => (Number.isInteger(f) ? f.toFixed(1) : String(f));

// The past window held events of any kind: zero matches over a busy stream is a baseline, an empty stream is not.
// A query without the whole count falls back to its matches.
const COMPARE_HISTORY_LINE = `history = to_float(get(., [1, 0, "${COMPARE_ALL_ALIAS}"]) ?? 0) ?? 0.0`;
const COMPARE_HISTORY_TEST = "(previous > 0.0 || history > 0.0) && ";

/** `#ResultArray#` gets one result array per window, now first; the alert fires on the rows it
 * returns, so it returns one only when now beats the past by the factor. Ends on `.` as saved. */
export function compareFunction(factor: number, needsBaseline = false): string {
  const f = Number.isFinite(factor) && factor > 0 ? factor : DEFAULT_FACTOR;
  return [
    "#ResultArray#",
    `current = to_float(get(., [0, 0, "${COMPARE_ALIAS}"]) ?? 0) ?? 0.0`,
    `previous = to_float(get(., [1, 0, "${COMPARE_ALIAS}"]) ?? 0) ?? 0.0`,
    ...(needsBaseline ? [COMPARE_HISTORY_LINE] : []),
    `. = if current > 0.0 && ${needsBaseline ? COMPARE_HISTORY_TEST : ""}current > previous * ${factorText(f)} { [[{"${COMPARE_ALIAS}": current, "previous": previous}]] } else { [[]] }`,
    ".",
  ].join("\n");
}

/** The factor and baseline rule of a function `compareFunction` wrote, with or without the `.`
 * the server appends; undefined for any other function. */
export function compareRule(
  vrl: string | null | undefined,
): { factor: number; needsBaseline: boolean } | undefined {
  const bare = (text: string) =>
    text
      .trim()
      .replace(/\n\s*\.$/, "")
      .trim();
  const factor = Number(/previous \* ([\d.]+) \{/.exec(vrl ?? "")?.[1]);
  if (!(factor > 0)) return undefined;
  const needsBaseline = (vrl ?? "").includes(COMPARE_HISTORY_TEST);
  return bare(vrl ?? "") === bare(compareFunction(factor, needsBaseline))
    ? { factor, needsBaseline }
    : undefined;
}

export function compareFactor(vrl: string | null | undefined): number | undefined {
  return compareRule(vrl)?.factor;
}

/** A metric as a PromQL query; a counter only ever grows, so it reads as its per-second rate. */
export function metricPromql(
  metric: string,
  opts: { counter: boolean; group?: string; windowMinutes: number },
): string {
  const window = `${Math.max(1, Math.round(opts.windowMinutes))}m`;
  const read = opts.counter ? `rate(${metric}[${window}])` : metric;
  if (!opts.group) return read;
  return `${opts.counter ? "sum" : "avg"} by (${opts.group}) (${read})`;
}

/** A metric intent as the values it writes. */
export function buildMetricFill(
  intent: IntentId,
  slots: IntentSlots & { metric: string; family?: MetricFamilyMember[]; counter?: boolean },
  ctx: { periodMinutes: number },
): IntentFill {
  if (intent === "unusualChange") {
    return {
      intent,
      howItChecks: "anomaly",
      aggregation: false,
      vrl: false,
      values: {},
      anomaly: {
        query_mode: "filters",
        detection_function: "avg",
        detection_function_field: "value",
        ...anomalySchedule(),
      },
    };
  }
  if (intent === "promql" || (intent === "metricAbove" && slots.counter)) {
    return {
      intent,
      howItChecks: "false",
      aggregation: false,
      vrl: false,
      values: {
        "query_condition.type": "promql",
        "query_condition.promql": metricPromql(slots.metric, {
          counter: !!slots.counter,
          group: slots.group,
          windowMinutes: ctx.periodMinutes,
        }),
        "query_condition.promql_condition": { column: "value", operator: ">", value: "" },
        "query_condition.promql_multi_alert": !!slots.group,
      },
    };
  }
  if (intent === "ratio") {
    return {
      intent,
      howItChecks: "false",
      aggregation: false,
      vrl: false,
      values: {
        "query_condition.type": "promql",
        "query_condition.promql": ratioPromql({
          members: slots.family?.length
            ? slots.family
            : [{ metric: slots.metric, labels: slots.label ? [slots.label] : [], whole: true }],
          values: slots.values ?? [],
          patterns: slots.patterns,
          group: slots.group,
          counter: slots.counter ?? true,
          windowMinutes: ctx.periodMinutes,
        }),
        "query_condition.promql_condition": { column: "value", operator: ">", value: "" },
        "query_condition.promql_multi_alert": !!slots.group,
      },
    };
  }
  return {
    intent,
    howItChecks: "false",
    aggregation: true,
    vrl: false,
    values: {
      "query_condition.type": "custom",
      "query_condition.aggregation": groupAggregation("avg", "value", slots.group, {
        operator: ">",
        value: "",
      }),
    },
  };
}

const nameTokens = (name: string) =>
  name
    .toLowerCase()
    .split(/[_:.]+/)
    .filter(Boolean);
const subsetOf = (a: string[], b: string[]) => a.every((x) => b.includes(x));
const relatedNames = (a: string, b: string) => {
  const [x, y] = [nameTokens(a), nameTokens(b)];
  return x.length > 0 && y.length > 0 && (subsetOf(x, y) || subsetOf(y, x));
};

const familyParts = (stream: MetricStreamInfo) => {
  const base = stream.metrics_meta?.metric_family_name || stream.name;
  const member = stream.name.startsWith(base) ? stream.name.slice(base.length) : "";
  return { base, member, type: stream.metrics_meta?.metric_type ?? "" };
};

/** Metrics measuring the same thing under another naming generation: same type, member and first
 * word, and one name's words contained in the other's. */
export function metricFamilySiblings(
  picked: MetricStreamInfo,
  streams: readonly MetricStreamInfo[],
): string[] {
  const own = familyParts(picked);
  const first = nameTokens(own.base)[0];
  return streams
    .filter((s) => s.name !== picked.name)
    .filter((s) => {
      const other = familyParts(s);
      return (
        other.member === own.member &&
        other.type === own.type &&
        nameTokens(other.base)[0] === first &&
        relatedNames(own.base, other.base)
      );
    })
    .map((s) => s.name);
}

/** How a metric's series spell a label: the label itself, then related names that never sit on one
 * series with a spelling already taken (a naming generation renames, it does not add). */
export function familyMember(
  label: string,
  series: readonly SeriesLabels[],
): Omit<MetricFamilyMember, "metric"> | undefined {
  const carries = (one: SeriesLabels, name: string) => one[name] !== undefined;
  const coverage = (name: string) => series.filter((one) => carries(one, name)).length;
  const names = [...new Set(series.flatMap((one) => Object.keys(one)))];
  const related = names
    .filter((name) => name !== label && relatedNames(label, name))
    .sort((a, b) => coverage(b) - coverage(a));
  const labels: string[] = names.includes(label) ? [label] : [];
  for (const name of related)
    if (!series.some((one) => carries(one, name) && labels.some((l) => carries(one, l))))
      labels.push(name);
  if (!labels.length) return undefined;
  return { labels, whole: series.every((one) => labels.some((l) => carries(one, l))) };
}

/** Candidate labels grouped with their other spellings, each group once, in candidate order. */
export function labelSpellings(
  candidates: readonly string[],
  series: readonly SeriesLabels[],
): string[][] {
  const taken = new Set<string>();
  return candidates.flatMap((name) => {
    if (taken.has(name)) return [];
    const spellings = familyMember(name, series)?.labels ?? [name];
    spellings.forEach((l) => taken.add(l));
    return [spellings];
  });
}

/** Label names of a metric's series, each with its distinct values and the share of series carrying it. */
export function labelProfile(series: readonly SeriesLabels[]) {
  const profile = new Map<string, { values: Map<string, number>; series: number }>();
  for (const one of series) {
    for (const [label, value] of Object.entries(one)) {
      if (label === "__name__" || label.startsWith("_")) continue;
      const entry = profile.get(label) ?? { values: new Map(), series: 0 };
      entry.series += 1;
      entry.values.set(value, (entry.values.get(value) ?? 0) + 1);
      profile.set(label, entry);
    }
  }
  return [...profile.entries()].map(([label, entry]) => ({
    label,
    coverage: series.length ? entry.series / series.length : 0,
    values: [...entry.values.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  }));
}

/** How strongly a label names the metric's own entity: the rarer name words it shares with the metric
 * (pod in k8s_pod_name for k8s_pod_memory_*), never a word most labels carry. */
const entityScore = (metric: string, label: string, labels: readonly string[]): number => {
  const own = new Set(nameTokens(metric));
  const carriers = (token: string) => labels.filter((l) => nameTokens(l).includes(token)).length;
  return nameTokens(label)
    .filter((token) => own.has(token))
    .map((token) => carriers(token))
    .filter((n) => n > 0 && n <= Math.max(2, ENTITY_TOKEN_MAX_SHARE * labels.length))
    .reduce((score, n) => score + 1 / n, 0);
};

// A host name built from an IP (ip-10-2-184-232.ec2.internal) is digit-heavy but still names a thing; ids never
// carry an all-letter part outside a-f.
const namesThing = (v: string) =>
  isWord(v) ||
  v.split(/[^a-z0-9]+/i).some((part) => /^[a-z]{2,}$/i.test(part) && /[g-z]/i.test(part));

const wordValues = (p: ReturnType<typeof labelProfile>[number]) => {
  const total = p.values.reduce((sum, v) => sum + v.count, 0);
  const words = p.values.filter((v) => namesThing(v.value)).reduce((sum, v) => sum + v.count, 0);
  return total > 0 && words / total >= MIN_WORD_SHARE;
};

/** Labels ranked for "per [label]": carried by nearly every series; a word-valued label naming the
 * metric's entity first (whatever its count), then the org's own group-bys, then more values first. */
export function rankMetricGroup(
  profile: ReturnType<typeof labelProfile>,
  opts: { metric?: string; orgUse?: ReadonlyMap<string, number> } = {},
): Ranked {
  const labels = profile.map((p) => p.label);
  const entity = (p: (typeof profile)[number]) =>
    opts.metric && wordValues(p) ? entityScore(opts.metric, p.label, labels) : 0;
  const use = (p: (typeof profile)[number]) => opts.orgUse?.get(p.label) ?? 0;
  const fit = profile
    .filter(
      (p) =>
        p.coverage >= CATEGORY_MIN_COVERAGE &&
        p.values.length >= 2 &&
        (p.values.length <= GROUP_MAX_DISTINCT || entity(p) > 0),
    )
    .sort(
      (a, b) =>
        entity(b) - entity(a) ||
        use(b) - use(a) ||
        b.coverage - a.coverage ||
        b.values.length - a.values.length,
    )
    .map((p) => p.label);
  return ranked(fit, labels);
}

type GroupedAlertRow = {
  condition?: {
    sql?: string | null;
    promql?: string | null;
    aggregation?: { group_by?: readonly (string | null)[] | null } | null;
  } | null;
};

/** How many of the org's alerts group by each field or label, whatever their stream. */
export function orgGroupUse(rows: readonly GroupedAlertRow[]): Map<string, number> {
  const use = new Map<string, number>();
  for (const row of rows) {
    const c = row.condition;
    const names = new Set([
      ...(c?.aggregation?.group_by ?? []).filter((g): g is string => !!g),
      ...(c?.sql ? sqlGroupByLabels(c.sql) : []),
      ...(c?.promql ? promqlByLabels(c.promql) : []),
    ]);
    names.forEach((name) => use.set(name, (use.get(name) ?? 0) + 1));
  }
  return use;
}

const seriesTopShare = (p: ReturnType<typeof labelProfile>[number]) => {
  const total = p.values.reduce((sum, v) => sum + v.count, 0);
  return total ? (p.values[0]?.count ?? 0) / total : 0;
};

/** Labels ranked for "where [label] matches": few values, a majority of series beside a minority, on
 * nearly every series, never one the group already fixes (each group's share would be 0 or 100 %). */
export function rankMetricCategory(
  profile: ReturnType<typeof labelProfile>,
  opts: { group?: string; series?: readonly SeriesLabels[] } = {},
): Ranked {
  const { group, series = [] } = opts;
  const fit = profile
    .filter(
      (p) =>
        p.coverage >= CATEGORY_MIN_COVERAGE &&
        p.values.length >= 2 &&
        p.values.length <= CATEGORY_MAX_DISTINCT &&
        seriesTopShare(p) >= MAJORITY_SHARE &&
        (!group || fixedByGroup(series, p.label, group) < FIXED_BY_GROUP),
    )
    .sort((a, b) => seriesTopShare(b) - seriesTopShare(a) || b.coverage - a.coverage)
    .map((p) => p.label);
  return ranked(
    fit,
    profile.map((p) => p.label),
  );
}

const DIGIT_PATTERN = /^(?=.*\d)(?=.*x)[\dx]+$/i;
const DIGIT_REGEX = /^(?=.*\d)(?=.*\.)[\d.]+$/;

/** A typed "5xx" as the label regex it stands for, one character per x; a value the series
 * really carry, or any other text, stays as typed. */
export const labelPattern = (typed: string, seen: readonly string[]): string =>
  DIGIT_PATTERN.test(typed) && !seen.includes(typed) ? typed.replace(/x/gi, ".") : typed;

/** A pattern read back the way it was typed: "5.." as "5xx"; a literal value reads as itself. */
export const patternText = (value: string, patterns: readonly string[] = []): string =>
  patterns.includes(value) && DIGIT_REGEX.test(value) ? value.replace(/\./g, "x") : value;

const regexLiteral = (value: string) => value.replace(/[\\.+*?()|[\]{}^$]/g, "\\$&");
const promLabelValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The matching share in percent, summed over every family member so a group reporting under either
 * name is covered; `or` keeps both members' series apart before the sum. */
export function ratioPromql(input: {
  members: MetricFamilyMember[];
  values: string[];
  patterns?: readonly string[];
  group?: string;
  counter: boolean;
  windowMinutes: number;
}): string {
  const window = `${Math.max(1, Math.round(input.windowMinutes))}m`;
  const pattern = input.values
    .filter(Boolean)
    .map((v) => promLabelValue(input.patterns?.includes(v) ? v : regexLiteral(v)))
    .join("|");
  const rate = (selector: string) => (input.counter ? `rate(${selector}[${window}])` : selector);
  // A series carrying none of the spellings cannot be split, so it stays out of the denominator too.
  const reads = (m: MetricFamilyMember, filtered: boolean) => {
    if (!m.labels.length || (!filtered && m.whole)) return [rate(m.metric)];
    const match = filtered ? pattern : ".+";
    return m.labels.map((label) => rate(`${m.metric}{${label}=~"${match}"}`));
  };
  const sum = (filtered: boolean) => {
    const inner = input.members.flatMap((m) => reads(m, filtered)).join(" or ");
    return `sum${input.group ? ` by (${input.group})` : ""} (${inner})`;
  };
  return `${sum(true)} / ${sum(false)} * 100`;
}

/** True for counters and histogram/summary members, which are read as a rate. */
export const isCounterLike = (stream: MetricStreamInfo | undefined): boolean =>
  (stream?.metrics_meta?.metric_type ?? "counter").toLowerCase() !== "gauge";

/** Cards fold to one line once the org runs this many alerts; an unknown count keeps them open. */
export const cardsFolded = (orgAlertCount: number | undefined): boolean =>
  orgAlertCount !== undefined && orgAlertCount >= CARDS_FOLD_AT;
