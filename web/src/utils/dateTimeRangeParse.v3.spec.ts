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
  explainTimeInputFailure,
  parseTimeInput,
  readTimeText,
  type ParsedTimeInput,
  type TimeInputOptions,
} from "@/utils/dateTimeRangeParse";

// The spec's example clock: Thu Nov 12 2026 21:24:10 in Asia/Calcutta, week starts Monday.
const NOW = new Date("2026-11-12T15:54:10Z");
const OPTS: TimeInputOptions = {
  now: NOW,
  timeZone: "Asia/Calcutta",
  locale: "en-US",
  weekStart: 1,
};

const read = (text: string, extra: Partial<TimeInputOptions> = {}) =>
  readTimeText(text, { ...OPTS, ...extra });

const short = (reading: ParsedTimeInput): string => {
  if (reading.type === "relative") return reading.period;
  if (reading.type === "timestamp") return `${reading.startMicros}-${reading.endMicros}`;
  const name = reading.name ? ` ${reading.name}` : "";
  return `${reading.startDate} ${reading.startTime} - ${reading.endDate} ${reading.endTime}${name}`;
};

describe("grammar v3: family 2, durations", () => {
  it.each([
    ["2h", "2h"],
    ["90m", "90m"],
    ["1h30m", "90m"],
    ["last 2 hours", "2h"],
    ["1h ago", "1h"],
    ["5 minutes ago", "5m"],
    ["2 weeks ago", "2w"],
    ["3 months ago", "3M"],
    ["-30m", "30m"],
    ["- 1h30m", "90m"],
    ["15mo", "15M"],
    ["1y", "12M"],
  ])("%s reads as the rolling %s", (text, period) => {
    expect(parseTimeInput(text, OPTS)).toEqual({ type: "relative", period });
    expect(read(text).ambiguous).toBe(false);
  });

  it.each(["11y", "521w", "3651d", "2 quarters ago", "1h30m15s"])(
    "%s is not read: over ten years, no quarter unit, or more than two parts",
    (text) => {
      expect(parseTimeInput(text, OPTS)).toBeNull();
    },
  );
});

describe("grammar v3: family 3, calendar words", () => {
  it.each([
    ["today", "calendar:day:0"],
    ["yesterday", "calendar:day:-1"],
    ["this week", "calendar:week:0"],
    ["previous month", "calendar:month:-1"],
    ["last quarter", "calendar:quarter:-1"],
    ["last year", "calendar:year:-1"],
    ["wtd", "calendar:week:0"],
    ["mtd", "calendar:month:0"],
    ["qtd", "calendar:quarter:0"],
    ["ytd", "calendar:year:0"],
  ])("%s is the token %s", (text, period) => {
    expect(parseTimeInput(text, OPTS)).toEqual({ type: "relative", period });
  });
});

describe("grammar v3: family 4, named periods", () => {
  it("Q4 while it runs is fixed with its real end, the previous Q4 second, cursor on the first", () => {
    const result = read("Q4");
    expect(result.ambiguous).toBe(false);
    expect(result.readings.map(short)).toEqual([
      "2026/10/01 00:00:00 - 2027/01/01 00:00:00 Q4 2026",
      "2025/10/01 00:00:00 - 2026/01/01 00:00:00 Q4 2025",
    ]);
  });

  it("2026 is this year in progress and 2025 one year, never minutes", () => {
    expect(read("2026").readings.map(short)).toEqual([
      "2026/01/01 00:00:00 - 2027/01/01 00:00:00 2026",
    ]);
    expect(read("2025").readings.map(short)).toEqual([
      "2025/01/01 00:00:00 - 2026/01/01 00:00:00 2025",
    ]);
  });

  it("a month name is the latest that has started, then the one before", () => {
    expect(read("October").readings.map(short)).toEqual([
      "2026/10/01 00:00:00 - 2026/11/01 00:00:00 Oct 2026",
      "2025/10/01 00:00:00 - 2025/11/01 00:00:00 Oct 2025",
    ]);
    expect(read("December").readings.map(short)[0]).toBe(
      "2025/12/01 00:00:00 - 2026/01/01 00:00:00 Dec 2025",
    );
    expect(read("Sep 2025").readings.map(short)).toEqual([
      "2025/09/01 00:00:00 - 2025/10/01 00:00:00 Sep 2025",
    ]);
  });

  it("a yearless month reads upcoming only where the future is allowed", () => {
    const ceilingMs = Date.UTC(2027, 11, 31);
    expect(read("December", { ceilingMs }).readings.map(short)[0]).toBe(
      "2026/12/01 00:00:00 - 2027/01/01 00:00:00 Dec 2026",
    );
  });

  it("FY is not read until the org sets a fiscal start, and says so", () => {
    expect(parseTimeInput("FY26", OPTS)).toBeNull();
    expect(read("FY26")).toEqual({ readings: [], ambiguous: false, answer: "fiscalUnset" });
    expect(read("this fiscal year").answer).toBe("fiscalUnset");
  });

  it("FY is named by the year it ends, from the org's start month", () => {
    const fy = { fiscalStartMonth: 4 };
    expect(read("FY26", fy).readings.map(short)).toEqual([
      "2025/04/01 00:00:00 - 2026/04/01 00:00:00 FY26",
    ]);
    expect(read("FY2027", fy).readings.map(short)).toEqual([
      "2026/04/01 00:00:00 - 2027/04/01 00:00:00 FY27",
    ]);
    expect(read("this fiscal year", fy).readings.map(short)).toEqual([
      "2026/04/01 00:00:00 - 2027/04/01 00:00:00 FY27",
    ]);
    expect(read("last fiscal year", fy).readings.map(short)).toEqual([
      "2025/04/01 00:00:00 - 2026/04/01 00:00:00 FY26",
    ]);
    expect(read("FY26", { fiscalStartMonth: 1 }).readings.map(short)).toEqual([
      "2026/01/01 00:00:00 - 2027/01/01 00:00:00 FY26",
    ]);
  });
});

