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
import {
  HeatmapConverter,
  PROMETHEUS_HISTOGRAM_MODE,
} from "./convertPromQLHeatmapChart";
import type { ProcessedPromQLData } from "./shared/types";
import { SPECTRAL_HEATMAP_STOP_COUNT } from "./shared/spectral";
import { chartColor } from "@/utils/chartTheme";

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

  describe("the time axis spans every query, not just the first", () => {
    const panelSchema = { type: "heatmap", config: {} };
    const histogramSchema = {
      type: "heatmap",
      config: { heatmap_mode: PROMETHEUS_HISTOGRAM_MODE },
    };

    it("still charts the other queries when the FIRST one returned nothing", () => {
      // The axis used to come from `processedData[0].timestamps`. An empty first
      // query therefore emptied the axis, and the panel rendered blank — with a
      // perfectly good second query sitting right there. Someone whose first
      // query is typo'd, or whose first metric is simply idle over the range,
      // reads that as a total outage.
      const processedData: ProcessedPromQLData[] = [
        { series: [], timestamps: [], queryIndex: 0 }, // no data in range
        {
          series: [
            { name: "live", values: [], data: { "1": "7", "2": "9" } },
          ],
          timestamps: [
            [1, "00:00:00"],
            [2, "00:00:01"],
          ],
          queryIndex: 1,
        },
      ];

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.xAxis[0].data).toEqual(["00:00:00", "00:00:01"]);
      expect(result.series[0].data).toEqual([
        [0, 0, 7],
        [1, 0, 9],
      ]);
      expect(result.visualMap.max).toBe(9);
    });

    it("puts each query's samples in the column of their own instant", () => {
      // Two queries on different grids. The cell's column used to be the sample's
      // index within ITS OWN query, so query 2 — which starts one step later —
      // had its 00:00:01 sample drawn in column 0, i.e. at 00:00:00, under a
      // label belonging to a different moment.
      const processedData: ProcessedPromQLData[] = [
        {
          series: [{ name: "a", values: [], data: { "1": "1", "2": "2" } }],
          timestamps: [
            [1, "00:00:00"],
            [2, "00:00:01"],
          ],
          queryIndex: 0,
        },
        {
          series: [{ name: "b", values: [], data: { "2": "5", "3": "6" } }],
          timestamps: [
            [2, "00:00:01"],
            [3, "00:00:02"],
          ],
          queryIndex: 1,
        },
      ];

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      // Union of both grids, ascending.
      expect(result.xAxis[0].data).toEqual(["00:00:00", "00:00:01", "00:00:02"]);
      // Series b (row 1) sits at columns 1 and 2 — NOT 0 and 1.
      expect(result.series[0].data).toEqual([
        [0, 0, 1],
        [1, 0, 2],
        [1, 1, 5],
        [2, 1, 6],
      ]);
    });

    it("reads a histogram's buckets against the shared axis", () => {
      // The buckets are flat-mapped across every query, but their samples were
      // looked up against query 0's timestamps: `bucket.data[ts] ?? 0`. A second
      // histogram on a later grid silently read as all-zero — a heatmap of solid
      // background colour, which looks exactly like "this bucket is empty".
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: 'a{le="1"}', values: [], data: { "1": "4" }, metric: { le: "1" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
        {
          series: [
            { name: 'b{le="2"}', values: [], data: { "2": "8" }, metric: { le: "2" } },
          ],
          timestamps: [[2, "00:00:01"]],
          queryIndex: 1,
        },
      ];

      const result = converter.convert(
        processedData,
        histogramSchema,
        mockStore,
        mockExtras,
      );

      expect(result.xAxis[0].data).toEqual(["00:00:00", "00:00:01"]);
      // The second histogram's 8 must survive — it used to be read as 0.
      expect(result.visualMap.max).toBe(8);
      expect(result.series[0].data).toContainEqual([1, 1, 8]);
    });
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

      expect(result.tooltip.textStyle.color).toBe(
        chartColor("--color-tooltip-text"),
      );
      expect(result.tooltip.backgroundColor).toBe(
        chartColor("--color-tooltip-bg"),
      );
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

      expect(result.tooltip.textStyle.color).toBe(
        chartColor("--color-tooltip-text"),
      );
      expect(result.tooltip.backgroundColor).toBe(
        chartColor("--color-tooltip-bg"),
      );
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

  describe("prometheus histogram mode (opt-in)", () => {
    const timestamps: Array<[number, Date | string]> = [
      [100, "2024-01-01T00:00:00"],
      [200, "2024-01-01T00:01:00"],
    ];

    // Cumulative buckets, deliberately out of order, using the lowercase OTLP
    // "inf" spelling for the last bucket.
    const histogramData = (): ProcessedPromQLData[] => [
      {
        timestamps: [...timestamps],
        series: [
          {
            name: '{le="1"}',
            metric: { le: "1" },
            values: [],
            data: { 100: "9", 200: "4" },
          },
          {
            name: '{le="0.1"}',
            metric: { le: "0.1" },
            values: [],
            data: { 100: "2", 200: "1" },
          },
          {
            name: '{le="inf"}',
            metric: { le: "inf" },
            values: [],
            data: { 100: "15", 200: "10" },
          },
          {
            name: '{le="0.5"}',
            metric: { le: "0.5" },
            values: [],
            data: { 100: "5", 200: "1" },
          },
        ],
        queryIndex: 0,
        queryConfig: {},
      },
    ];

    const histogramSchema = (config: any = {}) => ({
      type: "heatmap",
      config: {
        heatmap_mode: "prometheus_histogram",
        bucket_unit: "seconds",
        unit: "custom",
        unit_custom: "c/s",
        ...config,
      },
    });

    it("sorts le bounds ascending on the y-axis with +Inf last", () => {
      const result: any = converter.convert(
        histogramData(),
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      // "seconds" is not special-cased by the mocked getUnitValue, so finite
      // bounds come back as value.toFixed(2); +Inf is a literal.
      expect(result.yAxis.data).toEqual(["0.10", "0.50", "1.00", "+Inf"]);
      expect(mockExtras.legends).toEqual(["0.10", "0.50", "1.00", "+Inf"]);
    });

    it("de-accumulates the cumulative buckets into cell values", () => {
      const result: any = converter.convert(
        histogramData(),
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      // [timeIndex, bucketIndex, value]
      // t=100 cumulative 2, 5, 9, 15 -> 2, 3, 4, 6
      // t=200 cumulative 1, 1, 4, 10 -> 1, 0, 3, 6
      expect(result.series[0].data).toEqual([
        [0, 0, 2],
        [1, 0, 1],
        [0, 1, 3],
        [1, 1, 0],
        [0, 2, 4],
        [1, 2, 3],
        [0, 3, 6],
        [1, 3, 6],
      ]);
    });

    it("falls back to the series name when metric labels are absent", () => {
      const data = histogramData();
      data[0].series = data[0].series.map(
        ({ metric: _metric, ...rest }) => rest,
      ) as any;

      const result: any = converter.convert(
        data,
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      expect(result.yAxis.data).toEqual(["0.10", "0.50", "1.00", "+Inf"]);
    });

    it("hides cell labels and uses the Spectral visualMap", () => {
      const result: any = converter.convert(
        histogramData(),
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label).toEqual({ show: false });

      expect(result.visualMap.min).toBe(0);
      expect(result.visualMap.max).toBe(6);
      expect(result.visualMap.calculable).toBe(true);
      expect(result.visualMap.inRange.color).toHaveLength(SPECTRAL_HEATMAP_STOP_COUNT);
      // Cool at the LOW end, hot at the high end. Reversed from ColorBrewer's
      // published (warm-first) Spectral order: the eye reads hot as "more", so
      // red-at-low made a histogram's near-empty high-`le` rows the loudest
      // thing on the chart while the busy low buckets sank into blue.
      expect(result.visualMap.inRange.color[0]).toBe("#5e4fa2");
      expect(result.visualMap.inRange.color.at(-1)).toBe("#9e0142");
      // Exponent 0.5 is pre-warped into the stop positions, so the midpoint
      // stop is sampled from the ramp well past its middle.
      expect(result.visualMap.inRange.color[16]).not.toBe(
        result.visualMap.inRange.color[15],
      );
    });

    it("keeps config.unit as the cell-intensity unit in the tooltip", () => {
      const result: any = converter.convert(
        histogramData(),
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      const tooltip = result.tooltip.formatter({
        value: [0, 0, 2],
        marker: "M",
        name: "00:00:00",
      });

      // unit: "custom" + unit_custom: "c/s" via the mocked getUnitValue
      expect(tooltip).toContain("le 0.10");
      expect(tooltip).toContain("2.00c/s");
    });

    it("drops buckets whose le cannot be parsed", () => {
      const data = histogramData();
      data[0].series.push({
        name: "garbage",
        metric: { le: "not-a-number" },
        values: [],
        data: { 100: "999", 200: "999" },
      } as any);

      const result: any = converter.convert(
        data,
        histogramSchema(),
        mockStore,
        mockExtras,
      );

      expect(result.yAxis.data).toHaveLength(4);
      expect(result.series[0].data.some((cell: any) => cell[2] === 999)).toBe(
        false,
      );
    });

    it("leaves generic heatmaps untouched (no histogram transform)", () => {
      const data = histogramData();

      const histogram: any = converter.convert(
        data,
        histogramSchema(),
        mockStore,
        { legends: [] },
      );

      const generic: any = converter.convert(
        histogramData(),
        // no heatmap_mode -> existing behavior
        { type: "heatmap", config: { unit: "custom", unit_custom: "c/s" } },
        mockStore,
        { legends: [] },
      );

      // y-axis is still the raw series names, in insertion order
      expect(generic.yAxis.data).toEqual([
        '{le="1"}',
        '{le="0.1"}',
        '{le="inf"}',
        '{le="0.5"}',
      ]);
      // raw cumulative values, NOT de-accumulated
      expect(generic.series[0].data).toEqual([
        [0, 0, 9],
        [1, 0, 4],
        [0, 1, 2],
        [1, 1, 1],
        [0, 2, 15],
        [1, 2, 10],
        [0, 3, 5],
        [1, 3, 1],
      ]);
      // labels still shown, max is the raw max
      expect(generic.series[0].label.show).toBe(true);
      expect(generic.visualMap.max).toBe(15);

      // The DATA transform stays opt-in, but the LOOK is shared: a generic
      // heatmap gets the same Spectral ramp and cell borders as every other
      // heatmap in the app. Styling is not what corrupts a heatmap; the
      // de-accumulation is, and that is still gated on heatmap_mode.
      expect(generic.visualMap.inRange.color).toHaveLength(SPECTRAL_HEATMAP_STOP_COUNT);
      expect(generic.visualMap.inRange.color).toEqual(
        histogram.visualMap.inRange.color,
      );
      expect(generic.series[0].itemStyle.borderWidth).toBe(1);
      expect(generic.xAxis[0].splitArea.show).toBe(false);

      // ...and the histogram result really is different where it matters
      expect(histogram.yAxis.data).not.toEqual(generic.yAxis.data);
      expect(histogram.series[0].data).not.toEqual(generic.series[0].data);
    });

    it("ignores an unrelated heatmap_mode value", () => {
      const result: any = converter.convert(
        histogramData(),
        { type: "heatmap", config: { heatmap_mode: "something_else" } },
        mockStore,
        { legends: [] },
      );

      // No de-accumulation, no le-sort — the mode string has to match exactly.
      expect(result.yAxis.data).toEqual([
        '{le="1"}',
        '{le="0.1"}',
        '{le="inf"}',
        '{le="0.5"}',
      ]);
      expect(result.series[0].data[0]).toEqual([0, 0, 9]);
      // The shared look still applies — it is presentation, not a transform.
      expect(result.visualMap.inRange.color).toHaveLength(SPECTRAL_HEATMAP_STOP_COUNT);
    });
  });
});

describe("regressions", () => {
  const converter = new HeatmapConverter();
  const store = { state: { timezone: "UTC", theme: "light" } };

  const query = (queryIndex: number, names: string[]): ProcessedPromQLData =>
    ({
      series: names.map((name) => ({
        name,
        values: [],
        data: { "1000": "1", "2000": "2" },
      })),
      timestamps: [
        [1000, "2021-01-01 00:00:00"],
        [2000, "2021-01-01 00:01:00"],
      ],
      queryIndex,
    }) as any;

  it("gives every series across ALL queries its own row", () => {
    // The row was the series' index within ITS OWN query, which restarts at 0 —
    // so a second query's series were drawn on top of the first's rows, and the
    // categories they should have occupied stayed blank. A two-query heatmap
    // silently charted the wrong series against the wrong labels.
    const extras = { legends: [] as string[] };
    const result: any = converter.convert(
      [query(0, ["a1", "a2"]), query(1, ["b1", "b2"])],
      { type: "heatmap", config: {} },
      store,
      extras,
    );

    expect(result.yAxis.data).toEqual(["a1", "a2", "b1", "b2"]);

    // Every row on the axis is addressed by at least one cell, and no row is
    // addressed twice per timestamp.
    const rows = new Set(result.series[0].data.map((cell: any) => cell[1]));
    expect([...rows].sort()).toEqual([0, 1, 2, 3]);
    expect(result.series[0].data).toHaveLength(4 * 2); // 4 series x 2 timestamps
  });

  it("scales an all-negative heatmap over its real range", () => {
    // The floor was hardcoded to 0, so a metric that is negative throughout gave
    // ECharts the inverted range [0, negative] and every cell came out one flat
    // colour.
    const negative: any = {
      series: [{ name: "s", values: [], data: { "1000": "-5", "2000": "-1" } }],
      timestamps: [
        [1000, "t1"],
        [2000, "t2"],
      ],
      queryIndex: 0,
    };
    const result: any = converter.convert(
      [negative],
      { type: "heatmap", config: {} },
      store,
      { legends: [] },
    );

    expect(result.visualMap.min).toBe(-5);
    expect(result.visualMap.max).toBe(-1);
  });

  it("still floors an ordinary, non-negative heatmap at zero", () => {
    const result: any = converter.convert(
      [query(0, ["a"])],
      { type: "heatmap", config: {} },
      store,
      { legends: [] },
    );
    expect(result.visualMap.min).toBe(0);
    expect(result.visualMap.max).toBe(2);
  });
});

describe("prometheus_histogram mode with more than one query", () => {
  const converter = new HeatmapConverter();
  const store = { state: { timezone: "UTC", theme: "light" } };

  /** One cumulative histogram: le=0.5 -> 10, le=+Inf -> 30. */
  const histogram = (queryIndex: number, base: number): any => ({
    series: [
      { name: `le="0.5"`, metric: { le: "0.5" }, values: [], data: { "1000": String(base) } },
      { name: `le="+Inf"`, metric: { le: "+Inf" }, values: [], data: { "1000": String(base * 3) } },
    ],
    timestamps: [[1000, "t1"]],
    queryIndex,
  });

  it("de-accumulates each query on its own instead of merging their buckets", () => {
    // The bucket set is keyed on `le`, and de-accumulation SORTS by `le` and
    // de-duplicates. Flattening two histograms into one list therefore made the
    // second one's `le="0.5"` either vanish as a duplicate of the first's, or get
    // subtracted from it as though it were the next bucket up.
    const result: any = converter.convert(
      [histogram(0, 10), histogram(1, 100)],
      { type: "heatmap", config: { heatmap_mode: "prometheus_histogram" } },
      store,
      { legends: [] },
    );

    // Both histograms survive: 2 buckets each, 4 rows — not 2.
    expect(result.yAxis.data).toHaveLength(4);
    expect(result.series[0].data).toHaveLength(4); // 4 buckets x 1 timestamp

    // Query 1: 10 in the first bucket, 30-10=20 in +Inf.
    // Query 2: 100 and 300-100=200. Nothing merged, nothing subtracted across.
    const values = result.series[0].data.map((cell: any) => cell[2]).sort((a: number, b: number) => a - b);
    expect(values).toEqual([10, 20, 100, 200]);
  });
});

describe("bucket labels must be unique — ECharts category axes require it", () => {
  const converter = new HeatmapConverter();
  const store = { state: { timezone: "UTC", theme: "light" } };

  const histAtHalf = (queryIndex: number, n: number): any => ({
    series: [
      { name: "a", metric: { le: "0.5" }, values: [], data: { "1000": String(n) } },
      { name: "b", metric: { le: "+Inf" }, values: [], data: { "1000": String(n * 2) } },
    ],
    timestamps: [[1000, "t1"]],
    queryIndex,
  });

  it("disambiguates THREE queries that all carry the same le", () => {
    // Now that each query is de-accumulated on its own (so two histograms in one
    // panel both survive), two of them can carry an identical `le`. The old
    // single-step fallback appended the raw `le` — which is the SAME for both, so
    // it disambiguated nothing, and a third collided again.
    const result: any = converter.convert(
      [histAtHalf(0, 10), histAtHalf(1, 20), histAtHalf(2, 30)],
      { type: "heatmap", config: { heatmap_mode: "prometheus_histogram" } },
      store,
      { legends: [] },
    );

    const labels: string[] = result.yAxis.data;
    expect(labels).toHaveLength(6); // 3 histograms x 2 buckets
    expect(new Set(labels).size).toBe(labels.length); // ...all distinct
  });
});

describe("compact_preview shrinks the heatmap for the metrics explorer cards", () => {
  const converter = new HeatmapConverter();
  const store = { state: { timezone: "UTC", theme: "light" } };

  // A small classic histogram: two buckets over one timestamp.
  const processedData: ProcessedPromQLData[] = [
    {
      series: [
        { name: "a", metric: { le: "0.5" }, values: [], data: { "1000": "3" } },
        { name: "b", metric: { le: "+Inf" }, values: [], data: { "1000": "7" } },
      ],
      timestamps: [[1000, "t1"]],
      queryIndex: 0,
    },
  ];

  const convertWith = (extraConfig: Record<string, any>) =>
    converter.convert(
      processedData,
      {
        type: "heatmap",
        config: { heatmap_mode: "prometheus_histogram", ...extraConfig },
      },
      store,
      { legends: [] },
    ) as any;

  it("leaves the full-size look untouched when the flag is absent", () => {
    const result = convertWith({});
    // Default ECharts colour bar — no card sizing applied.
    expect(result.visualMap.itemWidth).toBeUndefined();
    expect(result.grid.top).toBeUndefined();
    expect(result.yAxis.axisLabel.fontSize).toBeUndefined();
  });

  it("shrinks the colour bar and pins it under the axis", () => {
    const result = convertWith({ compact_preview: true });
    expect(result.visualMap).toMatchObject({
      orient: "horizontal",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 90,
      textStyle: { fontSize: 9 },
    });
    // Room for the bar; no top gap on a short card.
    expect(result.grid.top).toBe(8);
    expect(result.grid.bottom).toBe(26);
  });

  it("thins the bucket labels but always keeps the top +Inf row", () => {
    const result = convertWith({ compact_preview: true });
    const axisLabel = result.yAxis.axisLabel;
    expect(axisLabel.fontSize).toBe(9);
    // The interval predicate is indexed from the bottom; the TOP row (highest
    // index = +Inf) must always be labelled.
    const rowCount = result.yAxis.data.length;
    expect(axisLabel.interval(rowCount - 1)).toBe(true);
  });

  it("shrinks the x-axis time labels", () => {
    const result = convertWith({ compact_preview: true });
    expect(result.xAxis[0].axisLabel).toMatchObject({
      fontSize: 9,
      hideOverlap: true,
    });
  });

  it("portals the tooltip regardless of the compact flag (not a card-only concern)", () => {
    // Same treatment as the other PromQL charts — a heatmap on a dashboard with
    // overflow-hidden clips its tooltip too, so this is not gated on the card.
    expect(convertWith({}).tooltip.appendToBody).toBe(true);
    expect(convertWith({ compact_preview: true }).tooltip.appendToBody).toBe(
      true,
    );
  });
});
