// Copyright 2023 OpenObserve Inc.
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

// Mock date-fns-tz: toZonedTime passes through the date unchanged
vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date: Date) => date),
}));

// Mock date-fns: format always returns a constant formatted time
vi.mock("date-fns", () => ({
  format: vi.fn(() => "2024-01-15T10:00:00"),
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

// TS = 1705323600000000 microseconds → ms = 1705323600000
// startTime = endTime = new Date(1705323600000)
// dateBin mock returns startTime, so currentTime === endTime → loop runs exactly once
// interval = 60 seconds, intervalMillis = 60000 ms → after first iteration currentTime > endTime
const TS_MICROS = 1705323600000000;
const TS_MS = 1705323600000; // TS_MICROS / 1000

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
});
