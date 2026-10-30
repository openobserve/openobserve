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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref } from "vue";
import { convertPromQLChartData } from "./convertPromQLChartData";
import { processPromQLData } from "./shared/dataProcessor";
import { PromQLResponse, ConversionContext } from "./shared/types";

vi.mock("./shared/dataProcessor", async (importOriginal) => ({
  getPromqlSeriesLimit: (await importOriginal<typeof import("./shared/dataProcessor")>())
    .getPromqlSeriesLimit,
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
  applyLegendConfiguration: vi.fn((panelSchema, chartPanelRef, hoveredSeriesState, options) => {
    options.legend = {
      show: true,
      type: "scroll",
    };
  }),
  getChartDimensions: vi.fn(() => ({
    chartWidth: 800,
    chartHeight: 600,
  })),
  calculateBottomLegendHeight: vi.fn(() => 50),
  MAX_SEATS_PRECISION: 13,
  pieLegendPercentDecimals: vi.fn(() => 2),
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

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
      expect(result.options.xAxis).toBeDefined();
      expect(result.options.yAxis).toBeDefined();
    });

    it("should route to TimeSeriesConverter for area charts", async () => {
      mockContext.panelSchema.type = "area";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to TimeSeriesConverter for bar charts", async () => {
      mockContext.panelSchema.type = "bar";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to TimeSeriesConverter for scatter charts", async () => {
      mockContext.panelSchema.type = "scatter";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to PieConverter for pie charts", async () => {
      mockContext.panelSchema.type = "pie";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to PieConverter for donut charts", async () => {
      mockContext.panelSchema.type = "donut";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to TableConverter for table charts", async () => {
      mockContext.panelSchema.type = "table";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.columns).toBeDefined();
      expect(result.options.rows).toBeDefined();
    });

    it("should route to GaugeConverter for gauge charts", async () => {
      mockContext.panelSchema.type = "gauge";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to MetricConverter for metric charts", async () => {
      mockContext.panelSchema.type = "metric";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to HeatmapConverter for heatmap charts", async () => {
      mockContext.panelSchema.type = "heatmap";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to BarConverter for h-bar charts", async () => {
      mockContext.panelSchema.type = "h-bar";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to GeoConverter for geomap charts", async () => {
      mockContext.panelSchema.type = "geomap";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should route to MapsConverter for maps charts", async () => {
      mockContext.panelSchema.type = "maps";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toBeDefined();
    });

    it("should throw error for unsupported chart type", async () => {
      mockContext.panelSchema.type = "unsupported_type" as any;

      await expect(convertPromQLChartData(mockPromQLResponse, mockContext)).rejects.toThrow(
        "Unsupported chart type for PromQL: unsupported_type",
      );
    });

    it("should log error for unsupported chart type", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockContext.panelSchema.type = "invalid" as any;

      try {
        await convertPromQLChartData(mockPromQLResponse, mockContext);
      } catch (e) {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith("No converter found for chart type: invalid");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("options configuration", () => {
    it("should set transparent background", async () => {
      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.backgroundColor).toBe("transparent");
    });

    it("should apply axis_width configuration", async () => {
      mockContext.panelSchema.config = {
        axis_width: 100,
      };

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.grid.left).toBe(100);
    });

    it("applies axis_width to every grid of a stacked heatmap", async () => {
      const { processPromQLData } = await import("./shared/dataProcessor");
      const bucket = (pod: string, le: string, value: string) => ({
        metric: { pod, le },
        name: `${pod} ${le}`,
        data: { 1: value },
        values: [[1, value]],
      });
      vi.mocked(processPromQLData).mockResolvedValueOnce([
        {
          series: [bucket("a", "1", "1"), bucket("a", "+Inf", "2"), bucket("b", "1", "3")],
          timestamps: [[1, "00:00:01"]],
          queryIndex: 0,
        },
      ] as any);
      mockContext.panelSchema.type = "heatmap";
      mockContext.panelSchema.config = { axis_width: 100, heatmap_mode: "prometheus_histogram" };

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.grid).toHaveLength(2);
      expect(result.options.grid.map((grid: any) => grid.left)).toEqual([100, 100]);
    });

    it("should preserve existing grid configuration when applying axis_width", async () => {
      mockContext.panelSchema.config = {
        axis_width: 100,
      };

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.grid).toBeDefined();
    });
  });

  describe("legend configuration", () => {
    it("should apply legend configuration for non-table charts", async () => {
      const { applyLegendConfiguration } = await import("../legendConfiguration");

      mockContext.panelSchema.type = "line";

      await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(applyLegendConfiguration).toHaveBeenCalled();
    });

    it("should not apply legend configuration for table charts", async () => {
      const { applyLegendConfiguration } = await import("../legendConfiguration");
      vi.mocked(applyLegendConfiguration).mockClear();

      mockContext.panelSchema.type = "table";

      await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(applyLegendConfiguration).not.toHaveBeenCalled();
    });
  });

  describe("extras object", () => {
    it("should initialize extras with empty legends array", async () => {
      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.extras.legends).toBeDefined();
      expect(Array.isArray(result.extras.legends)).toBe(true);
    });

    it("should initialize extras with null hoveredSeriesState when not provided", async () => {
      mockContext.hoveredSeriesState = null;

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.extras.hoveredSeriesState).toBeNull();
    });

    it("should pass hoveredSeriesState from context to extras", async () => {
      const hoveredState = { seriesName: "test" };
      mockContext.hoveredSeriesState = hoveredState;

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.extras.hoveredSeriesState).toBe(hoveredState);
    });
  });

  describe("series limit notice", () => {
    const resultWith = (count: number): PromQLResponse => ({
      status: "success",
      data: {
        resultType: "matrix",
        result: Array.from({ length: count }, (_, i) => ({
          metric: { pod: `p${i}` },
          values: [[1, "1"]],
        })),
      },
    });

    beforeEach(async () => {
      const actual =
        await vi.importActual<typeof import("./shared/dataProcessor")>("./shared/dataProcessor");
      vi.mocked(processPromQLData).mockImplementationOnce(actual.processPromQLData);
    });

    it("reports the series the panel cap dropped, with the cap summed over queries", async () => {
      mockContext.panelSchema = {
        type: "pie",
        config: { promql_series_limit: 2 },
        queries: [{ config: {} }, { config: {} }],
      };

      const result = await convertPromQLChartData([resultWith(3), resultWith(5)], mockContext);

      expect(result.extras.seriesLimit).toEqual({ shown: 4, total: 8, cap: 4 });
      expect(result.extras.limitNumberOfSeriesWarningMessage).toBeTruthy();
    });

    it("leaves a histogram heatmap's cut to its own whole-histogram notice", async () => {
      mockContext.panelSchema = {
        type: "heatmap",
        config: { promql_series_limit: 3, heatmap_mode: "prometheus_histogram" },
        queries: [{ config: {} }],
      };
      const buckets: PromQLResponse = {
        status: "success",
        data: {
          resultType: "matrix",
          result: ["a", "b", "c"].flatMap((pod) =>
            ["1", "+Inf"].map((le) => ({ metric: { pod, le }, values: [[1, "1"]] })),
          ),
        },
      };

      const result = await convertPromQLChartData([buckets], mockContext);

      expect(result.extras.seriesLimit).toBeUndefined();
      expect(result.extras.limitNumberOfSeriesWarningMessage).toBe(
        "Showing 1 of 3 histograms to stay within the series limit",
      );
    });

    it("says nothing when every series fits", async () => {
      mockContext.panelSchema = { type: "pie", config: {}, queries: [{ config: {} }] };

      const result = await convertPromQLChartData([resultWith(3)], mockContext);

      expect(result.extras.seriesLimit).toBeUndefined();
    });

    it("treats a non-positive limit as the default of 100", async () => {
      mockContext.panelSchema = {
        type: "pie",
        config: { promql_series_limit: -5 },
        queries: [{ config: {} }],
      };

      const result = await convertPromQLChartData([resultWith(3)], mockContext);

      expect(result.extras.seriesLimit).toBeUndefined();
      expect(result.options.series[0].data).toHaveLength(3);
    });

    it("does not count a shifted period as dropped series", async () => {
      mockContext.panelSchema = {
        type: "pie",
        config: { promql_series_limit: 2 },
        queries: [{ config: {} }],
      };
      mockContext.nameSuffixes = ["", "1 day ago"];
      const current = resultWith(2);
      // A shifted series survives only alongside its primary, which it shares a metric object with.
      const shifted = { ...current, data: { ...current.data!, result: [...current.data!.result] } };

      const result = await convertPromQLChartData([current, shifted], mockContext);

      expect(result.options.series[0].data).toHaveLength(4);
      expect(result.extras.seriesLimit).toBeUndefined();
    });

    it("never caps above the server limit", async () => {
      mockContext.panelSchema = {
        type: "pie",
        config: { promql_series_limit: 5000 },
        queries: [{ config: {} }],
      };
      mockContext.store = {
        state: { theme: "light", timezone: "UTC", zoConfig: { max_dashboard_series: 2 } },
      };

      const result = await convertPromQLChartData([resultWith(3)], mockContext);

      expect(result.extras.seriesLimit).toEqual({ shown: 2, total: 3, cap: 2 });
    });

    it("reports a streaming drop with the server cap when it is the lower one", async () => {
      mockContext.panelSchema = {
        type: "pie",
        config: { promql_series_limit: 500 },
        queries: [{ config: {} }],
      };
      mockContext.metadata = {
        seriesLimiting: { metricsStored: 3, uniqueSeriesSeen: 250, maxSeries: 3 },
      };

      const result = await convertPromQLChartData([resultWith(3)], mockContext);

      expect(result.extras.seriesLimit).toEqual({ shown: 3, total: 250, cap: 3 });
    });

    it("ignores streaming totals once a shifted period is in them", async () => {
      mockContext.panelSchema = { type: "pie", config: {}, queries: [{ config: {} }] };
      mockContext.nameSuffixes = ["", "1 day ago"];
      mockContext.metadata = {
        seriesLimiting: { metricsStored: 180, uniqueSeriesSeen: 230, maxSeries: 100 },
      };

      const result = await convertPromQLChartData([resultWith(80), resultWith(100)], mockContext);

      expect(result.extras.seriesLimit).toBeUndefined();
    });
  });

  describe("annotations", () => {
    const stackedData = [
      {
        series: [
          {
            metric: { job: "api" },
            name: "test_metric",
            data: { 100: "1", 160: "2", 220: "3" },
            values: [
              [100, "1"],
              [160, "2"],
              [220, "3"],
            ],
          },
        ],
        timestamps: [
          [100, "00:01:40"],
          [160, "00:02:40"],
          [220, "00:03:40"],
        ],
        queryIndex: 0,
        queryConfig: {},
      },
    ];
    // Stacked data series carry the panel's mark lines too, so the annotation series is the unnamed one.
    const annotationSeries = (options: any) =>
      options.series.find((s: any) => !s.name && (s.markLine || s.markArea));

    beforeEach(() => {
      mockContext.panelSchema = { type: "stacked", config: {}, queries: [{ config: {} }] };
      vi.mocked(processPromQLData).mockResolvedValueOnce(stackedData as any);
    });

    it("reads annotations from a Ref and snaps a point to the nearest step", async () => {
      mockContext.annotations = ref([{ start_time: 150 * 1_000_000, title: "deploy" }]);

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      const line = annotationSeries(result.options).markLine.data[0];
      expect(line.xAxis).toBe(1);
      expect(line.name).toBe("deploy");
      expect(line.annotationDetails.title).toBe("deploy");
    });

    it("clamps a range to the visible steps", async () => {
      mockContext.annotations = ref([
        { start_time: 50 * 1_000_000, end_time: 170 * 1_000_000, title: "incident" },
      ]);

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      const [from, to] = annotationSeries(result.options).markArea.data[0];
      expect(from.xAxis).toBe(0);
      expect(to.xAxis).toBe(1);
    });

    it("drops annotations outside the time range", async () => {
      mockContext.annotations = ref([
        { start_time: 10 * 1_000_000, title: "early" },
        { start_time: 900 * 1_000_000, end_time: 990 * 1_000_000, title: "late" },
      ]);

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(annotationSeries(result.options)).toBeUndefined();
    });

    it("draws nothing for chart types without a time axis", async () => {
      mockContext.panelSchema = { type: "h-bar", config: {}, queries: [{ config: {} }] };
      mockContext.annotations = ref([{ start_time: 150 * 1_000_000, title: "deploy" }]);

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(annotationSeries(result.options)).toBeUndefined();
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

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series).toEqual([]);
      expect(result.options.xAxis).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "No series or columns found - returning empty chart",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should return valid data when series exist", async () => {
      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options.series.length).toBeGreaterThan(0);
    });

    it("should return valid data when table columns exist", async () => {
      mockContext.panelSchema.type = "table";

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

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
        { parentQueryIndex: undefined, nameSuffixes: undefined },
      );
    });

    it("passes the time-shift map and name suffixes to processPromQLData", async () => {
      const { processPromQLData } = await import("./shared/dataProcessor");
      vi.mocked(processPromQLData).mockClear();

      await convertPromQLChartData(mockPromQLResponse, {
        ...mockContext,
        parentQueryIndex: [0, 0],
        nameSuffixes: ["", "1 day ago"],
      });

      expect(vi.mocked(processPromQLData).mock.calls[0][3]).toEqual({
        parentQueryIndex: [0, 0],
        nameSuffixes: ["", "1 day ago"],
      });
    });

    it("should pass chartPanelRef to converter", async () => {
      const chartPanelRef = { value: "test-ref" };
      mockContext.chartPanelRef = chartPanelRef;

      const result = await convertPromQLChartData(mockPromQLResponse, mockContext);

      expect(result.options).toBeDefined();
    });
  });
});
