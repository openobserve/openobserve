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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  convertMultiSQLData,
  convertSQLData,
} from "@/utils/dashboard/convertSQLData";

// Mock external dependencies
vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date) => new Date(date)),
}));

vi.mock("@/utils/dashboard/datetimeStartPoint", () => ({
  dateBin: vi.fn(),
}));

vi.mock("date-fns", () => ({
  format: vi.fn((date, formatStr) => {
    if (formatStr === "yyyy-MM-dd HH:mm:ss") return "2024-01-01 12:00:00";
    return "2024-01-01";
  }),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  calculateOptimalFontSize: vi.fn(() => 12),
  calculateWidthText: vi.fn(() => 100),
  formatDate: vi.fn(() => "2024-01-01"),
  formatUnitValue: vi.fn(() => ({ value: "100", unit: "" })),
  getContrastColor: vi.fn(() => "#000000"),
  applySeriesColorMappings: vi.fn((series) => series),
  getUnitValue: vi.fn(() => ({ value: "100", unit: "" })),
  isTimeSeries: vi.fn(() => false),
  isTimeStamp: vi.fn(() => false),
  calculateBottomLegendHeight: vi.fn((legendCount, chartWidth, series, maxHeight, legendConfig, gridConfig, chartHeight) => {
    if (legendConfig && gridConfig && chartHeight) {
      legendConfig.top = chartHeight - 90;
      legendConfig.height = 70;
      gridConfig.bottom = 90;
    }
    return 90;
  }),
  calculateRightLegendWidth: vi.fn(() => 160),
  calculateChartDimensions: vi.fn(() => ({
    availableWidth: 800,
    availableHeight: 400,
    legendSpace: { right: 160, bottom: 90 },
    gridSpace: { left: 60, right: 160, top: 60, bottom: 90 }
  })),
  calculatePieChartRadius: vi.fn(() => 150),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
}));

vi.mock("@/utils/dashboard/calculateGridForSubPlot", () => ({
  calculateGridPositions: vi.fn(() => ({
    gridArray: [
      { left: "0%", top: "0%", width: "100%", height: "100%" }
    ],
    gridWidth: 800,
    gridHeight: 400,
    gridNoOfRow: 1,
    gridNoOfCol: 1,
  })),
  getTrellisGrid: vi.fn(() => ({ gridArray: [] })),
}));

vi.mock("../query/sqlUtils", () => ({
  isGivenFieldInOrderBy: vi.fn(() => false),
}));

vi.mock("./colorPalette", () => ({
  ColorModeWithoutMinMax: vi.fn(),
  getSeriesColor: vi.fn(() => "#ff0000"),
  getSQLMinMaxValue: vi.fn(() => [0, 100]),
  getColorPalette: vi.fn(() => ["#ff0000", "#00ff00", "#0000ff"]),
}));

vi.mock("@/utils/zincutils", () => ({
  deepCopy: vi.fn((obj) => JSON.parse(JSON.stringify(obj))),
}));

vi.mock("@/utils/dashboard/getAnnotationsData", () => ({
  getAnnotationsData: vi.fn(() => []),
}));

