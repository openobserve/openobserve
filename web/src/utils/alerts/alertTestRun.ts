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
import { durationWords, formatNumber, joinList, thresholdSide, valueWithUnit } from "./alertCopy";
import { alertConditionsPayload } from "./alertConditionsLoad";
import { getAlertPayload, type PayloadContext, type PayloadFormData } from "./alertPayload";
import type { EvaluateAlertBody, EvaluateAlertResponse } from "./alertEvaluate.types";

const HOUR_MICROS = 3_600_000_000;
const DAY_HOURS = 24;
const SHOWN_TIMES = 3;
const SHOWN_GROUPS = 5;
// Stamps the save path adds for the record; they change every call and mean nothing to a dry run.
const RECORD_STAMPS = ["createdAt", "updatedAt", "lastTriggeredAt", "lastEditedBy", "owner"];
// What a dry run ignores, so editing them keeps an answer current.
const NOT_EVALUATED = ["name", "description", "destinations", "template", "folder_id", "tags"];
const GROUP_CHECKS_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.testRun.groupChecksAbove",
  below: "alerts.testRun.groupChecksBelow",
  none: "alerts.testRun.groupChecksMatched",
};
const LATEST_GROUPS_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.testRun.latestGroupsAbove",
  below: "alerts.testRun.latestGroupsBelow",
  none: "alerts.testRun.latestGroupsMatched",
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
  /** Checks that matched but were held back by Must last. */
  pending?: number;
  /** Fire, clear, fire again: the pattern that reads as flapping. */
  refires: number;
  /** Notifying checks with a clear check on both sides. */
  singleCheckSpikes: number;
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

