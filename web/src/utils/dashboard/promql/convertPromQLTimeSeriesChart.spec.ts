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
import { TimeSeriesConverter } from "./convertPromQLTimeSeriesChart";
import type { ProcessedPromQLData } from "./shared/types";

// Mock dependencies
vi.mock("./shared/dataProcessor", () => ({
  fillMissingTimestamps: vi.fn((data, timestamps) => {
    return timestamps.map(([ts]: any) => data[ts] ?? null);
  }),
}));

vi.mock("./shared/axisBuilder", () => ({
  buildXAxis: vi.fn(() => ({ type: "time" })),
  buildYAxis: vi.fn(() => ({ type: "value" })),
  buildTooltip: vi.fn(() => ({ trigger: "axis" })),
}));

vi.mock("./shared/gridBuilder", () => ({
  buildDynamicGrid: vi.fn(() => ({ left: "10%", right: "10%" })),
  buildLegendConfig: vi.fn(() => ({ show: true })),
}));

vi.mock("../colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF0000"),
}));

describe("TimeSeriesConverter", () => {
  let converter: TimeSeriesConverter;
  let mockStore: any;
  let mockExtras: any;

  beforeEach(() => {
    converter = new TimeSeriesConverter();
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
    it("should support line, area, area-stacked, bar, and scatter types", () => {
      expect(converter.supportedTypes).toEqual([
        "line",
        "area",
        "area-stacked",
        "bar",
        "scatter",
      ]);
    });
  });

  describe("convert - line chart", () => {
    it("should convert to line chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            {
              name: "cpu",
              values: [
                [1, "10"],
                [2, "20"],
              ],
              data: { "1": "10", "2": "20" },
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
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toHaveLength(1);
      expect(result.series[0].type).toBe("line");
      expect(result.series[0].name).toBe("cpu");
    });

    it("should apply line thickness", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { line_thickness: 3 },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].lineStyle.width).toBe(3);
    });

    it("should use default line thickness", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].lineStyle.width).toBe(1.5);
    });

    it("should apply smooth interpolation by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].smooth).toBe(true);
      expect(result.series[0].step).toBe(false);
    });

    it("should apply linear interpolation when specified", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { line_interpolation: "linear" },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].smooth).toBe(false);
    });

    it("should apply step-start interpolation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { line_interpolation: "step-start" },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].step).toBe("start");
    });

    it("should apply step-end interpolation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { line_interpolation: "step-end" },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].step).toBe("end");
    });

    it("should apply step-middle interpolation", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { line_interpolation: "step-middle" },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].step).toBe("middle");
    });

    it("should hide symbols by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].showSymbol).toBe(false);
    });

    it("should show symbols when configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { show_symbol: true },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].showSymbol).toBe(true);
    });

    it("should not connect nulls by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].connectNulls).toBe(false);
    });

    it("should connect nulls when configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: { connect_nulls: true },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].connectNulls).toBe(true);
    });
  });

  describe("convert - area chart", () => {
    it("should convert to area chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "area",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].type).toBe("line");
      expect(result.series[0].areaStyle).toBeDefined();
    });

    it("should apply line thickness for area", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "area",
        config: { line_thickness: 2.5 },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].lineStyle.width).toBe(2.5);
    });
  });

  describe("convert - area-stacked chart", () => {
    it("should convert to stacked area chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
            { name: "series2", values: [[1, "20"]], data: { "1": "20" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "area-stacked",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].stack).toBe("Total");
      expect(result.series[1].stack).toBe("Total");
      expect(result.series[0].areaStyle).toBeDefined();
    });
  });

  describe("convert - bar chart", () => {
    it("should convert to bar chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "bar",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].type).toBe("bar");
    });

    it("should apply bar width", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "bar",
        config: { bar_width: 20 },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].barWidth).toBe(20);
    });
  });

  describe("convert - scatter chart", () => {
    it("should convert to scatter chart", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "scatter",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].type).toBe("scatter");
    });

    it("should apply symbol size", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "scatter",
        config: { symbol_size: 15 },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].symbolSize).toBe(15);
    });
  });

  describe("labels", () => {
    it("should hide labels by default", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.show).toBe(false);
    });

    it("should show labels when position is set", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {
          label_option: {
            position: "top",
            rotate: 45,
          },
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].label.show).toBe(true);
      expect(result.series[0].label.position).toBe("top");
      expect(result.series[0].label.rotate).toBe(45);
    });
  });

  describe("mark lines", () => {
    it("should add mark lines when configured", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {
          mark_lines: [
            {
              name: "Threshold",
              type: "yAxis",
              value: 50,
              color: "#00FF00",
              lineStyle: "dashed",
              width: 2,
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].markLine.data).toHaveLength(1);
      expect(result.series[0].markLine.data[0].yAxis).toBe(50);
      expect(result.series[0].markLine.data[0].lineStyle.color).toBe("#00FF00");
    });

    it("should handle xAxis mark lines", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {
          mark_lines: [
            {
              type: "xAxis",
              value: 1609459200000,
            },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].markLine.data[0].xAxis).toBe(1609459200000);
      expect(result.series[0].markLine.data[0].yAxis).toBeNull();
    });

    it("should skip mark lines with show=false", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {
          mark_lines: [
            { type: "yAxis", value: 50, show: true },
            { type: "yAxis", value: 75, show: false },
          ],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].markLine.data).toHaveLength(1);
    });

    it("should use default mark line styling", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {
          mark_lines: [{ type: "yAxis", value: 50 }],
        },
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].markLine.data[0].lineStyle.color).toBe("#FF0000");
      expect(result.series[0].markLine.data[0].lineStyle.type).toBe("solid");
      expect(result.series[0].markLine.data[0].lineStyle.width).toBe(2);
    });
  });

  describe("colors", () => {
    it("should apply series color", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].itemStyle.color).toBe("#FF0000");
    });

    it("should handle getSeriesColor error", async () => {
      const { getSeriesColor } = await import("../colorPalette");
      vi.mocked(getSeriesColor).mockImplementationOnce(() => {
        throw new Error("Color error");
      });

      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series[0].itemStyle.color).toBeUndefined();
    });
  });

  describe("common features", () => {
    it("should populate legends", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "cpu", values: [[1, "10"]], data: { "1": "10" } },
            { name: "memory", values: [[1, "20"]], data: { "1": "20" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      converter.convert(processedData, panelSchema, mockStore, mockExtras);

      expect(mockExtras.legends).toEqual(["cpu", "memory"]);
    });

    it("should configure axes", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.xAxis).toBeDefined();
      expect(result.yAxis).toBeDefined();
      expect(result.grid).toBeDefined();
      expect(result.tooltip).toBeDefined();
    });

    it("should handle empty data", () => {
      const processedData: ProcessedPromQLData[] = [];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
      );

      expect(result.series).toEqual([]);
    });

    it("should handle chartPanelRef", () => {
      const processedData: ProcessedPromQLData[] = [
        {
          series: [
            { name: "series1", values: [[1, "10"]], data: { "1": "10" } },
          ],
          timestamps: [[1, "00:00:00"]],
          queryIndex: 0,
        },
      ];

      const panelSchema = {
        type: "line",
        config: {},
      };

      const chartPanelRef = { value: { clientWidth: 800, clientHeight: 400 } };

      const result = converter.convert(
        processedData,
        panelSchema,
        mockStore,
        mockExtras,
        chartPanelRef,
      );

      expect(result).toBeDefined();
    });
  });
});
