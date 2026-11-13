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

import { describe, it, expect } from "vitest";
import {
  formatRangeCopyText,
  formatRangeDates,
  formatRangeDuration,
  formatRangeLabel,
  formatRangeStamps,
  formatZoneOffset,
} from "./timeRangeLabel";
import { parseTimeInput } from "./dateTimeRangeParse";
import { formatKnownPeriod } from "./timeRangeRail";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";

const IST = "Asia/Calcutta";
const NY = "America/New_York";
// Thu 2026-11-12 21:24:10 in IST.
const NOW_MS = Date.parse("2026-11-12T15:54:10Z");
const OPTS = { timezone: IST, nowMs: NOW_MS, locale: "en-US" };
const us = (iso: string) => Date.parse(iso) * 1000;
const ist = (civil: string) => us(`${civil}+05:30`);

describe("formatRangeDates [#5]", () => {
  it("shows seconds when a fixed bound has them", () => {
    const range = { startUs: ist("2026-11-12T21:08:49"), endUs: ist("2026-11-12T21:18:49") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 12, 21:08:49 – 21:18:49");
  });

  it("keeps minutes for a fixed range on whole minutes", () => {
    const range = { startUs: ist("2026-11-12T21:08:00"), endUs: ist("2026-11-12T21:18:00") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 12, 21:08 – 21:18");
  });

  it("shows milliseconds under a minute, so 45 s never reads 23:31 – 23:31", () => {
    const range = {
      startUs: ist("2026-11-12T23:31:04.250"),
      endUs: ist("2026-11-12T23:31:49.948"),
    };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 12, 23:31:04.250 – 23:31:49.948");
  });

  it("keeps ms out of longer ranges", () => {
    const range = {
      startUs: ist("2026-11-12T21:08:49.948"),
      endUs: ist("2026-11-12T21:18:49.948"),
    };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 12, 21:08:49 – 21:18:49");
  });

  it("shows seconds on a live range under five minutes only", () => {
    const short = {
      startUs: ist("2026-11-12T21:21:10"),
      endUs: ist("2026-11-12T21:24:10"),
      live: true,
    };
    const long = {
      startUs: ist("2026-11-12T21:09:10"),
      endUs: ist("2026-11-12T21:24:10"),
      live: true,
    };
    expect(formatRangeDates(short, OPTS)).toBe("Nov 12, 21:21:10 – 21:24:10");
    expect(formatRangeDates(long, OPTS)).toBe("Nov 12, 21:09 – 21:24");
  });

  it("shows whole days with an inclusive end from an exclusive one [#4]", () => {
    const range = { startUs: ist("2026-11-04T00:00:00"), endUs: ist("2026-11-07T00:00:00") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 4 – 6");
    const day = { startUs: ist("2026-11-04T00:00:00"), endUs: ist("2026-11-05T00:00:00") };
    expect(formatRangeDates(day, OPTS)).toBe("Nov 4");
  });

  it("still reads a legacy 23:59:59 end as a whole day", () => {
    const range = { startUs: ist("2026-11-04T00:00:00"), endUs: ist("2026-11-06T23:59:59") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 4 – 6");
  });

  it("names both days when a range crosses midnight", () => {
    const range = { startUs: ist("2026-11-11T22:00:00"), endUs: ist("2026-11-12T02:00:00") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 11, 22:00 – Nov 12, 02:00");
  });

  it("adds the year outside this year, across a year, and on dashboards", () => {
    const old = { startUs: ist("2025-11-04T00:00:00"), endUs: ist("2025-11-07T00:00:00") };
    const across = { startUs: ist("2025-12-30T00:00:00"), endUs: ist("2026-01-03T00:00:00") };
    const now = { startUs: ist("2026-11-04T00:00:00"), endUs: ist("2026-11-07T00:00:00") };
    expect(formatRangeDates(old, OPTS)).toBe("Nov 4 – 6, 2025");
    expect(formatRangeDates(across, OPTS)).toBe("Dec 30, 2025 – Jan 2, 2026");
    expect(formatRangeDates(now, { ...OPTS, surface: "dashboard" })).toBe("Nov 4 – 6, 2026");
  });

  it("adds the year to a calendar period of a month or longer", () => {
    const quarter = {
      startUs: ist("2026-10-01T00:00:00"),
      endUs: ist("2026-11-12T21:24:00"),
      live: true,
      calendar: true,
    };
    expect(formatRangeDates(quarter, OPTS)).toBe("Oct 1 – Nov 12, 2026");
    expect(
      formatRangeLabel({ ...quarter, name: "This quarter" }, { ...OPTS, surface: "dashboard" }),
    ).toBe("This quarter · Oct 1 – Nov 12, 2026");
  });

  it("names the year once, at the end, for a timed range across days", () => {
    const range = { startUs: ist("2026-11-11T21:24:00"), endUs: ist("2026-11-12T21:24:00") };
    expect(formatRangeDates(range, { ...OPTS, surface: "dashboard" })).toBe(
      "Nov 11, 21:24 – Nov 12, 2026, 21:24",
    );
    const across = { startUs: ist("2025-12-31T21:00:00"), endUs: ist("2026-01-01T03:00:00") };
    expect(formatRangeDates(across, OPTS)).toBe("Dec 31, 2025, 21:00 – Jan 1, 2026, 03:00");
  });

  it("draws the same instants in another zone", () => {
    const range = { startUs: ist("2026-11-12T21:08:49"), endUs: ist("2026-11-12T21:18:49") };
    expect(formatRangeDates(range, { ...OPTS, timezone: "UTC" })).toBe(
      "Nov 12, 15:38:49 – 15:48:49",
    );
  });

  it("uses one digit system per row [#63]", () => {
    const range = { startUs: ist("2026-11-12T21:08:49"), endUs: ist("2026-11-12T21:18:49") };
    const text = formatRangeDates(range, { ...OPTS, locale: "ar-SA" });
    expect(text).not.toMatch(/[0-9]/);
    expect(text).toMatch(/[٠-٩]/);
  });
});

describe("formatRangeLabel", () => {
  it("names a live range alone on compact toolbars and with dates on dashboards", () => {
    const range = {
      startUs: ist("2026-11-12T21:09:10"),
      endUs: ist("2026-11-12T21:24:10"),
      live: true,
      name: "Last 15 minutes",
    };
    expect(formatRangeLabel(range, OPTS)).toBe("Last 15 minutes");
    expect(formatRangeLabel(range, { ...OPTS, surface: "dashboard" })).toBe(
      "Last 15 minutes · Nov 12, 2026, 21:09 – 21:24",
    );
  });

  it("shows a fixed quarter, half, month or year as its dates only, never a name [P4]", () => {
    const q3 = { startUs: ist("2026-07-01T00:00:00"), endUs: ist("2026-10-01T00:00:00") };
    const h1 = { startUs: ist("2026-01-01T00:00:00"), endUs: ist("2026-07-01T00:00:00") };
    const sep = { startUs: ist("2026-09-01T00:00:00"), endUs: ist("2026-10-01T00:00:00") };
    const year = { startUs: ist("2025-01-01T00:00:00"), endUs: ist("2026-01-01T00:00:00") };
    expect(formatRangeLabel(q3, OPTS)).toBe("Jul 1 – Sep 30");
    expect(formatRangeLabel(h1, OPTS)).toBe("Jan 1 – Jun 30");
    expect(formatRangeLabel(sep, OPTS)).toBe("Sep 1 – 30");
    expect(formatRangeLabel(year, OPTS)).toBe("Jan 1 – Dec 31, 2025");
  });

  it("shows a fixed range from a period's start to a past instant as dates, never a name or now [C9]", () => {
    const now = ist("2026-11-12T21:24:00");
    const q4 = { startUs: ist("2026-10-01T00:00:00"), endUs: now };
    const year = { startUs: ist("2026-01-01T00:00:00"), endUs: now };
    expect(formatRangeLabel(q4, OPTS)).toBe("Oct 1, 00:00 – Nov 12, 21:24");
    expect(formatRangeLabel(year, OPTS)).toBe("Jan 1, 00:00 – Nov 12, 21:24");
  });

  it("names a live period by the name it was given [C9]", () => {
    const q4 = {
      startUs: ist("2026-10-01T00:00:00"),
      endUs: ist("2026-11-12T21:24:00"),
      name: "Q4 2026",
      live: true,
      calendar: true,
    };
    expect(formatRangeLabel(q4, OPTS)).toBe("Q4 2026");
  });

  it("keeps a typed period name before its dates, the year left to the name [D-NAME]", () => {
    const q3 = {
      startUs: ist("2026-07-01T00:00:00"),
      endUs: ist("2026-10-01T00:00:00"),
      name: "Q3 2026",
      period: true,
    };
    const y2025 = {
      startUs: ist("2025-01-01T00:00:00"),
      endUs: ist("2026-01-01T00:00:00"),
      name: "2025",
      period: true,
    };
    expect(formatRangeLabel(q3, OPTS)).toBe("Q3 2026 · Jul 1 – Sep 30");
    expect(formatRangeLabel(y2025, OPTS)).toBe("2025 · Jan 1 – Dec 31");
  });

  it("shows a running typed period cut to now from its first day, in minutes [D-NAME, V6]", () => {
    const h2 = {
      startUs: ist("2026-07-01T00:00:00"),
      endUs: ist("2026-11-12T21:24:10.500"),
      name: "H2 2026",
      period: true,
    };
    expect(formatRangeLabel(h2, OPTS)).toBe("H2 2026 · Jul 1 – Nov 12, 21:24");
    expect(formatRangeStamps(h2, OPTS)).toBe(
      "Jul 1, 2026 00:00:00.000 – Nov 12, 2026 21:24:10.500",
    );
  });

  it("names no period for a range that ends inside an earlier, smaller one [V6]", () => {
    const janFeb = { startUs: ist("2026-01-01T00:00:00"), endUs: ist("2026-02-10T12:00:00") };
    const october = { startUs: ist("2026-10-01T00:00:00"), endUs: ist("2026-10-20T12:00:00") };
    expect(formatRangeLabel(janFeb, OPTS)).toBe("Jan 1, 00:00 – Feb 10, 12:00");
    expect(formatRangeLabel(october, OPTS)).toBe("Oct 1, 00:00 – Oct 20, 12:00");
  });

  it("shows a midnight end as the last second when the label shows seconds [P4]", () => {
    const range = { startUs: ist("2026-11-04T10:00:15"), endUs: ist("2026-11-07T00:00:00") };
    expect(formatRangeDates(range, OPTS)).toBe("Nov 4, 10:00:15 – Nov 6, 23:59:59");
  });

  it("shows a bare fixed range as its dates", () => {
    const range = { startUs: ist("2026-11-12T21:08:49"), endUs: ist("2026-11-12T21:18:49") };
    expect(formatRangeLabel(range, OPTS)).toBe("Nov 12, 21:08:49 – 21:18:49");
  });

  it("puts a given name before the dates of a fixed range", () => {
    const range = {
      startUs: ist("2026-11-12T21:00:00"),
      endUs: ist("2026-11-12T22:00:00"),
      name: "Deploy",
    };
    expect(formatRangeLabel(range, OPTS)).toBe("Deploy · Nov 12, 21:00 – 22:00");
  });
});

describe("formatRangeDuration [#5]", () => {
  it.each([
    [140_000_000, "2m 20s"],
    [44_640_000_000, "12h 24m"],
    [86_400_000_000, "1d"],
    [1_000, "1 ms"],
    [974, "974 µs"],
    [45_500_000, "45s"],
    [0, "0 µs"],
  ])("%d µs → %s", (span, expected) => {
    expect(formatRangeDuration(0, span)).toBe(expected);
  });
});

describe("formatRangeStamps [#6]", () => {
  it("gives full stamps with the year and milliseconds", () => {
    const range = {
      startUs: ist("2026-11-12T21:08:49.948"),
      endUs: ist("2026-11-12T21:18:49.948"),
    };
    expect(formatRangeStamps(range, OPTS)).toBe("Nov 12, 2026 21:08:49.948 – 21:18:49.948");
  });

  it("shows a whole-day end as its last millisecond", () => {
    const range = { startUs: ist("2026-11-04T00:00:00"), endUs: ist("2026-11-07T00:00:00") };
    expect(formatRangeStamps(range, OPTS)).toBe(
      "Nov 4, 2026 00:00:00.000 – Nov 6, 2026 23:59:59.999",
    );
  });

  it("shows a timed range's exclusive midnight end as the day before, like its label [fresh#9]", () => {
    const range = { startUs: ist("2026-11-05T09:30:00"), endUs: ist("2026-11-08T00:00:00") };
    expect(formatRangeLabel(range, OPTS)).toBe("Nov 5, 09:30 – Nov 7, 23:59");
    expect(formatRangeStamps(range, OPTS)).toBe(
      "Nov 5, 2026 09:30:00.000 – Nov 7, 2026 23:59:59.999",
    );
  });

  it("keeps a sub-minute midnight end as stored, like its label", () => {
    const range = { startUs: ist("2026-11-07T23:59:30"), endUs: ist("2026-11-08T00:00:00") };
    expect(formatRangeStamps(range, OPTS)).toBe(
      "Nov 7, 2026 23:59:30.000 – Nov 8, 2026 00:00:00.000",
    );
  });
});

describe("formatZoneOffset", () => {
  it("names the offset at the instant", () => {
    expect(formatZoneOffset(IST, NOW_MS)).toBe("UTC+05:30");
    expect(formatZoneOffset("UTC", NOW_MS)).toBe("UTC");
    expect(formatZoneOffset(NY, Date.parse("2026-07-01T00:00:00Z"))).toBe("UTC-04:00");
  });
});

describe("formatRangeCopyText [#32]", () => {
  it("writes a fixed range as stamps and offset", () => {
    const range = {
      startUs: ist("2026-11-12T21:08:49.948"),
      endUs: ist("2026-11-12T21:18:49.948"),
    };
    expect(formatRangeCopyText(range, OPTS)).toBe(
      "2026-11-12 21:08:49.948 – 21:18:49.948 UTC+05:30",
    );
  });

  it("writes a live range by name with its minutes", () => {
    const range = {
      startUs: ist("2026-11-12T21:09:10"),
      endUs: ist("2026-11-12T21:24:10"),
      live: true,
      name: "Last 15 minutes",
    };
    expect(formatRangeCopyText(range, OPTS)).toBe(
      "Last 15 minutes (2026-11-12 21:09 – 21:24 UTC+05:30)",
    );
  });

  it.each([
    ["ms", ist("2026-11-12T21:08:49.948"), ist("2026-11-12T21:18:49.948"), IST],
    ["days", ist("2026-11-04T00:00:00"), ist("2026-11-07T00:00:00"), IST],
    ["midnight", ist("2026-11-11T22:00:00"), ist("2026-11-12T02:00:00"), IST],
    ["DST", us("2026-03-07T12:00:00Z"), us("2026-03-09T12:00:00Z"), NY],
  ])("reads its own %s copy back to the same instants", (_, startUs, endUs, timezone) => {
    const text = formatRangeCopyText({ startUs, endUs }, { ...OPTS, timezone });
    const reading = parseTimeInput(text, { now: new Date(NOW_MS), timeZone: timezone });
    expect(reading).toMatchObject({ type: "timestamp", startMicros: startUs, endMicros: endUs });
  });
});

describe("rolling labels read back as the same rolling period [#32]", () => {
  const t = i18n.global.t as unknown as TranslateFn;

  it.each([
    ["1w", "Last 1 week"],
    ["1M", "Last 1 month"],
    ["12M", "Last 1 year"],
    ["7d", "Last 7 days"],
  ])("%s is named %s, never a bare calendar word, and its copy pastes back", (period, name) => {
    const label = String(formatKnownPeriod(period, IST, t, "en-US", NOW_MS));
    expect(label).toBe(name);
    const range = { startUs: ist("2026-11-05T21:24:10"), endUs: ist("2026-11-12T21:24:10") };
    const text = formatRangeCopyText({ ...range, live: true, name: label }, OPTS);
    const opts = { now: new Date(NOW_MS), timeZone: IST };
    expect(parseTimeInput(text, opts)).toEqual({ type: "relative", period });
    expect(parseTimeInput(label, opts)).toEqual({ type: "relative", period });
  });
});

describe("copy text and labels read back [review pass 1]", () => {
  const read = (text: string, timezone: string) =>
    parseTimeInput(text, { now: new Date(NOW_MS), timeZone: timezone });

  it("reads a copy across the DST fall-back hour to the same instants [#1]", () => {
    const startUs = us("2026-11-01T05:30:00Z");
    const endUs = us("2026-11-01T06:10:00Z");
    const text = formatRangeCopyText({ startUs, endUs }, { ...OPTS, timezone: NY });
    expect(read(text, NY)).toMatchObject({
      type: "timestamp",
      startMicros: startUs,
      endMicros: endUs,
    });
  });

  it("reads a fixed quarter's label back as that quarter [#5]", () => {
    const range = { startUs: ist("2026-07-01T00:00:00"), endUs: ist("2026-10-01T00:00:00") };
    const label = formatRangeLabel(range, OPTS);
    expect(label).toBe("Jul 1 – Sep 30");
    expect(read(label, IST)).toMatchObject({ startDate: "2026/07/01", endDate: "2026/10/01" });
  });

  it("never copies an end before the last sub-millisecond event [#11]", () => {
    const startUs = ist("2026-11-12T21:08:49.948");
    const endUs = startUs + 600_000_000 + 400;
    const text = formatRangeCopyText({ startUs, endUs }, OPTS);
    const reading = read(text, IST) as { startMicros: number; endMicros: number };
    expect(reading.startMicros).toBeLessThanOrEqual(startUs);
    expect(reading.endMicros).toBeGreaterThanOrEqual(endUs);
  });
});

describe("labels far from now never throw [S1]", () => {
  it.each([
    ["year 10000", Date.UTC(10000, 0, 1) * 1000, 10000],
    ["year 9999 near its end", Date.UTC(9999, 11, 31, 23) * 1000, 10000],
    ["year 0", Date.UTC(0, 5, 1) * 1000 - 3155760000000000, -100],
  ])("formats a range in %s", (_name, startUs) => {
    const range = { startUs, endUs: startUs + 3_600_000_000 };
    expect(() => formatRangeLabel(range, OPTS)).not.toThrow();
    expect(() => formatRangeStamps(range, OPTS)).not.toThrow();
    expect(() => formatRangeCopyText(range, OPTS)).not.toThrow();
  });

  it("reads the year past 9999 in full", () => {
    const startUs = Date.UTC(10000, 0, 1) * 1000;
    const range = { startUs, endUs: startUs + 86_400_000_000 };
    expect(formatRangeLabel(range, { ...OPTS, timezone: "UTC" })).toBe("Jan 1, 10000");
  });

  it("keeps a year before year 1 apart from this one", () => {
    const start = new Date(0);
    start.setUTCFullYear(-5, 0, 1);
    const startUs = start.getTime() * 1000;
    const range = { startUs, endUs: startUs + 86_400_000_000 };
    expect(formatRangeLabel(range, { ...OPTS, timezone: "UTC" })).toMatch(/^Jan 1, /);
  });

  it("does not throw at the very edge of the Date range", () => {
    const range = { startUs: 8.64e18 - 3_600_000_000, endUs: 8.64e18 };
    expect(() => formatRangeLabel(range, OPTS)).not.toThrow();
  });
});
