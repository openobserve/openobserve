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
import { durationText, formatNumber, joinList, valueWithUnit } from "./alertCopy";
import { alertConditionsPayload } from "./alertConditionsLoad";
import { getAlertPayload, type PayloadContext, type PayloadFormData } from "./alertPayload";
import type {
  EvaluateAlertBody,
  EvaluateAlertResponse,
  EvaluateCheck,
  EvaluateCheckState,
} from "./alertEvaluate.types";

const HOUR_MICROS = 3_600_000_000;
const DAY_HOURS = 24;
const SHOWN_TIMES = 3;
const SHOWN_GROUPS = 5;
// Stamps the save path adds for the record; they change every call and mean nothing to a dry run.
const RECORD_STAMPS = ["createdAt", "updatedAt", "lastTriggeredAt", "lastEditedBy", "owner"];
// What a dry run ignores, so editing them keeps an answer current.
const NOT_EVALUATED = ["name", "description", "destinations", "template", "folder_id", "tags"];
const NOW_KEYS: Record<EvaluateCheckState, { compared: I18nKey; bare: I18nKey }> = {
  quiet: { compared: "alerts.testRun.nowQuiet", bare: "alerts.testRun.nowQuietBare" },
  pending: { compared: "alerts.testRun.nowPending", bare: "alerts.testRun.nowPendingBare" },
  firing: { compared: "alerts.testRun.nowFiring", bare: "alerts.testRun.nowFiringBare" },
};

export type TestRunTone = "body" | "secondary" | "warning" | "error";

export interface TestRunLine {
  id: string;
  text: I18nText;
  tone: TestRunTone;
}

export interface TestRunGroupRow {
  label: I18nText;
  text: I18nText;
}

export interface TestRunReport {
  lines: TestRunLine[];
  groups: TestRunGroupRow[];
  /** Groups that fired beyond the rows shown. */
  groupsMore: number;
}

export interface TestRunDay {
  fired: number;
  alerts: number;
  total: number;
  /** One flag per hour of the tested day, oldest first. */
  hours: boolean[];
  /** 0 when no check found a matching event; unknown otherwise. */
  events?: number;
}

/** The alert as the save path sends it, minus the record stamps, for the dry run. */
export function evaluateAlertBody(
  formData: PayloadFormData,
  context: Omit<PayloadContext, "beingUpdated">,
): EvaluateAlertBody {
  // As an update, the payload builder leaves the form itself untouched.
  const body = getAlertPayload(formData, { ...context, beingUpdated: true });
  for (const key of RECORD_STAMPS) delete body[key];
  body.query_condition.conditions = alertConditionsPayload(
    formData.query_condition.conditions,
    null,
  );
  return body;
}

/** Equal for two alerts the dry run would answer the same way. */
export function testRunKey(body: EvaluateAlertBody): string {
  const evaluated: Record<string, unknown> = { ...body };
  for (const key of NOT_EVALUATED) delete evaluated[key];
  return JSON.stringify(evaluated);
}

/** A span duration (microseconds) in the unit a person reads it in: "500 ms", "1.5 s". */
export function microsText(micros: number, t: TranslateFn): I18nText {
  const size = Math.abs(micros);
  if (size >= 1_000_000) return valueWithUnit(micros / 1_000_000, "seconds", t);
  if (size >= 1_000) return valueWithUnit(micros / 1_000, "milliseconds", t);
  return valueWithUnit(micros, "microseconds", t);
}

/** A value in the alert's unit; span durations convert from microseconds. */
export function testValueText(value: number, unit: string | null | undefined, t: TranslateFn) {
  if (unit === "microseconds") return microsText(value, t);
  return unit ? valueWithUnit(value, unit, t) : formatNumber(value);
}

/** A check time to the minute, with the weekday when it is not today. */
export function checkTimeText(micros: number, timeZone: string | undefined, nowMs: number) {
  const zone = timeZone || "UTC";
  const at = new Date(micros / 1000);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(d);
  const sameDay = day(at) === day(new Date(nowMs));
  return raw(
    new Intl.DateTimeFormat(getIntlLocale(), {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      // The app writes times as HH:mm everywhere.
      hourCycle: "h23",
      ...(sameDay ? {} : { weekday: "short" }),
    }).format(at),
  );
}

const groupLabel = (labels: Record<string, string>, key: string) => {
  const values = Object.values(labels ?? {});
  return raw(values.length ? values.join(" · ") : key);
};

const listWithMore = (items: I18nText[], total: number, t: TranslateFn): I18nText => {
  const rest = total - items.length;
  return joinList(
    rest > 0 ? [...items, t("alerts.copy.nMore", { count: formatNumber(rest) }, rest)] : items,
  );
};

export interface TestRunReportOptions {
  t: TranslateFn;
  /** Unit of the compared value: a metricDefaults id, or "microseconds" for span duration. */
  unit?: string | null;
  timeZone?: string;
  nowMs: number;
}

function summaryLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine {
  const { t } = o;
  const s = r.summary;
  if (s.notifications === 0)
    return { id: "summary", text: t("alerts.testRun.neverFired"), tone: "body" };
  const times = listWithMore(
    s.notified_at.slice(0, SHOWN_TIMES).map((at) => checkTimeText(at, o.timeZone, o.nowMs)),
    s.notifications,
    t,
  );
  const count = formatNumber(s.notifications);
  if (!s.groups_fired.length)
    return {
      id: "summary",
      text: t("alerts.testRun.firedTimes", { count, times }, s.notifications),
      tone: "body",
    };
  const groups = listWithMore(
    s.groups_fired.slice(0, SHOWN_TIMES).map((g) => groupLabel(g.labels, g.key)),
    Math.max(s.groups_fired_total, s.groups_fired.length),
    t,
  );
  return {
    id: "summary",
    text: t("alerts.testRun.firedTimesGroups", { count, times, groups }, s.notifications),
    tone: "body",
  };
}

