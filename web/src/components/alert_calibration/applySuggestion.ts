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
import {
  ALERT_PREFILL_VERSION,
  type AlertEditFocus,
  type AlertEditHandoff,
  type AlertFieldPatch,
} from "@/ts/interfaces/alertPrefill";
import {
  CALIBRATION_PREFILL,
  isValidPatch,
  PATCH_FOCUS,
  type PatchKey,
  type PatchValue,
  type PlannedField,
} from "@/utils/alerts/alertEditHandoff";
import type { FieldChange } from "@/services/autoobserveDecisions";
import { arrayColumn, type DigestRecord, type InsightAction, type ReviewFocus } from "./digests";
import { formatMinutes, formatSeconds } from "./format";

/** The wire field names of an `apply_suggestion` patch (spec-detail 4a), each mapped to the design's key. */
export const APPLY_FIELDS = {
  pending_period_secs: "pendingPeriodSecs",
  keep_firing_for_secs: "keepFiringForSecs",
  silence_minutes: "silenceMinutes",
  destinations: "destinations",
} as const satisfies Record<string, PatchKey>;

const ACTION_KEYS = ["type", "alert_id", "patch"];

const CHANGE_KEYS = ["field", "from", "to"];

/** Names past this many are counted, not listed, so a list stays one line. */
const LISTED_NAMES = 3;

/** The editor's own label for each field, so the prompt and the form name it alike. */
const FIELD_LABEL: Record<PatchKey, I18nKey> = {
  pendingPeriodSecs: "alerts.queryConfig.pendingPeriod",
  keepFiringForSecs: "alerts.alertSettings.keepFiringFor",
  silenceMinutes: "alerts.silenceNotification",
  destinations: "alerts.destinationsLabel",
};

const CONSEQUENCE: Record<PatchKey, I18nKey> = {
  pendingPeriodSecs: "alertCalibration.apply.consequence.pendingPeriod",
  keepFiringForSecs: "alertCalibration.apply.consequence.keepFiringFor",
  silenceMinutes: "alertCalibration.apply.consequence.silence",
  destinations: "alertCalibration.apply.consequence.destinations",
};

const NOT_APPLIED: Record<NotAppliedReason, I18nKey> = {
  draft: "alertCalibration.apply.editor.notApplied.draft",
  stale: "alertCalibration.apply.editor.notApplied.stale",
  invalid: "alertCalibration.apply.editor.notApplied.invalid",
  missingDestination: "alertCalibration.apply.editor.notApplied.missingDestination",
};

/** Grouping lives in the query, and settings has no single field to focus. */
const REVIEW_FOCUS: Record<ReviewFocus, AlertEditFocus | null> = {
  query: "query",
  threshold: "threshold",
  grouping: "query",
  settings: null,
};

/** A failing-notifications review with no field to focus goes to the failing destination (CTA-MAP §3). */
const RULE_FOCUS: Partial<Record<string, AlertEditFocus>> = { notify_failed: "destinations" };

export type ApplyField = keyof typeof APPLY_FIELDS;

export interface ApplyChange {
  field: ApplyField;
  from: PatchValue;
  to: PatchValue;
}

/** A finding's suggested settings change; the writer phases add the matching Rust variant (P6-D1). */
export interface ApplySuggestion {
  type: "apply_suggestion";
  alert_id: string;
  patch: ApplyChange[];
}

export type ReviewAlertAction = Extract<InsightAction, { type: "review_alert" }>;

export type NotAppliedReason = "draft" | "stale" | "invalid" | "missingDestination";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isApplyField = (value: unknown): value is ApplyField =>
  typeof value === "string" && value in APPLY_FIELDS;

/** The patch in the design's keys, in the writer's order. */
export const patchOf = (action: ApplySuggestion): AlertFieldPatch =>
  Object.fromEntries(
    action.patch.map((change) => [
      APPLY_FIELDS[change.field],
      { from: change.from, to: change.to },
    ]),
  );

/** The inverse of patchOf: a stored patch back in the wire's field names, as the decision route lists them. */
export const fieldsOf = (patch: AlertFieldPatch): FieldChange[] =>
  (Object.entries(APPLY_FIELDS) as [ApplyField, PatchKey][]).flatMap(([field, key]) => {
    const change = patch[key];
    return change ? [{ field, from: change.from, to: change.to } as FieldChange] : [];
  });

function parseApplySuggestion(item: unknown, alertId: string | undefined): ApplySuggestion | null {
  if (!isRecord(item) || item.type !== "apply_suggestion") return null;
  // Any other key (a second target such as `alert_ids`, or a field this build cannot check) drops the action.
  if (Object.keys(item).some((key) => !ACTION_KEYS.includes(key))) return null;
  if (typeof item.alert_id !== "string" || item.alert_id !== alertId) return null;
  if (!Array.isArray(item.patch)) return null;
  const changes = item.patch;
  if (
    !changes.every(
      (change) =>
        isRecord(change) &&
        Object.keys(change).every((key) => CHANGE_KEYS.includes(key)) &&
        isApplyField(change.field),
    )
  )
    return null;
  const fields = changes.map((change) => change.field);
  if (new Set(fields).size !== fields.length) return null;
  const action: ApplySuggestion = {
    type: "apply_suggestion",
    alert_id: item.alert_id,
    patch: changes.map((change) => ({ field: change.field, from: change.from, to: change.to })),
  };
  return isValidPatch(patchOf(action)) ? action : null;
}

