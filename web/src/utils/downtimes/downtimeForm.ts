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

import type { I18nKey, TranslateFn } from "@/types/i18n";
import type { V2Group } from "@/utils/alerts/alertDataTransforms";
import type {
  Downtime,
  DowntimeNotifications,
  DowntimeRequest,
  DowntimeSchedule,
  DowntimeTarget,
  IncidentMode,
  NotificationEvent,
  Repeat,
  SloCorrectionMode,
  TargetModule,
} from "@/services/downtimes";
import {
  andEqPairs,
  builderToCondition,
  conditionToBuilder,
  emptyBuilderGroup,
} from "./conditionBridge";
import { MODULE_ORDER, type FolderNameFn } from "./targetSummary";
import {
  durationInput,
  formatWindowTime,
  isoWeekday,
  localToUtcMicros,
  parseDuration,
  utcMicrosToLocal,
} from "./schedule";
import { canonicalTimezone } from "@/utils/timezoneAliases";

/** The "All folders" option inside the Folders select. */
export const ALL_FOLDERS = "__all__";

const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000;
// Four hours of quarter steps covers an hour plus the largest DST jump.
const MAX_HOUR_SEARCH_STEPS = 16;

// The server names an unnarrowed module the same way, so the title shows what Save stores.
const AUTO_NAME_ALL_KEYS = {
  alerts: "alerts.downtimes.autoName.all.alerts",
  anomaly_detections: "alerts.downtimes.autoName.all.anomaly_detections",
  synthetics: "alerts.downtimes.autoName.all.synthetics",
  slos: "alerts.downtimes.autoName.all.slos",
} as const satisfies Record<TargetModule, I18nKey>;

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  "started",
  "ending_soon",
  "ended",
  "cancelled",
  "extended",
];

export const DEFAULT_LEAD_SECS = 600;
export const MAX_NOTIFY_DESTINATIONS = 10;

/** The per-target caps of the backend `validate_target`, checked here as field errors. */
export const MAX_FOLDERS_PER_TARGET = 50;
export const MAX_TAGS_PER_TARGET = 16;
export const MAX_IDS_PER_TARGET = 200;

export interface TargetFormValues {
  folders: string[];
  tags_open: boolean;
  tags: string[];
  ids_open: boolean;
  ids: string[];
  slo_mode: SloCorrectionMode;
  incident_mode: IncidentMode;
}

export interface ScheduleFormValues {
  repeat: Repeat;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  duration: string;
  weekdays: number[];
  until_date: string;
  timezone: string;
  /** A loaded recurring row's `starts_at`, kept while `start_date` and `timezone` are unchanged so a mid-day start survives an edit. */
  starts_at: number | null;
  /** The zone `starts_at` was loaded in. */
  starts_at_timezone: string | null;
}

export interface NotifyFormValues extends Record<NotificationEvent, boolean> {
  destinations: string[];
  lead: string;
}

export interface DowntimeFormValues extends Record<string, unknown> {
  name: string;
  folder_id: string;
  modules: TargetModule[];
  condition_open: boolean;
  condition: V2Group | null;
  targets: Record<TargetModule, TargetFormValues>;
  schedule: ScheduleFormValues;
  reason: string;
  show_banner: boolean;
  notifications: NotifyFormValues;
}

/** What a row action already knows, read from the create page's query string. */
export interface DowntimePrefill {
  module?: TargetModule;
  ids?: string[];
  folderIds?: string[];
  folderId?: string;
}

const emptyTarget = (): TargetFormValues => ({
  folders: [ALL_FOLDERS],
  tags_open: false,
  tags: [],
  ids_open: false,
  ids: [],
  slo_mode: "exclude",
  incident_mode: "muted",
});

export const hasIdentity = (module: TargetModule): boolean => module !== "synthetics";

/** The next full hour on the wall clock of `timezone`, so a zone at a half-hour offset or DST step still starts on :00. */
export function nextFullHourMs(nowMs: number, timezone: string): number {
  // Every UTC offset and DST step is a multiple of 15 minutes, so a full local hour falls on a 15-minute UTC boundary.
  let at = Math.ceil(nowMs / QUARTER_MS) * QUARTER_MS;
  for (let step = 0; step < MAX_HOUR_SEARCH_STEPS; step += 1, at += QUARTER_MS) {
    if (utcMicrosToLocal(at * 1000, timezone).time.endsWith(":00")) return at;
  }
  return Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
}

