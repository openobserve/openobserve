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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { hasDeliveryTarget } from "./deliveryTarget";
import {
  countText,
  dataNoun,
  formatNumber,
  joinList,
  joinListMore,
  measureWords,
  thresholdSide,
  valueWithUnit,
} from "./alertCopy";
import { countRuleText } from "./countComparison";
import { describeFilterNode, filterSentenceParts } from "./filterSentence";
import {
  nameResolvedExpression,
  type CompositeChildDisplay,
} from "@/components/alerts/composite/expression";
import { FILTER_PROFILES } from "@/components/filterBar/filterProfiles";
import type { FilterGroup, FilterNode } from "@/utils/query/filterBar";

/** The slice of the alert form the plain-words sentences read. */
export interface ReadBackAlert {
  stream_name?: string;
  stream_type?: string;
  is_real_time?: string;
  destinations?: string[];
  workflows?: string[];
  oncall_team?: string | null;
  creates_incident?: boolean;
  pending_period_sec?: number | string | null;
  /** Seconds. */
  keep_firing_for?: number | string | null;
  notify_on_recovery?: boolean;
  suppress_repeats?: boolean;
  /** The builder's group-by for logs and traces; metrics keep theirs on `aggregation.group_by`. */
  logGroupBy?: string[];
  query_condition?: {
    type?: string;
    sql?: string;
    promql?: string;
    conditions?: unknown;
    vrl_function?: string | null;
    multi_time_range?: { offSet?: string }[] | null;
    promql_warning_value?: number | string | null;
    promql_rule_mode?: boolean;
    aggregation?: {
      multi_alert?: boolean;
      function?: string;
      group_by?: string[];
      warning_value?: number | string | null;
      having?: { column?: string; operator?: string; value?: number | string | null };
    } | null;
    promql_condition?: { operator?: string; value?: number | string | null } | null;
  };
  trigger_condition?: {
    operator?: string;
    threshold?: number | string | null;
    warning_threshold?: number | string | null;
    period?: number | string | null;
    frequency?: number | string | null;
    frequency_type?: string;
    cron?: string;
    silence?: number | string | null;
  };
}

/** The slice of a composite alert its plain-words sentence reads. */
export interface ReadBackCompositeAlert {
  destinations?: string[];
  workflows?: string[];
  oncall_team?: string | null;
  creates_incident?: boolean;
  pending_period_sec?: number | string | null;
  trigger_condition?: { silence?: number | string | null };
  composite_condition?: { expression?: string } | null;
  children?: CompositeChildDisplay[];
}

/** The preview's verdict; `count`/`label` are present when the verdict came from a counted gate. */
export interface PreviewVerdict {
  wouldTrigger: boolean;
  reason: string;
  count?: number;
  /** The server stopped counting at `count`, so there may be more. */
  atLeast?: boolean;
  label?: string;
  grouped?: boolean;
  /** How many groups the preview saw, so a per-group alert says how many of them fire. */
  total?: number;
  /** The measured aggregate of an ungrouped builder measure, when the preview computed one. */
  value?: number;
  /** The minutes a real-time count covers (the chart's range). */
  windowMinutes?: number;
}

const OPERATOR_SYMBOLS: Record<string, string> = {
  ">=": "≥",
  ">": ">",
  "<=": "≤",
  "<": "<",
  "=": "=",
  "==": "=",
  "!=": "≠",
};

/** Why a scheduled alert's condition cannot be read back as a rule yet. */
export type ConditionGap = "noQuery" | "fixQuery" | "noThreshold" | "fixLimit";

export const CONDITION_GAP_KEYS: Record<ConditionGap, I18nKey> = {
  noQuery: "alerts.saveModeDialog.noQuery",
  fixQuery: "alerts.sections.condition.fixQuery",
  noThreshold: "alerts.sections.condition.noThreshold",
  fixLimit: "alerts.sections.condition.fixLimit",
};

const PROMQL_QUIET_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.verdict.promqlQuietAbove",
  below: "alerts.verdict.promqlQuietBelow",
  none: "alerts.verdict.promqlQuietMatched",
};
const FILTER_CONDITIONS_SHOWN = 3;
// Span duration is microseconds by the traces contract, whatever unit the user typed it in.
export const SPAN_DURATION_FIELD = "duration";
const MICROS_PER_MS = 1000;

