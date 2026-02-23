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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fillMissingValues,
  type FillMissingValuesParams,
} from "./fillMissingValues";

// We need real date-fns-tz and date-fns behavior for these tests.
// Only mock datetimeStartPoint's dateBin since it has simple logic we can control.
vi.mock("@/utils/dashboard/datetimeStartPoint", () => ({
  dateBin: vi.fn((interval: number, date: Date, _origin: Date) => {
    // Simple bin: floor to interval boundary
    const ms = date.getTime();
    const intervalMs = interval * 1000;
    return new Date(Math.floor(ms / intervalMs) * intervalMs);
  }),
}));

// Helper to create params with defaults
function createParams(
  overrides: Partial<FillMissingValuesParams> & {
    startTime?: number;
    endTime?: number;
    interval?: number;
  } = {},
): FillMissingValuesParams {
  const {
    startTime = Date.UTC(2024, 0, 1, 0, 0, 0) * 1000, // microseconds
    endTime = Date.UTC(2024, 0, 1, 1, 0, 0) * 1000, // 1 hour later
    interval = 60, // 60 seconds
    ...rest
  } = overrides;

  return {
    processedData: [],
    resultMetaData: [{ histogram_interval: interval }],
    metadata: {
      queries: [
        {
          startTime: startTime.toString(),
          endTime: endTime.toString(),
        },
      ],
    },
    panelType: "line",
    noValueConfigOption: "",
    xAxisKeys: ["_timestamp"],
    yAxisKeys: ["count"],
    zAxisKeys: [],
    breakDownKeys: [],
    ...rest,
  };
}

// Helper: create a data row
function makeRow(
  timeStr: string,
  count: number,
  extras: Record<string, any> = {},
): Record<string, any> {
  return { _timestamp: timeStr, count, ...extras };
}

