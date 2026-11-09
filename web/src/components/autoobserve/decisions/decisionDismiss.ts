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
};

/** m13's four reasons, in its order. */
export const DECISION_DISMISS_REASONS: readonly DecisionReason[] = [
  "not_needed",
  "planned_work",
  "false_positive",
  "will_fix_later",
];

/** m13 and the server's cap: rolling upgrades and maintenance windows end within a week. */
export const PLANNED_WORK_MAX_MS = 7 * 86_400_000;
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

/** No reason is preselected, so the reader always says why; planned work ends two whole hours out. */
export function decisionDismissDefaults(nowMs: number): DecisionDismissForm {
  const end = Math.ceil(nowMs / HOUR_MS) * HOUR_MS + HOUR_MS;
  return { reason: "", untilDate: localDate(end), untilTime: localTime(end) };
}

export const makeDecisionDismissSchema = (t: TranslateFn, now: () => number = Date.now) =>
  z
    .object({
      reason: z
        .string()
        .refine(isDecisionDismissReason, t("insight.decisions.dismiss.reasonRequired")),
      untilDate: z.string(),
      untilTime: z.string(),
    })
    .superRefine((form, ctx) => {
      if (form.reason !== "planned_work") return;
      const until = untilMicros(form);
      if (until === null) {
        ctx.addIssue({
          code: "custom",
          path: ["untilTime"],
          message: t("insight.decisions.dismiss.untilRequired"),
        });
      } else if (!isUntilInRange(until, now())) {
        ctx.addIssue({
          code: "custom",
          path: ["untilTime"],
          message: t("insight.decisions.dismiss.untilInvalid"),
        });
      }
    });

/** The preview asks with the terms chosen so far; an unfinished planned-work end asks with none. */
export function previewParamsOf(
  target: DecisionTarget,
  form: DecisionDismissForm,
  nowMs: number,
): PreviewParams {
  const base: PreviewParams = { family: target.family, id: target.id, action: "dismiss" };
  if (!isDecisionDismissReason(form.reason)) return base;
  if (form.reason !== "planned_work") return { ...base, reason: form.reason };
  const until = untilMicros(form);
  return isUntilInRange(until, nowMs) ? { ...base, reason: form.reason, until: until! } : base;
}

export function decisionBodyOf(
  target: DecisionTarget,
  form: DecisionDismissForm,
  seen: { requestId: string; revision: number },
): DecisionRequest {
  const reason = form.reason as DecisionReason;
  const until = reason === "planned_work" ? untilMicros(form) : null;
  return {
    family: target.family,
    id: target.id,
    action: "dismiss",
    reason,
    ...(until !== null ? { until } : {}),
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
