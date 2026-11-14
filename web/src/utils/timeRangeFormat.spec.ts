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
import type { TranslateFn } from "@/types/i18n";
import {
  formatTimeRange,
  timeRangeCopyText,
  timeRangeEndsNote,
  timeRangeKindTag,
  timeRangeName,
} from "./timeRangeFormat";
import { resolveRange, type TimeRangeContext } from "./timeRangeModel";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}${JSON.stringify(params)}` : key) as unknown as TranslateFn;
// Thu Nov 12 2026 21:24:10 at UTC+05:30.
const NOW_US = Date.UTC(2026, 10, 12, 15, 54, 10) * 1000;
const ctx: TimeRangeContext = {
  nowUs: NOW_US,
  zone: "Asia/Calcutta",
  weekStart: 1,
  locale: "en-US",
  fiscalYearStartMonth: null,
};
// Midnight of a civil day at UTC+05:30.
const ist = (year: number, month: number, day: number) =>
  (Date.UTC(year, month - 1, day) - 5.5 * 3_600_000) * 1000;

describe("timeRangeName", () => {
  it("names whole months, quarters, halves and years in the display zone", () => {
    const name = (start: number, end: number) =>
      timeRangeName({ kind: "fixed", startUs: start, endUs: end }, ctx, t);
    expect(name(ist(2026, 7, 1), ist(2026, 10, 1))).toBe("Q3 2026");
    expect(name(ist(2026, 10, 1), ist(2026, 11, 1))).toBe("Oct 2026");
    expect(name(ist(2026, 1, 1), ist(2026, 7, 1))).toBe("H1 2026");
    expect(name(ist(2025, 1, 1), ist(2026, 1, 1))).toBe("2025");
    expect(name(ist(2026, 11, 4), ist(2026, 11, 7))).toBeNull();
  });

  it("does not name a quarter read in another zone", () => {
    const utc = { ...ctx, zone: "UTC" };
    const range = { kind: "fixed" as const, startUs: ist(2026, 7, 1), endUs: ist(2026, 10, 1) };
    expect(timeRangeName(range, utc, t)).toBeNull();
  });

  it("names a fiscal year only once the org has set its start", () => {
    const range = { kind: "fixed" as const, startUs: ist(2025, 4, 1), endUs: ist(2026, 4, 1) };
    expect(timeRangeName(range, ctx, t)).toBeNull();
    expect(timeRangeName(range, { ...ctx, fiscalYearStartMonth: 4 }, t)).toBe("FY26");
  });

  it("names tokens through the period labels, a year as twelve months", () => {
    expect(timeRangeName({ kind: "rolling", span: "12M" }, ctx, t)).toBe(
      'common.pastMonth{"count":"12"}',
    );
    expect(timeRangeName({ kind: "calendar", unit: "quarter", offset: -1 }, ctx, t)).toBe(
      "dateTime.previousQuarter",
    );
  });
});

describe("kind tag and ends note", () => {
  it("tags live, calendar and fixed ranges", () => {
    expect(timeRangeKindTag({ kind: "rolling", span: "15m" }, ctx, t)).toBe("dateTime.tagLive");
    expect(timeRangeKindTag({ kind: "calendar", unit: "quarter", offset: -1 }, ctx, t)).toBe(
      'dateTime.changesWhen{"when":"Jan 1"}',
    );
    expect(timeRangeKindTag({ kind: "calendar", unit: "day", offset: -1 }, ctx, t)).toBe(
      "dateTime.changesAtMidnight",
    );
    expect(timeRangeKindTag({ kind: "fixed", startUs: 1, endUs: 2 }, ctx, t)).toBe(
      "dateTime.fixed",
    );
  });

  it("notes the last day of a period still in progress", () => {
    const q4 = { kind: "fixed" as const, startUs: ist(2026, 10, 1), endUs: ist(2027, 1, 1) };
    expect(timeRangeEndsNote(q4, ctx, t)).toBe('dateTime.endsWhen{"when":"Dec 31"}');
    const q3 = { kind: "fixed" as const, startUs: ist(2026, 7, 1), endUs: ist(2026, 10, 1) };
    expect(timeRangeEndsNote(q3, ctx, t)).toBeNull();
  });
});

describe("labels and copy text", () => {
  it("prints a named period with its dates on a dashboard", () => {
    const q3 = { kind: "fixed" as const, startUs: ist(2026, 7, 1), endUs: ist(2026, 10, 1) };
    expect(formatTimeRange(q3, ctx, "dashboard", t)).toBe("Q3 2026 · Jul 1 – Sep 30");
  });

  it("shows an in-progress period up to now", () => {
    const q4 = { kind: "fixed" as const, startUs: ist(2026, 10, 1), endUs: ist(2027, 1, 1) };
    expect(formatTimeRange(q4, ctx, "dashboard", t)).toContain("Q4 2026 · Oct 1");
    expect(formatTimeRange(q4, ctx, "dashboard", t)).toContain("Nov 12");
  });

  it("copies a named period with its name in front", () => {
    const q3 = { kind: "fixed" as const, startUs: ist(2026, 7, 1), endUs: ist(2026, 10, 1) };
    expect(timeRangeCopyText(q3, ctx, t)).toMatch(/^Q3 2026 \(2026-07-01 /);
  });
});

describe("older calendar offsets", () => {
  it("names an offset the UI no longer makes by how far back it is", () => {
    expect(timeRangeName({ kind: "calendar", unit: "quarter", offset: -3 }, ctx, t)).toBe(
      'dateTime.quartersAgo{"count":"3"}',
    );
  });

  it("copies text whose dates read back to the same period", async () => {
    const { parseTimeInput } = await import("./dateTimeRangeParse");
    const range = { kind: "calendar" as const, unit: "month" as const, offset: -3 };
    const text = timeRangeCopyText(range, ctx, t);
    const reading = parseTimeInput(text, { now: new Date(NOW_US / 1000), timeZone: ctx.zone });
    const resolved = resolveRange(range, ctx);
    expect(reading).toMatchObject({ type: "timestamp", startMicros: resolved.startUs });
    expect((reading as { endMicros: number }).endMicros).toBe(resolved.endUs);
  });
});
