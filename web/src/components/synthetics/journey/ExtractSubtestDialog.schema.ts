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
import type { BrowserCheckSchedule } from "@/types/synthetics";
import { NAME_MAX_BYTES } from "@/utils/synthetics/buildExtractedChild";

/** The interval presets `CheckSchedule.vue` offers, keyed so `OSelect` can hold them. */
export const SCHEDULE_PRESETS = {
  "1min": { type: "interval", intervalValue: 1, intervalUnit: "minutes" },
  "5min": { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
  "15min": { type: "interval", intervalValue: 15, intervalUnit: "minutes" },
  "30min": { type: "interval", intervalValue: 30, intervalUnit: "minutes" },
  "1hour": { type: "interval", intervalValue: 1, intervalUnit: "hours" },
} as const satisfies Record<string, BrowserCheckSchedule>;

export const DEFAULT_SCHEDULE_PRESET: SchedulePresetKey = "5min";

type Translate = (_key: string, _params?: Record<string, unknown>) => string;

export type SchedulePresetKey = keyof typeof SCHEDULE_PRESETS;

/** What the host receives: the preset key already mapped to a schedule. */
export interface ExtractForm {
  name: string;
  folder: string;
  locations?: string[];
  schedule?: BrowserCheckSchedule;
}

export const makeExtractSubtestSchema = (t: Translate, needsSchedule: boolean) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("synthetics.validation.nameRequired"))
      .refine(
        (v) => new TextEncoder().encode(v).length <= NAME_MAX_BYTES,
        t("synthetics.journey.extract.nameTooLong"),
      ),
    folder: z.string().min(1),
    locations: z
      .array(z.string())
      .optional()
      .refine(
        (v) => !needsSchedule || (v?.length ?? 0) > 0,
        t("synthetics.validation.locationsRequired"),
      ),
    schedule: z
      .enum(Object.keys(SCHEDULE_PRESETS) as [SchedulePresetKey, ...SchedulePresetKey[]])
      .optional(),
  });

export type ExtractSubtestForm = z.infer<ReturnType<typeof makeExtractSubtestSchema>>;
