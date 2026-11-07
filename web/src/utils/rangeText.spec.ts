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

import { describe, expect, it, vi } from "vitest";
import {
  describeDstTransition,
  displayEndUs,
  formatRangeTooltipLines,
  formatRecentDuration,
  formatUtcOffsetAt,
  wallInstants,
  zoneOffsetMs,
} from "./rangeText";

const us = (iso: string) => Date.parse(iso) * 1000;
const NY = "America/New_York";

describe("rangeText", () => {
  it("builds the UTC offset by hand, at the instant given", () => {
    expect(formatUtcOffsetAt(Date.parse("2026-11-06T00:00:00Z"), "Asia/Calcutta")).toBe(
      "UTC+05:30",
    );
    expect(formatUtcOffsetAt(Date.parse("2026-11-06T00:00:00Z"), "UTC")).toBe("UTC");
    expect(formatUtcOffsetAt(Date.parse("2026-11-01T05:30:00Z"), NY)).toBe("UTC-04:00");
    expect(formatUtcOffsetAt(Date.parse("2026-11-01T06:15:00Z"), NY)).toBe("UTC-05:00");
  });

  it("reads an unknown zone's offset as NaN", () => {
    expect(zoneOffsetMs(0, "Not/AZone")).toBeNaN();
  });

  it("finds one instant for a normal wall time, none in a gap, two in a repeated hour", () => {
    expect(wallInstants("2026-11-04", "13:47:03", "Asia/Calcutta")).toEqual([
      Date.parse("2026-11-04T08:17:03Z"),
    ]);
    expect(wallInstants("2026-03-08", "02:30:00", NY)).toEqual([]);
    expect(wallInstants("2026-11-01", "01:30:00", NY)).toEqual([
      Date.parse("2026-11-01T05:30:00Z"),
      Date.parse("2026-11-01T06:30:00Z"),
    ]);
  });

  it("reads a wall time without an Intl offset as one instant, not as a DST gap", () => {
    expect(wallInstants("2026-11-04", "13:47:03", "Not/AZone")).toEqual([
      Date.parse("2026-11-04T13:47:03Z"),
    ]);
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "formatToParts")
      .mockReturnValue([{ type: "literal", value: "" }]);
    try {
      expect(wallInstants("2026-11-04", "13:47:03", "Asia/Kathmandu")).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("names the wall clock either side of a DST change", () => {
    expect(describeDstTransition("2026-03-08", "02:30:00", NY)).toMatchObject({
      before: "02:00",
      after: "03:00",
    });
    expect(describeDstTransition("2026-11-01", "01:30:00", NY)).toMatchObject({
      before: "02:00",
      after: "01:00",
    });
    expect(describeDstTransition("2026-11-04", "13:47:03", "Asia/Calcutta")).toBeNull();
  });

  it("reads an exclusive midnight end as the second before it", () => {
    const start = us("2026-11-05T00:00:00Z");
    expect(displayEndUs(start, us("2026-11-06T00:00:00Z"), "UTC")).toBe(
      us("2026-11-06T00:00:00Z") - 1,
    );
    expect(displayEndUs(start, us("2026-11-05T14:02:03Z"), "UTC")).toBe(us("2026-11-05T14:02:03Z"));
  });

  it("writes the tooltip as an ISO range and a duration with the zone", () => {
    expect(
      formatRangeTooltipLines(
        us("2026-11-04T08:17:03Z"),
        us("2026-11-06T08:32:03Z"),
        "Asia/Calcutta",
      ),
    ).toEqual({
      range: "2026-11-04 13:47:03 – 2026-11-06 14:02:03",
      detail: "2d 15m · Asia/Calcutta (UTC+05:30)",
    });
    expect(
      formatRangeTooltipLines(us("2026-11-05T00:00:00Z"), us("2026-11-06T00:00:00Z"), "UTC"),
    ).toEqual({
      range: "2026-11-05 00:00:00 – 2026-11-05 23:59:59",
      detail: "1d · UTC",
    });
  });

  it("keeps the duration formatter the rail already used", () => {
    expect(formatRecentDuration(0, 2 * 86_400_000_000 + 15 * 60_000_000)).toBe("2d 15m");
  });
});
