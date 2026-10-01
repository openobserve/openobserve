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
import { presetSeconds, type QuickMutePreset } from "@/utils/downtimes/quickMute";

export interface QuickMuteForm extends Record<string, unknown> {
  preset: QuickMutePreset | "custom";
  end_date: string;
  end_time: string;
  reason: string;
}

/** The end of the mute in microseconds UTC, or null while a custom end is incomplete. */
export function quickMuteEndsAt(v: QuickMuteForm, nowMicros: number, tz: string): number | null {
  if (v.preset !== "custom") return nowMicros + presetSeconds(v.preset) * 1_000_000;
  return localToUtcMicros(v.end_date, v.end_time, tz);
}

export const makeQuickMuteSchema = (t: TranslateFn, tz: string, now: () => number) =>
  z
    .object({
      preset: z.enum(["30m", "1h", "2h", "4h", "custom"]),
      end_date: z.string(),
      end_time: z.string(),
      reason: z.string(),
    })
    .superRefine((raw, ctx) => {
      const v = raw as QuickMuteForm;
      if (v.preset !== "custom") return;
      const nowMicros = now();
      const ends = quickMuteEndsAt(v, nowMicros, tz);
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

export const quickMuteDefaults = (nowMs: number, tz: string): QuickMuteForm => {
  const end = utcMicrosToLocal((nowMs + 2 * 3_600_000) * 1000, tz);
  return { preset: "2h", end_date: end.date, end_time: end.time, reason: "" };
};
