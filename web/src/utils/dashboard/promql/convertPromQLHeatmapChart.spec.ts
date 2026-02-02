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
import { HeatmapConverter } from "./convertPromQLHeatmapChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock dependencies
vi.mock("../convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((obj) => {
    const { unit, value } = obj;
    if (!value && value !== 0) return null;
    if (["$", "€", "£", "¥", "₹"].includes(unit)) {
      return `${unit}${value}`;
    }
    return `${value}${unit}`;
  }),
  getUnitValue: vi.fn((value, unit, unitCustom, decimals = 2) => {
    if (value === null || value === undefined) {
      return { value: null, unit: "" };
    }
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

describe("HeatmapConverter", () => {
  let converter: HeatmapConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new HeatmapConverter();
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
    it("should support heatmap chart type", () => {
      expect(converter.supportedTypes).toEqual(["heatmap"]);
    });
  });

  describe("convert", () => {
    it("should convert data to heatmap format", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1609459200000": "10",
                "1609459260000": "20",
              },
            },
          ],
          timestamps: [
            [1609459200000, "2021-01-01 00:00:00"],
            [1609459260000, "2021-01-01 00:01:00"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toHaveLength(1);
      expect(result.series[0].type).toBe("heatmap");
      expect(result.series[0].data).toHaveLength(2);
      expect(result.xAxis[0].type).toBe("category");
      expect(result.yAxis.type).toBe("category");
      expect(result.visualMap).toBeDefined();
    });

    it("should populate extras.legends with series names", () => {
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
        type: "heatmap",
        config: {},
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toEqual(["cpu", "memory"]);
    });

    it("should create 3D data points [timeIndex, seriesIndex, value]", () => {
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
            [1, "00:00:00"],
            [2, "00:00:01"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([
        [0, 0, 10], // timeIndex=0, seriesIndex=0, value=10
        [1, 0, 20], // timeIndex=1, seriesIndex=0, value=20
        [0, 1, 30], // timeIndex=0, seriesIndex=1, value=30
        [1, 1, 40], // timeIndex=1, seriesIndex=1, value=40
      ]);
    });

    it("should handle missing data values as 0", () => {
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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toContainEqual([1, 0, 0]); // Missing value defaults to 0
    });

    it("should calculate min and max values correctly", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "series1",
              values: [],
              data: {
                "1": "5",
                "2": "100",
                "3": "50",
              },
            },
          ],
          timestamps: [
            [1, "00:00:00"],
            [2, "00:00:01"],
            [3, "00:00:02"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.min).toBe(0);
      expect(result.visualMap.max).toBe(100);
    });

    it("should set xAxis data from formatted timestamps", () => {
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
          timestamps: [
            [1, "2021-01-01 00:00:00"],
            [2, "2021-01-01 00:01:00"],
          ],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      // The implementation extracts only the time portion (HH:MM:SS) from timestamps
      expect(result.xAxis[0].data).toEqual(["00:00:00", "00:01:00"]);
    });

    it("should set yAxis data from series names", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu",
              values: [],
              data: {
                "1": "10",
              },
            },
            {
              name: "memory",
              values: [],
              data: {
                "1": "20",
              },
            },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.yAxis.data).toEqual(["cpu", "memory"]);
    });

    it("should apply custom axis width", () => {
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
        type: "heatmap",
        config: {
          axis_width: 200,
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.yAxis.axisLabel.width).toBe(200);
    });

    it("should use default axis width of 150", () => {
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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.yAxis.axisLabel.width).toBe(150);
    });

    it("should configure visualMap", () => {
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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.visualMap.calculable).toBe(true);
      expect(result.visualMap.orient).toBe("horizontal");
      expect(result.visualMap.left).toBe("center");
    });

    it("should configure tooltip for light theme", () => {
      mockStore.state.theme = "light";

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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.textStyle.color).toBe("#000");
      expect(result.tooltip.backgroundColor).toBe("rgba(255,255,255,1)");
    });

    it("should configure tooltip for dark theme", () => {
      mockStore.state.theme = "dark";

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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.tooltip.textStyle.color).toBe("#fff");
      expect(result.tooltip.backgroundColor).toBe("rgba(0,0,0,1)");
    });

    describe("label formatter", () => {
      it("should format label with default format", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 100],
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("100.00");
      });

      it("should format label with unit", () => {
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
          type: "heatmap",
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
          value: [0, 0, 2048],
        };

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("2.00KB");
      });

      it("should handle formatter error and return raw value", async () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 100],
        };

        // Mock getUnitValue to throw an error
        const { getUnitValue } = await import("../convertDataIntoUnitValue");
        vi.mocked(getUnitValue).mockImplementationOnce(() => {
          throw new Error("Test error");
        });

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("100");
      });

      it("should return empty string when value is undefined", async () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: undefined,
        };

        // Mock getUnitValue to throw an error
        const { getUnitValue } = await import("../convertDataIntoUnitValue");
        vi.mocked(getUnitValue).mockImplementationOnce(() => {
          throw new Error("Test error");
        });

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe("");
      });

      it("should use fallback value when formatUnitValue returns null", async () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 42],
        };

        // Mock formatUnitValue to return null
        const { formatUnitValue } = await import("../convertDataIntoUnitValue");
        vi.mocked(formatUnitValue).mockReturnValueOnce(null);

        const formatted = result.series[0].label.formatter(params);

        expect(formatted).toBe(42);
      });
    });

    describe("tooltip formatter", () => {
      it("should format tooltip with series name and value", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "cpu_usage",
                values: [],
                data: {
                  "1": "75",
                },
              },
            ],
            timestamps: [[1, "2021-01-01 00:00:00"]],
            queryIndex: 0,
          },
        ];

        const panelSchema = {
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 75],
          name: "2021-01-01 00:00:00",
          marker: '<span style="color:red">●</span>',
          seriesName: "cpu_usage",
        };

        const formatted = result.tooltip.formatter(params);

        expect(formatted).toContain("cpu_usage");
        expect(formatted).toContain("2021-01-01 00:00:00");
        expect(formatted).toContain("75.00");
      });

      it("should format tooltip with unit", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "memory",
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
          type: "heatmap",
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
          value: [0, 0, 2048],
          name: "00:00:00",
          marker: '<span style="color:blue">●</span>',
          seriesName: "memory",
        };

        const formatted = result.tooltip.formatter(params);

        expect(formatted).toContain("2.00KB");
      });

      it("should handle tooltip formatter error and return empty string", async () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 100],
          name: "00:00:00",
        };

        // Mock getUnitValue to throw an error
        const { getUnitValue } = await import("../convertDataIntoUnitValue");
        vi.mocked(getUnitValue).mockImplementationOnce(() => {
          throw new Error("Test error");
        });

        const formatted = result.tooltip.formatter(params);

        expect(formatted).toBe("");
      });

      it("should use fallback value when formatUnitValue returns null in tooltip", async () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 0, 42],
          name: "00:00:00",
          marker: "●",
          seriesName: "series1",
        };

        // Mock formatUnitValue to return null
        const { formatUnitValue } = await import("../convertDataIntoUnitValue");
        vi.mocked(formatUnitValue).mockReturnValueOnce(null);

        const formatted = result.tooltip.formatter(params);

        expect(formatted).toContain("42");
      });

      it("should use seriesName fallback when seriesIndex is invalid", () => {
        const processedData: ProcessedPromQLData[] = [
          {
            series: [
              {
                name: "series1",
                values: [],
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
          type: "heatmap",
          config: {},
        };

        const result = converter.convert(
          processedData,
          panelSchema,
          mockStore,
          mockExtras,
        );

        const params = {
          value: [0, 999, 100], // Invalid series index
          name: "00:00:00",
          marker: "●",
          seriesName: "fallback_name",
        };

        const formatted = result.tooltip.formatter(params);

        expect(formatted).toContain("fallback_name");
      });
    });

    it("should configure emphasis effect", () => {
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
        type: "heatmap",
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
      expect(result.series[0].emphasis.itemStyle.shadowColor).toBe(
        "rgba(0, 0, 0, 0.5)",
      );
    });

    it("should configure grid layout", () => {
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
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.grid.left).toBe("3%");
      expect(result.grid.right).toBe("4%");
      expect(result.grid.bottom).toBe(60);
      expect(result.grid.containLabel).toBe(true);
    });

    it("should handle empty processed data", () => {
      const processedData: ProcessedPromQLData[] = [];

      const panelSchema = {
        type: "heatmap",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].data).toEqual([]);
      expect(result.xAxis[0].data).toEqual([]);
      expect(result.yAxis.data).toEqual([]);
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
        type: "heatmap",
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

    it("should handle empty config", () => {
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
        type: "heatmap",
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

    it("should handle chartPanelRef parameter", () => {
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
        type: "heatmap",
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
  });
});
