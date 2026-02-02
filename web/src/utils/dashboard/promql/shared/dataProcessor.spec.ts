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
import {
  processPromQLData,
  getInstantValue,
  fillMissingTimestamps,
  applyAggregation,
} from "./dataProcessor";
import type { PromQLResponse } from "./types";

// Mock the legendBuilder module
vi.mock("./legendBuilder", () => ({
  getPromqlLegendName: vi.fn((metric, template) => {
    if (template) {
      return template.replace(/\{\{(\w+)\}\}/g, (_, key) => metric[key] || "");
    }
    return Object.entries(metric)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }),
}));

describe("dataProcessor", () => {
  describe("processPromQLData", () => {
    let mockStore: any;
    let mockPanelSchema: any;

    beforeEach(() => {
      mockStore = {
        state: {
          timezone: "UTC",
        },
      };

      mockPanelSchema = {
        config: {
          promql_series_limit: 100,
        },
        queries: [
          {
            config: {
              promql_legend: "{{job}}",
            },
          },
        ],
      };
    });

    it("should process standard PromQL format (data.result)", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          status: "success",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { __name__: "up", job: "prometheus" },
                values: [
                  [1609459200, "1"],
                  [1609459260, "1"],
                ],
              },
            ],
          },
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result).toHaveLength(1);
      expect(result[0].series).toHaveLength(1);
      expect(result[0].series[0].name).toBe("prometheus");
      expect(result[0].series[0].values).toHaveLength(2);
      expect(result[0].timestamps).toHaveLength(2);
      expect(result[0].queryIndex).toBe(0);
    });

    it("should process OpenObserve format (direct result)", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          status: "success",
          resultType: "vector",
          result: [
            {
              metric: { job: "node" },
              value: [1609459200, "42"],
            },
          ],
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result).toHaveLength(1);
      expect(result[0].series).toHaveLength(1);
      expect(result[0].series[0].name).toBe("node");
      expect(result[0].series[0].values).toHaveLength(1);
    });

    it("should handle multiple queries", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "prometheus" },
                values: [[1609459200, "1"]],
              },
            ],
          },
        },
        {
          result: [
            {
              metric: { job: "node" },
              values: [[1609459200, "2"]],
            },
          ],
        },
      ];

      mockPanelSchema.queries.push({
        config: { promql_legend: "{{job}}" },
      });

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result).toHaveLength(2);
      expect(result[0].queryIndex).toBe(0);
      expect(result[1].queryIndex).toBe(1);
    });

    it("should skip queries with no result data", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          status: "success",
        },
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [[1609459200, "1"]],
              },
            ],
          },
        },
      ];

      mockPanelSchema.queries.push({
        config: { promql_legend: "{{job}}" },
      });

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result).toHaveLength(1);
      expect(result[0].queryIndex).toBe(1);
    });

    it("should apply series limit", async () => {
      const result = Array.from({ length: 150 }, (_, i) => ({
        metric: { job: `job-${i}` },
        values: [[1609459200, "1"]],
      }));

      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result,
          },
        },
      ];

      mockPanelSchema.config.promql_series_limit = 50;

      const processedResult = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(processedResult[0].series).toHaveLength(50);
    });

    it("should use default series limit when not specified", async () => {
      const result = Array.from({ length: 150 }, (_, i) => ({
        metric: { job: `job-${i}` },
        values: [[1609459200, "1"]],
      }));

      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result,
          },
        },
      ];

      delete mockPanelSchema.config.promql_series_limit;

      const processedResult = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(processedResult[0].series).toHaveLength(100);
    });

    it("should collect unique timestamps across all series", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "a" },
                values: [
                  [1609459200, "1"],
                  [1609459260, "2"],
                ],
              },
              {
                metric: { job: "b" },
                values: [
                  [1609459260, "3"],
                  [1609459320, "4"],
                ],
              },
            ],
          },
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].timestamps).toHaveLength(3);
      expect(result[0].timestamps.map(([ts]) => ts)).toEqual([
        1609459200, 1609459260, 1609459320,
      ]);
    });

    it("should format timestamps with UTC timezone", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [[1609459200, "1"]],
              },
            ],
          },
        },
      ];

      mockStore.state.timezone = "UTC";

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].timestamps[0][0]).toBe(1609459200);
      expect(typeof result[0].timestamps[0][1]).toBe("string");
    });

    it("should format timestamps with non-UTC timezone", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [[1609459200, "1"]],
              },
            ],
          },
        },
      ];

      mockStore.state.timezone = "America/New_York";

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].timestamps[0][0]).toBe(1609459200);
      expect(result[0].timestamps[0][1]).toBeInstanceOf(Date);
    });

    it("should create timestamp->value mapping", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [
                  [1609459200, "100"],
                  [1609459260, "200"],
                ],
              },
            ],
          },
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].series[0].data).toEqual({
        1609459200: "100",
        1609459260: "200",
      });
    });

    it("should handle missing query config", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [[1609459200, "1"]],
              },
            ],
          },
        },
      ];

      mockPanelSchema.queries = [];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].queryConfig).toEqual({});
    });

    it("should handle vector result (single value)", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          result: [
            {
              metric: { job: "test" },
              value: [1609459200, "42"],
            },
          ],
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].series[0].values).toEqual([[1609459200, "42"]]);
    });

    it("should handle empty values array", async () => {
      const searchQueryData: PromQLResponse[] = [
        {
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { job: "test" },
                values: [],
              },
            ],
          },
        },
      ];

      const result = await processPromQLData(
        searchQueryData,
        mockPanelSchema,
        mockStore,
      );

      expect(result[0].series[0].values).toEqual([]);
      expect(result[0].series[0].data).toEqual({});
    });
  });

  describe("getInstantValue", () => {
    it("should return the last value from sorted array", () => {
      const values: Array<[number, string]> = [
        [1609459200, "1"],
        [1609459260, "2"],
        [1609459320, "3"],
      ];

      expect(getInstantValue(values)).toBe("3");
    });

    it("should sort values by timestamp before getting last", () => {
      const values: Array<[number, string]> = [
        [1609459260, "2"],
        [1609459320, "3"],
        [1609459200, "1"],
      ];

      expect(getInstantValue(values)).toBe("3");
    });

    it("should return 0 for empty array", () => {
      expect(getInstantValue([])).toBe("0");
    });

    it("should return 0 for null/undefined", () => {
      expect(getInstantValue(null as any)).toBe("0");
      expect(getInstantValue(undefined as any)).toBe("0");
    });

    it("should handle single value", () => {
      const values: Array<[number, string]> = [[1609459200, "42"]];
      expect(getInstantValue(values)).toBe("42");
    });
  });

  describe("fillMissingTimestamps", () => {
    it("should fill missing timestamps with null", () => {
      const dataObj: Record<number, string> = {
        1609459200: "1",
        1609459320: "3",
      };

      const timestamps: Array<[number, Date | string]> = [
        [1609459200, "2021-01-01 00:00:00"],
        [1609459260, "2021-01-01 00:01:00"],
        [1609459320, "2021-01-01 00:02:00"],
      ];

      const result = fillMissingTimestamps(dataObj, timestamps);

      expect(result).toEqual([
        ["2021-01-01 00:00:00", "1"],
        ["2021-01-01 00:01:00", null],
        ["2021-01-01 00:02:00", "3"],
      ]);
    });

    it("should handle Date objects in timestamps", () => {
      const dataObj: Record<number, string> = {
        1609459200: "100",
      };

      const date = new Date(1609459200 * 1000);
      const timestamps: Array<[number, Date | string]> = [[1609459200, date]];

      const result = fillMissingTimestamps(dataObj, timestamps);

      expect(result).toEqual([[date, "100"]]);
    });

    it("should handle all missing timestamps", () => {
      const dataObj: Record<number, string> = {};

      const timestamps: Array<[number, Date | string]> = [
        [1609459200, "2021-01-01 00:00:00"],
        [1609459260, "2021-01-01 00:01:00"],
      ];

      const result = fillMissingTimestamps(dataObj, timestamps);

      expect(result).toEqual([
        ["2021-01-01 00:00:00", null],
        ["2021-01-01 00:01:00", null],
      ]);
    });

    it("should handle empty timestamps array", () => {
      const dataObj: Record<number, string> = {
        1609459200: "1",
      };

      const result = fillMissingTimestamps(dataObj, []);

      expect(result).toEqual([]);
    });
  });

  describe("applyAggregation", () => {
    const values: Array<[number, string]> = [
      [1609459200, "10"],
      [1609459260, "20"],
      [1609459320, "30"],
      [1609459380, "40"],
      [1609459440, "50"],
    ];

    it("should return last value by default", () => {
      expect(applyAggregation(values)).toBe(50);
    });

    it("should apply last aggregation", () => {
      expect(applyAggregation(values, "last")).toBe(50);
    });

    it("should apply first aggregation", () => {
      expect(applyAggregation(values, "first")).toBe(10);
    });

    it("should apply min aggregation", () => {
      expect(applyAggregation(values, "min")).toBe(10);
    });

    it("should apply max aggregation", () => {
      expect(applyAggregation(values, "max")).toBe(50);
    });

    it("should apply avg aggregation", () => {
      expect(applyAggregation(values, "avg")).toBe(30);
    });

    it("should apply sum aggregation", () => {
      expect(applyAggregation(values, "sum")).toBe(150);
    });

    it("should apply count aggregation", () => {
      expect(applyAggregation(values, "count")).toBe(5);
    });

    it("should apply range aggregation", () => {
      expect(applyAggregation(values, "range")).toBe(40);
    });

    it("should apply diff aggregation", () => {
      expect(applyAggregation(values, "diff")).toBe(40);
    });

    it("should return 0 for empty array", () => {
      expect(applyAggregation([])).toBe(0);
      expect(applyAggregation(null as any)).toBe(0);
      expect(applyAggregation(undefined as any)).toBe(0);
    });

    it("should handle single value", () => {
      const singleValue: Array<[number, string]> = [[1609459200, "42"]];
      expect(applyAggregation(singleValue, "avg")).toBe(42);
      expect(applyAggregation(singleValue, "sum")).toBe(42);
      expect(applyAggregation(singleValue, "count")).toBe(1);
      expect(applyAggregation(singleValue, "range")).toBe(0);
      expect(applyAggregation(singleValue, "diff")).toBe(0);
    });

    it("should handle negative values", () => {
      const negativeValues: Array<[number, string]> = [
        [1609459200, "-10"],
        [1609459260, "5"],
        [1609459320, "-3"],
      ];

      expect(applyAggregation(negativeValues, "min")).toBe(-10);
      expect(applyAggregation(negativeValues, "max")).toBe(5);
      expect(applyAggregation(negativeValues, "sum")).toBe(-8);
      expect(applyAggregation(negativeValues, "avg")).toBeCloseTo(-2.67, 1);
      expect(applyAggregation(negativeValues, "range")).toBe(15);
      expect(applyAggregation(negativeValues, "diff")).toBe(7);
    });

    it("should handle decimal values", () => {
      const decimalValues: Array<[number, string]> = [
        [1609459200, "1.5"],
        [1609459260, "2.5"],
        [1609459320, "3.5"],
      ];

      expect(applyAggregation(decimalValues, "avg")).toBeCloseTo(2.5, 1);
      expect(applyAggregation(decimalValues, "sum")).toBeCloseTo(7.5, 1);
    });

    it("should return last for unknown aggregation type", () => {
      expect(applyAggregation(values, "unknown" as any)).toBe(50);
    });
  });
});
