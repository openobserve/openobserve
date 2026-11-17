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

import config from "@/aws-exports";
import {
  ALERT_PREFILL_VERSION,
  type AlertEditFocus,
  type AlertEditHandoff,
  type AlertFieldPatch,
} from "@/ts/interfaces/alertPrefill";

/** The `?prefill=` value of a calibration handoff; not an `ALERT_SOURCES` id, which lists create surfaces. */
export const CALIBRATION_PREFILL = "calibration";

/** The `?prefill=` value of an AutoObserve edit handoff; on the add route the same value names a create prefill. */
export const AUTOOBSERVE_PREFILL = "autoobserve";

export const PATCH_KEYS = [
  "pendingPeriodSecs",
  "keepFiringForSecs",
  "silenceMinutes",
  "destinations",
] as const;

/** The editor caps keep-firing at a day (`alerts.alertSettings.keepFiringForTooLong`); pending shares it (D:L156). */
export const MAX_HOLD_SECS = 86_400;

/** Well past any folder's real destination count; a longer list is a writer bug, not a suggestion. */
export const MAX_DESTINATIONS = 20;

export const PATCH_FOCUS: Record<PatchKey, AlertEditFocus> = {
  pendingPeriodSecs: "pending_period",
  keepFiringForSecs: "keep_firing_for",
  silenceMinutes: "silence",
  destinations: "destinations",
};

const FOCUS_IDS: AlertEditFocus[] = [
  "query",
  "threshold",
  "pending_period",
  "silence",
  "destinations",
  "keep_firing_for",
];

const HANDOFF_KEYS = ["version", "source", "target", "focus", "patch"];

export type PatchKey = (typeof PATCH_KEYS)[number];

export type EditHandoffPrefill = typeof CALIBRATION_PREFILL | typeof AUTOOBSERVE_PREFILL;

export type PatchValue = number | string[];

export type EditHandoffStatus =
  "apply" | "review" | "stale" | "invalid" | "unsupported" | "missing_destination";

/** One patched setting with the value the alert holds now, in wire units. */
export interface PlannedField {
  key: PatchKey;
  from: PatchValue;
  to: PatchValue;
  live: PatchValue;
}

