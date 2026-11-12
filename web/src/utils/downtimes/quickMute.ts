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
import type { Downtime, DowntimeRequest, DowntimeTarget, TargetModule } from "@/services/downtimes";
import type { AlertGroup, AlertGroupLabel, MuteAlertRequest } from "@/ts/interfaces/alert";
import { formatInTimeZone } from "date-fns-tz";
import { formatInZone } from "@/utils/oncall";
import { DEFAULT_DOWNTIME_FOLDER } from "./folderDefault";

export type QuickMutePreset = "30m" | "1h" | "4h" | "24h";

/** Who cancels an Until-it-clears downtime when its alert clears. */
export const SYSTEM_ACTOR = "system@openobserve.ai";

/** The 24 h safety end of an Until-it-clears mute, in seconds. */
export const UNTIL_CLEAR_MAX_SECS = 86400;

// The longest preset matches the 24 h cap on an on-call snooze, which a Slack mute also sets.
export const QUICK_MUTE_PRESETS: { key: QuickMutePreset; secs: number; labelKey: I18nKey }[] = [
  { key: "30m", secs: 1800, labelKey: "alerts.downtimes.mute.presets.30m" },
  { key: "1h", secs: 3600, labelKey: "alerts.downtimes.mute.presets.1h" },
  { key: "4h", secs: 14400, labelKey: "alerts.downtimes.mute.presets.4h" },
  { key: "24h", secs: 86400, labelKey: "alerts.downtimes.mute.presets.24h" },
];

export const presetSeconds = (preset: QuickMutePreset): number =>
  QUICK_MUTE_PRESETS.find((p) => p.key === preset)?.secs ?? 3600;

/** What a row action mutes: the ids of one module. */
export interface QuickMuteSelection {
  module: TargetModule;
  ids: string[];
}

export interface QuickMuteGroupOption {
  key: string;
  labels?: AlertGroupLabel[];
  /** The rendered `k=v` text, for rows that carry no label pairs. */
  labelsText?: string;
  firingStartedAt?: number;
}

/** The one alert a Quick Mute opened from an alert screen is for; it mutes through the alert route. */
export interface QuickMuteAlertContext {
  alertId: string;
  name: string;
  /** The alert's own folder, which the alert route checks. */
  folderId?: string;
  /** A multi-alert's firing groups; absent for a single-row alert, which has no Groups field. */
  groups?: QuickMuteGroupOption[];
  groupKey?: string;
}

/** One target per module, all folders, the named ids, from now, filed in `folderId`, no banner. */
export function buildQuickMuteRequest(
  selection: QuickMuteSelection[],
  startsAtMicros: number,
  endsAtMicros: number,
  timezone: string,
  reason?: string,
  folderId: string = DEFAULT_DOWNTIME_FOLDER,
): DowntimeRequest {
  const body: DowntimeRequest = {
    folder_id: folderId,
    targets: selection
      .filter((s) => s.ids.length > 0)
      .map((s): DowntimeTarget => ({
        module: s.module,
        folders: { kind: "all" },
        ids: [...s.ids],
      })),
    schedule: {
      repeat: "none",
      starts_at: startsAtMicros,
      ends_at: endsAtMicros,
      timezone,
      duration_secs: Math.round((endsAtMicros - startsAtMicros) / 1_000_000),
      weekdays: [],
    },
    show_banner: false,
  };
  const trimmed = reason?.trim();
  if (trimmed) body.reason = trimmed;
  return body;
}

/** How an alert mute ends: when the alert clears, after whole minutes, or at an instant in microseconds. */
export type AlertMuteEnd = { untilClear: true } | { minutes: number } | { endsAt: number };

export type AlertMuteParams = AlertMuteEnd & {
  groups?: string[];
  allGroups?: boolean;
  firingStartedAt?: number;
  reason?: string;
  folderId?: string;
};

