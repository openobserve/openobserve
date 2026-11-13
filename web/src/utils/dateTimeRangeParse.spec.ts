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
  parseDateRangeString,
  parseRelativeText,
  parseRollingPeriod,
  parseSingleDateTime,
  parseTimeInput,
} from "./dateTimeRangeParse";

describe("parseDateRangeString", () => {
  describe("copy-emitted JSON object ({start_date, end_date} in epoch µs)", () => {
    it("parses the object Copy emits", () => {
      expect(
        parseDateRangeString('{"start_date":1721557986000000,"end_date":1721565186000000}'),
      ).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("tolerates surrounding whitespace and extra JSON whitespace", () => {
      expect(
        parseDateRangeString(
          '  { "start_date": 1721557986000000, "end_date": 1721565186000000 }  ',
        ),
      ).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("rejects malformed JSON and objects missing the expected keys", () => {
      expect(parseDateRangeString('{"start_date":1721557986000000}')).toBeNull();
      expect(parseDateRangeString('{"startDate":"2026/07/21"}')).toBeNull();
      expect(parseDateRangeString("{not valid json")).toBeNull();
      expect(
        parseDateRangeString('{"start_date":"not-a-number","end_date":1721565186000000}'),
      ).toBeNull();
    });
  });

  describe("ISO 8601 range", () => {
    it("with a Z offset, resolves straight to an instant (timezone-independent)", () => {
      expect(parseDateRangeString("2026-07-21T13:33:06Z - 2026-07-21T15:33:06Z")).toEqual({
        type: "timestamp",
        startMicros: 1784640786000000,
        endMicros: 1784647986000000,
      });
    });

    it("with a numeric offset, resolves to the same instant as the equivalent Z time", () => {
      // 19:03:06+05:30 is the same instant as 13:33:06Z.
      expect(parseDateRangeString("2026-07-21T19:03:06+05:30 - 2026-07-21T21:03:06+05:30")).toEqual(
        {
          type: "timestamp",
          startMicros: 1784640786000000,
          endMicros: 1784647986000000,
        },
      );
    });

    it("accepts an offset with no colon (+HHMM)", () => {
      expect(parseDateRangeString("2026-07-21T19:03:06+0530 - 2026-07-21T21:03:06+0530")).toEqual({
        type: "timestamp",
        startMicros: 1784640786000000,
        endMicros: 1784647986000000,
      });
    });

    it("accepts an hour-only offset (+HH), which date-fns renders for whole-hour zones", () => {
      // 08:33:06-05 is the same instant as 13:33:06Z.
      expect(parseDateRangeString("2026-07-21T08:33:06-05 - 2026-07-21T10:33:06-05")).toEqual({
        type: "timestamp",
        startMicros: 1784640786000000,
        endMicros: 1784647986000000,
      });
    });

    it("without an offset, resolves to the picker-timezone-dependent absolute shape", () => {
      expect(parseDateRangeString("2026-07-21T13:33:06 - 2026-07-21T15:33:06")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "13:33:06",
        endDate: "2026/07/21",
        endTime: "15:33:06",
      });
    });

    it("accepts a space instead of T, and defaults missing seconds/times", () => {
      expect(parseDateRangeString("2026-07-21 13:33 - 2026-07-21 15:33")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "13:33:00",
        endDate: "2026/07/21",
        endTime: "15:33:00",
      });
      expect(parseDateRangeString("2026-07-21 - 2026-07-22")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "00:00:00",
        endDate: "2026/07/23",
        endTime: "00:00:00",
      });
    });

    it("preserves milliseconds in an ISO range with offsets", () => {
      expect(
        parseDateRangeString("2026-07-21T13:33:06.123Z - 2026-07-21T21:03:06.456+05:30"),
      ).toEqual({
        type: "timestamp",
        startMicros: 1784640786123000,
        endMicros: 1784647986456000,
      });
    });

    it("preserves milliseconds in an ISO range without offsets", () => {
      expect(parseDateRangeString("2026-07-21T13:33:06.1 - 2026-07-21T15:33:06.012")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "13:33:06.1",
        endDate: "2026/07/21",
        endTime: "15:33:06.012",
      });
    });

    it("rejects a pair that mixes offset and offset-less sides", () => {
      // One side is an unambiguous instant, the other isn't — genuinely
      // ambiguous, so this is a paste error rather than a guess.
      expect(parseDateRangeString("2026-07-21T13:33:06Z - 2026-07-21T15:33:06")).toBeNull();
    });

    it("rejects malformed ISO strings", () => {
      expect(parseDateRangeString("2026-7-21T13:33:06Z - 2026-07-22T13:33:06Z")).toBeNull();
      expect(
        parseDateRangeString("2026-07-21T13:33:06+5:30 - 2026-07-22T13:33:06+5:30"),
      ).toBeNull();
    });
  });

  describe("human log format range (MMM DD, YYYY HH:mm:ss.SSS Z — matches the app's own display)", () => {
    it("with an offset, resolves straight to an instant", () => {
      expect(
        parseDateRangeString("Jul 21, 2026 13:33:06.000 +0000 - Jul 21, 2026 15:33:06.000 +0000"),
      ).toEqual({
        type: "timestamp",
        startMicros: 1784640786000000,
        endMicros: 1784647986000000,
      });
    });

    it("without an offset, resolves to the picker-timezone-dependent absolute shape, keeping milliseconds", () => {
      expect(parseDateRangeString("Jul 21, 2026 13:33:06.500 - Jul 21, 2026 15:33:06.500")).toEqual(
        {
          type: "absolute",
          startDate: "2026/07/21",
          startTime: "13:33:06.500",
          endDate: "2026/07/21",
          endTime: "15:33:06.500",
        },
      );
    });

    it("rejects a pair that mixes offset and offset-less sides", () => {
      expect(
        parseDateRangeString("Jul 21, 2026 13:33:06 +0000 - Jul 21, 2026 15:33:06"),
      ).toBeNull();
    });
  });

  describe("absolute format (YYYY/MM/DD HH:MM:SS - YYYY/MM/DD HH:MM:SS)", () => {
    it("parses a full date-time range", () => {
      expect(parseDateRangeString("2026/07/21 13:33:06 - 2026/07/21 15:33:06")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "13:33:06",
        endDate: "2026/07/21",
        endTime: "15:33:06",
      });
    });

    it("ends a dates-only range at the next midnight, as the search end is exclusive", () => {
      expect(parseDateRangeString("2026/07/21 - 2026/07/22")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "00:00:00",
        endDate: "2026/07/23",
        endTime: "00:00:00",
      });
    });

    it("parses a range spanning different dates", () => {
      expect(parseDateRangeString("2026/01/01 00:00:00 - 2026/12/31 23:59:59")).toEqual({
        type: "absolute",
        startDate: "2026/01/01",
        startTime: "00:00:00",
        endDate: "2026/12/31",
        endTime: "23:59:59",
      });
    });

    it("tolerates surrounding whitespace", () => {
      expect(parseDateRangeString("  2026/07/21 13:33:06 - 2026/07/21 15:33:06 ")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "13:33:06",
        endDate: "2026/07/21",
        endTime: "15:33:06",
      });
    });

    it("rejects malformed absolute strings", () => {
      // "2026-07-21 - 2026-07-22" is no longer rejected here — dashes now
      // read as ISO 8601 (see the "ISO 8601 range" block above). Wrong
      // separators, missing halves, non-4-digit year still reject.
      expect(parseDateRangeString("2026/07/21 13:33:06")).toBeNull();
      expect(parseDateRangeString("26/07/21 - 26/07/22")).toBeNull();
      expect(parseDateRangeString("2026/7/21 - 2026/7/22")).toBeNull();
    });
  });

  describe("epoch timestamp pair (paste only)", () => {
    it("passes microseconds through unchanged", () => {
      expect(parseDateRangeString("1721557986000000 - 1721565186000000")).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("normalizes milliseconds to microseconds", () => {
      expect(parseDateRangeString("1721557986000 - 1721565186000")).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("normalizes seconds to microseconds", () => {
      expect(parseDateRangeString("1721557986 - 1721565186")).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("yields identical micros across all three units for the same instant", () => {
      const secs = parseDateRangeString("1721557986 - 1721565186");
      const millis = parseDateRangeString("1721557986000 - 1721565186000");
      const micros = parseDateRangeString("1721557986000000 - 1721565186000000");
      expect(secs).toEqual(millis);
      expect(millis).toEqual(micros);
    });

    it("tolerates surrounding whitespace", () => {
      expect(parseDateRangeString("  1721557986000000 - 1721565186000000  ")).toEqual({
        type: "timestamp",
        startMicros: 1721557986000000,
        endMicros: 1721565186000000,
      });
    });

    it("rejects out-of-range digit lengths and single values", () => {
      // 9 digits (too short) and 20 digits (longer than nanoseconds) are not accepted.
      expect(parseDateRangeString("123456789 - 123456789")).toBeNull();
      expect(parseDateRangeString("12345678901234567890 - 12345678901234567890")).toBeNull();
      expect(parseDateRangeString("1721557986000000")).toBeNull();
    });
  });

  describe("format precedence", () => {
    it("prefers the JSON reading over absolute/timestamp when the input starts with {", () => {
      const result = parseDateRangeString(
        '{"start_date":1721557986000000,"end_date":1721565186000000}',
      );
      expect(result?.type).toBe("timestamp");
    });

    it("prefers the timestamp reading over absolute for pure digit pairs", () => {
      const result = parseDateRangeString("1721557986000000 - 1721565186000000");
      expect(result?.type).toBe("timestamp");
    });
  });

  describe("invalid input", () => {
    it("returns null for unrecognized strings", () => {
      expect(parseDateRangeString("")).toBeNull();
      expect(parseDateRangeString("   ")).toBeNull();
      expect(parseDateRangeString("garbage")).toBeNull();
      expect(parseDateRangeString("not a date range")).toBeNull();
      expect(parseDateRangeString("2026/07/21")).toBeNull();
    });

    it("no longer accepts the retired relative format", () => {
      // `Past N <Period>` was dropped — paste only accepts absolute range,
      // date-only range, timestamp pair, and the copy-emitted JSON object.
      expect(parseDateRangeString("Past 2 Hours")).toBeNull();
      expect(parseDateRangeString("Past 15 Minutes")).toBeNull();
    });
  });
});

describe("parseSingleDateTime", () => {
  it.each([
    ["2026-07-21T13:33:06.1Z", 1784640786100000],
    ["2026-07-21T13:33:06.01Z", 1784640786010000],
    ["2026-07-21T13:33:06.001Z", 1784640786001000],
    ["2026-07-21T19:03:06.123+05:30", 1784640786123000],
    ["2026-07-21T08:33:06.123-05", 1784640786123000],
  ])("parses fractional ISO seconds with an offset: %s", (value, micros) => {
    expect(parseSingleDateTime(String(value))).toEqual({ type: "timestamp", micros });
  });

  it("accepts a timestamp copied from Date.toISOString", () => {
    const date = new Date("2026-07-21T13:33:06.123Z");
    expect(parseSingleDateTime(date.toISOString())).toEqual({
      type: "timestamp",
      micros: date.getTime() * 1000,
    });
  });

  it("keeps fractional ISO seconds without an offset in the picker timezone", () => {
    expect(parseSingleDateTime("2026-07-21 13:33:06.123")).toEqual({
      type: "absolute",
      date: "2026/07/21",
      time: "13:33:06.123",
    });
  });

  it.each([
    "2026-07-21T13:33:06.Z",
    "2026-07-21T13:33.123Z",
    "2026-07-21T13:33:60.123Z",
    "2026-02-30T13:33:06.123Z",
  ])("rejects malformed fractional ISO timestamps: %s", (value) => {
    expect(parseSingleDateTime(value)).toBeNull();
  });

  describe("single epoch timestamp", () => {
    it("passes microseconds through unchanged", () => {
      expect(parseSingleDateTime("1721557986000000")).toEqual({
        type: "timestamp",
        micros: 1721557986000000,
      });
    });

    it("normalizes milliseconds and seconds to microseconds", () => {
      expect(parseSingleDateTime("1721557986000")).toEqual({
        type: "timestamp",
        micros: 1721557986000000,
      });
      expect(parseSingleDateTime("1721557986")).toEqual({
        type: "timestamp",
        micros: 1721557986000000,
      });
    });

    it("tolerates surrounding whitespace", () => {
      expect(parseSingleDateTime("  1721557986000000  ")).toEqual({
        type: "timestamp",
        micros: 1721557986000000,
      });
    });

    it("rejects out-of-range digit lengths", () => {
      expect(parseSingleDateTime("123456789")).toBeNull();
      expect(parseSingleDateTime("12345678901234567890")).toBeNull();
    });
  });

  describe("single absolute date[+time]", () => {
    it("parses a date with time", () => {
      expect(parseSingleDateTime("2026/07/21 13:33:06")).toEqual({
        type: "absolute",
        date: "2026/07/21",
        time: "13:33:06",
      });
    });

    it("parses a date-only value, leaving time undefined for the caller to default", () => {
      expect(parseSingleDateTime("2026/07/21")).toEqual({
        type: "absolute",
        date: "2026/07/21",
        time: undefined,
      });
    });

    it("tolerates surrounding whitespace", () => {
      expect(parseSingleDateTime("  2026/07/21 13:33:06  ")).toEqual({
        type: "absolute",
        date: "2026/07/21",
        time: "13:33:06",
      });
    });

    it("rejects malformed absolute strings", () => {
      // "2026-07-21" is no longer rejected here — dashes now read as ISO 8601
      // (see the "single ISO 8601" block below).
      expect(parseSingleDateTime("26/07/21")).toBeNull();
      expect(parseSingleDateTime("2026/7/21")).toBeNull();
    });
  });

  describe("single ISO 8601", () => {
    it("with an offset, resolves straight to an instant", () => {
      expect(parseSingleDateTime("2026-07-21T13:33:06Z")).toEqual({
        type: "timestamp",
        micros: 1784640786000000,
      });
      // 19:03:06+05:30 is the same instant as 13:33:06Z.
      expect(parseSingleDateTime("2026-07-21T19:03:06+05:30")).toEqual({
        type: "timestamp",
        micros: 1784640786000000,
      });
    });

    it("without an offset, resolves to the picker-timezone-dependent absolute shape", () => {
      expect(parseSingleDateTime("2026-07-21T13:33:06")).toEqual({
        type: "absolute",
        date: "2026/07/21",
        time: "13:33:06",
      });
    });

    it("date-only, leaves time undefined for the caller to default", () => {
      expect(parseSingleDateTime("2026-07-21")).toEqual({
        type: "absolute",
        date: "2026/07/21",
        time: undefined,
      });
    });

    it("rejects malformed ISO strings", () => {
      expect(parseSingleDateTime("2026-7-21")).toBeNull();
      expect(parseSingleDateTime("2026-07-21T13:33:06+5:30")).toBeNull();
    });
  });

  describe("single human log format (MMM DD, YYYY HH:mm:ss.SSS Z)", () => {
    it("with an offset and milliseconds, resolves straight to an instant", () => {
      // This is the exact string the app's own log/trace views render
      // (src/utils/date.ts's formatTimestamp / HUMAN_TZ_FORMAT).
      expect(parseSingleDateTime("Jul 22, 2026 06:40:28.008 +0000")).toEqual({
        type: "timestamp",
        micros: 1784702428008000,
      });
    });

    it("with a negative offset", () => {
      expect(parseSingleDateTime("Jul 22, 2026 06:40:28.008 -0500")).toEqual({
        type: "timestamp",
        micros: 1784720428008000,
      });
    });

    it("with an hour-only offset, as formatToHuman renders it in a whole-hour zone", () => {
      expect(parseSingleDateTime("Jul 22, 2026 01:40:28.008 -05")).toEqual({
        type: "timestamp",
        micros: 1784702428008000,
      });
      expect(parseSingleDateTime("Jul 22, 2026 08:40:28.008 +02")).toEqual({
        type: "timestamp",
        micros: 1784702428008000,
      });
    });

    it("without milliseconds", () => {
      expect(parseSingleDateTime("Jul 22, 2026 06:40:28 +0000")).toEqual({
        type: "timestamp",
        micros: 1784702428000000,
      });
    });

    it("without an offset, resolves to the picker-timezone-dependent absolute shape, keeping milliseconds in the time string", () => {
      expect(parseSingleDateTime("Jul 22, 2026 06:40:28.008")).toEqual({
        type: "absolute",
        date: "2026/07/22",
        time: "06:40:28.008",
      });
    });

    it("is case-insensitive on the month abbreviation and tolerates a missing comma", () => {
      expect(parseSingleDateTime("jul 22, 2026 06:40:28")).toEqual({
        type: "absolute",
        date: "2026/07/22",
        time: "06:40:28",
      });
      expect(parseSingleDateTime("JUL 22 2026 06:40:28")).toEqual({
        type: "absolute",
        date: "2026/07/22",
        time: "06:40:28",
      });
    });

    it("pads a single-digit day", () => {
      expect(parseSingleDateTime("Jul 2, 2026 06:40:28")).toEqual({
        type: "absolute",
        date: "2026/07/02",
        time: "06:40:28",
      });
    });

    it("requires a time component — date-only is not a valid single value for this format", () => {
      expect(parseSingleDateTime("Jul 22, 2026")).toBeNull();
    });

    it("rejects an unrecognized month", () => {
      expect(parseSingleDateTime("Jxx 22, 2026 06:40:28")).toBeNull();
    });
  });

  describe("invalid input", () => {
    it("rejects out-of-range clock values", () => {
      expect(parseSingleDateTime("2026-01-01T25:00")).toBeNull();
      expect(parseDateRangeString("2026-01-01T00:00 - 2026-01-01T25:00")).toBeNull();
    });

    it.each([
      "2026-01-01T24:00",
      "2026-01-01T12:60",
      "2026-01-01T12:00:60",
      "2026-13-01",
      "2026-01-32",
      "2026-02-30",
      "2026-02-29",
      "2026/01/01 24:00:00",
      "2026/01/01 12:60:00",
      "2026/01/01 12:00:60",
      "2026/13/01",
      "2026/01/32",
      "2026/02/30",
      "2026/02/29",
      "Jan 01, 2026 24:00:00",
      "Jan 01, 2026 12:60:00",
      "Jan 01, 2026 12:00:60",
      "Jan 32, 2026 12:00:00",
      "Feb 30, 2026 12:00:00",
      "Feb 29, 2026 12:00:00",
    ])("rejects invalid semantic date/time value: %s", (value) => {
      expect(parseSingleDateTime(value)).toBeNull();
    });

    it.each(["2026-01-01T25:00Z", "2026-02-30T00:00:00Z", "Feb 29, 2026 12:00:00 +0000"])(
      "rejects invalid offset-bearing date/time value: %s",
      (value) => {
        expect(parseSingleDateTime(value)).toBeNull();
      },
    );

    it("returns null for ranges and unrecognized strings", () => {
      // A range string is not a single value.
      expect(parseSingleDateTime("2026/07/21 13:33:06 - 2026/07/21 15:33:06")).toBeNull();
      expect(parseSingleDateTime("1721557986000000 - 1721565186000000")).toBeNull();
      expect(parseSingleDateTime("")).toBeNull();
      expect(parseSingleDateTime("garbage")).toBeNull();
      expect(parseSingleDateTime("Past 2 Hours")).toBeNull();
    });
  });

  it.each(["2024-02-29T12:00:00", "2024/02/29 12:00:00", "Feb 29, 2024 12:00:00"])(
    "keeps valid leap-day values: %s",
    (value) => {
      expect(parseSingleDateTime(value)).toMatchObject({
        type: "absolute",
        date: "2024/02/29",
        time: "12:00:00",
      });
    },
  );
});

describe("parseDateRangeString separators and partial ends", () => {
  it.each([
    "2026/11/06 14:02:11 to 2026/11/06 15:10:43",
    "2026/11/06 14:02:11 TO 2026/11/06 15:10:43",
    "2026/11/06 14:02:11 – 2026/11/06 15:10:43",
    "2026/11/06 14:02:11 — 2026/11/06 15:10:43",
    "2026/11/06 14:02:11 - 2026/11/06 15:10:43",
  ])("reads %s as one zoneless range", (text) => {
    expect(parseDateRangeString(text)).toEqual({
      type: "absolute",
      startDate: "2026/11/06",
      startTime: "14:02:11",
      endDate: "2026/11/06",
      endTime: "15:10:43",
    });
  });

  it("reads an ISO interval split by a slash as instants", () => {
    expect(parseDateRangeString("2026-11-08T03:30:00Z / 2026-11-08T05:30:00Z")).toEqual({
      type: "timestamp",
      startMicros: Date.parse("2026-11-08T03:30:00Z") * 1000,
      endMicros: Date.parse("2026-11-08T05:30:00Z") * 1000,
    });
  });

  it("gives a time-only end the start's date", () => {
    expect(parseDateRangeString("2026-11-06 14:02:11 to 15:10:43")).toEqual({
      type: "absolute",
      startDate: "2026/11/06",
      startTime: "14:02:11",
      endDate: "2026/11/06",
      endTime: "15:10:43",
    });
  });

  it("rolls a time-only end that is earlier than the start into the next day", () => {
    expect(parseDateRangeString("2026/12/31 23:00:00 to 01:30")).toEqual({
      type: "absolute",
      startDate: "2026/12/31",
      startTime: "23:00:00",
      endDate: "2027/01/01",
      endTime: "01:30:00",
    });
  });

  it.each([
    ["2024-01-01 10:00:00 - 05:00"],
    ["2024/01/01 10:00 - 05:00"],
    ["Jan 1, 2024 10:00:00 - 05:00"],
  ])("refuses %s, as a bare dash before HH:MM also reads as a negative offset", (text) => {
    expect(parseDateRangeString(text)).toBeNull();
    expect(parseTimeInput(text)).toBeNull();
  });

  it("still reads a dashed time-only end that has seconds, which no offset has", () => {
    expect(parseDateRangeString("2024-01-01 10:00:00 - 12:30:00")).toEqual({
      type: "absolute",
      startDate: "2024/01/01",
      startTime: "10:00:00",
      endDate: "2024/01/01",
      endTime: "12:30:00",
    });
  });

  it("gives a time-only end the start's offset", () => {
    expect(parseDateRangeString("2026-11-06T14:02:00+05:30 to 15:10")).toEqual({
      type: "timestamp",
      startMicros: Date.parse("2026-11-06T14:02:00+05:30") * 1000,
      endMicros: Date.parse("2026-11-06T15:10:00+05:30") * 1000,
    });
  });

  it("rejects a time-only end after an epoch start, which has no date of its own", () => {
    expect(parseDateRangeString("1762437731 to 15:10")).toBeNull();
  });

  it("rejects a time-only start", () => {
    expect(parseDateRangeString("14:02 - 15:10")).toBeNull();
  });

  it.each([
    ["seconds", "1762437731 to 1762441843", 1762437731000000, 1762441843000000],
    ["milliseconds", "1762437731000 – 1762441843000", 1762437731000000, 1762441843000000],
    ["microseconds", "1762437731000000-1762441843000000", 1762437731000000, 1762441843000000],
    [
      "nanoseconds",
      "1762437731000000123 - 1762441843000000999",
      1762437731000000,
      1762441843000000,
    ],
  ])("reads an epoch pair in %s", (_unit, text, startMicros, endMicros) => {
    expect(parseDateRangeString(String(text))).toEqual({
      type: "timestamp",
      startMicros,
      endMicros,
    });
  });
});

describe("parseRelativeText", () => {
  it.each([
    ["15m", "15m"],
    ["15 m", "15m"],
    ["15 min", "15m"],
    ["15 minutes", "15m"],
    ["last 2 hours", "2h"],
    ["Past 2 Hours", "2h"],
    ["last hour", "1h"],
    ["7d", "7d"],
    ["2 weeks", "2w"],
    ["3M", "3M"],
    ["3 months", "3M"],
    ["30s", "30s"],
  ])("reads %s as %s", (text, period) => {
    expect(parseRelativeText(text)).toBe(period);
  });

  it.each(["", "m", "hours", "0m", "15 parsecs", "last tuesday-ish", "1762437731"])(
    "rejects %s",
    (text) => {
      expect(parseRelativeText(text)).toBeNull();
    },
  );
});

describe("parseTimeInput", () => {
  it("returns a rolling period for relative text", () => {
    expect(parseTimeInput("last 2 hours")).toEqual({ type: "relative", period: "2h" });
  });

  it("widens a single instant to ±5 minutes, keeping the instant and its epoch unit", () => {
    const micros = Date.parse("2026-11-06T14:00:00Z") * 1000;
    expect(parseTimeInput("2026-11-06T14:00:00Z")).toEqual({
      type: "timestamp",
      startMicros: micros - 300_000_000,
      endMicros: micros + 300_000_000,
      centreMicros: micros,
      sourceZone: "UTC",
      utcStamp: true,
    });
    expect(parseTimeInput("1762437600")).toEqual({
      type: "timestamp",
      startMicros: 1762437600_000000 - 300_000_000,
      endMicros: 1762437600_000000 + 300_000_000,
      centreMicros: 1762437600_000000,
      epochUnit: "s",
    });
  });

  it("widens a single zoneless date-time to ±5 minutes, across midnight", () => {
    expect(parseTimeInput("2026/11/06 23:58:00")).toEqual({
      type: "absolute",
      startDate: "2026/11/06",
      startTime: "23:53:00",
      endDate: "2026/11/07",
      endTime: "00:03:00",
      centre: { date: "2026/11/06", time: "23:58:00" },
      hasYear: true,
    });
  });

  it("reads a lone date as that whole day, ending at the next midnight", () => {
    expect(parseTimeInput("2026/11/06")).toEqual({
      type: "absolute",
      startDate: "2026/11/06",
      startTime: "00:00:00",
      endDate: "2026/11/07",
      endTime: "00:00:00",
      hasYear: true,
    });
  });

  it("keeps a zoneless range zoneless, so the caller reads it in the picker timezone", () => {
    expect(parseTimeInput("2026-11-06 14:02:11 to 15:10:43")?.type).toBe("absolute");
  });

  it("keeps an offset range as instants", () => {
    expect(parseTimeInput("2026-11-08T03:30:00Z / 2026-11-08T05:30:00Z")?.type).toBe("timestamp");
  });

  it.each(["", "   ", "last tuesday-ish", "garbage", "2026/13/01"])("rejects %s", (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });
});

describe("round-2 regressions", () => {
  it("keeps a lone instant with a negative offset as one instant, not a dash-split range", () => {
    const micros = Date.parse("2024-01-02T10:00:00-05:00") * 1000;
    expect(parseDateRangeString("Jan 2, 2024 10:00:00 -05:00")).toBeNull();
    expect(parseTimeInput("Jan 2, 2024 10:00:00 -05:00")).toEqual({
      type: "timestamp",
      startMicros: micros - 300_000_000,
      endMicros: micros + 300_000_000,
      centreMicros: micros,
      sourceZone: "UTC-05:00",
    });
    expect(parseTimeInput("2024-01-02T10:00:00-05:00")).toEqual({
      type: "timestamp",
      startMicros: micros - 300_000_000,
      endMicros: micros + 300_000_000,
      centreMicros: micros,
      sourceZone: "UTC-05:00",
    });
  });

  it("still splits a bare-dash epoch or slash-date pair", () => {
    expect(parseDateRangeString("1762437731-1762441843")?.type).toBe("timestamp");
    expect(parseDateRangeString("2026/01/01-2026/01/02")?.type).toBe("absolute");
  });

  it("reads a time-only end in its own offset before deciding whether it rolls over", () => {
    expect(parseDateRangeString("2024-01-01T23:00:00+05:30 to 18:00Z")).toEqual({
      type: "timestamp",
      startMicros: Date.parse("2024-01-01T23:00:00+05:30") * 1000,
      endMicros: Date.parse("2024-01-01T18:00:00Z") * 1000,
    });
    expect(parseDateRangeString("2024-01-01T23:00:00+05:30 to 01:30")).toEqual({
      type: "timestamp",
      startMicros: Date.parse("2024-01-01T23:00:00+05:30") * 1000,
      endMicros: Date.parse("2024-01-02T01:30:00+05:30") * 1000,
    });
  });

  it.each([
    ["2024-01-01T01:00:00+05:30 to 20:00Z", "2023-12-31T19:30:00Z", "2023-12-31T20:00:00Z"],
    ["2024-01-01T23:00:00-05:00 to 03:00Z", "2024-01-02T04:00:00Z", "2024-01-03T03:00:00Z"],
    ["2024-01-01T23:00:00-05:00 to 05:00Z", "2024-01-02T04:00:00Z", "2024-01-02T05:00:00Z"],
  ])("dates a time-only end in its own offset: %s", (text, start, end) => {
    expect(parseDateRangeString(text)).toEqual({
      type: "timestamp",
      startMicros: Date.parse(start) * 1000,
      endMicros: Date.parse(end) * 1000,
    });
  });

  it.each(["17300000000000000", "173000000000000000"])(
    "rejects a %s-digit epoch that fits no unit",
    (digits) => {
      expect(parseSingleDateTime(digits)).toBeNull();
      expect(parseTimeInput(digits)).toBeNull();
    },
  );

  it("splits a picker period into count and unit, and rejects a zero count", () => {
    expect(parseRollingPeriod("15m")).toEqual({ value: 15, unit: "m" });
    expect(parseRollingPeriod("3M")).toEqual({ value: 3, unit: "M" });
    expect(parseRollingPeriod("0h")).toBeNull();
    expect(parseRollingPeriod("calendar:day:0")).toBeNull();
  });
});

describe("calendar words", () => {
  it.each([
    ["today", "calendar:day:0"],
    ["Yesterday", "calendar:day:-1"],
    ["this week", "calendar:week:0"],
    ["last week", "calendar:week:-1"],
    ["this month", "calendar:month:0"],
    ["Last Month", "calendar:month:-1"],
    ["this  quarter", "calendar:quarter:0"],
    ["last quarter", "calendar:quarter:-1"],
    ["last day", "calendar:day:-1"],
  ])("reads %s as the rail's %s token", (text, token) => {
    expect(parseTimeInput(text)).toEqual({ type: "relative", period: token });
  });

  // "last <unit>" names the previous calendar period where one exists; "past <unit>" and any count are rolling.
  it.each([
    ["last 1 month", "1M"],
    ["last 2 months", "2M"],
    ["past month", "1M"],
    ["past week", "1w"],
    ["past day", "1d"],
    ["past hour", "1h"],
    ["last hour", "1h"],
    ["last minute", "1m"],
  ])("keeps %s rolling", (text, period) => {
    expect(parseTimeInput(text)).toEqual({ type: "relative", period });
  });
});