describe("grammar v3: family 5, absolute", () => {
  it("since a point ends at the end of today (O1)", () => {
    expect(short(parseTimeInput("since 9am", OPTS) as ParsedTimeInput)).toBe(
      "2026/11/12 09:00:00 - 2026/11/13 00:00:00",
    );
    expect(short(parseTimeInput("since Nov 4", OPTS) as ParsedTimeInput)).toBe(
      "2026/11/04 00:00:00 - 2026/11/13 00:00:00",
    );
  });

  it("since a zoned point ends at the end of that zone's today", () => {
    const reading = parseTimeInput("since 9am UTC", OPTS);
    expect(reading).toMatchObject({
      type: "timestamp",
      startMicros: Date.UTC(2026, 10, 12, 9) * 1000,
      endMicros: Date.UTC(2026, 10, 13) * 1000,
    });
  });

  it.each([
    ["Nov 4 – 6", "2026/11/04 00:00:00 - 2026/11/07 00:00:00"],
    ["Dec 20 2025 - Jan 5 2026", "2025/12/20 00:00:00 - 2026/01/06 00:00:00"],
    ["21:13:49 ± 30s", "2026/11/12 21:13:19 - 2026/11/12 21:14:19"],
    ["yesterday 9-17", "2026/11/11 09:00:00 - 2026/11/11 17:00:00"],
    ["Nov 12 9-17", "2026/11/12 09:00:00 - 2026/11/12 17:00:00"],
  ])("%s reads as %s", (text, expected) => {
    expect(short(parseTimeInput(text, OPTS) as ParsedTimeInput)).toBe(expected);
  });
});

describe("grammar v3: family 6, snaps", () => {
  it.each([
    ["now/d", "calendar:day:0"],
    ["now-1d/d", "calendar:day:-1"],
    ["now/w", "calendar:week:0"],
  ])("%s is the token %s", (text, period) => {
    expect(parseTimeInput(text, OPTS)).toEqual({ type: "relative", period });
  });

  it("a snap two units back is fixed, as the UI makes tokens of offset 0 and -1 only", () => {
    expect(short(parseTimeInput("now-2d/d", OPTS) as ParsedTimeInput)).toBe(
      "2026/11/10 00:00:00 - 2026/11/11 00:00:00",
    );
  });

  it("one offset before the snap and one after", () => {
    expect(short(parseTimeInput("-1d@d+9h", OPTS) as ParsedTimeInput)).toBe(
      "2026/11/11 09:00:00 - 2026/11/12 21:24:10",
    );
    expect(parseTimeInput("now-1d-2h/d", OPTS)).toBeNull();
    expect(parseTimeInput("now/d+1h+2h", OPTS)).toBeNull();
  });
});