/** Measure functions whose result keeps the measured field's unit. */
export const UNIT_KEEPING_FUNCTIONS: ReadonlySet<string> = new Set([
  "avg",
  "min",
  "max",
  "sum",
  "median",
  "p50",
  "p75",
  "p90",
  "p95",
  "p99",
]);

export const operatorSymbol = (op: string | undefined): string =>
  OPERATOR_SYMBOLS[op ?? ""] ?? op ?? "";

/** "3" for the default at-least operator, otherwise "> 3", "≤ 3"...; numbers in the locale's form. */
export const limitText = (
  op: string | undefined,
  value: unknown,
  shown: string = formatNumber(value),
): string => (!op || op === ">=" ? shown : `${operatorSymbol(op)} ${shown}`);

const num = (value: unknown): number => Number(value ?? 0) || 0;

/** True when a traces measure reads span duration, which is stored in µs. */
export const isSpanDurationMeasure = (
  streamType: string | undefined,
  fn: string | undefined,
  column: string | undefined,
): boolean =>
  streamType === "traces" && column === SPAN_DURATION_FIELD && UNIT_KEEPING_FUNCTIONS.has(fn ?? "");

/** A builder measure's value as the user reads it: span duration in ms, anything else as a number. */
export const measureValueText = (
  alert: Pick<ReadBackAlert, "stream_type" | "query_condition">,
  value: unknown,
  t: TranslateFn,
): I18nText => {
  const qc = alert.query_condition ?? {};
  const n = typeof value === "number" ? value : Number(value);
  const spanDuration =
    (qc.type ?? "custom") === "custom" &&
    isSpanDurationMeasure(
      alert.stream_type,
      qc.aggregation?.function,
      qc.aggregation?.having?.column,
    );
  if (!spanDuration || value === "" || value == null || !Number.isFinite(n))
    return formatNumber(value);
  return valueWithUnit(n / MICROS_PER_MS, "milliseconds", t);
};

/** A preview count in a sentence: "at least 1,000" when the server stopped counting there. */
export const previewCountText = (count: number, atLeast: boolean | undefined, t: TranslateFn) => {
  const value = formatNumber(count);
  return atLeast ? t("alerts.verdict.atLeast", { value }) : value;
};

