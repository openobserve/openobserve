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

import type { RouteLocationRaw } from "vue-router";
import config from "@/aws-exports";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import { buildLogsRoute } from "@/utils/metrics/metricDrilldown";
import type { ReviewFocus } from "@/components/alert_calibration/digests";
import type { ReviewAlertAction } from "@/components/alert_calibration/applySuggestion";
import {
  ADVICE_LABEL,
  insightActionLabel,
  isErrorClass,
  type ErrorClass,
} from "@/components/alert_calibration/rules";
import { dismissableOf, type DismissTarget } from "@/components/alert_calibration/dismissals";

export type InsightTone = "failure" | "gap" | "info";

export interface InsightChip {
  label: I18nText;
  variant: BadgeVariant;
  tone: InsightTone;
}

/** Where a button goes; the review path looks up the alert's folder on click, so it is not a plain route. */
export type InsightTarget =
  | { type: "review_alert"; action: ReviewAlertAction; alertName: string; findingId: string }
  | { type: "route"; to: RouteLocationRaw };

export interface InsightCta {
  key: string;
  label: I18nText;
  target: InsightTarget;
  note: I18nText | null;
}

export interface InsightFact {
  label: I18nText;
  variant: BadgeVariant;
}

export interface InsightParts {
  id: string;
  chip: InsightChip;
  headline: I18nText;
  why: I18nText | null;
  whyDetail: I18nText | null;
  next: I18nText | null;
  cta: InsightCta | null;
  secondary: InsightCta[];
  note: I18nText | null;
  facts: InsightFact[];
  meta: I18nText | null;
  dismissable: DismissTarget | null;
}

export interface InsightToday {
  label: I18nText;
  headline: I18nText;
  why: I18nText | null;
  body: I18nText;
  tags: InsightFact[];
}

type TypedAction =
  ReviewAlertAction | { type: "review_source"; stream_type: string; stream_name: string };

export interface InsightZone {
  locale: string;
  timeZone: string;
}

const NOT_WORKING = "alert_not_working";

const HOUR_US = 3_600_000_000;

const TONE_VARIANT: Record<InsightTone, BadgeVariant> = {
  failure: "error-soft",
  gap: "warning-soft",
  info: "default-soft",
};

// An alert or monitor that cannot fire or tells no one is a failure; a missing check is a gap.
const KIND_TONE: Record<string, InsightTone> = {
  alert_not_working: "failure",
  silent_coverage: "failure",
  blind_guardrail: "failure",
  coverage_gap: "gap",
  no_absence_check: "gap",
  coverage_lost: "gap",
  discovery_unusable: "info",
};

const REVIEW_FOCI: readonly ReviewFocus[] = ["settings", "threshold", "query", "grouping"];

const REVIEW_NOTE: Record<ReviewFocus | "unfocused", I18nKey> = {
  query: "insight.note.reviewQuery",
  threshold: "insight.note.reviewThreshold",
  settings: "insight.note.reviewSettings",
  grouping: "insight.note.reviewAlert",
  unfocused: "insight.note.reviewAlert",
};

const ERROR_TYPE: Record<ErrorClass, I18nKey> = {
  stream_missing: "insight.alert.errorType.stream_missing",
  field_missing: "insight.alert.errorType.field_missing",
  syntax: "insight.alert.errorType.syntax",
  resource_timeout: "insight.alert.errorType.resource_timeout",
  resource_memory: "insight.alert.errorType.resource_memory",
  other: "insight.alert.errorType.other",
};

const WINDOW_UNITS: [number, "day" | "hour" | "minute"][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
];

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const isEnterprise = () => config.isEnterprise === "true";

const countText = (value: number, locale: string): I18nText =>
  raw(new Intl.NumberFormat(locale).format(value));

const timeText = (micros: number, zone: InsightZone): I18nText =>
  raw(
    new Intl.DateTimeFormat(zone.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone.timeZone,
    }).format(micros / 1000),
  );

