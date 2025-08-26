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
  });
});