export interface EditHandoffPlan {
  status: EditHandoffStatus;
  fields: PlannedField[];
  focusField: AlertEditFocus | null;
  missingDestinations: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isNames = (value: unknown, min: number): value is string[] =>
  Array.isArray(value) &&
  value.length >= min &&
  value.length <= MAX_DESTINATIONS &&
  value.every((name) => typeof name === "string" && name !== "");

const sameValue = (a: PatchValue, b: PatchValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000")
    : a === b;

// pending_period_sec is whole minutes in the form (useAlertForm.ts pendingMinutes), so seconds off a minute are invalid, not rounded.
const VALID_TO: Record<PatchKey, (from: unknown, to: unknown) => boolean> = {
  pendingPeriodSecs: (from, to) =>
    isCount(from) && isCount(to) && to <= MAX_HOLD_SECS && to % 60 === 0,
  keepFiringForSecs: (from, to) => isCount(from) && isCount(to) && to <= MAX_HOLD_SECS,
  silenceMinutes: (from, to) => isCount(from) && isCount(to),
  destinations: (from, to) => isNames(from, 0) && isNames(to, 1),
};

const isPatchKey = (key: string): key is PatchKey =>
  (PATCH_KEYS as readonly string[]).includes(key);

export function isValidChange(key: PatchKey, change: unknown): boolean {
  if (!isRecord(change) || Object.keys(change).some((k) => k !== "from" && k !== "to"))
    return false;
  if (!VALID_TO[key](change.from, change.to)) return false;
  return !sameValue(change.from as PatchValue, change.to as PatchValue);
}

/** Whether the route's `prefill` asks the editor to read an edit handoff rather than seed a new alert. */
export const isEditHandoffPrefill = (prefill: unknown, editing: boolean): boolean =>
  prefill === CALIBRATION_PREFILL ||
  (editing && prefill === AUTOOBSERVE_PREFILL && config.isEnterprise === "true");

/** Every key known, every value typed and in range, and at least one change; anything else drops the whole patch. */
export function isValidPatch(patch: unknown): patch is AlertFieldPatch {
  if (!isRecord(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => isPatchKey(key) && isValidChange(key, patch[key]));
}

/** The alert's current value in wire units; a missing field reads as the form's default (useAlertForm.ts). */
export function liveValueOf(key: PatchKey, alert: Record<string, unknown>): PatchValue {
  if (key === "destinations") {
    return Array.isArray(alert.destinations)
      ? alert.destinations.filter((name): name is string => typeof name === "string")
      : [];
  }
  if (key === "silenceMinutes") {
    const trigger = isRecord(alert.trigger_condition) ? alert.trigger_condition : {};
    return Number(trigger.silence) || 0;
  }
  return (
    Number(key === "pendingPeriodSecs" ? alert.pending_period_sec : alert.keep_firing_for) || 0
  );
}

/** Suggestions change scheduled alerts only; calibration skips real-time ones (D:L383). */
export const isSupportedAlert = (alert: Record<string, unknown>): boolean =>
  alert.is_real_time !== true && alert.is_real_time !== "true" && alert.alert_type !== "composite";

/** The patch's fields in the writer's order, each with the alert's live value. */
export function plannedFields(
  patch: AlertFieldPatch,
  alert: Record<string, unknown>,
): PlannedField[] {
  return Object.keys(patch)
    .filter(isPatchKey)
    .flatMap((key) => {
      const change = patch[key];
      return change
        ? [{ key, from: change.from, to: change.to, live: liveValueOf(key, alert) }]
        : [];
    });
}

export const isStaleField = (field: PlannedField): boolean => !sameValue(field.live, field.from);

function isEditHandoff(value: unknown): value is AlertEditHandoff {
  if (!isRecord(value) || Object.keys(value).some((key) => !HANDOFF_KEYS.includes(key)))
    return false;
  const target = value.target;
  return (
    value.version === ALERT_PREFILL_VERSION &&
    value.source === CALIBRATION_PREFILL &&
    isRecord(target) &&
    typeof target.alertId === "string" &&
    typeof target.findingId === "string" &&
    (value.focus === undefined || FOCUS_IDS.includes(value.focus as AlertEditFocus)) &&
    (value.patch === undefined || isValidPatch(value.patch))
  );
}

/** Decides what the editor does with a handoff, in the order the spec checks them (spec-detail 4c). */
export function planEditHandoff(
  handoff: unknown,
  liveAlert: Record<string, unknown>,
  destinationNames: string[],
): EditHandoffPlan {
  const plan = (
    status: EditHandoffStatus,
    rest: Partial<EditHandoffPlan> = {},
  ): EditHandoffPlan => ({
    status,
    fields: [],
    focusField: null,
    missingDestinations: [],
    ...rest,
  });
  const liveId = String(liveAlert.id ?? liveAlert.alert_id ?? "");
  if (!isEditHandoff(handoff) || handoff.target.alertId !== liveId) return plan("invalid");
  if (!handoff.patch) return plan("review", { focusField: handoff.focus ?? null });
  const fields = plannedFields(handoff.patch, liveAlert);
  const planned = { fields, focusField: handoff.focus ?? PATCH_FOCUS[fields[0].key] };
  if (!isSupportedAlert(liveAlert)) return plan("unsupported", planned);
  if (fields.some(isStaleField)) return plan("stale", planned);
  const missing = (handoff.patch.destinations?.to ?? []).filter(
    (name) => !destinationNames.includes(name),
  );
  if (missing.length)
    return plan("missing_destination", { ...planned, missingDestinations: missing });
  return plan("apply", planned);
}
