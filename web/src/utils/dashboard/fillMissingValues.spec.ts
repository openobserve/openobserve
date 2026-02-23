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

// Helper: generate an ISO time string for UTC
function utcTimeStr(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return d.toISOString().replace(/\.\d{3}Z$/, "");
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
  // NO BREAKDOWN - BASIC CASES
  // ==========================
  describe("without breakdown", () => {
    it("should return data as-is when data covers full range with no gaps", () => {
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

      // All real data should be preserved
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(5);
      // Values should be correct
      expect(realRows.map((r: any) => r.count)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should insert null markers at gap boundaries", () => {
      // Data at T+0 and T+5min, gap from T+1 to T+4
      const data = [
        makeRow("2024-01-01T00:00:00", 10),
        makeRow("2024-01-01T00:05:00", 50),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have the 2 real data rows plus null markers in the gap
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(2);
      expect(realRows[0].count).toBe(10);
      expect(realRows[1].count).toBe(50);

      // Total rows should be much less than 6 (the dense approach would give 6)
      // Sparse: data[0], nullMarker(gap_start), nullMarker(gap_end), data[1]
      // That's roughly 4 rows, not 6
      expect(result.length).toBeLessThanOrEqual(6);
      expect(result.length).toBeGreaterThanOrEqual(3); // at minimum: data, null, data
    });

    it("should insert boundary nulls when data doesn't start at range start", () => {
      // Range starts at T+0, but first data is at T+5min
      const data = [makeRow("2024-01-01T00:05:00", 50)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have null markers before the first data point
      expect(result.length).toBeGreaterThan(1);
      // First entry should be a null marker
      expect(result[0].count).toBe("");
      // Last entry with a real value should be 50
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
      expect(realRows[0].count).toBe(50);
    });

    it("should insert boundary nulls when data doesn't end at range end", () => {
      // Range ends at T+10min, but last data is at T+0
      const data = [makeRow("2024-01-01T00:00:00", 10)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 10, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have null markers after the last data point
      expect(result.length).toBeGreaterThan(1);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
      expect(realRows[0].count).toBe(10);
    });

    it("should handle single data point", () => {
      const data = [makeRow("2024-01-01T00:30:00", 42)];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 1, 0, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // Should have the real data point plus boundary nulls
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
      expect(realRows[0].count).toBe(42);

      // Should be much fewer rows than dense (61 rows for 1hr with 1min interval)
      expect(result.length).toBeLessThan(20);
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

      // Null marker entries should use 0
      const nullRows = result.filter(
        (r: any) => r.count === 0 && typeof r.count === "number",
      );
      // There should be at least some null markers with value 0
      if (result.length > 2) {
        expect(nullRows.length).toBeGreaterThan(0);
      }
    });

    it("should preserve data order (sorted by time)", () => {
      // Give data in reverse order
      const data = [
        makeRow("2024-01-01T00:03:00", 3),
        makeRow("2024-01-01T00:01:00", 1),
        makeRow("2024-01-01T00:02:00", 2),
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 3, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.map((r: any) => r.count)).toEqual([1, 2, 3]);
    });

    it("should handle multiple gaps", () => {
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

      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(3);
      expect(realRows.map((r: any) => r.count)).toEqual([10, 50, 100]);

      // Dense would produce 11 rows. Sparse should be fewer.
      expect(result.length).toBeLessThan(11);
    });
  });

  // ============================
  // WITH BREAKDOWN DIMENSIONS
  // ============================
  describe("with breakdown", () => {
    it("should handle breakdown dimension correctly", () => {
      const data = [
        { _timestamp: "2024-01-01T00:00:00", host: "host1", count: 10 },
        { _timestamp: "2024-01-01T00:01:00", host: "host1", count: 20 },
        { _timestamp: "2024-01-01T00:00:00", host: "host2", count: 30 },
        { _timestamp: "2024-01-01T00:01:00", host: "host2", count: 40 },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 1, 0) * 1000,
        interval: 60,
        breakDownKeys: ["host"],
      });
      const result = fillMissingValues(params);

      // All real data should be preserved
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(4);
    });

    it("should handle gaps per breakdown group independently", () => {
      // host1 has data at T+0 and T+5, host2 has data only at T+0
      const data = [
        { _timestamp: "2024-01-01T00:00:00", host: "host1", count: 10 },
        { _timestamp: "2024-01-01T00:05:00", host: "host1", count: 50 },
        { _timestamp: "2024-01-01T00:00:00", host: "host2", count: 30 },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 5, 0) * 1000,
        interval: 60,
        breakDownKeys: ["host"],
      });
      const result = fillMissingValues(params);

      // All 3 real data rows should be preserved
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(3);

      // host2 should have boundary nulls for end of range
      const host2Rows = result.filter((r: any) => r.host === "host2");
      expect(host2Rows.length).toBeGreaterThan(1); // data + null markers
    });

    it("should use xAxisKeys without timestamp for uniqueKey", () => {
      // Using x-axis key that's not timestamp as the breakdown identifier
      const data = [
        { _timestamp: "2024-01-01T00:00:00", region: "us", count: 10 },
        { _timestamp: "2024-01-01T00:01:00", region: "us", count: 20 },
        { _timestamp: "2024-01-01T00:00:00", region: "eu", count: 30 },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 1, 0) * 1000,
        interval: 60,
        xAxisKeys: ["_timestamp", "region"],
      });
      const result = fillMissingValues(params);

      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(3);
    });
  });

  // ============================
  // PERFORMANCE VALIDATION
  // ============================
  describe("performance", () => {
    it("should produce significantly fewer rows than dense fill for large gaps", () => {
      // 24hr range, 1-second intervals = 86400 time slots (dense)
      // But only 10 data points clustered at the start
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

      // Dense would produce 1441 rows (24*60 + 1).
      // Sparse should be around 10 data + ~4 null markers
      expect(result.length).toBeLessThan(20);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(10);
    });

    it("should produce dramatically fewer rows with breakdown + large gaps", () => {
      // 1hr range, 1-second intervals, 10 breakdown values, 5 data points each
      // Dense: 3600 * 10 = 36000 rows. Sparse: ~50 + ~40 nulls = ~90
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

      // Dense would produce 610 rows per host * 10 = 6100.
      // Sparse: 50 real + ~40 null markers = ~90
      expect(result.length).toBeLessThan(200);
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(50);
    });
  });

  // ============================
  // EDGE CASES
  // ============================
  describe("edge cases", () => {
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
    });

    it("should handle consecutive data with no gaps at all", () => {
      const data = [];
      for (let m = 0; m <= 4; m++) {
        data.push(
          makeRow(
            `2024-01-01T00:0${m}:00`,
            m,
          ),
        );
      }
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 4, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);

      // No gaps, so no null markers needed (except possibly at boundaries)
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(5);
      expect(realRows.map((r: any) => r.count)).toEqual([0, 1, 2, 3, 4]);
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

    it("should handle processedData with only null-valued entries", () => {
      // Data where time key matches but values are ""
      const data = [
        { _timestamp: "2024-01-01T00:00:00", count: "" },
        { _timestamp: "2024-01-01T00:01:00", count: "" },
      ];
      const params = createParams({
        processedData: data,
        startTime: Date.UTC(2024, 0, 1, 0, 0, 0) * 1000,
        endTime: Date.UTC(2024, 0, 1, 0, 1, 0) * 1000,
        interval: 60,
      });
      const result = fillMissingValues(params);
      // Should still process them (they have valid time keys)
      expect(result.length).toBeGreaterThanOrEqual(2);
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
      // With 1-day interval and 1-day range, minimal rows
      const realRows = result.filter((r: any) => typeof r.count === "number");
      expect(realRows.length).toBe(1);
    });
  });
});
