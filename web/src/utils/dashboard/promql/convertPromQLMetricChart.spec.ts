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
import { MetricConverter } from "./convertPromQLMetricChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock the dependencies
vi.mock("./shared/dataProcessor", () => ({
  applyAggregation: vi.fn((values, aggregation) => {
    if (!values || values.length === 0) return 0;
    if (aggregation === "last") return values[values.length - 1];
    if (aggregation === "first") return values[0];
    if (aggregation === "min") return Math.min(...values);
    if (aggregation === "max") return Math.max(...values);
    if (aggregation === "avg") {
      const sum = values.reduce((a: number, b: number) => a + b, 0);
      return sum / values.length;
    }
    if (aggregation === "sum")
      return values.reduce((a: number, b: number) => a + b, 0);
    return values[values.length - 1];
  }),
}));

vi.mock("../convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((obj) => {
    const { unit, value } = obj;
    if (["$", "€", "£", "¥", "₹"].includes(unit)) {
      return `${unit}${value}`;
    }
    return `${value}${unit}`;
  }),
  getUnitValue: vi.fn((value, unit, unitCustom, decimals = 2) => {
    if (unit === "bytes") {
      if (value >= 1024) {
        return { value: (value / 1024).toFixed(decimals), unit: "KB" };
      }
      return { value: value.toFixed(decimals), unit: "B" };
    }
    if (unit === "percent") {
      return { value: value.toFixed(decimals), unit: "%" };
    }
    if (unit === "custom") {
      return { value: value.toFixed(decimals), unit: unitCustom || "" };
    }
    return { value: value.toFixed(decimals), unit: "" };
  }),
}));

describe("MetricConverter", () => {
  let converter: MetricConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new MetricConverter();
    mockStore = {
      state: {
        timezone: "UTC",
      },
    };
    mockExtras = {};
  });

  describe("supportedTypes", () => {
    it("should support metric chart type", () => {
      expect(converter.supportedTypes).toEqual(["metric"]);
    });
  });

  describe("convert", () => {
    it("should convert single series to metric format with default aggregation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu_usage",
              values: [10, 20, 30, 40, 50],
            },
          ],
          timestamps: [1, 2, 3, 4, 5],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.type).toBe("metric");
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0].name).toBe("cpu_usage");
      expect(result.metrics[0].rawValue).toBe(50); // last value
      expect(result.layout).toBe("grid");
      expect(result.fontSize).toBe(24);
    });

    it("should apply specified aggregation method", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "temperature",
              values: [10, 20, 30, 40, 50],
            },
          ],
          timestamps: [1, 2, 3, 4, 5],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          aggregation: "avg",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].rawValue).toBe(30); // average
    });

    it("should apply 'max' aggregation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "max_value",
              values: [10, 50, 30, 40, 20],
            },
          ],
          timestamps: [1, 2, 3, 4, 5],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          aggregation: "max",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].rawValue).toBe(50);
    });

    it("should apply 'min' aggregation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "min_value",
              values: [10, 5, 30, 40, 20],
            },
          ],
          timestamps: [1, 2, 3, 4, 5],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          aggregation: "min",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].rawValue).toBe(5);
    });

    it("should apply 'sum' aggregation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "total",
              values: [10, 20, 30],
            },
          ],
          timestamps: [1, 2, 3],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          aggregation: "sum",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].rawValue).toBe(60);
    });

    it("should format values with unit", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "memory",
              values: [1024],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].value).toBe("1.00KB");
      expect(result.metrics[0].unit).toBe("KB");
    });

    it("should format values with custom unit", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "requests",
              values: [150.5],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          unit: "custom",
          unit_custom: "req/s",
          decimals: 1,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].value).toBe("150.5req/s");
    });

    it("should handle multiple series", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics).toHaveLength(2);
      expect(result.metrics[0].name).toBe("series1");
      expect(result.metrics[1].name).toBe("series2");
    });

    it("should handle multiple queries", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "query1_series",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
        {
          series: [
            {
              name: "query2_series",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 1,
        },
      ];

      const panelSchema = {
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics).toHaveLength(2);
    });

    it("should aggregate multiple metrics into single value when show_single_value is true", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.type).toBe("metric");
      expect(result.value).toBeDefined();
      expect(result.label).toBe("Total");
      expect(result.trendData).toEqual([100, 200]);
    });

    it("should use average aggregate method when specified", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
          aggregate_method: "avg",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      // The total is 300, avg is 150
      expect(result.value).toBe("150.00");
    });

    it("should use sum aggregate method by default for single value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      // The total is 300 (sum)
      expect(result.value).toBe("300.00");
    });

    it("should use custom label when provided for single value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
          label: "Custom Metric",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.label).toBe("Custom Metric");
    });

    it("should apply custom font size for single value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
          font_size: 48,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.fontSize).toBe(48);
    });

    it("should apply default font size of 32 for single value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.fontSize).toBe(32);
    });

    it("should apply custom font color", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          font_color: "#FF0000",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.fontColor).toBe("#FF0000");
    });

    it("should apply custom background color", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          background_color: "#0000FF",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.backgroundColor).toBe("#0000FF");
    });

    it("should apply custom layout", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          layout: "vertical",
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.layout).toBe("vertical");
    });

    it("should show trend by default for single value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.showTrend).toBe(true);
    });

    it("should hide trend when show_trend is false", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [100],
            },
            {
              name: "series2",
              values: [200],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
          show_trend: false,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.showTrend).toBe(false);
    });

    it("should not aggregate when show_single_value is true but only one metric", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "single_series",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          show_single_value: true,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      // Should return multi-metric format since only one metric
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0].name).toBe("single_series");
    });

    it("should handle empty processed data", () => {
      const processedData: ProcessedPromQLData[] = [];

      const panelSchema = {
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics).toEqual([]);
    });

    it("should handle empty series in processed data", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [],
          timestamps: [],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics).toEqual([]);
    });

    it("should handle empty config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "test",
              values: [42],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {};

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.type).toBe("metric");
      expect(result.metrics).toHaveLength(1);
    });

    it("should apply decimals configuration", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "precise_value",
              values: [123.456789],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {
          decimals: 3,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.metrics[0].value).toBe("123.457");
    });

    it("should handle chartPanelRef parameter", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "test",
              values: [100],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        config: {},
      };

      const mockChartPanelRef = { value: null };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
        mockChartPanelRef,
      );

      expect(result).toBeDefined();
    });
  });
});