const emptyNotify = (): NotifyFormValues => ({
  destinations: [],
  started: false,
  ending_soon: false,
  ended: false,
  cancelled: false,
  extended: false,
  lead: durationInput(DEFAULT_LEAD_SECS),
});

/** A new downtime: once, from the next full hour for one hour, in the viewer's zone. */
export function defaultDowntimeValues(nowMs: number, timezone: string): DowntimeFormValues {
  const nextHour = nextFullHourMs(nowMs, timezone);
  const start = utcMicrosToLocal(nextHour * 1000, timezone);
  const end = utcMicrosToLocal((nextHour + HOUR_MS) * 1000, timezone);
  return {
    name: "",
    folder_id: "default",
    modules: ["alerts"],
    condition_open: false,
    condition: emptyBuilderGroup(),
    targets: {
      alerts: emptyTarget(),
      anomaly_detections: emptyTarget(),
      synthetics: emptyTarget(),
      slos: emptyTarget(),
    },
    schedule: {
      repeat: "none",
      start_date: start.date,
      start_time: start.time,
      end_date: end.date,
      end_time: end.time,
      duration: "1h",
      weekdays: [],
      until_date: "",
      timezone,
      starts_at: null,
      starts_at_timezone: null,
    },
    reason: "",
    show_banner: true,
    notifications: emptyNotify(),
  };
}

/** The schedule after the user picks another repeat: once on the next full hour, recurring from today, weekly on today's weekday. */
export function scheduleForRepeat(
  s: ScheduleFormValues,
  repeat: Repeat,
  nowMs: number,
): ScheduleFormValues {
  const timezone = s.timezone || "UTC";
  if (repeat === "none") {
    const once = defaultDowntimeValues(nowMs, timezone).schedule;
    return {
      ...s,
      repeat,
      start_date: once.start_date,
      start_time: once.start_time,
      end_date: once.end_date,
      end_time: once.end_time,
    };
  }
  const today = utcMicrosToLocal(nowMs * 1000, timezone).date;
  const weekdays =
    repeat === "weekly" && s.weekdays.length === 0 ? [isoWeekday(today)] : [...s.weekdays];
  return { ...s, repeat, start_date: today, weekdays };
}

export function notifyAfterPick(prev: NotifyFormValues, destinations: string[]): NotifyFormValues {
  const first = prev.destinations.length === 0 && destinations.length > 0;
  const anyOn = NOTIFICATION_EVENTS.some((e) => prev[e]);
  if (!first || anyOn) return { ...prev, destinations };
  return { ...prev, destinations, ending_soon: true, ended: true };
}

/** A row action pre-fills one module, all folders unless it passed some, and its ids. */
export function applyPrefill(
  values: DowntimeFormValues,
  prefill: DowntimePrefill,
): DowntimeFormValues {
  if (!prefill.module) return values;
  const target: TargetFormValues = {
    ...emptyTarget(),
    folders: prefill.folderIds?.length ? [...prefill.folderIds] : [ALL_FOLDERS],
    ids_open: !!prefill.ids?.length,
    ids: [...(prefill.ids ?? [])],
  };
  return {
    ...values,
    folder_id: prefill.folderId || values.folder_id,
    modules: [prefill.module],
    targets: { ...values.targets, [prefill.module]: target },
  };
}

/** Choosing "All folders" clears the folders, and choosing a folder clears "All folders". */
export function exclusiveAllFolders(next: string[], prev: string[]): string[] {
  const addedAll = next.includes(ALL_FOLDERS) && !prev.includes(ALL_FOLDERS);
  if (addedAll) return [ALL_FOLDERS];
  if (next.includes(ALL_FOLDERS) && next.length > 1) return next.filter((f) => f !== ALL_FOLDERS);
  return next;
}

/** The chosen modules that narrow nothing: all folders, no ids, no tags, and no condition. */
export function unnarrowedModules(values: DowntimeFormValues): TargetModule[] {
  const conditionApplies = values.condition_open;
  return values.modules.filter((m) => {
    const tv = values.targets[m];
    if (!tv.folders.includes(ALL_FOLDERS)) return false;
    if (tv.ids_open && tv.ids.length) return false;
    if (m === "synthetics" && tv.tags_open && tv.tags.length) return false;
    return !(hasIdentity(m) && conditionApplies);
  });
}

