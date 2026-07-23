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
import { parseDateRangeString, parseSingleDateTime } from "./dateTimeRangeParse";

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
        endDate: "2026/07/22",
        endTime: "23:59:59",
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

    it("defaults times to full-day bounds when only dates are given", () => {
      expect(parseDateRangeString("2026/07/21 - 2026/07/22")).toEqual({
        type: "absolute",
        startDate: "2026/07/21",
        startTime: "00:00:00",
        endDate: "2026/07/22",
        endTime: "23:59:59",
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
      // 9 digits (too short) and 17 digits (too long) are not accepted.
      expect(parseDateRangeString("123456789 - 123456789")).toBeNull();
      expect(parseDateRangeString("12345678901234567 - 12345678901234567")).toBeNull();
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
      expect(parseSingleDateTime("12345678901234567")).toBeNull();
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
    it("returns null for ranges and unrecognized strings", () => {
      // A range string is not a single value.
      expect(parseSingleDateTime("2026/07/21 13:33:06 - 2026/07/21 15:33:06")).toBeNull();
      expect(parseSingleDateTime("1721557986000000 - 1721565186000000")).toBeNull();
      expect(parseSingleDateTime("")).toBeNull();
      expect(parseSingleDateTime("garbage")).toBeNull();
      expect(parseSingleDateTime("Past 2 Hours")).toBeNull();
    });
  });
});
