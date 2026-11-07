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
  formatInstantFull,
  formatRangeFull,
  formatRangeLabel,
  formatRecentDuration,
  formatRecentRange,
  formatRecentRangeLabel,
  joinRangeLabel,
  clampRelativeWindow,
  formatCopyRange,
  zoomOutRange,
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
    it("reads like the panel summary, seconds always", () => {
      expect(label("2026-10-26T15:45:00Z", "2026-10-26T16:20:00Z")).toBe(
        "Oct 26, 15:45:00 – 16:20:00",
      );
    });

    it("spans multiple days with both dates", () => {
      expect(label("2026-10-19T08:00:00Z", "2026-10-21T09:00:00Z")).toBe(
        "Oct 19, 08:00:00 – Oct 21, 09:00:00",
      );
    });

    it("names the year on both ends when either is outside the current year", () => {
      expect(label("2025-12-30T10:00:00Z", "2026-01-02T10:00:00Z")).toBe(
        "Dec 30, 2025, 10:00:00 – Jan 2, 2026, 10:00:00",
      );
    });

    it("reads an end at exactly midnight as the previous day's last second", () => {
      expect(label("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")).toBe(
        "Oct 26, 00:00:00 – 23:59:59",
      );
      expect(label("2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z")).toBe(
        "Oct 19, 00:00:00 – Oct 25, 23:59:59",
      );
    });

    it("reads days and times in the picker timezone and names it when it is not the browser's", () => {
      expect(label("2026-10-26T20:00:00Z", "2026-10-26T21:00:00Z", "Asia/Calcutta")).toBe(
        "Oct 27, 01:30:00 – 02:30:00 UTC+05:30",
      );
      expect(label("2026-10-26T18:00:00Z", "2026-10-26T19:00:00Z", "Asia/Calcutta")).toBe(
        "Oct 26, 23:30:00 – Oct 27, 00:30:00 UTC+05:30",
      );
    });
  });

  describe("formatRangeLabel", () => {
    const IST = "Asia/Calcutta";
    const NOW = Date.parse("2026-11-06T14:02:00+05:30");
    const base = { nowMs: NOW, browserZone: IST, locale: "en-US" };
    type Row = [string, string, string, string, string, string, Record<string, unknown>?];
    // Case, start, end (picker wall clock with offset), zone, trigger, summary line 1, options.
    const rows: [string, ...Row][] = [
      [
        "spanning days",
        "2026-11-04T13:47:00+05:30",
        "2026-11-06T13:47:00+05:30",
        IST,
        "Nov 4, 13:47 – Nov 6, 13:47",
        "Nov 4, 13:47:00 – Nov 6, 13:47:00",
      ],
      [
        "non-zero seconds",
        "2026-11-04T13:47:03+05:30",
        "2026-11-06T14:02:03+05:30",
        IST,
        "Nov 4, 13:47:03 – Nov 6, 14:02:03",
        "Nov 4, 13:47:03 – Nov 6, 14:02:03",
      ],
      [
        "same day",
        "2026-11-04T13:47:00+05:30",
        "2026-11-04T15:52:00+05:30",
        IST,
        "Nov 4, 13:47 – 15:52",
        "Nov 4, 13:47:00 – 15:52:00",
      ],
      [
        "whole days",
        "2026-11-04T00:00:00+05:30",
        "2026-11-07T00:00:00+05:30",
        IST,
        "Nov 4 – 6",
        "Nov 4, 00:00:00 – Nov 6, 23:59:59",
      ],
      [
        "one whole day",
        "2026-11-05T00:00:00+05:30",
        "2026-11-06T00:00:00+05:30",
        IST,
        "Nov 5",
        "Nov 5, 00:00:00 – 23:59:59",
      ],
      [
        "whole days, two months",
        "2026-10-30T00:00:00+05:30",
        "2026-11-03T00:00:00+05:30",
        IST,
        "Oct 30 – Nov 2",
        "Oct 30, 00:00:00 – Nov 2, 23:59:59",
      ],
      [
        "cross-year",
        "2025-12-30T23:59:00+05:30",
        "2026-01-02T00:10:00+05:30",
        IST,
        "Dec 30, 2025, 23:59 – Jan 2, 2026, 00:10",
        "Dec 30, 2025, 23:59:00 – Jan 2, 2026, 00:10:00",
      ],
      [
        "wholly in a past year",
        "2025-03-04T13:47:00+05:30",
        "2025-03-06T13:47:00+05:30",
        IST,
        "Mar 4, 2025, 13:47 – Mar 6, 2025, 13:47",
        "Mar 4, 2025, 13:47:00 – Mar 6, 2025, 13:47:00",
      ],
      [
        "12h, same day",
        "2026-11-04T13:47:00+05:30",
        "2026-11-04T15:52:00+05:30",
        IST,
        "Nov 4, 1:47 – 3:52 PM",
        "Nov 4, 1:47:00 PM – 3:52:00 PM",
        { hourCycle: "h12" },
      ],
      [
        "12h, spanning days",
        "2026-11-04T13:47:03+05:30",
        "2026-11-06T14:02:03+05:30",
        IST,
        "Nov 4, 1:47:03 PM – Nov 6, 2:02:03 PM",
        "Nov 4, 1:47:03 PM – Nov 6, 2:02:03 PM",
        { hourCycle: "h12" },
      ],
      [
        "DST end, repeated hour",
        "2026-11-01T01:30:00-04:00",
        "2026-11-01T01:15:00-05:00",
        "America/New_York",
        "Nov 1, 01:30 UTC-04:00 – 01:15 UTC-05:00",
        "Nov 1, 01:30:00 UTC-04:00 – 01:15:00 UTC-05:00",
        { browserZone: "America/New_York" },
      ],
      [
        "DST end, whole day",
        "2026-11-01T00:00:00-04:00",
        "2026-11-02T00:00:00-05:00",
        "America/New_York",
        "Nov 1",
        "Nov 1, 00:00:00 – 23:59:59",
        { browserZone: "America/New_York" },
      ],
      [
        "en-GB locale",
        "2026-11-04T13:47:00+05:30",
        "2026-11-06T13:47:00+05:30",
        IST,
        "4 Nov, 13:47 – 6 Nov, 13:47",
        "4 Nov, 13:47:00 – 6 Nov, 13:47:00",
        { locale: "en-GB" },
      ],
    ];

    it.each(rows)("%s", (_case, start, end, zone, trigger, summary, options = {}) => {
      const opts = { ...base, ...options };
      expect(formatRangeLabel(us(start), us(end), zone, opts)).toEqual({
        range: trigger,
        zone: "",
      });
      expect(formatRangeFull(us(start), us(end), zone, opts).range).toBe(summary);
    });

    it("adds a hand-built zone suffix only when the picker zone is not the browser's", () => {
      const start = us("2026-11-04T08:17:00Z");
      const end = us("2026-11-06T08:17:00Z");
      expect(formatRangeLabel(start, end, "UTC", base)).toEqual({
        range: "Nov 4, 08:17 – Nov 6, 08:17",
        zone: "UTC",
      });
      expect(formatRangeFull(start, end, "UTC", base).range).toBe(
        "Nov 4, 08:17:00 – Nov 6, 08:17:00",
      );
      expect(formatRangeLabel(start, end, IST, base).zone).toBe("");
      expect(formatRangeLabel(start, end, "America/New_York", base).zone).toBe("UTC-05:00");
    });

    it("drops seconds at the narrow ladder step without touching whole days", () => {
      const opts = { ...base, precision: "minutes" as const };
      expect(
        formatRangeLabel(
          us("2026-11-04T13:47:03+05:30"),
          us("2026-11-06T14:02:03+05:30"),
          IST,
          opts,
        ).range,
      ).toBe("Nov 4, 13:47 – Nov 6, 14:02");
      expect(
        formatRangeLabel(
          us("2026-11-04T00:00:00+05:30"),
          us("2026-11-07T00:00:00+05:30"),
          IST,
          opts,
        ).range,
      ).toBe("Nov 4 – 6");
    });

    it("pins the gregorian calendar and latin digits whatever the locale", () => {
      const start = us("2026-11-04T13:47:00+05:30");
      const end = us("2026-11-06T13:47:00+05:30");
      expect(formatRangeLabel(start, end, IST, { ...base, locale: "th-TH" }).range).not.toMatch(
        /2569/,
      );
      expect(formatRangeLabel(start, end, IST, { ...base, locale: "ar-SA" }).range).toMatch(
        /[0-9]/,
      );
      expect(formatRangeLabel(start, end, IST, { ...base, locale: "ar-SA" }).range).not.toMatch(
        /[\u0660-\u0669]/,
      );
    });

    it("joins a label and its suffix for the accessible name", () => {
      expect(joinRangeLabel({ range: "Nov 4, 08:17 – Nov 6, 08:17", zone: "UTC" })).toBe(
        "Nov 4, 08:17 – Nov 6, 08:17 UTC",
      );
    });
  });

  describe("formatInstantFull", () => {
    it("writes one end with seconds and the year only outside the current one", () => {
      const now = Date.parse("2026-11-06T14:02:00Z");
      expect(formatInstantFull(us("2026-11-06T13:47:03Z"), "UTC", { nowMs: now })).toBe(
        "Nov 6, 13:47:03",
      );
      expect(formatInstantFull(us("2025-11-06T13:47:03Z"), "UTC", { nowMs: now })).toBe(
        "Nov 6, 2025, 13:47:03",
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
      ).toBe("1–4 nov.");
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

    it("runs a current week to today and shows a finished one whole", () => {
      expect(hint("calendar:week:0")).toBe("Nov 2 – 4");
      expect(hint("calendar:week:-1")).toBe("Oct 26 – Nov 1");
    });

    it("shows months and quarters as dates, a current one ending today", () => {
      expect(hint("calendar:month:0")).toBe("Nov 1 – 4");
      expect(hint("calendar:month:-1")).toBe("Oct 1 – 31");
      expect(hint("calendar:quarter:0")).toBe("Oct 1 – Nov 4");
      expect(hint("calendar:quarter:-1")).toBe("Jul 1 – Sep 30");
    });

    it("adds the year only for a period outside the current year", () => {
      const jan = Date.parse("2026-01-07T12:00:00Z");
      expect(hint("calendar:day:-1", "UTC", jan)).toBe("Jan 6");
      expect(hint("calendar:week:-1", "UTC", Date.parse("2026-01-05T12:00:00Z"))).toBe(
        "Dec 29, 2025 – Jan 4, 2026",
      );
      expect(hint("calendar:month:-1", "UTC", jan)).toBe("Dec 1 – 31, 2025");
      expect(hint("calendar:quarter:-1", "UTC", jan)).toBe("Oct 1 – Dec 31, 2025");
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

describe("clampRelativeWindow", () => {
  it("keeps a window within the limit, or with no limit, as typed", () => {
    expect(clampRelativeWindow({ value: 90, unit: "m" }, 2)).toEqual({ value: 90, unit: "m" });
    expect(clampRelativeWindow({ value: 90, unit: "d" }, 0)).toEqual({ value: 90, unit: "d" });
  });

  it.each([
    [{ value: 30, unit: "d" }, 168, { value: 7, unit: "d" }],
    [{ value: 2, unit: "d" }, 36, { value: 36, unit: "h" }],
    [{ value: 2, unit: "w" }, 168, { value: 1, unit: "w" }],
    [{ value: 3, unit: "M" }, 744, { value: 31, unit: "d" }],
    [{ value: 90, unit: "m" }, 1, { value: 60, unit: "m" }],
  ] as const)("clamps %j on a %sh limit to %j", (window, limit, expected) => {
    expect(clampRelativeWindow(window, limit)).toEqual(expected);
  });
});

describe("zoomOutRange", () => {
  const NOW_US = Date.parse("2026-11-07T10:00:00Z") * 1000;
  const HOUR_US = 3_600_000_000;
  const bounds = { nowUs: NOW_US };

  it.each([
    [15, "m", { value: 30, unit: "m" }],
    [30, "m", { value: 1, unit: "h" }],
    [12, "h", { value: 1, unit: "d" }],
    [7, "d", { value: 2, unit: "w" }],
    [30, "d", { value: 60, unit: "d" }],
    [3, "M", { value: 6, unit: "M" }],
  ] as const)("doubles %s%s and names it in the largest exact unit", (value, unit, expected) => {
    expect(zoomOutRange({ kind: "relative", value, unit }, bounds)).toEqual({
      kind: "relative",
      ...expected,
    });
  });

  it("caps a relative window at the page's limit and stops there", () => {
    expect(
      zoomOutRange({ kind: "relative", value: 5, unit: "d" }, { ...bounds, limitHours: 168 }),
    ).toEqual({ kind: "relative", value: 7, unit: "d" });
    expect(
      zoomOutRange({ kind: "relative", value: 7, unit: "d" }, { ...bounds, limitHours: 168 }),
    ).toBeNull();
  });

  it("doubles an absolute range around its centre", () => {
    const startUs = NOW_US - 10 * HOUR_US;
    expect(
      zoomOutRange({ kind: "absolute", startUs, endUs: startUs + 2 * HOUR_US }, bounds),
    ).toEqual({ kind: "absolute", startUs: startUs - HOUR_US, endUs: startUs + 3 * HOUR_US });
  });

  it("moves the part past now to the start", () => {
    expect(
      zoomOutRange({ kind: "absolute", startUs: NOW_US - 2 * HOUR_US, endUs: NOW_US }, bounds),
    ).toEqual({ kind: "absolute", startUs: NOW_US - 4 * HOUR_US, endUs: NOW_US });
  });

  it("keeps the start at the earliest date and returns null when nothing can grow", () => {
    const minUs = NOW_US - 3 * HOUR_US;
    expect(
      zoomOutRange(
        { kind: "absolute", startUs: NOW_US - 2 * HOUR_US, endUs: NOW_US },
        { ...bounds, minUs },
      ),
    ).toEqual({ kind: "absolute", startUs: minUs, endUs: NOW_US });
    expect(
      zoomOutRange({ kind: "absolute", startUs: minUs, endUs: NOW_US }, { ...bounds, minUs }),
    ).toBeNull();
  });

  it("keeps an end already past now and moves only the new overflow to the start", () => {
    const midnight = Date.parse("2026-11-07T00:00:00Z") * 1000;
    expect(
      zoomOutRange(
        { kind: "absolute", startUs: midnight, endUs: midnight + 24 * HOUR_US },
        { nowUs: midnight + 12 * HOUR_US },
      ),
    ).toEqual({
      kind: "absolute",
      startUs: midnight - 24 * HOUR_US,
      endUs: midnight + 24 * HOUR_US,
    });
  });

  it("caps an absolute range at the page's limit, keeping its end", () => {
    expect(
      zoomOutRange(
        { kind: "absolute", startUs: NOW_US - 2 * HOUR_US, endUs: NOW_US },
        { ...bounds, limitHours: 3 },
      ),
    ).toEqual({ kind: "absolute", startUs: NOW_US - 3 * HOUR_US, endUs: NOW_US });
  });
});

describe("formatCopyRange", () => {
  it("writes an ISO 8601 interval with the zone's offsets, to the second", () => {
    expect(
      formatCopyRange(
        Date.parse("2026-11-04T08:17:00.456Z") * 1000,
        Date.parse("2026-11-04T10:22:00Z") * 1000,
        "Asia/Calcutta",
      ),
    ).toBe("2026-11-04T13:47:00+05:30/2026-11-04T15:52:00+05:30");
  });

  it("writes Z for UTC", () => {
    expect(
      formatCopyRange(
        Date.parse("2026-11-04T08:17:00Z") * 1000,
        Date.parse("2026-11-04T10:22:00Z") * 1000,
        "UTC",
      ),
    ).toBe("2026-11-04T08:17:00Z/2026-11-04T10:22:00Z");
  });
});
