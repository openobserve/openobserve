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
import { CALENDAR_RAIL_ITEMS, exceedsRangeRestriction, formatRecentRange } from "./timeRangeRail";
import { parseCalendarToken } from "./dashboard/calendarPeriods";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const us = (iso: string) => Date.parse(iso) * 1000;
const label = (start: string, end: string, zone = "UTC") =>
  formatRecentRange(us(start), us(end), zone, "en-US", NOW);

describe("timeRangeRail", () => {
  describe("formatRecentRange", () => {
    it("shows a same-day range as one date and two times", () => {
      expect(label("2026-10-26T15:45:00Z", "2026-10-26T16:20:00Z")).toEqual({
        label: "Oct 26 · 15:45–16:20",
        extraDays: 0,
      });
    });

    it("marks a range that crosses midnight once with one extra day", () => {
      expect(label("2026-10-25T22:00:00Z", "2026-10-26T01:30:00Z")).toEqual({
        label: "Oct 25 22:00–01:30",
        extraDays: 1,
      });
    });

    it("shows only the two dates for a range of two days or more", () => {
      expect(label("2026-10-19T08:00:00Z", "2026-10-21T09:00:00Z")).toEqual({
        label: "Oct 19 – Oct 21",
        extraDays: 0,
      });
    });

    it("adds the year only when it is not the current one", () => {
      expect(label("2025-12-30T10:00:00Z", "2026-01-02T10:00:00Z").label).toBe(
        "Dec 30, 2025 – Jan 2",
      );
      expect(label("2025-03-04T10:00:00Z", "2025-03-04T11:00:00Z").label).toBe(
        "Mar 4, 2025 · 10:00–11:00",
      );
    });

    it("reads an end at exactly midnight as the end of the previous day", () => {
      expect(label("2026-10-26T00:00:00Z", "2026-10-27T00:00:00Z")).toEqual({
        label: "Oct 26 · 00:00–23:59",
        extraDays: 0,
      });
      expect(label("2026-10-19T00:00:00Z", "2026-10-26T00:00:00Z").label).toBe("Oct 19 – Oct 25");
    });

    it("reads days and times in the picker timezone", () => {
      expect(label("2026-10-26T20:00:00Z", "2026-10-26T21:00:00Z", "Asia/Calcutta")).toEqual({
        label: "Oct 27 · 01:30–02:30",
        extraDays: 0,
      });
      expect(label("2026-10-26T18:00:00Z", "2026-10-26T19:00:00Z", "Asia/Calcutta")).toEqual({
        label: "Oct 26 23:30–00:30",
        extraDays: 1,
      });
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

  it("lists the ten calendar ranges as valid tokens, with so far on the current ones", () => {
    expect(CALENDAR_RAIL_ITEMS).toHaveLength(10);
    for (const item of CALENDAR_RAIL_ITEMS) {
      const period = parseCalendarToken(item.token);
      expect(period).not.toBeNull();
      expect(item.soFar).toBe(period?.offset === 0);
    }
  });
});
