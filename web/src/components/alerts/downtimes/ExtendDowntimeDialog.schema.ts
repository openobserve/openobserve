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

export interface ExtendForm extends Record<string, unknown> {
  end_date: string;
  end_time: string;
}

/** The bounds an "Until…" end is checked against, in microseconds UTC. */
export interface ExtendBounds {
  /** The current end of the window. */
  currentEnd: number;
  /** Where the extended window starts, so its length stays within the 7-day limit. */
  start: number;
}

export const extendUntil = (v: ExtendForm, tz: string): number | null =>
  localToUtcMicros(v.end_date, v.end_time, tz);

export const makeExtendSchema = (t: TranslateFn, tz: string, bounds: () => ExtendBounds | null) =>
  z.object({ end_date: z.string(), end_time: z.string() }).superRefine((raw, ctx) => {
    const b = bounds();
    if (!b) return;
    const until = extendUntil(raw as ExtendForm, tz);
    const secs = until === null ? null : (until - b.start) / 1_000_000;
    const message =
      until === null
        ? t("alerts.downtimes.validation.endRequired")
        : until <= b.currentEnd
          ? t("alerts.downtimes.extend.endAfterCurrent")
          : secs !== null && secs < MIN_DURATION_SECS
            ? t("alerts.downtimes.validation.windowTooShort")
            : secs !== null && secs > MAX_DURATION_SECS
              ? t("alerts.downtimes.validation.windowTooLong")
              : null;
    if (message) ctx.addIssue({ code: "custom", path: ["end_date"], message });
  });

/** An hour past the current end, in the viewer's zone. */
export const extendDefaults = (currentEnd: number, tz: string): ExtendForm => {
  const end = utcMicrosToLocal(currentEnd + 3_600_000_000, tz);
  return { end_date: end.date, end_time: end.time };
};
