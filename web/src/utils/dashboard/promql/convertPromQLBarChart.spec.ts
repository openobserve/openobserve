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
import { BarConverter } from "./convertPromQLBarChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock dependencies
vi.mock("./shared/dataProcessor", () => ({
  applyAggregation: vi.fn((values, aggregation) => {
    if (!values || values.length === 0) return 0;
    const numericValues = values.map((v: any) => (Array.isArray(v) ? parseFloat(v[1]) : v));
    if (aggregation === "last") return numericValues[numericValues.length - 1];
    if (aggregation === "first") return numericValues[0];
    if (aggregation === "min") return Math.min(...numericValues);
    if (aggregation === "max") return Math.max(...numericValues);
    if (aggregation === "avg") {
      const sum = numericValues.reduce((a: number, b: number) => a + b, 0);
      return sum / numericValues.length;
    }
    if (aggregation === "sum") return numericValues.reduce((a: number, b: number) => a + b, 0);
    return numericValues[numericValues.length - 1];
  }),
}));

vi.mock("./shared/axisBuilder", () => ({
  buildCategoryXAxis: vi.fn((categories, panelSchema) => ({
    type: "category",
    data: categories,
  })),
  buildCategoryYAxis: vi.fn((categories, panelSchema) => ({
    type: "category",
    data: categories,
    axisLabel: {},
  })),
  buildValueAxis: vi.fn((panelSchema) => ({
    type: "value",
  })),
  buildTooltip: vi.fn((panelSchema, triggerType) => ({
    trigger: triggerType,
  })),
}));

vi.mock("./shared/gridBuilder", () => ({
  buildLegendConfig: vi.fn(() => ({ show: true })),
}));