/** The body of `POST /alerts/{id}/mute`; `allGroups` wins over a group list. */
export function buildAlertMuteRequest(params: AlertMuteParams): MuteAlertRequest {
  const body: MuteAlertRequest =
    "untilClear" in params
      ? { until_clear: true }
      : "minutes" in params
        ? { minutes: params.minutes }
        : { ends_at: params.endsAt };
  if (params.allGroups) body.all_groups = true;
  else if (params.groups?.length) body.group_keys = [...params.groups];
  if (params.firingStartedAt !== undefined) body.firing_started_at = params.firingStartedAt;
  const reason = params.reason?.trim();
  if (reason) body.reason = reason;
  if (params.folderId) body.folder_id = params.folderId;
  return body;
}

/** A one-time downtime naming exactly one alert and nothing else, the shape every alert mute writes. */
export function isQuickMute(row: Pick<Downtime, "schedule" | "targets" | "condition">): boolean {
  if (row.schedule.repeat !== "none" || row.condition || row.targets.length !== 1) return false;
  const [target] = row.targets;
  return target.module === "alerts" && target.ids?.length === 1 && !target.tags?.length;
}

/** The alert cleared and OpenObserve ended its Until-it-clears mute. */
export const endedOnClear = (row: Pick<Downtime, "end_on_clear" | "cancelled_by">): boolean =>
  !!row.end_on_clear && row.cancelled_by === SYSTEM_ACTOR;

export const groupOptionOf = (group: AlertGroup): QuickMuteGroupOption => ({
  key: group.group_key,
  labels: group.labels,
  labelsText: group.group_labels,
  firingStartedAt: group.firing_started_at,
});

/** A group's label pairs as `k=v` text; the key is a hash, so its start is the last resort. */
export function groupOptionLabel(group: QuickMuteGroupOption): string {
  if (group.labels?.length) return group.labels.map((l) => `${l.name}=${l.value}`).join(", ");
  return group.labelsText || group.key.slice(0, 8);
}

/** Rows of one list can mix modules (alerts and anomaly detections); a target per module. */
export function groupSelection<T>(
  rows: T[],
  moduleOf: (row: T) => TargetModule,
  idOf: (row: T) => string,
): QuickMuteSelection[] {
  const byModule = new Map<TargetModule, string[]>();
  for (const row of rows) {
    const module = moduleOf(row);
    byModule.set(module, [...(byModule.get(module) ?? []), idOf(row)]);
  }
  return [...byModule.entries()].map(([module, ids]) => ({ module, ids }));
}

export const selectionCount = (selection: QuickMuteSelection[]): number =>
  selection.reduce((sum, s) => sum + s.ids.length, 0);

/** The clock time of an end that falls on the viewer's next calendar day, else `null`. */
export function tomorrowEndTime(
  endsAtMicros: number,
  nowMicros: number,
  tz: string,
): string | null {
  const day = (micros: number) => formatInTimeZone(new Date(micros / 1000), tz, "yyyy-MM-dd");
  const tomorrow = formatInTimeZone(new Date(nowMicros / 1000 + 86_400_000), tz, "yyyy-MM-dd");
  if (day(endsAtMicros) !== tomorrow || day(nowMicros) === tomorrow) return null;
  return formatInTimeZone(new Date(endsAtMicros / 1000), tz, "h:mm a");
}

/** A bare clock time reads as today, so an end on a later day names its day. */
export function endTimeText(
  endsAtMicros: number,
  nowMicros: number,
  tz: string,
  t: TranslateFn,
): I18nText {
  const day = (micros: number) => formatInTimeZone(new Date(micros / 1000), tz, "yyyy-MM-dd");
  const time = raw(formatInZone(endsAtMicros, tz, { timeStyle: "short" }));
  if (day(endsAtMicros) === day(nowMicros)) return time;
  if (tomorrowEndTime(endsAtMicros, nowMicros, tz)) {
    return t("toastMessages.downtimes.timeTomorrow", { time });
  }
  return raw(formatInZone(endsAtMicros, tz, { dateStyle: "medium", timeStyle: "short" }));
}
