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
import type { SeriesLabels } from "./promqlNoSeries";

export type IntentId =
  | "countWhere"
  | "percentile"
  | "anyEvent"
  | "unusualVolume"
  | "compareLastWeek"
  | "metricAbove"
  | "ratio"
  | "unusualChange";

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
  /** Share of sampled events holding the field's most common value. */
  topShare?: number;
  /** Share of sampled values that read as words rather than numbers, times or addresses. */
  wordShare?: number;
  p50?: number;
  p99?: number;
}

export interface IntentSlots {
  field?: string;
  values?: string[];
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

/** A metric that reads the same thing under other names, with its own spelling of the labels. */
export interface MetricFamilyMember {
  metric: string;
  label: string;
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
export const METRIC_INTENTS: readonly IntentId[] = ["metricAbove", "ratio", "unusualChange"];
const ANOMALY_INTENTS = new Set<IntentId>(["unusualVolume", "unusualChange"]);

/** Fields asked about in the one shape search; a wider stream ranks its first ones only. */
export const SHAPE_STRING_CAP = 24;
export const SHAPE_NUMBER_CAP = 8;
export const SHAPE_WINDOW_US = 60 * 60 * 1_000_000;
/** The org alert count from which cards fold to one line (D-PO5). */
export const CARDS_FOLD_AT = 10;
export const DEFAULT_FACTOR = 2;

// Value-shape bounds from the starter design (phase2 §2.5).
const CATEGORY_MAX_DISTINCT = 20;
const GROUP_MAX_DISTINCT = 200;
const CATEGORY_MIN_COVERAGE = 0.9;
const MEASURE_MIN_COVERAGE = 0.5;
const HEAVY_TAIL_RATIO = 5;
const RARE_SHARE = 0.05;
const MIN_WORD_SHARE = 0.8;

/** Intents offered for a stream type; the "unusual" ones only where anomaly detection is usable. */
export function intentsFor(streamType: string, opts: { anomaly: boolean }): IntentId[] {
  const all = streamType === "metrics" ? METRIC_INTENTS : EVENT_INTENTS;
  return all.filter((id) => opts.anomaly || !ANOMALY_INTENTS.has(id));
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

/** One aggregate search giving coverage and distinct count per string field and p50/p99 per number field. */
export function shapeQuerySql(stream: string, strings: string[], numbers: string[]): string {
  const parts = ['count(*) AS "t"'];
  strings.forEach((f, i) =>
    parts.push(`count(${quoteId(f)}) AS "c${i}"`, `approx_distinct(${quoteId(f)}) AS "d${i}"`),
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

const topShare = (rows: readonly Record<string, unknown>[], field: string): number | undefined => {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    total += 1;
    counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }
  return total ? Math.max(...counts.values()) / total : undefined;
};

const WORD_DIGIT_SHARE = 0.3;
const wordShare = (rows: readonly Record<string, unknown>[], field: string): number | undefined => {
  const values = rows
    .map((row) => row[field])
    .filter((v) => v !== undefined && v !== null && v !== "")
    .map(String);
  if (!values.length) return undefined;
  const wordy = values.filter((v) => (v.match(/\d/g)?.length ?? 0) / v.length < WORD_DIGIT_SHARE);
  return wordy.length / values.length;
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
    ...strings.map((name, i) => ({
      name,
      kind: "string" as const,
      coverage: share(row?.[`c${i}`]),
      present: num(row?.[`c${i}`]) ?? 0,
      distinct: num(row?.[`d${i}`]),
      topShare: topShare(sample, name),
      wordShare: wordShare(sample, name),
    })),
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

const byShape = (
  candidates: string[],
  shapes: readonly FieldShape[],
  qualifies: (s: FieldShape) => boolean,
  order: (a: FieldShape, b: FieldShape) => number,
): string[] => {
  const known = new Map(shapes.map((s) => [s.name, s]));
  const fit = candidates
    .map((name) => known.get(name))
    .filter((s): s is FieldShape => !!s && qualifies(s))
    .sort(order)
    .map((s) => s.name);
  return [...fit, ...candidates.filter((name) => !fit.includes(name))];
};

/** Categories first: a handful of word values on nearly every event, the most lopsided leading, since a
 * dominant value with rare others is what an alert watches; then the rest in the order given. */
export const rankCategory = (candidates: string[], shapes: readonly FieldShape[]): string[] =>
  byShape(
    candidates,
    shapes,
    (s) =>
      s.coverage >= CATEGORY_MIN_COVERAGE &&
      (s.distinct ?? 0) >= 2 &&
      (s.distinct ?? 0) <= CATEGORY_MAX_DISTINCT &&
      (s.wordShare ?? 1) >= MIN_WORD_SHARE,
    (a, b) => (b.topShare ?? 0) - (a.topShare ?? 0) || (a.distinct ?? 0) - (b.distinct ?? 0),
  );

// A group names things (words, not numbers or times), repeats across events and spreads them evenly;
// the most even one leads, the fewer values on a tie.
export const rankGroup = (candidates: string[], shapes: readonly FieldShape[]): string[] =>
  byShape(
    candidates,
    shapes,
    (s) =>
      s.coverage >= CATEGORY_MIN_COVERAGE &&
      (s.distinct ?? 0) >= 2 &&
      (s.distinct ?? 0) <= GROUP_MAX_DISTINCT &&
      (s.distinct ?? 0) * 2 <= s.present &&
      (s.wordShare ?? 1) >= MIN_WORD_SHARE,
    (a, b) => (a.topShare ?? 1) - (b.topShare ?? 1) || (a.distinct ?? 0) - (b.distinct ?? 0),
  );

const tailRatio = (s: FieldShape) =>
  s.p50 !== undefined && s.p99 !== undefined && s.p50 > 0 ? s.p99 / s.p50 : 0;

/** Heavy-tailed numbers first (p99 at least 5 times p50), the heaviest leading. */
export const rankMeasure = (candidates: string[], shapes: readonly FieldShape[]): string[] =>
  byShape(
    candidates,
    shapes,
    (s) => s.coverage >= MEASURE_MIN_COVERAGE && tailRatio(s) >= HEAVY_TAIL_RATIO,
    (a, b) => tailRatio(b) - tailRatio(a),
  );

/** The rarest value under 5 % of the counted events, else the least frequent one. */
export function rareValue(values: readonly ValueCount[]): string | undefined {
  const seen = values.filter((v) => v.value !== "" && v.count > 0);
  const total = seen.reduce((sum, v) => sum + v.count, 0);
  if (!seen.length || !total) return undefined;
  const ascending = [...seen].sort((a, b) => a.count - b.count);
  return (ascending.find((v) => v.count / total < RARE_SHARE) ?? ascending[0]).value;
}

/** The picked values plus every seen value that differs from one only in case. */
export function withCaseVariants(picked: readonly string[], seen: readonly ValueCount[]): string[] {
  const lower = new Set(picked.map((v) => v.toLowerCase()));
  const variants = seen.map((v) => v.value).filter((v) => lower.has(v.toLowerCase()));
  return [...new Set([...picked, ...variants])];
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

/** A logs/traces intent as the values it writes; value thresholds stay empty for the user to type. */
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
      anomaly: { query_mode: "filters", detection_function: "count", detection_function_field: "" },
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
        ? groupAggregation("count", group, group, { operator: ">=", value: 1 })
        : null,
      logGroupBy: group ? [group] : [],
    },
  };
}

const COMPARE_ALIAS = "events";

/** The comparison's query: one count, run once for now and once for each past window. */
export function compareSql(stream: string, slots: IntentSlots): string {
  const values = (slots.values ?? []).filter((v) => v !== "");
  const where =
    slots.field && values.length
      ? ` WHERE ${quoteId(slots.field)} ${
          values.length > 1
            ? `IN (${values.map(quoteText).join(", ")})`
            : `= ${quoteText(values[0])}`
        }`
      : "";
  return `SELECT count(*) AS ${COMPARE_ALIAS} FROM ${quoteId(stream)}${where}`;
}

/** `#ResultArray#` gets one result array per window, now first; the alert fires on the rows it
 * returns, so it returns one only when now beats the past by the factor. */
export function compareFunction(factor: number): string {
  const f = Number.isFinite(factor) && factor > 0 ? factor : DEFAULT_FACTOR;
  return [
    "#ResultArray#",
    `current = to_float(get(., [0, 0, "${COMPARE_ALIAS}"]) ?? 0) ?? 0.0`,
    `previous = to_float(get(., [1, 0, "${COMPARE_ALIAS}"]) ?? 0) ?? 0.0`,
    `. = if current > 0.0 && current > previous * ${f.toFixed(1)} { [[{"${COMPARE_ALIAS}": current, "previous": previous}]] } else { [[]] }`,
  ].join("\n");
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
            : [{ metric: slots.metric, label: slots.label ?? "" }],
          values: slots.values ?? [],
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

/** A metric's own spelling of a label: the same name, else the one whose words contain or are contained in it. */
export function matchingLabel(label: string, labels: readonly string[]): string | undefined {
  if (labels.includes(label)) return label;
  const related = labels.filter((l) => relatedNames(label, l));
  return related.sort((a, b) => a.length - b.length)[0];
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

/** Labels ranked for "per [label]": carried by nearly every series, more values first. */
export function rankMetricGroup(profile: ReturnType<typeof labelProfile>): string[] {
  const fit = profile
    .filter(
      (p) =>
        p.coverage >= CATEGORY_MIN_COVERAGE &&
        p.values.length >= 2 &&
        p.values.length <= GROUP_MAX_DISTINCT,
    )
    .sort((a, b) => b.coverage - a.coverage || b.values.length - a.values.length)
    .map((p) => p.label);
  return [...fit, ...profile.map((p) => p.label).filter((l) => !fit.includes(l))];
}

/** Labels ranked for "where [label] matches": few values, on nearly every series. */
export function rankMetricCategory(profile: ReturnType<typeof labelProfile>): string[] {
  const fit = profile
    .filter(
      (p) =>
        p.coverage >= CATEGORY_MIN_COVERAGE &&
        p.values.length >= 2 &&
        p.values.length <= CATEGORY_MAX_DISTINCT,
    )
    .sort((a, b) => b.coverage - a.coverage || a.values.length - b.values.length)
    .map((p) => p.label);
  return [...fit, ...profile.map((p) => p.label).filter((l) => !fit.includes(l))];
}

const promLabelValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The matching share in percent, summed over every family member so a group reporting under either
 * name is covered; `or` keeps both members' series apart before the sum. */
export function ratioPromql(input: {
  members: MetricFamilyMember[];
  values: string[];
  group?: string;
  counter: boolean;
  windowMinutes: number;
}): string {
  const window = `${Math.max(1, Math.round(input.windowMinutes))}m`;
  const pattern = input.values.filter(Boolean).map(promLabelValue).join("|");
  const read = (m: MetricFamilyMember, filtered: boolean) => {
    const selector = filtered && m.label ? `${m.metric}{${m.label}=~"${pattern}"}` : m.metric;
    return input.counter ? `rate(${selector}[${window}])` : selector;
  };
  const sum = (filtered: boolean) => {
    const inner = input.members.map((m) => read(m, filtered)).join(" or ");
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
