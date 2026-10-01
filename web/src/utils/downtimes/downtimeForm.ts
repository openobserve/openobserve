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

import type { TranslateFn } from "@/types/i18n";
import type { V2Group } from "@/utils/alerts/alertDataTransforms";
import type {
  Downtime,
  DowntimeRequest,
  DowntimeSchedule,
  DowntimeTarget,
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
  localToUtcMicros,
  parseDuration,
  utcMicrosToLocal,
} from "./schedule";

/** The "All folders" option inside the Folders select. */
export const ALL_FOLDERS = "__all__";

export interface TargetFormValues {
  folders: string[];
  tags_open: boolean;
  tags: string[];
  ids_open: boolean;
  ids: string[];
  slo_mode: SloCorrectionMode;
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
  confirm_all: boolean;
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
});

export const hasIdentity = (module: TargetModule): boolean => module !== "synthetics";

/** A new downtime: once, from the next full hour for one hour, in the viewer's zone. */
export function defaultDowntimeValues(nowMs: number, timezone: string): DowntimeFormValues {
  const nextHour = Math.ceil(nowMs / 3_600_000) * 3_600_000;
  const start = utcMicrosToLocal(nextHour * 1000, timezone);
  const end = utcMicrosToLocal((nextHour + 3_600_000) * 1000, timezone);
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
    },
    reason: "",
    show_banner: true,
    confirm_all: false,
  };
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
    starts_at: localToUtcMicros(s.start_date, "00:00", s.timezone) ?? 0,
    ends_at: s.until_date ? localToUtcMicros(s.until_date, "23:59", s.timezone) : null,
    timezone: s.timezone,
    start_time_local: s.start_time,
    duration_secs: parseDuration(s.duration) ?? 0,
    weekdays: s.repeat === "weekly" ? [...s.weekdays].sort((a, b) => a - b) : [],
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
  return body;
}

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
    timezone: s.timezone,
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
    confirm_all: false,
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
  return "";
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
