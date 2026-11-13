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
  CALENDAR_RAIL_ITEMS,
  exceedsRangeRestriction,
  formatAbsoluteInstant,
  formatCivilDay,
  formatCivilDayPrefix,
  formatRecentDuration,
  formatDurationMicros,
  formatKnownPeriod,
  formatZoneAbbreviation,
} from "./timeRangeRail";
import type { TranslateFn } from "@/types/i18n";
import { formatRangeDates } from "./timeRangeLabel";
import { parseCalendarToken } from "./dashboard/calendarPeriods";

const us = (iso: string) => Date.parse(iso) * 1000;

describe("timeRangeRail", () => {
  describe("formatAbsoluteInstant", () => {
    it("splits a timestamp into the trigger's yyyy/MM/dd and HH:mm:ss, in the given zone", () => {
      expect(formatAbsoluteInstant(us("2026-10-27T09:43:21Z"), "UTC")).toEqual({
        date: "2026/10/27",
        time: "09:43:21",
      });
      expect(formatAbsoluteInstant(us("2026-10-26T20:00:00Z"), "Asia/Calcutta")).toEqual({
        date: "2026/10/27",
        time: "01:30:00",
      });
    });
  });

  describe("formatRangeDates for a fixed range", () => {
    const NOW = Date.parse("2026-11-04T12:00:00Z");
    const compact = (start: string, end: string, zone = "UTC") =>
      formatRangeDates({ startUs: us(start), endUs: us(end) }, { timezone: zone, nowMs: NOW });

    it("names the hours of a range inside one day", () => {
      expect(compact("2026-10-02T08:00:00Z", "2026-10-02T09:00:00Z")).toBe("Oct 2, 08:00 – 09:00");
    });

    it("shows a whole day as month and day only", () => {
      expect(compact("2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z")).toBe("Oct 2");
    });

    it("names both days and times when the range spans days", () => {
      expect(compact("2026-11-05T03:18:00Z", "2026-11-07T03:33:00Z")).toBe(
        "Nov 5, 03:18 – Nov 7, 03:33",
      );
    });

    it("collapses a range of whole days to the days alone", () => {
      expect(compact("2026-10-02T00:00:00Z", "2026-10-03T23:59:59Z")).toBe("Oct 2 – 3");
      expect(compact("2026-10-30T00:00:00Z", "2026-11-02T23:59:59Z")).toBe("Oct 30 – Nov 2");
    });

    it("adds the year only when it is not the current year", () => {
      expect(compact("2025-10-02T00:00:00Z", "2025-10-03T23:59:59Z")).toBe("Oct 2 – 3, 2025");
      expect(compact("2025-12-30T08:00:00Z", "2026-01-02T09:00:00Z")).toBe(
        "Dec 30, 2025, 08:00 – Jan 2, 2026, 09:00",
      );
    });

    it("treats an end at exactly midnight as the previous day, like the full label", () => {
      expect(compact("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")).toBe("Oct 26");
    });

    it("reads days in the picker timezone", () => {
      expect(compact("2026-10-26T20:00:00Z", "2026-10-26T21:00:00Z", "Asia/Calcutta")).toBe(
        "Oct 27, 01:30 – 02:30",
      );
    });
  });

  describe("locale", () => {
    it("keeps each locale's word order for recent labels", () => {
      const start = us("2026-10-02T00:00:00Z");
      const end = us("2026-10-03T23:59:59Z");
      expect(
        formatRangeDates(
          { startUs: start, endUs: end },
          { timezone: "UTC", nowMs: Date.parse("2026-11-04T12:00:00Z"), locale: "de-DE" },
        ),
      ).toBe("2.–3. Okt.");
    });
  });

  describe("formatRecentDuration", () => {
    const dur = (seconds: number) => formatRecentDuration(0, seconds * 1_000_000);

    it("reads a range ending at :59 as inclusive, so a whole day is 1d", () => {
      expect(dur(86_399)).toBe("1d");
      expect(dur(2 * 86_400 - 1)).toBe("2d");
      expect(formatRecentDuration(30_000_000, 89_000_000)).toBe("59s");
    });

    it("keeps the two largest non-zero units", () => {
      expect(dur(86_400 + 15 * 60)).toBe("1d 15m");
      expect(dur(2 * 86_400 + 15 * 60)).toBe("2d 15m");
      expect(dur(3 * 3600 + 5 * 60)).toBe("3h 5m");
      expect(dur(86_400 + 3600 + 5 * 60 + 9)).toBe("1d 1h");
    });

    it("drops leading and interior zero units", () => {
      expect(dur(45 * 60)).toBe("45m");
      expect(dur(30)).toBe("30s");
      expect(dur(86_400)).toBe("1d");
      expect(dur(3600 + 9)).toBe("1h 9s");
    });

    it("renders an empty span in microseconds, never 0s", () => {
      expect(dur(0)).toBe("0 µs");
    });
  });

  describe("formatDurationMicros", () => {
    it("reads an exact span without the inclusive-minute rule", () => {
      expect(formatDurationMicros(15 * 60_000_000)).toBe("15m");
      expect(formatDurationMicros(90 * 60_000_000)).toBe("1h 30m");
      expect(formatDurationMicros(0)).toBe("0 µs");
      expect(formatDurationMicros(1_000)).toBe("1 ms");
    });
  });

  describe("formatCivilDay", () => {
    const NOW_MS = Date.parse("2026-11-09T03:33:00Z");

    it.each([
      ["en-US", "2026/11/01", "Nov 1"],
      ["en-US", "1999/01/01", "Jan 1, 1999"],
      ["de-DE", "2026/11/01", "1. Nov."],
      ["en-US", "not a day", ""],
    ])("%s reads %s as %j", (locale, date, expected) => {
      expect(formatCivilDay(date, "UTC", NOW_MS, locale)).toBe(expected);
    });
  });

  describe("formatCivilDayPrefix", () => {
    const NOW_MS = Date.parse("2026-11-09T03:33:00Z");

    it.each([
      ["en-US", "2026/11/06", "Nov 6,"],
      ["en-US", "2025/11/06", "Nov 6, 2025,"],
      ["de-DE", "2026/11/06", "6. Nov.,"],
      ["ja-JP", "2026/11/06", "11月6日"],
      ["zh-CN", "2026/11/06", "11月6日"],
    ])("%s reads %s as %j, with no trailing space", (locale, date, expected) => {
      expect(formatCivilDayPrefix(date, "UTC", NOW_MS, locale)).toBe(expected);
    });

    it("falls back to the bare day where the locale puts the time first", () => {
      expect(formatCivilDayPrefix("2026/11/06", "UTC", NOW_MS, "vi-VN")).toBe("6 thg 11");
    });

    it("judges the current year in the picker zone", () => {
      const newYearUtc = Date.parse("2026-12-31T20:00:00Z");
      expect(formatCivilDayPrefix("2026/12/31", "UTC", newYearUtc)).toBe("Dec 31,");
      expect(formatCivilDayPrefix("2026/12/31", "Asia/Tokyo", newYearUtc)).toBe("Dec 31, 2026,");
    });

    it("is empty for an unreadable date", () => {
      expect(formatCivilDayPrefix("", "UTC", NOW_MS)).toBe("");
      expect(formatCivilDayPrefix("2026/00/06", "UTC", NOW_MS)).toBe("");
      expect(formatCivilDayPrefix("2026/13/06", "UTC", NOW_MS)).toBe("");
    });
  });

  describe("formatZoneAbbreviation", () => {
    it("names UTC and a DST zone by their short names", () => {
      expect(formatZoneAbbreviation("UTC", Date.parse("2026-01-01T00:00:00Z"))).toBe("UTC");
      expect(formatZoneAbbreviation("America/New_York", Date.parse("2026-01-01T00:00:00Z"))).toBe(
        "EST",
      );
    });
  });

  describe("exceedsRangeRestriction", () => {
    it("compares the span in hours, with 0 meaning no limit", () => {
      const day = 24 * 3_600_000_000;
      expect(exceedsRangeRestriction(0, day, 24)).toBe(false);
      expect(exceedsRangeRestriction(0, day + 1, 24)).toBe(true);
      expect(exceedsRangeRestriction(0, day * 400, 0)).toBe(false);
    });
  });

  it("lists the ten calendar ranges as valid tokens, in list order", () => {
    for (const item of CALENDAR_RAIL_ITEMS) expect(parseCalendarToken(item.token)).not.toBeNull();
    expect(CALENDAR_RAIL_ITEMS.map((item) => item.id)).toEqual([
      "today",
      "yesterday",
      "this-week",
      "last-week",
      "this-month",
      "last-month",
      "this-quarter",
      "last-quarter",
      "year",
      "previous-year",
    ]);
  });

  it("labels whole years of months in years, in the unit they were typed [#56]", () => {
    const t = ((key: string, named?: { count: number }) =>
      `${key}:${named?.count ?? ""}`) as unknown as TranslateFn;
    expect(formatKnownPeriod("60M", "UTC", t)).toBe("common.pastYear:5");
    expect(formatKnownPeriod("12M", "UTC", t)).toBe("common.pastYear:1");
    expect(formatKnownPeriod("18M", "UTC", t)).toBe("common.pastMonth:18");
    expect(formatKnownPeriod("1w", "UTC", t)).toBe("common.pastWeek:1");
  });

  it("offers This year and Previous year rows [#29, #35]", () => {
    const years = CALENDAR_RAIL_ITEMS.filter((item) => item.token.startsWith("calendar:year:"));
    expect(years.map((item) => [item.token, item.labelKey])).toEqual([
      ["calendar:year:0", "common.thisYear"],
      ["calendar:year:-1", "dateTime.previousYear"],
    ]);
  });
});
