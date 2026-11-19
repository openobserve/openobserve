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

import { getIntlLocale } from "@/locales";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { promqlByLabels, sqlGroupByLabels } from "./queryGroupLabels";

const NOUN_BY_STREAM: Record<string, I18nKey> = {
  logs: "alerts.verdict.events",
  metrics: "alerts.verdict.samples",
  traces: "alerts.verdict.spans",
};

const FORECAST_WINDOW_WORDS: Record<string, I18nKey> = {
  "6h": "alerts.forecast.window6h",
  "1d": "alerts.forecast.window1d",
  "2d": "alerts.forecast.window2d",
  "7d": "alerts.forecast.window7d",
};

const SHORT_UNIT_KEYS: Record<string, I18nKey> = {
  percent: "alerts.units.short.percent",
  seconds: "alerts.units.short.seconds",
  milliseconds: "alerts.units.short.milliseconds",
  microseconds: "alerts.units.short.microseconds",
  nanoseconds: "alerts.units.short.nanoseconds",
  bytes: "alerts.units.short.bytes",
  "bytes-per-sec": "alerts.units.short.bytesPerSec",
  "count-per-sec": "alerts.units.short.countPerSec",
};

const UNIT_WORD_KEYS: Record<string, I18nKey> = {
  seconds: "alerts.units.words.seconds",
  milliseconds: "alerts.units.words.milliseconds",
  microseconds: "alerts.units.words.microseconds",
  nanoseconds: "alerts.units.words.nanoseconds",
  bytes: "alerts.units.words.bytes",
};

const COUNT_KEYS: Record<string, I18nKey> = {
  ">=": "alerts.summary.plainEnglish.conditionAtLeast",
  ">": "alerts.summary.plainEnglish.conditionMoreThan",
  "<=": "alerts.summary.plainEnglish.conditionOrFewer",
  "<": "alerts.summary.plainEnglish.conditionFewer",
  "=": "alerts.summary.plainEnglish.conditionExactly",
  "==": "alerts.summary.plainEnglish.conditionExactly",
  "!=": "alerts.summary.plainEnglish.conditionNot",
};

const UNITLESS = new Set(["", "none", "short"]);

const SECONDS_PER = { day: 86400, hour: 3600, minute: 60 } as const;

const DURATION_UNITS: ReadonlyArray<readonly [I18nKey, number]> = [
  ["alerts.form.duration.days", SECONDS_PER.day],
  ["alerts.form.duration.hours", SECONDS_PER.hour],
  ["alerts.form.duration.minutes", SECONDS_PER.minute],
];

/** What an alert counts: events, samples or spans by stream type; rows for SQL; series for PromQL. */
export function dataNoun(
  streamType: string | undefined,
  mode: string | undefined,
  count: number,
  t: TranslateFn,
): I18nText {
  if (mode === "sql") return t("alerts.verdict.rows", count);
  if (mode === "promql") return t("alerts.verdict.series", count);
  return t(NOUN_BY_STREAM[streamType ?? ""] ?? "alerts.verdict.events", count);
}

/** A builder measure in words. A count counts events carrying its field, so counting a group's own
 * field reads as the group's events, never as a count of field values. */
export function measureWords(
  aggregation: { function?: string; having?: { column?: string } } | null | undefined,
  groups: readonly string[],
  streamType: string | undefined,
  t: TranslateFn,
): I18nText {
  const fn = aggregation?.function ?? "";
  const field = aggregation?.having?.column ?? "";
  if (fn !== "count") return t("alerts.verdict.measure", { fn, field });
  const noun = dataNoun(streamType, "custom", 2, t);
  return !field || groups.includes(field)
    ? t("alerts.verdict.eventCount", { noun })
    : t("alerts.verdict.eventCountWith", { noun, field });
}