/** A value in the alert's unit; span durations convert from microseconds. */
export function testValueText(value: number, unit: string | null | undefined, t: TranslateFn) {
  // Span duration reads in ms everywhere the form shows it.
  if (unit === "microseconds") return valueWithUnit(value / 1000, "milliseconds", t);
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

// A label every series shares names none of them, so only the labels that differ are shown.
const differingKeys = (all: Record<string, string>[]): string[] => {
  const keys = [...new Set(all.flatMap((labels) => Object.keys(labels ?? {})))];
  return keys.filter((k) => new Set(all.map((labels) => labels?.[k])).size > 1);
};
const groupLabel = (labels: Record<string, string>, key: string, keys?: string[]) => {
  const shown = keys?.length ? keys : Object.keys(labels ?? {});
  const values = [
    ...new Set(shown.map((k) => labels?.[k]).filter((v) => v !== undefined && v !== "")),
  ];
  // Labels that differ together (pod, its uid, its start time) repeat one identity; two name it.
  return raw(values.length ? values.slice(0, keys?.length ? 2 : undefined).join(" · ") : key);
};

const listWithMore = (items: I18nText[], total: number, t: TranslateFn): I18nText => {
  const rest = total - items.length;
  return joinList(
    rest > 0 ? [...items, t("alerts.copy.nMore", { count: formatNumber(rest) }, rest)] : items,
  );
};

export interface TestRunReportOptions {
  t: TranslateFn;
  timeZone?: string;
  nowMs: number;
  /** Notify at most every, in minutes; a real-time alert's notifications follow it. */
  silenceMinutes?: number;
  /** The PromQL query divides one part by another, so "no value" means its top part matched nothing. */
  ratio?: boolean;
}

// A few times are listed; past that only the latest says when, since the first ones are a day old.
const notifiedTimes = (s: EvaluateAlertResponse["summary"], o: TestRunReportOptions) => {
  const at = (micros: number) => checkTimeText(micros, o.timeZone, o.nowMs);
  if (s.notifications <= SHOWN_TIMES && s.notified_at.length === s.notifications)
    return joinList(s.notified_at.map(at));
  const latest = s.notified_at[s.notified_at.length - 1];
  return latest === undefined
    ? listWithMore(s.notified_at.slice(0, SHOWN_TIMES).map(at), s.notifications, o.t)
    : o.t("alerts.testRun.latestAt", { time: at(latest) });
};

// Real time notifies per event, so its day is events and notifications, never checks.
function realtimeSummary(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine {
  const { t } = o;
  const s = r.summary;
  const events = r.checks.reduce((sum, c) => sum + (c.error ? 0 : (c.value ?? 0)), 0);
  const params = {
    events: t("alerts.sections.backtest.matchingEvents", { count: formatNumber(events) }, events),
    count: formatNumber(s.notifications),
  };
  const wait = o.silenceMinutes ?? 0;
  return {
    id: "summary",
    text:
      wait > 0
        ? t(
            "alerts.testRun.realtimeSentWait",
            { ...params, wait: durationWords(wait, t) },
            s.notifications,
          )
        : t("alerts.testRun.realtimeSent", params, s.notifications),
    tone: "body",
  };
}

function summaryLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine {
  const { t } = o;
  const s = r.summary;
  if (s.notifications === 0)
    return { id: "summary", text: t("alerts.testRun.neverFired"), tone: "body" };
  if (r.is_real_time) return realtimeSummary(r, o);
  const times = notifiedTimes(s, o);
  // Checks that fired and notifications are counted apart, so the held line below adds up to the first.
  const params = {
    count: formatNumber(s.notifications),
    fired: formatNumber(s.fired),
    checks: formatNumber(s.checks),
    times,
  };
  const groupTotal = Math.max(s.groups_fired_total, s.groups_fired.length);
  if (!s.groups_fired.length)
    return {
      id: "summary",
      text: t("alerts.testRun.firedInChecks", params, s.notifications),
      tone: "body",
    };
  const groups = t("alerts.testRun.groupCount", { count: formatNumber(groupTotal) }, groupTotal);
  return {
    id: "summary",
    text: t("alerts.testRun.firedInChecksGroups", { ...params, groups }, s.notifications),
    tone: "body",
  };
}

/** The value that came nearest the threshold in a check that matched but did not last long enough. */
function closestLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const side = thresholdSide(r.checks[0]?.operator);
  if (side !== "above" && side !== "below") return null;
  const pending = r.checks.filter((check) => check.state === "pending");
  const keys = differingKeys(pending.flatMap((check) => (check.groups ?? []).map((g) => g.labels)));
  let best: { value: number; labels: Record<string, string> | null; time: number } | null = null;
  for (const check of pending) {
    const group = check.groups?.[0];
    const value = group?.value ?? check.value;
    if (value === null || value === undefined) continue;
    if (best && (side === "above" ? value <= best.value : value >= best.value)) continue;
    best = { value, labels: group?.labels ?? null, time: check.time };
  }
  if (!best) return null;
  const series = best.labels && keys.length ? String(groupLabel(best.labels, "", keys)) : "";
  const params = {
    value: testValueText(best.value, null, o.t),
    time: checkTimeText(best.time, o.timeZone, o.nowMs),
  };
  return {
    id: "closest",
    text: series
      ? o.t("alerts.testRun.closest", { ...params, series: raw(series) })
      : o.t("alerts.testRun.closestValue", params),
    tone: "secondary",
  };
}

/** How many groups the latest check found past the threshold: what the preview calls "now". */
function latestGroupsLine(r: EvaluateAlertResponse, t: TranslateFn): TestRunLine | null {
  const latest = r.checks[r.checks.length - 1];
  if (!latest || latest.error || !r.summary.groups_fired.length) return null;
  const over = (latest.groups ?? []).filter((g) => g.fired).length;
  // The server lists at most 100 groups, fired first; a full list of fired ones may hold more.
  const atLeast = over === (latest.groups ?? []).length && latest.groups_total > over;
  const count = atLeast
    ? t("alerts.verdict.atLeast", { value: formatNumber(over) })
    : formatNumber(over);
  return {
    id: "latestGroups",
    text: t(LATEST_GROUPS_KEYS[thresholdSide(latest.operator) ?? "none"], { count }, over),
    tone: "secondary",
  };
}

function noSeriesLine(r: EvaluateAlertResponse, t: TranslateFn, ratio = false): TestRunLine | null {
  const metrics = r.diagnostics?.metrics ?? [];
  const latest = r.checks[r.checks.length - 1];
  if (!metrics.length || !latest || latest.matched > 0) return null;
  // Every metric has series, so the top part of a ratio found nothing to count: its share is 0.
  if (ratio && metrics.every((m) => m.series > 0))
    return { id: "noSeries", text: t("alerts.testRun.noValueRatio"), tone: "secondary" };
  if (metrics.length === 1) {
    const [{ name, series }] = metrics;
    // A metric with series that matched nothing is an answer; a metric with none is a broken query.
    return {
      id: "noSeries",
      text: t(
        "alerts.testRun.noSeries",
        { metric: raw(name), count: formatNumber(series) },
        series,
      ),
      tone: series > 0 ? "secondary" : "warning",
    };
  }
  const list = metrics.map((m) =>
    t("alerts.testRun.metricSeries", { metric: raw(m.name), count: formatNumber(m.series) }),
  );
  return {
    id: "noSeries",
    text: t("alerts.testRun.noSeriesMany", { list: joinList(list) }),
    tone: metrics.every((m) => m.series > 0) ? "secondary" : "warning",
  };
}

/** The lines Test it shows for one dry run: what would have fired over the day, and why not. */
export function testRunReport(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunReport {
  const { t } = o;
  const s = r.summary;
  const lines: TestRunLine[] = [summaryLine(r, o)];
  if (s.notifications === 0 && s.pending > 0) {
    lines.push({
      id: "pendingOnly",
      text: t("alerts.testRun.pendingOnly", { count: formatNumber(s.pending) }, s.pending),
      tone: "secondary",
    });
    const closest = closestLine(r, o);
    if (closest) lines.push(closest);
  }
  const answered = r.checks.filter((c) => !c.error);
  if (r.query_type !== "promql" && answered.length && answered.every((c) => c.reason === "no_data"))
    lines.push({ id: "matchedNothing", text: t("alerts.guard.matchedNothing"), tone: "secondary" });
  const latestGroups = latestGroupsLine(r, t);
  if (latestGroups) lines.push(latestGroups);
  const held = r.checks.filter((c) => c.held_by === "notify_at_most_every").length;
  if (held && !r.is_real_time)
    lines.push({
      id: "held",
      text: t(
        held === s.fired - s.notifications ? "alerts.testRun.heldOther" : "alerts.testRun.held",
        { count: formatNumber(held) },
        held,
      ),
      tone: "secondary",
    });
  const noSeries = noSeriesLine(r, t, o.ratio);
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
  const groupChecks = GROUP_CHECKS_KEYS[thresholdSide(r.checks[0]?.operator) ?? "none"];
  const keys = differingKeys(s.groups_fired.map((g) => g.labels));
  const groups = s.groups_fired.slice(0, SHOWN_GROUPS).map((g) => ({
    label: groupLabel(g.labels, g.key, keys),
    text: t(groupChecks, { count: formatNumber(g.checks) }, g.checks),
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
  const firing = r.checks.map((c) => c.fired);
  let refires = 0;
  let singleCheckSpikes = 0;
  r.checks.forEach((check, i) => {
    if (!check.fired) return;
    if (i + 2 < firing.length && !firing[i + 1] && firing[i + 2]) refires += 1;
    if (check.notified && !firing[i - 1] && i + 1 < firing.length && !firing[i + 1])
      singleCheckSpikes += 1;
  });
  return {
    fired: r.summary.fired,
    alerts: r.summary.notifications,
    total: r.summary.checks,
    pending: r.summary.pending ?? 0,
    hours,
    refires,
    singleCheckSpikes,
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