const windowText = (secs: number, locale: string): I18nText => {
  const [size, unit] = WINDOW_UNITS.find(([s]) => secs >= s && secs % s === 0) ?? [60, "minute"];
  const value = Math.max(1, Math.round(secs / size));
  return raw(
    new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value),
  );
};

/** Only an action this build can label becomes a button; an unknown or malformed one is dropped, never shown raw. */
const typedActions = (item: AutoObserveSuggestion): TypedAction[] =>
  (Array.isArray(item.actions) ? (item.actions as unknown[]) : []).flatMap(
    (value): TypedAction[] => {
      if (typeof value !== "object" || value === null) return [];
      const action = value as Record<string, unknown>;
      if (action.type === "review_source") {
        const { stream_type, stream_name } = action;
        return typeof stream_type === "string" && typeof stream_name === "string" && stream_name
          ? [{ type: "review_source", stream_type, stream_name }]
          : [];
      }
      if (action.type !== "review_alert" || typeof action.alert_id !== "string" || !action.alert_id)
        return [];
      if (action.focus === undefined || action.focus === null)
        return [{ type: "review_alert", alert_id: action.alert_id }];
      return REVIEW_FOCI.includes(action.focus as ReviewFocus)
        ? [
            {
              type: "review_alert",
              alert_id: action.alert_id,
              focus: action.focus as ReviewFocus,
            },
          ]
        : [];
    },
  );

const alertWhy = (t: TranslateFn, zone: InsightZone, item: AutoObserveSuggestion) => {
  const ev = item.evidence;
  if (text(ev.pattern) === "empty_scope") {
    const searched = num(ev.searched_secs);
    return searched && searched > 0
      ? t("insight.alert.whyEmptyScope", { window: windowText(searched, zone.locale) })
      : null;
  }
  const failed = num(ev.evaluation_errors);
  const total = num(ev.evaluations);
  if (failed === null || total === null || failed <= 0 || total <= 0) return null;
  const counts = { failed: countText(failed, zone.locale), total: countText(total, zone.locale) };
  const since = num(ev.first_failure_at);
  const lastGood = num(ev.last_success_at);
  if (since !== null && lastGood !== null && isErrorClass(ev.error_class))
    return t(
      "insight.alert.why",
      {
        ...counts,
        time: timeText(since, zone),
        errorType: t(ERROR_TYPE[ev.error_class]),
        lastGood: timeText(lastGood, zone),
      },
      total,
    );
  if (since !== null && lastGood === null)
    return t("insight.alert.whyNever", { ...counts, time: timeText(since, zone) }, total);
  return t("insight.alert.whyCount", counts, total);
};

const alertNext = (t: TranslateFn, item: AutoObserveSuggestion): I18nText | null =>
  item.advice && Object.hasOwn(ADVICE_LABEL, item.advice) ? t(ADVICE_LABEL[item.advice]) : null;

// Logs opens an hour before the last data so the last normal rows are on screen; else the run's own window.
const logsWindow = (
  item: AutoObserveSuggestion,
  nowMs: number,
): { from: number; to: number; note: I18nKey } => {
  const now = nowMs * 1000;
  const lastData = num(item.evidence.last_data_at);
  if (lastData !== null)
    return { from: lastData - HOUR_US, to: now, note: "insight.note.openInLogs" };
  const start = num(item.evidence.run_window_start);
  const end = num(item.evidence.run_window_end);
  if (start !== null && end !== null && end > start)
    return { from: start, to: end, note: "insight.note.openInLogsRun" };
  return { from: now - HOUR_US, to: now, note: "insight.note.openInLogsHour" };
};

const logsCta = (
  t: TranslateFn,
  item: AutoObserveSuggestion,
  stream: string,
  nowMs: number,
): InsightCta => {
  const range = logsWindow(item, nowMs);
  return {
    key: `logs-${stream}`,
    label: t("insight.actions.openInLogs"),
    target: {
      type: "route",
      to: buildLogsRoute({
        stream,
        filters: {},
        timeRange: { start_time: range.from, end_time: range.to },
        org: item.org,
      }),
    },
    note: t(range.note, { stream: raw(stream) }),
  };
};

