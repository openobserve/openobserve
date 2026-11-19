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
  isRangeAllowed,
  isValidRange,
  queryWindow,
  rangeFromLegacy,
  rangeFromQuery,
  rangeState,
  rangeToLegacy,
  rangeToQuery,
  resolveRange,
  sameRange,
  type TimeRangeContext,
} from "./timeRangeModel";

// Thu Nov 12 2026 21:24:10 Asia/Calcutta = 15:54:10 UTC.
const NOW_US = Date.UTC(2026, 10, 12, 15, 54, 10) * 1000;
const ctx: TimeRangeContext = {
  nowUs: NOW_US,
  zone: "Asia/Calcutta",
  weekStart: 1,
  locale: "en-US",
  fiscalYearStartMonth: null,
};
const HOUR_US = 3_600_000_000;
const DAY_US = 24 * HOUR_US;

describe("resolveRange", () => {
  it("counts a rolling span back from now", () => {
    expect(resolveRange({ kind: "rolling", span: "15m" }, ctx)).toEqual({
      startUs: NOW_US - 15 * 60_000_000,
      endUs: NOW_US,
    });
  });

  it("ends a finished calendar period at the next period's start in the display zone", () => {
    const range = resolveRange({ kind: "calendar", unit: "day", offset: -1 }, ctx);
    // Nov 11 00:00 and Nov 12 00:00 at UTC+05:30.
    expect(range.startUs).toBe(Date.UTC(2026, 10, 10, 18, 30) * 1000);
    expect(range.endUs).toBe(Date.UTC(2026, 10, 11, 18, 30) * 1000);
  });

  it("returns a fixed range's instants as they are, even past now", () => {
    const fixed = { kind: "fixed" as const, startUs: NOW_US - HOUR_US, endUs: NOW_US + HOUR_US };
    expect(resolveRange(fixed, ctx)).toEqual({ startUs: fixed.startUs, endUs: fixed.endUs });
  });
});

describe("queryWindow", () => {
  it("stops an in-progress fixed range at now", () => {
    const fixed = { kind: "fixed" as const, startUs: NOW_US - HOUR_US, endUs: NOW_US + DAY_US };
    expect(queryWindow(fixed, ctx)).toEqual({ startUs: NOW_US - HOUR_US, endUs: NOW_US });
  });
});

describe("rangeState", () => {
  it("names the four states of the kind rule", () => {
    expect(rangeState({ kind: "rolling", span: "1h" }, ctx)).toBe("live");
    expect(rangeState({ kind: "calendar", unit: "quarter", offset: 0 }, ctx)).toBe("live");
    expect(rangeState({ kind: "calendar", unit: "quarter", offset: -1 }, ctx)).toBe(
      "calendar-ended",
    );
    expect(rangeState({ kind: "fixed", startUs: NOW_US - HOUR_US, endUs: NOW_US + 1 }, ctx)).toBe(
      "fixed-in-progress",
    );
    expect(rangeState({ kind: "fixed", startUs: NOW_US - HOUR_US, endUs: NOW_US }, ctx)).toBe(
      "fixed-ended",
    );
  });
});

describe("isValidRange", () => {
  it("refuses a reversed, empty or future-started fixed range", () => {
    expect(isValidRange({ kind: "fixed", startUs: 2, endUs: 1 }, NOW_US)).toBe(false);
    expect(isValidRange({ kind: "fixed", startUs: 1, endUs: 1 }, NOW_US)).toBe(false);
    expect(isValidRange({ kind: "fixed", startUs: NOW_US + 1, endUs: NOW_US + 2 }, NOW_US)).toBe(
      false,
    );
    expect(
      isValidRange({ kind: "fixed", startUs: NOW_US + 1, endUs: NOW_US + 2 }, NOW_US, {
        future: true,
      }),
    ).toBe(true);
  });

  it("refuses an end more than ten years ahead", () => {
    const end = NOW_US + 11 * 366 * DAY_US;
    expect(isValidRange({ kind: "fixed", startUs: NOW_US - 1, endUs: end }, NOW_US)).toBe(false);
  });

  it("refuses unreadable rolling spans and future calendar offsets", () => {
    expect(isValidRange({ kind: "rolling", span: "abc" }, NOW_US)).toBe(false);
    expect(isValidRange({ kind: "calendar", unit: "day", offset: 1 }, NOW_US)).toBe(false);
    expect(isValidRange({ kind: "calendar", unit: "day", offset: -3 }, NOW_US)).toBe(true);
  });
});

