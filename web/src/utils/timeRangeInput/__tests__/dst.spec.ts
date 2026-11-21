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

import { EN_US_TIME_RANGE_PACK, parseTimeRangeInput } from "../index";
import type { TimeRangeParseResult, TimeRangeReading } from "../types";
import { baseContext, isoUs } from "./helpers";

function parse(text: string, now: string, zone: string): TimeRangeParseResult {
  return parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, text, now, zone));
}

function valid(r: TimeRangeParseResult): TimeRangeReading {
  if (r.state !== "valid") throw new Error(JSON.stringify(r));
  return r.reading;
}

function instants(r: TimeRangeParseResult): number[][] {
  if (r.state !== "ambiguous") throw new Error(JSON.stringify(r));
  return r.readings.map((x) => [x.startUs, x.endUs]);
}

const windowAt = (r: TimeRangeReading): number | undefined =>
  r.notes.find((n) => n.kind === "instant-window")?.instantUs;

describe("DST gaps and folds", () => {
  const NOW = "2026-11-17T12:00:00Z";

  it.each([
    ["2026-03-29T02:30:00", "Europe/Berlin", "2026-03-29T03:30:00+02:00"],
    ["2026-03-08T02:30:00", "America/New_York", "2026-03-08T03:30:00-04:00"],
    ["2026-10-04T02:30:00", "Australia/Sydney", "2026-10-04T03:30:00+11:00"],
    ["2026-10-04T02:15:00", "Australia/Lord_Howe", "2026-10-04T02:45:00+11:00"],
  ])("shifts the gap stamp %s in %s forward with a note", (text, zone, expected) => {
    const r = valid(parse(text, NOW, zone));
    expect(windowAt(r)).toBe(isoUs(expected));
    expect(r.notes.some((n) => n.kind === "dst-gap")).toBe(true);
  });

  it.each([
    [
      "2026-10-25T02:30:00",
      "Europe/Berlin",
      ["2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00+01:00"],
    ],
    [
      "2026-11-01T01:30:00",
      "America/New_York",
      ["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"],
    ],
    [
      "2026-04-05T02:30:00",
      "Australia/Sydney",
      ["2026-04-05T02:30:00+11:00", "2026-04-05T02:30:00+10:00"],
    ],
    [
      "2026-04-05T01:45:00",
      "Australia/Lord_Howe",
      ["2026-04-05T01:45:00+11:00", "2026-04-05T01:45:00+10:30"],
    ],
  ])("asks for the repeated hour %s in %s", (text, zone, expected) => {
    const r = parse(text, NOW, zone);
    expect(r.state === "ambiguous" && r.reason).toBe("repeated-hour");
    if (r.state === "ambiguous") expect(r.readings.map(windowAt)).toEqual(expected.map(isoUs));
  });

  it("rejects the skipped Apia day and reads a range across it", () => {
    expect(parse("2011-12-30", NOW, "Pacific/Apia").state).toBe("invalid");
    const r = valid(parse("2011-12-29 to 2011-12-31", NOW, "Pacific/Apia"));
    expect([r.startUs, r.endUs]).toEqual([
      isoUs("2011-12-29T00:00:00-10:00"),
      isoUs("2012-01-01T00:00:00+14:00"),
    ]);
  });

  it("offers the ordered pairs of a range with both ends in a fold", () => {
    const r = parse("2026-10-25 02:10 to 02:50", NOW, "Europe/Berlin");
    expect(instants(r)).toEqual([
      [isoUs("2026-10-25T02:10:00+02:00"), isoUs("2026-10-25T02:50:00+02:00")],
      [isoUs("2026-10-25T02:10:00+02:00"), isoUs("2026-10-25T02:50:00+01:00")],
      [isoUs("2026-10-25T02:10:00+01:00"), isoUs("2026-10-25T02:50:00+01:00")],
    ]);
  });

  it("asks when a rolling day lands in the repeated hour", () => {
    const r = parse("last 1 day", "2026-10-26T01:30:00Z", "Europe/Berlin");
    expect(instants(r).map((x) => x[0])).toEqual([
      isoUs("2026-10-25T02:30:00+02:00"),
      isoUs("2026-10-25T02:30:00+01:00"),
    ]);
  });

  it.each(["1d", "now-1d", "?period=1d", "last 1 day"])(
    "asks repeated-hour when %s starts in the fold",
    (text) => {
      const r = parse(text, "2026-11-02T06:30:00Z", "America/New_York");
      expect(r.state === "ambiguous" && r.reason, JSON.stringify(r)).toBe("repeated-hour");
      expect(instants(r).map((x) => x[0])).toEqual([
        isoUs("2026-11-01T01:30:00-04:00"),
        isoUs("2026-11-01T01:30:00-05:00"),
      ]);
    },
  );

  it("asks zone-abbreviation for a stamp that ends in IST", () => {
    const r = parse("2026-11-16 09:00:00 IST", NOW, "UTC");
    expect(r.state === "ambiguous" && r.reason).toBe("zone-abbreviation");
    expect(parse("2026-11-16 09:00:00 IST request failed", NOW, "UTC").state).toBe("invalid");
  });

  it("resolves a typed IANA zone that differs from the picker zone", () => {
    const r = valid(parse("2026-03-29 02:30 Europe/Berlin", NOW, "America/New_York"));
    expect(windowAt(r)).toBe(isoUs("2026-03-29T03:30:00+02:00"));
  });

  it.each([
    ["2026-03-29T12:00:00Z", "Europe/Berlin"],
    ["2026-10-25T12:00:00Z", "Europe/Berlin"],
    ["2026-03-08T18:00:00Z", "America/New_York"],
    ["2026-11-01T18:00:00Z", "America/New_York"],
  ])("reads the chain 1d1h at %s in %s as exactly 25 elapsed hours", (now, zone) => {
    const r = valid(parse("1d1h", now, zone));
    expect(r.endUs - r.startUs).toBe(25 * 3_600_000_000);
    expect(r.rolling).toEqual({ value: 25, unit: "h" });
    expect(r.notes).toContainEqual({ kind: "elapsed-chain", totalUs: 25 * 3_600_000_000 });
  });

  it("subtracts a single day in the civil calendar across a DST change", () => {
    const r = valid(parse("last 1 day", "2026-03-09T04:00:00Z", "America/New_York"));
    expect(r.endUs - r.startUs).toBe(23 * 3_600_000_000);
  });
});
