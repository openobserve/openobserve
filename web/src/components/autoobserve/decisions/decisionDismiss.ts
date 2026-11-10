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

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";
import type {
  DecisionFamily,
  DecisionReason,
  DecisionRequest,
  PreviewParams,
} from "@/services/autoobserveDecisions";
import {
  DEFAULT_DURATION,
  DURATION_OPTIONS,
  NOTE_MAX_CHARS,
  noteLength,
  type DismissDuration,
} from "@/components/alert_calibration/dismissals";

/** What the dialog decides about: a suggestion, or a calibration finding by its finding id. */
export interface DecisionTarget {
  family: DecisionFamily;
  id: string;
  title: string | null;
}

/** A type, not an interface, so it satisfies the form's `Record<string, unknown>` bound. */
export type DecisionDismissForm = {
  reason: string;
  untilDate: string;
  untilTime: string;
  /** Hide for, asked of a calibration finding only. */
  duration: string;
  note: string;
};

/** How long a dismissal lasts, in the route's terms: exactly one of these. */
type DecisionTerm = { until: number } | { duration_days: number } | { until_reopened: true };

/** m13's four reasons, in its order. */
export const DECISION_DISMISS_REASONS: readonly DecisionReason[] = [
  "not_needed",
  "planned_work",
  "false_positive",
  "will_fix_later",
];

/** m13 and the server's cap: rolling upgrades and maintenance windows end within a week. */
export const PLANNED_WORK_MAX_MS = 7 * 86_400_000;
/** The route's DEFAULT_DAYS: m13 asks a suggestion no length, so it lasts what its preview showed. */
export const SUGGESTION_DAYS = 90;
const HOUR_MS = 3_600_000;

const pad = (n: number) => String(n).padStart(2, "0");
export const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const isDecisionDismissReason = (value: unknown): value is DecisionReason =>
  typeof value === "string" && (DECISION_DISMISS_REASONS as readonly string[]).includes(value);

/** The chosen end in the reader's zone, as Unix microseconds; null until both parts parse. */
export function untilMicros(form: Pick<DecisionDismissForm, "untilDate" | "untilTime">) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.untilDate) || !/^\d{2}:\d{2}/.test(form.untilTime)) {
    return null;
  }
  const [y, m, d] = form.untilDate.split("-").map(Number);
  const [hh, mm] = form.untilTime.split(":").map(Number);
  const ms = new Date(y, m - 1, d, hh, mm).getTime();
  return Number.isFinite(ms) ? ms * 1000 : null;
}

export const isUntilInRange = (micros: number | null, nowMs: number) =>
  micros !== null && micros > nowMs * 1000 && micros <= (nowMs + PLANNED_WORK_MAX_MS) * 1000;

const isDuration = (value: string): value is DismissDuration =>
  (DURATION_OPTIONS as readonly string[]).includes(value);

/** A calibration finding is hidden for its chosen length; a suggestion for the route's default. */
function lengthOf(family: DecisionFamily, duration: string): DecisionTerm | null {
  if (family !== "alert_finding") return { duration_days: SUGGESTION_DAYS };
  if (!isDuration(duration)) return null;
  return duration === "until_reopened"
    ? { until_reopened: true }
    : { duration_days: Number(duration) };
}

/** The one term both the preview and the write carry, so the preview checks what is saved. */
function termOf(
  family: DecisionFamily,
  form: DecisionDismissForm,
  nowMs: number | null,
): DecisionTerm | null {
  if (form.reason !== "planned_work") return lengthOf(family, form.duration);
  const until = untilMicros(form);
  if (until === null || (nowMs !== null && !isUntilInRange(until, nowMs))) return null;
  return { until };
}

/** No reason is preselected, so the reader always says why; planned work ends two whole local hours out. */
export function decisionDismissDefaults(nowMs: number): DecisionDismissForm {
  // A whole hour is the reader's, not UTC's: a half-hour zone would land on :30.
  const local = new Date(nowMs);
  local.setMinutes(0, 0, 0);
  const end = local.getTime() + 2 * HOUR_MS;
  return {
    reason: "",
    untilDate: localDate(end),
    untilTime: localTime(end),
    duration: String(DEFAULT_DURATION),
    note: "",
  };
}

export const makeDecisionDismissSchema = (
  t: TranslateFn,
  now: () => number = Date.now,
  family: () => DecisionFamily = () => "suggestion",
) =>
  z
    .object({
      reason: z
        .string()
        .refine(isDecisionDismissReason, t("insight.decisions.dismiss.reasonRequired")),
      untilDate: z.string(),
      untilTime: z.string(),
      duration: z.string(),
      note: z
        .string()
        .refine(
          (note) => noteLength(note) <= NOTE_MAX_CHARS,
          t("alertCalibration.dismiss.noteTooLong"),
        ),
    })
    .superRefine((form, ctx) => {
      if (!isDecisionDismissReason(form.reason)) return;
      if (form.reason !== "planned_work") {
        if (lengthOf(family(), form.duration) === null) {
          ctx.addIssue({
            code: "custom",
            path: ["duration"],
            message: t("insight.decisions.dismiss.durationRequired"),
          });
        }
        return;
      }
      const until = untilMicros(form);
      if (until === null) {
        ctx.addIssue({
          code: "custom",
          path: ["untilTime"],
          message: t("insight.decisions.dismiss.untilRequired"),
        });
      } else if (!isUntilInRange(until, now())) {
        const today = now();
        // A day outside the window is the date's fault; on its first or last day the time decides.
        const dateOut =
          form.untilDate < localDate(today) ||
          form.untilDate > localDate(today + PLANNED_WORK_MAX_MS);
        ctx.addIssue({
          code: "custom",
          path: [dateOut ? "untilDate" : "untilTime"],
          message: t("insight.decisions.dismiss.untilInvalid"),
        });
      }
    });

/** The preview asks with the terms chosen so far; an unfinished reason or term asks with none. */
export function previewParamsOf(
  target: DecisionTarget,
  form: DecisionDismissForm,
  nowMs: number,
): PreviewParams {
  const base: PreviewParams = { family: target.family, id: target.id, action: "dismiss" };
  if (!isDecisionDismissReason(form.reason)) return base;
  const term = termOf(target.family, form, nowMs);
  return term ? { ...base, reason: form.reason, ...term } : base;
}

export function decisionBodyOf(
  target: DecisionTarget,
  form: DecisionDismissForm,
  seen: { requestId: string; revision: number },
): DecisionRequest {
  const note = target.family === "alert_finding" ? form.note.trim() : "";
  return {
    family: target.family,
    id: target.id,
    action: "dismiss",
    reason: form.reason as DecisionReason,
    ...termOf(target.family, form, null),
    ...(note ? { note } : {}),
    ...(seen.revision > 0 ? { expected_revision: seen.revision } : {}),
    request_id: seen.requestId,
  };
}

/** Marking as an intended report hides it until someone undoes it; the alert keeps sending. */
export function intendedReportBodyOf(
  findingId: string,
  seen: { requestId: string; revision: number },
): DecisionRequest {
  return {
    family: "alert_finding",
    id: findingId,
    action: "dismiss",
    reason: "intended_report",
    until_reopened: true,
    ...(seen.revision > 0 ? { expected_revision: seen.revision } : {}),
    request_id: seen.requestId,
  };
}
