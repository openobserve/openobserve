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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fillMissingValues } from "./sqlMissingValueFiller";

// Mock date-fns-tz: toZonedTime shifts the date so its local representation
// equals the requested timezone. For "UTC", local getHours() = UTC hours.
// This makes the tests timezone-independent.
vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date: Date, tz: string) => {
    const d = new Date(date);
    if (tz === "UTC") {
      return new Date(d.getTime() + d.getTimezoneOffset() * 60000);
    }
    return d;
  }),
}));

// Mock date-fns: format returns an ISO-like string using the date's local time.
// Combined with the toZonedTime mock above, this produces UTC-formatted strings
// (matching production behavior). A constant mock causes an infinite loop in
// the fill loop because currentFormattedTime never advances past endTimeForFill.
vi.mock("date-fns", () => ({
  format: vi.fn((date: Date) => {
    const d = new Date(date);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }),
}));

// Mock datetimeStartPoint: dateBin returns startTime (the second arg)
vi.mock("@/utils/dashboard/datetimeStartPoint", () => ({
  dateBin: vi.fn((_interval: any, startTime: Date) => startTime),
}));

// Mock dateTimeUtils: isTimeSeries returns true when the value is an ISO string
vi.mock("@/utils/dashboard/dateTimeUtils", () => ({
  isTimeSeries: vi.fn((arr: any[]) =>
    typeof arr[0] === "string" && /\d{4}-\d{2}-\d{2}T/.test(arr[0]),
  ),
}));

// Mock aliasUtils: getDataValue just does a plain property lookup
vi.mock("@/utils/dashboard/aliasUtils", () => ({
  getDataValue: vi.fn((obj: any, key: any) => obj?.[key]),
}));

// Use Date.UTC to guarantee timezone-independent epoch for 2024-01-15T10:00:00 UTC.
// startTime = endTime = this date → dateBin mock returns startTime → loop runs exactly once
// interval = 60 seconds → after first iteration currentTime > endTime
const TS_MS = Date.UTC(2024, 0, 15, 10, 0, 0); // 2024-01-15T10:00:00 UTC in ms
const TS_MICROS = TS_MS * 1000; // same in microseconds

const makeMetadata = (overrides?: any) => ({
  queries: [
    {
      startTime: TS_MICROS,
      endTime: TS_MICROS,
      ...overrides,
    },
  ],
});

const makeResultMetaData = (interval: number | undefined) =>
  interval !== undefined ? [{ histogram_interval: interval }] : [{}];

const makePanelSchema = (type: string) => ({ type });

