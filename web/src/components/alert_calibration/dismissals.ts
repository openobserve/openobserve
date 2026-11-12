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

import { format, formatDistanceToNowStrict } from "date-fns";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import { httpStatus } from "@/services/alert_calibration";
import type { AutoObserveSuggestion } from "@/services/autoobserve";
import {
  countOrDash,
  schemaVersion,
  type FindingRecord,
  type RuleId,
  type RunRow,
} from "./digests";
import { ERROR_CLASS_LABEL, isRuleId, ruleLabelKey, type NotWorkingPattern } from "./rules";

/** The server's reasons (ENT dismissals.rs `DismissReason`) that today's dialog offers. */
export type DismissReason = "expected" | "known_issue" | "not_useful" | "false_positive" | "other";
/** Every stored reason: the decision route also records planned work and intended reports. */
export type StoredReason = DismissReason | "planned_work" | "intended_report";
/** Derived by the server: an active row past its expiry reads as expired. */
export type DismissalState = "active" | "expired" | "reopened";

/** One dismissal as the list and every write return it (ENT dismissals.rs `DismissalView`). */
export interface DismissalView {
  id: string;
  rule_id: string;
  pattern: string | null;
  scope_kind: string;
  /** The alert id; never shown. */
  scope_key: string;
  state: DismissalState;
  revision: number;
  reason: StoredReason;
  /** Null when none was written, or when this reader may not see it (`has_note` tells). */
  note: string | null;
  has_note: boolean;
  actor: string;
  dismissed_at: number;
  duration_days: number | null;
  /** Null together with `duration_days` for a dismissal that lasts until reopened. */
  expires_at: number | null;
  reopened_at: number | null;
  reopened_by: string | null;
  updated_at: number;
  /** Null once the alert is gone. */
  alert_name: string | null;
}

export interface DismissalPage {
  items: DismissalView[];
  next_cursor: string | null;
  /** Every visible matching row, the same on each page. */
  total: number;
}

/** The server refuses unknown keys and needs exactly one of `duration_days` and `until_reopened`. */
export interface DismissBody {
  rule_id: string;
  pattern?: string;
  scope_kind: "alert";
  scope_key: string;
  reason: DismissReason;
  note?: string;
  duration_days?: DismissDays;
  until_reopened?: true;
}

export const DISMISS_REASONS: readonly DismissReason[] = [
  "expected",
  "known_issue",
  "not_useful",
  "false_positive",
  "other",
];
export const DURATION_DAYS = [30, 90, 180] as const;
export type DismissDays = (typeof DURATION_DAYS)[number];
export type DismissDuration = "30" | "90" | "180" | "until_reopened";
export const DURATION_OPTIONS: readonly DismissDuration[] = ["30", "90", "180", "until_reopened"];
export const DEFAULT_DURATION: DismissDays = 90;
export const NOTE_MAX_CHARS = 500;
/** The server's largest page, and how many the client follows before it stops (P5a-D3). */
export const LIST_PAGE = 200;
export const LIST_MAX_PAGES = 5;

const FINDING_ID = /^[0-9a-f]{64}$/;

export const REASON_LABEL: Record<StoredReason, I18nKey> = {
  expected: "alertCalibration.dismiss.reasons.expected",
  known_issue: "alertCalibration.dismiss.reasons.known_issue",
  not_useful: "alertCalibration.dismiss.reasons.not_useful",
  false_positive: "alertCalibration.dismiss.reasons.false_positive",
  other: "alertCalibration.dismiss.reasons.other",
  planned_work: "insight.decisions.reasons.planned_work",
  intended_report: "insight.decisions.reasons.intended_report",
};

/** The decision route's names for the stored reasons (ENT decisions.rs `Reason::of_stored`). */
const ROUTE_REASON: Record<string, StoredReason> = {
  not_needed: "not_useful",
  will_fix_later: "known_issue",
};

