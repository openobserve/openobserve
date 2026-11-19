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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { resolveZonedCivil, type ParsedTimeInput } from "@/utils/dateTimeRangeParse";
import {
  searchAroundSecondsLabel,
  searchAroundTimeChoice,
  type SearchAroundChoice,
} from "@/utils/searchAroundWindow";

const MICROS_PER_SECOND = 1_000_000;
const MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND;
const DASH = " – ";

export const ANCHOR_WINDOWS: readonly { id: AnchorWindowId; halfWidthUs: number }[] = [
  { id: "5m", halfWidthUs: 300 * MICROS_PER_SECOND },
  { id: "1m", halfWidthUs: 60 * MICROS_PER_SECOND },
  { id: "30s", halfWidthUs: 30 * MICROS_PER_SECOND },
  { id: "5s", halfWidthUs: 5 * MICROS_PER_SECOND },
];

export const DEFAULT_ANCHOR_WINDOW: AnchorWindowId = "5m";

export type AnchorWindowId = "5m" | "1m" | "30s" | "5s";

export interface AnchorRow {
  id: AnchorWindowId | "to-now";
  startUs: number;
  endUs: number;
}

export interface AnchorSpanOptions {
  timezone?: string | null;
  locale?: string;
  /** Lead with the start's day (`Nov 15, 20:02:10 – now`), as the summary does. */
  withDay?: boolean;
}

/** Rows offered for a lone instant: the four windows around it, then from it to now (fixed when applied). */
export const anchorRows = (centreUs: number, nowUs: number): AnchorRow[] => {
  const windows: AnchorRow[] = ANCHOR_WINDOWS.map(({ id, halfWidthUs }) => ({
    id,
    startUs: centreUs - halfWidthUs,
    endUs: centreUs + halfWidthUs,
  }));
  return centreUs < nowUs
    ? [...windows, { id: "to-now", startUs: centreUs, endUs: nowUs }]
    : windows;
};

/** The instant a reading was widened around, or null when it is not a lone instant. */
export const readingAnchorMicros = (reading: ParsedTimeInput, timezone: string): number | null => {
  if (reading.type === "relative") return null;
  if (reading.type === "timestamp") return reading.centreMicros ?? null;
  if (!reading.centre) return null;
  if (reading.exact) return (reading.exact.startMicros + reading.exact.endMicros) / 2;
  return resolveZonedCivil(reading.centre.date, reading.centre.time, timezone).micros;
};

export const anchorWindowLabel = (id: AnchorRow["id"], t: TranslateFn): I18nText => {
  if (id === "to-now") return t("dateTime.fromHereToNow");
  const seconds =
    (ANCHOR_WINDOWS.find((window) => window.id === id)?.halfWidthUs ?? 0) / MICROS_PER_SECOND;
  return searchAroundSecondsLabel(seconds, t);
};

/** The Search around choice an anchor window stands for; null for `From here to now`. */
export const anchorSearchAroundChoice = (id: AnchorRow["id"]): SearchAroundChoice | null => {
  const window = ANCHOR_WINDOWS.find((entry) => entry.id === id);
  return window ? searchAroundTimeChoice(window.halfWidthUs / MICROS_PER_SECOND) : null;
};

/** The window a row previews, `19:57:10 – 20:07:10`; ms under a minute, and `From here` ends in `now` (§2). */
export const formatAnchorSpan = (
  row: AnchorRow,
  t: TranslateFn,
  opts: AnchorSpanOptions = {},
): string => {
  const exact = row.id !== "to-now" && row.endUs - row.startUs < MICROS_PER_MINUTE;
  const clock: Intl.DateTimeFormatOptions = {
    timeZone: safeTimezone(opts.timezone),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...(exact ? { fractionalSecondDigits: 3 } : {}),
  };
  const format = (us: number, withDay: boolean) =>
    new Intl.DateTimeFormat(opts.locale ?? "en-US", {
      ...clock,
      ...(withDay ? { month: "short", day: "numeric" } : {}),
    })
      .format(Math.floor(us / 1000))
      .replace(/[\u2009\u202f]/g, " ");
  const start = format(row.startUs, Boolean(opts.withDay));
  if (row.id === "to-now") return String(t("common.timeRangeUntilNow", { start: raw(start) }));
  return dropZeroMilliseconds(`${start}${DASH}${format(row.endUs, false)}`);
};

/** Drops the `.000` an exact stamp gives a whole second, which an epoch in seconds never had. */
export const dropZeroMilliseconds = (text: string): string => text.replace(/\.000(?!\d)/g, "");