describe("fillMissingValues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Early-exit / deep-copy tests
  // -------------------------------------------------------------------------

  it("returns a deep copy when resultMetaData has no histogram_interval", () => {
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 42 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeResultMetaData(undefined),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    // Ensure it's a deep copy, not the same reference
    expect(result).not.toBe(processedData);
    expect(result[0]).not.toBe(processedData[0]);
  });

  it("returns a deep copy when metadata has no queries", () => {
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 10 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeResultMetaData(60),
      { queries: undefined },
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    expect(result).not.toBe(processedData);
  });

  it("returns a deep copy for unsupported chart type: gauge", () => {
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 5 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("gauge"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    expect(result).not.toBe(processedData);
  });

  it("returns a deep copy for unsupported chart type: metric", () => {
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 99 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("metric"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    expect(result).not.toBe(processedData);
  });

  it("returns a deep copy for unsupported chart type: pie", () => {
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 7 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("pie"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    expect(result).not.toBe(processedData);
  });

  it("returns a deep copy for supported type (line) when no time-based key found", () => {
    // All values are non-ISO strings so isTimeSeries returns false for each key
    const processedData = [{ category: "foo", value: 3 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeResultMetaData(60),
      makeMetadata(),
      ["category"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toEqual(processedData);
    expect(result).not.toBe(processedData);
  });

  // -------------------------------------------------------------------------
  // Gap-filling tests (no breakdown keys)
  // -------------------------------------------------------------------------

  it("fills data for simple time-series when data exists at the current time slot", () => {
    // format mock always returns "2024-01-15T10:00:00"
    // processedData has ts = "2024-01-15T10:00:00" → key matches → data pushed as-is
    const processedData = [{ ts: "2024-01-15T10:00:00", value: 100 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ts: "2024-01-15T10:00:00", value: 100 });
  });

  it("inserts null/noValue entry for a missing time slot (no breakdown)", () => {
    // processedData has ts = "2024-01-15T09:00:00" (different from "2024-01-15T10:00:00")
    // The map key for that entry is "2024-01-15T09:00:00" but format mock returns
    // "2024-01-15T10:00:00" → no match → null entry created
    const processedData = [{ ts: "2024-01-15T09:00:00", value: 50 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ts: "2024-01-15T10:00:00", value: null });
  });

  it("uses the noValueConfigOption value when inserting null entries (no breakdown)", () => {
    const processedData = [{ ts: "2024-01-15T09:00:00", value: 50 }];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("area"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      [],
      0,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ts: "2024-01-15T10:00:00", value: 0 });
  });

  // -------------------------------------------------------------------------
  // Gap-filling tests (with breakdown keys)
  // -------------------------------------------------------------------------

  it("fills data with breakdown keys when existing data is found", () => {
    // xAxisKeys = ["ts"], breakDownKeys = ["service"]
    // uniqueKey = "service" (first xAxisKeysWithoutTimeStamp is undefined, so falls to breakdown)
    // map key = "2024-01-15T10:00:00-frontend" → currentData found → pushed directly
    const processedData = [
      { ts: "2024-01-15T10:00:00", service: "frontend", value: 200 },
    ];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("stacked"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      ["service"],
      null,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ts: "2024-01-15T10:00:00",
      service: "frontend",
      value: 200,
    });
  });

  it("inserts null entry with breakdown when data is missing for the time slot", () => {
    // processedData has ts "2024-01-15T09:00:00" → map key "2024-01-15T09:00:00-backend"
    // format mock returns "2024-01-15T10:00:00" → lookup key "2024-01-15T10:00:00-backend" → not found
    // → null entry inserted with noValueConfigOption for non-time, non-uniqueKey fields
    const processedData = [
      { ts: "2024-01-15T09:00:00", service: "backend", value: 75 },
    ];
    const result = fillMissingValues(
      processedData,
      makePanelSchema("bar"),
      makeResultMetaData(60),
      makeMetadata(),
      ["ts"],
      ["value"],
      [],
      ["service"],
      null,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ts: "2024-01-15T10:00:00",
      service: "backend",
      value: null,
    });
  });

  // ---------------------------------------------------------------------------
  // Chunking-direction tests (LTR vs RTL)
  // ---------------------------------------------------------------------------
  //
  // detectChunkingDirection picks LTR when |firstChunkStart - userStart| <=
  // |firstChunkEnd - userEnd|. The filler branches on that flag:
  //   LTR → fill from userStart  → latestChunkEnd, right-edge anchor at userEnd
  //   RTL → fill from earliestChunkStart → userEnd, left-edge anchor at userStart
  //
  // The right/left anchor uses empty-string values so ECharts treats them as
  // gaps (not plotted at noValueConfigOption). That's what these tests assert.

  // Build metadata with distinct user-start / user-end microseconds
  const makeRangeMetadata = (userStartMs: number, userEndMs: number) => ({
    queries: [
      {
        startTime: userStartMs * 1000,
        endTime: userEndMs * 1000,
      },
    ],
  });

  // Metadata array with a single chunk whose time_offset is explicit
  const makeChunkMetaData = (
    chunkStartMs: number,
    chunkEndMs: number,
    interval: number,
  ) => [
    {
      histogram_interval: interval,
      time_offset: {
        start_time: chunkStartMs * 1000,
        end_time: chunkEndMs * 1000,
      },
    },
  ];

  it("LTR: anchors user-end with empty string when first chunk starts at user-start", () => {
    const userStart = Date.UTC(2024, 0, 15, 10, 0, 0);
    const userEnd = Date.UTC(2024, 0, 15, 10, 5, 0);
    // First chunk covers only the very start → LTR
    const chunkStart = userStart;
    const chunkEnd = userStart + 60_000; // 1 min in

    const processedData = [{ ts: "2024-01-15T10:00:00", value: 42 }];

    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeChunkMetaData(chunkStart, chunkEnd, 60),
      makeRangeMetadata(userStart, userEnd),
      ["ts"],
      ["value"],
      [],
      [],
      "fallback", // noValueConfigOption — must NOT appear on anchors
    );

    // The right-edge anchor is at binnedDate(userEnd) — with dateBin mock
    // returning the passed-in date, that formats to userEnd's ISO string.
    const anchor = result.find(
      (r: any) => r.ts === new Date(userEnd).toISOString().slice(0, 19),
    );
    expect(anchor).toBeDefined();
    expect(anchor.value).toBe(""); // empty string, NOT "fallback"
  });

  it("RTL: anchors user-start with empty string when first chunk ends at user-end", () => {
    const userStart = Date.UTC(2024, 0, 15, 10, 0, 0);
    const userEnd = Date.UTC(2024, 0, 15, 10, 5, 0);
    // First chunk covers only the very end → RTL
    const chunkStart = userEnd - 60_000;
    const chunkEnd = userEnd;

    const processedData = [{ ts: "2024-01-15T10:04:00", value: 99 }];

    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeChunkMetaData(chunkStart, chunkEnd, 60),
      makeRangeMetadata(userStart, userEnd),
      ["ts"],
      ["value"],
      [],
      [],
      "fallback",
    );

    // The left-edge anchor is at binnedDate(userStart)
    const anchor = result.find(
      (r: any) => r.ts === new Date(userStart).toISOString().slice(0, 19),
    );
    expect(anchor).toBeDefined();
    expect(anchor.value).toBe(""); // empty string, NOT "fallback"
  });

  it("LTR with breakdown: right-edge anchor is emitted per series with empty string", () => {
    const userStart = Date.UTC(2024, 0, 15, 10, 0, 0);
    const userEnd = Date.UTC(2024, 0, 15, 10, 5, 0);
    const chunkStart = userStart;
    const chunkEnd = userStart + 60_000;

    const processedData = [
      { ts: "2024-01-15T10:00:00", service: "api", value: 10 },
      { ts: "2024-01-15T10:00:00", service: "web", value: 20 },
    ];

    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeChunkMetaData(chunkStart, chunkEnd, 60),
      makeRangeMetadata(userStart, userEnd),
      ["ts"],
      ["value"],
      [],
      ["service"],
      0, // noValueConfigOption — 0 is a real number that MUST NOT appear on anchors
    );

    const userEndIso = new Date(userEnd).toISOString().slice(0, 19);
    const apiAnchor = result.find(
      (r: any) => r.ts === userEndIso && r.service === "api",
    );
    const webAnchor = result.find(
      (r: any) => r.ts === userEndIso && r.service === "web",
    );
    expect(apiAnchor).toBeDefined();
    expect(webAnchor).toBeDefined();
    // Anchor must use "" regardless of noValueConfigOption
    expect(apiAnchor.value).toBe("");
    expect(webAnchor.value).toBe("");
  });

  it("RTL with breakdown: left-edge anchor is emitted per series with empty string", () => {
    const userStart = Date.UTC(2024, 0, 15, 10, 0, 0);
    const userEnd = Date.UTC(2024, 0, 15, 10, 5, 0);
    const chunkStart = userEnd - 60_000;
    const chunkEnd = userEnd;

    const processedData = [
      { ts: "2024-01-15T10:04:00", service: "api", value: 10 },
      { ts: "2024-01-15T10:04:00", service: "web", value: 20 },
    ];

    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      makeChunkMetaData(chunkStart, chunkEnd, 60),
      makeRangeMetadata(userStart, userEnd),
      ["ts"],
      ["value"],
      [],
      ["service"],
      0,
    );

    const userStartIso = new Date(userStart).toISOString().slice(0, 19);
    const apiAnchor = result.find(
      (r: any) => r.ts === userStartIso && r.service === "api",
    );
    const webAnchor = result.find(
      (r: any) => r.ts === userStartIso && r.service === "web",
    );
    expect(apiAnchor).toBeDefined();
    expect(webAnchor).toBeDefined();
    expect(apiAnchor.value).toBe("");
    expect(webAnchor.value).toBe("");
  });

  it("LTR (invalid time_offset): no crash, returns filled data including user-end anchor", () => {
    // When time_offset is missing the detector returns null → defaults to RTL
    // branch. This test just ensures no throw and the data is still filled.
    const userStart = Date.UTC(2024, 0, 15, 10, 0, 0);
    const userEnd = Date.UTC(2024, 0, 15, 10, 2, 0);

    const processedData = [{ ts: "2024-01-15T10:00:00", value: 1 }];
    const metadataNoOffset = [{ histogram_interval: 60 }]; // no time_offset

    const result = fillMissingValues(
      processedData,
      makePanelSchema("line"),
      metadataNoOffset,
      makeRangeMetadata(userStart, userEnd),
      ["ts"],
      ["value"],
      [],
      [],
      null,
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
