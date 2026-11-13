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
import type { AlertHistorySummaryRow } from "@/services/alerts.queries";
import { isFiringOutcome } from "@/utils/alerts/runOutcome";
import { formatTimestampInTimezone } from "@/utils/date";
import { getCronIntervalInMinutes } from "@/utils/queryUtils";
import { unfoldDuration, type IncidentAlertRow } from "./incidentUnfold";

const MINUTE_US = 60_000_000;
const DAY_US = 24 * 60 * MINUTE_US;
const QUARTER_US = 15 * MINUTE_US;

type Operator = ">" | ">=" | "<" | "<=" | "=" | "!=";

/** The parts of an alert definition or list row the panel reads. */
export interface PanelAlert {
  query_condition?: PanelQueryCondition | null;
  condition?: PanelQueryCondition | null;
  trigger_condition?: PanelTrigger | null;
}

export interface PanelQueryCondition {
  type?: string;
  sql?: string | null;
  promql?: string | null;
  promql_condition?: { operator?: string; value?: number | string } | null;
  slo_condition?: {
    kind?: string;
    operator?: string;
    critical?: number | string;
    long_window_secs?: number | null;
  } | null;
  aggregation?: {
    function?: string;
    having?: { column?: string; operator?: string; value?: number | string };
  } | null;
}

export interface PanelTrigger {
  period?: number;
  operator?: string;
  threshold?: number;
  frequency?: number;
  frequency_type?: string;
  cron?: string;
  silence?: number;
}

/** An alert list row: its live state plus what the panel shows before the alert itself loads. */
export type IncidentAlertListRow = IncidentAlertRow &
  PanelAlert & {
    name?: string;
    stream_type?: string;
    stream_name?: string;
    description?: string;
    owner?: string;
  };

/** The alert's own GET; only the fields the panel reads. */
export type PanelDefinition = PanelAlert & {
  name?: string;
  stream_type?: string;
  stream_name?: string;
  description?: string;
  owner?: string;
  destinations?: string[];
  oncall_team?: string | null;
  workflows?: string[];
  notify_on_recovery?: boolean;
  is_real_time?: boolean;
};

export const WEEK_BUCKET_SECONDS = 900;

export interface FiringHit {
  timestamp: number;
  actual_value?: number | null;
  rule_value?: string | null;
  threshold_value?: number | null;
  threshold_operator?: string | null;
  value_is_lower_bound?: boolean | null;
}

export interface WeekDay {
  /** "YYYY-MM-DD" in the app zone. */
  day: string;
  /** Any microsecond on that day, for formatting it. */
  at: number;
  n: number;
  known: boolean;
}

const SYMBOL: Record<Operator, string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "=": "=",
  "!=": "≠",
};

const AGGREGATE: Record<string, I18nKey> = {
  avg: "alerts.incidents.panel.aggregate.avg",
  min: "alerts.incidents.panel.aggregate.min",
  max: "alerts.incidents.panel.aggregate.max",
  sum: "alerts.incidents.panel.aggregate.sum",
  count: "alerts.incidents.panel.aggregate.count",
  median: "alerts.incidents.panel.aggregate.median",
};

const PERCENTILE = /^p\d{2}$/;

const isOperator = (op: unknown): op is Operator => typeof op === "string" && op in SYMBOL;

const numberOf = (value: number | string | undefined, locale: string) =>
  typeof value === "number" ? value.toLocaleString(locale) : String(value ?? "");

const conditionOf = (alert: PanelAlert) => alert.query_condition ?? alert.condition ?? null;

// An aggregate in plain words; a function with no words falls back to the field alone.
const aggregateWords = (t: TranslateFn, fn: string | undefined, column: string | undefined) => {
  const name = fn?.toLowerCase() ?? "";
  if (!column) return "";
  const field = raw(column);
  if (PERCENTILE.test(name)) {
    return t("alerts.incidents.panel.aggregate.percentile", { percentile: raw(name), field });
  }
  const key = AGGREGATE[name];
  return key ? t(key, { field }) : field;
};