describe("isRangeAllowed", () => {
  it("allows only the kinds a host can store", () => {
    const caps = { kinds: ["rolling" as const] };
    expect(isRangeAllowed({ kind: "rolling", span: "1h" }, caps)).toBe(true);
    expect(isRangeAllowed({ kind: "calendar", unit: "day", offset: 0 }, caps)).toBe(false);
    expect(isRangeAllowed({ kind: "calendar", unit: "day", offset: 0 })).toBe(true);
  });
});

describe("URL helpers", () => {
  it("writes period for tokens and from/to for instants", () => {
    expect(rangeToQuery({ kind: "rolling", span: "15m" })).toEqual({
      period: "15m",
      from: undefined,
      to: undefined,
    });
    expect(rangeToQuery({ kind: "calendar", unit: "quarter", offset: -1 }).period).toBe(
      "calendar:quarter:-1",
    );
    expect(rangeToQuery({ kind: "fixed", startUs: 10, endUs: 20 })).toEqual({
      period: undefined,
      from: "10",
      to: "20",
    });
  });

  it("reads back what it writes", () => {
    const fixed = { kind: "fixed" as const, startUs: NOW_US - HOUR_US, endUs: NOW_US };
    expect(rangeFromQuery(rangeToQuery(fixed), NOW_US)).toEqual(fixed);
    const calendar = { kind: "calendar" as const, unit: "month" as const, offset: -1 };
    expect(rangeFromQuery(rangeToQuery(calendar), NOW_US)).toEqual(calendar);
  });

  it("reads from/to in seconds, milliseconds and ISO", () => {
    const startS = Math.floor(NOW_US / 1e6) - 3600;
    const endS = Math.floor(NOW_US / 1e6);
    expect(rangeFromQuery({ from: String(startS), to: String(endS) }, NOW_US)).toEqual({
      kind: "fixed",
      startUs: startS * 1e6,
      endUs: endS * 1e6,
    });
    expect(
      rangeFromQuery({ from: String(startS * 1000), to: String(endS * 1000) }, NOW_US),
    ).toEqual({ kind: "fixed", startUs: startS * 1e6, endUs: endS * 1e6 });
    expect(
      rangeFromQuery({ from: "2026-11-12T10:00:00Z", to: "2026-11-12T11:00:00Z" }, NOW_US),
    ).toEqual({
      kind: "fixed",
      startUs: Date.UTC(2026, 10, 12, 10) * 1000,
      endUs: Date.UTC(2026, 10, 12, 11) * 1000,
    });
  });

  it("answers null without a range and invalid for an unreadable one", () => {
    expect(rangeFromQuery({ q: "x" }, NOW_US)).toBeNull();
    expect(rangeFromQuery({ period: "soon" }, NOW_US)).toBe("invalid");
    expect(rangeFromQuery({ from: "20", to: "10" }, NOW_US)).toBe("invalid");
    expect(rangeFromQuery({ from: "10" }, NOW_US)).toBe("invalid");
  });

  it("refuses a link kind the host cannot store", () => {
    expect(rangeFromQuery({ period: "calendar:day:0" }, NOW_US, { kinds: ["fixed"] })).toBe(
      "invalid",
    );
  });
});

describe("legacy bridge", () => {
  it("round-trips every kind through the stored payload", () => {
    const ranges = [
      { kind: "rolling" as const, span: "6h" },
      { kind: "calendar" as const, unit: "week" as const, offset: -1 },
      { kind: "fixed" as const, startUs: NOW_US - DAY_US, endUs: NOW_US },
    ];
    for (const range of ranges) {
      expect(rangeFromLegacy(rangeToLegacy(range, ctx))).toEqual(range);
    }
  });

  it("resolves the stored bounds of a token", () => {
    const legacy = rangeToLegacy({ kind: "rolling", span: "1h" }, ctx);
    expect(legacy).toEqual({
      startTime: NOW_US - HOUR_US,
      endTime: NOW_US,
      relativeTimePeriod: "1h",
      valueType: "relative",
    });
  });

  it("reads a relative-custom payload and an unreadable one", () => {
    expect(rangeFromLegacy({ valueType: "relative-custom", relativeTimePeriod: "2d" })).toEqual({
      kind: "rolling",
      span: "2d",
    });
    expect(rangeFromLegacy({ valueType: "relative", relativeTimePeriod: "" })).toBeNull();
  });
});

describe("sameRange", () => {
  it("compares by stored value", () => {
    expect(sameRange({ kind: "rolling", span: "1h" }, { kind: "rolling", span: "1h" })).toBe(true);
    expect(sameRange({ kind: "rolling", span: "1h" }, { kind: "rolling", span: "60m" })).toBe(
      false,
    );
    expect(sameRange(null, null)).toBe(true);
  });
});