function nowLine(check: EvaluateCheck | undefined, o: TestRunReportOptions): TestRunLine | null {
  const { t } = o;
  if (!check || check.error) return null;
  if (check.state === "quiet" && check.reason === "no_data") {
    const seconds = Math.round((check.window_end - check.window_start) / 1_000_000);
    return {
      id: "now",
      text: t("alerts.testRun.nowNoData", { window: durationText(seconds, t) }),
      tone: "secondary",
    };
  }
  const keys = NOW_KEYS[check.state];
  if (check.value === null || check.threshold === null)
    return { id: "now", text: t(keys.bare), tone: "secondary" };
  const shown = testValueText(check.value, o.unit, t);
  const value = check.value_is_lower_bound ? t("alerts.verdict.atLeast", { value: shown }) : shown;
  const threshold = testValueText(check.threshold, o.unit, t);
  return { id: "now", text: t(keys.compared, { value, threshold }), tone: "secondary" };
}

function noSeriesLine(r: EvaluateAlertResponse, t: TranslateFn): TestRunLine | null {
  const metrics = r.diagnostics?.metrics ?? [];
  const latest = r.checks[r.checks.length - 1];
  if (!metrics.length || !latest || latest.matched > 0) return null;
  if (metrics.length === 1) {
    const [{ name, series }] = metrics;
    return {
      id: "noSeries",
      text: t(
        "alerts.testRun.noSeries",
        { metric: raw(name), count: formatNumber(series) },
        series,
      ),
      tone: "warning",
    };
  }
  const list = metrics.map((m) =>
    t("alerts.testRun.metricSeries", { metric: raw(m.name), count: formatNumber(m.series) }),
  );
  return {
    id: "noSeries",
    text: t("alerts.testRun.noSeriesMany", { list: joinList(list) }),
    tone: "warning",
  };
}

/** The lines Test it shows for one dry run: what would have fired, right now, and why not. */
export function testRunReport(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunReport {
  const { t } = o;
  const s = r.summary;
  const lines: TestRunLine[] = [summaryLine(r, o)];
  if (s.notifications === 0 && s.pending > 0)
    lines.push({
      id: "pendingOnly",
      text: t("alerts.testRun.pendingOnly", { count: formatNumber(s.pending) }, s.pending),
      tone: "secondary",
    });
  const answered = r.checks.filter((c) => !c.error);
  if (r.query_type !== "promql" && answered.length && answered.every((c) => c.reason === "no_data"))
    lines.push({ id: "matchedNothing", text: t("alerts.guard.matchedNothing"), tone: "secondary" });
  const now = nowLine(r.checks[r.checks.length - 1], o);
  if (now) lines.push(now);
  const held = r.checks.filter((c) => c.held_by === "notify_at_most_every").length;
  if (held)
    lines.push({
      id: "held",
      text: t("alerts.testRun.held", { count: formatNumber(held) }, held),
      tone: "secondary",
    });
  const noSeries = noSeriesLine(r, t);
  if (noSeries) lines.push(noSeries);
  const failed = r.checks.find((c) => c.error);
  if (s.errors && failed?.error)
    lines.push({
      id: "errors",
      text: t(
        "alerts.testRun.checkErrors",
        { count: formatNumber(s.errors), reason: raw(failed.error.message) },
        s.errors,
      ),
      tone: "error",
    });
  if (r.truncated)
    lines.push({
      id: "truncated",
      text: t("alerts.testRun.truncated", { count: formatNumber(s.checks) }),
      tone: "warning",
    });
  const groups = s.groups_fired.slice(0, SHOWN_GROUPS).map((g) => ({
    label: groupLabel(g.labels, g.key),
    text: t("alerts.testRun.groupChecks", { count: formatNumber(g.checks) }, g.checks),
  }));
  const groupsMore = Math.max(
    0,
    Math.max(s.groups_fired_total, s.groups_fired.length) - groups.length,
  );
  return { lines, groups, groupsMore };
}

/** The tested day by the hour, for the 24-hour strip. */
export function testRunDay(r: EvaluateAlertResponse): TestRunDay {
  const hours = Array.from({ length: DAY_HOURS }, () => false);
  const dayStart = r.end - DAY_HOURS * HOUR_MICROS;
  for (const check of r.checks) {
    if (!check.fired) continue;
    const hour = Math.floor((check.time - dayStart) / HOUR_MICROS);
    hours[Math.min(DAY_HOURS - 1, Math.max(0, hour))] = true;
  }
  const answered = r.checks.filter((c) => !c.error);
  const empty = answered.length > 0 && answered.every((c) => c.reason === "no_data");
  const events = r.is_real_time
    ? answered.reduce((sum, c) => sum + (c.value ?? 0), 0)
    : empty
      ? 0
      : undefined;
  return {
    fired: r.summary.fired,
    alerts: r.summary.notifications,
    total: r.summary.checks,
    hours,
    ...(events === undefined ? {} : { events }),
  };
}

/** What failed, from the server's own message when it gave one. */
export function requestFailureReason(error: unknown, t: TranslateFn): I18nText {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })
    ?.response;
  const message = response?.data?.message;
  if (typeof message === "string" && message.trim()) return raw(message.trim());
  if (response?.status) return t("alerts.testRun.serverStatus", { status: response.status });
  return t("alerts.testRun.noAnswer");
}
