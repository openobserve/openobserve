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
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillWarning,
} from "@/ts/interfaces/alertPrefill";
import {
  periodMinutesFromRange,
  sanitizeAlertNamePart,
  warn,
  type PrefillTimeRange,
} from "../alertPrefill";

export type TracesAlertMetric = "matches" | "rate" | "errors" | "duration";
export type TracesAlertPercentile = 0.5 | 0.95 | 0.99;

export interface TracesPrefillInput {
  streamName: string;
  /** WHERE fragment already resolved by resolveTracesFilter (µs durations, numeric span kinds). */
  filter: string;
  view: "traces" | "spans";
  metric: TracesAlertMetric;
  /** Duration only; defaults to 0.95. */
  percentile?: TracesAlertPercentile;
  datetime?: PrefillTimeRange | null;
}

export interface TracesSeedQuery {
  /** The metric without its threshold, to read the current value. */
  sql: string;
  /** Column of the seed row that holds the value to pass to buildPrefillFromTraces. */
  valueColumn: string;
}

/** A longer window turns every evaluation into a long percentile scan. */
export const TRACES_ALERT_MAX_PERIOD_MINUTES = 60;

const FREQUENCY_MINUTES = 5;
const SILENCE_MINUTES = 10;
const MIN_DURATION_SPANS = 20;
const SEED_HEADROOM = 1.5;

interface MetricShape {
  expr: string;
  alias: string;
  where: string;
  extraSelect: string;
  extraHaving: string;
}

const quoteStream = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const metricShape = (input: TracesPrefillInput): MetricShape => {
  const filter = input.filter?.trim() ?? "";
  const distinctTraces = input.view === "traces";
  const counter = distinctTraces ? "approx_distinct(trace_id)" : "count(*)";
  const plain = { where: filter, extraSelect: "", extraHaving: "" };

  switch (input.metric) {
    case "rate":
      return { ...plain, expr: counter, alias: distinctTraces ? "traces" : "spans" };
    case "errors": {
      const errorOnly = "span_status = 'ERROR'";
      return {
        ...plain,
        expr: counter,
        alias: "errors",
        where: filter ? `(${filter}) AND ${errorOnly}` : errorOnly,
      };
    }
    case "duration": {
      const p = input.percentile ?? 0.95;
      return {
        where: filter,
        expr: `approx_percentile_cont(duration, ${p})`,
        alias: `p${Math.round(p * 100)}_duration`,
        extraSelect: ", count(*) AS spans",
        extraHaving: ` AND count(*) >= ${MIN_DURATION_SPANS}`,
      };
    }
    default:
      return { ...plain, expr: "count(*)", alias: "matches" };
  }
};

const selectSql = (input: TracesPrefillInput, shape: MetricShape): string => {
  const where = shape.where ? ` WHERE ${shape.where}` : "";
  return `SELECT ${shape.expr} AS ${shape.alias}${shape.extraSelect} FROM ${quoteStream(input.streamName ?? "")}${where}`;
};

export const buildTracesSeedQuery = (input: TracesPrefillInput): TracesSeedQuery => {
  const shape = metricShape(input);
  return { sql: selectSql(input, shape), valueColumn: shape.alias };
};

/** The page range as the alert window, between the run frequency and TRACES_ALERT_MAX_PERIOD_MINUTES. */
export const tracesAlertPeriod = (
  datetime: PrefillTimeRange | null | undefined,
): { minutes: number; warnings: AlertPrefillWarning[] } => {
  const range = periodMinutesFromRange(datetime);
  const capped = range.minutes > TRACES_ALERT_MAX_PERIOD_MINUTES;
  // A window shorter than the run frequency would leave minutes between runs unchecked.
  const minutes = capped
    ? TRACES_ALERT_MAX_PERIOD_MINUTES
    : Math.max(range.minutes, FREQUENCY_MINUTES);
  const warnings = range.warnings
    .filter((w) => w.key !== "periodClamped")
    .map((w) => (w.params?.minutes === undefined ? w : { ...w, params: { ...w.params, minutes } }));
  if (capped) warnings.push(warn("tracesPeriodCapped", "warning", { minutes }));
  return { minutes, warnings };
};

const formatCount = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const formatMs = (micros: number): string => {
  const ms = micros / 1000;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: ms < 10 ? 2 : 0 }).format(ms);
};

const seedWarning = (
  input: TracesPrefillInput,
  minutes: number,
  seed: number,
  threshold: number,
): AlertPrefillWarning => {
  if (input.metric === "duration") {
    return warn("tracesSeedDuration", "info", {
      percentile: `p${Math.round((input.percentile ?? 0.95) * 100)}`,
      minutes,
      threshold: formatMs(threshold),
      current: formatMs(seed),
    });
  }
  const traces = input.view === "traces";
  const keyByMetric: Record<Exclude<TracesAlertMetric, "duration">, string> = {
    matches: "tracesSeedMatches",
    rate: traces ? "tracesSeedTraces" : "tracesSeedSpans",
    errors: traces ? "tracesSeedErrorTraces" : "tracesSeedErrorSpans",
  };
  return warn(keyByMetric[input.metric], "info", {
    minutes,
    threshold: formatCount(threshold),
    current: formatCount(seed),
  });
};

/** Pure; `seed` is the valueColumn read from buildTracesSeedQuery, or null when that read failed. */
export const buildPrefillFromTraces = (
  input: TracesPrefillInput,
  seed: number | null | undefined,
): AlertPrefill => {
  const warnings: AlertPrefillWarning[] = [];
  const streamName = input.streamName?.trim() ?? "";
  if (!streamName) warnings.push(warn("noStream", "blocking"));

  const known = typeof seed === "number" && Number.isFinite(seed) && seed >= 0;
  const current = known ? seed : 0;
  const threshold = Math.ceil(current * SEED_HEADROOM);

  const { minutes, warnings: periodWarnings } = tracesAlertPeriod(input.datetime);
  warnings.push(...periodWarnings);

  if (!known) warnings.push(warn("tracesSeedUnavailable", "warning"));
  else if (current === 0) warnings.push(warn("tracesNoMatches", "info"));
  warnings.push(seedWarning(input, minutes, current, threshold));
  warnings.push(warn("tracesStoredSpans", "info"));

  const shape = metricShape(input);
  const sql = `${selectSql(input, shape)} HAVING ${shape.expr} > ${threshold}${shape.extraHaving}`;

  return {
    version: ALERT_PREFILL_VERSION,
    source: "traces",
    sourceLabel: streamName || "traces",
    name: `traces_${sanitizeAlertNamePart(streamName, "stream")}_${shape.alias}`,
    streamType: "traces",
    streamName,
    queryType: "sql",
    sql,
    periodMinutes: minutes,
    frequencyMinutes: FREQUENCY_MINUTES,
    silenceMinutes: SILENCE_MINUTES,
    thresholdShape: "count",
    // The threshold lives in HAVING, so one returned row means it was crossed.
    triggerThreshold: 1,
    triggerOperator: ">=",
    warnings,
    meta: {
      metric: input.metric,
      view: input.view,
      percentile: input.metric === "duration" ? (input.percentile ?? 0.95) : null,
      valueColumn: shape.alias,
      seed: known ? seed : null,
      threshold,
    },
  };
};
