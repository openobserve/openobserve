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
import { GaugeConverter } from "./convertPromQLGaugeChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock dependencies
vi.mock("./shared/dataProcessor", () => ({
  applyAggregation: vi.fn((values, aggregation) => {
    if (!values || values.length === 0) return 0;
    const numericValues = values.map((v: any) =>
      Array.isArray(v) ? parseFloat(v[1]) : v,
    );
    if (aggregation === "last") return numericValues[numericValues.length - 1];
    if (aggregation === "avg") {
      const sum = numericValues.reduce((a: number, b: number) => a + b, 0);
      return sum / numericValues.length;
    }
    return numericValues[numericValues.length - 1];
  }),
}));

vi.mock("../colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF0000"),
}));

vi.mock("../convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((obj) => `${obj.value}${obj.unit}`),
  getUnitValue: vi.fn((value, unit, unitCustom, decimals = 2) => {
    if (unit === "percent") {
      return { value: value.toFixed(decimals), unit: "%" };
    }
    return { value: value.toFixed(decimals), unit: "" };
  }),
}));

describe("GaugeConverter", () => {
  let converter: GaugeConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new GaugeConverter();
    mockStore = {
      state: {
        timezone: "UTC",
        theme: "light",
      },
    };
    mockExtras = {
      legends: [],
    };
    vi.clearAllMocks();
  });

  describe("supportedTypes", () => {
    it("should support gauge chart type", () => {
      expect(converter.supportedTypes).toEqual(["gauge"]);
    });
  });

  describe("convert", () => {
    it("should convert single gauge", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu_usage",
              values: [[1, "75"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toHaveLength(1);
      expect(result.series[0].type).toBe("gauge");
      expect(result.series[0].data[0].value).toBe(75);
      expect(result.series[0].data[0].name).toBe("cpu_usage");
    });

    it("should populate extras.legends", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "metric1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toEqual(["metric1"]);
    });

    it("should apply default aggregation (last)", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [
                [1, "10"],
                [2, "20"],
                [3, "30"],
              ],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].value).toBe(30);
    });

    it("should apply specified aggregation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [
                [1, "10"],
                [2, "20"],
                [3, "30"],
              ],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {
          aggregation: "avg",
        },
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].value).toBe(20);
    });

    it("should use query-specific min/max", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: { min: 10, max: 200 } }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].min).toBe(10);
      expect(result.series[0].max).toBe(200);
    });

    it("should use default min/max when not specified", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].min).toBe(0);
      expect(result.series[0].max).toBe(100);
    });

    it("should handle multiple gauges with grid layout", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "gauge1",
              values: [[1, "25"]],
              data: {},
            },
            {
              name: "gauge2",
              values: [[1, "50"]],
              data: {},
            },
            {
              name: "gauge3",
              values: [[1, "75"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toHaveLength(3);
      expect(result.grid).toHaveLength(3);
      expect(result.series[0].gridIndex).toBe(0);
      expect(result.series[1].gridIndex).toBe(1);
      expect(result.series[2].gridIndex).toBe(2);
    });

    it("should configure gauge appearance", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].progress.show).toBe(true);
      expect(result.series[0].detail.valueAnimation).toBe(true);
      expect(result.series[0].title.fontSize).toBe(10);
    });

    it("should format gauge value with unit", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "75"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {
          unit: "percent",
          decimals: 1,
        },
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.series[0].data[0].detail.formatter(75);
      expect(formatted).toBe("75.0%");
    });

    it("should configure tooltip", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.show).toBe(true);
      expect(result.tooltip.trigger).toBe("item");
    });

    it("should configure tooltip for dark theme", () => {
      mockStore.state.theme = "dark";

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.textStyle.color).toBe("#fff");
    });

    it("should configure tooltip for light theme", () => {
      mockStore.state.theme = "light";

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.textStyle.color).toBe("#000");
    });

    it("should format tooltip value", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {
          unit: "percent",
          decimals: 2,
        },
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      const formatted = result.tooltip.valueFormatter(75);
      expect(formatted).toBe("75.00%");
    });

    it("should apply color to gauge", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].itemStyle.color).toBeDefined();
    });

    it("should handle getSeriesColor error gracefully", async () => {
      const { getSeriesColor } = await import("../colorPalette");
      vi.mocked(getSeriesColor).mockImplementationOnce(() => {
        throw new Error("Color error");
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].itemStyle.color).toBeUndefined();
    });

    it("should use custom gauges_per_row", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "gauge1",
              values: [[1, "25"]],
              data: {},
            },
            {
              name: "gauge2",
              values: [[1, "50"]],
              data: {},
            },
            {
              name: "gauge3",
              values: [[1, "75"]],
              data: {},
            },
            {
              name: "gauge4",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {
          gauges_per_row: 2,
        },
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.grid).toHaveLength(4);
      // With 2 gauges per row, we should have 2 rows
      expect(result.grid[0].width).toBe("50%");
    });

    it("should calculate grid layout for single gauge", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "gauge1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.grid[0].width).toBe("100%");
      expect(result.grid[0].height).toBe("100%");
    });

    it("should handle empty config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        queries: [{}],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result).toBeDefined();
    });

    it("should handle empty queries array", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].min).toBe(0);
      expect(result.series[0].max).toBe(100);
    });

    it("should handle chartPanelRef parameter", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const mockChartPanelRef = {
        value: { clientWidth: 500, clientHeight: 400 },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
        mockChartPanelRef,
      );

      expect(result).toBeDefined();
    });

    it("should return dataset with empty source", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "50"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "gauge",
        config: {},
        queries: [{ config: {} }],
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.dataset.source).toEqual([[]]);
    });
  });
});
