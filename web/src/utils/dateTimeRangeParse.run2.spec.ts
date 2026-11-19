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

import { describe, expect, it } from "vitest";
import {
  parseTimeInput,
  suggestTimeInput,
  type ParsedTimeInput,
  type TimeInputOptions,
} from "./dateTimeRangeParse";

// Fri 2026-11-13 16:44:00 on the picker's wall clock.
const NOW = new Date(2026, 10, 13, 16, 44, 0);
const US: TimeInputOptions = { now: NOW, locale: "en-US" };
const GB: TimeInputOptions = { now: NOW, locale: "en-GB" };

function show(result: ParsedTimeInput | null): string {
  if (!result) return "null";
  if (result.type === "relative") return result.period;
  if (result.type === "timestamp") return "timestamp";
  return `${result.startDate} ${result.startTime}..${result.endDate} ${result.endTime}`;
}

describe("a dashed clock range is a range, not an offset [S4]", () => {
  it.each([
    ["15:00 - 16:00", "2026/11/13 15:00:00..2026/11/13 16:00:00"],
    ["09:00-10:00", "2026/11/13 09:00:00..2026/11/13 10:00:00"],
    ["9:00 - 10:30", "2026/11/13 09:00:00..2026/11/13 10:30:00"],
    ["yesterday 09:00 - 10:00", "2026/11/12 09:00:00..2026/11/12 10:00:00"],
  ])("reads %s", (text, expected) => {
    expect(show(parseTimeInput(text, US))).toBe(expected);
  });

  it("still reads a dashed HH:MM after a full stamp as its offset", () => {
    expect(show(parseTimeInput("2024-01-01 10:00:00 - 05:00", US))).toBe("null");
  });
});

describe("yearless dates follow the picker's ceiling [C3]", () => {
  const OPEN: TimeInputOptions = { ...US, ceilingMs: Number.POSITIVE_INFINITY };

  it("reads a date later this year as the coming one when the future is allowed", () => {
    expect(show(parseTimeInput("Dec 20", OPEN))).toBe("2026/12/20 00:00:00..2026/12/21 00:00:00");
    expect(show(parseTimeInput("Dec 20 - Dec 22", OPEN))).toBe(
      "2026/12/20 00:00:00..2026/12/23 00:00:00",
    );
  });

  it("reads a date already over this year as next year's", () => {
    expect(show(parseTimeInput("Jan 5", OPEN))).toBe("2027/01/05 00:00:00..2027/01/06 00:00:00");
  });

  it("keeps today as today", () => {
    expect(show(parseTimeInput("Nov 13", OPEN))).toBe("2026/11/13 00:00:00..2026/11/14 00:00:00");
  });

  it("reads only up to a finite ceiling", () => {
    const ceilingMs = new Date(2026, 11, 1).getTime();
    const capped = { ...US, ceilingMs };
    expect(show(parseTimeInput("Nov 28", capped))).toBe("2026/11/28 00:00:00..2026/11/29 00:00:00");
    expect(show(parseTimeInput("Dec 20", capped))).toBe("2025/12/20 00:00:00..2025/12/21 00:00:00");
  });

  it("keeps the most recent past year with no ceiling past now", () => {
    expect(show(parseTimeInput("Dec 20", US))).toBe("2025/12/20 00:00:00..2025/12/21 00:00:00");
  });
});

describe("a flipped day/month reading says which order it took [P10]", () => {
  it("marks the reading against the locale's order", () => {
    const [first, flipped] = suggestTimeInput("11/12/2026", GB);
    expect(first).toMatchObject({ startDate: "2026/12/11" });
    expect((first as { readAs?: string }).readAs).toBeUndefined();
    expect(flipped).toMatchObject({ startDate: "2026/11/12", readAs: "monthDay" });
  });

  it("marks a day-first reading under a month-first locale", () => {
    const [, flipped] = suggestTimeInput("12/11/2026", US);
    expect(flipped).toMatchObject({ startDate: "2026/11/12", readAs: "dayMonth" });
  });
});