const reviewCta = (
  t: TranslateFn,
  item: AutoObserveSuggestion,
  action: ReviewAlertAction,
): InsightCta => ({
  key: `review-${action.focus ?? "alert"}`,
  label: t(insightActionLabel(action)),
  target: {
    type: "review_alert",
    action,
    alertName: text(item.evidence.alert_name) || text(item.evidence.monitor_name),
    findingId: item.kind === NOT_WORKING ? text(item.evidence.finding_id) : "",
  },
  note: t(REVIEW_NOTE[action.focus ?? "unfocused"]),
});

// Only logs streams open in Logs; a metrics or traces source has no rows page to land on.
const ctaOf = (t: TranslateFn, item: AutoObserveSuggestion, nowMs: number): InsightCta | null => {
  for (const action of typedActions(item)) {
    if (action.type === "review_alert") return reviewCta(t, item, action);
    if (action.stream_type === "logs") return logsCta(t, item, action.stream_name, nowMs);
  }
  return null;
};

// The record names its stream as "type/name"; a missing stream has no rows to open.
const evidenceLogsStream = (item: AutoObserveSuggestion): string | null => {
  if (text(item.evidence.pattern) === "stream_missing") return null;
  const [type, ...rest] = text(item.evidence.stream).split("/");
  const name = rest.join("/");
  return type === "logs" && name ? name : null;
};

const calibrationCta = (t: TranslateFn, item: AutoObserveSuggestion): InsightCta | null => {
  const start = num(item.evidence.run_window_start);
  const end = num(item.evidence.run_window_end);
  if (start === null || end === null) return null;
  const rule = text(item.evidence.rule_id);
  return {
    key: "calibration",
    label: t("insight.actions.openInCalibration"),
    target: {
      type: "route",
      to: {
        name: "alertCalibrationDigest",
        params: { windowStart: String(start), windowEnd: String(end) },
        query: { org_identifier: item.org, ...(rule ? { rule } : {}) },
      },
    },
    note: null,
  };
};

const notWorkingParts = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveSuggestion,
  today: InsightToday,
  nowMs: number,
): InsightParts => {
  const cta = ctaOf(t, item, nowMs);
  const stream = evidenceLogsStream(item);
  const logs = stream && cta?.key !== `logs-${stream}` ? logsCta(t, item, stream, nowMs) : null;
  const calibration = calibrationCta(t, item);
  return {
    id: item.id,
    chip: { label: t("insight.chip.notWorking"), variant: TONE_VARIANT.failure, tone: "failure" },
    headline: today.headline,
    why: alertWhy(t, zone, item),
    whyDetail: null,
    next: alertNext(t, item),
    cta,
    secondary: [logs, calibration].filter((c): c is InsightCta => c !== null),
    note: cta?.note ?? null,
    facts: today.tags,
    meta: today.why,
    dismissable: dismissableOf(item),
  };
};

const todayParts = (
  t: TranslateFn,
  item: AutoObserveSuggestion,
  today: InsightToday,
  nowMs: number,
): InsightParts => {
  const tone = KIND_TONE[item.kind] ?? "info";
  const cta = ctaOf(t, item, nowMs);
  return {
    id: item.id,
    chip: { label: today.label, variant: TONE_VARIANT[tone], tone },
    headline: today.headline,
    why: today.why,
    whyDetail: today.body,
    next: null,
    cta,
    secondary: [],
    note: cta?.note ?? null,
    facts: today.tags,
    meta: null,
    dismissable: null,
  };
};

// The OSS build has no AutoObserve backend to write through, so nothing there writes or navigates.
const forBuild = (parts: InsightParts): InsightParts =>
  isEnterprise() ? parts : { ...parts, cta: null, secondary: [], note: null, dismissable: null };

export const insightCopy = (
  t: TranslateFn,
  zone: InsightZone,
  item: AutoObserveSuggestion,
  today: InsightToday,
  nowMs: number = Date.now(),
): InsightParts =>
  forBuild(
    item.kind === NOT_WORKING
      ? notWorkingParts(t, zone, item, today, nowMs)
      : todayParts(t, item, today, nowMs),
  );
