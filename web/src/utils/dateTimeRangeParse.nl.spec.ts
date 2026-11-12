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
  parseTimeInput,
  suggestTimeInput,
  type ParsedTimeInput,
  type TimeInputOptions,
} from "./dateTimeRangeParse";

// Wed 2026-11-11 12:41:53 on the picker's wall clock; `now`'s local fields are the wall clock.
const NOW = new Date(2026, 10, 11, 12, 41, 53);
const US: TimeInputOptions = { now: NOW, locale: "en-US" };
const GB: TimeInputOptions = { now: NOW, locale: "en-GB" };

// Renders a reading the way the corpus does, so expectations stay zone-independent.
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
const NOW_CIVIL = "2026/11/11 12:41:53";

describe("parseTimeInput relative forms", () => {
  it.each([
    ["1 year", "12M"],
    ["1y", "12M"],
    ["past year", "12M"],
    ["previous 2 hours", "2h"],
    ["the last 15 minutes", "15m"],
    ["last fortnight", "2w"],
    ["15 mins", "15m"],
    ["2hrs", "2h"],
    ["1 wk", "1w"],
    ["2 wks", "2w"],
    ["3mo", "3M"],
    ["15 minuets", "15m"],
    ["15 mintues", "15m"],
    ["2 horus", "2h"],
    ["3 hous", "3h"],
    ["1.5h", "90m"],
    ["1h30m", "90m"],
    ["1h 30m", "90m"],
    ["1 h 30 m", "90m"],
    ["1d12h", "36h"],
    ["1.25m", "75s"],
    ["half an hour", "30m"],
    ["an hour", "1h"],
    ["a day", "1d"],
    ["LAST 15 MINUTES", "15m"],
    ["now-1h", "1h"],
    ["now - 15m", "15m"],
    ["now-1h to now", "1h"],
    ["an hour ago to now", "1h"],
    ["from 2 hours ago to now", "2h"],
    ["last 24h", "24h"],
  ])("reads %s as rolling %s", (text, period) => {
    expect(read(text)).toBe(period);
  });

  it("keeps an uppercase M as months, as the spec's unit aliases require", () => {
    expect(read("15M")).toBe("15M");
    expect(read("15m")).toBe("15m");
  });

  it.each(["hour", "0.1s", "0h", "15 parsecs", "1h30"])("rejects %s", (text) => {
    expect(read(text)).toBe("null");
  });
});

describe("parseTimeInput calendar words", () => {
  it.each([
    ["this year", "calendar:year:0"],
    ["last year", "calendar:year:-1"],
    ["previous week", "calendar:week:-1"],
    ["previous month", "calendar:month:-1"],
    ["week to date", "calendar:week:0"],
    ["month to date", "calendar:month:0"],
    ["mtd", "calendar:month:0"],
    ["QTD", "calendar:quarter:0"],
    ["ytd", "calendar:year:0"],
    ["2 weeks ago", "calendar:week:-2"],
    ["a month ago", "calendar:month:-1"],
    ["1 year ago", "calendar:year:-1"],
    ["yesterdy", "calendar:day:-1"],
  ])("reads %s as %s", (text, token) => {
    expect(read(text)).toBe(token);
  });

  it("reads the day before yesterday as that whole day", () => {
    expect(read("day before yesterday")).toBe("A 2026/11/09 00:00:00..2026/11/10 00:00:00");
  });
});

describe("parseTimeInput ago and now arithmetic", () => {
  it("reads minutes or hours ago as that instant ±5 minutes", () => {
    expect(read("5 minutes ago")).toBe("A 2026/11/11 12:31:53..2026/11/11 12:41:53");
    expect(read("5m ago")).toBe("A 2026/11/11 12:31:53..2026/11/11 12:41:53");
    expect(read("an hour ago")).toBe("A 2026/11/11 11:36:53..2026/11/11 11:46:53");
  });

  it("reads days ago as that whole calendar day", () => {
    expect(read("2 days ago")).toBe("A 2026/11/09 00:00:00..2026/11/10 00:00:00");
  });

  it("fixes now-relative ranges at the moment of reading", () => {
    expect(read("now-2h to now-1h")).toBe("A 2026/11/11 10:41:53..2026/11/11 11:41:53");
    expect(read("from 2 hours ago to 1 hour ago")).toBe(
      "A 2026/11/11 10:41:53..2026/11/11 11:41:53",
    );
  });

  it("keeps the centre of a widened instant for zoned readers", () => {
    expect(parseTimeInput("5 minutes ago", US)).toMatchObject({
      centre: { date: "2026/11/11", time: "12:36:53" },
    });
  });
});