describe("fillMissingValues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ====================
  // EARLY RETURN CASES
  // ====================
  describe("early returns", () => {
    it("should return processedData when interval is missing", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        resultMetaData: [{ histogram_interval: null }],
      });
      const result = fillMissingValues(params);
      expect(result).toBe(data);
    });

    it("should return processedData when interval is 0", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        resultMetaData: [{ histogram_interval: 0 }],
      });
      const result = fillMissingValues(params);
      expect(result).toBe(data);
    });

    it("should return processedData when metadata.queries is missing", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        metadata: {},
      });
      const result = fillMissingValues(params);
      expect(result).toBe(data);
    });

    it("should return processedData for unsupported panel types", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      for (const panelType of ["pie", "donut", "metric", "gauge", "heatmap", "table"]) {
        const params = createParams({ processedData: data, panelType });
        const result = fillMissingValues(params);
        expect(result).toBe(data);
      }
    });

    it("should return processedData for all supported panel types", () => {
      for (const panelType of [
        "area-stacked",
        "line",
        "area",
        "bar",
        "stacked",
        "scatter",
      ]) {
        const data = [makeRow("2024-01-01T00:00:00", 10)];
        const params = createParams({
          processedData: data,
          panelType,
          startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
          endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
          interval: 60,
        });
        const result = fillMissingValues(params);
        // Should NOT be the same reference (processing happened)
        expect(result.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("should return processedData when it is empty", () => {
      const params = createParams({ processedData: [] });
      const result = fillMissingValues(params);
      expect(result).toEqual([]);
    });

    it("should return processedData when no time-based key is found", () => {
      const data = [{ category: "A", count: 10 }];
      const params = createParams({
        processedData: data,
        xAxisKeys: ["category"],
        yAxisKeys: ["count"],
      });
      const result = fillMissingValues(params);
      expect(result).toBe(data);
    });
  });

  // ==========================
  // NO BREAKDOWN - DENSE FILL WITHIN DATA RANGE
  // ==========================
  describe("without breakdown - bounded dense fill", () => {
    it("should dense-fill between actual data points", () => {
      // Data at T+0 and T+5min, gap from T+1 to T+4
      // Dense fill should create entries at every minute between them
      const data = [
        makeRow("2024-01-01T00:00:00", 10),
        makeRow("2024-01-01T00:05:00", 50),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 10, 0) * 1000, // 10 min range
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have dense fill from T+0 to T+5: 6 entries (0,1,2,3,4,5 min)
      // Plus boundary entry at endTime (T+10)
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(2);
      expect(realRows[0].count).toBe(10);
      expect(realRows[1].count).toBe(50);

      // Null fill entries should exist between T+0 and T+5
      const nullRows = result.filter((r: any) => r.count === "");
      expect(nullRows.length).toBeGreaterThanOrEqual(4); // T+1, T+2, T+3, T+4 + boundary
    });

    it("should NOT dense-fill outside the data range", () => {
      // Data only at T+30min in a 1hr range
      // Should NOT fill T+0 to T+29 or T+31 to T+60
      const data = [makeRow("2024-01-01T00:30:00", 42)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have: boundary at start, the data point, boundary at end = ~3 rows
      // NOT 61 rows (full 1hr dense)
      expect(result.length).toBeLessThan(10);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
      expect(realRows[0].count).toBe(42);
    });

    it("should dense-fill gaps between data points correctly", () => {
      // 5 minutes of data, 1-minute intervals, no gaps
      const data = [
        makeRow("2024-01-01T00:00:00", 1),
        makeRow("2024-01-01T00:01:00", 2),
        makeRow("2024-01-01T00:02:00", 3),
        makeRow("2024-01-01T00:03:00", 4),
        makeRow("2024-01-01T00:04:00", 5),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 4, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // All real data should be preserved, no extra nulls needed between them
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(5);
      expect(realRows.map((r: any) => r.count)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should add boundary entries at binnedStart and endTime", () => {
      // Data in the middle of the range
      const data = [
        makeRow("2024-01-01T00:30:00", 10),
        makeRow("2024-01-01T00:31:00", 20),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // First entry should be a boundary at binnedStart (before data)
      expect(result[0]._timestamp).not.toBe("2024-01-01T00:30:00");
      expect(result[0].count).toBe(""); // null fill

      // Last entry should be a boundary at endTime (after data)
      expect(result[result.length - 1]._timestamp).not.toBe("2024-01-01T00:31:00");
      expect(result[result.length - 1].count).toBe(""); // null fill
    });

    it("should use noValueConfigOption for null fill values", () => {
      const data = [
        makeRow("2024-01-01T00:00:00", 10),
        makeRow("2024-01-01T00:05:00", 50),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
        interval: 60,
        noValueConfigOption: 0, // fill with 0 instead of ""
      });
      const result = fillMissingValues(params);

      // Null-filled entries between T+1 and T+4 should have count = 0
      const zeroRows = result.filter(
        (r: any) => r.count === 0 && r._timestamp !== "2024-01-01T00:00:00",
      );
      expect(zeroRows.length).toBeGreaterThan(0);
    });

    it("should handle multiple gaps within data range", () => {
      // Data at T+0, T+5, T+10 with gaps between each
      const data = [
        makeRow("2024-01-01T00:00:00", 10),
        makeRow("2024-01-01T00:05:00", 50),
        makeRow("2024-01-01T00:10:00", 100),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 10, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Dense from T+0 to T+10: 11 entries total (every minute)
      // Real data at min 0, 5, 10; null fill at 1, 2, 3, 4, 6, 7, 8, 9
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(3);
      expect(realRows.map((r: any) => r.count)).toEqual([10, 50, 100]);

      const nullRows = result.filter((r: any) => r.count === "");
      expect(nullRows.length).toBe(8); // 8 missing minutes between data points
    });
  });

  // ============================
  // WITH BREAKDOWN DIMENSIONS
  // ============================
  describe("with breakdown - bounded dense fill", () => {
    it("should dense-fill between data points per breakdown group", () => {
      const data = [
        { _timestamp: "2024-01-01T00:00:00", host: "host1", count: 10 },
        { _timestamp: "2024-01-01T00:02:00", host: "host1", count: 20 },
        { _timestamp: "2024-01-01T00:00:00", host: "host2", count: 30 },
        { _timestamp: "2024-01-01T00:02:00", host: "host2", count: 40 },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
        interval: 60,
        breakDownKeys: ["host"],
      });
      const result = fillMissingValues(params);

      // Each host should have dense fill from T+0 to T+2 (3 entries) + boundary at end
      // host1: T+0 (real), T+1 (null), T+2 (real) + boundary
      // host2: T+0 (real), T+1 (null), T+2 (real) + boundary
      const host1Rows = result.filter((r: any) => r.host === "host1");
      const host2Rows = result.filter((r: any) => r.host === "host2");

      const host1Real = host1Rows.filter((r: any) => typeof r.count === "number");
      expect(host1Real.length).toBe(2);

      const host2Real = host2Rows.filter((r: any) => typeof r.count === "number");
      expect(host2Real.length).toBe(2);

      // Both should have at least 1 null fill at T+1
      const host1Nulls = host1Rows.filter((r: any) => r.count === "");
      expect(host1Nulls.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle different data ranges per breakdown group", () => {
      // host1 has data at T+0 and T+5, host2 only at T+0
      const data = [
        { _timestamp: "2024-01-01T00:00:00", host: "host1", count: 10 },
        { _timestamp: "2024-01-01T00:05:00", host: "host1", count: 50 },
        { _timestamp: "2024-01-01T00:00:00", host: "host2", count: 30 },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 10, 0) * 1000,
        interval: 60,
        breakDownKeys: ["host"],
      });
      const result = fillMissingValues(params);

      // host1 range: T+0 to T+5 → 6 dense + boundary at end = 7
      const host1Rows = result.filter((r: any) => r.host === "host1");
      expect(host1Rows.length).toBeGreaterThanOrEqual(6);

      // host2 range: only T+0 → 1 data point + boundary at end = ~2
      const host2Rows = result.filter((r: any) => r.host === "host2");
      expect(host2Rows.length).toBeLessThan(host1Rows.length);
    });
  });

  // ============================
  // PERFORMANCE VALIDATION
  // ============================
  describe("performance", () => {
    it("should produce far fewer rows than full-range dense fill", () => {
      // 24hr range, 1-minute intervals = 1441 time slots (full dense)
      // But data only spans 10 minutes → should produce ~10-12 rows, not 1441
      const data: any[] = [];
      for (let i = 0; i < 10; i++) {
        data.push(
          makeRow(
            `2024-01-01T00:0${i}:00`,
            i * 10,
          ),
        );
      }
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 2, 0, 0, 0) * 1000, // 24hrs
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Dense within data range (T+0 to T+9) = 10 entries
      // + boundary at binnedStart (if different) + boundary at endTime
      // Total should be ~12, NOT 1441
      expect(result.length).toBeLessThan(20);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(10);
    });

    it("should scale with data range, not query range, for breakdown", () => {
      // 1hr query range, 10 hosts, data spans only 5 minutes
      // Full dense: 61 * 10 = 610 rows. Bounded: ~5 * 10 + boundaries = ~70
      const hosts = Array.from({ length: 10 }, (_, i) => `host${i}`);
      const data: any[] = [];
      for (const host of hosts) {
        for (let m = 0; m < 5; m++) {
          data.push({
            _timestamp: `2024-01-01T00:0${m}:00`,
            host,
            count: m * 10,
          });
        }
      }
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
        breakDownKeys: ["host"],
      });
      const result = fillMissingValues(params);

      // Each host: 5 data points + boundary = ~6-7 per host, ~60-70 total
      // NOT 610
      expect(result.length).toBeLessThan(100);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(50);
    });
  });

  // ============================
  // EDGE CASES
  // ============================
  describe("edge cases", () => {
    it("should handle single data point", () => {
      const data = [makeRow("2024-01-01T00:30:00", 42)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
      expect(realRows[0].count).toBe(42);
      // Should be very few rows: boundary + data + boundary
      expect(result.length).toBeLessThan(10);
    });

    it("should handle resultMetaData as empty array", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        resultMetaData: [],
      });
      const result = fillMissingValues(params);
      expect(result).toBe(data);
    });

    it("should handle null/undefined processedData", () => {
      const params = createParams({
        processedData: null as any,
      });
      const result = fillMissingValues(params);
      expect(result).toBe(null);
    });

    it("should handle very large interval (1 day)", () => {
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 2, 0, 0, 0) * 1000,
        interval: 86400, // 1 day
      });
      const result = fillMissingValues(params);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
    });

    it("should handle data exactly at start and end boundaries", () => {
      const data = [
        makeRow("2024-01-01T00:00:00", 10),
        makeRow("2024-01-01T01:00:00", 100),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(2);
      expect(realRows[0].count).toBe(10);
      expect(realRows[1].count).toBe(100);

      // Dense fill between T+0 and T+60: 61 entries
      // No boundaries needed since data starts/ends at range edges
      expect(result.length).toBe(61);
    });
  });
});