describe("grammar v3: ambiguity rule", () => {
  it("15M lists months then minutes with no cursor", () => {
    expect(read("15M")).toMatchObject({ ambiguous: true });
    expect(read("15M").readings.map(short)).toEqual(["15M", "15m"]);
  });

  it("a bare number lists minutes, hours and days", () => {
    expect(read("9")).toEqual({
      ambiguous: true,
      readings: [
        { type: "relative", period: "9m" },
        { type: "relative", period: "9h" },
        { type: "relative", period: "9d" },
      ],
    });
  });

  it("a numeric date that reads both ways lists the locale order first", () => {
    const result = read("4/11");
    expect(result.ambiguous).toBe(true);
    expect(result.readings.map(short)).toEqual([
      "2026/04/11 00:00:00 - 2026/04/12 00:00:00",
      "2026/11/04 00:00:00 - 2026/11/05 00:00:00",
    ]);
  });

  it("a bare H-H lists today then yesterday", () => {
    const result = read("9-17");
    expect(result.ambiguous).toBe(true);
    expect(result.readings.map(short)).toEqual([
      "2026/11/12 09:00:00 - 2026/11/12 17:00:00",
      "2026/11/11 09:00:00 - 2026/11/11 17:00:00",
    ]);
  });

  it("a bare H-H whose today is still ahead keeps that row, marked future", () => {
    const morning = new Date("2026-11-12T02:00:00Z");
    const result = read("9-17", { now: morning });
    expect(result.readings[0]).toMatchObject({ startDate: "2026/11/12", future: true });
    expect(result.readings[1]).toMatchObject({ startDate: "2026/11/11" });
  });

  it("a zone abbreviation with two zones asks", () => {
    expect(read("10:00 IST").ambiguous).toBe(true);
    expect(read("10:00 EST").ambiguous).toBe(false);
  });

  it("a DST repeated hour asks", () => {
    const fallBack = new Date("2026-11-01T12:00:00Z");
    const result = read("Nov 1 2026 01:30", { now: fallBack, timeZone: "America/New_York" });
    expect(result.ambiguous).toBe(true);
    expect(result.readings).toHaveLength(2);
  });

  it("a 12-hour clock lists the other half after the most recent, with the cursor", () => {
    const result = read("since 9");
    expect(result.ambiguous).toBe(false);
    expect(result.readings).toHaveLength(2);
  });

  it("text with one reading does not ask", () => {
    expect(read("2h")).toEqual({
      readings: [{ type: "relative", period: "2h" }],
      ambiguous: false,
    });
  });
});

describe("grammar v3: answers that are not ranges", () => {
  it.each(["tomorrow", "next week", "next month", "next quarter", "next year"])(
    "%s is in the future",
    (text) => {
      expect(read(text)).toEqual({ readings: [], ambiguous: false, answer: "future" });
      expect(explainTimeInputFailure(text, OPTS)).toBe("future");
    },
  );

  it("a reversed range says so", () => {
    expect(read("Nov 6 - Nov 4 2026").answer).toBe("reversed");
  });

  it("vs is answered with both periods as rows", () => {
    expect(read("this quarter vs last quarter")).toEqual({
      readings: [
        { type: "relative", period: "calendar:quarter:0" },
        { type: "relative", period: "calendar:quarter:-1" },
      ],
      ambiguous: false,
      answer: "compare",
    });
    expect(read("compare Q3 with Q2").readings.map(short)).toEqual([
      "2026/07/01 00:00:00 - 2026/10/01 00:00:00 Q3 2026",
      "2026/04/01 00:00:00 - 2026/07/01 00:00:00 Q2 2026",
    ]);
    expect(read("compare")).toEqual({ readings: [], ambiguous: false, answer: "compare" });
  });

  it("unread text has no readings and no answer", () => {
    expect(read("banana")).toEqual({ readings: [], ambiguous: false });
  });
});

describe("grammar v3: cut list", () => {
  it.each([
    "mon",
    "last friday",
    "friday 9am",
    "between 9am and 10am",
    "now",
    "live",
    "@w1",
    "now/w1",
  ])("%s is not read", (text) => {
    expect(parseTimeInput(text, OPTS)).toBeNull();
    expect(read(text).readings).toEqual([]);
  });

  it("a year's minutes need the unit", () => {
    expect(parseTimeInput("2025m", OPTS)).toEqual({ type: "relative", period: "2025m" });
  });

  it("digits in other scripts are read as ASCII", () => {
    expect(parseTimeInput("٢h", OPTS)).toEqual({ type: "relative", period: "2h" });
  });
});