/** "> 10" or "highest latency ≥ 100": what the check compares; null when the alert says too little. */
const comparisonOf = (t: TranslateFn, alert: PanelAlert, locale: string): string | null => {
  const qc = conditionOf(alert);
  const compare = (op: unknown, value: number | string | undefined) =>
    isOperator(op) ? `${SYMBOL[op]} ${numberOf(value, locale)}` : null;
  if (qc?.type === "promql") {
    return compare(qc.promql_condition?.operator, qc.promql_condition?.value);
  }
  // An SLO alert compares slo_condition; its trigger_condition holds an unused default gate.
  if (qc?.type === "slo") {
    const slo = qc.slo_condition;
    const comparison = slo && compare(slo.operator, slo.critical);
    if (!comparison) return null;
    return slo.kind === "error_budget"
      ? `${t("slos.alert.budgetConsumed")} ${comparison}%`
      : `${t("slos.alert.burnRate")} ${comparison}`;
  }
  const having = qc?.aggregation?.having;
  if (qc?.aggregation && having) {
    const comparison = compare(having.operator, having.value);
    const words = aggregateWords(t, qc.aggregation.function, having.column);
    return comparison && `${words} ${comparison}`.trim();
  }
  return compare(alert.trigger_condition?.operator, alert.trigger_condition?.threshold);
};

/** The window the check reads, in microseconds: a burn rate's long window, else the period. */
const windowOf = (alert: PanelAlert) => {
  const qc = conditionOf(alert);
  if (qc?.type !== "slo") return (alert.trigger_condition?.period ?? 0) * MINUTE_US;
  // An error budget is measured over the SLO's own window, which the alert does not carry.
  const slo = qc.slo_condition;
  return slo?.kind === "burn_rate" ? (slo.long_window_secs ?? 0) * 1_000_000 : 0;
};

const ROW_COUNT_TYPES = new Set(["custom", "sql"]);

/** Only a count alert's value is a number of rows; any other kind's is a measurement. */
export const isRowCount = (alert: PanelAlert) => {
  const qc = conditionOf(alert);
  return ROW_COUNT_TYPES.has(qc?.type ?? "custom") && !qc?.aggregation;
};

/** "alert needs > 10 over 5 min", or "Needs > 10 over 5 min" leading a line; null when unknown. */
export function alertNeedsWords(
  t: TranslateFn,
  alert: PanelAlert,
  locale: string,
  leading: boolean | "current",
): I18nText | null {
  const comparison = comparisonOf(t, alert, locale);
  if (!comparison) return null;
  const condition = raw(comparison);
  const period = windowOf(alert);
  if (!period) {
    return t(
      leading === "current"
        ? "alerts.incidents.panel.currentCondition"
        : leading
          ? "alerts.incidents.panel.needsLead"
          : "alerts.incidents.panel.needs",
      {
        condition,
      },
    );
  }
  return t(
    leading === "current"
      ? "alerts.incidents.panel.currentConditionOver"
      : leading
        ? "alerts.incidents.panel.needsOverLead"
        : "alerts.incidents.panel.needsOver",
    {
      condition,
      period: unfoldDuration(t, period),
    },
  );
}

/** "Checked every 5 min · silenced 30 min after firing". */
export function alertScheduleWords(
  t: TranslateFn,
  trigger: PanelTrigger | null | undefined,
  realTime: boolean,
): I18nText {
  if (realTime) return t("alerts.incidents.panel.schedule.realTime");
  if (trigger?.frequency_type === "cron" && trigger.cron) {
    try {
      const minutes = Math.max(1, getCronIntervalInMinutes(trigger.cron));
      return t("alerts.incidents.panel.schedule.cron", {
        interval: unfoldDuration(t, minutes * MINUTE_US),
      });
    } catch {
      return t("alerts.incidents.panel.schedule.cronPlain");
    }
  }
  const interval = unfoldDuration(t, Math.max(1, trigger?.frequency ?? 1) * MINUTE_US);
  const silence = trigger?.silence ?? 0;
  return silence > 0
    ? t("alerts.incidents.panel.schedule.everySilenced", {
        interval,
        silence: unfoldDuration(t, silence * MINUTE_US),
      })
    : t("alerts.incidents.panel.schedule.every", { interval });
}

/** The query the alert runs and its language; null for a filter-built alert. */
export function alertQueryOf(alert: PanelAlert) {
  const qc = conditionOf(alert);
  if (qc?.type === "promql" && qc.promql) return { code: qc.promql, lang: "promql" };
  if (qc?.type === "sql" && qc.sql) return { code: qc.sql, lang: "sql" };
  return null;
}

/** The evaluated number: actual_value, else a PromQL rule's sample; null for none, NaN or ±Inf. */
export function firingValueOf(hit: FiringHit) {
  if (typeof hit.actual_value === "number") return hit.actual_value;
  const sample = hit.rule_value?.trim() ? Number(hit.rule_value) : NaN;
  return Number.isFinite(sample) ? sample : null;
}

