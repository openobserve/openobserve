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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { convertPromQLChartData } from "./convertPromQLChartData";
import { PromQLResponse, ConversionContext } from "./shared/types";

vi.mock("./shared/dataProcessor", () => ({
  processPromQLData: vi.fn(async () => [
    {
      series: [
        {
          metric: { job: "api" },
          name: "test_metric",
          data: { 1234567890000: 100 },
          values: [[1234567890, "100"]],
        },
      ],
      timestamps: [[1234567890000, "2009-02-13 23:31:30"]],
    },
  ]),
  applyAggregation: vi.fn((values, aggregation) => {
    if (aggregation === "last" && values.length > 0) {
      return parseFloat(values[values.length - 1][1]);
    }
    return 0;
  }),
  fillMissingTimestamps: vi.fn((data) => data),
}));

vi.mock("../legendConfiguration", () => ({
  applyLegendConfiguration: vi.fn(
    (panelSchema, chartPanelRef, hoveredSeriesState, options) => {
      options.legend = {
        show: true,
        type: "scroll",
      };
    },
  ),
  getChartDimensions: vi.fn(() => ({
    chartWidth: 800,
    chartHeight: 600,
  })),
  calculateBottomLegendHeight: vi.fn(() => 50),
  calculateChartDimensions: vi.fn(() => ({
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    availableWidth: 800,
    availableHeight: 600,
  })),
  calculatePieChartRadius: vi.fn(() => 50),
}));