/** One label per recorded decision, whichever list shows it and whichever name it arrives under. */
export const recordReasonKey = (reason: string | null): I18nKey => {
  const stored = ROUTE_REASON[reason ?? ""] ?? reason ?? "";
  return Object.hasOwn(REASON_LABEL, stored)
    ? REASON_LABEL[stored as StoredReason]
    : "alertCalibration.dismiss.reasonUnknown";
};

/** The six error classes keep their existing labels; the definition checks have their own. */
export const FINDING_PATTERN_LABEL: Record<NotWorkingPattern, I18nKey> = {
  ...ERROR_CLASS_LABEL,
  ignored_matcher: "alertCalibration.dismiss.pattern.ignored_matcher",
  empty_scope: "alertCalibration.dismiss.pattern.empty_scope",
  source_inactive: "alertCalibration.dismiss.pattern.source_inactive",
};

export type DismissableFinding = FindingRecord & {
  finding_id: string;
  scope_kind: "alert";
  scope_key: string;
};

export type DismissTarget = Pick<
  DismissableFinding,
  "finding_id" | "rule_id" | "pattern" | "scope_kind" | "scope_key" | "alert_name"
>;

/** A type, not an interface, so it satisfies the form's `Record<string, unknown>` bound. */
export type DismissForm = {
  reason: string;
  note: string;
  duration: DismissDuration;
};

export interface WriteNotice {
  variant: "error" | "warning";
  text: I18nText;
}

export interface ReopenResult {
  variant: "error" | "warning";
  text: I18nText;
  /** The list is stale after a conflict or a gone row, so it is read again. */
  refetch: boolean;
}

export const isDismissReason = (value: unknown): value is DismissReason =>
  typeof value === "string" && (DISMISS_REASONS as readonly string[]).includes(value);

const isDismissableRule = (rule: unknown): rule is RuleId =>
  typeof rule === "string" && isRuleId(rule) && rule !== "scheduler_health";

/** What the server accepts (P4-D5): a v2 per-alert finding of a known rule that names an alert. */
export function isDismissable(record: FindingRecord): record is DismissableFinding {
  return (
    schemaVersion(record) >= 2 &&
    typeof record.finding_id === "string" &&
    FINDING_ID.test(record.finding_id) &&
    record.scope_kind === "alert" &&
    !!record.scope_key &&
    isDismissableRule(record.rule_id)
  );
}

/** The AutoObserve kinds that are calibration findings, decided through the `alert_finding` family. */
export const isAlertFindingKind = (kind: string): boolean =>
  kind === "alert_not_working" || kind === "alert_no_destination" || kind === "alert_notify_failed";

export function dismissableOf(
  item: Pick<AutoObserveSuggestion, "kind" | "evidence" | "subject">,
): DismissTarget | null {
  if (!isAlertFindingKind(item.kind)) return null;
  const { finding_id, rule_id, pattern, alert_name } = item.evidence;
  const scopeKey = item.subject.key_dims.entity_id;
  if (typeof finding_id !== "string" || !FINDING_ID.test(finding_id)) return null;
  if (!isDismissableRule(rule_id) || !scopeKey) return null;
  return {
    finding_id,
    rule_id,
    ...(typeof pattern === "string" && pattern ? { pattern } : {}),
    scope_kind: "alert",
    scope_key: scopeKey,
    ...(typeof alert_name === "string" && alert_name ? { alert_name } : {}),
  };
}

/** Code points, as the server counts with `chars().count()`. */
export const noteLength = (note: string): number => Array.from(note.trim()).length;

export function dismissBodyOf(finding: DismissTarget, form: DismissForm): DismissBody {
  const note = form.note.trim();
  return {
    rule_id: finding.rule_id,
    ...(finding.pattern ? { pattern: finding.pattern } : {}),
    scope_kind: "alert",
    scope_key: finding.scope_key,
    reason: form.reason as DismissReason,
    ...(note ? { note } : {}),
    ...(form.duration === "until_reopened"
      ? { until_reopened: true as const }
      : { duration_days: Number(form.duration) as DismissDays }),
  };
}

export const activeIds = (page: { items: DismissalView[] } | null | undefined): Set<string> =>
  new Set((page?.items ?? []).filter((v) => v.state === "active").map((v) => v.id));

