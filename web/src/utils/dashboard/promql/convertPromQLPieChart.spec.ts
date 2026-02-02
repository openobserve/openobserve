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
import { PieConverter } from "./convertPromQLPieChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock dependencies
vi.mock("./shared/dataProcessor", () => ({
  applyAggregation: vi.fn((values, aggregation) => {
    if (!values || values.length === 0) return 0;
    const numericValues = values.map((v: any) =>
      Array.isArray(v) ? parseFloat(v[1]) : v,
    );
    if (aggregation === "last") return numericValues[numericValues.length - 1];
    if (aggregation === "first") return numericValues[0];
    if (aggregation === "min") return Math.min(...numericValues);
    if (aggregation === "max") return Math.max(...numericValues);
    if (aggregation === "avg") {
      const sum = numericValues.reduce((a: number, b: number) => a + b, 0);
      return sum / numericValues.length;
    }
    if (aggregation === "sum")
      return numericValues.reduce((a: number, b: number) => a + b, 0);
    return numericValues[numericValues.length - 1];
  }),
}));

vi.mock("./shared/axisBuilder", () => ({
  buildTooltip: vi.fn((panelSchema, triggerType) => ({
    trigger: triggerType,
    formatter: vi.fn(),
  })),
}));

vi.mock("./shared/gridBuilder", () => ({
  buildPieChartConfig: vi.fn((panelSchema, chartPanelRef, data, isDonut) => ({
    radius: isDonut ? ["40%", "70%"] : "70%",
    center: ["50%", "50%"],
  })),
  buildLegendConfig: vi.fn(() => ({ show: true })),
}));