/** The evaluated value, "100+ rows" when the check stopped counting at its row cap; null without one. */
export function firingValueWords(t: TranslateFn, hit: FiringHit, rows: boolean, locale: string) {
  const actual = firingValueOf(hit);
  if (actual === null) return null;
  const value = actual.toLocaleString(locale);
  const capped = !!hit.value_is_lower_bound;
  if (!rows)
    return { value: capped ? t("alerts.incidents.panel.atLeast", { value }) : raw(value), capped };
  const key = capped ? "alerts.incidents.panel.rowsAtLeast" : "alerts.incidents.panel.rowCount";
  return { value: t(key, { value }, actual), capped };
}

const dayKey = (zone: string, us: number) => formatTimestampInTimezone(us, "YYYY-MM-DD", zone);

/** Seven days in the app zone ending today: their keys, and the query window from the first midnight. */
export function lastWeekWindow(zone: string, now: number) {
  const sinceMidnight = (us: number) => {
    const clock = formatTimestampInTimezone(us, "HH:mm:ss", zone).split(":").map(Number);
    return ((clock[0] * 60 + clock[1]) * 60 + clock[2]) * 1_000_000 + (us % 1_000_000);
  };
  const midnightOf = (us: number) => {
    let at = us - sinceMidnight(us);
    // A clock change since midnight leaves this an hour off; the clock there says which way.
    const off = sinceMidnight(at);
    at = off > DAY_US / 2 ? at + DAY_US - off : at - off;
    // A zone that turns its clock back to midnight has two; the day starts at the first.
    const day = dayKey(zone, at);
    while (dayKey(zone, at - QUARTER_US) === day) at -= QUARTER_US;
    return at;
  };
  // Midday of the day before, from each day's midnight: a 23 h or 25 h day never repeats or drops.
  const days = [now];
  while (days.length < 7) days.unshift(midnightOf(days[0]) - DAY_US / 2);
  return {
    start: midnightOf(days[0]),
    end: now,
    days: days.map((at) => ({ day: dayKey(zone, at), at, start: midnightOf(at) })),
  };
}

/** Firings per app-zone day for one alert, from quarter-hour summary buckets. */
export function lastWeekOf(
  rows: readonly AlertHistorySummaryRow[],
  alertId: string,
  zone: string,
  window: ReturnType<typeof lastWeekWindow>,
  coverage = [{ start: window.start, end: window.end }],
) {
  const firing = rows.filter(
    (r) => r.alert_id === alertId && isFiringOutcome(r.outcome) && r.bucket >= window.start,
  );
  const perDay = new Map<string, { n: number; silenced: number }>();
  for (const row of firing) {
    const key = dayKey(zone, row.bucket);
    const day = perDay.get(key) ?? { n: 0, silenced: 0 };
    perDay.set(key, { n: day.n + row.n, silenced: day.silenced + (row.silenced ?? 0) });
  }
  const ranges = [...coverage].sort((a, b) => a.start - b.start);
  const days: WeekDay[] = window.days.map(({ day, at, start }, index) => {
    const end = window.days[index + 1]?.start ?? window.end;
    let covered = start;
    for (const range of ranges) {
      if (range.start > covered) break;
      covered = Math.max(covered, range.end);
    }
    return { day, at, n: perDay.get(day)?.n ?? 0, known: covered >= end };
  });
  const inWindow = window.days.map(({ day }) => perDay.get(day));
  return {
    days,
    complete: days.every((day) => day.known),
    total: days.reduce((sum, d) => sum + d.n, 0),
    silenced: inWindow.reduce((sum, d) => sum + (d?.silenced ?? 0), 0),
    firingDays: days.filter((d) => d.n > 0).length,
  };
}

/** "Jul 12 → Jul 27" past a day, else "23:15 → 01:10", each time dated when it is not today. */
export function firingRange(zone: string, first: number, last: number, now: number) {
  const fmt = (us: number, format: string) => formatTimestampInTimezone(us, format, zone);
  if (last - first >= DAY_US) return `${fmt(first, "MMM D")} → ${fmt(last, "MMM D")}`;
  const today = dayKey(zone, now);
  const at = (us: number) => fmt(us, dayKey(zone, us) === today ? "HH:mm" : "MMM D, HH:mm");
  const end = dayKey(zone, last) === dayKey(zone, first) ? fmt(last, "HH:mm") : at(last);
  return `${at(first)} → ${end}`;
}
