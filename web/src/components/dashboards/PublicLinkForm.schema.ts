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
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { PublicLink, PublicLinkConfig } from "@/services/public_dashboards_admin";
import type { TranslateFn } from "@/types/i18n";

export const PRESET_SECONDS = [900, 3600, 21600, 86400, 604800, 2592000];

export const makePublicLinkSchema = (t: TranslateFn, minRebuildSecs: number, today: string) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t("dashboard.publicLinks.nameRequired"))
        .max(256, t("dashboard.publicLinks.nameTooLong")),
      presets: z.array(z.number()),
      defaultPreset: z.number(),
      // OFormInput emits a string even for type="number".
      rebuildSecs: z
        .union([z.string(), z.number()])
        .refine(
          (v) => Number.isInteger(Number(v)) && Number(v) >= minRebuildSecs,
          t("dashboard.publicDashboard.refreshEveryMin", { secs: minRebuildSecs }),
        ),
      // YYYY-MM-DD strings compare correctly as text.
      expires: z
        .string()
        .refine((v) => v === "" || v >= today, t("dashboard.publicLinks.expiresInPast")),
    })
    .superRefine((v, ctx) => {
      if (!v.presets.length) {
        ctx.addIssue({
          code: "custom",
          path: ["presets"],
          message: t("dashboard.publicLinks.presetsRequired"),
        });
      } else if (!v.presets.includes(v.defaultPreset)) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultPreset"],
          message: t("dashboard.publicLinks.defaultNotAvailable"),
        });
      }
    });

export type PublicLinkForm = z.infer<ReturnType<typeof makePublicLinkSchema>>;

export const publicLinkDefaults = (): PublicLinkForm => ({
  name: "",
  presets: [3600, 86400],
  defaultPreset: 3600,
  rebuildSecs: "60",
  expires: "",
});

/** Pre-fill the form from an existing link, showing its expiry as a date in the author's timezone. */
export const publicLinkFormFrom = (link: PublicLink, timezone: string): PublicLinkForm => {
  const allowed = link.time_range.allowed_presets_secs ?? [];
  const defaultPreset = link.time_range.default_range_secs ?? allowed[0] ?? 3600;
  return {
    name: link.name,
    presets: link.time_range.editable && allowed.length ? allowed : [defaultPreset],
    defaultPreset,
    rebuildSecs: String(link.rebuild_secs),
    expires: link.expires_at
      ? formatInTimeZone(link.expires_at / 1000, timezone, "yyyy-MM-dd")
      : "",
  };
};

/** The link stops at the end of the chosen day in the author's timezone, sent as UTC microseconds. */
export const endOfDayMicros = (date: string, timezone: string): number =>
  fromZonedTime(`${date}T23:59:59.999`, timezone).getTime() * 1000;

/** Today as YYYY-MM-DD in the author's timezone, the earliest expiry date allowed. */
export const todayIn = (timezone: string, now: Date = new Date()): string =>
  formatInTimeZone(now, timezone, "yyyy-MM-dd");

export const toPublicLinkConfig = (
  value: PublicLinkForm,
  frozenVariables: Record<string, unknown>,
  timezone: string,
): PublicLinkConfig => {
  const presets = value.presets.slice().sort((a, b) => a - b);
  return {
    name: value.name.trim(),
    visibility: "public",
    time_range: {
      // One range means the link is fixed to it; several let viewers switch.
      editable: presets.length > 1,
      default_range_secs: value.defaultPreset,
      allowed_presets_secs: presets,
    },
    frozen_variables: frozenVariables,
    rebuild_secs: Number(value.rebuildSecs),
    expires_at: value.expires ? endOfDayMicros(value.expires, timezone) : null,
  };
};