vi.mock("../colorPalette", () => ({
  getSeriesColor: vi.fn(
    (colorConfig, name, values, min, max, theme, colorBySeries) => {
      // Simple mock that returns colors based on name
      const colors: Record<string, string> = {
        series1: "#FF0000",
        series2: "#00FF00",
        series3: "#0000FF",
      };
      return colors[name] || "#CCCCCC";
    },
  ),
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

describe("PieConverter", () => {
  let converter: PieConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new PieConverter();
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
    it("should support pie and donut chart types", () => {
      expect(converter.supportedTypes).toEqual(["pie", "donut"]);
    });
  });

  describe("convert", () => {
    it("should convert data to pie chart format", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1609459200000, "100"]],
            },
            {
              name: "series2",
              values: [[1609459200000, "200"]],
            },
          ],
          timestamps: [1609459200000],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toHaveLength(1);
      expect(result.series[0].type).toBe("pie");
      expect(result.series[0].data).toHaveLength(2);
      expect(result.tooltip).toBeDefined();
    });

    it("should populate extras.legends with series names", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu",
              values: [[1, "50"]],
            },
            {
              name: "memory",
              values: [[1, "75"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toEqual(["cpu", "memory"]);
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
            },
          ],
          timestamps: [1, 2, 3],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

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
            },
          ],
          timestamps: [1, 2, 3],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
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

      expect(result.series[0].data[0].value).toBe(60);
    });

    it("should sort data by value descending by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "small",
              values: [[1, "10"]],
            },
            {
              name: "large",
              values: [[1, "100"]],
            },
            {
              name: "medium",
              values: [[1, "50"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].name).toBe("large");
      expect(result.series[0].data[1].name).toBe("medium");
      expect(result.series[0].data[2].name).toBe("small");
    });

    it("should not sort data when sort_data is false", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "first",
              values: [[1, "10"]],
            },
            {
              name: "second",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {
          sort_data: false,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].name).toBe("first");
      expect(result.series[0].data[1].name).toBe("second");
    });

    it("should apply colors to series", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].itemStyle).toBeDefined();
      expect(result.series[0].data[0].itemStyle.color).toBe("#FF0000");
    });

    it("should pass color configuration to getSeriesColor", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {
          color: {
            colorBySeries: [{ value: "series1", color: "#CUSTOM" }],
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toBeDefined();
    });

    it("should handle donut chart type", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "donut",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].radius).toEqual(["40%", "70%"]);
    });

    it("should handle pie chart type (not donut)", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].radius).toBe("70%");
    });

    it("should show labels by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.show).toBe(true);
    });

    it("should hide labels when show_label is false", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {
          show_label: false,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.show).toBe(false);
    });

    it("should show label lines by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].labelLine.show).toBe(true);
    });

    it("should hide label lines when show_label_line is false", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {
          show_label_line: false,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].labelLine.show).toBe(false);
    });

    it("should apply custom label font size", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {
          label_font_size: 18,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.fontSize).toBe(18);
    });

    it("should use default label font size of 12", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.fontSize).toBe(12);
    });

    describe("label formatter", () => {
      it("should format label with default format", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [[1, "100"]],
              },
            ],
            timestamps: [1],
            queryIndex: 0,
          },
        ];

        const panelSchema = {
          type: "pie",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          name: "series1",
          value: 100,
          percent: 50,
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("series1: 100.00 (50.0%)");
      });

      it("should format label with custom label_format", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [[1, "100"]],
              },
            ],
            timestamps: [1],
            queryIndex: 0,
          },
        ];

        const panelSchema = {
          type: "pie",
          config: {
            label_format: "{b}: {c} ({d}%)",
          },
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          name: "series1",
          value: 100,
          percent: 50.0,
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("series1: 100.00 (50.0%)");
      });

      it("should format label with unit", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "memory",
                values: [[1, "2048"]],
              },
            ],
            timestamps: [1],
            queryIndex: 0,
          },
        ];

        const panelSchema = {
          type: "pie",
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

        const params = {
          name: "memory",
          value: 2048,
          percent: 100,
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toContain("2.00KB");
      });

      it("should format label with custom unit in label_format", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "requests",
                values: [[1, "150"]],
              },
            ],
            timestamps: [1],
            queryIndex: 0,
          },
        ];

        const panelSchema = {
          type: "pie",
          config: {
            unit: "custom",
            unit_custom: "req/s",
            decimals: 1,
            label_format: "{b}: {c}",
          },
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          name: "requests",
          value: 150,
          percent: 100,
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("requests: 150.0req/s");
      });
    });

    it("should configure tooltip with item trigger", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.trigger).toBe("item");
    });

    it("should configure emphasis effect", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].emphasis).toBeDefined();
      expect(result.series[0].emphasis.itemStyle.shadowBlur).toBe(10);
      expect(result.series[0].emphasis.itemStyle.shadowOffsetX).toBe(0);
      expect(result.series[0].emphasis.itemStyle.shadowColor).toBe(
        "rgba(0, 0, 0, 0.5)",
      );
    });

    it("should handle multiple queries", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "query1_series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
        {
          series: [
            {
              name: "query2_series1",
              values: [[1, "200"]],
            },
          ],
          timestamps: [1],
          queryIndex: 1,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toHaveLength(2);
    });

    it("should calculate min and max values correctly", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "low",
              values: [[1, "10"]],
            },
            {
              name: "high",
              values: [[1, "1000"]],
            },
            {
              name: "mid",
              values: [[1, "500"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      // Min should be 10, max should be 1000
      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toHaveLength(3);
    });

    it("should handle empty processed data", () => {
      const processedData: ProcessedPromQLData[] = [];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([]);
    });

    it("should handle empty series", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [],
          timestamps: [],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([]);
    });

    it("should handle chartPanelRef parameter", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
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

    it("should pass dynamic center to series", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].center).toEqual(["50%", "50%"]);
    });

    it("should handle empty config", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [[1, "100"]],
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result).toBeDefined();
      expect(result.series[0].data).toHaveLength(1);
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
            },
          ],
          timestamps: [1],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "pie",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data[0].itemStyle).toBeUndefined();
    });
  });
});