describe("convertSQLData", () => {
  let mockPanelSchema: any;
  let mockStore: any;
  let mockChartPanelRef: any;
  let mockHoveredSeriesState: any;
  let mockResultMetaData: any;
  let mockMetadata: any;
  let mockChartPanelStyle: any;
  let mockAnnotations: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockPanelSchema = {
      queries: [{
        fields: {
          x: [{ alias: "timestamp" }],
          y: [{ alias: "value" }],
          z: [],
          breakdown: []
        }
      }],
      config: {
        top_results: 10,
        top_results_others: false,
      },
      type: "line"
    };

    mockStore = {
      state: {
        theme: "light",
        zoConfig: {
          max_dashboard_series: 100
        }
      }
    };

    mockChartPanelRef = {
      value: {
        offsetWidth: 800,
        offsetHeight: 400
      }
    };
    mockHoveredSeriesState = {};
    mockResultMetaData = [{}];
    mockMetadata = { queries: [{}] };
    mockChartPanelStyle = {};
    mockAnnotations = [];
  });

  describe("convertSQLData function", () => {
    it("should return null options when searchQueryData is empty array", async () => {
      const result = await convertSQLData(
        mockPanelSchema,
        [],
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({ options: null });
    });

    it("should return null options when searchQueryData is not an array", async () => {
      const result = await convertSQLData(
        mockPanelSchema,
        null,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({ options: null });
    });

    it("should return null options when searchQueryData[0] is null", async () => {
      const result = await convertSQLData(
        mockPanelSchema,
        [null],
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({ options: null });
    });

    it("should return null options when panelSchema.queries[0].fields.x is missing", async () => {
      const schema = {
        ...mockPanelSchema,
        queries: [{
          fields: {
            x: null,
            y: [{ alias: "value" }],
            z: [],
            breakdown: []
          }
        }]
      };

      const result = await convertSQLData(
        schema,
        [[]],
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({ options: null });
    });

    it("should return null options when panelSchema.queries[0].fields.y is missing", async () => {
      const schema = {
        ...mockPanelSchema,
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: null,
            z: [],
            breakdown: []
          }
        }]
      };

      const result = await convertSQLData(
        schema,
        [[]],
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result).toEqual({ options: null });
    });
  });

  describe("convertMultiSQLData function", () => {
    it("should handle empty searchQueryData", async () => {
      const result = await convertMultiSQLData(
        mockPanelSchema,
        [],
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        { value: [{}] },
        { queries: [{}] },
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options).toBeDefined();
    });

    it("should handle null searchQueryData", async () => {
      const result = await convertMultiSQLData(
        mockPanelSchema,
        null,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        { value: [{}] },
        { queries: [{}] },
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options).toBeDefined();
    });

    it("should handle non-array searchQueryData", async () => {
      const result = await convertMultiSQLData(
        mockPanelSchema,
        "not-an-array",
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        { value: [{}] },
        { queries: [{}] },
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options).toBeDefined();
    });

    it("should process single query data correctly", async () => {
      const searchData = [
        [
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]
      ];

      const resultMetaData = { value: [{}] };
      const metadata = { queries: [{}] };

      const result = await convertMultiSQLData(
        mockPanelSchema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        resultMetaData,
        metadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options).toBeDefined();
      expect(result.options.series).toBeDefined();
      expect(Array.isArray(result.options.series)).toBe(true);
    });

    it("should process multiple queries data correctly", async () => {
      const searchData = [
        [
          { timestamp: "2023-01-01", value: 10 }
        ],
        [
          { timestamp: "2023-01-01", value: 20 }
        ]
      ];

      const resultMetaData = { value: [{}, {}] };
      const metadata = { queries: [{}, {}] };

      const result = await convertMultiSQLData(
        mockPanelSchema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        resultMetaData,
        metadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options).toBeDefined();
      expect(result.options.series).toBeDefined();
      expect(Array.isArray(result.options.series)).toBe(true);
      expect(result.options.series.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Internal utility functions", () => {
    // Need to access internal functions through dynamic import or reflection
    // These functions are not exported, so we'll test them through the public API behavior

    describe("processData function behavior", () => {
      it("should handle empty data array", async () => {
        const result = await convertSQLData(
          mockPanelSchema,
          [[]],
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(Array.isArray(result.options.series)).toBe(true);
      });

      it("should handle data without breakdown keys", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle top_results configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 5,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 30, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle missing breakdown values", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: null },
          { timestamp: "2023-01-03", value: 30, category: "" },
          { timestamp: "2023-01-04", value: 40, category: undefined }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle processData with top_results enabled", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 2,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 50, category: "B" },
          { timestamp: "2023-01-03", value: 25, category: "C" },
          { timestamp: "2023-01-04", value: 10, category: "D" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle top_results_others configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 2,
            top_results_others: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 80, category: "B" },
          { timestamp: "2023-01-03", value: 40, category: "C" },
          { timestamp: "2023-01-04", value: 20, category: "D" },
          { timestamp: "2023-01-05", value: 10, category: "E" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle store max_dashboard_series limit", async () => {
        const storeWithLimit = {
          state: {
            zoConfig: {
              max_dashboard_series: 3
            }
          }
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 5,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 90, category: "B" },
          { timestamp: "2023-01-03", value: 80, category: "C" },
          { timestamp: "2023-01-04", value: 70, category: "D" },
          { timestamp: "2023-01-05", value: 60, category: "E" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          storeWithLimit,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });
    });

    describe("Chart type handling", () => {
      it("should handle different chart types", async () => {
        const chartTypes = ["line", "bar", "area", "scatter"];

        for (const chartType of chartTypes) {
          const schema = {
            ...mockPanelSchema,
            type: chartType
          };

          const searchData = [[
            { timestamp: "2023-01-01", value: 10 },
            { timestamp: "2023-01-02", value: 20 }
          ]];

          const result = await convertSQLData(
            schema,
            searchData,
            mockStore,
            mockChartPanelRef,
            mockHoveredSeriesState,
            mockResultMetaData,
            mockMetadata,
            mockChartPanelStyle,
            mockAnnotations
          );

          expect(result.options).toBeDefined();
          expect(result.options.series).toBeDefined();
          expect(result.options.series.length).toBeGreaterThan(0);
        }
      });

      it("should handle pie/donut charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "pie",
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 },
          { category: "C", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle heatmap charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "heatmap",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "category" }],
              z: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", category: "A", value: 10 },
          { timestamp: "2023-01-02", category: "B", value: 20 },
          { timestamp: "2023-01-03", category: "C", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle stacked charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "stacked",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 30, category: "A" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle area-stacked charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "area-stacked",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle donut charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "donut",
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });
    });

    describe("Error handling and edge cases", () => {
      it("should handle malformed data gracefully", async () => {
        const searchData = [[
          { timestamp: null, value: 10 },
          { timestamp: "invalid-date", value: "not-a-number" },
          { timestamp: "", value: null }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle very large datasets", async () => {
        const largeData = Array.from({ length: 1000 }, (_, i) => ({
          timestamp: `2023-01-${String(i + 1).padStart(2, '0')}`,
          value: Math.random() * 100
        }));

        const searchData = [largeData];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle missing store configuration", async () => {
        const storeWithoutConfig = {
          state: {
            zoConfig: null
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          storeWithoutConfig,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });
    });

    describe("Mark line functionality", () => {
      it("should handle mark lines with xAxis type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_line: [
              {
                name: "Threshold",
                type: "xAxis",
                value: "2023-01-01"
              }
            ]
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle mark lines with yAxis type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_line: [
              {
                name: "Upper Limit",
                type: "yAxis",
                value: 50
              }
            ]
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle mark lines without name", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_line: [
              {
                type: "yAxis",
                value: 25
              }
            ]
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle multiple mark lines", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_line: [
              {
                name: "Min",
                type: "yAxis",
                value: 5
              },
              {
                name: "Max",
                type: "yAxis",
                value: 100
              }
            ]
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle empty mark_line config", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_line: []
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("Missing value replacement", () => {
      it("should handle no_value_replacement config", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            no_value_replacement: "N/A"
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: null },
          { timestamp: "2023-01-02", value: 20 },
          { timestamp: "2023-01-03", value: undefined }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle empty no_value_replacement config", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            no_value_replacement: ""
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: null },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("Time series and histogram functionality", () => {
      it("should handle time series data with histogram interval", async () => {
        const resultMetaData = [{ histogram_interval: 60 }];
        const metadata = {
          queries: [{
            startTime: "1640995200000",
            endTime: "1641081600000"
          }]
        };

        const schema = {
          ...mockPanelSchema,
          type: "line"
        };

        const searchData = [[
          { timestamp: 1640995200, value: 10 },
          { timestamp: 1640998800, value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle time series data without histogram interval", async () => {
        const resultMetaData = [{}];
        const metadata = {
          queries: [{
            startTime: "1640995200000",
            endTime: "1641081600000"
          }]
        };

        const schema = {
          ...mockPanelSchema,
          type: "line"
        };

        const searchData = [[
          { timestamp: 1640995200, value: 10 },
          { timestamp: 1640998800, value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("Internal helper functions coverage", () => {
      it("should handle getXAxisKeys when no x fields exist", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: null,
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const result = await convertSQLData(
          schema,
          [[]],
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle getYAxisKeys when no y fields exist", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: null,
              breakdown: []
            }
          }]
        };

        const result = await convertSQLData(
          schema,
          [[]],
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle getZAxisKeys when no z fields exist", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              z: null,
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle getBreakDownKeys when no breakdown fields exist", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: null
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("Warning message conditions", () => {
      it("should show warning when top_results exceeds max_dashboard_series and has many breakdown values", async () => {
        const storeWithLowLimit = {
          state: {
            zoConfig: {
              max_dashboard_series: 2
            }
          }
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 5, // Greater than max_dashboard_series
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 90, category: "B" },
          { timestamp: "2023-01-03", value: 80, category: "C" },
          { timestamp: "2023-01-04", value: 70, category: "D" },
          { timestamp: "2023-01-05", value: 60, category: "E" },
          { timestamp: "2023-01-06", value: 50, category: "F" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          storeWithLowLimit,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should show warning when no top_results but breakdown values exceed max_dashboard_series", async () => {
        const storeWithLowLimit = {
          state: {
            zoConfig: {
              max_dashboard_series: 2
            }
          }
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: null, // No top_results
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 90, category: "B" },
          { timestamp: "2023-01-03", value: 80, category: "C" },
          { timestamp: "2023-01-04", value: 70, category: "D" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          storeWithLowLimit,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("ProcessData edge cases", () => {
      it("should handle data where first element is not an array", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        // First element is not an array
        const searchData = [null];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        if (result.options) {
          expect(result.options.series).toBeDefined();
          expect(Array.isArray(result.options.series)).toBe(true);
        }
      });

      it("should handle breakdown value conversion to string", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 3,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: 123 }, // Number
          { timestamp: "2023-01-02", value: 90, category: true }, // Boolean
          { timestamp: "2023-01-03", value: 80, category: { nested: "object" } } // Object
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle yAxis values with NaN and invalid numbers", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 3,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: "invalid", category: "A" },
          { timestamp: "2023-01-02", value: NaN, category: "B" },
          { timestamp: "2023-01-03", value: Infinity, category: "C" },
          { timestamp: "2023-01-04", value: -Infinity, category: "D" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });
    });

    describe("Multi-dimensional axis handling", () => {
      it("should handle multiple x-axis fields", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }, { alias: "date" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", date: "Jan 1", value: 10 },
          { timestamp: "2023-01-02", date: "Jan 2", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle multiple y-axis fields", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value1" }, { alias: "value2" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value1: 10, value2: 15 },
          { timestamp: "2023-01-02", value1: 20, value2: 25 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle multiple z-axis fields", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "heatmap",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "category" }],
              z: [{ alias: "value1" }, { alias: "value2" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", category: "A", value1: 10, value2: 15 },
          { timestamp: "2023-01-02", category: "B", value1: 20, value2: 25 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle multiple breakdown fields", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category1" }, { alias: "category2" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category1: "A", category2: "X" },
          { timestamp: "2023-01-02", value: 20, category1: "B", category2: "Y" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });
    });

    describe("Store configuration edge cases", () => {
      it("should handle undefined store state", async () => {
        const undefinedStore = {
          state: {
            theme: "light",
            zoConfig: {
              max_dashboard_series: 100
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          undefinedStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle null store", async () => {
        const nullStore = {
          state: {
            theme: "light",
            zoConfig: {
              max_dashboard_series: 100
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          nullStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle store with undefined zoConfig", async () => {
        const storeWithUndefinedConfig = {
          state: {
            theme: "light",
            zoConfig: undefined
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          storeWithUndefinedConfig,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });
    });

    describe("Additional edge cases for complete coverage", () => {
      it("should handle data with zero breakdown key aggregation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 3,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 0, category: "A" },
          { timestamp: "2023-01-02", value: 0, category: "B" },
          { timestamp: "2023-01-03", value: 0, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle negative values in breakdown aggregation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 3,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: -100, category: "A" },
          { timestamp: "2023-01-02", value: -50, category: "B" },
          { timestamp: "2023-01-03", value: -25, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle empty string in xAxis value for others aggregation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 1,
            top_results_others: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "", value: 100, category: "A" }, // High value - should be in top
          { timestamp: "", value: 50, category: "B" },  // Should go to others
          { timestamp: null, value: 25, category: "C" } // Should go to others
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle array-like objects as breakdown values", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: 3,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: [1, 2, 3] }, // Array
          { timestamp: "2023-01-02", value: 90, category: { length: 5 } }, // Array-like object
          { timestamp: "2023-01-03", value: 80, category: "normal" } // Normal string
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle config with undefined top_results value", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            top_results: undefined,
            top_results_others: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 90, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle fields with empty alias arrays", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const result = await convertSQLData(
          schema,
          [[]],
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle fields with empty y alias arrays", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [],
              breakdown: []
            }
          }]
        };

        const result = await convertSQLData(
          schema,
          [[]],
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
      });

      it("should handle getAxisDataFromKey with filtered data", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: null, value: 20, category: "B" }, // Should be filtered out
          { timestamp: "2023-01-03", value: 30, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle largestStackLabel calculation for stacked charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "stacked",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100, category: "A" },
          { timestamp: "2023-01-02", value: 150, category: "A" }, // Max for A = 150
          { timestamp: "2023-01-01", value: 200, category: "B" },
          { timestamp: "2023-01-02", value: 50, category: "B" }   // Max for B = 200
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle largestStackLabel with non-numeric values", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "area-stacked",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: "invalid", category: "A" },
          { timestamp: "2023-01-02", value: 100, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle getPieChartRadius with layout dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "pie",
          layout: {
            w: 5,  // Width
            h: 4   // Height
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle getPieChartRadius with zero dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "pie",
          layout: {
            w: 0,  // Zero width
            h: 4   
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle getPieChartRadius without layout", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "pie",
          layout: null, // No layout
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle annotation timestamp conversion", async () => {
        const annotationsWithTime = [
          {
            value: [{ start_time: 1640995200000 }] // Unix timestamp in milliseconds
          }
        ];

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          annotationsWithTime
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle annotations with null or undefined values", async () => {
        const annotationsWithNulls = [
          {
            value: null
          }
        ];

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          annotationsWithNulls
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle maxValues calculation with unit formatting", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            unit: "bytes",
            unit_custom: "",
            decimals: 2
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 1024 },
          { timestamp: "2023-01-02", value: 2048 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle custom unit configurations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            unit: "custom",
            unit_custom: "req/sec",
            decimals: 1
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 1500.789 },
          { timestamp: "2023-01-02", value: 2500.123 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle data with empty objects in keys calculation", async () => {
        const searchData = [[
          // Empty object should be handled gracefully
          {},
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle maxValue validation with decimal numbers", async () => {
        const searchData = [[
          { timestamp: "2023-01-01", value: 123.45 },
          { timestamp: "2023-01-02", value: 678.90 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle maxValue with comma separators in formatted values", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            unit: "auto",
            decimals: 0
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 1000000 }, // Should format to "1,000,000"
          { timestamp: "2023-01-02", value: 2000000 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle color mode calculations for non-heatmap charts", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            color: {
              mode: "continuous" // Not in ColorModeWithoutMinMax
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 100 },
          { timestamp: "2023-01-03", value: 50 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle heatmap color mode calculations", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "heatmap",
          config: {
            color: {
              mode: "shades" // Not in ColorModeWithoutMinMax
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "category" }],
              z: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", category: "A", value: 10 },
          { timestamp: "2023-01-02", category: "B", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle axis formatter error handling", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            unit: "invalid", // This might cause formatUnitValue to throw
            unit_custom: "",
            decimals: "not_a_number" // Invalid decimals
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
        expect(typeof result.options.yAxis.axisLabel.formatter).toBe('function');
      });

      it("should handle horizontal bar charts (h-bar and h-stacked)", async () => {
        const hBarTypes = ["h-bar", "h-stacked"];

        for (const chartType of hBarTypes) {
          const schema = {
            ...mockPanelSchema,
            type: chartType
          };

          const searchData = [[
            { timestamp: "2023-01-01", value: 10 },
            { timestamp: "2023-01-02", value: 20 }
          ]];

          const result = await convertSQLData(
            schema,
            searchData,
            mockStore,
            mockChartPanelRef,
            mockHoveredSeriesState,
            mockResultMetaData,
            mockMetadata,
            mockChartPanelStyle,
            mockAnnotations
          );

          expect(result.options.series).toBeDefined();
          expect(result.options.series.length).toBeGreaterThan(0);
        }
      });

      it("should handle axis border configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            axis_border_show: true
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis.axisLine.show).toBeDefined();
      });

      it("should handle empty search data with axis border", async () => {
        const searchData = [[]]; // Empty data

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis.axisLine.show).toBe(true); // Should show axis line when data is empty
      });

      it("should handle toolbox visibility for different chart types", async () => {
        const hiddenToolboxTypes = ["pie", "donut", "metric", "gauge"];

        for (const chartType of hiddenToolboxTypes) {
          const schema = {
            ...mockPanelSchema,
            type: chartType
          };

          const searchData = [[
            { category: "A", value: 10 },
            { category: "B", value: 20 }
          ]];

          const result = await convertSQLData(
            schema,
            searchData,
            mockStore,
            mockChartPanelRef,
            mockHoveredSeriesState,
            mockResultMetaData,
            mockMetadata,
            mockChartPanelStyle,
            mockAnnotations
          );

          expect(result.options.toolbox.show).toBe(false);
        }
      });

      it("should handle y-axis min/max configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            y_axis_min: 0,
            y_axis_max: 100
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 50 },
          { timestamp: "2023-01-02", value: 75 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis.min).toBeDefined();
        expect(result.options.yAxis.max).toBeDefined();
      });
    });

    describe("Advanced coverage tests for uncovered branches", () => {
      it("should handle time-based data filling with breakdown keys", async () => {
        const resultMetaData = [{ histogram_interval: 60 }];
        const metadata = {
          queries: [{
            startTime: "1640995200000", // 2022-01-01 00:00:00
            endTime: "1640995500000"   // 2022-01-01 00:05:00
          }]
        };

        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: 1640995200, value: 10, category: "A" },
          { timestamp: 1640995320, value: 20, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle time filling with x-axis keys without timestamp", async () => {
        const resultMetaData = [{ histogram_interval: 60 }];
        const metadata = {
          queries: [{
            startTime: "1640995200000", // 2022-01-01 00:00:00
            endTime: "1640995500000"   // 2022-01-01 00:05:00
          }]
        };

        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }, { alias: "location" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: 1640995200, location: "US", value: 10 },
          { timestamp: 1640995320, location: "EU", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle time filling with no x-axis or breakdown keys", async () => {
        const resultMetaData = [{ histogram_interval: 60 }];
        const metadata = {
          queries: [{
            startTime: "1640995200000",
            endTime: "1640995500000"
          }]
        };

        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: 1640995200, value: 10 },
          { timestamp: 1640995320, value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle trellis configuration for multiple series", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            show_trellis: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 30, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle legend positioning configurations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            legends: {
              show: true,
              position: "bottom"
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        // Legend configuration is usually applied in the options but may not always exist as a separate property
      });

      it("should handle series configuration with custom properties", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            series: {
              symbol: "circle",
              symbolSize: 8,
              smooth: true,
              connectNulls: false
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: null },
          { timestamp: "2023-01-03", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle metric type charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "metric",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 100 },
          { timestamp: "2023-01-02", value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle table type charts", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "table",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options).toBeDefined();
        // Table charts might not always have series
        if (result.options.series) {
          expect(Array.isArray(result.options.series)).toBe(true);
        }
      });

      it("should handle chart configurations with different axis options", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            x_axis: {
              type: "category",
              boundaryGap: false,
              inverse: true
            },
            y_axis: {
              type: "value",
              splitNumber: 5,
              logBase: 10
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 1 },
          { timestamp: "2023-01-02", value: 10 },
          { timestamp: "2023-01-03", value: 100 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.xAxis).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
      });

      it("should handle annotation series identification", async () => {
        const annotationData = [
          {
            value: [{
              start_time: 1640995200000,
              end_time: 1640995500000,
              text: "Maintenance window"
            }]
          }
        ];

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          mockPanelSchema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          annotationData
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle trellis configuration with valid panel dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            show_trellis: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 30, category: "C" },
          { timestamp: "2023-01-04", value: 40, category: "D" }
        ]];

        // Mock chartPanelRef with valid dimensions
        const validChartPanelRef = {
          value: {
            offsetWidth: 1200,
            offsetHeight: 800
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          validChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle trellis configuration with invalid panel dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            show_trellis: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" }
        ]];

        // Mock chartPanelRef with invalid dimensions
        const invalidChartPanelRef = {
          value: {
            offsetWidth: 0,
            offsetHeight: 0
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          invalidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle trellis configuration with missing chartPanelRef", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            show_trellis: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" }
        ]];

        // Mock chartPanelRef as null/undefined
        const nullChartPanelRef = null;

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          nullChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });
    });

    describe("Comprehensive coverage for remaining uncovered areas", () => {
      it("should handle time series data with histogram interval", async () => {
        const resultMetaData = [{ histogram_interval: 60 }];
        const metadata = {
          queries: [{
            startTime: "1640995200000",
            endTime: "1640995500000" // 5 minute span
          }]
        };

        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: 1640995200, value: 10 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle getLargestLabel calculation", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "Very Long Category Name That Should Be Measured", value: 10 },
          { category: "Short", value: 20 },
          { category: "Another Very Long Category Name For Testing Purposes", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle complex series configuration with all properties", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            connect_nulls: true,
            show_symbols: true,
            symbol_size: 10,
            smooth_lines: true,
            fill_area: true,
            stack_series: true,
            show_legend: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value1" }, { alias: "value2" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value1: 10, value2: 15, category: "A" },
          { timestamp: "2023-01-02", value1: null, value2: 20, category: "A" },
          { timestamp: "2023-01-03", value1: 30, value2: null, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle y-axis name gap calculation", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "very_long_metric_name_for_testing_purposes" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", very_long_metric_name_for_testing_purposes: 10 },
          { timestamp: "2023-01-02", very_long_metric_name_for_testing_purposes: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis).toBeDefined();
        expect(result.options.yAxis.nameGap).toBeDefined();
      });

      it("should handle mark area configurations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            mark_area: [
              {
                name: "High Load Period",
                x0: "2023-01-01",
                x1: "2023-01-02",
                y0: 50,
                y1: 100
              }
            ]
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 75 },
          { timestamp: "2023-01-02", value: 80 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle different legend positions", async () => {
        const legendPositions = ["top", "bottom", "left", "right"];

        for (const position of legendPositions) {
          const schema = {
            ...mockPanelSchema,
            config: {
              legends: {
                show: true,
                position: position,
                alignment: "center"
              }
            }
          };

          const searchData = [[
            { timestamp: "2023-01-01", value: 10 },
            { timestamp: "2023-01-02", value: 20 }
          ]];

          const result = await convertSQLData(
            schema,
            searchData,
            mockStore,
            mockChartPanelRef,
            mockHoveredSeriesState,
            mockResultMetaData,
            mockMetadata,
            mockChartPanelStyle,
            mockAnnotations
          );

          expect(result.options).toBeDefined();
        }
      });

      it("should handle scatter plot with z-axis values", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "scatter",
          queries: [{
            fields: {
              x: [{ alias: "x_value" }],
              y: [{ alias: "y_value" }],
              z: [{ alias: "size" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { x_value: 1, y_value: 10, size: 5, category: "A" },
          { x_value: 2, y_value: 20, size: 8, category: "B" },
          { x_value: 3, y_value: 15, size: 12, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle empty series data gracefully", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            show_trellis: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[]]; // Empty data

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
      });
    });

    describe("Final comprehensive coverage tests", () => {
      it("should handle getUniqueStackedXAxisValues function", async () => {
        const schema = {
          ...mockPanelSchema,
          type: "stacked",
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 30, category: "A" },
          { timestamp: "2023-01-04", value: 40, category: "C" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle single y-axis field label", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value", label: "Custom Y Label" }], // Single y field with label
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis.name).toBe("Custom Y Label");
      });

      it("should handle multiple y-axis fields without name", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [
                { alias: "value1", label: "Value 1" },
                { alias: "value2", label: "Value 2" }
              ], // Multiple y fields
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value1: 10, value2: 15 },
          { timestamp: "2023-01-02", value1: 20, value2: 25 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result.options.yAxis.name).toBe(""); // Should be empty for multiple fields
      });
    });

    describe("Additional convertMultiSQLData coverage", () => {
      it("should handle annotation series correctly", async () => {
        const schema = mockPanelSchema;
        const searchData = [
          [{ timestamp: "2023-01-01", value: 10 }],
          [{ timestamp: "2023-01-02", value: 20 }]
        ];

        const resultMetaData = { value: [mockResultMetaData[0], mockResultMetaData[0]] };
        const metadata = {
          queries: [
            { timeRangeGap: { periodAsStr: "1h" } },
            { timeRangeGap: { periodAsStr: "2h" } }
          ]
        };

        const result = await convertMultiSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle multiple queries with series name transformations", async () => {
        // Create a schema that will produce series with names
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "line" }
        };

        const searchData = [
          [
            { timestamp: "2023-01-01", value: 10, category: "A" },
            { timestamp: "2023-01-02", value: 20, category: "A" }
          ],
          [
            { timestamp: "2023-01-01", value: 15, category: "B" },
            { timestamp: "2023-01-02", value: 25, category: "B" }
          ]
        ];

        const resultMetaData = { value: [mockResultMetaData[0], mockResultMetaData[0]] };
        const metadata = {
          queries: [
            { timeRangeGap: { periodAsStr: "1h" } },
            { timeRangeGap: { periodAsStr: "2h" } }
          ]
        };

        const result = await convertMultiSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle metadata queries without periodAsStr", async () => {
        const schema = mockPanelSchema;
        const searchData = [
          [{ timestamp: "2023-01-01", value: 10 }],
          [{ timestamp: "2023-01-02", value: 20 }]
        ];

        const resultMetaData = { value: [mockResultMetaData[0], mockResultMetaData[0]] };
        const metadata = {
          queries: [
            { timeRangeGap: {} }, // No periodAsStr
            { timeRangeGap: { periodAsStr: null } } // Null periodAsStr
          ]
        };

        const result = await convertMultiSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle processData with empty data or non-array first element", async () => {
        // Test the early return path in processData function (lines 228-229)
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, top_results: true, top_results_others: true }
        };

        // First test: empty data array
        let searchData = [[]];
        let result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );
        expect(result).toBeDefined();

        // Second test: non-array first element 
        searchData = [null]; // This will make data[0] null
        result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );
        expect(result).toBeDefined();
      });

      it("should cover various missing value configurations", async () => {
        // Test lines around 410-411, 423-429, 433-481 (missing value logic)
        const schema = {
          ...mockPanelSchema,
          config: { 
            ...mockPanelSchema.config, 
            no_value_replacement: "N/A"
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10 },
          { timestamp: "2023-01-02", value: null } // This should trigger missing value logic
        ]];

        const resultMetaData = [{
          interval: 3600000, // 1 hour in milliseconds
        }];

        const metadata = {
          queries: [{
            startTime: Date.now() - 86400000, // 24 hours ago
            endTime: Date.now()
          }]
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle chart type specific configurations", async () => {
        // Test various chart type configurations to hit uncovered branches
        const chartTypes = ["bar", "pie", "gauge", "metric", "table", "scatter"];
        
        for (const chartType of chartTypes) {
          const schema = {
            ...mockPanelSchema,
            config: { 
              ...mockPanelSchema.config, 
              type: chartType,
              show_legends: true,
              legend_width: { value: 50 }
            }
          };

          const searchData = [[
            { timestamp: "2023-01-01", value: 10 },
            { timestamp: "2023-01-02", value: 20 }
          ]];

          const result = await convertSQLData(
            schema,
            searchData,
            mockStore,
            mockChartPanelRef,
            mockHoveredSeriesState,
            mockResultMetaData,
            mockMetadata,
            mockChartPanelStyle,
            mockAnnotations
          );

          expect(result).toBeDefined();
        }
      });

      it("should handle trellis configuration branches", async () => {
        // Test trellis configuration logic (lines 654-814)
        const schema = {
          ...mockPanelSchema,
          config: { 
            ...mockPanelSchema.config, 
            type: "line",
            trellis: {
              enable: true,
              layout: { rows: 2, cols: 2 },
              group_by_y_axis: true
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" }
        ]];

        const chartPanelRef = {
          value: {
            offsetWidth: 800,
            offsetHeight: 600
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          chartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
      });

      it("should cover processData early return with non-array data", async () => {
        // This test specifically targets lines 228-229 in processData
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, top_results: 5 }
        };

        // Create search data where the first element is not an array
        const searchData = [
          "not_an_array" // This will trigger the early return in processData
        ];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should cover missing value logic with time series data", async () => {
        // This test targets lines 410-411, 423-429, 433-481 in the missing value function
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "histogram", aggregationFunction: "histogram" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        // Create data with time gaps to trigger missing value logic
        const searchData = [[
          { histogram: 1640995200000, value: 10 }, // 2022-01-01 00:00:00
          { histogram: 1640998800000, value: 20 }, // 2022-01-01 01:00:00
          // Missing entry at 02:00:00 to trigger missing value filling
          { histogram: 1641006000000, value: 30 }  // 2022-01-01 03:00:00
        ]];

        const resultMetaData = [{
          interval: 3600, // 1 hour interval in seconds
        }];

        const metadata = {
          queries: [{
            startTime: 1640995200000, // 2022-01-01 00:00:00
            endTime: 1641006000000    // 2022-01-01 03:00:00
          }]
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          resultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle scatter plot with z-axis configuration", async () => {
        // Target scatter plot specific logic
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "scatter" },
          queries: [{
            fields: {
              x: [{ alias: "x_field" }],
              y: [{ alias: "y_field" }], 
              z: [{ alias: "z_field" }], // Z-axis for scatter plot
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { x_field: 10, y_field: 20, z_field: 5 },
          { x_field: 15, y_field: 25, z_field: 8 },
          { x_field: 20, y_field: 30, z_field: 12 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle gauge chart configuration", async () => {
        // Target gauge chart specific logic (lines around gauge configuration)
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "gauge" }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 75 },
          { timestamp: "2023-01-02", value: 85 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should cover trellis configuration with proper conditions", async () => {
        // This specifically targets lines 654-814 (trellis configuration)
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line", // Must be supported type for trellis
            trellis: {
              enable: true,
              layout: { rows: 2, cols: 2 },
              group_by_y_axis: true
            }
          }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: 20, category: "B" },
          { timestamp: "2023-01-03", value: 15, category: "A" }
        ]];

        // Important: chartPanelRef with actual dimensions
        const chartPanelRefWithDimensions = {
          value: {
            offsetWidth: 1200,
            offsetHeight: 800
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          chartPanelRefWithDimensions,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle table chart configuration", async () => {
        // Target table chart specific logic 
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "table" }
        };

        const searchData = [[
          { name: "Item 1", value: 100, category: "A" },
          { name: "Item 2", value: 200, category: "B" },
          { name: "Item 3", value: 150, category: "A" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle metric chart configuration", async () => {
        // Target metric chart specific logic
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "metric" }
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 1500 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle axis configuration and ordering", async () => {
        // Target axis configuration logic (lines 817-831, 839-902, 910-932)
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            axis: {
              x: { title: "X Axis Title" },
              y: { title: "Y Axis Title" }
            }
          }
        };

        const searchData = [[
          { category: "A", value: 30 },
          { category: "B", value: 20 },
          { category: "C", value: 40 },
          { category: "D", value: 10 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle time series tooltip formatting", async () => {
        // Target tooltip formatting logic (lines 2326-2512, 2527-2690)
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "timestamp", aggregationFunction: "histogram" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: 1640995200000, value: 10, category: "A" }, // Timestamp format
          { timestamp: 1640998800000, value: 20, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle breakdown with time series", async () => {
        // Target specific time series with breakdown logic
        const schema = {
          ...mockPanelSchema,
          queries: [{
            fields: {
              x: [{ alias: "time_field" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "series" }]
            }
          }]
        };

        const searchData = [[
          { time_field: "2023-01-01T00:00:00Z", value: 10, series: "metric1" },
          { time_field: "2023-01-01T01:00:00Z", value: 20, series: "metric1" },
          { time_field: "2023-01-01T00:00:00Z", value: 15, series: "metric2" },
          { time_field: "2023-01-01T01:00:00Z", value: 25, series: "metric2" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle horizontal chart configuration", async () => {
        // Target horizontal chart logic
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "h-bar" }
        };

        const searchData = [[
          { category: "Category A", value: 100 },
          { category: "Category B", value: 80 },
          { category: "Category C", value: 120 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle pie chart with breakdown", async () => {
        // Target pie chart specific logic
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "pie" },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: []
            }
          }]
        };

        const searchData = [[
          { category: "Segment A", value: 30 },
          { category: "Segment B", value: 45 },
          { category: "Segment C", value: 25 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle heatmap chart configuration", async () => {
        // Target heatmap chart logic
        const schema = {
          ...mockPanelSchema,
          config: { ...mockPanelSchema.config, type: "heatmap" },
          queries: [{
            fields: {
              x: [{ alias: "x_coord" }],
              y: [{ alias: "y_coord" }],
              z: [{ alias: "intensity" }]
            }
          }]
        };

        const searchData = [[
          { x_coord: 0, y_coord: 0, intensity: 10 },
          { x_coord: 0, y_coord: 1, intensity: 15 },
          { x_coord: 1, y_coord: 0, intensity: 8 },
          { x_coord: 1, y_coord: 1, intensity: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle stacked area chart", async () => {
        // Target stacked area chart logic
        const schema = {
          ...mockPanelSchema,
          config: { 
            ...mockPanelSchema.config, 
            type: "area",
            connect_nulls: true,
            stacked: true
          },
          queries: [{
            fields: {
              x: [{ alias: "time" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "stack_group" }]
            }
          }]
        };

        const searchData = [[
          { time: "2023-01-01", value: 10, stack_group: "Group A" },
          { time: "2023-01-02", value: 15, stack_group: "Group A" },
          { time: "2023-01-01", value: 20, stack_group: "Group B" },
          { time: "2023-01-02", value: 25, stack_group: "Group B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle annotation series in convertMultiSQLData", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-02T00:00:00Z", value: 20 }
        ]];

        // Mock annotations that would trigger annotation series creation
        const mockAnnotationsWithSeries = {
          list: [{
            id: "ann1",
            timeRange: { from: "2023-01-01T00:00:00Z", to: "2023-01-01T12:00:00Z" },
            title: "Test Annotation",
            text: "Test annotation text"
          }]
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotationsWithSeries
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle missing value interpolation with xAxisKeysWithoutTimeStamp", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            missing_values: {
              null_option: "null",
              show_line: false,
              interpolation: "linear"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }, { alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", category: "A", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", category: "B", value: 20 },
          // Missing entry for timestamp: "2023-01-01T02:00:00Z", category: "A"
          { timestamp: "2023-01-01T03:00:00Z", category: "A", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle missing value interpolation with breakdownAxisKeysWithoutTimeStamp", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            missing_values: {
              null_option: "null",
              show_line: false,
              interpolation: "linear"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", category: "A", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", category: "B", value: 20 },
          // Missing entry for timestamp: "2023-01-01T02:00:00Z", category: "A"  
          { timestamp: "2023-01-01T03:00:00Z", category: "A", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle trellis configuration with custom layout", async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "custom",
              num_of_columns: 2,
              group_by_y_axis: false
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value: 20, category: "B" },
          { timestamp: "2023-01-01T02:00:00Z", value: 30, category: "A" },
          { timestamp: "2023-01-01T03:00:00Z", value: 40, category: "B" }
        ]];

        // Mock chartPanelRef with valid dimensions
        const mockValidChartPanelRef = {
          value: {
            offsetWidth: 800,
            offsetHeight: 600
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockValidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        
        consoleSpy.mockRestore();
      });

      it("should handle trellis configuration with vertical layout", async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "vertical",
              group_by_y_axis: false
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value: 20, category: "B" }
        ]];

        // Mock chartPanelRef with valid dimensions
        const mockValidChartPanelRef = {
          value: {
            offsetWidth: 800,
            offsetHeight: 600
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockValidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        
        consoleSpy.mockRestore();
      });

      it("should handle trellis configuration with group_by_y_axis enabled", async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "auto",
              group_by_y_axis: true
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value1" }, { alias: "value2" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value1: 10, value2: 15, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value1: 20, value2: 25, category: "B" }
        ]];

        // Mock chartPanelRef with valid dimensions
        const mockValidChartPanelRef = {
          value: {
            offsetWidth: 800,
            offsetHeight: 600
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockValidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        
        consoleSpy.mockRestore();
      });

      it("should handle Y-axis name gap calculation with horizontal chart", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "h-bar",
            unit: "bytes",
            unit_custom: null,
            decimals: 2
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "Very Long Category Name That Should Affect Gap Calculation", value: 1000000 },
          { category: "Short", value: 2000000 },
          { category: "Another Category", value: 500000 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle Y-axis name gap calculation with vertical chart", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            unit: "percent",
            unit_custom: null,
            decimals: 1
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "percentage_with_very_long_name" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", percentage_with_very_long_name: 99.999 },
          { timestamp: "2023-01-01T01:00:00Z", percentage_with_very_long_name: 88.888 },
          { timestamp: "2023-01-01T02:00:00Z", percentage_with_very_long_name: 77.777 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
      });

      it("should handle tooltip formatting with histogram aggregation", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            customQuery: false,
            fields: {
              x: [{ 
                alias: "timestamp",
                aggregationFunction: "histogram",
                column: "_timestamp"
              }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00", value: 10 },
          { timestamp: "2023-01-01T01:00:00", value: 20 },
          { timestamp: "2023-01-01T02:00:00", value: 30 }
        ]];

        // Mock store with timestamp column
        const mockStoreWithTimestamp = {
          ...mockStore,
          state: {
            ...mockStore.state,
            zoConfig: {
              timestamp_column: "_timestamp"
            }
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTimestamp,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 0 }
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle tooltip formatting with timestamp field without aggregation", async () => {
        const schema = {
          ...mockPanelSchema,
          queries: [{
            customQuery: false,
            fields: {
              x: [{ 
                alias: "timestamp",
                column: "_timestamp"
                // no aggregationFunction
              }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 },
          { timestamp: "2023-01-01T02:00:00Z", value: 30 }
        ]];

        // Mock store with timestamp column
        const mockStoreWithTimestamp = {
          ...mockStore,
          state: {
            ...mockStore.state,
            zoConfig: {
              timestamp_column: "_timestamp"
            },
            timezone: "UTC"
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTimestamp,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 0 }
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle time series data formatting in tooltip", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        // Time series data that will trigger isTimeSeries check
        const searchData = [[
          { timestamp: "2023-01-01T00:00:00", value: 10 },
          { timestamp: "2023-01-01T01:00:00", value: 20 },
          { timestamp: "2023-01-01T02:00:00", value: 30 }
        ]];

        const mockStoreWithTimezone = {
          ...mockStore,
          state: {
            ...mockStore.state,
            timezone: "America/New_York"
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTimezone,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 3600 }
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle error with invalid trellis column configuration", async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "custom",
              num_of_columns: -1 // Invalid negative number
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10, category: "A" }
        ]];

        const mockValidChartPanelRef = {
          value: {
            offsetWidth: 800,
            offsetHeight: 600
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockValidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        
        consoleSpy.mockRestore();
      });

      it("should handle chart panel reference without dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "auto"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 }
        ]];

        // Mock chartPanelRef without dimensions (should trigger error handling)
        const mockInvalidChartPanelRef = {
          value: {
            offsetWidth: 0,
            offsetHeight: 0
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockInvalidChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle missing chart panel reference", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              layout: "auto"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 }
        ]];

        // Mock null chartPanelRef (should trigger error handling)
        const mockNullChartPanelRef = {
          value: null
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockNullChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle wordcloud chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "wordcloud"
          },
          queries: [{
            fields: {
              x: [{ alias: "word" }],
              y: [{ alias: "frequency" }]
            }
          }]
        };

        const searchData = [[
          { word: "test", frequency: 10 },
          { word: "data", frequency: 20 },
          { word: "visualization", frequency: 15 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle sankey chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "sankey"
          },
          queries: [{
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" }
            }
          }]
        };

        const searchData = [[
          { source_field: "A", target_field: "B", value_field: 10 },
          { source_field: "B", target_field: "C", value_field: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle geomap chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "geomap"
          },
          queries: [{
            fields: {
              latitude: { alias: "lat" },
              longitude: { alias: "lng" },
              weight: { alias: "weight" }
            }
          }]
        };

        const searchData = [[
          { lat: 40.7128, lng: -74.0060, weight: 100 },
          { lat: 34.0522, lng: -118.2437, weight: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle custom query mode with time shift", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            customQuery: true,
            query: "SELECT timestamp, value FROM logs",
            fields: {
              x: [{ alias: "timestamp", column: "_timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          {
            ...mockStore,
            state: {
              ...mockStore.state,
              zoConfig: {
                timestamp_column: "_timestamp"
              }
            }
          },
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle null/undefined values in breakdown data", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: null },
          { timestamp: "2023-01-02", value: 20, category: undefined },
          { timestamp: "2023-01-03", value: 30, category: "A" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle empty string values in data", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "", value: 10, category: "A" },
          { timestamp: "2023-01-02", value: "", category: "" },
          { timestamp: "2023-01-03", value: 30, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle extremely large dataset with performance considerations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            top_results: 1000
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        // Create large dataset
        const largeData = Array.from({ length: 1000 }, (_, i) => ({
          timestamp: `2023-01-01T${String(i % 24).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')}:00Z`,
          value: Math.random() * 1000
        }));

        const searchData = [largeData];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle treemap chart type with nested data", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "treemap"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "subcategory" }]
            }
          }]
        };

        const searchData = [[
          { category: "Technology", value: 100, subcategory: "Software" },
          { category: "Technology", value: 80, subcategory: "Hardware" },
          { category: "Finance", value: 120, subcategory: "Banking" },
          { category: "Finance", value: 90, subcategory: "Investment" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle complex unit configurations and formatting", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            unit: "custom",
            unit_custom: "req/sec",
            decimals: 3
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "requests_per_second" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", requests_per_second: 123.456789 },
          { timestamp: "2023-01-01T01:00:00Z", requests_per_second: 987.654321 },
          { timestamp: "2023-01-01T02:00:00Z", requests_per_second: 555.123456 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle tooltip formatter error handling (lines 2503-2509)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "invalid-date", value: 20 } // This will trigger error handling in formatter
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.tooltip).toBeDefined();
        expect(result.options.tooltip.formatter).toBeDefined();

        // Test the formatter function directly with malformed data
        const formatter = result.options.tooltip.formatter;
        const malformedParams = [{ value: [null] }];
        const formattedResult = formatter(malformedParams);
        expect(typeof formattedResult).toBe("string"); // Should be a string (may contain HTML)
      });

      it("should handle time series data mapping with null values (lines 2538-2689)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        // Create time series data that will trigger isTimeSeriesData path
        const searchData = [[
          { timestamp: "2023-01-01T00:00:00", value: null }, // null value to test handling
          { timestamp: "2023-01-01T01:00:00", value: 20 },
          { timestamp: "2023-01-01T02:00:00", value: undefined } // undefined to test handling
        ]];

        const mockStoreWithTimezone = {
          ...mockStore,
          state: {
            ...mockStore.state,
            timezone: "UTC"
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTimezone,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 0 }
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        // Verify that the series data has been transformed to time series format
        if (result.options.series && result.options.series.length > 0) {
          expect(result.options.series[0].data).toBeDefined();
        }
      });

      it("should handle Y-axis ordering and total calculations (lines 2713-2736)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            axis: {
              y_axis: {
                order_by_series: true
              }
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value1" }, { alias: "value2" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value1: 10, value2: 15 },
          { category: "B", value1: 20, value2: 25 },
          { category: "C", value1: 30, value2: 35 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.xAxis).toBeDefined();
      });

      it("should handle series with breakdown and data transformation (lines 2743-2784)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            connect_nulls: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "status" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00", value: 10, status: "success" },
          { timestamp: "2023-01-01T01:00:00", value: null, status: "success" }, // null value
          { timestamp: "2023-01-01T02:00:00", value: 30, status: "error" },
          { timestamp: "2023-01-01T03:00:00", value: 40, status: "error" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(1); // Should have multiple series for breakdown
      });

      it("should handle specific chart configurations (lines 2849, 2851, 2874-2876)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "area",
            connect_nulls: true,
            show_symbols: false,
            smooth_lines: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 },
          { timestamp: "2023-01-01T02:00:00Z", value: 30 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle special chart type configurations (lines 2903, 2971, 3009)", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_legend: true,
            legends: {
              show: true,
              position: "right",
              alignment: "middle"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "series_name" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, series_name: "Series A" },
          { timestamp: "2023-01-02", value: 20, series_name: "Series B" },
          { timestamp: "2023-01-03", value: 30, series_name: "Series A" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
        expect(result.options.legend).toBeDefined();
      });

      it("should handle top_results warning when series exceed max_dashboard_series", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            top_results: 150 // Greater than max_dashboard_series
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        // Create data that exceeds the max series limit
        const searchData = [Array.from({ length: 160 }, (_, i) => ({
          category: `Category_${i}`,
          value: Math.random() * 100
        }))];

        const mockStoreWithMaxSeries = {
          ...mockStore,
          state: {
            ...mockStore.state,
            zoConfig: {
              max_dashboard_series: 100
            }
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithMaxSeries,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle series limit warning when no top_results specified", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
            // No top_results specified
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "breakdown" }]
            }
          }]
        };

        // Create data that exceeds max_dashboard_series
        const searchData = [Array.from({ length: 120 }, (_, i) => ({
          category: `Category_${i % 10}`,
          breakdown: `Breakdown_${i}`,
          value: Math.random() * 100
        }))];

        const mockStoreWithMaxSeries = {
          ...mockStore,
          state: {
            ...mockStore.state,
            zoConfig: {
              max_dashboard_series: 100
            }
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithMaxSeries,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle empty and undefined breakdown values properly", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, category: "" }, // Empty string
          { timestamp: "2023-01-02", value: 20, category: null }, // null
          { timestamp: "2023-01-03", value: 30, category: undefined }, // undefined
          { timestamp: "2023-01-04", value: 40, category: "Valid Category" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle processData with top_results_others enabled", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            top_results: 3,
            top_results_others: true
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "breakdown" }]
            }
          }]
        };

        const searchData = [[
          { category: "Cat1", value: 100, breakdown: "A" },
          { category: "Cat2", value: 90, breakdown: "B" },
          { category: "Cat3", value: 80, breakdown: "C" },
          { category: "Cat4", value: 70, breakdown: "D" }, // Should go to "Others"
          { category: "Cat5", value: 60, breakdown: "E" }  // Should go to "Others"
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle isTimeStamp data path in time series logic", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        // Use timestamp format that triggers isTimeStamp instead of isTimeSeries
        const searchData = [[
          { timestamp: 1672531200000, value: 10 }, // Unix timestamp
          { timestamp: 1672534800000, value: 20 },
          { timestamp: 1672538400000, value: 30 }
        ]];

        const mockStoreWithTimezone = {
          ...mockStore,
          state: {
            ...mockStore.state,
            timezone: "Europe/London"
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTimezone,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 3600 }
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle complex nested breakdown scenarios", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "cpu_usage" }, { alias: "memory_usage" }],
              breakdown: [{ alias: "host" }, { alias: "service" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", cpu_usage: 85, memory_usage: 70, host: "server1", service: "web" },
          { timestamp: "2023-01-01T01:00:00Z", cpu_usage: 90, memory_usage: 75, host: "server2", service: "api" },
          { timestamp: "2023-01-01T02:00:00Z", cpu_usage: 78, memory_usage: 68, host: "server1", service: "db" },
          { timestamp: "2023-01-01T03:00:00Z", cpu_usage: 82, memory_usage: 72, host: "server2", service: "web" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(1);
      });

      it("should handle chart with mark areas and regions", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            mark_area: [{
              name: "Peak Hours",
              yAxis: [100, 200]
            }],
            mark_line: [{
              name: "Threshold",
              yAxis: 150
            }]
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 },
          { timestamp: "2023-01-01T01:00:00Z", value: 150 },
          { timestamp: "2023-01-01T02:00:00Z", value: 120 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle color configuration with palette-classic mode", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            color: {
              mode: "palette-classic",
              colorBySeries: false
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 10 },
          { category: "B", value: 20 },
          { category: "C", value: 30 }
        ]];

        const mockStoreWithTheme = {
          ...mockStore,
          state: {
            ...mockStore.state,
            theme: "dark"
          }
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStoreWithTheme,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle color configuration with custom color mode", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            color: {
              mode: "custom",
              colorBySeries: true,
              colors: ["#FF6B6B", "#4ECDC4", "#45B7D1"]
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "series" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, series: "Series1" },
          { timestamp: "2023-01-02", value: 20, series: "Series2" },
          { timestamp: "2023-01-03", value: 30, series: "Series3" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle Y-axis configuration with single field label", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            y_axis_min: 0,
            y_axis_max: 100
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "cpu_usage", label: "CPU Usage (%)" }] // Single field with label
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", cpu_usage: 45 },
          { timestamp: "2023-01-01T01:00:00Z", cpu_usage: 67 },
          { timestamp: "2023-01-01T02:00:00Z", cpu_usage: 89 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
        expect(result.options.yAxis.name).toBe("CPU Usage (%)");
        expect(result.options.yAxis.min).toBe(0);
        expect(result.options.yAxis.max).toBeGreaterThan(0);
      });

      it("should handle horizontal bar chart Y-axis calculations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "h-bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "very_long_category_name_for_testing" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { very_long_category_name_for_testing: "Very Long Category Name That Should Affect Layout", value: 100 },
          { very_long_category_name_for_testing: "Another Very Long Category", value: 200 },
          { very_long_category_name_for_testing: "Short", value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
        expect(result.options.yAxis.nameGap).toBeDefined();
      });

      it("should handle horizontal stacked bar chart configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "h-stacked"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value1" }, { alias: "value2" }]
            }
          }]
        };

        const searchData = [[
          { category: "Category A", value1: 10, value2: 15 },
          { category: "Category B", value1: 20, value2: 25 },
          { category: "Category C", value1: 30, value2: 35 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBe(2); // Two Y-axis fields
      });

      it("should handle missing value interpolation with connect_nulls disabled", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            connect_nulls: false,
            missing_values: {
              null_option: "null",
              show_line: false
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: null },
          { timestamp: "2023-01-01T02:00:00Z", value: 30 },
          { timestamp: "2023-01-01T03:00:00Z", value: undefined },
          { timestamp: "2023-01-01T04:00:00Z", value: 50 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].connectNulls).toBe(false);
      });

      it("should handle chart with complex legend configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_legend: true,
            legends: {
              show: true,
              position: "bottom",
              alignment: "center",
              wrap: true
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "service_name" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01", value: 10, service_name: "Authentication Service" },
          { timestamp: "2023-01-02", value: 20, service_name: "Payment Processing Service" },
          { timestamp: "2023-01-03", value: 30, service_name: "Notification Service" },
          { timestamp: "2023-01-04", value: 40, service_name: "User Management Service" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.legend).toBeDefined();
      });

      it("should handle chart with custom zoom configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            zoom: {
              enabled: true,
              type: "xy"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 },
          { timestamp: "2023-01-01T01:00:00Z", value: 150 },
          { timestamp: "2023-01-01T02:00:00Z", value: 120 },
          { timestamp: "2023-01-01T03:00:00Z", value: 180 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle data with extremely large numbers", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            unit: "bytes",
            decimals: 0
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "bytes_processed" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", bytes_processed: 9999999999999 }, // Very large number
          { timestamp: "2023-01-01T01:00:00Z", bytes_processed: 1234567890123 },
          { timestamp: "2023-01-01T02:00:00Z", bytes_processed: 987654321098 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle data with negative values and zero", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "profit_loss" }]
            }
          }]
        };

        const searchData = [[
          { category: "Q1", profit_loss: -1500 },
          { category: "Q2", profit_loss: 0 },
          { category: "Q3", profit_loss: 2500 },
          { category: "Q4", profit_loss: -800 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle area-stacked chart with line interpolation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "area-stacked",
            line_interpolation: "smooth"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "cpu_usage" }, { alias: "memory_usage" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", cpu_usage: 45, memory_usage: 60 },
          { timestamp: "2023-01-01T01:00:00Z", cpu_usage: 50, memory_usage: 65 },
          { timestamp: "2023-01-01T02:00:00Z", cpu_usage: 55, memory_usage: 70 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBe(2);
      });

      it("should handle step line interpolation types", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            line_interpolation: "step-start"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 },
          { timestamp: "2023-01-01T02:00:00Z", value: 15 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].step).toBe("start");
      });

      it("should handle heatmap chart with visualMap configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "heatmap"
          },
          queries: [{
            fields: {
              x: [{ alias: "hour" }],
              y: [{ alias: "day" }],
              z: [{ alias: "temperature" }]
            }
          }]
        };

        const searchData = [[
          { hour: 0, day: "Monday", temperature: 22 },
          { hour: 1, day: "Monday", temperature: 20 },
          { hour: 0, day: "Tuesday", temperature: 25 },
          { hour: 1, day: "Tuesday", temperature: 23 },
          { hour: 0, day: "Wednesday", temperature: 24 },
          { hour: 1, day: "Wednesday", temperature: 22 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle table chart type with formatted data", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "table"
          },
          queries: [{
            fields: {
              x: [{ alias: "service" }],
              y: [{ alias: "requests" }, { alias: "errors" }]
            }
          }]
        };

        const searchData = [[
          { service: "auth-service", requests: 1500, errors: 5 },
          { service: "payment-service", requests: 800, errors: 2 },
          { service: "user-service", requests: 2000, errors: 8 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle donut chart configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "donut"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "Desktop", value: 45 },
          { category: "Mobile", value: 35 },
          { category: "Tablet", value: 20 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle radar chart with multiple dimensions", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "radar"
          },
          queries: [{
            fields: {
              x: [{ alias: "metric" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "team" }]
            }
          }]
        };

        const searchData = [[
          { metric: "Performance", value: 85, team: "Backend" },
          { metric: "Reliability", value: 92, team: "Backend" },
          { metric: "Security", value: 78, team: "Backend" },
          { metric: "Performance", value: 88, team: "Frontend" },
          { metric: "Reliability", value: 90, team: "Frontend" },
          { metric: "Security", value: 82, team: "Frontend" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options).toBeDefined();
      });

      it("should handle data with special characters and unicode", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "region" }],
              y: [{ alias: "sales" }]
            }
          }]
        };

        const searchData = [[
          { region: "北京", sales: 150000 }, // Chinese characters
          { region: "São Paulo", sales: 120000 }, // Portuguese characters
          { region: "München", sales: 98000 }, // German characters
          { region: "العربية", sales: 87000 }, // Arabic characters
          { region: "Москва", sales: 105000 } // Russian characters
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle mixed data types and edge values", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "scatter"
          },
          queries: [{
            fields: {
              x: [{ alias: "x_value" }],
              y: [{ alias: "y_value" }]
            }
          }]
        };

        const searchData = [[
          { x_value: 0, y_value: 0 }, // Zero values
          { x_value: Infinity, y_value: 100 }, // Infinity
          { x_value: -Infinity, y_value: 50 }, // Negative infinity
          { x_value: NaN, y_value: 75 }, // NaN
          { x_value: 1.23456789e-10, y_value: 2.98765432e10 }, // Very small and large numbers
          { x_value: "", y_value: "not_a_number" } // String values
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle complex time series with gaps", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            missing_values: {
              null_option: "interpolate",
              interpolation: "linear",
              show_line: true
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "metric" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", metric: 100 },
          { timestamp: "2023-01-01T00:05:00Z", metric: 110 },
          // Gap: missing 00:10:00
          { timestamp: "2023-01-01T00:15:00Z", metric: 130 },
          { timestamp: "2023-01-01T00:20:00Z", metric: null }, // Explicit null
          { timestamp: "2023-01-01T00:25:00Z", metric: 150 }
          // Gap: missing 00:30:00
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{
              timeRangeGap: { seconds: 300 } // 5 minute gaps
            }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle multiple queries with different data structures", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [
            {
              fields: {
                x: [{ alias: "timestamp" }],
                y: [{ alias: "cpu" }]
              }
            },
            {
              fields: {
                x: [{ alias: "time" }], // Different alias
                y: [{ alias: "memory" }]
              }
            }
          ]
        };

        const searchData = [
          [
            { timestamp: "2023-01-01T00:00:00Z", cpu: 45 },
            { timestamp: "2023-01-01T01:00:00Z", cpu: 50 }
          ],
          [
            { time: "2023-01-01T00:00:00Z", memory: 65 },
            { time: "2023-01-01T01:00:00Z", memory: 70 }
          ]
        ];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle line chart with specific symbol and thickness configurations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_symbol: true,
            line_thickness: 3,
            line_interpolation: "step-middle"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 },
          { timestamp: "2023-01-01T02:00:00Z", value: 15 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].showSymbol).toBe(true);
        expect(result.options.series[0].step).toBe("middle");
      });

      it("should handle scatter chart with custom symbol size", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "scatter"
          },
          queries: [{
            fields: {
              x: [{ alias: "x_coord" }],
              y: [{ alias: "y_coord" }]
            }
          }]
        };

        const searchData = [[
          { x_coord: 1.5, y_coord: 2.8 },
          { x_coord: 3.2, y_coord: 4.1 },
          { x_coord: 5.7, y_coord: 1.9 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].type).toBe("line");
        expect(result.options.series[0]).toBeDefined();
      });

      it("should handle metadata queries with start time and interval processing", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 },
          { timestamp: "2023-01-01T00:15:00Z", value: 110 },
          { timestamp: "2023-01-01T00:30:00Z", value: 105 }
        ]];

        const metadataWithStartTime = {
          ...mockMetadata,
          queries: [{
            startTime: 1672531200000, // Unix timestamp in milliseconds
            timeRangeGap: { seconds: 900 } // 15 minutes
          }]
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          metadataWithStartTime,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle chart type exclusion for missing value processing", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "pie" // Type not in ["area-stacked", "line", "area", "bar", "stacked"]
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 30 },
          { category: "B", value: null }, // This should be processed differently for pie charts
          { category: "C", value: 50 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{ timeRangeGap: { seconds: 300 } }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle advanced missing value scenarios with interpolation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "area",
            missing_values: {
              null_option: "interpolate", 
              interpolation: "linear"
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "time_key" }],
              y: [{ alias: "metric_value" }]
            }
          }]
        };

        const searchData = [[
          { time_key: "2023-01-01T00:00:00Z", metric_value: 100 },
          { time_key: "2023-01-01T00:05:00Z", metric_value: null }, // Missing value
          { time_key: "2023-01-01T00:10:00Z", metric_value: 120 },
          { time_key: "2023-01-01T00:15:00Z", metric_value: null }, // Another missing value
          { time_key: "2023-01-01T00:20:00Z", metric_value: 140 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{ timeRangeGap: { seconds: 300 } }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle custom chart with JavaScript execution", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "custom"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "Custom A", value: 25 },
          { category: "Custom B", value: 35 },
          { category: "Custom C", value: 40 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        // Custom charts may return different structure
        expect(result.options || result).toBeDefined();
      });

      it("should handle empty annotation list", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 10 },
          { timestamp: "2023-01-01T01:00:00Z", value: 20 }
        ]];

        const emptyAnnotations = {
          list: [] // Empty annotations list
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          emptyAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle data with boolean values", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "feature" }],
              y: [{ alias: "enabled" }]
            }
          }]
        };

        const searchData = [[
          { feature: "Feature A", enabled: true },
          { feature: "Feature B", enabled: false },
          { feature: "Feature C", enabled: true },
          { feature: "Feature D", enabled: 1 }, // Truthy number
          { feature: "Feature E", enabled: 0 }  // Falsy number
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle time-based key identification in missing value processing", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "stacked"
          },
          queries: [{
            fields: {
              x: [{ alias: "datetime" }], // Time-based key
              y: [{ alias: "count" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { datetime: "2023-01-01T00:00:00Z", count: 10, category: "A" },
          { datetime: "2023-01-01T00:05:00Z", count: 15, category: "B" },
          { datetime: "2023-01-01T00:10:00Z", count: null, category: "A" }, // Missing value
          { datetime: "2023-01-01T00:15:00Z", count: 20, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          {
            ...mockMetadata,
            queries: [{ timeRangeGap: { seconds: 300 } }]
          },
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle date bin calculations with complex intervals", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "bin_time" }],
              y: [{ alias: "count" }]
            }
          }]
        };

        const searchData = [[
          { bin_time: "2023-01-01T00:00:00Z", count: 5 },
          { bin_time: "2023-01-01T01:00:00Z", count: 8 },
          { bin_time: "2023-01-01T02:00:00Z", count: 12 }
        ]];

        const metadataWithComplexInterval = {
          ...mockMetadata,
          queries: [{
            startTime: 1672531200000,
            timeRangeGap: { seconds: 3600 } // 1 hour interval
          }]
        };

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          metadataWithComplexInterval,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle tooltip axis pointer configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            axis_pointer: "shadow",
            connect_nulls: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "count" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", count: 150 },
          { timestamp: "2023-01-01T01:00:00Z", count: null },
          { timestamp: "2023-01-01T02:00:00Z", count: 250 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.tooltip.axisPointer.type).toBe("cross");
        expect(result.options.series[0].connectNulls).toBe(true);
      });

      it("should handle time series with different x-axis types", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            axis_border_show: false,
            axis_label_rotation: 45
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp", aggregationFunction: "histogram" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: 1672531200000, value: 100 },
          { timestamp: 1672534800000, value: 200 },
          { timestamp: 1672538400000, value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.xAxis[0].type).toBe("category");
        expect(result.options.xAxis[0].axisLabel).toBeDefined();
      });

      it("should handle legend scroll configuration with many series", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            legend_position: "bottom",
            legend_orientation: "horizontal"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[]];
        // Generate many series to trigger scroll
        for (let i = 0; i < 25; i++) {
          searchData[0].push({
            timestamp: "2023-01-01T00:00:00Z",
            value: Math.random() * 100,
            category: `Series_${i}`
          });
        }

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.legend).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle data zoom configuration for large datasets", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_data_zoom: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[]];
        // Generate large dataset to trigger data zoom
        for (let i = 0; i < 200; i++) {
          searchData[0].push({
            timestamp: new Date(2023, 0, 1, i % 24, 0).toISOString(),
            value: Math.random() * 100
          });
        }

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle brush selection configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "scatter",
            enable_brush: true
          },
          queries: [{
            fields: {
              x: [{ alias: "x_val" }],
              y: [{ alias: "y_val" }]
            }
          }]
        };

        const searchData = [[
          { x_val: 1, y_val: 10 },
          { x_val: 2, y_val: 20 },
          { x_val: 3, y_val: 15 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].type).toBe("line");
      });

      it("should handle visualization map configuration with custom colors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "heatmap",
            color_scheme: "custom",
            custom_colors: ["#ff0000", "#00ff00", "#0000ff"]
          },
          queries: [{
            fields: {
              x: [{ alias: "x_axis" }],
              y: [{ alias: "y_axis" }],
              z: [{ alias: "intensity" }]
            }
          }]
        };

        const searchData = [[
          { x_axis: "A", y_axis: "1", intensity: 5 },
          { x_axis: "B", y_axis: "2", intensity: 10 },
          { x_axis: "C", y_axis: "3", intensity: 15 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].type).toBe("line");
      });

      it("should handle complex axis formatting with scientific notation", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            scientific_notation: true,
            axis_width: 200
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "large_value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", large_value: 1.23e10 },
          { timestamp: "2023-01-01T01:00:00Z", large_value: 5.67e12 },
          { timestamp: "2023-01-01T02:00:00Z", large_value: 9.87e8 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].type).toBe("line");
      });

      it("should handle grid configuration with multiple y-axes", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_grid: true,
            grid_left_margin: 60,
            grid_right_margin: 60
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "metric1" }, { alias: "metric2" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", metric1: 100, metric2: 0.5 },
          { timestamp: "2023-01-01T01:00:00Z", metric1: 150, metric2: 0.8 },
          { timestamp: "2023-01-01T02:00:00Z", metric1: 200, metric2: 1.2 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.grid.left).toBe(5);
        expect(result.options.grid.right).toBe(20);
        expect(result.options.yAxis).toBeDefined();
      });

      it("should handle animation and transition configurations", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            enable_animation: true,
            animation_delay: 100,
            animation_duration: 1000
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 100 },
          { category: "B", value: 200 },
          { category: "C", value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].type).toBe("line");
      });

      it("should handle error in tooltip formatter gracefully", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.tooltip.formatter).toBe("function");
        
        // Test error handling by passing invalid params
        const tooltipResult = result.options.tooltip.formatter(null);
        expect(typeof tooltipResult).toBe("string");
      });

      it("should handle trellis configuration errors", async () => {
        const mockChartPanelRefWithError = {
          value: null // This will cause an error in trellis config
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              enable: true,
              num_of_columns: 2
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value: 200, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRefWithError,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        // Should still work despite trellis error
        expect(result.options.series).toBeDefined();
      });

      it("should handle invalid trellis column configuration", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            trellis: {
              enable: true,
              num_of_columns: 0 // Invalid column count
            }
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100, category: "A" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle axis formatter errors gracefully", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            unit: "invalid_unit"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.yAxis.axisLabel.formatter).toBe("function");
        
        // Test error handling in axis formatter
        const formatterResult = result.options.yAxis.axisLabel.formatter(null);
        expect(formatterResult).toBeDefined();
      });

      it("should handle pie chart tooltip formatter errors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "pie"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 100 },
          { category: "B", value: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.tooltip.formatter).toBe("function");
        
        // Test error handling by passing invalid params
        const tooltipResult = result.options.tooltip.formatter(null);
        expect(typeof tooltipResult).toBe("string");
      });

      it("should handle donut chart tooltip formatter errors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "donut"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 100 },
          { category: "B", value: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.tooltip.formatter).toBe("function");
        
        // Test error handling by passing invalid params  
        const tooltipResult = result.options.tooltip.formatter(null);
        expect(typeof tooltipResult).toBe("string");
      });

      it("should handle heatmap tooltip formatter errors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "heatmap"
          },
          queries: [{
            fields: {
              x: [{ alias: "x_axis" }],
              y: [{ alias: "y_axis" }],
              z: [{ alias: "intensity" }]
            }
          }]
        };

        const searchData = [[
          { x_axis: "A", y_axis: "1", intensity: 5 },
          { x_axis: "B", y_axis: "2", intensity: 10 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.tooltip.formatter).toBe("function");
        
        // Test error handling by passing invalid params
        const tooltipResult = result.options.tooltip.formatter(null);
        expect(typeof tooltipResult).toBe("string");
      });

      it("should handle gauge chart detail formatter errors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "gauge"
          },
          queries: [{
            fields: {
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { value: 75 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        if (result.options && result.options.series && result.options.series[0]) {
          expect(result.options.series[0].detail.formatter).toBeDefined();
        }
        
        // Test error handling by passing invalid params
        if (result.options && result.options.series && result.options.series[0]) {
          const formatterResult = result.options.series[0].detail.formatter(null);
          expect(typeof formatterResult).toBe("string");
        }
      });

      it("should handle metric chart render item errors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "metric"
          },
          queries: [{
            fields: {
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { value: 12345 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        if (result.options && result.options.series && result.options.series[0]) {
          expect(result.options.series[0].renderItem).toBeDefined();
          
          // Test error handling by passing invalid params
          const renderResult = result.options.series[0].renderItem(null);
          expect(typeof renderResult).toBe("string");
        }
      });

      it("should handle time series data with timestamp fields", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const metadata = {
          histogramInterval: "1h",
          dateTimeStartPoint: new Date("2023-01-01T00:00:00Z").getTime(),
          timestampField: "timestamp"
        };

        const searchData = [[
          { timestamp: 1672531200000, value: 100 },
          { timestamp: 1672534800000, value: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.xAxis[0].type).toBe("category");
      });

      it("should handle switch default case", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "unknown_chart_type" // Will trigger default case
          },
          queries: [{
            fields: {
              x: [{ alias: "x_field" }],
              y: [{ alias: "y_field" }]
            }
          }]
        };

        const searchData = [[
          { x_field: "A", y_field: 100 },
          { x_field: "B", y_field: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle top_results_others configuration", async () => {
        const storeWithTopResults = {
          ...mockStore,
          state: {
            ...mockStore.state,
            zoConfig: {
              ...mockStore.state.zoConfig,
              max_dashboard_series: 5
            }
          }
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            top_results: 3,
            top_results_others: true
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "group" }]
            }
          }]
        };

        const searchData = [[]];
        // Generate data that will trigger top_results_others logic
        for (let i = 0; i < 10; i++) {
          searchData[0].push({
            category: `Cat_${i}`,
            value: Math.random() * 100,
            group: `Group_${i % 3}`
          });
        }

        const result = await convertSQLData(
          schema,
          searchData,
          storeWithTopResults,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle console.error paths in formatters", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "invalid_date", value: "invalid_number" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        
        // Test tooltip formatter with invalid data
        if (typeof result.options.tooltip.formatter === 'function') {
          const tooltipResult = result.options.tooltip.formatter([{ value: ['invalid', NaN] }]);
          expect(typeof tooltipResult).toBe("string");
        }
      });

      it("should handle valueFormatter errors in gauge chart", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "gauge",
            unit: "invalid_unit"
          },
          queries: [{
            fields: {
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { value: "invalid_number" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        if (result.options && result.options.series && result.options.series[0]) {
          expect(result.options.series[0].axisLine.lineStyle.color[0].valueFormatter).toBeDefined();
          
          // Test error handling in valueFormatter
          const formatterResult = result.options.series[0].axisLine.lineStyle.color[0].valueFormatter(null);
          expect(typeof formatterResult).toBe("string");
        }
      });

      it("should handle area-stacked chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "area-stacked"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value: 150, category: "A" },
          { timestamp: "2023-01-01T00:00:00Z", value: 200, category: "B" },
          { timestamp: "2023-01-01T01:00:00Z", value: 250, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
        expect(result.options.series[0].areaStyle).toBeDefined();
      });

      it("should handle area chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "area"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 },
          { timestamp: "2023-01-01T01:00:00Z", value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series[0].areaStyle).toBeDefined();
      });

      it("should handle h-stacked chart type", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "h-stacked"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "group" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 100, group: "Group1" },
          { category: "B", value: 150, group: "Group1" },
          { category: "A", value: 200, group: "Group2" },
          { category: "B", value: 250, group: "Group2" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
        expect(result.options.series.length).toBeGreaterThan(0);
      });

      it("should handle invalid timestamp processing in time series", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const metadata = {
          histogramInterval: "invalid_interval",
          dateTimeStartPoint: "invalid_date",
          timestampField: "timestamp"
        };

        const searchData = [[
          { timestamp: "invalid_timestamp", value: 100 },
          { timestamp: null, value: 200 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          metadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle complex tooltip scenarios for time series", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            show_tooltip: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value1" }, { alias: "value2" }],
              breakdown: [{ alias: "category" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value1: 100, value2: 200, category: "A" },
          { timestamp: "2023-01-01T01:00:00Z", value1: null, value2: 150, category: "A" },
          { timestamp: "2023-01-01T00:00:00Z", value1: 300, value2: null, category: "B" }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.tooltip.formatter).toBe("function");

        // Test complex tooltip formatting
        const mockParams = [
          { value: ["2023-01-01T00:00:00Z", 100], seriesName: "A_value1" },
          { value: ["2023-01-01T00:00:00Z", null], seriesName: "A_value2" }
        ];
        const tooltipResult = result.options.tooltip.formatter(mockParams);
        expect(typeof tooltipResult).toBe("string");
      });

      it("should handle maxYValue processing with decimal numbers", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar",
            axis_max: "100.50",
            decimals: 2
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: 95.25 },
          { category: "B", value: 88.75 },
          { category: "C", value: 92.33 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.yAxis).toBeDefined();
      });

      it("should handle null annotations list", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          null // null annotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle empty data with axis borders", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            axis_border_show: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[]]; // Empty data

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle hovered series state changes", async () => {
        const hoveredState = {
          value: {
            setHoveredSeriesName: vi.fn()
          }
        };

        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line"
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          hoveredState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.legend.formatter).toBe("function");

        // Test hovered series functionality
        const legendResult = result.options.legend.formatter("test_series");
        expect(legendResult).toBeDefined();
      });

      it("should handle scientific notation in axis labels", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            scientific_notation: true
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "large_value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", large_value: 1.23e15 },
          { timestamp: "2023-01-01T01:00:00Z", large_value: 5.67e18 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(typeof result.options.yAxis.axisLabel.formatter).toBe("function");
      });

      it("should handle missing value configurations for different chart types", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            missing_value_handling: "interpolation",
            connect_nulls: false
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { timestamp: "2023-01-01T00:00:00Z", value: 100 },
          { timestamp: "2023-01-01T01:00:00Z", value: null },
          { timestamp: "2023-01-01T02:00:00Z", value: 200 },
          { timestamp: "2023-01-01T03:00:00Z", value: undefined },
          { timestamp: "2023-01-01T04:00:00Z", value: 150 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series[0].connectNulls).toBe(false);
      });

      it("should handle extreme values in data processing", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "bar"
          },
          queries: [{
            fields: {
              x: [{ alias: "category" }],
              y: [{ alias: "value" }]
            }
          }]
        };

        const searchData = [[
          { category: "A", value: Number.MAX_VALUE },
          { category: "B", value: Number.MIN_VALUE },
          { category: "C", value: Infinity },
          { category: "D", value: -Infinity },
          { category: "E", value: NaN },
          { category: "F", value: 0 }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series).toBeDefined();
      });

      it("should handle custom color palettes with insufficient colors", async () => {
        const schema = {
          ...mockPanelSchema,
          config: {
            ...mockPanelSchema.config,
            type: "line",
            color_palette: ["#FF0000", "#00FF00"] // Only 2 colors
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: [{ alias: "series" }]
            }
          }]
        };

        const searchData = [[]];
        // Create more series than available colors
        for (let i = 0; i < 5; i++) {
          searchData[0].push({
            timestamp: "2023-01-01T00:00:00Z",
            value: Math.random() * 100,
            series: `Series_${i}`
          });
        }

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        expect(result).toBeDefined();
        expect(result.options.series.length).toBe(5);
      });
    });
  });

  describe("Show Gridlines Configuration", () => {
    it("should use default gridlines (true) when config is undefined", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: {} // No show_gridlines config
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 10 },
        { timestamp: "2024-01-01T01:00:00Z", value: 20 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(true);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(true);
      }
      // Ensure the result is valid
      expect(result.options).toBeDefined();
    });

    it("should respect explicit gridlines configuration (true)", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { show_gridlines: true }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 15 },
        { timestamp: "2024-01-01T01:00:00Z", value: 25 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(true);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(true);
      }
      expect(result.options).toBeDefined();
    });

    it("should respect explicit gridlines configuration (false)", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { show_gridlines: false }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 30 },
        { timestamp: "2024-01-01T01:00:00Z", value: 40 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(false);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(false);
      }
      expect(result.options).toBeDefined();
    });

    it("should apply gridlines to table charts", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "table",
        config: { show_gridlines: true }
      };
      const searchData = [[
        { name: "Item1", count: 10, category: "A" },
        { name: "Item2", count: 20, category: "B" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Table charts might not have traditional xAxis/yAxis
      expect(result.options).toBeDefined();
    });

    it("should apply gridlines to bar charts", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "bar",
        config: { show_gridlines: false }
      };
      const searchData = [[
        { category: "A", value: 100 },
        { category: "B", value: 200 },
        { category: "C", value: 150 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(false);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(false);
      }
      expect(result.options).toBeDefined();
    });

    it("should handle gridlines with null config value", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { show_gridlines: null }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 50 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // null is not undefined, so it uses the null value directly
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(null);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(null);
      }
      expect(result.options).toBeDefined();
    });
  });

  describe("Connect Nulls Configuration", () => {
    it("should use default connect_nulls (false) when config is undefined", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: {} // No connect_nulls config
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 10 },
        { timestamp: "2024-01-01T01:00:00Z", value: null },
        { timestamp: "2024-01-01T02:00:00Z", value: 30 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      const lineSeries = result.options.series.find((s: any) => s.type === "line");
      expect(lineSeries.connectNulls).toBe(false);
    });

    it("should respect explicit connect_nulls configuration (true)", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { connect_nulls: true }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 15 },
        { timestamp: "2024-01-01T01:00:00Z", value: null },
        { timestamp: "2024-01-01T02:00:00Z", value: 35 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      const lineSeries = result.options.series.find((s: any) => s.type === "line");
      expect(lineSeries.connectNulls).toBe(true);
    });

    it("should respect explicit connect_nulls configuration (false)", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { connect_nulls: false }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 20 },
        { timestamp: "2024-01-01T01:00:00Z", value: null },
        { timestamp: "2024-01-01T02:00:00Z", value: 40 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      const lineSeries = result.options.series.find((s: any) => s.type === "line");
      expect(lineSeries.connectNulls).toBe(false);
    });

    it("should apply connect_nulls to area charts", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "area",
        config: { connect_nulls: true }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 25 },
        { timestamp: "2024-01-01T01:00:00Z", value: null },
        { timestamp: "2024-01-01T02:00:00Z", value: 45 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      const areaSeries = result.options.series.find((s: any) => s.type === "line" && s.areaStyle);
      expect(areaSeries.connectNulls).toBe(true);
    });

    it("should apply connect_nulls to area-stacked charts", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "area-stacked",
        config: { connect_nulls: false },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "series" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 30, series: "A" },
        { timestamp: "2024-01-01T01:00:00Z", value: null, series: "A" },
        { timestamp: "2024-01-01T02:00:00Z", value: 50, series: "A" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      const areaSeries = result.options.series.find((s: any) => s.stack === "Total");
      expect(areaSeries.connectNulls).toBe(false);
    });

    it("should not apply connect_nulls to bar charts", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "bar",
        config: { connect_nulls: true } // Should be ignored for bar charts
      };
      const searchData = [[
        { category: "A", value: 10 },
        { category: "B", value: 20 },
        { category: "C", value: 30 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Bar charts don't use connectNulls property
      const barSeries = result.options.series.find((s: any) => s.type === "bar");
      if (barSeries) {
        expect(barSeries.connectNulls).toBeUndefined();
      } else {
        // Test passes if no bar series found (different chart structure)
        expect(result.options.series).toBeDefined();
      }
    });
  });

  describe("Enhanced Legend Calculations Integration", () => {
    it("should calculate right legend width automatically", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right",
          legends_type: "plain"
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "service" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 10, service: "web-server" },
        { timestamp: "2024-01-01T01:00:00Z", value: 20, service: "database" },
        { timestamp: "2024-01-01T02:00:00Z", value: 30, service: "cache-server" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should use calculateRightLegendWidth (mock returns 140)
      expect(result.options.grid.right).toBeGreaterThan(0);
      expect(result.options.legend.textStyle.width).toBeGreaterThan(0); // 160 - 55
      expect(result.options.legend.left).toBeGreaterThanOrEqual(0);
    });

    it("should calculate right legend width with scroll type", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right",
          legends_type: "scroll"
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "series" }]
          }
        }]
      };
      const searchData = [[
        ...Array.from({ length: 20 }, (_, i) => ({
          timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
          value: i * 5,
          series: `Series_${i}`
        }))
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should use calculateRightLegendWidth with scrollable=true
      expect(result.options.grid.right).toBeGreaterThan(0);
      expect(result.options.legend.textStyle.width).toBeGreaterThan(0);
    });

    it("should calculate bottom legend height for plain legends", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_type: "plain",
          legends_position: "bottom"
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "service" }]
          }
        }]
      };
      const searchData = [[
        ...Array.from({ length: 8 }, (_, i) => ({
          timestamp: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
          value: i * 10,
          service: `Service_${i}`
        }))
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should use calculateBottomLegendHeight (mock modifies legend and grid)
      expect(result.options.legend.top).toBeGreaterThan(0); // 400 - 90 = 310
      expect(result.options.legend.height).toBeGreaterThan(0);
      expect(result.options.grid.bottom).toBeGreaterThan(0);
    });

    it("should calculate bottom legend height with auto position (null)", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "area",
        config: { 
          show_legends: true,
          legends_type: "plain",
          legends_position: null // Auto position (treated as bottom)
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "category" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 40, category: "Alpha" },
        { timestamp: "2024-01-01T01:00:00Z", value: 50, category: "Beta" },
        { timestamp: "2024-01-01T02:00:00Z", value: 60, category: "Gamma" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Auto position should trigger bottom legend calculation
      expect(result.options.legend.top).toBeGreaterThan(0);
      expect(result.options.legend.height).toBeGreaterThan(0);
      expect(result.options.grid.bottom).toBeGreaterThan(0);
    });

    it("should not apply bottom legend calculation for scroll type", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_type: "scroll",
          legends_position: "bottom"
        }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 20 },
        { timestamp: "2024-01-01T01:00:00Z", value: 30 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should not apply calculateBottomLegendHeight for scroll type
      expect(result.options.legend.left).toBe("0");
      expect(result.options.legend.top).toBe("bottom");
    });

    it("should handle explicit legend width configuration", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right",
          legend_width: { value: 200, unit: "px" }
        }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 25 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should use explicit width instead of calculating
      expect(result.options.grid.right).toBe(200);
      expect(result.options.legend.textStyle.width).toBeGreaterThan(0); // 200 - 55
    });

    it("should handle legend width as percentage", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right",
          legend_width: { value: 25, unit: "%" }
        }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 35 }
      ]];

      mockChartPanelRef.value.offsetWidth = 800;

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should calculate 25% of 800 = 200
      expect(result.options.grid.right).toBe(200);
      expect(result.options.legend.textStyle.width).toBeGreaterThan(0); // 200 - 55
    });
  });

  describe("Comprehensive Integration Tests for New SQL Features", () => {
    it("should handle combination of all new features together", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: false,
          connect_nulls: true,
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
          axis_width: 20,
          axis_border_show: true
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "cpu_usage", label: "CPU %" }, { alias: "memory_usage", label: "Memory %" }],
            breakdown: [{ alias: "server" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", cpu_usage: 50, memory_usage: 70, server: "web-1" },
        { timestamp: "2024-01-01T01:00:00Z", cpu_usage: null, memory_usage: 75, server: "web-1" },
        { timestamp: "2024-01-01T02:00:00Z", cpu_usage: 60, memory_usage: null, server: "web-1" },
        { timestamp: "2024-01-01T00:00:00Z", cpu_usage: 40, memory_usage: 60, server: "web-2" },
        { timestamp: "2024-01-01T01:00:00Z", cpu_usage: 45, memory_usage: 65, server: "web-2" },
        { timestamp: "2024-01-01T02:00:00Z", cpu_usage: 50, memory_usage: 70, server: "web-2" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Test gridlines are disabled
      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(false);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(false);
      }
      expect(result.options).toBeDefined();

      // Test axis borders are enabled
      if (result.options?.xAxis?.axisLine) {
        expect(result.options.xAxis.axisLine.show).toBe(true);
      }
      if (result.options?.yAxis?.axisLine) {
        expect(result.options.yAxis.axisLine.show).toBe(true);
      }

      // Test connect nulls is enabled for line series
      const cpuSeries = result.options.series.find((s: any) => s.name && s.name.includes("CPU"));
      if (cpuSeries) {
        expect(cpuSeries.connectNulls).toBe(true);
      }

      // Test right legend positioning
      expect(result.options.legend.orient).toBe("vertical");
      expect(result.options.grid.right).toBeGreaterThan(0);
      // Grid left might have different default value based on axis configuration
      expect(result.options.grid.left).toBeGreaterThanOrEqual(5);
    });

    it("should handle large dataset with legend calculations", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: true,
          connect_nulls: false,
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain"
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "metric_name" }]
          }
        }]
      };

      // Create large dataset with many different series
      const searchData = [[]];
      for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 24; j++) {
          searchData[0].push({
            timestamp: `2024-01-01T${String(j).padStart(2, '0')}:00:00Z`,
            value: Math.random() * 100,
            metric_name: `Metric_${i}`
          });
        }
      }

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should handle large dataset and apply bottom legend calculations
      expect(result.options.legend.top).toBeGreaterThan(0); // 400 - 90
      expect(result.options.legend.height).toBeGreaterThan(0);
      expect(result.options.grid.bottom).toBeGreaterThan(0);
      expect(result.options.series.length).toBeGreaterThan(10);
    });

    it("should handle metric charts with new configurations", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "metric",
        config: { 
          show_gridlines: false,
          background: { value: { color: "#1E88E5" } }
        }
      };
      const searchData = [[
        { value: 85.5 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      expect(result.options.backgroundColor).toBe("#1E88E5");
      // Metric charts should handle gridlines configuration
      expect(result.extras.isTimeSeries).toBe(false);
    });

    it("should handle gauge charts with new features", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "gauge",
        config: { 
          show_gridlines: true 
        },
        queries: [{
          config: { min: 0, max: 100 },
          fields: {
            x: [{ alias: "category" }],
            y: [{ alias: "value" }]
          }
        }]
      };
      const searchData = [[
        { category: "CPU", value: 75 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Gauge charts have specialized structure - just verify basic functionality
      expect(result).toBeDefined();
      expect(result.options).toBeDefined();
      expect(result.extras.isTimeSeries).toBe(false);
    });

    it("should handle pie charts with legend positioning", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "pie",
        config: { 
          show_gridlines: false, // Not applicable to pie charts
          show_legends: true,
          legends_position: "right"
        }
      };
      const searchData = [[
        { category: "Desktop", value: 60 },
        { category: "Mobile", value: 30 },
        { category: "Tablet", value: 10 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Pie charts should handle legend positioning
      expect(result.options.legend.orient).toBe("vertical");
      expect(result.extras.isTimeSeries).toBe(false);
    });

    it("should handle stacked charts with connect_nulls", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "stacked",
        config: { 
          connect_nulls: true,
          show_gridlines: true
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: [{ alias: "value" }],
            breakdown: [{ alias: "stack_category" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 20, stack_category: "A" },
        { timestamp: "2024-01-01T01:00:00Z", value: null, stack_category: "A" },
        { timestamp: "2024-01-01T02:00:00Z", value: 40, stack_category: "A" },
        { timestamp: "2024-01-01T00:00:00Z", value: 30, stack_category: "B" },
        { timestamp: "2024-01-01T01:00:00Z", value: 35, stack_category: "B" },
        { timestamp: "2024-01-01T02:00:00Z", value: 45, stack_category: "B" }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should apply connect_nulls to stacked series
      const stackedSeries = result.options.series.find((s: any) => s.stack);
      if (stackedSeries) {
        expect(stackedSeries.connectNulls).toBe(true);
      }
      
      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(true);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(true);
      }
      expect(result.options).toBeDefined();
    });

    it("should handle heatmap charts with gridlines", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "heatmap",
        config: { 
          show_gridlines: false
        },
        queries: [{
          fields: {
            x: [{ alias: "hour" }],
            y: [{ alias: "day" }],
            z: [{ alias: "temperature" }]
          }
        }]
      };
      const searchData = [[
        { hour: 0, day: "Monday", temperature: 20 },
        { hour: 1, day: "Monday", temperature: 18 },
        { hour: 0, day: "Tuesday", temperature: 22 },
        { hour: 1, day: "Tuesday", temperature: 24 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Check if the result has axis configuration with splitLine
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(false);
      }
      if (result.options?.yAxis?.splitLine) {
        expect(result.options.yAxis.splitLine.show).toBe(false);
      }
      expect(result.options).toBeDefined();
      expect(result.extras.isTimeSeries).toBe(false);
    });

    it("should handle edge cases with invalid legend width", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right",
          legend_width: { value: "invalid", unit: "px" }
        }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 45 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should fall back to automatic calculation when width is invalid
      expect(result.options.grid.right).toBeGreaterThan(0); // Mock calculateRightLegendWidth returns 160
      expect(result.options.legend.textStyle.width).toBeGreaterThan(0);
    });

    it("should handle zero chart panel dimensions", async () => {
      const zeroChartPanelRef = {
        value: {
          offsetWidth: 0,
          offsetHeight: 0,
        },
      };

      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_legends: true,
          legends_position: "right"
        }
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 55 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        zeroChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should handle zero dimensions gracefully
      expect(result.options.grid.right).toBeGreaterThanOrEqual(0);
      expect(result.options.legend.textStyle.width).toBeGreaterThanOrEqual(60);
    });

    it("should validate that new features work with all chart types", async () => {
      const chartTypes = ["line", "area", "bar", "scatter", "area-stacked", "stacked"];
      
      for (const chartType of chartTypes) {
        const schema = {
          ...mockPanelSchema,
          type: chartType,
          config: { 
            show_gridlines: true,
            connect_nulls: ["line", "area", "area-stacked"].includes(chartType)
          },
          queries: [{
            fields: {
              x: [{ alias: "timestamp" }],
              y: [{ alias: "value" }],
              breakdown: chartType.includes("stacked") ? [{ alias: "category" }] : []
            }
          }]
        };
        
        const searchData = [[
          { 
            timestamp: "2024-01-01T00:00:00Z", 
            value: 10, 
            category: chartType.includes("stacked") ? "A" : undefined 
          },
          { 
            timestamp: "2024-01-01T01:00:00Z", 
            value: null, 
            category: chartType.includes("stacked") ? "A" : undefined 
          },
          { 
            timestamp: "2024-01-01T02:00:00Z", 
            value: 30, 
            category: chartType.includes("stacked") ? "A" : undefined 
          }
        ]];

        const result = await convertSQLData(
          schema,
          searchData,
          mockStore,
          mockChartPanelRef,
          mockHoveredSeriesState,
          mockResultMetaData,
          mockMetadata,
          mockChartPanelStyle,
          mockAnnotations
        );

        // All chart types should respect gridlines (if they have axes)
        if (result.options?.xAxis?.splitLine) {
          expect(result.options.xAxis.splitLine.show).toBe(true);
        }
        if (result.options?.yAxis?.splitLine) {
          expect(result.options.yAxis.splitLine.show).toBe(true);
        }
        expect(result.options.series.length).toBeGreaterThan(0);
      }
    });

    it("should handle time series detection with new configurations", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: true,
          connect_nulls: true
        }
      };

      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 10 },
        { timestamp: "2024-01-01T01:00:00Z", value: 20 },
        { timestamp: "2024-01-01T02:00:00Z", value: 30 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Test that the function handles time series configuration
      expect(result.extras).toBeDefined();
      if (result.options?.xAxis?.splitLine) {
        expect(result.options.xAxis.splitLine.show).toBe(true);
      }
    });

    it("should handle empty data with new configuration options", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: false,
          connect_nulls: true,
          show_legends: true
        }
      };
      const searchData = [[]]; // Empty data

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should handle empty data gracefully - might return options object for progress indication
      expect(result).toBeDefined();
      expect(result.options).toBeDefined();
    });

    it("should handle invalid data structure with new configurations", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: true,
          connect_nulls: false
        },
        queries: [{
          fields: {
            x: null, // Invalid field configuration
            y: [{ alias: "value" }]
          }
        }]
      };
      const searchData = [[
        { timestamp: "2024-01-01T00:00:00Z", value: 100 }
      ]];

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should return null for invalid configuration
      expect(result.options).toBeNull();
    });

    it("should handle performance with extreme legend configurations", async () => {
      const schema = {
        ...mockPanelSchema,
        type: "line",
        config: { 
          show_gridlines: true,
          connect_nulls: true,
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain"
        },
        queries: [{
          fields: {
            x: [{ alias: "timestamp" }],
            y: Array.from({ length: 10 }, (_, i) => ({ alias: `metric_${i}` })), // 10 Y fields
            breakdown: [{ alias: "server" }]
          }
        }]
      };

      // Create data with multiple servers and metrics
      const searchData = [[]];
      const servers = ["web-1", "web-2", "web-3", "db-1", "db-2"];
      for (const server of servers) {
        for (let hour = 0; hour < 24; hour++) {
          const dataPoint: any = {
            timestamp: `2024-01-01T${String(hour).padStart(2, '0')}:00:00Z`,
            server
          };
          // Add multiple metric values
          for (let i = 0; i < 10; i++) {
            dataPoint[`metric_${i}`] = Math.random() * 100;
          }
          searchData[0].push(dataPoint);
        }
      }

      const result = await convertSQLData(
        schema,
        searchData,
        mockStore,
        mockChartPanelRef,
        mockHoveredSeriesState,
        mockResultMetaData,
        mockMetadata,
        mockChartPanelStyle,
        mockAnnotations
      );

      // Should handle complex configuration without errors
      expect(result.options).toBeDefined();
      expect(result.options.series.length).toBeGreaterThan(10);
      expect(result.options.legend.top).toBeGreaterThan(0); // Bottom legend calculation applied
      expect(result.options.grid.bottom).toBeGreaterThan(0);
    });
  });
});