const buildTarget = (module: TargetModule, tv: TargetFormValues): DowntimeTarget => {
  const target: DowntimeTarget = {
    module,
    folders: tv.folders.includes(ALL_FOLDERS)
      ? { kind: "all" }
      : { kind: "some", folder_ids: [...tv.folders] },
  };
  if (module === "synthetics" && tv.tags_open && tv.tags.length) target.tags = [...tv.tags];
  if (tv.ids_open && tv.ids.length) target.ids = [...tv.ids];
  if (module === "slos") target.slo_mode = tv.slo_mode;
  // The server omits the default, so sending only `none` keeps a saved row and its edit equal.
  if (module === "alerts" && tv.incident_mode === "none") target.incident_mode = "none";
  return target;
};

export function buildTargets(values: DowntimeFormValues): DowntimeTarget[] {
  return MODULE_ORDER.filter((m) => values.modules.includes(m)).map((m) =>
    buildTarget(m, values.targets[m]),
  );
}

/** The shared condition is sent only while its block is open and a module has an identity. */
export function buildCondition(values: DowntimeFormValues) {
  if (!values.condition_open || !values.modules.some(hasIdentity)) return undefined;
  return builderToCondition(values.condition) ?? undefined;
}

/** A recurring row starts at the loaded `starts_at` while its day and zone are unchanged, else at 00:00 of `start_date`. */
const recurringStartsAt = (s: ScheduleFormValues): number => {
  const loaded = s.starts_at;
  const sameZone = loaded !== null && s.starts_at_timezone === s.timezone;
  if (sameZone && utcMicrosToLocal(loaded, s.timezone).date === s.start_date) return loaded;
  return localToUtcMicros(s.start_date, "00:00", s.timezone) ?? 0;
};

export function buildSchedule(s: ScheduleFormValues): DowntimeSchedule {
  if (s.repeat === "none") {
    const startsAt = localToUtcMicros(s.start_date, s.start_time, s.timezone) ?? 0;
    const endsAt = localToUtcMicros(s.end_date, s.end_time, s.timezone) ?? startsAt;
    return {
      repeat: "none",
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: s.timezone,
      duration_secs: Math.round((endsAt - startsAt) / 1_000_000),
      weekdays: [],
    };
  }
  return {
    repeat: s.repeat,
    starts_at: recurringStartsAt(s),
    ends_at: s.until_date ? localToUtcMicros(s.until_date, "23:59", s.timezone) : null,
    timezone: s.timezone,
    start_time_local: s.start_time,
    duration_secs: parseDuration(s.duration) ?? 0,
    weekdays: s.repeat === "weekly" ? [...s.weekdays].sort((a, b) => a - b) : [],
  };
}

export function buildNotifications(n: NotifyFormValues): DowntimeNotifications | undefined {
  if (n.destinations.length === 0) return undefined;
  return {
    destinations: [...n.destinations],
    events: {
      started: n.started,
      ending_soon: n.ending_soon,
      ended: n.ended,
      cancelled: n.cancelled,
      extended: n.extended,
    },
    ending_soon_lead_secs: parseDuration(n.lead) ?? DEFAULT_LEAD_SECS,
  };
}

/** The request body, with explicit keys: schema-only helpers never reach the API. */
export function buildDowntimeRequest(values: DowntimeFormValues): DowntimeRequest {
  const body: DowntimeRequest = {
    folder_id: values.folder_id || "default",
    targets: buildTargets(values),
    schedule: buildSchedule(values.schedule),
    show_banner: values.show_banner,
  };
  const name = values.name.trim();
  if (name) body.name = name;
  const reason = values.reason.trim();
  if (reason) body.reason = reason;
  const condition = buildCondition(values);
  if (condition) body.condition = condition;
  const notifications = buildNotifications(values.notifications);
  if (notifications) body.notifications = notifications;
  return body;
}

const notifyValues = (n: DowntimeNotifications | undefined): NotifyFormValues => {
  if (!n) return emptyNotify();
  return {
    destinations: [...n.destinations],
    started: !!n.events.started,
    ending_soon: !!n.events.ending_soon,
    ended: !!n.events.ended,
    cancelled: !!n.events.cancelled,
    extended: !!n.events.extended,
    lead: durationInput(n.ending_soon_lead_secs),
  };
};

