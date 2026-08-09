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
  DBM_DEFAULT_PERIOD,
  periodToMinutes,
  rangeFromQuery,
  rangeToQuery,
  useDbmScope,
} from "./useDbmScope";

describe("periodToMinutes", () => {
  it("converts every unit the picker can emit", () => {
    expect(periodToMinutes("15m")).toBe(15);
    expect(periodToMinutes("6h")).toBe(360);
    expect(periodToMinutes("1d")).toBe(1440);
    expect(periodToMinutes("1w")).toBe(10080);
  });

  it("falls back to an hour for anything unusable", () => {
    // A malformed URL param used to become NaN and poison every timestamp.
    expect(periodToMinutes(undefined)).toBe(60);
    expect(periodToMinutes("banana")).toBe(60);
    expect(periodToMinutes("0m")).toBe(60);
  });
});

describe("rangeFromQuery", () => {
  it("reads an absolute range from from/to", () => {
    const range = rangeFromQuery({ from: "1000", to: "2000" });
    expect(range).toEqual({
      type: "absolute",
      relativeTimePeriod: null,
      startTime: 1000,
      endTime: 2000,
    });
  });

  it("reads a relative range from period", () => {
    expect(rangeFromQuery({ period: "6h" }).relativeTimePeriod).toBe("6h");
  });

  it("defaults when the query says nothing", () => {
    const range = rangeFromQuery({});
    expect(range.type).toBe("relative");
    expect(range.relativeTimePeriod).toBe(DBM_DEFAULT_PERIOD);
  });

  it("ignores an inverted absolute pair rather than producing a negative window", () => {
    expect(rangeFromQuery({ from: "2000", to: "1000" }).type).toBe("relative");
  });
});

describe("rangeToQuery", () => {
  it("writes period only for a relative range", () => {
    expect(
      rangeToQuery({ type: "relative", relativeTimePeriod: "30m", startTime: 0, endTime: 0 }),
    ).toEqual({ period: "30m", from: undefined, to: undefined });
  });

  it("writes from/to only for an absolute range", () => {
    expect(
      rangeToQuery({ type: "absolute", relativeTimePeriod: null, startTime: 5, endTime: 9 }),
    ).toEqual({ period: undefined, from: "5", to: "9" });
  });
});

describe("useDbmScope", () => {
  it("produces finite timestamps even from a bogus query", () => {
    const { current, previous } = useDbmScope({ period: "not-a-range" });
    for (const value of [
      current.value.startTime,
      current.value.endTime,
      previous.value.startTime,
      previous.value.endTime,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("makes the previous window immediately precede the current one, same length", () => {
    // The Δ column's correctness depends entirely on this adjacency.
    const { current, previous } = useDbmScope({ period: "30m" });
    expect(previous.value.endTime).toBe(current.value.startTime);
    expect(current.value.endTime - current.value.startTime).toBe(
      previous.value.endTime - previous.value.startTime,
    );
  });

  it("spans the requested number of minutes in microseconds", () => {
    const { current } = useDbmScope({ period: "15m" });
    expect(current.value.endTime - current.value.startTime).toBe(15 * 60_000_000);
  });

  it("keeps both windows pinned to ONE anchor so they cannot drift apart", () => {
    // Recomputing Date.now() per access would let the two windows describe
    // different instants by the duration of the fetch.
    const { current, previous } = useDbmScope({ period: "1h" });
    const firstRead = current.value.endTime;
    expect(current.value.endTime).toBe(firstRead);
    expect(previous.value.endTime).toBe(firstRead - 60 * 60_000_000);
  });

  it("uses an absolute range verbatim, and derives its previous window from its span", () => {
    const start = 1_700_000_000_000_000;
    const end = start + 30 * 60_000_000;
    const { current, previous, rangeMinutes } = useDbmScope({
      from: String(start),
      to: String(end),
    });
    expect(current.value).toEqual({ startTime: start, endTime: end });
    expect(previous.value).toEqual({ startTime: start - 30 * 60_000_000, endTime: start });
    expect(rangeMinutes.value).toBe(30);
  });

  it("adopts a picker payload of either kind", () => {
    const { range, setRange, rangeMinutes } = useDbmScope({ period: "15m" });
    setRange({ startTime: 1, endTime: 2, relativeTimePeriod: "6h" });
    expect(range.value.type).toBe("relative");
    expect(rangeMinutes.value).toBe(360);

    setRange({ startTime: 10, endTime: 10 + 60_000_000, relativeTimePeriod: null });
    expect(range.value.type).toBe("absolute");
    expect(rangeMinutes.value).toBe(1);
  });

  it("ignores a picker payload with no usable bounds rather than producing NaN", () => {
    const { range, setRange } = useDbmScope({ period: "15m" });
    setRange({ startTime: NaN, endTime: NaN, relativeTimePeriod: null });
    expect(range.value.relativeTimePeriod).toBe("15m");
  });

  it("mirrors the range into query params, never writing both forms", () => {
    const { queryParams, setRange } = useDbmScope({ period: "15m" });
    expect(queryParams.value).toEqual({ period: "15m", from: undefined, to: undefined });
    setRange({ startTime: 5, endTime: 9, relativeTimePeriod: null });
    expect(queryParams.value).toEqual({ period: undefined, from: "5", to: "9" });
  });
});
