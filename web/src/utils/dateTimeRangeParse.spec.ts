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
  parseRangeInput,
  parseRangeWithReason,
  parseSingleDateTime,
  zoneAbbreviation,
  type PasteResult,
  type RangeInputContext,
  type RangeInputResult,
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
        endDate: "2026/07/22",
        endTime: "23:59:59",
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

describe("parseRangeWithReason", () => {
  const IST = "Asia/Calcutta";
  const NOW = Date.parse("2026-11-06T14:02:00+05:30");
  const us = (iso: string) => Date.parse(iso) * 1000;
  const read = (text: string, zone = IST) => parseRangeWithReason(text, zone, NOW);
  const range = (result: PasteResult) =>
    result.ok ? [result.startUs, result.endUs] : [result.reason, result.fragment];

  it.each([
    [
      "en dash",
      "2026-11-04 13:47:03 – 2026-11-06 14:02:03",
      "2026-11-04T13:47:03+05:30",
      "2026-11-06T14:02:03+05:30",
    ],
    [
      "to",
      "2026-11-04 13:47:03 to 2026-11-06 14:02:03",
      "2026-11-04T13:47:03+05:30",
      "2026-11-06T14:02:03+05:30",
    ],
    [
      "spanning days label",
      "Nov 4, 13:47 – Nov 6, 13:47",
      "2026-11-04T13:47:00+05:30",
      "2026-11-06T13:47:00+05:30",
    ],
    [
      "label with seconds",
      "Nov 4, 13:47:03 – Nov 6, 14:02:03",
      "2026-11-04T13:47:03+05:30",
      "2026-11-06T14:02:03+05:30",
    ],
    [
      "same-day label",
      "Nov 4, 13:47 – 15:52",
      "2026-11-04T13:47:00+05:30",
      "2026-11-04T15:52:00+05:30",
    ],
    ["whole days", "Nov 4 – 6", "2026-11-04T00:00:00+05:30", "2026-11-06T23:59:59+05:30"],
    [
      "whole days across months",
      "Oct 30 – Nov 2",
      "2026-10-30T00:00:00+05:30",
      "2026-11-02T23:59:59+05:30",
    ],
    ["one whole day", "Nov 5", "2026-11-05T00:00:00+05:30", "2026-11-05T23:59:59+05:30"],
    [
      "12h with the period on the last end",
      "Nov 4, 1:47 – 3:52 PM",
      "2026-11-04T13:47:00+05:30",
      "2026-11-04T15:52:00+05:30",
    ],
    [
      "12h on both ends",
      "Nov 4, 1:47:03 PM – Nov 6, 2:02:03 PM",
      "2026-11-04T13:47:03+05:30",
      "2026-11-06T14:02:03+05:30",
    ],
    [
      "en-GB order",
      "4 Nov, 13:47 – 6 Nov, 13:47",
      "2026-11-04T13:47:00+05:30",
      "2026-11-06T13:47:00+05:30",
    ],
    ["en-GB whole days", "4–6 Nov", "2026-11-04T00:00:00+05:30", "2026-11-06T23:59:59+05:30"],
    [
      "End year left out across new year",
      "Dec 30, 2025 – Jan 2",
      "2025-12-30T00:00:00+05:30",
      "2026-01-02T23:59:59+05:30",
    ],
    [
      "Start year left out across new year",
      "Dec 30 – Jan 2, 2026",
      "2025-12-30T00:00:00+05:30",
      "2026-01-02T23:59:59+05:30",
    ],
    [
      "cross-year with years",
      "Dec 30, 2025, 23:59 – Jan 2, 2026, 00:10",
      "2025-12-30T23:59:00+05:30",
      "2026-01-02T00:10:00+05:30",
    ],
    [
      "a future date without a year is last year's",
      "Dec 20 – 22",
      "2025-12-20T00:00:00+05:30",
      "2025-12-22T23:59:59+05:30",
    ],
    [
      "the trigger's UTC suffix",
      "Nov 4, 08:17 – Nov 6, 08:17 UTC",
      "2026-11-04T08:17:00Z",
      "2026-11-06T08:17:00Z",
    ],
    [
      "an offset suffix",
      "Nov 4, 13:47 – 15:52 UTC+05:30",
      "2026-11-04T13:47:00+05:30",
      "2026-11-04T15:52:00+05:30",
    ],
    [
      "per-end DST offsets",
      "Nov 1, 01:30 UTC-04:00 – 01:15 UTC-05:00",
      "2026-11-01T01:30:00-04:00",
      "2026-11-01T01:15:00-05:00",
    ],
    [
      "a bare UTC on another format",
      "2026/11/04 10:00:00 - 2026/11/05 10:00:00 UTC",
      "2026-11-04T10:00:00Z",
      "2026-11-05T10:00:00Z",
    ],
  ])("reads %s", (_case, text, start, end) => {
    expect(range(read(text))).toEqual([us(start), us(end)]);
  });

  it("names the format and whether the picker's zone was assumed", () => {
    expect(read("Nov 4, 13:47 – 15:52")).toMatchObject({ format: "label", zoneAssumed: true });
    expect(read("Nov 4, 08:17 – Nov 6, 08:17 UTC")).toMatchObject({ zoneAssumed: false });
    expect(read('{"start_date":1721557986000000,"end_date":1721565186000000}')).toMatchObject({
      format: "copied",
      zoneAssumed: false,
    });
    expect(read("1721557986 - 1721565186")).toMatchObject({ format: "epoch", epochUnit: "s" });
  });

  it("floors a sub-second start and ceils a sub-second end, and says so", () => {
    const result = read("Nov 4, 2026 13:47:03.250 - Nov 4, 2026 13:48:03.250");
    expect(range(result)).toEqual([
      us("2026-11-04T13:47:03+05:30"),
      us("2026-11-04T13:48:04+05:30"),
    ]);
    expect(result).toMatchObject({ format: "log", endRoundedUp: true });
  });

  it("returns a single value with no end", () => {
    expect(read("2026-11-04 13:47:03")).toMatchObject({
      ok: true,
      startUs: us("2026-11-04T13:47:03+05:30"),
      endUs: null,
    });
    expect(read("Nov 5, 13:47")).toMatchObject({
      startUs: us("2026-11-05T13:47:00+05:30"),
      endUs: null,
    });
  });

  it.each(["Mar 10 – Mar 5, 2026", "Mar 10, 2026 – Mar 5"])(
    "keeps the shared year for a reversed label %s, so it reads as end before start",
    (text) => {
      expect(range(read(text))).toEqual([
        us("2026-03-10T00:00:00+05:30"),
        us("2026-03-05T23:59:59+05:30"),
      ]);
    },
  );

  it.each([
    ["Nov 20 – Feb 3", "2025-11-20T00:00:00+05:30", "2026-02-03T23:59:59+05:30"],
    ["Dec 20 – Jan 3", "2025-12-20T00:00:00+05:30", "2026-01-03T23:59:59+05:30"],
    ["Mar 10 – Feb 5", "2026-03-10T00:00:00+05:30", "2027-02-05T23:59:59+05:30"],
  ])(
    "rolls a yearless %s End that is earlier than Start into the next year, a future start moving both back",
    (text, start, end) => {
      expect(range(read(text))).toEqual([us(start), us(end)]);
    },
  );

  it("keeps one shared year when only Start gives a year and the pair is not December to January", () => {
    expect(range(read("Nov 20, 2025 – Feb 3"))).toEqual([
      us("2025-11-20T00:00:00+05:30"),
      us("2025-02-03T23:59:59+05:30"),
    ]);
  });

  it("pastes the trigger's own label back to the same instants", () => {
    const start = us("2026-11-04T13:47:03+05:30");
    const end = us("2026-11-06T14:02:03+05:30");
    expect(range(read("Nov 4, 13:47:03 – Nov 6, 14:02:03"))).toEqual([start, end]);
  });

  it.each([
    ["empty", "   ", "empty"],
    ["no date", "hello there", "no-date"],
    ["a part that does not exist", "2026-13-01", "invalid-part"],
    ["a shortened label", "2d 15m", "no-date"],
    ["one side with an offset", "2026-11-04T10:00:00Z - 2026-11-05 10:00", "mixed-offset"],
  ])("says why it could not read %s", (_case, text, reason) => {
    expect(read(text)).toMatchObject({ ok: false, reason });
  });

  it("cuts a long fragment to 40 characters", () => {
    const result = read("x".repeat(60));
    expect(result.ok ? "" : result.fragment).toHaveLength(40);
  });
});