const scheduleValues = (s: DowntimeSchedule): ScheduleFormValues => {
  const start = utcMicrosToLocal(s.starts_at, s.timezone);
  const end = s.ends_at ? utcMicrosToLocal(s.ends_at, s.timezone) : { date: "", time: "" };
  const once = s.repeat === "none";
  return {
    repeat: s.repeat,
    start_date: start.date,
    start_time: once ? start.time : (s.start_time_local ?? ""),
    end_date: once ? end.date : "",
    end_time: once ? end.time : "",
    duration: durationInput(s.duration_secs),
    weekdays: [...s.weekdays],
    until_date: once ? "" : end.date,
    timezone: canonicalTimezone(s.timezone),
    starts_at: once ? null : s.starts_at,
    starts_at_timezone: once ? null : canonicalTimezone(s.timezone),
  };
};

const targetValues = (target: DowntimeTarget | undefined): TargetFormValues => {
  if (!target) return emptyTarget();
  return {
    folders: target.folders.kind === "all" ? [ALL_FOLDERS] : [...target.folders.folder_ids],
    tags_open: !!target.tags?.length,
    tags: [...(target.tags ?? [])],
    ids_open: !!target.ids?.length,
    ids: [...(target.ids ?? [])],
    slo_mode: target.slo_mode ?? "exclude",
    incident_mode: target.incident_mode ?? "muted",
  };
};

/** Edit and Duplicate: a saved row back into the form, the reverse of `buildDowntimeRequest`. */
export function downtimeToFormValues(d: Downtime): DowntimeFormValues {
  const byModule = new Map(d.targets.map((t) => [t.module, t]));
  return {
    name: d.name,
    folder_id: d.folder_id || "default",
    modules: MODULE_ORDER.filter((m) => byModule.has(m)),
    condition_open: !!d.condition,
    condition: d.condition ? conditionToBuilder(d.condition) : emptyBuilderGroup(),
    targets: {
      alerts: targetValues(byModule.get("alerts")),
      anomaly_detections: targetValues(byModule.get("anomaly_detections")),
      synthetics: targetValues(byModule.get("synthetics")),
      slos: targetValues(byModule.get("slos")),
    },
    schedule: scheduleValues(d.schedule),
    reason: d.reason ?? "",
    show_banner: d.show_banner,
    notifications: notifyValues(d.notifications),
  };
}

/** Resolves a picked item's display name. */
export type ItemNameFn = (module: TargetModule, id: string) => string | undefined;

const autoNameSubject = (
  values: DowntimeFormValues,
  t: TranslateFn,
  itemName?: ItemNameFn,
  folderName?: FolderNameFn,
): string => {
  const firstEq = andEqPairs(buildCondition(values) ?? null).find((p) => p.key && p.value);
  if (firstEq) return `${firstEq.key}=${firstEq.value}`;
  const first = buildTargets(values)[0];
  if (!first) return "";
  if (first.tags?.length) return first.tags[0];
  const ids = first.ids ?? [];
  if (ids.length === 1) return itemName?.(first.module, ids[0]) ?? "";
  if (ids.length > 1) {
    return t("alerts.downtimes.summary.nItems", { count: ids.length }, ids.length);
  }
  if (first.folders.kind === "some") {
    const id = first.folders.folder_ids[0];
    return folderName?.(first.module, id) ?? id;
  }
  return t(AUTO_NAME_ALL_KEYS[first.module]);
};

const autoNameWhen = (s: ScheduleFormValues, t: TranslateFn, locale?: string): string => {
  if (s.repeat === "daily") return t("alerts.downtimes.autoName.daily");
  if (s.repeat === "weekly") return t("alerts.downtimes.autoName.weekly");
  const start = localToUtcMicros(s.start_date, s.start_time, s.timezone);
  if (start === null) return t("alerts.downtimes.autoName.once");
  const date = formatWindowTime(start, s.timezone, locale).split(",")[0];
  return t("alerts.downtimes.autoName.onceOn", { date });
};

/** The generated name, `<first = pair, tag, item or folder> · <once date | daily | weekly>`. */
export function buildDowntimeAutoName(
  values: DowntimeFormValues,
  t: TranslateFn,
  itemName?: ItemNameFn,
  folderName?: FolderNameFn,
  locale?: string,
): string {
  const subject = autoNameSubject(values, t, itemName, folderName);
  if (!subject) return "";
  return `${subject} · ${autoNameWhen(values.schedule, t, locale)}`;
}
