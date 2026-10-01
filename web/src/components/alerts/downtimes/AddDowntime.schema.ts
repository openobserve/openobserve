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
import type { TargetModule } from "@/services/downtimes";
import { builderToCondition } from "@/utils/downtimes/conditionBridge";
import { conditionError } from "@/utils/downtimes/conditionRules";
import {
  ALL_FOLDERS,
  hasIdentity,
  unnarrowedModules,
  type DowntimeFormValues,
  type ScheduleFormValues,
} from "@/utils/downtimes/downtimeForm";
import {
  MAX_DURATION_SECS,
  MIN_DURATION_SECS,
  isHhMm,
  localToUtcMicros,
  parseDuration,
} from "@/utils/downtimes/schedule";

export type { DowntimeFormValues } from "@/utils/downtimes/downtimeForm";

const MODULES = ["alerts", "anomaly_detections", "synthetics", "slos"] as const;

/** Answers the folder of a picked item, so an id outside the chosen folders is refused. */
export interface AddDowntimeSchemaContext {
  itemFolder?: (module: TargetModule, id: string) => string | undefined;
}

type Issue = { path: (string | number)[]; message: string };

const targetSchema = z.object({
  folders: z.array(z.string()),
  tags_open: z.boolean(),
  tags: z.array(z.string()),
  ids_open: z.boolean(),
  ids: z.array(z.string()),
  slo_mode: z.enum(["exclude", "count_as_good"]),
});

const scheduleSchema = z.object({
  repeat: z.enum(["none", "daily", "weekly"]),
  start_date: z.string(),
  start_time: z.string(),
  end_date: z.string(),
  end_time: z.string(),
  duration: z.string(),
  weekdays: z.array(z.number()),
  until_date: z.string(),
  timezone: z.string(),
});

const targetIssues = (
  v: DowntimeFormValues,
  t: TranslateFn,
  ctx: AddDowntimeSchemaContext,
): Issue[] =>
  v.modules.flatMap((m) => {
    const tv = v.targets[m];
    const at = (field: string) => ["targets", m, field];
    const issues: Issue[] = [];
    if (tv.folders.length === 0) {
      issues.push({
        path: at("folders"),
        message: t("alerts.downtimes.validation.foldersRequired"),
      });
    }
    if (m === "synthetics" && tv.tags_open && tv.tags.length === 0) {
      issues.push({ path: at("tags"), message: t("alerts.downtimes.validation.tagsRequired") });
    }
    if (tv.ids_open && tv.ids.length === 0) {
      issues.push({ path: at("ids"), message: t("alerts.downtimes.validation.idsRequired") });
    }
    const someFolders = !tv.folders.includes(ALL_FOLDERS);
    const outside = tv.ids.some((id) => {
      const folder = ctx.itemFolder?.(m, id);
      return someFolders && folder !== undefined && !tv.folders.includes(folder);
    });
    if (tv.ids_open && outside) {
      issues.push({ path: at("ids"), message: t("alerts.downtimes.validation.idOutsideFolders") });
    }
    return issues;
  });

const conditionIssues = (v: DowntimeFormValues, t: TranslateFn): Issue[] => {
  if (!v.condition_open || !v.modules.some(hasIdentity)) return [];
  const key = conditionError(builderToCondition(v.condition));
  return key ? [{ path: ["condition"], message: t(key) }] : [];
};

const onceIssues = (s: ScheduleFormValues, t: TranslateFn): Issue[] => {
  const start = localToUtcMicros(s.start_date, s.start_time, s.timezone);
  const end = localToUtcMicros(s.end_date, s.end_time, s.timezone);
  if (start === null) {
    return [
      {
        path: ["schedule", "start_date"],
        message: t("alerts.downtimes.validation.startRequired"),
      },
    ];
  }
  if (end === null) {
    return [
      {
        path: ["schedule", "end_date"],
        message: t("alerts.downtimes.validation.endRequired"),
      },
    ];
  }
  const secs = (end - start) / 1_000_000;
  if (secs <= 0) {
    return [
      {
        path: ["schedule", "end_date"],
        message: t("alerts.downtimes.validation.endAfterStart"),
      },
    ];
  }
  if (secs < MIN_DURATION_SECS) {
    return [
      {
        path: ["schedule", "end_time"],
        message: t("alerts.downtimes.validation.windowTooShort"),
      },
    ];
  }
  if (secs > MAX_DURATION_SECS) {
    return [
      {
        path: ["schedule", "end_date"],
        message: t("alerts.downtimes.validation.windowTooLong"),
      },
    ];
  }
  return [];
};

const recurringIssues = (s: ScheduleFormValues, t: TranslateFn): Issue[] => {
  const issues: Issue[] = [];
  if (!isHhMm(s.start_time)) {
    issues.push({
      path: ["schedule", "start_time"],
      message: t("alerts.downtimes.validation.startTimeRequired"),
    });
  }
  const secs = parseDuration(s.duration);
  if (secs === null || secs < MIN_DURATION_SECS || secs > MAX_DURATION_SECS) {
    issues.push({
      path: ["schedule", "duration"],
      message: t("alerts.downtimes.validation.durationInvalid"),
    });
  }
  if (s.repeat === "weekly" && s.weekdays.length === 0) {
    issues.push({
      path: ["schedule", "weekdays"],
      message: t("alerts.downtimes.validation.weekdaysRequired"),
    });
  }
  if (s.until_date && s.start_date && s.until_date < s.start_date) {
    issues.push({
      path: ["schedule", "until_date"],
      message: t("alerts.downtimes.validation.untilAfterStart"),
    });
  }
  return issues;
};

const scheduleIssues = (s: ScheduleFormValues, t: TranslateFn): Issue[] => {
  if (!s.timezone) {
    return [
      {
        path: ["schedule", "timezone"],
        message: t("alerts.downtimes.validation.timezoneRequired"),
      },
    ];
  }
  return s.repeat === "none" ? onceIssues(s, t) : recurringIssues(s, t);
};

/** Every rule of the create page; errors route to fields by path, and the tick is never sent. */
export const makeAddDowntimeSchema = (t: TranslateFn, ctx: AddDowntimeSchemaContext = {}) =>
  z
    .object({
      name: z.string().max(256, t("alerts.downtimes.validation.nameTooLong")),
      folder_id: z.string(),
      modules: z.array(z.enum(MODULES)).min(1, t("alerts.downtimes.validation.modulesRequired")),
      condition_open: z.boolean(),
      condition: z.any(),
      targets: z.object({
        alerts: targetSchema,
        anomaly_detections: targetSchema,
        synthetics: targetSchema,
        slos: targetSchema,
      }),
      schedule: scheduleSchema,
      reason: z.string(),
      show_banner: z.boolean(),
      confirm_all: z.boolean(),
    })
    .superRefine((raw, zctx) => {
      const v = raw as DowntimeFormValues;
      const issues = [
        ...targetIssues(v, t, ctx),
        ...conditionIssues(v, t),
        ...scheduleIssues(v.schedule, t),
      ];
      if (!v.confirm_all && unnarrowedModules(v).length > 0) {
        issues.push({
          path: ["confirm_all"],
          message: t("alerts.downtimes.validation.confirmRequired"),
        });
      }
      for (const issue of issues) zctx.addIssue({ code: "custom", ...issue });
    });

/** The tab whose pane owns a field path, so a failed submit can open it. */
export function tabForPath(
  path: readonly (string | number)[],
): "targets" | "schedule" | "advanced" {
  const head = String(path[0] ?? "");
  if (head === "schedule") return "schedule";
  if (head === "reason" || head === "show_banner") return "advanced";
  return "targets";
}