/** A count test in words: "3+ events", "fewer than 3 events", "no events"; "1+" stays plural. */
export function countText(
  operator: string | undefined,
  threshold: unknown,
  noun: (count: number) => I18nText,
  t: TranslateFn,
): I18nText {
  const op = operator ?? "";
  const n = Number(threshold);
  // A count is a whole number, so "fewer than 1" can only mean none.
  if (op === "<" && n <= 1)
    return t("alerts.summary.plainEnglish.conditionNone", { noun: noun(2) });
  const one = n === 1 && op !== ">=";
  const params = { threshold, noun: noun(one ? 1 : 2) };
  return COUNT_KEYS[op]
    ? t(COUNT_KEYS[op], params)
    : t("alerts.summary.plainEnglish.conditionOther", { ...params, operator: op });
}

/** The side of the threshold an operator alerts on; "=" and "!=" have none. */
export const thresholdSide = (operator: string | undefined): "above" | "below" | null =>
  operator === ">=" || operator === ">"
    ? "above"
    : operator === "<=" || operator === "<"
      ? "below"
      : null;

/** A number as the reader's locale writes it; anything that is not a number is shown as typed. */
export const formatNumber = (value: unknown): I18nText => {
  const n = typeof value === "number" ? value : Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(n)) {
    return raw(String(value ?? ""));
  }
  return raw(new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 2 }).format(n));
};

/** A duration in sentences: "10 minutes", "2 hours". */
export const durationWords = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.sections.review.hours", { count: minutes / 60 }, minutes / 60)
    : t("alerts.sections.review.minutes", { count: minutes }, minutes);

/** The duration after "every": "minute", "10 minutes", "hour", so one never reads "every 1 minute". */
export const everyWords = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.sections.review.everyHours", { count: minutes / 60 }, minutes / 60)
    : t("alerts.sections.review.everyMinutes", { count: minutes }, minutes);

/** A list joined the reader's way: "A, B and C". */
export const joinList = (items: readonly string[]): I18nText =>
  raw(new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(items));

/** A forecast's trend window in words: "2 days". */
export const forecastWindowWords = (window: string | undefined, t: TranslateFn): I18nText => {
  const key = FORECAST_WINDOW_WORDS[window ?? ""];
  return key ? t(key) : raw(window ?? "");
};

/** A list of at most `max` names, the rest counted: "A, B, C, and 2 more". */
export const joinListMore = (items: readonly string[], t: TranslateFn, max = 3): I18nText => {
  if (items.length <= max) return joinList(items);
  const rest = items.length - max;
  return joinList([
    ...items.slice(0, max),
    t("alerts.copy.nMore", { count: formatNumber(rest) }, rest),
  ]);
};

/** Alternatives, at most `max`, the rest counted: "A, B, or 2 more". */
export const joinListOrMore = (items: readonly string[], t: TranslateFn, max = 3): I18nText => {
  const rest = items.length - max;
  const shown =
    rest > 0
      ? [...items.slice(0, max), t("alerts.copy.nMore", { count: formatNumber(rest) }, rest)]
      : items;
  return raw(new Intl.ListFormat(getIntlLocale(), { type: "disjunction" }).format(shown));
};

/**
 * A number with its unit: "90 %", "0.85 (85 %)", "500 ms". `unit` is a canonical id from
 * metricDefaults (`percent-1` is a 0-1 ratio) or a display glyph such as "°C".
 */
export function valueWithUnit(
  value: number,
  unit: string | undefined,
  t: TranslateFn,
  style: "short" | "words" = "short",
): I18nText {
  const id = unit ?? "";
  const shown = formatNumber(value);
  if (UNITLESS.has(id)) return shown;
  if (id === "percent-1")
    return t("alerts.units.short.ratio", { value: shown, percent: formatNumber(value * 100) });
  const wordKey = style === "words" ? UNIT_WORD_KEYS[id] : undefined;
  if (wordKey) return t(wordKey, { count: shown }, value);
  const shortKey = SHORT_UNIT_KEYS[id];
  if (shortKey) return t(shortKey, { value: shown });
  return t("alerts.units.short.custom", { value: shown, unit: raw(id) });
}

