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
  formatCalendarRailHint,
  formatRecentDuration,
  formatRecentRange,
  formatRecentRangeLabel,
} from "./timeRangeRail";
import { parseCalendarToken } from "./dashboard/calendarPeriods";

const us = (iso: string) => Date.parse(iso) * 1000;
const label = (start: string, end: string, zone = "UTC") =>
  formatRecentRange(us(start), us(end), zone);

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

  describe("formatRecentRange", () => {
    it("matches the trigger's absolute-range format exactly", () => {
      expect(label("2026-10-26T15:45:00Z", "2026-10-26T16:20:00Z")).toBe(
        "2026/10/26 15:45:00 - 2026/10/26 16:20:00",
      );
    });

    it("spans multiple days the same way", () => {
      expect(label("2026-10-19T08:00:00Z", "2026-10-21T09:00:00Z")).toBe(
        "2026/10/19 08:00:00 - 2026/10/21 09:00:00",
      );
    });

    it("keeps the year on both sides regardless of the current year", () => {
      expect(label("2025-12-30T10:00:00Z", "2026-01-02T10:00:00Z")).toBe(
        "2025/12/30 10:00:00 - 2026/01/02 10:00:00",
      );
    });

    it("reads an end at exactly midnight as the previous day's last second", () => {
      expect(label("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")).toBe(
        "2026/10/26 00:00:00 - 2026/10/26 23:59:59",
      );
      expect(label("2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z")).toBe(
        "2026/10/19 00:00:00 - 2026/10/25 23:59:59",
      );
    });

    it("reads days and times in the picker timezone", () => {
      expect(label("2026-10-26T20:00:00Z", "2026-10-26T21:00:00Z", "Asia/Calcutta")).toBe(
        "2026/10/27 01:30:00 - 2026/10/27 02:30:00",
      );
      expect(label("2026-10-26T18:00:00Z", "2026-10-26T19:00:00Z", "Asia/Calcutta")).toBe(
        "2026/10/26 23:30:00 - 2026/10/27 00:30:00",
      );
    });
  });

  describe("formatRecentRangeLabel", () => {
    const NOW = Date.parse("2026-11-04T12:00:00Z");
    const compact = (start: string, end: string, zone = "UTC") =>
      formatRecentRangeLabel(us(start), us(end), zone, NOW);

    it("names the hours of a range inside one day", () => {
      expect(compact("2026-10-02T08:00:00Z", "2026-10-02T09:00:00Z")).toBe("Oct 2 · 08:00–09:00");
    });

    it("shows a whole day as month and day only", () => {
      expect(compact("2026-10-02T00:00:00Z", "2026-10-02T23:59:59Z")).toBe("Oct 2");
    });

    it("collapses a same-month range to one month name", () => {
      expect(compact("2026-10-02T08:00:00Z", "2026-10-03T09:00:00Z")).toBe("Oct 2 – 3");
    });

    it("names both months when the range crosses a month", () => {
      expect(compact("2026-10-30T08:00:00Z", "2026-11-02T09:00:00Z")).toBe("Oct 30 – Nov 2");
    });

    it("adds the year only when it is not the current year", () => {
      expect(compact("2025-10-02T08:00:00Z", "2025-10-03T09:00:00Z")).toBe("Oct 2 – 3, 2025");
      expect(compact("2025-12-30T08:00:00Z", "2026-01-02T09:00:00Z")).toBe(
        "Dec 30, 2025 – Jan 2, 2026",
      );
    });

    it("treats an end at exactly midnight as the previous day, like the full label", () => {
      expect(compact("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")).toBe("Oct 26");
    });

    it("reads days in the picker timezone", () => {
      expect(compact("2026-10-26T20:00:00Z", "2026-10-26T21:00:00Z", "Asia/Calcutta")).toBe(
        "Oct 27 · 01:30–02:30",
      );
    });
  });

  describe("locale", () => {
    it("keeps each locale's word order for recent labels and hints", () => {
      const start = us("2026-10-02T08:00:00Z");
      const end = us("2026-10-03T09:00:00Z");
      expect(
        formatRecentRangeLabel(start, end, "UTC", Date.parse("2026-11-04T12:00:00Z"), "de-DE"),
      ).toBe("2.–3. Okt.");
      expect(
        formatCalendarRailHint(
          "calendar:month:0",
          "UTC",
          Date.parse("2026-11-04T12:00:00Z"),
          "fr-FR",
        ),
      ).toBe("nov.");
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

    it("renders an empty span as 0s", () => {
      expect(dur(0)).toBe("0s");
    });
  });

  describe("formatCalendarRailHint", () => {
    const NOW = Date.parse("2026-11-04T12:00:00Z");
    const hint = (token: string, zone = "UTC", now = NOW) =>
      formatCalendarRailHint(token, zone, now);

    it("shows the date for days", () => {
      expect(hint("calendar:day:0")).toBe("Nov 4");
      expect(hint("calendar:day:-1")).toBe("Nov 3");
    });

    it("shows the whole Monday-to-Sunday week, not the elapsed part", () => {
      expect(hint("calendar:week:0")).toBe("Nov 2 – 8");
      expect(hint("calendar:week:-1")).toBe("Oct 26 – Nov 1");
    });

    it("shows the month name and the quarter number", () => {
      expect(hint("calendar:month:0")).toBe("Nov");
      expect(hint("calendar:month:-1")).toBe("Oct");
      expect(hint("calendar:quarter:0")).toBe("Q4");
      expect(hint("calendar:quarter:-1")).toBe("Q3");
    });

    it("adds the year only for a period outside the current year", () => {
      const jan = Date.parse("2026-01-07T12:00:00Z");
      expect(hint("calendar:day:-1", "UTC", jan)).toBe("Jan 6");
      expect(hint("calendar:week:-1", "UTC", Date.parse("2026-01-05T12:00:00Z"))).toBe(
        "Dec 29, 2025 – Jan 4, 2026",
      );
      expect(hint("calendar:month:-1", "UTC", jan)).toBe("Dec 2025");
      expect(hint("calendar:quarter:-1", "UTC", jan)).toBe("Q4 2025");
    });

    it("reads today in the picker timezone", () => {
      expect(hint("calendar:day:0", "Asia/Calcutta", Date.parse("2026-11-04T20:00:00Z"))).toBe(
        "Nov 5",
      );
    });

    it("returns null for a bad token", () => {
      expect(formatCalendarRailHint("nope", "UTC", NOW)).toBeNull();
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

  it("lists the eight calendar ranges as valid tokens, with so far on the current ones", () => {
    expect(CALENDAR_RAIL_ITEMS).toHaveLength(8);
    for (const item of CALENDAR_RAIL_ITEMS) {
      const period = parseCalendarToken(item.token);
      expect(period).not.toBeNull();
      expect(item.soFar).toBe(period?.offset === 0);
    }
  });

  it("orders the calendar rows current period first, then the one before it", () => {
    expect(CALENDAR_RAIL_ITEMS.map((item) => item.id)).toEqual([
      "today",
      "yesterday",
      "this-week",
      "last-week",
      "this-month",
      "last-month",
      "this-quarter",
      "last-quarter",
    ]);
  });

  it("has no year chip, even though the resolver still accepts a calendar:year token", () => {
    expect(CALENDAR_RAIL_ITEMS.some((item) => item.token.startsWith("calendar:year:"))).toBe(false);
    expect(parseCalendarToken("calendar:year:-1")).not.toBeNull();
  });
});
