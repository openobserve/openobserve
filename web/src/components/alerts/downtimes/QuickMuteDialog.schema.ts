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
import {
  MAX_DURATION_SECS,
  MIN_DURATION_SECS,
  localToUtcMicros,
  utcMicrosToLocal,
} from "@/utils/downtimes/schedule";
import {
  QUICK_MUTE_PRESETS,
  UNTIL_CLEAR_MAX_SECS,
  presetSeconds,
  type QuickMutePreset,
} from "@/utils/downtimes/quickMute";

export type QuickMuteChoice = QuickMutePreset | "untilClear" | "custom";

/** Which groups an alert mute covers; only a multi-alert shows the choice. */
export type QuickMuteGroupScope = "this" | "all";

export interface QuickMuteForm extends Record<string, unknown> {
  preset: QuickMuteChoice;
  end_date: string;
  end_time: string;
  reason: string;
  folder_id: string;
  group_scope?: QuickMuteGroupScope;
  groups?: string[];
}

/** The end of the mute in microseconds UTC, or null while a custom end is incomplete. */
export function quickMuteEndsAt(v: QuickMuteForm, nowMicros: number, tz: string): number | null {
  if (v.preset === "untilClear") return nowMicros + UNTIL_CLEAR_MAX_SECS * 1_000_000;
  if (v.preset !== "custom") return nowMicros + presetSeconds(v.preset) * 1_000_000;
  return localToUtcMicros(v.end_date, v.end_time, tz);
}

// The toggle offers Custom plus the presets, and Until it clears where one alert is in scope.
const PRESET_KEYS: [QuickMuteChoice, ...QuickMuteChoice[]] = [
  "custom",
  "untilClear",
  ...QUICK_MUTE_PRESETS.map((p) => p.key),
];

export interface QuickMuteSchemaOptions {
  /** An alert mute may go unfiled: the server files it when no downtime folder is open to the user.
   *  Read at each validation, since the dialog may be handed its alert after it is created. */
  folderOptional?: () => boolean;
}

export const makeQuickMuteSchema = (
  t: TranslateFn,
  tz: () => string,
  now: () => number,
  options: QuickMuteSchemaOptions = {},
) =>
  z
    .object({
      preset: z.enum(PRESET_KEYS),
      end_date: z.string(),
      end_time: z.string(),
      reason: z.string(),
      folder_id: z.string().refine((f) => !!f || !!options.folderOptional?.()),
      group_scope: z.enum(["this", "all"]).optional(),
      groups: z.array(z.string()).optional(),
    })
    .superRefine((raw, ctx) => {
      const v = raw as QuickMuteForm;
      if (v.preset !== "custom") return;
      const nowMicros = now();
      const ends = quickMuteEndsAt(v, nowMicros, tz());
      const secs = ends === null ? null : (ends - nowMicros) / 1_000_000;
      const message =
        secs === null
          ? t("alerts.downtimes.validation.endRequired")
          : secs < MIN_DURATION_SECS
            ? t("alerts.downtimes.validation.endAfterStart")
            : secs > MAX_DURATION_SECS
              ? t("alerts.downtimes.validation.windowTooLong")
              : null;
      if (message) ctx.addIssue({ code: "custom", path: ["end_date"], message });
    });

export const quickMuteDefaults = (
  nowMs: number,
  tz: string,
  folderId: string,
  preset: QuickMuteChoice = "1h",
): QuickMuteForm => {
  const end = utcMicrosToLocal((nowMs + presetSeconds("1h") * 1000) * 1000, tz);
  return { preset, end_date: end.date, end_time: end.time, reason: "", folder_id: folderId };
};