const isDismissed = (finding: FindingRecord, active: Set<string>) =>
  !!finding.finding_id && active.has(finding.finding_id);

export const openFindings = (findings: FindingRecord[], active: Set<string>): FindingRecord[] =>
  findings.filter((f) => !isDismissed(f, active));

/** A run already leaves out what was dismissed before it, so only later dismissals are hidden here. */
export const dismissedSinceRun = (findings: FindingRecord[], active: Set<string>): number =>
  findings.filter((f) => isDismissed(f, active)).length;

export function openCount(
  run: Pick<RunRow, "finding_count">,
  findings: FindingRecord[],
  active: Set<string>,
): number | null {
  if (run.finding_count === null) return null;
  return Math.max(0, run.finding_count - dismissedSinceRun(findings, active));
}

/** What the run itself left out as dismissed; a scoped reader gets no org total, so its own earlier dismissals stand in. */
export function hiddenByRun(
  run: Pick<RunRow, "dismissed_count" | "emitted_at">,
  page: { items: DismissalView[] } | null | undefined,
): number {
  if (typeof run.dismissed_count === "number") return run.dismissed_count;
  if (run.dismissed_count === undefined) return 0;
  return (page?.items ?? []).filter((v) => v.state === "active" && v.dismissed_at < run.emitted_at)
    .length;
}