/** A finding's apply suggestions; one with any bad part is dropped whole, never applied in part. */
export function applySuggestionsOf(record: DigestRecord): ApplySuggestion[] {
  return (arrayColumn(record.insight_actions) ?? []).flatMap((item) => {
    const action = parseApplySuggestion(item, record.alert_id);
    return action ? [action] : [];
  });
}

/** An insight's change for its own alert, under the same rules as a digest row's; null when there is none. */
export function applySuggestionIn(
  actions: unknown,
  alertId: string | undefined,
): ApplySuggestion | null {
  for (const item of Array.isArray(actions) ? actions : []) {
    const action = parseApplySuggestion(item, alertId);
    if (action) return action;
  }
  return null;
}

/** The one handoff the editor reads; an apply carries its patch and focuses its first field. */
export function toEditHandoff(
  action: ApplySuggestion | ReviewAlertAction,
  finding: Pick<DigestRecord, "finding_id"> & { rule_id?: string },
): AlertEditHandoff {
  const base = {
    version: ALERT_PREFILL_VERSION,
    source: CALIBRATION_PREFILL,
    target: { alertId: action.alert_id, findingId: finding.finding_id ?? "" },
  } as const;
  if (action.type === "apply_suggestion") {
    const patch = patchOf(action);
    return { ...base, focus: PATCH_FOCUS[APPLY_FIELDS[action.patch[0].field]], patch };
  }
  const named = action.focus ? REVIEW_FOCUS[action.focus] : null;
  const focus = named ?? (finding.rule_id ? (RULE_FOCUS[finding.rule_id] ?? null) : null);
  return focus ? { ...base, focus } : { ...base };
}

/** Opens the editor on the suggestion's first field without changing anything, for a suggestion that cannot apply. */
export function toReviewHandoff(action: ApplySuggestion, finding: DigestRecord): AlertEditHandoff {
  const { version, source, target, focus } = toEditHandoff(action, finding);
  return { version, source, target, focus };
}

/** The one copy helper for the card, the prompt and the editor banner (spec-detail 9). */
export function applyCopy(t: TranslateFn, locale: string) {
  const list = (names: string[]): I18nText => {
    const shown = names.slice(0, LISTED_NAMES);
    const rest = names.length - shown.length;
    const items = rest > 0 ? [...shown, t("alertCalibration.apply.more", { count: rest })] : shown;
    return raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(items));
  };

  const fieldLabel = (key: PatchKey): I18nText => t(FIELD_LABEL[key]);

  const value = (key: PatchKey, v: PatchValue): I18nText => {
    if (Array.isArray(v)) return v.length ? list(v) : t("alertCalibration.apply.noDestination");
    return key === "silenceMinutes" ? formatMinutes(t, v) : formatSeconds(t, v);
  };

  const change = (field: PlannedField): I18nText =>
    t("alertCalibration.apply.change", {
      setting: fieldLabel(field.key),
      current: value(field.key, field.live),
      suggested: value(field.key, field.to),
    });

  const changes = (fields: PlannedField[]): I18nText =>
    raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(fields.map(change)));

  return {
    button: () => t("alertCalibration.apply.button"),
    title: (alert: string) => t("alertCalibration.apply.title", { alert: raw(alert) }),
    note: () => t("alertCalibration.apply.note"),
    continueLabel: () => t("alertCalibration.apply.continue"),
    cancel: () => t("common.cancel"),
    reviewInstead: () => t("alertCalibration.apply.reviewInstead"),
    setting: () => t("alertCalibration.apply.setting"),
    current: () => t("alertCalibration.apply.current"),
    suggested: () => t("alertCalibration.apply.suggested"),
    deleted: () => t("alertCalibration.apply.deleted"),
    denied: () => t("alertCalibration.apply.denied"),
    failed: () => t("alertCalibration.apply.failed"),
    retry: () => t("alertCalibration.retry"),
    unsupported: () => t("alertCalibration.apply.unsupported"),
    review: () => t("alertCalibration.apply.editor.review"),
    list,
    fieldLabel,
    value,
    changes,
    consequence: (key: PatchKey, to: PatchValue) =>
      t(CONSEQUENCE[key], { value: value(key, to), list: value(key, to) }),
    stale: (field: PlannedField) =>
      t("alertCalibration.apply.stale", {
        setting: fieldLabel(field.key),
        current: value(field.key, field.live),
        from: value(field.key, field.from),
      }),
    applied: (fields: PlannedField[]) =>
      t("alertCalibration.apply.editor.applied", { changes: changes(fields) }),
    notApplied: (reason: NotAppliedReason, names: string[] = []) =>
      t(NOT_APPLIED[reason], { names: list(names) }, Math.max(names.length, 1)),
    /** One "Setting old → new" line per applied field, as What I've changed and an applied row show it. */
    appliedLines: (fields: FieldChange[]): string[] =>
      fields.flatMap((f) => {
        if (!isApplyField(f.field)) return [];
        const key = APPLY_FIELDS[f.field];
        return [`${fieldLabel(key)} ${value(key, f.from)} → ${value(key, f.to)}`];
      }),
  };
}

export type ApplyCopy = ReturnType<typeof applyCopy>;
