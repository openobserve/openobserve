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
import { realtimeNotifications, type EventWindow } from "./alertBacktest";
import { alertConditionsPayload } from "./alertConditionsLoad";
import { getAlertPayload, type PayloadContext, type PayloadFormData } from "./alertPayload";
import type { EvaluateAlertBody, EvaluateAlertResponse } from "./alertEvaluate.types";

const HOUR_MICROS = 3_600_000_000;
const MINUTE_MICROS = 60_000_000;
const DAY_HOURS = 24;
const DAY_MINUTES = DAY_HOURS * 60;
const SHOWN_TIMES = 3;
const SHOWN_GROUPS = 5;
// Stamps the save path adds for the record; they change every call and mean nothing to a dry run.
const RECORD_STAMPS = ["createdAt", "updatedAt", "lastTriggeredAt", "lastEditedBy", "owner"];
// What a dry run ignores, so editing them keeps an answer current.
const NOT_EVALUATED = ["name", "description", "destinations", "template", "folder_id", "tags"];
const GROUPS_HEADING_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.testRun.groupsAbove",
  below: "alerts.testRun.groupsBelow",
  none: "alerts.testRun.groupsMatched",
};
const LABEL_KEYS_MAX = 3;
const LATEST_GROUPS_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.testRun.latestGroupsAbove",
  below: "alerts.testRun.latestGroupsBelow",
  none: "alerts.testRun.latestGroupsMatched",
};
const LATEST_SERIES_KEYS: Record<"above" | "below" | "none", I18nKey> = {
  above: "alerts.testRun.latestSeriesAbove",
  below: "alerts.testRun.latestSeriesBelow",
  none: "alerts.testRun.latestSeriesMatched",
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
  /** Says once what every group row counts. */
  groupsHeading: I18nText | null;
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
  /** Per hour, the share of its checks that fired (real time: of its events, against the busiest hour). */
  hourShares: number[];
  /** Per hour, its checks, the ones that fired, and the events they counted. */
  hourTallies: { checks: number; fired: number; events: number }[];
  /** 0 when no check found a matching event; unknown otherwise. */
  events?: number;
  /** Checks that matched but were held back by Must last. */
  pending?: number;
  /** Fire, clear, fire again: the pattern that reads as flapping. */
  refires: number;
  /** Leading hours of the day a run cut short never reached. */
  untestedHours: number;
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

// A check Notify at most every paused never ran, so it neither fired nor cleared.
const skippedChecks = (r: EvaluateAlertResponse) => r.checks.filter((c) => c.skipped === true);
const firedRan = (r: EvaluateAlertResponse) =>
  r.summary.fired - skippedChecks(r).filter((c) => c.fired).length;

/** How far back a run cut short reached, in minutes; null when it covered the day. */
function testedMinutes(r: EvaluateAlertResponse): number | null {
  if (!r.truncated || !r.checks.length) return null;
  const first = r.checks[0];
  const step =
    r.checks.length > 1 ? r.checks[1].time - first.time : first.window_end - first.window_start;
  const minutes = Math.round((r.end - first.time + step) / MINUTE_MICROS);
  return minutes < DAY_MINUTES ? minutes : null;
}
// Whole hours past two, so a cut run reads "the last 8 hours", not "the last 497 minutes".
const roundSpan = (minutes: number) =>
  minutes >= 120 ? Math.floor(minutes / 60) * 60 : Math.max(1, minutes);
const spanWords = (minutes: number, t: TranslateFn) => durationWords(roundSpan(minutes), t);

// A label every series shares names none of them, so only the labels that differ are shown.
const differingKeys = (all: Record<string, string>[]): string[] => {
  const keys = [...new Set(all.flatMap((labels) => Object.keys(labels ?? {})))];
  return keys.filter((k) => new Set(all.map((labels) => labels?.[k])).size > 1);
};
const looksLikeId = (value: string) => /^[0-9a-f-]{12,}$/i.test(value) || /^[\d.:]+$/.test(value);
// The fewest labels that tell every row apart, most telling first; ids, numbers and gaps last.
const labelKeys = (all: Record<string, string>[]): string[] => {
  const rank = (k: string) => {
    const values = all.map((labels) => labels?.[k] ?? "");
    const weak = values.some((v) => v === "") || values.some(looksLikeId);
    return (weak ? all.length + 1 : 0) - new Set(values).size;
  };
  const picked: string[] = [];
  for (const key of differingKeys(all).sort((a, b) => rank(a) - rank(b))) {
    picked.push(key);
    const names = new Set(all.map((labels) => picked.map((k) => labels?.[k]).join("\u0000")));
    if (names.size === all.length || picked.length === LABEL_KEYS_MAX) break;
  }
  return picked;
};
const groupLabel = (labels: Record<string, string>, key: string, keys?: string[]) => {
  const shown = keys?.length ? keys : Object.keys(labels ?? {});
  const values = [
    ...new Set(shown.map((k) => labels?.[k]).filter((v) => v !== undefined && v !== "")),
  ];
  return raw(values.length ? values.join(" · ") : key);
};

const listWithMore = (items: I18nText[], total: number, t: TranslateFn): I18nText => {
  const rest = total - items.length;
  return joinList(
    rest > 0 ? [...items, t("alerts.copy.nMore", { count: formatNumber(rest) }, rest)] : items,
  );
};

/** The most extreme value the preview drew, which may fall between two checks. */
export interface PreviewPeak {
  value: number;
  atMs: number;
}

export interface ValueSplit {
  column: string;
  values: string[];
}

export interface TestRunReportOptions {
  t: TranslateFn;
  timeZone?: string;
  nowMs: number;
  /** Notify at most every, in minutes; a real-time alert's notifications follow it. */
  silenceMinutes?: number;
  /** The PromQL query divides one part by another, so "no value" means its top part matched nothing. */
  ratio?: boolean;
  /** A real-time alert's events as the 24-hour row counted them; the dry run's counts stop at a cap. */
  eventDay?: { events: number; windows: EventWindow[] } | null;
  /** The PromQL query unions alternatives with `or`, so one metric without data breaks nothing. */
  alternatives?: boolean;
  /** Check every, in minutes; absent for a cron schedule. */
  checkEveryMinutes?: number;
  previewPeak?: PreviewPeak | null;
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

/** A real-time day's events and the notifications its wait lets through, counted one way everywhere. */
export function realtimeVolume(
  r: EvaluateAlertResponse,
  waitMinutes: number,
  eventDay?: TestRunReportOptions["eventDay"],
): { events: number; atLeast: boolean; notifications: number } {
  const answered = r.checks.filter((c) => !c.error);
  const windowMinutes = (c: EvaluateAlertResponse["checks"][number]) =>
    Math.max(1, Math.round((c.window_end - c.window_start) / 60_000_000));
  const windows =
    eventDay?.windows ?? answered.map((c) => ({ events: c.value ?? 0, minutes: windowMinutes(c) }));
  const events = eventDay?.events ?? windows.reduce((sum, w) => sum + w.events, 0);
  return {
    events,
    atLeast: !eventDay && answered.some((c) => c.value_is_lower_bound),
    notifications: Math.min(events, realtimeNotifications(windows, waitMinutes)),
  };
}

// Real time notifies per event, so its day is events and notifications, never checks.
function realtimeSummary(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine {
  const { t } = o;
  const wait = o.silenceMinutes ?? 0;
  const v = realtimeVolume(r, wait, o.eventDay);
  if (v.events === 0) return { id: "summary", text: t("alerts.testRun.neverFired"), tone: "body" };
  const events = formatNumber(v.events);
  const params = {
    events: t(
      "alerts.sections.backtest.matchingEvents",
      { count: v.atLeast ? t("alerts.verdict.atLeast", { value: events }) : events },
      v.events,
    ),
    count: formatNumber(v.notifications),
  };
  return {
    id: "summary",
    text:
      wait > 0
        ? t(
            "alerts.testRun.realtimeSentWait",
            { ...params, wait: durationWords(wait, t) },
            v.notifications,
          )
        : t("alerts.testRun.realtimeSent", params, v.notifications),
    tone: "body",
  };
}

function summaryLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine {
  const { t } = o;
  const s = r.summary;
  if (r.is_real_time) return realtimeSummary(r, o);
  // A run cut short names the hours it reached instead of the day.
  const tested = testedMinutes(r);
  const span = tested === null ? null : spanWords(tested, t);
  if (s.notifications === 0)
    return {
      id: "summary",
      text: span ? t("alerts.testRun.neverFiredSpan", { span }) : t("alerts.testRun.neverFired"),
      tone: "body",
    };
  const times = notifiedTimes(s, o);
  // Checks that fired and notifications are counted apart, so the held line below adds up to the first.
  const params = {
    count: formatNumber(s.notifications),
    fired: formatNumber(firedRan(r)),
    checks: formatNumber(s.checks - skippedChecks(r).length),
    times,
    ...(span ? { span } : {}),
  };
  const groupTotal = Math.max(s.groups_fired_total, s.groups_fired.length);
  if (!s.groups_fired.length)
    return {
      id: "summary",
      text: t(
        span ? "alerts.testRun.firedInChecksSpan" : "alerts.testRun.firedInChecks",
        params,
        s.notifications,
      ),
      tone: "body",
    };
  const groups = t("alerts.testRun.groupCount", { count: formatNumber(groupTotal) }, groupTotal);
  // One check can notify many groups, so the count is of checks that sent, not of notifications.
  return {
    id: "summary",
    text: t(
      span
        ? "alerts.testRun.firedInChecksGroupsSentSpan"
        : "alerts.testRun.firedInChecksGroupsSent",
      { ...params, groups },
      s.notifications,
    ),
    tone: "body",
  };
}

/** The value that came nearest the threshold: in a check Must last held, else in any check of the day. */
function closestLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const side = thresholdSide(r.checks[0]?.operator);
  if (side !== "above" && side !== "below") return null;
  const pending = r.checks.filter((check) => check.state === "pending");
  const scanned = pending.length ? pending : r.checks.filter((c) => !c.error && !c.skipped);
  const keys = labelKeys(scanned.flatMap((check) => (check.groups ?? []).map((g) => g.labels)));
  type Seen = { value: number; labels: Record<string, string> | null; time: number };
  const seen = scanned.flatMap((check): Seen[] =>
    check.groups?.length
      ? check.groups.map((g) => ({ value: g.value as number, labels: g.labels, time: check.time }))
      : [{ value: check.value as number, labels: null, time: check.time }],
  );
  let best: Seen | null = null;
  for (const item of seen) {
    if (typeof item.value !== "number" || !Number.isFinite(item.value)) continue;
    if (best && (side === "above" ? item.value <= best.value : item.value >= best.value)) continue;
    best = item;
  }
  // A peak of nothing past an above threshold only repeats that nothing matched.
  if (!best || (side === "above" && best.value === 0)) return null;
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

/** How many groups the latest check found past the threshold; its time sets it apart from the preview's "now". */
function latestGroupsLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const { t } = o;
  const latest = r.checks.findLast((c) => !c.skipped);
  if (!latest || latest.error) return null;
  const time = checkTimeText(latest.time, o.timeZone, o.nowMs);
  // One PromQL alert has no groups; its filtered query returns just the series past the threshold.
  if (!r.summary.groups_fired.length) {
    if (r.query_type !== "promql" || !r.summary.fired) return null;
    return {
      id: "latestGroups",
      text: t(
        LATEST_SERIES_KEYS[thresholdSide(latest.operator) ?? "none"],
        { count: formatNumber(latest.matched), time },
        latest.matched,
      ),
      tone: "secondary",
    };
  }
  const over = (latest.groups ?? []).filter((g) => g.fired).length;
  // The server lists at most 100 groups, fired first; a full list of fired ones may hold more.
  const atLeast = over === (latest.groups ?? []).length && latest.groups_total > over;
  const count = atLeast
    ? t("alerts.verdict.atLeast", { value: formatNumber(over) })
    : formatNumber(over);
  return {
    id: "latestGroups",
    text: t(LATEST_GROUPS_KEYS[thresholdSide(latest.operator) ?? "none"], { count, time }, over),
    tone: "secondary",
  };
}

function noSeriesLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const { t } = o;
  const metrics = r.diagnostics?.metrics ?? [];
  // A check that fired matched, so the line is only for a day where none did.
  if (!metrics.length || !r.checks.length || r.checks.some((c) => c.matched > 0)) return null;
  const present = metrics.filter((m) => m.series > 0).map((m) => m.name);
  const missing = metrics.filter((m) => m.series === 0).map((m) => m.name);
  const line = (text: I18nText, tone: TestRunTone): TestRunLine => ({ id: "noSeries", text, tone });
  // The ratio's parts all read data, so its top part found nothing to count: the share is 0.
  if (o.ratio && present.length && (!missing.length || o.alternatives))
    return line(t("alerts.testRun.noValueRatioDay"), "secondary");
  if (!present.length)
    return metrics.length === 1
      ? line(t("alerts.testRun.noDataOne", { metric: raw(missing[0]) }), "warning")
      : line(t("alerts.testRun.noDataAny", { metrics: joinList(missing) }), "warning");
  if (!missing.length)
    return line(
      t("alerts.testRun.dataNoMatch", { metrics: joinList(present) }, present.length === 1 ? 1 : 2),
      "secondary",
    );
  // Without `or`, every metric the query reads must have data for it to return anything.
  return line(
    t("alerts.testRun.noMatchSomeMissing", { metrics: joinList(missing) }, missing.length),
    o.alternatives ? "secondary" : "warning",
  );
}

/** Each check reads the value at its own time, so a peak the preview drew between two checks is never seen. */
function betweenChecksLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const peak = o.previewPeak;
  const every = o.checkEveryMinutes ?? 0;
  const side = thresholdSide(r.checks[0]?.operator);
  if (!peak || every <= 0 || r.query_type !== "promql" || r.is_real_time || !side) return null;
  const at = peak.atMs * 1000;
  const ran = r.checks.filter((c) => !c.error && !c.skipped);
  const before = ran.findLast((c) => c.time <= at);
  const after = ran.find((c) => c.time >= at);
  if (!before || !after) return null;
  // The two checks around the peak read less than it, across every series they saw.
  const seen = [before, after]
    .flatMap((c) => (c.groups?.length ? c.groups.map((g) => g.value) : [c.value]))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const beyond = (v: number) => (side === "above" ? peak.value > v : peak.value < v);
  if (!seen.length || !seen.every(beyond)) return null;
  return {
    id: "betweenChecks",
    text: o.t("alerts.testRun.betweenChecks", {
      every: durationWords(every, o.t),
      value: testValueText(peak.value, null, o.t),
      time: checkTimeText(at, o.timeZone, o.nowMs),
    }),
    tone: "secondary",
  };
}

