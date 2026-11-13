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
  capRollingPeriod,
  explainTimeInputFailure,
  parseTimeInput,
  resolveZonedCivil,
  suggestTimeInput,
  type ParsedTimeInput,
  type TimeInputOptions,
} from "./dateTimeRangeParse";

// Wed 2026-11-11 12:41:53; the test process runs in UTC, so this is also the wall clock.
const NOW = new Date(Date.UTC(2026, 10, 11, 12, 41, 53));
const US: TimeInputOptions = { now: NOW, locale: "en-US", timeZone: "UTC", weekStart: 1 };
const NY = "America/New_York";

function show(result: ParsedTimeInput | null): string {
  if (!result) return "null";
  if (result.type === "relative") return result.period;
  if (result.type === "timestamp") {
    const iso = (us: number) => new Date(us / 1000).toISOString();
    return `T ${iso(result.startMicros)}..${iso(result.endMicros)}`;
  }
  return `A ${result.startDate} ${result.startTime}..${result.endDate} ${result.endTime}`;
}

const read = (text: string, opts: TimeInputOptions = US) => show(parseTimeInput(text, opts));
const suggest = (text: string, opts: TimeInputOptions = US) =>
  suggestTimeInput(text, opts).map(show);

describe("exclusive end bound [#4]", () => {
  it.each([
    ["Nov 4 - 6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["2026/11/06", "A 2026/11/06 00:00:00..2026/11/07 00:00:00"],
    ["October", "A 2026/10/01 00:00:00..2026/11/01 00:00:00"],
    ["yesterday afternoon", "A 2026/11/10 12:00:00..2026/11/10 17:00:00"],
  ])("ends %s at the next boundary", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("never emits a 23:59:59 end", () => {
    for (const text of ["Nov 4", "last friday", "2026-11-04 - 2026-11-06", "yesterday"]) {
      expect(read(text)).not.toContain("23:59:59");
    }
  });
});

describe("parser edges [#13]", () => {
  it("reads only whole epoch units", () => {
    expect(read("17624376000")).toBe("null");
    expect(read("176243760000")).toBe("null");
    expect(read("17624376000000")).toBe("null");
    expect(parseTimeInput("1762437600000", US)).toMatchObject({ epochUnit: "ms" });
    expect(parseTimeInput("1762437600000000", US)).toMatchObject({ epochUnit: "µs" });
    expect(parseTimeInput("1762437600000000000", US)).toMatchObject({ epochUnit: "ns" });
  });

  it("reads a two-digit year as the latest one not in the future", () => {
    expect(read("4/11/26")).toBe("A 2026/04/11 00:00:00..2026/04/12 00:00:00");
    expect(read("4/11/99")).toBe("A 1999/04/11 00:00:00..1999/04/12 00:00:00");
    expect(read("4/11/27")).toBe("A 1927/04/11 00:00:00..1927/04/12 00:00:00");
  });

  it("clamps a month shift to the month's last day", () => {
    const opts = { ...US, now: new Date(Date.UTC(2026, 2, 31, 12)) };
    expect(read("since 1 month ago", opts)).toBe("A 2026/02/28 12:00:00..2026/03/31 12:00:00");
    expect(read("now-1M/d", opts)).toBe("calendar:day:-31");
  });

  it("calls a same-month end before its start reversed instead of reading next year", () => {
    expect(read("Nov 6 - Nov 4")).toBe("null");
    expect(explainTimeInputFailure("Nov 6 - Nov 4", US)).toBe("reversed");
    expect(read("Dec 28 - Jan 3")).toBe("A 2025/12/28 00:00:00..2026/01/04 00:00:00");
  });

  it("caps rolling counts at about ten years and says so", () => {
    expect(capRollingPeriod("9999d")).toEqual({ period: "3650d", cut: true });
    expect(capRollingPeriod("7d")).toEqual({ period: "7d", cut: false });
    expect(capRollingPeriod("600M")).toEqual({ period: "120M", cut: true });
    expect(capRollingPeriod("calendar:day:0")).toBeNull();
  });
});

describe("failure reasons [#44]", () => {
  it.each([
    ["tomorrow", "future"],
    ["Q4 2027", "future"],
    ["FY27", "future"],
    ["Nov 6 - Nov 4", "reversed"],
    ["banana", "unreadable"],
  ])("%s → %s", (text, reason) => {
    expect(explainTimeInputFailure(text, US)).toBe(reason);
  });

  it("does not read tomorrow, which is wholly in the future", () => {
    expect(read("tomorrow")).toBe("null");
  });
});

describe("digits in other scripts [#63]", () => {
  it.each([
    ["٢h", "2h"],
    ["۱۵m", "15m"],
    ["१५ मिनट", "null"],
    ["１５m", "15m"],
  ])("reads %s as %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });
});

describe("business hours [#57]", () => {
  it.each(["9 to 5", "9-5", "between 9 and 5"])("reads %s as 09:00 – 17:00", (text) => {
    expect(read(text)).toBe("A 2026/11/11 09:00:00..2026/11/11 17:00:00");
  });

  it("keeps a larger second hour as typed", () => {
    expect(read("9 to 11")).toBe("A 2026/11/11 09:00:00..2026/11/11 11:00:00");
  });
});

describe("zone after a day and clock range [#34]", () => {
  it("reads yesterday 9-17 UTC in UTC whatever the picker zone", () => {
    const reading = parseTimeInput("yesterday 9-17 UTC", { ...US, timeZone: "Asia/Calcutta" });
    expect(show(reading)).toBe("T 2026-11-10T09:00:00.000Z..2026-11-10T17:00:00.000Z");
    expect(reading).toMatchObject({ sourceZone: "UTC" });
  });

  it("reads an IANA zone and an offset after the range", () => {
    expect(read("yesterday 9-17 Asia/Kolkata")).toBe(
      "T 2026-11-10T03:30:00.000Z..2026-11-10T11:30:00.000Z",
    );
    expect(read("yesterday 9-17 UTC+2")).toBe(
      "T 2026-11-10T07:00:00.000Z..2026-11-10T15:00:00.000Z",
    );
  });
});

describe("zone abbreviations [#11]", () => {
  it("keeps the preferred reading first even when it is in the future", () => {
    const readings = suggestTimeInput("Nov 11 10:00 PST", US);
    expect(readings.map(show)).toEqual([
      "T 2026-11-11T17:55:00.000Z..2026-11-11T18:05:00.000Z",
      "T 2026-11-11T01:55:00.000Z..2026-11-11T02:05:00.000Z",
    ]);
    expect(readings[0]).toMatchObject({ future: true, sourceZone: "UTC-08:00" });
    expect(readings[1]).not.toHaveProperty("future");
  });

  it("does not apply a future reading but explains it", () => {
    expect(read("Nov 11 10:00 PST")).toBe("null");
    expect(explainTimeInputFailure("Nov 11 10:00 PST", US)).toBe("future");
  });
});

describe("ambiguous ago [#14]", () => {
  it("offers the calendar week and the moment two weeks back", () => {
    expect(suggest("2w ago")).toEqual([
      "calendar:week:-2",
      "A 2026/10/28 12:36:53..2026/10/28 12:46:53",
    ]);
    expect(suggest("3 months ago")[0]).toBe("calendar:month:-3");
    expect(suggest("3 months ago")).toHaveLength(2);
  });
});

describe("business periods [#35]", () => {
  it.each([
    ["Q3", "A 2026/07/01 00:00:00..2026/10/01 00:00:00", "Q3 2026"],
    ["q4", "A 2026/10/01 00:00:00..2027/01/01 00:00:00", "Q4 2026"],
    ["Q3 2025", "A 2025/07/01 00:00:00..2025/10/01 00:00:00", "Q3 2025"],
    ["2025 Q1", "A 2025/01/01 00:00:00..2025/04/01 00:00:00", "Q1 2025"],
    ["H1", "A 2026/01/01 00:00:00..2026/07/01 00:00:00", "H1 2026"],
    ["H2 2025", "A 2025/07/01 00:00:00..2026/01/01 00:00:00", "H2 2025"],
    ["2025", "A 2025/01/01 00:00:00..2026/01/01 00:00:00", "2025"],
    ["FY26", "A 2026/01/01 00:00:00..2027/01/01 00:00:00", "FY26"],
    ["fy 2025", "A 2025/01/01 00:00:00..2026/01/01 00:00:00", "FY2025"],
  ])("reads %s", (text, expected, name) => {
    const reading = parseTimeInput(text, US);
    expect(show(reading)).toBe(expected);
    expect(reading).toMatchObject({ name });
  });

  it("marks a fiscal year with its start month", () => {
    expect(parseTimeInput("FY26", US)).toMatchObject({ fiscalStartMonth: 1 });
  });

  it("does not read a year before 1999 or after this one", () => {
    expect(read("1998")).toBe("null");
    expect(read("2027")).toBe("null");
  });

  it("offers the period before a yearless one", () => {
    expect(suggestTimeInput("Q3", US).map((r) => (r.type === "absolute" ? r.name : ""))).toEqual([
      "Q3 2026",
      "Q3 2025",
    ]);
    expect(suggest("Q3 2025")).toEqual([]);
  });

  it("lists a bare year before the counts", () => {
    expect(suggest("2025")).toEqual([
      "A 2025/01/01 00:00:00..2026/01/01 00:00:00",
      "2025m",
      "2025h",
      "2025d",
      "2025w",
      "2025M",
    ]);
    expect(suggest("15")).toEqual(["15m", "15h", "15d", "15w", "15M"]);
  });
});

describe("copied text reads back [#32]", () => {
  it("reads the fixed form with its offset", () => {
    const reading = parseTimeInput("2026-11-11 10:08:49.948 – 10:18:49.948 UTC+05:30", US);
    expect(show(reading)).toBe("T 2026-11-11T04:38:49.948Z..2026-11-11T04:48:49.948Z");
    expect(reading).toMatchObject({ sourceZone: "UTC+05:30" });
  });

  it("reads the live form by its name", () => {
    expect(read("Last 15 minutes (2026-11-11 12:26 – 12:41 UTC+05:30)")).toBe("15m");
    expect(read("This quarter (2026-10-01 00:00 – 2026-11-11 12:41 UTC)")).toBe(
      "calendar:quarter:0",
    );
    expect(read("Previous quarter (2026-07-01 00:00 – 2026-10-01 00:00 UTC)")).toBe(
      "calendar:quarter:-1",
    );
  });

  it("reads a named pin's copy by its dates", () => {
    expect(read("Deploy window (2026-11-11 10:00 – 11:00 UTC)")).toBe(
      "T 2026-11-11T10:00:00.000Z..2026-11-11T11:00:00.000Z",
    );
  });

  it("still reads the old JSON payload", () => {
    expect(read('{"start_date":1762437600000000,"end_date":1762441200000000}')).toBe(
      "T 2025-11-06T14:00:00.000Z..2025-11-06T15:00:00.000Z",
    );
  });
});

describe("week start [#29]", () => {
  it("snaps a week to the configured first day", () => {
    expect(read("now/w+1d", { ...US, weekStart: 1 })).toBe(
      "A 2026/11/10 00:00:00..2026/11/11 12:41:53",
    );
    expect(read("now/w+1d", { ...US, weekStart: 0 })).toBe(
      "A 2026/11/09 00:00:00..2026/11/11 12:41:53",
    );
  });
});

describe("DST in the picker zone [#10]", () => {
  it("moves a skipped time forward by the gap", () => {
    expect(resolveZonedCivil("2026/03/08", "02:30:00", NY)).toEqual({
      kind: "gap",
      micros: Date.parse("2026-03-08T07:30:00Z") * 1000,
      usedTime: "03:30:00",
    });
  });

  it("gives both instants of a repeated time, the earlier first", () => {
    expect(resolveZonedCivil("2026/11/01", "01:30:00", NY)).toEqual({
      kind: "fold",
      micros: Date.parse("2026-11-01T05:30:00Z") * 1000,
      laterMicros: Date.parse("2026-11-01T06:30:00Z") * 1000,
    });
  });

  it("resolves an ordinary time to its one instant, keeping milliseconds", () => {
    expect(resolveZonedCivil("2026/11/11", "10:00:00.250", NY)).toEqual({
      kind: "exact",
      micros: Date.parse("2026-11-11T15:00:00.250Z") * 1000,
    });
  });

  it("asks which instant a typed repeated hour means", () => {
    const readings = suggestTimeInput("2026-11-01 01:30", { ...US, timeZone: NY });
    expect(readings.map(show)).toEqual([
      "T 2026-11-01T05:25:00.000Z..2026-11-01T05:35:00.000Z",
      "T 2026-11-01T06:25:00.000Z..2026-11-01T06:35:00.000Z",
    ]);
    expect(readings.map((r) => (r.type === "timestamp" ? r.fold : ""))).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("asks for a range whose start is in a repeated hour", () => {
    const readings = suggestTimeInput("2026-11-01 01:30 to 03:00", { ...US, timeZone: NY });
    expect(readings.map(show)).toEqual([
      "T 2026-11-01T05:30:00.000Z..2026-11-01T08:00:00.000Z",
      "T 2026-11-01T06:30:00.000Z..2026-11-01T08:00:00.000Z",
    ]);
  });
});

describe("code review pass 1 [parser]", () => {
  const micros = (iso: string, extra = 0) => Date.parse(iso) * 1000 + extra;

  it.each([
    [
      "2026-11-10T10:00:00.123456Z to 2026-11-10T11:00:00.123456Z",
      micros("2026-11-10T10:00:00.123Z", 456),
      micros("2026-11-10T11:00:00.123Z", 456),
    ],
    [
      "2026-11-10T10:00:00.123456789Z - 2026-11-10T11:00:00.123456789Z",
      micros("2026-11-10T10:00:00.123Z", 456),
      micros("2026-11-10T11:00:00.123Z", 456),
    ],
  ])("keeps every stamp's sub-millisecond fraction in %s [#2 #11]", (text, start, end) => {
    expect(parseTimeInput(text, US)).toMatchObject({
      type: "timestamp",
      startMicros: start,
      endMicros: end,
    });
  });

  it("reads comma milliseconds on both stamps [#2]", () => {
    expect(read("2026-11-10 10:00:00,123 to 2026-11-10 11:00:00,456")).toBe(
      "A 2026/11/10 10:00:00.123..2026/11/10 11:00:00.456",
    );
  });

  it("keeps the microseconds of one pasted stamp [#11]", () => {
    expect(parseTimeInput("2026-11-10T10:00:00.123456Z", US)).toMatchObject({
      centreMicros: micros("2026-11-10T10:00:00.123Z", 456),
    });
  });

  it.each(["10am PST", "3pm America/New_York", "yesterday 9am EST", "yesterday 9am-5pm EST"])(
    "reads a zone after a meridiem clock in %s [#3]",
    (text) => {
      expect(parseTimeInput(text, US)).not.toBeNull();
    },
  );

  it("resolves a named-zone day in that zone [#4]", () => {
    const opts = { ...US, now: new Date("2026-11-13T20:00:00Z"), timeZone: "Asia/Kolkata" };
    expect(read("today 10:00 UTC", opts)).toBe(
      "T 2026-11-13T09:55:00.000Z..2026-11-13T10:05:00.000Z",
    );
    expect(read("yesterday 9-17 UTC", opts)).toBe(
      "T 2026-11-12T09:00:00.000Z..2026-11-12T17:00:00.000Z",
    );
  });

  it.each(["2026-02-01T00:00:00Z to 2026-01-01T00:00:00Z", "1793599800 to 1793511000"])(
    "refuses the reversed stamped range %s [#7]",
    (text) => {
      expect(parseTimeInput(text, US)).toBeNull();
      expect(explainTimeInputFailure(text, US)).toBe("reversed");
    },
  );

  it("compares a dated end in another offset by instant [#1]", () => {
    expect(read("2026-11-01 01:30 UTC-04:00 to 2026-11-01 01:10 UTC-05:00")).toBe(
      "T 2026-11-01T05:30:00.000Z..2026-11-01T06:10:00.000Z",
    );
  });

  it("reads FY99 by the two-digit year rule [#8]", () => {
    expect(read("FY99")).toBe("A 1999/01/01 00:00:00..2000/01/01 00:00:00");
  });

  it("reads a yearless Feb 29 as the latest leap day [#9]", () => {
    expect(read("Feb 29")).toBe("A 2024/02/29 00:00:00..2024/03/01 00:00:00");
  });

  it("reads a `N quarters ago` calendar period [#10]", () => {
    expect(read("3 quarters ago")).toBe("calendar:quarter:-3");
  });
});

describe("parser review pass 2", () => {
  it.each([
    [
      "2026-11-10 10:00:00.123456 - 2026-11-10 10:00:00.123789",
      "A 2026/11/10 10:00:00.123..2026/11/10 10:00:00.124",
    ],
    [
      "2026-11-10 10:00:00.123456 - 2026-11-10 10:00:00.124001",
      "A 2026/11/10 10:00:00.123..2026/11/10 10:00:00.125",
    ],
    [
      "2026-11-10 10:00:00.123456 - 10:00:00.123789",
      "A 2026/11/10 10:00:00.123..2026/11/10 10:00:00.124",
    ],
    [
      "2026-11-10 23:59:59.999500 - 2026-11-10 23:59:59.999900",
      "A 2026/11/10 23:59:59.999..2026/11/11 00:00:00",
    ],
  ])("keeps microseconds of a zoneless range %s [#1]", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("keeps microseconds of a time-only end after an instant [#1]", () => {
    const reading = parseTimeInput("2026-11-10T10:00:00.123456Z - 10:00:00.123789", US);
    expect(reading).toMatchObject({ endMicros: 1794304800123789 });
  });

  it.each(["2026-11-09 to 2026-11-07", "2026-11-09 10:00 to 2026-11-08"])(
    "refuses the date-only end before its start %s [#2]",
    (text) => {
      expect(parseTimeInput(text, US)).toBeNull();
      expect(explainTimeInputFailure(text, US)).toBe("reversed");
    },
  );

  it("still reads a date-only end on the start's own day [#2]", () => {
    expect(read("2026-11-09 10:00 to 2026-11-09")).toBe(
      "A 2026/11/09 10:00:00..2026/11/10 00:00:00",
    );
  });

  it("keeps sub-millisecond digits before a spaced offset [#4]", () => {
    const reading = parseTimeInput("2026-11-10 10:00:00,123456789 +05:30", US);
    expect(reading).toMatchObject({ centreMicros: 1794285000123456 });
  });

  it.each(["FY27", "FY50", "Q4 2027"])("does not apply the wholly future %s [#5]", (text) => {
    expect(parseTimeInput(text, US)).toBeNull();
    expect(explainTimeInputFailure(text, US)).toBe("future");
  });

  it("still reads the current fiscal year [#5]", () => {
    expect(read("FY26")).toBe("A 2026/01/01 00:00:00..2027/01/01 00:00:00");
  });
});