/** The one copy helper for every P5a surface (spec-detail 7); server text is never shown. */
export function dismissalCopy(t: TranslateFn, locale: string) {
  const count = (value: number): I18nText => countOrDash(value, locale);
  const date = (micros: number): I18nText => raw(format(micros / 1000, "MMM d, yyyy"));
  const ago = (micros: number): I18nText =>
    raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

  const ruleLabel = (rule: string): I18nText =>
    t(isRuleId(rule) ? ruleLabelKey(rule, 2) : "alertCalibration.rules.other");

  const findingLabel = (rule: string, pattern?: string | null): I18nText => {
    const key = pattern ? FINDING_PATTERN_LABEL[pattern as NotWorkingPattern] : undefined;
    if (!key) return ruleLabel(rule);
    return t("alertCalibration.dismiss.findingWithPattern", {
      rule: ruleLabel(rule),
      pattern: t(key),
    });
  };

  const reasonLabel = (reason: string): I18nText => t(recordReasonKey(reason));

  const until = (view: Pick<DismissalView, "expires_at">): I18nText =>
    view.expires_at === null ? t("alertCalibration.dismiss.untilReopened") : date(view.expires_at);

  /** By status only (P5a-D2): the server's message is never shown. */
  const writeError = (error: unknown): WriteNotice => {
    switch (httpStatus(error)) {
      case 403:
        return { variant: "error", text: t("alertCalibration.dismiss.error.denied") };
      case 404:
        return { variant: "error", text: t("alertCalibration.dismiss.error.gone") };
      case 409:
        return { variant: "warning", text: t("alertCalibration.dismiss.error.changed") };
      case 429:
        return { variant: "error", text: t("alertCalibration.dismiss.error.throttled") };
      default:
        return { variant: "error", text: t("alertCalibration.dismiss.error.failed") };
    }
  };

  const reopenResult = (error: unknown): ReopenResult => {
    switch (httpStatus(error)) {
      case 403:
        return {
          variant: "error",
          text: t("alertCalibration.dismiss.reopenDenied"),
          refetch: false,
        };
      case 404:
        return { variant: "error", text: t("alertCalibration.dismiss.reopenGone"), refetch: true };
      case 409:
        return {
          variant: "warning",
          text: t("alertCalibration.dismiss.reopenChanged"),
          refetch: true,
        };
      case 429:
        return {
          variant: "error",
          text: t("alertCalibration.dismiss.error.throttled"),
          refetch: false,
        };
      default:
        return {
          variant: "error",
          text: t("alertCalibration.dismiss.reopenFailed"),
          refetch: false,
        };
    }
  };

  return {
    count,
    date,
    findingLabel,
    reasonLabel,
    until,
    writeError,
    reopenResult,
    button: () => t("alertCalibration.dismiss.button"),
    title: (alert: string | null | undefined) =>
      t("alertCalibration.dismiss.title", {
        alert: alert ? raw(alert) : t("alertCalibration.dismiss.alertFallback"),
      }),
    scopeLine: (org: string, duration: DismissDuration, nowMs: number): I18nText =>
      duration === "until_reopened"
        ? t("alertCalibration.dismiss.scopeNoEnd", { org: raw(org) })
        : t("alertCalibration.dismiss.scopeUntil", {
            org: raw(org),
            date: date((nowMs + Number(duration) * 86_400_000) * 1000),
          }),
    durationLabel: (duration: DismissDuration): I18nText =>
      duration === "until_reopened"
        ? t("alertCalibration.dismiss.untilReopened")
        : t("alertCalibration.duration.days", { count: Number(duration) }, Number(duration)),
    /** The help line under the duration, always one sentence so the dialog never grows. */
    endsLine: (duration: DismissDuration, nowMs: number): I18nText =>
      duration === "until_reopened"
        ? t("alertCalibration.dismiss.endsNever")
        : t("alertCalibration.dismiss.endsOn", {
            date: date((nowMs + Number(duration) * 86_400_000) * 1000),
          }),
    saved: (view: Pick<DismissalView, "expires_at">): I18nText =>
      view.expires_at === null
        ? t("alertCalibration.dismiss.savedNoEnd")
        : t("alertCalibration.dismiss.saved", { date: date(view.expires_at) }),
    savedWithUndo: (view: Pick<DismissalView, "expires_at">, alert: string | null | undefined) => {
      const name = alert ? raw(alert) : t("alertCalibration.dismiss.alertFallback");
      return view.expires_at === null
        ? t("alertCalibration.dismiss.savedUndoNoEnd", { alert: name })
        : t("alertCalibration.dismiss.savedUndo", { alert: name, date: date(view.expires_at) });
    },
    undo: () => t("alertCalibration.dismiss.undo"),
    filterDismissed: (total: number | null): I18nText =>
      total === null
        ? t("alertCalibration.dismiss.filterDismissed", { count: raw("—") })
        : t("alertCalibration.dismiss.filterDismissed", { count: count(total) }, total),
    allOpenDismissed: (n: number): I18nText =>
      t("alertCalibration.dismiss.allOpenDismissed", { count: count(n) }, n),
    ruleAllDismissed: (n: number): I18nText =>
      t("alertCalibration.dismiss.ruleAllDismissed", { count: count(n) }, n),
    capped: (shown: number, total: number): I18nText =>
      t("alertCalibration.dismiss.capped", { shown: count(shown), total: count(total) }, total),
    alertName: (view: Pick<DismissalView, "alert_name">): I18nText =>
      view.alert_name ? raw(view.alert_name) : t("alertCalibration.dismiss.deletedAlert"),
    byAgo: (view: Pick<DismissalView, "actor" | "dismissed_at">): I18nText =>
      t("alertCalibration.dismiss.byAgo", { actor: raw(view.actor), time: ago(view.dismissed_at) }),
    foldParts: (view: Pick<DismissalView, "actor" | "reason" | "expires_at">): I18nText[] => {
      const until =
        view.expires_at === null
          ? t("alertCalibration.dismiss.foldUntilReopened")
          : t("alertCalibration.dismiss.foldUntil", { date: date(view.expires_at) });
      if (view.reason === "intended_report") {
        return [t("alertCalibration.dismiss.markedBy", { actor: raw(view.actor) }), until];
      }
      return [
        t("alertCalibration.dismiss.byActor", { actor: raw(view.actor) }),
        reasonLabel(view.reason),
        until,
      ];
    },
    badge: (view: Pick<DismissalView, "reason">): I18nText =>
      t(
        view.reason === "intended_report"
          ? "alertCalibration.dismiss.badgeMarked"
          : "alertCalibration.dismiss.badge",
      ),
    reopened: () => t("alertCalibration.dismiss.reopened"),
  };
}

export type DismissalCopy = ReturnType<typeof dismissalCopy>;