// Groups wait apart: a check notifies when any group is past its wait, so the rest are checks where none was.
function heldLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const { t } = o;
  const s = r.summary;
  const held = r.checks.filter((c) => c.held_by === "notify_at_most_every" && !c.skipped).length;
  if (!held || r.is_real_time) return null;
  const params = { count: formatNumber(held) };
  const wait = o.silenceMinutes ?? 0;
  const exact = held === firedRan(r) - s.notifications && wait > 0;
  const key: I18nKey = !exact
    ? "alerts.testRun.held"
    : s.groups_fired.length
      ? "alerts.testRun.heldGroups"
      : "alerts.testRun.heldWait";
  return {
    id: "held",
    text: t(key, exact ? { ...params, wait: durationWords(wait, t) } : params, held),
    tone: "secondary",
  };
}

// The scheduler does not run an alert again until its wait ends, so those checks are not counted as runs.
function pausedLine(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunLine | null {
  const paused = skippedChecks(r).length;
  const wait = o.silenceMinutes ?? 0;
  if (!paused || r.is_real_time || wait <= 0) return null;
  return {
    id: "paused",
    text: o.t(
      "alerts.testRun.paused",
      { count: formatNumber(paused), wait: durationWords(wait, o.t) },
      paused,
    ),
    tone: "secondary",
  };
}

function truncatedLine(r: EvaluateAlertResponse, t: TranslateFn): TestRunLine | null {
  if (!r.truncated) return null;
  const tested = r.is_real_time ? null : testedMinutes(r);
  return {
    id: "truncated",
    text:
      tested === null
        ? t("alerts.testRun.truncated", { count: formatNumber(r.summary.checks) })
        : t("alerts.testRun.truncatedSpan", {
            rest: spanWords(DAY_MINUTES - roundSpan(tested), t),
          }),
    tone: "warning",
  };
}

/** The lines Test it shows for one dry run: what would have fired over the day, and why not. */
export function testRunReport(r: EvaluateAlertResponse, o: TestRunReportOptions): TestRunReport {
  const { t } = o;
  const s = r.summary;
  const lines: TestRunLine[] = [summaryLine(r, o)];
  const truncated = truncatedLine(r, t);
  if (truncated) lines.push(truncated);
  if (s.notifications === 0 && s.pending > 0)
    lines.push({
      id: "pendingOnly",
      text: t("alerts.testRun.pendingOnly", { count: formatNumber(s.pending) }, s.pending),
      tone: "secondary",
    });
  // A day that never fired says how near it came, so the threshold can be judged against it.
  const closest = s.notifications === 0 && !r.is_real_time ? closestLine(r, o) : null;
  if (closest) lines.push(closest);
  const answered = r.checks.filter((c) => !c.error);
  if (r.query_type !== "promql" && answered.length && answered.every((c) => c.reason === "no_data"))
    lines.push({ id: "matchedNothing", text: t("alerts.guard.matchedNothing"), tone: "secondary" });
  const latestGroups = latestGroupsLine(r, o);
  if (latestGroups) lines.push(latestGroups);
  const paused = pausedLine(r, o);
  if (paused) lines.push(paused);
  const held = heldLine(r, o);
  if (held) lines.push(held);
  const between = betweenChecksLine(r, o);
  if (between) lines.push(between);
  const noSeries = noSeriesLine(r, o);
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
  const keys = labelKeys(s.groups_fired.map((g) => g.labels));
  const groups = s.groups_fired.slice(0, SHOWN_GROUPS).map((g) => ({
    label: groupLabel(g.labels, g.key, keys),
    text: t("alerts.testRun.checkCount", { count: formatNumber(g.checks) }, g.checks),
  }));
  const groupsMore = Math.max(
    0,
    Math.max(s.groups_fired_total, s.groups_fired.length) - groups.length,
  );
  const groupsHeading = groups.length
    ? t(GROUPS_HEADING_KEYS[thresholdSide(r.checks[0]?.operator) ?? "none"])
    : null;
  return { lines, groupsHeading, groups, groupsMore };
}

/** The tested day by the hour, for the 24-hour strip. */
export function testRunDay(r: EvaluateAlertResponse): TestRunDay {
  const hours = Array.from({ length: DAY_HOURS }, () => false);
  const ran = r.checks.filter((c) => !c.skipped);
  const perHour = Array.from({ length: DAY_HOURS }, () => ({ checks: 0, fired: 0, events: 0 }));
  const dayStart = r.end - DAY_HOURS * HOUR_MICROS;
  const hourOf = (time: number) =>
    Math.min(DAY_HOURS - 1, Math.max(0, Math.floor((time - dayStart) / HOUR_MICROS)));
  for (const check of r.checks) {
    if (!check.fired) continue;
    hours[hourOf(check.time)] = true;
  }
  for (const check of ran) {
    const slot = perHour[hourOf(check.time)];
    slot.checks += 1;
    slot.fired += check.fired ? 1 : 0;
    slot.events += check.error ? 0 : (check.value ?? 0);
  }
  const busiest = Math.max(0, ...perHour.map((h) => h.events));
  const hourShares = perHour.map((h, i) => {
    if (!hours[i]) return 0;
    if (r.is_real_time) return busiest > 0 ? h.events / busiest : 1;
    return h.checks ? h.fired / h.checks : 1;
  });
  const answered = r.checks.filter((c) => !c.error);
  const empty = answered.length > 0 && answered.every((c) => c.reason === "no_data");
  const events = r.is_real_time
    ? answered.reduce((sum, c) => sum + (c.value ?? 0), 0)
    : empty
      ? 0
      : undefined;
  const firing = ran.map((c) => c.fired);
  let refires = 0;
  let singleCheckSpikes = 0;
  ran.forEach((check, i) => {
    if (!check.fired) return;
    if (i + 2 < firing.length && !firing[i + 1] && firing[i + 2]) refires += 1;
    if (check.notified && !firing[i - 1] && i + 1 < firing.length && !firing[i + 1])
      singleCheckSpikes += 1;
  });
  const tested = testedMinutes(r);
  return {
    fired: firedRan(r),
    alerts: r.summary.notifications,
    total: r.summary.checks,
    pending: r.summary.pending ?? 0,
    hours,
    hourShares,
    hourTallies: perHour,
    refires,
    singleCheckSpikes,
    untestedHours: tested === null ? 0 : Math.floor((DAY_MINUTES - tested) / 60),
    ...(events === undefined ? {} : { events }),
  };
}

/** The drawn sample furthest past the threshold's side, with its time; gaps are skipped. */
export function seriesPeak(
  series: ReadonlyArray<{ data?: unknown }>,
  side: "above" | "below",
): PreviewPeak | null {
  let peak: PreviewPeak | null = null;
  for (const { data } of series) {
    if (!Array.isArray(data)) continue;
    for (const point of data) {
      if (!Array.isArray(point) || point[1] === null || point[1] === "") continue;
      const value = Number(point[1]);
      const x = point[0];
      const atMs =
        x instanceof Date ? x.getTime() : typeof x === "string" ? Date.parse(x) : Number(x);
      if (!Number.isFinite(value) || !Number.isFinite(atMs)) continue;
      if (peak && (side === "above" ? value <= peak.value : value >= peak.value)) continue;
      peak = { value, atMs };
    }
  }
  return peak;
}

/**
 * The PromQL preview's step: the 12 and 24 hour views sample at check times, as the checks read the
 * value; the default view keeps the server's finer step unless that skips most checks.
 */
export function promqlPreviewStepSeconds(
  rangeMinutes: number,
  everyMinutes: number,
  fixedRange: boolean,
): number {
  if (!(everyMinutes > 0) || rangeMinutes / everyMinutes > DAY_MINUTES) return 0;
  const serverCoarser = rangeMinutes / 300 > everyMinutes;
  return fixedRange || serverCoarser ? everyMinutes * 60 : 0;
}

type ConditionNode = {
  filterType?: string;
  logicalOperator?: string;
  column?: string;
  operator?: string;
  value?: unknown;
  conditions?: ConditionNode[];
};

/** The filter's root group, from either the saved `{ version, conditions }` form or the bare group. */
export const conditionsRoot = (conditions: unknown): ConditionNode | undefined => {
  const node = conditions as (ConditionNode & { version?: unknown }) | null | undefined;
  if (!node) return undefined;
  return node.filterType === "group" ? node : (node.conditions as ConditionNode | undefined);
};

/** The one filter that names several values, when an all-AND filter has exactly one; null otherwise. */
export function valueSplitFilter(conditions: unknown): ValueSplit | null {
  const root = conditionsRoot(conditions);
  const found: ValueSplit[] = [];
  let anyOr = false;
  const walk = (node: ConditionNode | undefined) => {
    if (!node) return;
    if (node.filterType === "group") {
      if (
        String(node.logicalOperator ?? "AND").toUpperCase() !== "AND" &&
        (node.conditions?.length ?? 0) > 1
      )
        anyOr = true;
      node.conditions?.forEach(walk);
      return;
    }
    if (String(node.logicalOperator ?? "AND").toUpperCase() === "OR") anyOr = true;
    const values = Array.isArray(node.value) ? node.value.map(String) : [];
    if (node.column && String(node.operator).toLowerCase() === "in" && values.length > 1)
      found.push({ column: node.column, values });
  };
  walk(root);
  return !anyOr && found.length === 1 ? found[0] : null;
}

/** Each filter value's matching events, busiest first; a value with none reads 0. */
export function valueSplitText(
  values: readonly string[],
  rows: ReadonlyArray<{ v?: unknown; n?: unknown }>,
  t: TranslateFn,
): I18nText {
  const counts = new Map(values.map((v) => [v, 0]));
  for (const row of rows) {
    const key = String(row.v);
    if (counts.has(key)) counts.set(key, Number(row.n) || 0);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const items = sorted
    .slice(0, SHOWN_GROUPS)
    .map(([value, n]) =>
      t("alerts.testRun.valueCount", { value: raw(value), count: formatNumber(n) }),
    );
  return t("alerts.testRun.byValue", { list: listWithMore(items, sorted.length, t) });
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