/** An event, row or series count limit: a whole number of 1 or more. */
export const isCountLimit = (value: unknown): boolean =>
  (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
  Number.isInteger(Number(value)) &&
  Number(value) >= 1;

/** A scheduled alert's condition gap; an absent limit falls back to the default, so only a typed one can be bad. */
export function conditionGap(
  alert: Pick<ReadBackAlert, "query_condition" | "trigger_condition">,
  opts: { queryFailed?: boolean; aggregationEnabled?: boolean } = {},
): ConditionGap | null {
  const qc = alert.query_condition;
  if (qc?.type === "sql" && !qc.sql?.trim()) return "noQuery";
  if (opts.queryFailed) return "fixQuery";
  if (valueThresholdBlank(qc, opts.aggregationEnabled ?? true)) return "noThreshold";
  const threshold = alert.trigger_condition?.threshold;
  return threshold !== undefined && !isCountLimit(threshold) ? "fixLimit" : null;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || String(value).trim() === "";

// Value thresholds start empty, so a measure or PromQL value with none yet is not a rule to read back.
function valueThresholdBlank(
  qc: ReadBackAlert["query_condition"],
  aggregationEnabled: boolean,
): boolean {
  if (qc?.type === "promql") {
    return !qc.promql_rule_mode && !!qc.promql_condition && isBlank(qc.promql_condition.value);
  }
  return (
    (qc?.type ?? "custom") === "custom" &&
    aggregationEnabled &&
    !!qc?.aggregation &&
    isBlank(qc.aggregation.having?.value)
  );
}

// The plural choice must be the count itself: vue-i18n puts the choice in {n} when n is 0.
const durationText = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.summary.hourCount", { n: minutes / 60 }, minutes / 60)
    : t("alerts.summary.minuteCount", { n: minutes }, minutes);

function whoText(
  alert: ReadBackAlert | ReadBackCompositeAlert,
  t: TranslateFn,
  incidentsEnabled: boolean,
): I18nText {
  if (!hasDeliveryTarget(alert)) {
    return incidentsEnabled && alert.creates_incident === true
      ? t("alerts.readBack.incident")
      : t("alerts.readBack.nobody");
  }
  const names: string[] = [...(alert.destinations ?? [])];
  if (!names.length && alert.workflows?.length) names.push(t("alerts.readBack.workflow"));
  if (!names.length && alert.oncall_team) names.push(t("alerts.alertSettings.oncallTeamTarget"));
  const targets =
    names.length > 2
      ? t("alerts.readBack.targetsMore", { first: names[0], count: names.length - 1 })
      : raw(names.join(", "));
  return t("alerts.readBack.targets", { targets });
}

/** A count test in words; the noun follows the stream type. */
export function eventCountText(
  tc: ReadBackAlert["trigger_condition"] | undefined,
  t: TranslateFn,
  streamType?: string,
): I18nText {
  return countText(
    tc?.operator,
    tc?.threshold ?? "",
    (n) => dataNoun(streamType, "custom", n, t),
    t,
  );
}

const groupsOf = (alert: ReadBackAlert): string[] => [
  ...(alert.logGroupBy ?? []),
  ...(alert.query_condition?.aggregation?.group_by ?? []),
];

function whatText(alert: ReadBackAlert, t: TranslateFn, aggregationEnabled: boolean): I18nText {
  const qc = alert.query_condition ?? {};
  const tc = alert.trigger_condition ?? {};
  const window = durationText(num(tc.period), t);
  if (alert.is_real_time === "true") return t("alerts.readBack.realtime");
  if (qc.type === "promql") {
    const pc = qc.promql_condition ?? {};
    return t("alerts.readBack.promql", { op: operatorSymbol(pc.operator), value: pc.value ?? "" });
  }
  const having = qc.aggregation?.having;
  // The payload drops a builder measure that is switched off or left behind by a switch to SQL.
  if (
    aggregationEnabled &&
    (qc.type ?? "custom") === "custom" &&
    qc.aggregation &&
    having?.column
  ) {
    return t("alerts.readBack.measureIs", {
      measure: measureWords(qc.aggregation, groupsOf(alert), alert.stream_type, t),
      op: operatorSymbol(having.operator),
      value: measureValueText(alert, having.value ?? "", t),
      window,
    });
  }
  // SQL multi-alert fires per returned row whose chosen column passes the test, not on a row count.
  if (qc.type === "sql" && qc.aggregation?.multi_alert && having?.column) {
    return t("alerts.readBack.sqlRowValue", {
      field: having.column,
      op: operatorSymbol(having.operator),
      value: having.value ?? "",
      window,
    });
  }
  if (qc.type === "sql") {
    return t("alerts.readBack.sqlRows", {
      op: operatorSymbol(tc.operator),
      value: tc.threshold ?? "",
      window,
    });
  }
  return t("alerts.readBack.eventsIn", {
    condition: eventCountText(tc, t, alert.stream_type),
    window,
  });
}

function scheduleText(alert: ReadBackAlert, t: TranslateFn): I18nText {
  const tc = alert.trigger_condition ?? {};
  if (alert.is_real_time === "true") return t("alerts.readBack.asItHappens");
  if (tc.frequency_type === "cron") return t("alerts.readBack.cron", { cron: tc.cron ?? "" });
  const minutes = num(tc.frequency);
  return minutes >= 60 && minutes % 60 === 0
    ? t("alerts.readBack.everyHours", { count: minutes / 60 })
    : t("alerts.readBack.everyMinutes", { count: minutes });
}

const holdText = (alert: { pending_period_sec?: number | string | null }, t: TranslateFn) => {
  const hold = num(alert.pending_period_sec);
  return hold > 0 ? t("alerts.readBack.hold", { duration: durationText(hold, t) }) : "";
};

const cooldownText = (silenceValue: unknown, t: TranslateFn) => {
  const silence = num(silenceValue);
  return silence > 0 ? t("alerts.readBack.cooldown", { duration: durationText(silence, t) }) : "";
};

/** One plain sentence for the whole alert: who hears, when, how often. Empty until a stream is picked. */
export function describeAlertInPlainWords(
  alert: ReadBackAlert,
  t: TranslateFn,
  opts: { aggregationEnabled?: boolean; incidentsEnabled?: boolean } = {},
): I18nText {
  if (!alert?.stream_name) return raw("");
  const gap =
    alert.is_real_time === "true"
      ? null
      : conditionGap(alert, { aggregationEnabled: opts.aggregationEnabled ?? true });
  if (gap) return t(CONDITION_GAP_KEYS[gap]);
  return t("alerts.readBack.sentence", {
    who: whoText(alert, t, opts.incidentsEnabled === true),
    what: whatText(alert, t, opts.aggregationEnabled ?? true),
    hold: holdText(alert, t),
    schedule: scheduleText(alert, t),
    cooldown: cooldownText(alert.trigger_condition?.silence, t),
  });
}

/** The composite counterpart: who hears and which combination of its alerts. Empty until there is an expression. */
export function describeCompositeInPlainWords(
  alert: ReadBackCompositeAlert,
  t: TranslateFn,
  opts: { incidentsEnabled?: boolean } = {},
): I18nText {
  const expression = alert?.composite_condition?.expression?.trim();
  if (!expression) return raw("");
  return t("alerts.readBack.composite", {
    who: whoText(alert, t, opts.incidentsEnabled === true),
    expression: nameResolvedExpression(expression, alert.children ?? []),
    hold: holdText(alert, t),
    cooldown: cooldownText(alert.trigger_condition?.silence, t),
  });
}

/** An alert that fires per group says for how many of the groups it would fire; a lower bound drops the total. */
function perGroupVerdict(
  verdict: PreviewVerdict & { count: number },
  alert: ReadBackAlert,
  t: TranslateFn,
): I18nText {
  const { count, atLeast } = verdict;
  const total = atLeast ? undefined : verdict.total;
  const labels = [...new Set(groupsOf(alert).filter((g): g is string => !!g))];
  const groups = (n: number) =>
    labels.length
      ? t("alerts.verdict.labelGroups", { labels: joinListMore(labels, t) }, n)
      : t("alerts.verdict.groups", n);
  if (count === 0) return t("alerts.verdict.perGroupQuiet", { groups: groups(1) });
  const shown = previewCountText(count, atLeast, t);
  if (total === undefined)
    return t("alerts.verdict.perGroupFiresCount", { count: shown, groups: groups(count) });
  return t("alerts.verdict.perGroupFires", {
    count: shown,
    total: formatNumber(total),
    groups: groups(total),
  });
}

/** The rail's verdict as a sentence, from the counts the preview already computed. */
export function previewVerdictSentence(
  verdict: PreviewVerdict,
  alert: ReadBackAlert,
  t: TranslateFn,
  // `undecided`: the threshold is still the form's starter, so the rail states the value, not a verdict.
  opts: { countsEvents?: boolean; hasFilter?: boolean; undecided?: boolean } = {},
): I18nText {
  const tc = alert.trigger_condition ?? {};
  const qc = alert.query_condition ?? {};
  if (alert.is_real_time === "true") {
    if (verdict.count === undefined) return t("alerts.verdict.realtimeNoCount");
    const window = verdict.windowMinutes ?? num(tc.period);
    // The daily volume is the 24-hour row's to state, so the verdict counts only the window.
    return t(
      opts.hasFilter === false ? "alerts.verdict.realtimeNoFilter" : "alerts.verdict.realtime",
      {
        count: previewCountText(verdict.count, verdict.atLeast, t),
        window: t("alerts.verdict.window", { n: window }, window),
      },
    );
  }
  if (verdict.count === undefined) {
    return t(verdict.wouldTrigger ? "alerts.verdict.firesReason" : "alerts.verdict.quietReason", {
      reason: verdict.reason,
    });
  }
  // A PromQL count is of series past the value limit; the trigger threshold only says how many series it takes.
  const pc = qc.type === "promql" ? qc.promql_condition : null;
  const limit =
    pc && pc.value !== undefined && pc.value !== null && pc.value !== ""
      ? limitText(pc.operator, pc.value)
      : limitText(tc.operator, tc.threshold ?? 0);
  const count = previewCountText(verdict.count, verdict.atLeast, t);
  if (verdict.grouped && qc.aggregation?.multi_alert)
    return perGroupVerdict({ ...verdict, count: verdict.count }, alert, t);
  if (verdict.grouped) {
    const needs = countRuleText(tc.operator, tc.threshold, t);
    return t(
      verdict.wouldTrigger ? "alerts.verdict.groupsFire" : "alerts.verdict.groupsQuiet",
      { count, limit: needs },
      verdict.count,
    );
  }
  const window = t("alerts.verdict.window", { n: num(tc.period) }, num(tc.period));
  const having = qc.aggregation?.having;
  if (verdict.value !== undefined && having?.column) {
    const measure = measureWords(qc.aggregation, groupsOf(alert), alert.stream_type, t);
    const value = measureValueText(alert, verdict.value, t);
    // With no threshold yet there is nothing to judge, but the value now helps pick one.
    if (isBlank(having.value) || opts.undecided)
      return t("alerts.verdict.valueNow", { measure, value, window });
    return t(verdict.wouldTrigger ? "alerts.verdict.valueFires" : "alerts.verdict.valueQuiet", {
      measure,
      value,
      window,
      limit: limitText(having.operator, null, measureValueText(alert, having.value, t)),
    });
  }
  const countsEvents = opts.countsEvents ?? (qc.type === "custom" && !qc.aggregation);
  const label =
    countsEvents || qc.type === "sql" || qc.type === "promql"
      ? dataNoun(alert.stream_type, qc.type, verdict.count, t)
      : raw(verdict.label ?? "");
  // A PromQL query sets its own range ([5m]); the look-back plays no part in what it returns now.
  if (qc.type === "promql") {
    if (verdict.wouldTrigger) return t("alerts.verdict.promqlFires", { count, label, limit });
    // "0 series" reads as an empty query, so a quiet count says how many are past the line and how many it takes.
    return t(
      PROMQL_QUIET_KEYS[thresholdSide(pc?.operator ?? tc.operator) ?? "none"],
      { count, limit: limitText(tc.operator, tc.threshold ?? 0) },
      verdict.count,
    );
  }
  if (opts.undecided) return t("alerts.verdict.now", { count, label, window });
  return t(verdict.wouldTrigger ? "alerts.verdict.fires" : "alerts.verdict.quiet", {
    count,
    label,
    window,
    limit,
  });
}

// The builder's own blank starter row is not a filter.
const withoutBlankRows = (group: FilterGroup): FilterGroup => ({
  ...group,
  items: group.items.flatMap((item): FilterNode[] => {
    if (item.kind === "group") {
      const inner = withoutBlankRows(item);
      return inner.items.length ? [inner] : [];
    }
    return item.kind === "condition" && !item.field ? [] : [item];
  }),
});

/** A stored filter tree as plain words, the first three conditions written out and the rest counted; null when there is no filter. */
export function filterPhrase(
  stored: unknown,
  profile: "alert" | "anomaly",
  t: TranslateFn,
): { text: I18nText; count: number } | null {
  const { codec, dialect } = FILTER_PROFILES[profile];
  const group = withoutBlankRows(codec.parse(stored as never, { fields: [] }));
  const parts = filterSentenceParts(group, (n) => describeFilterNode(n, dialect, t));
  const total = parts.filter((part) => part.kind === "condition").length;
  if (!total) return null;
  const words: string[] = [];
  let shown = 0;
  let open = 0;
  for (const part of parts) {
    if (shown >= FILTER_CONDITIONS_SHOWN) break;
    if (part.kind === "connector") {
      words.push(t(part.connector === "OR" ? "alerts.form.filter.or" : "alerts.form.filter.and"));
      continue;
    }
    words.push(`${"(".repeat(part.opens)}${part.phrase.text}${")".repeat(part.closes)}`);
    open += part.opens - part.closes;
    shown += 1;
  }
  const phrase = `${words.join(" ")}${")".repeat(Math.max(0, open))}`;
  const rest = total - shown;
  const text = rest
    ? joinList([phrase, t("alerts.copy.nMore", { count: formatNumber(rest) }, rest)])
    : raw(phrase);
  return { text, count: total };
}
