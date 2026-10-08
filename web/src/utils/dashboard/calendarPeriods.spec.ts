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
import { gt } from "@/types/i18n";
import {
  buildCalendarToken,
  formatCalendarLabel,
  formatCalendarTooltip,
  parseCalendarToken,
  resolveCalendarPeriod,
  shiftCalendarToken,
} from "./calendarPeriods";

// Thursday 2026-10-08 08:30 in Asia/Calcutta, 03:00 in UTC, still Wednesday 23:00 in New York.
const NOW = Date.parse("2026-10-08T03:00:00Z");
const IST = "Asia/Calcutta";
const NY = "America/New_York";
const THIN = " ";

const range = (token: string, timezone: string, now: number = NOW) => {
  const r = resolveCalendarPeriod(token, timezone, now);
  if (!r) return null;
  return {
    start: new Date(r.startTime / 1000).toISOString(),
    end: new Date(r.endTime / 1000).toISOString(),
  };
};

const label = (token: string, timezone: string = IST, now: number = NOW) =>
  formatCalendarLabel(token, timezone, gt, "en-US", now);

describe("calendarPeriods", () => {
  describe("parseCalendarToken", () => {
    it.each([
      ["calendar:day:0", { unit: "day", offset: 0 }],
      ["calendar:day:-1", { unit: "day", offset: -1 }],
      ["calendar:week:-2", { unit: "week", offset: -2 }],
      ["calendar:month:-13", { unit: "month", offset: -13 }],
      ["calendar:quarter:0", { unit: "quarter", offset: 0 }],
      ["calendar:year:-999999", { unit: "year", offset: -999999 }],
    ])("parses %s", (token, expected) => {
      expect(parseCalendarToken(token)).toEqual(expected);
    });

    it.each([
      "calendar:day:1",
      "calendar:day:+1",
      "calendar:day:-0",
      "calendar:month:01",
      "calendar:month:-01",
      "calendar:fortnight:0",
      "calendar:day",
      "calendar:day:-1x",
      " calendar:day:0",
      "calendar:day:-1234567",
      "CALENDAR:day:0",
      "15m",
      "",
    ])("rejects malformed token %j", (token) => {
      expect(parseCalendarToken(token)).toBeNull();
      expect(resolveCalendarPeriod(token, IST, NOW)).toBeNull();
      expect(formatCalendarLabel(token, IST, gt, "en-US", NOW)).toBeNull();
      expect(formatCalendarTooltip(token, IST, NOW)).toBeNull();
    });

    it.each([null, undefined, 42, {}])("rejects non-string %j", (token) => {
      expect(parseCalendarToken(token)).toBeNull();
    });
  });

  describe("buildCalendarToken / shiftCalendarToken", () => {
    it("builds tokens and never emits -0", () => {
      expect(buildCalendarToken("month", -2)).toBe("calendar:month:-2");
      expect(buildCalendarToken("day", -0)).toBe("calendar:day:0");
    });

    it("steps back and forward within the same unit", () => {
      expect(shiftCalendarToken("calendar:month:0", -1)).toBe("calendar:month:-1");
      expect(shiftCalendarToken("calendar:week:-1", -1)).toBe("calendar:week:-2");
      expect(shiftCalendarToken("calendar:quarter:-1", 1)).toBe("calendar:quarter:0");
    });

    it("refuses to step into the future, past the offset limit, or from a non-calendar token", () => {
      expect(shiftCalendarToken("calendar:day:0", 1)).toBeNull();
      expect(shiftCalendarToken("calendar:day:-999999", -1)).toBeNull();
      expect(shiftCalendarToken("15m", -1)).toBeNull();
    });
  });

  describe("resolveCalendarPeriod in Asia/Calcutta", () => {
    it.each([
      ["calendar:day:0", "2026-10-07T18:30:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:day:-1", "2026-10-06T18:30:00.000Z", "2026-10-07T18:29:59.999Z"],
      ["calendar:day:-2", "2026-10-05T18:30:00.000Z", "2026-10-06T18:29:59.999Z"],
      ["calendar:week:0", "2026-10-04T18:30:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:week:-1", "2026-09-27T18:30:00.000Z", "2026-10-04T18:29:59.999Z"],
      ["calendar:week:-2", "2026-09-20T18:30:00.000Z", "2026-09-27T18:29:59.999Z"],
      ["calendar:month:0", "2026-09-30T18:30:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:month:-1", "2026-08-31T18:30:00.000Z", "2026-09-30T18:29:59.999Z"],
      ["calendar:month:-2", "2026-07-31T18:30:00.000Z", "2026-08-31T18:29:59.999Z"],
      ["calendar:month:-13", "2025-08-31T18:30:00.000Z", "2025-09-30T18:29:59.999Z"],
      ["calendar:quarter:0", "2026-09-30T18:30:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:quarter:-1", "2026-06-30T18:30:00.000Z", "2026-09-30T18:29:59.999Z"],
      ["calendar:quarter:-2", "2026-03-31T18:30:00.000Z", "2026-06-30T18:29:59.999Z"],
      ["calendar:quarter:-13", "2023-06-30T18:30:00.000Z", "2023-09-30T18:29:59.999Z"],
      ["calendar:year:0", "2025-12-31T18:30:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:year:-1", "2024-12-31T18:30:00.000Z", "2025-12-31T18:29:59.999Z"],
      ["calendar:year:-2", "2023-12-31T18:30:00.000Z", "2024-12-31T18:29:59.999Z"],
      ["calendar:year:-13", "2012-12-31T18:30:00.000Z", "2013-12-31T18:29:59.999Z"],
    ])("%s", (token, start, end) => {
      expect(range(token, IST)).toEqual({ start, end });
    });

    it("returns microseconds", () => {
      const r = resolveCalendarPeriod("calendar:day:0", IST, NOW);
      expect(r?.endTime).toBe(NOW * 1000);
    });
  });

  describe("resolveCalendarPeriod in UTC", () => {
    it.each([
      ["calendar:day:0", "2026-10-08T00:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:day:-1", "2026-10-07T00:00:00.000Z", "2026-10-07T23:59:59.999Z"],
      ["calendar:day:-2", "2026-10-06T00:00:00.000Z", "2026-10-06T23:59:59.999Z"],
      ["calendar:week:0", "2026-10-05T00:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:week:-1", "2026-09-28T00:00:00.000Z", "2026-10-04T23:59:59.999Z"],
      ["calendar:week:-2", "2026-09-21T00:00:00.000Z", "2026-09-27T23:59:59.999Z"],
      ["calendar:month:0", "2026-10-01T00:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:month:-1", "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"],
      ["calendar:month:-2", "2026-08-01T00:00:00.000Z", "2026-08-31T23:59:59.999Z"],
      ["calendar:month:-13", "2025-09-01T00:00:00.000Z", "2025-09-30T23:59:59.999Z"],
      ["calendar:quarter:0", "2026-10-01T00:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:quarter:-1", "2026-07-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"],
      ["calendar:quarter:-2", "2026-04-01T00:00:00.000Z", "2026-06-30T23:59:59.999Z"],
      ["calendar:quarter:-13", "2023-07-01T00:00:00.000Z", "2023-09-30T23:59:59.999Z"],
      ["calendar:year:0", "2026-01-01T00:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:year:-1", "2025-01-01T00:00:00.000Z", "2025-12-31T23:59:59.999Z"],
      ["calendar:year:-2", "2024-01-01T00:00:00.000Z", "2024-12-31T23:59:59.999Z"],
      ["calendar:year:-13", "2013-01-01T00:00:00.000Z", "2013-12-31T23:59:59.999Z"],
    ])("%s", (token, start, end) => {
      expect(range(token, "UTC")).toEqual({ start, end });
    });
  });

  describe("resolveCalendarPeriod in America/New_York", () => {
    it.each([
      ["calendar:day:0", "2026-10-07T04:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:day:-1", "2026-10-06T04:00:00.000Z", "2026-10-07T03:59:59.999Z"],
      ["calendar:day:-2", "2026-10-05T04:00:00.000Z", "2026-10-06T03:59:59.999Z"],
      ["calendar:week:0", "2026-10-05T04:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:week:-1", "2026-09-28T04:00:00.000Z", "2026-10-05T03:59:59.999Z"],
      ["calendar:month:0", "2026-10-01T04:00:00.000Z", "2026-10-08T03:00:00.000Z"],
      ["calendar:month:-1", "2026-09-01T04:00:00.000Z", "2026-10-01T03:59:59.999Z"],
      ["calendar:quarter:-1", "2026-07-01T04:00:00.000Z", "2026-10-01T03:59:59.999Z"],
      ["calendar:year:-1", "2025-01-01T05:00:00.000Z", "2026-01-01T04:59:59.999Z"],
    ])("resolves %s on the previous local day", (token, start, end) => {
      expect(range(token, NY)).toEqual({ start, end });
    });

    it("labels the New York day by its own calendar, not UTC's", () => {
      expect(label("calendar:day:-2", NY)).toBe("Oct 5");
      expect(label("calendar:day:-2", "UTC")).toBe("Oct 6");
    });

    it("spring-forward week and day are an hour short", () => {
      const tue = Date.parse("2026-03-10T15:00:00Z");
      expect(range("calendar:week:0", NY, tue)?.start).toBe("2026-03-09T04:00:00.000Z");
      expect(range("calendar:week:-1", NY, tue)).toEqual({
        start: "2026-03-02T05:00:00.000Z",
        end: "2026-03-09T03:59:59.999Z",
      });
      const mon = Date.parse("2026-03-09T15:00:00Z");
      expect(range("calendar:day:-1", NY, mon)).toEqual({
        start: "2026-03-08T05:00:00.000Z",
        end: "2026-03-09T03:59:59.999Z",
      });
    });

    it("fall-back week and day are an hour long", () => {
      const tue = Date.parse("2026-11-03T15:00:00Z");
      expect(range("calendar:week:-1", NY, tue)).toEqual({
        start: "2026-10-26T04:00:00.000Z",
        end: "2026-11-02T04:59:59.999Z",
      });
      const mon = Date.parse("2026-11-02T15:00:00Z");
      expect(range("calendar:day:-1", NY, mon)).toEqual({
        start: "2026-11-01T04:00:00.000Z",
        end: "2026-11-02T04:59:59.999Z",
      });
    });
  });

  describe("DST change at midnight", () => {
    it.each([
      // Santiago skips 2026-09-06 00:00 (−04 → −03): the day starts at 01:00.
      [
        "America/Santiago",
        "calendar:day:-1",
        "2026-09-07T15:00:00Z",
        "2026-09-06T04:00:00.000Z",
        "2026-09-07T02:59:59.999Z",
      ],
      [
        "America/Santiago",
        "calendar:day:-2",
        "2026-09-07T15:00:00Z",
        "2026-09-05T04:00:00.000Z",
        "2026-09-06T03:59:59.999Z",
      ],
      [
        "America/Santiago",
        "calendar:week:-1",
        "2026-09-07T15:00:00Z",
        "2026-08-31T04:00:00.000Z",
        "2026-09-07T02:59:59.999Z",
      ],
      [
        "America/Santiago",
        "calendar:month:-1",
        "2026-10-07T15:00:00Z",
        "2026-09-01T04:00:00.000Z",
        "2026-10-01T02:59:59.999Z",
      ],
      // Havana skips 2026-03-08 00:00 (−05 → −04).
      [
        "America/Havana",
        "calendar:day:-1",
        "2026-03-09T15:00:00Z",
        "2026-03-08T05:00:00.000Z",
        "2026-03-09T03:59:59.999Z",
      ],
      [
        "America/Havana",
        "calendar:day:-2",
        "2026-03-09T15:00:00Z",
        "2026-03-07T05:00:00.000Z",
        "2026-03-08T04:59:59.999Z",
      ],
      [
        "America/Havana",
        "calendar:week:-1",
        "2026-03-09T15:00:00Z",
        "2026-03-02T05:00:00.000Z",
        "2026-03-09T03:59:59.999Z",
      ],
      // Havana repeats 2026-11-01 00:00 (−04 → −05): the day starts at the first one.
      [
        "America/Havana",
        "calendar:day:-1",
        "2026-11-02T15:00:00Z",
        "2026-11-01T04:00:00.000Z",
        "2026-11-02T04:59:59.999Z",
      ],
      [
        "America/Havana",
        "calendar:day:-2",
        "2026-11-02T15:00:00Z",
        "2026-10-31T04:00:00.000Z",
        "2026-11-01T03:59:59.999Z",
      ],
      [
        "America/Havana",
        "calendar:month:0",
        "2026-11-02T15:00:00Z",
        "2026-11-01T04:00:00.000Z",
        "2026-11-02T15:00:00.000Z",
      ],
      [
        "America/Havana",
        "calendar:month:-1",
        "2026-11-02T15:00:00Z",
        "2026-10-01T04:00:00.000Z",
        "2026-11-01T03:59:59.999Z",
      ],
      // Beirut skips 2026-03-29 00:00 (+02 → +03) and falls back across midnight on 2026-10-25.
      [
        "Asia/Beirut",
        "calendar:day:-1",
        "2026-03-30T10:00:00Z",
        "2026-03-28T22:00:00.000Z",
        "2026-03-29T20:59:59.999Z",
      ],
      [
        "Asia/Beirut",
        "calendar:day:-2",
        "2026-03-30T10:00:00Z",
        "2026-03-27T22:00:00.000Z",
        "2026-03-28T21:59:59.999Z",
      ],
      [
        "Asia/Beirut",
        "calendar:week:-1",
        "2026-03-30T10:00:00Z",
        "2026-03-22T22:00:00.000Z",
        "2026-03-29T20:59:59.999Z",
      ],
      [
        "Asia/Beirut",
        "calendar:day:-1",
        "2026-10-26T10:00:00Z",
        "2026-10-24T22:00:00.000Z",
        "2026-10-25T21:59:59.999Z",
      ],
      // Asunción skipped 2023-10-01 00:00, the first day of a month and a quarter.
      [
        "America/Asuncion",
        "calendar:month:0",
        "2023-10-02T15:00:00Z",
        "2023-10-01T04:00:00.000Z",
        "2023-10-02T15:00:00.000Z",
      ],
      [
        "America/Asuncion",
        "calendar:quarter:0",
        "2023-10-02T15:00:00Z",
        "2023-10-01T04:00:00.000Z",
        "2023-10-02T15:00:00.000Z",
      ],
      [
        "America/Asuncion",
        "calendar:month:-1",
        "2023-10-02T15:00:00Z",
        "2023-09-01T04:00:00.000Z",
        "2023-10-01T03:59:59.999Z",
      ],
    ])("%s %s at %s", (zone, token, now, start, end) => {
      expect(range(token, zone, Date.parse(now))).toEqual({ start, end });
    });

    it("never starts a day on the previous date", () => {
      expect(
        formatCalendarTooltip(
          "calendar:day:-1",
          "America/Santiago",
          Date.parse("2026-09-07T15:00:00Z"),
        ),
      ).toBe("2026/09/06 01:00:00 - 2026/09/06 23:59:59 (America/Santiago)");
      expect(
        formatCalendarTooltip(
          "calendar:day:-2",
          "America/Havana",
          Date.parse("2026-11-02T15:00:00Z"),
        ),
      ).toBe("2026/10/31 00:00:00 - 2026/10/31 23:59:59 (America/Havana)");
    });
  });

  describe("calendar edges", () => {
    it("covers 29 days of February in a leap year", () => {
      const now = Date.parse("2028-03-15T12:00:00Z");
      expect(range("calendar:month:-1", "UTC", now)).toEqual({
        start: "2028-02-01T00:00:00.000Z",
        end: "2028-02-29T23:59:59.999Z",
      });
      expect(label("calendar:month:-2", "UTC", Date.parse("2028-04-02T12:00:00Z"))).toBe(
        "Feb 2028",
      );
    });

    it("starts this week in the previous year when the week spans Dec–Jan", () => {
      const sat = Date.parse("2027-01-02T12:00:00Z");
      expect(range("calendar:week:0", "UTC", sat)).toEqual({
        start: "2026-12-28T00:00:00.000Z",
        end: "2027-01-02T12:00:00.000Z",
      });
      expect(range("calendar:year:0", "UTC", sat)?.start).toBe("2027-01-01T00:00:00.000Z");
      expect(label("calendar:week:-2", "UTC", sat)).toBe(`Dec 14${THIN}–${THIN}20, 2026`);
      expect(label("calendar:day:-2", "UTC", sat)).toBe("Dec 31, 2026");
    });

    it("switches quarter exactly at the local quarter boundary", () => {
      const lastMinuteQ1 = Date.parse("2026-03-31T23:59:00Z");
      expect(range("calendar:quarter:0", "UTC", lastMinuteQ1)?.start).toBe(
        "2026-01-01T00:00:00.000Z",
      );
      const firstMinuteQ2 = Date.parse("2026-04-01T00:00:00Z");
      expect(range("calendar:quarter:0", "UTC", firstMinuteQ2)?.start).toBe(
        "2026-04-01T00:00:00.000Z",
      );
      expect(range("calendar:quarter:-1", "UTC", firstMinuteQ2)).toEqual({
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-03-31T23:59:59.999Z",
      });
      const istQ2 = Date.parse("2026-03-31T19:00:00Z");
      expect(range("calendar:quarter:0", IST, istQ2)?.start).toBe("2026-03-31T18:30:00.000Z");
    });

    it("returns null when the period falls before year 1", () => {
      expect(resolveCalendarPeriod("calendar:year:-999999", "UTC", NOW)).toBeNull();
      expect(formatCalendarLabel("calendar:year:-999999", "UTC", gt, "en-US", NOW)).toBeNull();
    });

    it("falls back to the browser timezone for a missing or unknown zone", () => {
      const utc = resolveCalendarPeriod("calendar:day:0", "UTC", NOW);
      expect(resolveCalendarPeriod("calendar:day:0", "Not/AZone", NOW)).toEqual(utc);
      expect(resolveCalendarPeriod("calendar:day:0", "Browser Time (UTC)", NOW)).toEqual(utc);
      expect(resolveCalendarPeriod("calendar:day:0", null, NOW)).toEqual(utc);
      expect(resolveCalendarPeriod("calendar:day:0", undefined, NOW)).toEqual(utc);
    });

    it("defaults now to the current clock", () => {
      const r = resolveCalendarPeriod("calendar:day:0", "UTC");
      expect(r).not.toBeNull();
      expect(Math.abs((r?.endTime ?? 0) / 1000 - Date.now())).toBeLessThan(1000);
    });
  });

  describe("formatCalendarLabel", () => {
    it.each([
      ["calendar:day:0", "Today"],
      ["calendar:day:-1", "Yesterday"],
      ["calendar:day:-2", "Oct 6"],
      ["calendar:week:0", "This week"],
      ["calendar:week:-1", "Last week"],
      ["calendar:week:-2", `Sep 21${THIN}–${THIN}27`],
      ["calendar:month:0", "This month"],
      ["calendar:month:-1", "Last month"],
      ["calendar:month:-2", "Aug 2026"],
      ["calendar:month:-13", "Sep 2025"],
      ["calendar:quarter:0", "This quarter"],
      ["calendar:quarter:-1", "Last quarter"],
      ["calendar:quarter:-2", "Q2 2026"],
      ["calendar:quarter:-13", "Q3 2023"],
      ["calendar:year:0", "This year"],
      ["calendar:year:-1", "Last year"],
      ["calendar:year:-2", "2024"],
    ])("%s → %s", (token, expected) => {
      expect(label(token)).toBe(expected);
    });

    it("spells a cross-month week with both months", () => {
      const thu = Date.parse("2026-10-15T03:00:00Z");
      expect(label("calendar:week:-2", IST, thu)).toBe(`Sep 28${THIN}–${THIN}Oct 4`);
    });

    it("includes the year for an older day in another year", () => {
      expect(label("calendar:day:-400")).toBe("Sep 3, 2025");
    });

    it("defaults to the en-US locale and the current clock", () => {
      expect(formatCalendarLabel("calendar:month:0", "UTC", gt)).toBe("This month");
    });

    it("honours the locale", () => {
      expect(formatCalendarLabel("calendar:month:-2", IST, gt, "de-DE", NOW)).toBe("Aug. 2026");
    });
  });

  describe("formatCalendarTooltip", () => {
    it("ends at now for the current period", () => {
      expect(formatCalendarTooltip("calendar:month:0", IST, NOW)).toBe(
        "2026/10/01 00:00:00 - 2026/10/08 08:30:00 (Asia/Calcutta)",
      );
    });

    it("ends at the last second of a past period", () => {
      expect(formatCalendarTooltip("calendar:month:-1", IST, NOW)).toBe(
        "2026/09/01 00:00:00 - 2026/09/30 23:59:59 (Asia/Calcutta)",
      );
      expect(formatCalendarTooltip("calendar:day:-1", NY, NOW)).toBe(
        "2026/10/06 00:00:00 - 2026/10/06 23:59:59 (America/New_York)",
      );
    });

    it("names the resolved zone when the given one is unknown", () => {
      expect(formatCalendarTooltip("calendar:day:0", "Not/AZone", NOW)).toBe(
        "2026/10/08 00:00:00 - 2026/10/08 03:00:00 (UTC)",
      );
    });
  });
});
