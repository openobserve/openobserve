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
import {
  resolveZonedCivil,
  type EpochUnit,
  type ParsedTimeInput,
} from "@/utils/dateTimeRangeParse";

const MICROS_PER_MS = 1_000;

export type ReadingNote =
  | { kind: "epoch"; unit: EpochUnit }
  | { kind: "utc" }
  | { kind: "typedZone"; zone: string }
  | { kind: "fiscal"; startMonth: number }
  | { kind: "dstGap"; typed: string; used: string; dateUs: number }
  | { kind: "cut" }
  | { kind: "future" };

/** The note a reading carries by itself: future, epoch unit, typed zone, fiscal year, or a DST-skipped time in `timezone`. */
export const readingNote = (
  reading: ParsedTimeInput,
  timezone?: string | null,
): ReadingNote | null => {
  if (reading.type === "relative") return null;
  if (reading.type === "timestamp") {
    if (reading.future) return { kind: "future" };
    if (reading.epochUnit) return { kind: "epoch", unit: reading.epochUnit };
    if (reading.utcStamp) return { kind: "utc" };
    return reading.sourceZone ? { kind: "typedZone", zone: reading.sourceZone } : null;
  }
  if (reading.fiscalStartMonth) return { kind: "fiscal", startMonth: reading.fiscalStartMonth };
  if (reading.exact) return null;
  return dstGapNote(reading, safeTimezone(timezone));
};

/** The summary text for a note. */
export const formatReadingNote = (
  note: ReadingNote,
  t: TranslateFn,
  locale = "en-US",
  timezone?: string | null,
): I18nText => {
  if (note.kind === "epoch") return t("dateTime.readAsEpoch", { unit: note.unit });
  if (note.kind === "utc") return t("dateTime.readAsUtc");
  if (note.kind === "typedZone") return t("dateTime.typedInZone", { zone: note.zone });
  if (note.kind === "cut") return t("dateTime.cutToTenYears");
  if (note.kind === "future") return t("dateTime.inTheFuture");
  if (note.kind === "fiscal") {
    const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2000, note.startMonth - 1, 1)),
    );
    return t("dateTime.fiscalYearStarts", { month });
  }
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: safeTimezone(timezone),
  }).format(Math.floor(note.dateUs / MICROS_PER_MS));
  return t("dateTime.dstGap", { typed: raw(note.typed), date, used: raw(note.used) });
};

// The time typed is shown as typed, minutes only, as that is how people write a clock time.
const dstGapNote = (
  reading: Extract<ParsedTimeInput, { type: "absolute" }>,
  zone: string,
): ReadingNote | null => {
  const sides = reading.centre
    ? [reading.centre]
    : [
        { date: reading.startDate, time: reading.startTime },
        { date: reading.endDate, time: reading.endTime },
      ];
  for (const side of sides) {
    const resolved = resolveZonedCivil(side.date, side.time, zone);
    if (resolved.kind === "gap") {
      return {
        kind: "dstGap",
        typed: side.time.slice(0, 5),
        used: resolved.usedTime.slice(0, 5),
        dateUs: resolved.micros,
      };
    }
  }
  return null;
};