vi.mock("../colorPalette", () => ({
  getSeriesColor: vi.fn((colorConfig, name, values, min, max, theme, colorBySeries) => {
    const colors: Record<string, string> = {
      series1: "#FF0000",
      series2: "#00FF00",
      series3: "#0000FF",
    };
    return colors[name] || "#CCCCCC";
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

describe("BarConverter", () => {
  let converter: BarConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new BarConverter();
    mockStore = {
      state: {
        timezone: "UTC",
        theme: "light",
      },
    };
    mockExtras = {
      legends: [],
    };
  });

  describe("supportedTypes", () => {
    it("should support h-bar, stacked, and h-stacked chart types", () => {
      expect(converter.supportedTypes).toEqual(["h-bar", "stacked", "h-stacked"]);
    });
  });

  describe("convert - h-bar (non-stacked horizontal)", () => {
    it("should convert data to h-bar format", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
            {
              name: "series2",
              values: [[1, "200"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series).toHaveLength(1);
      expect(result.series[0].type).toBe("bar");
      expect(result.series[0].data).toHaveLength(2);
      expect(result.xAxis.type).toBe("value");
      expect(result.yAxis.type).toBe("category");
      expect(result.yAxis.data).toEqual(["series1", "series2"]);
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
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].data[0].value).toBe(30);
    });

    it("should apply specified aggregation method", () => {
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
        type: "h-bar",
        config: {
          aggregation: "sum",
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].data[0].value).toBe(60);
    });

    it("should apply colors to bars", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].data[0].itemStyle).toBeDefined();
      expect(result.series[0].data[0].itemStyle.color).toBe("#FF0000");
    });

    it("should handle when getSeriesColor returns null", async () => {
      const { getSeriesColor } = await import("../colorPalette");
      vi.mocked(getSeriesColor).mockReturnValueOnce(null);

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "unknown",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].data[0].itemStyle).toBeUndefined();
    });

    it("should configure axis width for h-bar", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          axis_width: 200,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.yAxis.axisLabel.width).toBe(200);
    });

    it("should use default axis width of 150 for h-bar", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.yAxis.axisLabel.width).toBe(150);
    });

    it("should configure grid for h-bar", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.grid.left).toBe("15%");
      expect(result.grid.right).toBe("4%");
      expect(result.grid.bottom).toBe("10%");
      expect(result.grid.containLabel).toBe(true);
    });

    it("should apply custom bar width", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          bar_width: 30,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].barWidth).toBe(30);
    });

    it("should show labels when label_option.position is set", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          label_option: {
            position: "right",
            rotate: 45,
          },
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].label.show).toBe(true);
      expect(result.series[0].label.position).toBe("right");
      expect(result.series[0].label.rotate).toBe(45);
    });

    it("should hide labels when label_option.position is not set", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].label.show).toBe(false);
    });

    it("should format labels with unit", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "2048"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      const formatted = result.series[0].label.formatter({ value: 2048 });
      expect(formatted).toBe("2.00KB");
    });
  });

  describe("convert - stacked bar chart", () => {
    it("should convert data to stacked bar format", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
                "2": "20",
              },
            },
            {
              name: "series2",
              values: [],
              data: {
                "1": "30",
                "2": "40",
              },
            },
          ],
          timestamps: [
            [1, "2021-01-01 00:00:00"],
            [2, "2021-01-01 00:01:00"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series).toHaveLength(2);
      expect(result.series[0].type).toBe("bar");
      expect(result.series[0].stack).toBe("total");
      expect(result.series[1].stack).toBe("total");
      expect(result.xAxis.type).toBe("category");
      expect(result.yAxis.type).toBe("value");
    });

    it("should populate extras.legends for stacked chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu",
              values: [],
              data: {
                "1": "50",
              },
            },
            {
              name: "memory",
              values: [],
              data: {
                "1": "75",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toEqual(["cpu", "memory"]);
    });

    it("should extract time portion from Date object", () => {
      const date1 = new Date(2021, 0, 1, 14, 30, 45);
      const date2 = new Date(2021, 0, 1, 15, 45, 30);

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
                "2": "20",
              },
            },
          ],
          timestamps: [
            [1, date1],
            [2, date2],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.xAxis.data).toEqual(["14:30:45", "15:45:30"]);
    });

    it("should extract time portion from ISO string", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
                "2": "20",
              },
            },
          ],
          timestamps: [
            [1, "2021-01-01 14:30:45"],
            [2, "2021-01-01 15:45:30"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.xAxis.data).toEqual(["14:30:45", "15:45:30"]);
    });

    it("should handle formatted timestamp without time portion", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "2021-01-01"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.xAxis.data).toEqual(["2021-01-01"]);
    });

    it("should handle missing data values as '-' in stacked chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
                // Missing value for timestamp 2
              },
            },
          ],
          timestamps: [
            [1, "00:00:00"],
            [2, "00:00:01"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].data).toEqual([10, '-']);
    });

    it("should apply colors to stacked series", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {
                "1": "100",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].color).toBe("#FF0000");
    });

    it("should not add color when getSeriesColor returns null for stacked", async () => {
      const { getSeriesColor } = await import("../colorPalette");
      vi.mocked(getSeriesColor).mockReturnValueOnce(null);

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "unknown",
              values: [[1, "100"]],
              data: {
                "1": "100",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].color).toBeUndefined();
    });

    it("should configure grid for vertical stacked", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.grid.left).toBe("3%");
      expect(result.grid.right).toBe("4%");
      expect(result.grid.bottom).toBe("10%");
    });

    it("should apply custom bar width for stacked", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {
          bar_width: 40,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].barWidth).toBe(40);
    });

    it("should format labels with unit for stacked", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "2048",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      const formatted = result.series[0].label.formatter({ value: 2048 });
      expect(formatted).toBe("2.00KB");
    });
  });

  describe("convert - h-stacked bar chart", () => {
    it("should convert data to h-stacked bar format", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series).toHaveLength(1);
      expect(result.series[0].stack).toBe("total");
      expect(result.xAxis.type).toBe("value");
      expect(result.yAxis.type).toBe("category");
    });

    it("should configure axis width for h-stacked", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-stacked",
        config: {
          axis_width: 180,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.yAxis.axisLabel.width).toBe(180);
    });

    it("should configure grid for h-stacked", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "10",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-stacked",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.grid.left).toBe("15%");
    });
  });

  describe("edge cases", () => {
    it("should handle config without color object", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          // No color property
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result).toBeDefined();
    });

    it("should use default position 'top' when label_option.position is null", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          label_option: {
            position: null,
          },
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].label.position).toBe("top");
    });

    it("should use default rotate 0 when label_option.rotate is undefined", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          label_option: {
            position: "right",
            // No rotate property
          },
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].label.rotate).toBe(0);
    });

    it("should handle config without color object for stacked chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {
                "1": "100",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "stacked",
        config: {
          // No color property
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result).toBeDefined();
    });
  });

  describe("common features", () => {
    it("should configure tooltip with axis trigger", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.tooltip.trigger).toBe("axis");
    });

    it("should configure emphasis focus", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series[0].emphasis.focus).toBe("series");
    });

    it("should handle empty processed data", () => {
      const processedData: ProcessedPromQLData[] = [];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.series).toHaveLength(1);
      expect(result.series[0].data).toEqual([]);
    });

    it("should handle empty config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result).toBeDefined();
    });

    it("should handle chartPanelRef parameter", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {},
      };

      const mockChartPanelRef = { value: { clientWidth: 500, clientHeight: 400 } };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
        mockChartPanelRef
      );

      expect(result).toBeDefined();
    });

    it("should apply custom axis_width to grid left", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
              data: {},
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "h-bar",
        config: {
          axis_width: 250,
        },
      };

      const result = converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(result.grid.left).toBe(250);
    });
  });
});