describe("parseRangeInput", () => {
  // Saturday 2026-11-07 10:00 in Asia/Calcutta.
  const NOW = Date.parse("2026-11-07T04:30:00Z");
  const IST = "Asia/Calcutta";
  const us = (iso: string) => Date.parse(iso) * 1000;
  const ctx = (extra: Partial<RangeInputContext> = {}): RangeInputContext => ({
    zone: IST,
    nowMs: NOW,
    calendarPresets: true,
    ...extra,
  });
  const read = (text: string, extra: Partial<RangeInputContext> = {}): RangeInputResult =>
    parseRangeInput(text, ctx(extra));
  const kindOf = (result: RangeInputResult) => (result.ok ? result.kind : result.reason);
  const germanLabels: Record<string, string> = {
    "common.today": "Heute",
    "common.yesterday": "Gestern",
    "common.thisWeek": "Diese Woche",
    "common.lastWeek": "Letzte Woche",
    "common.rangeParseTo": "bis",
    "common.rangeParseLast": "letzte",
    "common.rangeParsePast": "vergangene",
  };
  // Plural forms the way vue-i18n picks them: one, else other.
  const germanPast: Record<string, [string, string]> = {
    "common.pastMinute": ["Letzte Minute", "Letzte {count} Minuten"],
    "common.pastHour": ["Letzte Stunde", "Letzte {count} Stunden"],
  };
  const germanT = (key: string, named?: Record<string, unknown>) => {
    const forms = germanPast[key];
    if (forms) {
      const count = Number(named?.count ?? 1);
      return (count === 1 ? forms[0] : forms[1]).replace("{count}", String(count));
    }
    return germanLabels[key] ?? key;
  };

  describe("normalisation", () => {
    it.each([
      ["  15m  ", 15, "m"],
      ["\u0661\u0665m", 15, "m"],
      ["\u06f2h", 2, "h"],
      ["\u200f15m\u200e", 15, "m"],
    ])("reads %j as a relative window", (text, value, unit) => {
      expect(read(text)).toMatchObject({ ok: true, kind: "relative", value, unit });
    });

    it("turns the Arabic comma and thin spaces into plain ones", () => {
      expect(read("Nov 4\u060c 13:47\u2009-\u202f15:52")).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-04T08:17:00Z"),
        endUs: us("2026-11-04T10:22:00Z"),
      });
    });

    it("reads the localized “to” as a range separator", () => {
      expect(read("Nov 4, 13:47 bis 15:52", { t: germanT, locale: "de-DE" })).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-04T08:17:00Z"),
      });
    });
  });

  describe("rule 1, relative", () => {
    it.each([
      ["15m", 15, "m"],
      ["15 min", 15, "m"],
      ["last 15 minutes", 15, "m"],
      ["past 15m", 15, "m"],
      ["-15m", 15, "m"],
      ["now-15m", 15, "m"],
      ["90m", 90, "m"],
      ["30s", 30, "s"],
      ["6h", 6, "h"],
      ["2d", 2, "d"],
      ["1w", 1, "w"],
      ["3M", 3, "M"],
      ["3 months", 3, "M"],
      ["15 MIN", 15, "m"],
      ["Past 15 Minutes", 15, "m"],
    ])("reads %j", (text, value, unit) => {
      expect(read(text)).toEqual({ ok: true, kind: "relative", value, unit });
    });

    it("keeps the unit letter's case: m is minutes and M is months", () => {
      expect(read("15m")).toMatchObject({ unit: "m" });
      expect(read("15M")).toMatchObject({ unit: "M" });
    });

    it("has no year unit", () => {
      expect(read("1y").ok).toBe(false);
    });

    it("reads the picker's own labels in the current language", () => {
      expect(read("Letzte 15 Minuten", { t: germanT, locale: "de-DE" })).toEqual({
        ok: true,
        kind: "relative",
        value: 15,
        unit: "m",
      });
      expect(read("letzte 2 stunden", { t: germanT, locale: "de-DE" })).toMatchObject({
        value: 2,
        unit: "h",
      });
      expect(read("letzte 4h", { t: germanT, locale: "de-DE" })).toMatchObject({
        value: 4,
        unit: "h",
      });
    });

    it("refuses relative text on a dates-only picker", () => {
      expect(kindOf(read("15m", { disableRelative: true }))).toBe("not-allowed");
      expect(kindOf(read("15m", { hideRelativeTime: true }))).toBe("not-allowed");
    });

    it("drops the seconds unit where seconds are hidden", () => {
      expect(read("30s", { hideSeconds: true }).ok).toBe(false);
      expect(read("30m", { hideSeconds: true }).ok).toBe(true);
    });

    it("refuses a zero amount and caps a huge one at about ten years", () => {
      expect(kindOf(read("0m"))).toBe("invalid-part");
      expect(read("40000000000000000000m")).toMatchObject({ value: 5_256_000, unit: "m" });
    });
  });

  describe("query-range limit, duration based", () => {
    it("keeps a typed window within the limit as typed", () => {
      expect(read("90m", { queryRangeRestrictionInHour: 2 })).toEqual({
        ok: true,
        kind: "relative",
        value: 90,
        unit: "m",
      });
    });

    it.each([
      ["30d", 168, { value: 7, unit: "d" }],
      ["2d", 36, { value: 36, unit: "h" }],
      ["2w", 168, { value: 1, unit: "w" }],
      ["90m", 1, { value: 60, unit: "m" }],
      ["3h", 2.5, { value: 150, unit: "m" }],
    ])("clamps %j on a %sh limit to the largest whole period", (text, limit, expected) => {
      const result = read(text, { queryRangeRestrictionInHour: limit });
      expect(result).toMatchObject({ ok: true, kind: "relative", ...expected });
      expect(result.ok && result.kind === "relative" && result.typed).toBeTruthy();
    });
  });

  describe("rule 2, calendar", () => {
    it.each([
      ["today", "calendar:day:0"],
      ["Yesterday", "calendar:day:-1"],
      ["this week", "calendar:week:0"],
      ["last week", "calendar:week:-1"],
      ["this month", "calendar:month:0"],
      ["last month", "calendar:month:-1"],
      ["this quarter", "calendar:quarter:0"],
      ["last quarter", "calendar:quarter:-1"],
      ["this year", "calendar:year:0"],
      ["last year", "calendar:year:-1"],
    ])("reads %j as %s", (text, token) => {
      expect(read(text)).toEqual({ ok: true, kind: "calendar", token });
    });

    it("reads the localized period labels", () => {
      expect(read("Gestern", { t: germanT, locale: "de-DE" })).toEqual({
        ok: true,
        kind: "calendar",
        token: "calendar:day:-1",
      });
      expect(read("letzte woche", { t: germanT, locale: "de-DE" })).toMatchObject({
        token: "calendar:week:-1",
      });
    });

    it("needs calendar presets", () => {
      expect(read("today", { calendarPresets: false }).ok).toBe(false);
      expect(read("yesterday 09:00 - 17:00", { calendarPresets: false }).ok).toBe(false);
    });

    it("reads a weekday as that whole day, the most recent one", () => {
      expect(read("thursday")).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-04T18:30:00Z"),
        endUs: us("2026-11-05T18:30:00Z"),
      });
      expect(read("Saturday")).toMatchObject({ startUs: us("2026-11-06T18:30:00Z") });
    });

    it("reads a day period with hours", () => {
      expect(read("yesterday 09:00 - 17:00")).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-06T03:30:00Z"),
        endUs: us("2026-11-06T11:30:00Z"),
      });
      expect(read("today 2 PM to 4 PM")).toMatchObject({
        startUs: us("2026-11-07T08:30:00Z"),
        endUs: us("2026-11-07T10:30:00Z"),
      });
    });
  });

  describe("rule 3, absolute", () => {
    it("reads everything the paste grammar reads", () => {
      expect(read("Nov 4, 13:47 – 15:52")).toMatchObject({
        ok: true,
        kind: "absolute",
        format: "label",
        zoneAssumed: true,
      });
      expect(read("2026/11/04 13:00:00 - 2026/11/04 15:00:00")).toMatchObject({
        kind: "absolute",
        format: "slashed",
      });
      expect(read("1762244223 - 1762251423")).toMatchObject({ kind: "absolute", format: "epoch" });
    });

    it("reads the ISO interval Copy writes, back to the same instants", () => {
      expect(read("2026-11-04T13:47:00+05:30/2026-11-04T15:52:00+05:30")).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-04T08:17:00Z"),
        endUs: us("2026-11-04T10:22:00Z"),
        zoneAssumed: false,
      });
    });

    it("reads month names in the picker's language", () => {
      expect(read("4. Nov. 2026, 13:00 - 15:00", { locale: "de-DE", t: germanT })).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-04T07:30:00Z"),
      });
      expect(read("4 octobre 2026, 13:00 - 15:00", { locale: "fr-FR" })).toMatchObject({
        ok: true,
        startUs: us("2026-10-04T07:30:00Z"),
      });
    });

    it("reads an hour with am or pm and no minutes, on today when no date is given", () => {
      expect(read("2 PM - 4 PM")).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-07T08:30:00Z"),
        endUs: us("2026-11-07T10:30:00Z"),
      });
    });

    it("runs two bare times past midnight when the end is earlier", () => {
      expect(read("22:00 - 02:00")).toMatchObject({
        startUs: us("2026-11-07T16:30:00Z"),
        endUs: us("2026-11-07T20:30:00Z"),
      });
    });
  });

  describe("rule 4, zones in text", () => {
    it("reads offsets, Z and UTC", () => {
      expect(read("2026-11-04T08:17:03Z - 2026-11-04T09:17:03Z")).toMatchObject({
        startUs: us("2026-11-04T08:17:03Z"),
        zoneAssumed: false,
      });
      expect(read("Nov 4, 13:00 - 15:00 UTC")).toMatchObject({
        startUs: us("2026-11-04T13:00:00Z"),
        zoneAssumed: false,
      });
    });

    it("reads an IANA zone name at the end", () => {
      expect(read("Nov 4, 13:00 - 15:00 America/New_York")).toMatchObject({
        ok: true,
        startUs: us("2026-11-04T18:00:00Z"),
        zoneAssumed: false,
        namedZone: { zone: "America/New_York" },
      });
    });

    it.each([
      ["IST", "Asia/Kolkata", "2026-11-04T07:30:00Z"],
      ["CST", "America/Chicago", "2026-11-04T19:00:00Z"],
      ["PST", "America/Los_Angeles", "2026-11-04T21:00:00Z"],
      ["CET", "Europe/Paris", "2026-11-04T12:00:00Z"],
      ["JST", "Asia/Tokyo", "2026-11-04T04:00:00Z"],
    ])("reads the abbreviation %s as %s", (abbr, zone, start) => {
      expect(read(`Nov 4, 13:00 - 15:00 ${abbr}`)).toMatchObject({
        ok: true,
        startUs: us(start),
        namedZone: { zone, abbr },
      });
    });

    it("reads two 12-hour times in a named zone on today", () => {
      expect(read("2:15 PM to 2:40 PM IST", { zone: "UTC" })).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-07T08:45:00Z"),
        endUs: us("2026-11-07T09:10:00Z"),
        namedZone: { zone: "Asia/Kolkata", abbr: "IST" },
      });
    });
  });

  describe("zones after a day word", () => {
    it("reads a day period with hours in a named zone", () => {
      expect(read("yesterday 09:00 - 17:00 IST", { zone: "UTC" })).toMatchObject({
        ok: true,
        kind: "absolute",
        startUs: us("2026-11-06T03:30:00Z"),
        endUs: us("2026-11-06T11:30:00Z"),
        zoneAssumed: false,
        namedZone: { zone: "Asia/Kolkata", abbr: "IST" },
      });
    });
  });

  describe("rule 5, one instant", () => {
    it.each([
      ["2026-11-04T08:17:03Z", us("2026-11-04T08:17:03Z")],
      ["1762244223", 1762244223 * 1_000_000],
      ["14:30", us("2026-11-07T09:00:00Z")],
    ])("reads %j as an instant", (text, at) => {
      expect(read(text)).toMatchObject({ ok: true, kind: "instant", startUs: at });
    });
  });

  describe("failures", () => {
    it.each([
      ["", "empty"],
      ["hello there", "no-date"],
      ["2026-02-30 - 2026-03-01", "invalid-part"],
      ["2026-11-04T10:00:00Z - 2026-11-04 12:00:00", "mixed-offset"],
    ])("reports %j as %s", (text, reason) => {
      expect(kindOf(read(text))).toBe(reason);
    });

    it("suggests a keyword within two edits", () => {
      const typo = read("15 minuts");
      expect(typo).toMatchObject({ ok: false, reason: "unknown" });
      expect(typo.ok ? "" : typo.suggestion).toMatch(/^15 minutes?$/);
      expect(read("yesterdy")).toMatchObject({ ok: false, suggestion: "yesterday" });
      expect(read("last weak")).toMatchObject({ ok: false, suggestion: "last week" });
    });

    it("says seconds are not available where they are hidden", () => {
      expect(read("30s", { hideSeconds: true })).toEqual({
        ok: false,
        reason: "no-seconds",
        fragment: "30s",
      });
    });

    it("offers no calendar word as a suggestion without calendar presets", () => {
      expect(read("yesterdy", { calendarPresets: false })).not.toHaveProperty("suggestion");
    });
  });
});

describe("zoneAbbreviation", () => {
  const JAN = Date.parse("2026-01-15T12:00:00Z");
  const JUL = Date.parse("2026-07-15T12:00:00Z");

  it("names daylight time by its own abbreviation where Intl only gives an offset", () => {
    expect(zoneAbbreviation("Europe/Paris", JAN)).toBe("CET");
    expect(zoneAbbreviation("Europe/Paris", JUL)).toBe("CEST");
    expect(zoneAbbreviation("Australia/Sydney", JAN)).toBe("AEDT");
    expect(zoneAbbreviation("Australia/Sydney", JUL)).toBe("AEST");
  });

  it("keeps Intl's own short name and reads India as IST", () => {
    expect(zoneAbbreviation("America/New_York", JUL)).toBe("EDT");
    expect(zoneAbbreviation("Asia/Calcutta", JUL)).toBe("IST");
  });

  it("falls back to the offset for a zone with no abbreviation", () => {
    expect(zoneAbbreviation("Asia/Dhaka", JUL)).toMatch(/^(GMT|UTC)\+0?6/);
  });
});