describe("convertPromQLChartData", () => {
  let mockContext: ConversionContext;
  let mockPromQLResponse: PromQLResponse[];

  beforeEach(() => {
    mockContext = {
      panelSchema: {
        type: "line",
        config: {},
        queries: [],
      },
      store: {
        state: {
          theme: "light",
          timezone: "UTC",
        },
      },
      chartPanelRef: null,
      hoveredSeriesState: null,
      annotations: [],
      metadata: null,
    };

    mockPromQLResponse = [
      {
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { job: "api" },
              values: [[1234567890, "100"]],
            },
          ],
        },
      },
    ];
  });

  describe("chart type routing", () => {
    it("should route to TimeSeriesConverter for line charts", async () => {
      mockContext.panelSchema.type = "line";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
      expect(result.options.xAxis).toBeDefined();
      expect(result.options.yAxis).toBeDefined();
    });

    it("should route to TimeSeriesConverter for area charts", async () => {
      mockContext.panelSchema.type = "area";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to TimeSeriesConverter for bar charts", async () => {
      mockContext.panelSchema.type = "bar";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to TimeSeriesConverter for scatter charts", async () => {
      mockContext.panelSchema.type = "scatter";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to PieConverter for pie charts", async () => {
      mockContext.panelSchema.type = "pie";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to PieConverter for donut charts", async () => {
      mockContext.panelSchema.type = "donut";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to TableConverter for table charts", async () => {
      mockContext.panelSchema.type = "table";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.columns).toBeDefined();
      expect(result.options.rows).toBeDefined();
    });

    it("should route to GaugeConverter for gauge charts", async () => {
      mockContext.panelSchema.type = "gauge";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to MetricConverter for metric charts", async () => {
      mockContext.panelSchema.type = "metric";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to HeatmapConverter for heatmap charts", async () => {
      mockContext.panelSchema.type = "heatmap";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to BarConverter for h-bar charts", async () => {
      mockContext.panelSchema.type = "h-bar";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to GeoConverter for geomap charts", async () => {
      mockContext.panelSchema.type = "geomap";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should route to MapsConverter for maps charts", async () => {
      mockContext.panelSchema.type = "maps";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toBeDefined();
    });

    it("should throw error for unsupported chart type", async () => {
      mockContext.panelSchema.type = "unsupported_type" as any;

      await expect(
        convertPromQLChartData(mockPromQLResponse, mockContext),
      ).rejects.toThrow("Unsupported chart type for PromQL: unsupported_type");
    });

    it("should log error for unsupported chart type", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockContext.panelSchema.type = "invalid" as any;

      try {
        await convertPromQLChartData(mockPromQLResponse, mockContext);
      } catch (e) {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "No converter found for chart type: invalid",
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("options configuration", () => {
    it("should set transparent background", async () => {
      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.backgroundColor).toBe("transparent");
    });

    it("should apply axis_width configuration", async () => {
      mockContext.panelSchema.config = {
        axis_width: 100,
      };

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.grid.left).toBe(100);
    });

    it("should preserve existing grid configuration when applying axis_width", async () => {
      mockContext.panelSchema.config = {
        axis_width: 100,
      };

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.grid).toBeDefined();
    });
  });

  describe("legend configuration", () => {
    it("should apply legend configuration for non-table charts", async () => {
      const { applyLegendConfiguration } =
        await import("../legendConfiguration");

      mockContext.panelSchema.type = "line";

      await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(applyLegendConfiguration).toHaveBeenCalled();
    });

    it("should not apply legend configuration for table charts", async () => {
      const { applyLegendConfiguration } =
        await import("../legendConfiguration");
      vi.mocked(applyLegendConfiguration).mockClear();

      mockContext.panelSchema.type = "table";

      await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(applyLegendConfiguration).not.toHaveBeenCalled();
    });
  });

  describe("extras object", () => {
    it("should initialize extras with empty legends array", async () => {
      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.extras.legends).toBeDefined();
      expect(Array.isArray(result.extras.legends)).toBe(true);
    });

    it("should initialize extras with null hoveredSeriesState when not provided", async () => {
      mockContext.hoveredSeriesState = null;

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.extras.hoveredSeriesState).toBeNull();
    });

    it("should pass hoveredSeriesState from context to extras", async () => {
      const hoveredState = { seriesName: "test" };
      mockContext.hoveredSeriesState = hoveredState;

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.extras.hoveredSeriesState).toBe(hoveredState);
    });
  });

  describe("annotations", () => {
    it("should apply line annotations", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          name: "Threshold",
          show_label: true,
          color: "#FF0000",
          line_style: "solid",
          width: 2,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series[0].markLine).toBeDefined();
      expect(result.options.series[0].markLine.data.length).toBeGreaterThan(0);
    });

    it("should apply line annotation on x-axis", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "x",
          value: 1234567890000,
          name: "Event",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data.find(
        (m: any) => m.name === "Event",
      );
      expect(markLine.xAxis).toBe(1234567890000);
      expect(markLine.yAxis).toBeNull();
    });

    it("should apply area annotations", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "area",
          axis: "y",
          start: 20,
          end: 80,
          name: "Normal Range",
          color: "rgba(0, 255, 0, 0.1)",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series[0].markArea).toBeDefined();
      expect(result.options.series[0].markArea.data).toHaveLength(1);
    });

    it("should skip annotations with show=false", async () => {
      mockContext.annotations = [
        {
          show: false,
          type: "line",
          axis: "y",
          value: 50,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(
        result.options.series[0].markLine?.data?.length || 0,
      ).toBeLessThanOrEqual(0);
    });

    it("should use default values for annotation properties", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.lineStyle.color).toBe("#FF0000");
      expect(markLine.lineStyle.type).toBe("solid");
      expect(markLine.lineStyle.width).toBe(2);
    });

    it("should hide label when show_label is false", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          show_label: false,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.label.show).toBe(false);
    });

    it("should use default label position", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          name: "Test",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.label.position).toBe("insideEndTop");
    });

    it("should use custom label position", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          label_position: "start",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.label.position).toBe("start");
    });

    it("should format label with name when provided", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          name: "Max",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.label.formatter).toBe("{b}: {c}");
    });

    it("should format label without name when not provided", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markLine = result.options.series[0].markLine.data[0];
      expect(markLine.label.formatter).toBe("{c}");
    });

    it("should apply area annotation on x-axis", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "area",
          axis: "x",
          start: 1234567890000,
          end: 1234567900000,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markArea = result.options.series[0].markArea.data[0];
      expect(markArea[0].xAxis).toBe(1234567890000);
      expect(markArea[1].xAxis).toBe(1234567900000);
    });

    it("should use default color for area annotation", async () => {
      mockContext.annotations = [
        {
          show: true,
          type: "area",
          axis: "y",
          start: 20,
          end: 80,
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      const markArea = result.options.series[0].markArea.data[0];
      expect(markArea[1].itemStyle.color).toBe("rgba(255, 0, 0, 0.1)");
    });

    it("should not apply annotations when array is empty", async () => {
      mockContext.annotations = [];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series[0].markLine?.data?.length || 0).toBe(0);
      expect(result.options.series[0].markArea).toBeUndefined();
    });

    it("should merge with existing markLine data", async () => {
      mockContext.panelSchema.config = {
        mark_lines: [
          {
            show: true,
            type: "yAxis",
            value: 100,
            name: "Existing",
          },
        ],
      };
      mockContext.annotations = [
        {
          show: true,
          type: "line",
          axis: "y",
          value: 50,
          name: "New",
        },
      ];

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series[0].markLine.data.length).toBeGreaterThan(1);
    });
  });

  describe("empty data handling", () => {
    it("should handle empty series data", async () => {
      const { processPromQLData } = await import("./shared/dataProcessor");
      vi.mocked(processPromQLData).mockResolvedValueOnce([
        {
          series: [],
          timestamps: [],
        },
      ]);

      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series).toEqual([]);
      expect(result.options.xAxis).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "No series or columns found - returning empty chart",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return valid data when series exist", async () => {
      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.series.length).toBeGreaterThan(0);
    });

    it("should return valid data when table columns exist", async () => {
      mockContext.panelSchema.type = "table";

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options.columns.length).toBeGreaterThan(0);
    });
  });

  describe("data processing", () => {
    it("should call processPromQLData with correct arguments", async () => {
      const { processPromQLData } = await import("./shared/dataProcessor");
      vi.mocked(processPromQLData).mockClear();

      await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(processPromQLData).toHaveBeenCalledWith(
        mockPromQLResponse,
        mockContext.panelSchema,
        mockContext.store,
      );
    });

    it("should pass chartPanelRef to converter", async () => {
      const chartPanelRef = { value: "test-ref" };
      mockContext.chartPanelRef = chartPanelRef;

      const result = await convertPromQLChartData(
        mockPromQLResponse,
        mockContext,
      );

      expect(result.options).toBeDefined();
    });
  });
});
