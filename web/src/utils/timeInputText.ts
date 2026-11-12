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

import type { ParsedTimeInput } from "@/utils/dateTimeRangeParse";
import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";

const TEN_MINUTES_MICROS = 10 * 60 * 1_000_000;

const isoDate = (date: string) => date.replace(/\//g, "-");

const isoInstant = (micros: number) => new Date(micros / 1000).toISOString().replace(".000Z", "Z");

const previousDate = (date: string): string => {
  const [year, month, day] = date.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10).replace(/-/g, "/");
};

const calendarText = (token: string): string | null => {
  const period = parseCalendarToken(token);
  if (!period) return null;
  const { unit, offset } = period;
  if (unit === "day") return offset === 0 ? "today" : offset === -1 ? "yesterday" : null;
  if (offset === 0) return `this ${unit}`;
  if (offset === -1) return `previous ${unit}`;
  return `${-offset} ${unit}s ago`;
};

/** Text that reads back as this reading, so a suggestion accepted with Tab stays what it showed. */
export const formatTimeInputText = (reading: ParsedTimeInput): string => {
  if (reading.type === "relative") {
    const calendar = calendarText(reading.period);
    if (calendar) return calendar;
    // A bare uppercase M is months only by case, so the bar spells it out.
    return reading.period.replace(/^(\d+)M$/, "$1mo");
  }
  if (reading.type === "timestamp") {
    if (reading.endMicros - reading.startMicros === TEN_MINUTES_MICROS) {
      return isoInstant(reading.startMicros + TEN_MINUTES_MICROS / 2);
    }
    return `${isoInstant(reading.startMicros)} to ${isoInstant(reading.endMicros)}`;
  }
  if (reading.centre) return `${isoDate(reading.centre.date)} ${reading.centre.time}`;
  if (reading.name) return reading.name;
  // Whole days end at the next midnight, so the text names the day before as the last one.
  const wholeDays =
    reading.startTime === "00:00:00" &&
    reading.endTime === "00:00:00" &&
    reading.endDate > reading.startDate;
  if (wholeDays) {
    const lastDay = previousDate(reading.endDate);
    return reading.startDate === lastDay
      ? isoDate(reading.startDate)
      : `${isoDate(reading.startDate)} to ${isoDate(lastDay)}`;
  }
  return `${isoDate(reading.startDate)} ${reading.startTime} to ${isoDate(reading.endDate)} ${reading.endTime}`;
};
