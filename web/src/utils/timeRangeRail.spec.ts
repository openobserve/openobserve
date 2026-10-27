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
  formatRecentRange,
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