describe("parseTimeInput times of day", () => {
  it.each([
    ["9am", "A 2026/11/11 08:55:00..2026/11/11 09:05:00"],
    ["9:30 am", "A 2026/11/11 09:25:00..2026/11/11 09:35:00"],
    ["noon", "A 2026/11/11 11:55:00..2026/11/11 12:05:00"],
    ["midnight", "A 2026/11/10 23:55:00..2026/11/11 00:05:00"],
    ["10:00", "A 2026/11/11 09:55:00..2026/11/11 10:05:00"],
    ["9:05", "A 2026/11/11 09:00:00..2026/11/11 09:10:00"],
    ["14:32", "A 2026/11/10 14:27:00..2026/11/10 14:37:00"],
    ["3pm", "A 2026/11/10 14:55:00..2026/11/10 15:05:00"],
    ["at 9am", "A 2026/11/11 08:55:00..2026/11/11 09:05:00"],
  ])("reads %s as the most recent past one", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it.each([
    ["this morning", "A 2026/11/11 06:00:00..2026/11/11 12:00:00"],
    ["morning", "A 2026/11/11 06:00:00..2026/11/11 12:00:00"],
    ["yesterday morning", "A 2026/11/10 06:00:00..2026/11/10 12:00:00"],
    ["yesterday afternoon", "A 2026/11/10 12:00:00..2026/11/10 17:00:00"],
    ["yesterday evening", "A 2026/11/10 17:00:00..2026/11/10 21:00:00"],
    ["yesterday night", "A 2026/11/10 21:00:00..2026/11/11 06:00:00"],
    ["last night", "A 2026/11/10 21:00:00..2026/11/11 06:00:00"],
    ["tonight", "A 2026/11/10 21:00:00..2026/11/11 06:00:00"],
    ["Nov 4 evening", "A 2026/11/04 17:00:00..2026/11/04 21:00:00"],
  ])("reads the day part %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it.each(["last night", "tonight"])(
    "reads %s after 21:00 as the night that began today",
    (text) => {
      const late = { now: new Date(2026, 10, 11, 22, 30), locale: "en-US" };
      expect(read(text, late)).toBe("A 2026/11/11 21:00:00..2026/11/12 06:00:00");
    },
  );

  it("refuses a day part that has not started", () => {
    expect(read("this evening")).toBe("null");
  });
});

describe("parseTimeInput weekdays and day words", () => {
  it.each([
    ["monday", "A 2026/11/09 00:00:00..2026/11/10 00:00:00"],
    ["Mon", "A 2026/11/09 00:00:00..2026/11/10 00:00:00"],
    ["last friday", "A 2026/11/06 00:00:00..2026/11/07 00:00:00"],
    ["tuesdy", "A 2026/11/10 00:00:00..2026/11/11 00:00:00"],
    ["wednesday", "A 2026/11/11 00:00:00..2026/11/12 00:00:00"],
    ["last wednesday", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
  ])("reads %s as that whole day", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it.each([
    ["yesterday 15:00", "A 2026/11/10 14:55:00..2026/11/10 15:05:00"],
    ["yesterday 3pm", "A 2026/11/10 14:55:00..2026/11/10 15:05:00"],
    ["yesterday at 3pm", "A 2026/11/10 14:55:00..2026/11/10 15:05:00"],
    ["3pm yesterday", "A 2026/11/10 14:55:00..2026/11/10 15:05:00"],
    ["monday 9am", "A 2026/11/09 08:55:00..2026/11/09 09:05:00"],
  ])("reads %s as an instant on that day", (text, expected) => {
    expect(read(text)).toBe(expected);
  });
});

describe("parseTimeInput since", () => {
  it.each([
    ["since 9am", "A 2026/11/11 09:00:00"],
    ["since 9", "A 2026/11/11 09:00:00"],
    ["since monday", "A 2026/11/09 00:00:00"],
    ["since nov 4", "A 2026/11/04 00:00:00"],
    ["since yesterday", "A 2026/11/10 00:00:00"],
    ["since midnight", "A 2026/11/11 00:00:00"],
    ["since 2 hours ago", "A 2026/11/11 10:41:53"],
  ])("reads %s up to now", (text, start) => {
    expect(read(text)).toBe(`${start}..${NOW_CIVIL}`);
  });
});

describe("parseTimeInput day and time ranges", () => {
  it.each([
    ["today 10:00 to 12:00", "A 2026/11/11 10:00:00..2026/11/11 12:00:00"],
    ["yesterday 3pm to 5pm", "A 2026/11/10 15:00:00..2026/11/10 17:00:00"],
    ["yesterday to today", "A 2026/11/10 00:00:00..2026/11/12 00:00:00"],
    ["10:00 to 12:30", "A 2026/11/11 10:00:00..2026/11/11 12:30:00"],
    ["10-12:30", "A 2026/11/11 10:00:00..2026/11/11 12:30:00"],
    ["3 to 5", "A 2026/11/11 03:00:00..2026/11/11 05:00:00"],
    ["9 to 5", "A 2026/11/11 09:00:00..2026/11/11 17:00:00"],
    ["15:00 to 17:00", "A 2026/11/10 15:00:00..2026/11/10 17:00:00"],
    ["from 3pm to 5pm", "A 2026/11/10 15:00:00..2026/11/10 17:00:00"],
    ["between 10am and 11am", "A 2026/11/11 10:00:00..2026/11/11 11:00:00"],
    ["between 2026-11-04 and 2026-11-06", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["from nov 4 to nov 6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["2026-11-04 10:00 for 2 hours", "A 2026/11/04 10:00:00..2026/11/04 12:00:00"],
    ["2026-11-04 10:00 +/- 15m", "A 2026/11/04 09:45:00..2026/11/04 10:15:00"],
    ["2026-11-04 10:00 to 2026-11-04 1:30pm", "A 2026/11/04 10:00:00..2026/11/04 13:30:00"],
    ["2026-11-04 22:00 to 02:00", "A 2026/11/04 22:00:00..2026/11/05 02:00:00"],
  ])("reads %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("refuses a range wholly in the future and keeps a future end", () => {
    expect(read("today 15:00 to 17:00")).toBe("null");
    expect(read("today 12:00 to 14:00")).toBe("A 2026/11/11 12:00:00..2026/11/11 14:00:00");
  });

  it("still refuses a dashed HH:MM end after a clock time, which reads as an offset too", () => {
    expect(read("2024-01-01 10:00:00 - 05:00")).toBe("null");
  });
});

describe("parseTimeInput month-name dates", () => {
  it.each([
    ["Nov 4", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["nov 4th", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["4 November 2026", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["November 4 2026", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["November 4, 2026", "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["Dec 30", "A 2025/12/30 00:00:00..2025/12/31 00:00:00"],
    ["November", "A 2026/11/01 00:00:00..2026/12/01 00:00:00"],
    ["Oct 2026", "A 2026/10/01 00:00:00..2026/11/01 00:00:00"],
    ["december", "A 2025/12/01 00:00:00..2026/01/01 00:00:00"],
    ["Nov 4 - 6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["nov 4 to 6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["Nov 4-6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["4-6 nov", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["Nov 4 - Nov 6", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["4 Nov - 6 Nov", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["Oct 4 - Nov 2", "A 2026/10/04 00:00:00..2026/11/03 00:00:00"],
    ["Dec 20 - Jan 5", "A 2025/12/20 00:00:00..2026/01/06 00:00:00"],
    ["November 4, 2026 - November 6, 2026", "A 2026/11/04 00:00:00..2026/11/07 00:00:00"],
    ["Nov 4 10:00", "A 2026/11/04 09:55:00..2026/11/04 10:05:00"],
  ])("reads %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("refuses an impossible date and keeps a future one that gives its year", () => {
    expect(read("Feb 30 2026")).toBe("null");
    expect(read("Dec 4 2026")).toBe("A 2026/12/04 00:00:00..2026/12/05 00:00:00");
  });
});

describe("parseTimeInput numeric dates", () => {
  it.each([
    ["11/04/2026", US, "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["04/11/2026", GB, "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["04/11/2026", US, "A 2026/04/11 00:00:00..2026/04/12 00:00:00"],
    ["25/12/2025", US, "A 2025/12/25 00:00:00..2025/12/26 00:00:00"],
    ["12/25/2025", GB, "A 2025/12/25 00:00:00..2025/12/26 00:00:00"],
    ["04.11.2026", GB, "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["04-11-2026", GB, "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
    ["4/5", US, "A 2026/04/05 00:00:00..2026/04/06 00:00:00"],
    ["12/25", US, "A 2025/12/25 00:00:00..2025/12/26 00:00:00"],
    ["11/04/26", US, "A 2026/11/04 00:00:00..2026/11/05 00:00:00"],
  ])("reads %s in %o", (text, opts, expected) => {
    expect(read(text, opts)).toBe(expected);
  });

  it("reads a year-first date as Y/M/D whatever the locale", () => {
    expect(read("2026/04/05", GB)).toBe("A 2026/04/05 00:00:00..2026/04/06 00:00:00");
  });
});

describe("parseTimeInput explicit dates with 12-hour times", () => {
  it.each([
    ["2026-11-04 3pm", "A 2026/11/04 14:55:00..2026/11/04 15:05:00"],
    ["2026-11-04 3:00 PM", "A 2026/11/04 14:55:00..2026/11/04 15:05:00"],
    ["2026-11-04 9:05", "A 2026/11/04 09:00:00..2026/11/04 09:10:00"],
    ["2026-11-04 9:30 a.m.", "A 2026/11/04 09:25:00..2026/11/04 09:35:00"],
  ])("reads %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });
});

describe("parseTimeInput zones after a space", () => {
  it.each([
    ["10:00 UTC", "T 2026-11-11T09:55:00.000Z..2026-11-11T10:05:00.000Z"],
    ["2026-11-04 10:00 UTC", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["2026-11-04 10:00 GMT", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["2026-11-04 10:00 Z", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["2026-11-04 10:00 +05:30", "T 2026-11-04T04:25:00.000Z..2026-11-04T04:35:00.000Z"],
    ["2026-11-04 10:00 -0800", "T 2026-11-04T17:55:00.000Z..2026-11-04T18:05:00.000Z"],
    ["2026-11-04 10:00 GMT+5:30", "T 2026-11-04T04:25:00.000Z..2026-11-04T04:35:00.000Z"],
    ["2026-11-04 10:00 Asia/Kolkata", "T 2026-11-04T04:25:00.000Z..2026-11-04T04:35:00.000Z"],
    ["2026-11-04 10:00 America/New_York", "T 2026-11-04T14:55:00.000Z..2026-11-04T15:05:00.000Z"],
    ["2026-11-04 UTC", "T 2026-11-04T00:00:00.000Z..2026-11-05T00:00:00.000Z"],
    ["10:00Z to 12:00Z", "T 2026-11-11T10:00:00.000Z..2026-11-11T12:00:00.000Z"],
    ["10:00 to 12:00 UTC", "T 2026-11-11T10:00:00.000Z..2026-11-11T12:00:00.000Z"],
  ])("honours the zone in %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("reads an ambiguous letter abbreviation at its first listed offset", () => {
    expect(read("2026-11-04 10:00 IST")).toBe(
      "T 2026-11-04T04:25:00.000Z..2026-11-04T04:35:00.000Z",
    );
    expect(read("2026-11-04 10:00 PST")).toBe(
      "T 2026-11-04T17:55:00.000Z..2026-11-04T18:05:00.000Z",
    );
  });

  it("refuses an unknown zone name", () => {
    expect(read("2026-11-04 10:00 Mars/Olympus")).toBe("null");
  });
});

describe("parseTimeInput pasted formats", () => {
  it.each([
    ["1762250400.123", "T 2025-11-04T09:55:00.123Z..2025-11-04T10:05:00.123Z"],
    ["2026-11-04T10:00:00.123456Z", "T 2026-11-04T09:55:00.123Z..2026-11-04T10:05:00.123Z"],
    ["2026-11-04T10:00:00.123456789Z", "T 2026-11-04T09:55:00.123Z..2026-11-04T10:05:00.123Z"],
    ["[04/Nov/2026:10:00:00 +0000]", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["04/Nov/2026:10:00:00 +0000", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["Wed, 04 Nov 2026 10:00:00 GMT", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    ["Wed, 04 Nov 2026 10:00:00 +0000", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
    [
      "2026-11-04T10:00:00.000+0000 INFO started",
      "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z",
    ],
    ['"2026-11-04T10:00:00Z"', "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
  ])("reads %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it.each([
    ["Nov  4 10:00:00", "A 2026/11/04 09:55:00..2026/11/04 10:05:00"],
    ["2026-11-04 10:00:00,123", "A 2026/11/04 09:55:00.123..2026/11/04 10:05:00.123"],
    ["2026-11-04 10:00:00 ERROR disk full", "A 2026/11/04 09:55:00..2026/11/04 10:05:00"],
  ])("reads the zoneless log stamp %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("does not strip a trailing word that changes the meaning", () => {
    expect(read("2026-11-04T10:00:00Z to garbage")).toBe("null");
  });
});

describe("parseTimeInput URL query strings", () => {
  it.each([
    ["period=15m", "15m"],
    ["https://o2.example.com/web/logs?org_identifier=default&period=1h&stream=x", "1h"],
    ["?period=calendar:week:-1", "calendar:week:-1"],
    [
      "from=1762250400000000&to=1762254000000000",
      "T 2025-11-04T10:00:00.000Z..2025-11-04T11:00:00.000Z",
    ],
    [
      "https://o2.example.com/web/logs?from=1762250400000000&to=1762254000000000",
      "T 2025-11-04T10:00:00.000Z..2025-11-04T11:00:00.000Z",
    ],
    [
      "?from=1762250400000&to=1762254000000",
      "T 2025-11-04T10:00:00.000Z..2025-11-04T11:00:00.000Z",
    ],
    [
      "?from=2026-11-04T10:00:00Z&to=2026-11-04T11:00:00Z",
      "T 2026-11-04T10:00:00.000Z..2026-11-04T11:00:00.000Z",
    ],
  ])("reads %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("refuses a query with neither a period nor both ends", () => {
    expect(read("?from=1762250400000000")).toBe("null");
    expect(read("period=banana")).toBe("null");
  });
});

describe("parseTimeInput refusals and defaults", () => {
  it.each(["2", "12", "", "garbage", "after lunch", "tomorrow", "1762437731 to 15:10"])(
    "refuses %s",
    (text) => {
      expect(read(text)).toBe("null");
    },
  );

  it("works without options", () => {
    expect(parseTimeInput("15m")).toEqual({ type: "relative", period: "15m" });
  });
});

describe("parseTimeInput future input", () => {
  it.each([
    ["2027-01-01", "A 2027/01/01 00:00:00..2027/01/02 00:00:00"],
    ["2027-01-01T10:00:00Z", "T 2027-01-01T09:55:00.000Z..2027-01-01T10:05:00.000Z"],
    ["1830297600", "T 2027-12-31T23:55:00.000Z..2028-01-01T00:05:00.000Z"],
    ["Jan 1, 2027 10:00:00.000", "A 2027/01/01 09:55:00..2027/01/01 10:05:00"],
    ["[01/Jan/2027:10:00:00 +0000]", "T 2027-01-01T09:55:00.000Z..2027-01-01T10:05:00.000Z"],
    ["Dec 4 2026 - Dec 6 2026", "A 2026/12/04 00:00:00..2026/12/07 00:00:00"],
    ["12/04/2026", "A 2026/12/04 00:00:00..2026/12/05 00:00:00"],
    ["since Dec 4 2026", `A 2026/12/04 00:00:00..${NOW_CIVIL}`],
  ])("reads %s as written, as it gives a year or an instant", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it.each([
    ["today 15:00 to 17:00", "null"],
    ["Dec 4", "A 2025/12/04 00:00:00..2025/12/05 00:00:00"],
    ["4pm", "A 2026/11/10 15:55:00..2026/11/10 16:05:00"],
  ])("reads %s, which has no year, as the most recent past or not at all", (text, expected) => {
    expect(read(text)).toBe(expected);
  });
});

describe("parseTimeInput source details", () => {
  it("names the zone the text wrote its times in", () => {
    const zoneOf = (text: string) => {
      const reading = parseTimeInput(text, US);
      return reading?.type === "timestamp" ? reading.sourceZone : "not a timestamp";
    };
    expect(zoneOf("2026-11-04T10:00:00Z")).toBe("UTC");
    expect(zoneOf("2026-11-04T10:00:00+05:30 to 2026-11-04T11:00:00+05:30")).toBe("UTC+05:30");
    expect(zoneOf("[04/Nov/2026:10:00:00 -0500]")).toBe("UTC-05:00");
    expect(zoneOf("2026-11-04 10:00 Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(zoneOf("10:00 UTC")).toBe("UTC");
    expect(zoneOf("1762250400")).toBeUndefined();
    expect(zoneOf("since 1762250400")).toBeUndefined();
  });

  it("names each offset of a letter zone abbreviation", () => {
    const zones = suggestTimeInput("2026-11-04 10:00 IST", US).map((reading) =>
      reading.type === "timestamp" ? reading.sourceZone : null,
    );
    expect(zones).toEqual(["UTC+05:30", "UTC+01:00", "UTC+02:00"]);
  });

  it("marks a wall-clock reading whose text gives a year", () => {
    const hasYear = (text: string) => {
      const reading = parseTimeInput(text, US);
      return reading?.type === "absolute" ? reading.hasYear === true : "not absolute";
    };
    expect(hasYear("2026-11-04 10:00")).toBe(true);
    expect(hasYear("Nov 4, 2026 10:00:00.000")).toBe(true);
    expect(hasYear("4/11/26")).toBe(true);
    expect(hasYear("Nov 4 10:00")).toBe(false);
    expect(hasYear("since 9am")).toBe(false);
    expect(hasYear("yesterday")).toBe("not absolute");
  });
});

describe("suggestTimeInput", () => {
  it("asks months first for a capital M, and does not ask for a lowercase m", () => {
    expect(read("15M")).toBe("15M");
    expect(suggest("15M")).toEqual(["15M", "15m"]);
    expect(suggest("15m")).toEqual([]);
    expect(suggest("15mo")).toEqual([]);
  });

  it("offers minutes, hours, days, weeks and months for a bare number", () => {
    expect(suggest("2")).toEqual(["2m", "2h", "2d", "2w", "2M"]);
    expect(suggest(" 45 ")).toEqual(["45m", "45h", "45d", "45w", "45M"]);
  });

  it("offers both day/month orders, locale order first", () => {
    expect(suggest("4/5", US)).toEqual([
      "A 2026/04/05 00:00:00..2026/04/06 00:00:00",
      "A 2026/05/04 00:00:00..2026/05/05 00:00:00",
    ]);
    expect(suggest("4/5", GB)).toEqual([
      "A 2026/05/04 00:00:00..2026/05/05 00:00:00",
      "A 2026/04/05 00:00:00..2026/04/06 00:00:00",
    ]);
    expect(suggest("04-05-2026", GB)).toHaveLength(2);
  });

  it("offers nothing when one part is above 12 or both parts are equal", () => {
    expect(suggest("25/12/2025")).toEqual([]);
    expect(suggest("5/5")).toEqual([]);
  });

  it("offers both 12-hour readings, most recent past first", () => {
    expect(suggest("3 to 5")).toEqual([
      "A 2026/11/11 03:00:00..2026/11/11 05:00:00",
      "A 2026/11/10 15:00:00..2026/11/10 17:00:00",
    ]);
    expect(suggest("since 9")).toEqual([
      `A 2026/11/11 09:00:00..${NOW_CIVIL}`,
      `A 2026/11/10 21:00:00..${NOW_CIVIL}`,
    ]);
    expect(suggest("2026-11-04 9:05")).toEqual([
      "A 2026/11/04 09:00:00..2026/11/04 09:10:00",
      "A 2026/11/04 21:00:00..2026/11/04 21:10:00",
    ]);
  });

  it("offers nothing for a 24-hour or am/pm time", () => {
    expect(suggest("09:05")).toEqual([]);
    expect(suggest("14:32")).toEqual([]);
    expect(suggest("3pm")).toEqual([]);
  });

  it("offers each explicit offset a letter zone abbreviation can mean", () => {
    expect(suggest("2026-11-04 10:00 IST")).toEqual([
      "T 2026-11-04T04:25:00.000Z..2026-11-04T04:35:00.000Z",
      "T 2026-11-04T08:55:00.000Z..2026-11-04T09:05:00.000Z",
      "T 2026-11-04T07:55:00.000Z..2026-11-04T08:05:00.000Z",
    ]);
    expect(suggest("2026-11-04 10:00 CST")[0]).toBe(
      "T 2026-11-04T15:55:00.000Z..2026-11-04T16:05:00.000Z",
    );
  });

  it("offers nothing for unambiguous or unreadable input", () => {
    for (const text of ["", "15m", "yesterday", "2026-11-04 10:00 UTC", "garbage", "Nov 4"]) {
      expect(suggest(text)).toEqual([]);
    }
  });
});

describe("timeZone option", () => {
  // 20:00 UTC on Nov 11 is already 01:30 on Nov 12 in Kolkata, while the browser (UTC in tests) is still on Nov 11.
  const LATE = new Date(Date.UTC(2026, 10, 11, 20, 0, 0));
  const KOLKATA: TimeInputOptions = { now: LATE, locale: "en-US", timeZone: "Asia/Kolkata" };
  const BROWSER: TimeInputOptions = { now: LATE, locale: "en-US" };

  it("reads today and since in the picker zone, not the browser's", () => {
    expect(read("since today", KOLKATA)).toBe("A 2026/11/12 00:00:00..2026/11/12 01:30:00");
    expect(read("since today", BROWSER)).toBe("A 2026/11/11 00:00:00..2026/11/11 20:00:00");
    expect(read("yesterday 3pm", KOLKATA)).toBe("A 2026/11/11 14:55:00..2026/11/11 15:05:00");
  });

  it("reads bare times as most recent past on the picker's clock", () => {
    expect(read("9am", KOLKATA)).toBe("A 2026/11/11 08:55:00..2026/11/11 09:05:00");
    expect(read("1:00", KOLKATA)).toBe("A 2026/11/12 00:55:00..2026/11/12 01:05:00");
    expect(read("1:00", BROWSER)).toBe("A 2026/11/11 12:55:00..2026/11/11 13:05:00");
  });

  it("reads weekdays and noon on the picker's date", () => {
    expect(read("thursday", KOLKATA)).toBe("A 2026/11/12 00:00:00..2026/11/13 00:00:00");
    expect(read("thursday", BROWSER)).toBe("A 2026/11/05 00:00:00..2026/11/06 00:00:00");
    expect(read("noon", KOLKATA)).toBe("A 2026/11/11 11:55:00..2026/11/11 12:05:00");
  });

  it("infers a missing year on the picker's date across new year", () => {
    const newYear = new Date(Date.UTC(2026, 11, 31, 20, 0, 0));
    const opts = { now: newYear, locale: "en-US", timeZone: "Asia/Kolkata" };
    expect(read("Jan 1", opts)).toBe("A 2027/01/01 00:00:00..2027/01/02 00:00:00");
    expect(read("Jan 1", { now: newYear, locale: "en-US" })).toBe(
      "A 2026/01/01 00:00:00..2026/01/02 00:00:00",
    );
  });

  it("ends a zoned since at the real instant of now", () => {
    expect(parseTimeInput("since 2026-11-11T10:00:00Z", KOLKATA)).toEqual({
      type: "timestamp",
      startMicros: Date.UTC(2026, 10, 11, 10) * 1000,
      endMicros: LATE.getTime() * 1000,
      sourceZone: "UTC",
    });
  });

  it("falls back to the browser clock for an unknown zone", () => {
    expect(read("since today", { ...BROWSER, timeZone: "Mars/Olympus" })).toBe(
      "A 2026/11/11 00:00:00..2026/11/11 20:00:00",
    );
  });

  it("passes the zone to suggestions", () => {
    expect(suggestTimeInput("since 1", KOLKATA).map(show)).toEqual([
      "A 2026/11/12 01:00:00..2026/11/12 01:30:00",
      "A 2026/11/11 13:00:00..2026/11/12 01:30:00",
    ]);
  });
});

describe("suggestion round-trip", () => {
  // Accepting a suggestion with Tab writes its shorthand into the bar; reading that text back must give the same reading.
  it.each([
    ["2", ["2m", "2h", "2d", "2w", "2mo"]],
    ["15M", ["15mo", "15m"]],
    ["4/5", ["2026-04-05", "2026-05-04"]],
    [
      "since 9",
      ["2026-11-11 09:00:00 to 2026-11-11 12:41:53", "2026-11-10 21:00:00 to 2026-11-11 12:41:53"],
    ],
    [
      "3 to 5",
      ["2026-11-11T03:00:00 to 2026-11-11T05:00:00", "2026-11-10T15:00:00 to 2026-11-10T17:00:00"],
    ],
    ["2026-11-04 9:05", ["2026-11-04T09:05:00", "2026-11-04T21:05:00"]],
    [
      "2026-11-04 10:00 IST",
      ["2026-11-04T10:00:00+05:30", "2026-11-04T10:00:00+01:00", "2026-11-04T10:00:00+02:00"],
    ],
  ])("reads the shorthand of each %s suggestion back", (input, texts) => {
    const readings = suggestTimeInput(input, US);
    expect(readings.map(show)).toEqual(texts.map((text) => read(text)));
  });

  it.each([
    ["this week", "calendar:week:0"],
    ["2 weeks ago", "calendar:week:-2"],
    ["1 weeks ago", "calendar:week:-1"],
    ["15m", "15m"],
    ["2026-11-04T10:00:00Z", "T 2026-11-04T09:55:00.000Z..2026-11-04T10:05:00.000Z"],
  ])("reads %s back unchanged", (text, expected) => {
    expect(read(text)).toBe(expected);
  });
});

describe("clocks with a zone suffix", () => {
  const at = (iso: string, timeZone: string): TimeInputOptions => ({
    now: new Date(iso),
    locale: "en-US",
    timeZone,
  });

  it("picks the most recent day of a UTC clock on the UTC clock, not the picker's", () => {
    const kolkata = at("2026-11-11T07:11:00Z", "Asia/Kolkata");
    expect(suggest("10:00 UTC", kolkata)).toEqual([
      "T 2026-11-10T21:55:00.000Z..2026-11-10T22:05:00.000Z",
      "T 2026-11-10T09:55:00.000Z..2026-11-10T10:05:00.000Z",
    ]);
    expect(read("14:00 UTC", kolkata)).toBe("T 2026-11-10T13:55:00.000Z..2026-11-10T14:05:00.000Z");
    expect(read("14:00 UTC", at("2026-11-11T15:00:00Z", "America/New_York"))).toBe(
      "T 2026-11-11T13:55:00.000Z..2026-11-11T14:05:00.000Z",
    );
  });

  it("starts since a zoned clock at its most recent past in that zone", () => {
    expect(read("since 9am UTC", at("2026-11-11T07:11:00Z", "Asia/Kolkata"))).toBe(
      "T 2026-11-10T09:00:00.000Z..2026-11-11T07:11:00.000Z",
    );
  });

  it("picks the day of a clock in a named region on that region's clock", () => {
    expect(read("14:00 America/New_York", at("2026-11-11T17:00:00Z", "Asia/Kolkata"))).toBe(
      "T 2026-11-10T18:55:00.000Z..2026-11-10T19:05:00.000Z",
    );
  });
});

describe("elapsed time across a DST change", () => {
  // 06:30Z on the fall-back day is the second 01:30 on New York's wall clock.
  const FALL_BACK: TimeInputOptions = {
    now: new Date("2026-11-01T06:30:00Z"),
    locale: "en-US",
    timeZone: "America/New_York",
  };

  it("subtracts real elapsed time from now, not wall-clock time", () => {
    expect(parseTimeInput("now-2h to now-1h", FALL_BACK)).toMatchObject({
      exact: {
        startMicros: Date.parse("2026-11-01T04:30:00Z") * 1000,
        endMicros: Date.parse("2026-11-01T05:30:00Z") * 1000,
      },
    });
    expect(parseTimeInput("30 minutes ago", FALL_BACK)).toMatchObject({
      exact: {
        startMicros: Date.parse("2026-11-01T05:55:00Z") * 1000,
        endMicros: Date.parse("2026-11-01T06:05:00Z") * 1000,
      },
    });
  });
});

describe("long pasted text", () => {
  const blob = "worker started without a timestamp. ".repeat(6000);

  it("reads or refuses about 200 KB of log text in well under a frame budget", () => {
    expect(blob.length).toBeGreaterThan(200_000);
    const started = performance.now();
    expect(parseTimeInput(blob, US)).toBeNull();
    expect(suggestTimeInput(blob, US)).toEqual([]);
    expect(parseTimeInput(`${"!".repeat(100_000)}x${"!".repeat(100_000)}`, US)).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("still reads the leading stamp of a long log line", () => {
    expect(read(`2026-11-04 10:00:00 ${"INFO request served ".repeat(10_000)}`)).toBe(
      "A 2026/11/04 09:55:00..2026/11/04 10:05:00",
    );
  });
});

describe("parseTimeInput day with a clock range", () => {
  it.each([
    ["yesterday 9-17", "A 2026/11/10 09:00:00..2026/11/10 17:00:00"],
    ["yesterday 9am-5pm", "A 2026/11/10 09:00:00..2026/11/10 17:00:00"],
    ["yesterday 09:00-17:00", "A 2026/11/10 09:00:00..2026/11/10 17:00:00"],
    ["yesterday 9 to 17", "A 2026/11/10 09:00:00..2026/11/10 17:00:00"],
    ["nov 4 9-17", "A 2026/11/04 09:00:00..2026/11/04 17:00:00"],
    ["today 9-11", "A 2026/11/11 09:00:00..2026/11/11 11:00:00"],
  ])("reads %s as that day's two times", (text, shown) => {
    expect(read(text)).toBe(shown);
  });

  it("leaves hours that are not clock times unread", () => {
    expect(read("yesterday 9-25")).toBe("null");
  });
});

describe("parseTimeInput snap grammar", () => {
  it.each([
    ["now-1d/d", "calendar:day:-1"],
    ["now/d", "calendar:day:0"],
    ["@d", "calendar:day:0"],
    ["today so far", "calendar:day:0"],
    ["this month so far", "calendar:month:0"],
    ["now-1w/w", "calendar:week:-1"],
    ["now-2M/M", "calendar:month:-2"],
    ["now-36h/d", "calendar:day:-1"],
    ["now-1d/d to now-1d/d", "calendar:day:-1"],
    ["now-1y/y", "calendar:year:-1"],
  ])("maps %s to the calendar token %s", (text, token) => {
    expect(read(text)).toBe(token);
  });

  it.each([
    ["-1d@d+9h", "A 2026/11/10 09:00:00..2026/11/11 12:41:53"],
    ["now-1d@d", "A 2026/11/10 00:00:00..2026/11/11 12:41:53"],
    ["now-2d/d to now/d", "A 2026/11/09 00:00:00..2026/11/11 12:41:53"],
    ["now-3h/h", "A 2026/11/11 09:00:00..2026/11/11 10:00:00"],
    ["now/h", "A 2026/11/11 12:00:00..2026/11/11 12:41:53"],
    ["now-1d/d+9h", "A 2026/11/10 09:00:00..2026/11/11 12:41:53"],
  ])("fixes %s when read, as %s", (text, shown) => {
    expect(read(text)).toBe(shown);
  });

  it("leaves plain now-offsets rolling and dates with slashes to the date readers", () => {
    expect(read("now-1d")).toBe("1d");
    expect(read("11/4")).toBe("A 2026/11/04 00:00:00..2026/11/05 00:00:00");
  });

  it("resolves a far-back snap without walking every period, and refuses one past the calendar", () => {
    const started = performance.now();
    expect(read("now-999999d/d")).toBe("calendar:day:-999999");
    expect(read("now-999999y/y")).toBe("null");
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("does not read snap text it cannot make sense of", () => {
    expect(read("now/x")).toBe("null");
    expect(read("@")).toBe("null");
  });
});