/** The words after "every" for any whole number of seconds: "minute", "90 seconds", "2 hours", "day". */
export function everyDuration(seconds: number, t: TranslateFn): I18nText {
  if (seconds > 0 && seconds % SECONDS_PER.day === 0) {
    const n = seconds / SECONDS_PER.day;
    return t("alerts.copy.everyDays", { count: n }, n);
  }
  if (seconds > 0 && seconds % SECONDS_PER.minute === 0) return everyWords(seconds / 60, t);
  return t("alerts.copy.everySeconds", { count: seconds }, seconds);
}

/** A duration in sentence words, in its largest whole unit: "90 seconds", "1 day". */
export function durationText(seconds: number, t: TranslateFn): I18nText {
  for (const [key, size] of DURATION_UNITS) {
    if (seconds > 0 && seconds % size === 0)
      return t(key, { count: seconds / size }, seconds / size);
  }
  return t("alerts.form.duration.seconds", { count: seconds }, seconds);
}

/** A duration for tight spots, rounded down to its largest unit: "12 s", "5 min", "3 h", "2 d". */
export function compactDuration(seconds: number, t: TranslateFn): I18nText {
  if (seconds >= SECONDS_PER.day)
    return t("alerts.copy.dayCompact", { count: Math.floor(seconds / SECONDS_PER.day) });
  if (seconds >= SECONDS_PER.hour)
    return t("alerts.form.preview.hrCompact", { count: Math.floor(seconds / SECONDS_PER.hour) });
  if (seconds >= SECONDS_PER.minute)
    return t("alerts.form.preview.minCompact", { count: Math.floor(seconds / SECONDS_PER.minute) });
  return t("alerts.copy.secCompact", { count: Math.max(0, Math.floor(seconds)) });
}

/** A count for tight spots, as the reader's locale shortens it: "22K", "1.3M". */
export const compactNumber = (value: number): I18nText =>
  raw(new Intl.NumberFormat(getIntlLocale(), { notation: "compact" }).format(value));

interface NotifyQueryCondition {
  type?: string;
  promql?: string;
  promql_multi_alert?: boolean;
  sql?: string;
  aggregation?: { multi_alert?: boolean; group_by?: readonly (string | null)[] } | null;
}

// Mirrors the scheduler's multi_alert_enabled(): each group keeps its own wait and last level.
const groupLabelsOf = (qc: NotifyQueryCondition | null | undefined): string[] | null => {
  if (!qc) return null;
  if (qc.type === "promql") return qc.promql_multi_alert ? promqlByLabels(qc.promql ?? "") : null;
  if (!qc.aggregation?.multi_alert) return null;
  if (qc.type === "sql") return sqlGroupByLabels(qc.sql ?? "");
  return (qc.aggregation.group_by ?? []).filter((f): f is string => !!f?.trim());
};

/** Whether each group (or series) notifies and repeats on its own. */
export const notifiesPerGroup = (qc: NotifyQueryCondition | null | undefined): boolean =>
  groupLabelsOf(qc) !== null;

/** The help lines of Notify at most every and Suppress repeats, and the short scope each wait covers. */
export function notifyHelp(
  qc: NotifyQueryCondition | null | undefined,
  t: TranslateFn,
): { remind: I18nText; suppress: I18nText; scope: I18nText | null } {
  const labels = groupLabelsOf(qc);
  const params = labels?.length ? { labels: joinListMore(labels, t) } : {};
  const [remind, suppress]: [I18nKey, I18nKey] = !labels
    ? ["alerts.form.remind.whileFiring", "alerts.alertSettings.suppressRepeatsHelp"]
    : labels.length
      ? ["alerts.form.remind.whileFiringEach", "alerts.alertSettings.suppressRepeatsHelpEach"]
      : [
          "alerts.form.remind.whileFiringEachSeries",
          "alerts.alertSettings.suppressRepeatsHelpEachSeries",
        ];
  const scope = !labels
    ? null
    : labels.length
      ? t("alerts.form.remind.per", params)
      : t("alerts.form.remind.perSeries");
  return { remind: t(remind, params), suppress: t(suppress, params), scope };
}
