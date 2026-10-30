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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { number as echartsNumber } from "echarts/core";
import {
  getChartDimensions,
  getLegendPosition,
  calculateBottomLegendHeight,
  calculateRightLegendWidth,
  calculateChartDimensions,
  generateChartAlignmentProperties,
  calculatePieChartRadius,
  shouldApplyChartAlignment,
  createBaseLegendConfig,
  applyRightLegendPositioning,
  applyBottomLegendPositioning,
  applyPieDonutLegendPositioning,
  applyPieDonutChartAlignment,
  applyPieDonutCenterAdjustment,
  applyLegendConfiguration,
} from "./legendConfiguration";
import { calculateWidthText } from "./chartDimensionUtils";

// Mock calculateWidthText
vi.mock("./chartDimensionUtils", () => ({
  calculateWidthText: vi.fn((text: string) => {
    // Simple mock: return text length * 8 as approximate width
    return (text?.length || 0) * 8;
  }),
}));

describe("legendConfiguration", () => {
  beforeEach(() => {
    // Setup document.body for tests
    if (!document.body) {
      document.body = document.createElement("body");
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getChartDimensions", () => {
    it("should return default dimensions when chartPanelRef is null", () => {
      const result = getChartDimensions({ value: null });

      expect(result.chartWidth).toBe(800);
      expect(result.chartHeight).toBe(400);
      expect(result.containerWidth).toBe(0);
    });

    it("should return dimensions from chartPanelRef when available", () => {
      const mockRef = {
        value: {
          offsetWidth: 1000,
          offsetHeight: 600,
        },
      };

      const result = getChartDimensions(mockRef);

      expect(result.chartWidth).toBe(1000);
      expect(result.chartHeight).toBe(600);
      expect(result.containerWidth).toBe(1000);
    });

    it("should handle undefined offsetWidth", () => {
      const mockRef = {
        value: {
          offsetWidth: 0,
          offsetHeight: 0,
        },
      };

      const result = getChartDimensions(mockRef);

      expect(result.chartWidth).toBe(800);
      expect(result.chartHeight).toBe(400);
    });
  });

  describe("getLegendPosition", () => {
    it("should return horizontal for bottom position", () => {
      expect(getLegendPosition("bottom")).toBe("horizontal");
    });

    it("should return vertical for right position", () => {
      expect(getLegendPosition("right")).toBe("vertical");
    });

    it("should return horizontal for default/undefined position", () => {
      expect(getLegendPosition()).toBe("horizontal");
      expect(getLegendPosition(undefined)).toBe("horizontal");
    });

    it("should return horizontal for unknown position", () => {
      expect(getLegendPosition("unknown" as any)).toBe("horizontal");
    });
  });

  describe("calculateBottomLegendHeight", () => {
    it("should return 0 for zero legend count", () => {
      const result = calculateBottomLegendHeight(0, 800);
      expect(result).toBe(0);
    });

    it("should calculate height for single legend item", () => {
      const seriesData = [{ name: "Series 1" }];
      const result = calculateBottomLegendHeight(1, 800, seriesData);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeGreaterThanOrEqual(30); // Minimum height of 1.875rem = 30px
    });

    it("should calculate height for multiple legend items", () => {
      const seriesData = [{ name: "Series 1" }, { name: "Series 2" }, { name: "Series 3" }];
      const result = calculateBottomLegendHeight(3, 800, seriesData);

      expect(result).toBeGreaterThan(0);
    });

    it("should apply 50% maximum height constraint when maxHeight is provided", () => {
      const seriesData = Array.from({ length: 20 }, (_, i) => ({
        name: `Very Long Series Name ${i}`,
      }));
      const chartHeight = 400;
      const result = calculateBottomLegendHeight(20, 800, seriesData, chartHeight);

      expect(result).toBeLessThanOrEqual(chartHeight * 0.5);
    });

    it("should configure legend and grid when provided", () => {
      const legendConfig: any = {};
      const gridConfig: any = {};
      const chartHeight = 400;
      const seriesData = [{ name: "Series 1" }];

      calculateBottomLegendHeight(
        1,
        800,
        seriesData,
        chartHeight,
        legendConfig,
        gridConfig,
        chartHeight,
      );

      expect(gridConfig.bottom).toBeDefined();
      expect(legendConfig.top).toBeDefined();
      expect(legendConfig.height).toBeDefined();
    });

    it("should handle series with different name properties", () => {
      const seriesData = [{ seriesName: "Series 1" }, { name: "Series 2" }, { other: "Series 3" }];
      const result = calculateBottomLegendHeight(3, 800, seriesData);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle narrow chart width", () => {
      const seriesData = [{ name: "Series 1" }];
      const result = calculateBottomLegendHeight(1, 200, seriesData);

      expect(result).toBeGreaterThan(0);
    });
  });

  describe("calculateRightLegendWidth", () => {
    it("should return 0 for zero legend count", () => {
      const result = calculateRightLegendWidth(0, 800, 400);
      expect(result).toBe(0);
    });

    it("should calculate width for single legend item", () => {
      const seriesData = [{ name: "Series 1" }];
      const result = calculateRightLegendWidth(1, 800, 400, seriesData, false);

      expect(result).toBeGreaterThan(0);
    });

    it("should calculate width for multiple legend items", () => {
      const seriesData = [{ name: "Series 1" }, { name: "Series 2" }, { name: "Series 3" }];
      const result = calculateRightLegendWidth(3, 800, 400, seriesData, false);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle scrollable legends differently", () => {
      const seriesData = [{ name: "Series 1" }];
      const scrollableWidth = calculateRightLegendWidth(1, 800, 400, seriesData, true);
      const plainWidth = calculateRightLegendWidth(1, 800, 400, seriesData, false);

      // Scrollable should use single column
      expect(scrollableWidth).toBeGreaterThan(0);
      expect(plainWidth).toBeGreaterThan(0);
    });

    it("should apply 50% maximum width constraint", () => {
      const seriesData = Array.from({ length: 20 }, (_, i) => ({
        name: `Very Long Series Name ${i}`,
      }));
      const chartWidth = 800;
      const result = calculateRightLegendWidth(20, chartWidth, 400, seriesData, false);

      expect(result).toBeLessThanOrEqual(chartWidth * 0.5);
    });

    it("should handle series with seriesName property", () => {
      const seriesData = [{ seriesName: "Series 1" }, { seriesName: "Series 2" }];
      const result = calculateRightLegendWidth(2, 800, 400, seriesData, false);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle small chart dimensions", () => {
      const seriesData = [{ name: "Series" }];
      const result = calculateRightLegendWidth(1, 300, 200, seriesData, false);

      expect(result).toBeLessThanOrEqual(150); // Should be <= 50% of width
    });
  });

  describe("calculateChartDimensions", () => {
    it("should return full dimensions when legends are disabled", () => {
      const panelSchema = {
        config: { show_legends: false },
      };
      const result = calculateChartDimensions(panelSchema, 800, 400, []);

      expect(result.availableWidth).toBe(800);
      expect(result.availableHeight).toBe(400);
      expect(result.hasLegends).toBe(false);
    });

    it("should return full dimensions when no series data", () => {
      const panelSchema = {
        config: { show_legends: true },
      };
      const result = calculateChartDimensions(panelSchema, 800, 400, []);

      expect(result.availableWidth).toBe(800);
      expect(result.availableHeight).toBe(400);
      expect(result.hasLegends).toBe(false);
    });

    it("should calculate dimensions for right-positioned legend", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "Series 1" }];
      const result = calculateChartDimensions(panelSchema, 800, 400, seriesData);

      expect(result.availableWidth).toBeLessThan(800);
      expect(result.legendWidth).toBeGreaterThan(0);
      expect(result.hasLegends).toBe(true);
    });

    it("should calculate dimensions for bottom-positioned legend", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "Series 1" }];
      const result = calculateChartDimensions(panelSchema, 800, 400, seriesData);

      expect(result.availableHeight).toBeLessThan(400);
      expect(result.legendHeight).toBeGreaterThan(0);
      expect(result.hasLegends).toBe(true);
    });

    it("should use explicit legend width when provided", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legend_width: { value: 200, unit: "px" },
        },
      };
      const seriesData = [{ name: "Series 1" }];
      const result = calculateChartDimensions(panelSchema, 800, 400, seriesData);

      expect(result.legendWidth).toBe(200);
      expect(result.availableWidth).toBe(600);
    });

    it("should use percentage-based legend width", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legend_width: { value: 25, unit: "%" },
        },
      };
      const seriesData = [{ name: "Series 1" }];
      const result = calculateChartDimensions(panelSchema, 800, 400, seriesData);

      expect(result.legendWidth).toBe(200); // 25% of 800
      expect(result.availableWidth).toBe(600);
    });

    it("should handle null legend position as bottom", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: null,
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "Series 1" }];
      const result = calculateChartDimensions(panelSchema, 800, 400, seriesData);

      expect(result.availableHeight).toBeLessThan(400);
      expect(result.legendHeight).toBeGreaterThan(0);
    });
  });

  describe("generateChartAlignmentProperties", () => {
    it("should return empty object when alignment is not applied", () => {
      const result = generateChartAlignmentProperties("left", "bottom", false);
      expect(result).toEqual({});
    });

    it("should return empty object when legend is not on right", () => {
      const result = generateChartAlignmentProperties("left", "bottom", true);
      expect(result).toEqual({});
    });

    it("should generate left alignment properties", () => {
      const result = generateChartAlignmentProperties("left", "right", true);

      expect(result).toHaveProperty("display", "grid");
      expect(result).toHaveProperty("gridTemplateColumns", "minmax(0, 1fr) auto");
      expect(result).toHaveProperty("justifyItems", "start");
      expect(result).toHaveProperty("paddingLeft", "5%");
    });

    it("should generate center alignment properties", () => {
      const result = generateChartAlignmentProperties("center", "right", true);

      expect(result).toHaveProperty("display", "grid");
      expect(result).toHaveProperty("gridTemplateColumns", "1fr");
      expect(result).toHaveProperty("justifyItems", "center");
    });

    it("should default to center alignment for null/auto", () => {
      const result = generateChartAlignmentProperties(null, "right", true);

      expect(result).toHaveProperty("display", "grid");
      expect(result).toHaveProperty("gridTemplateColumns", "1fr");
      expect(result).toHaveProperty("justifyItems", "center");
    });
  });

  describe("calculatePieChartRadius", () => {
    it("should calculate radius when layout is not available", () => {
      const panelSchema = { config: {} };
      const result = calculatePieChartRadius(panelSchema, 400, 400);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it("should use original dimensions when provided", () => {
      const panelSchema = { config: {} };
      const result = calculatePieChartRadius(panelSchema, 400, 400, 800, 600);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(90);
    });

    it("should calculate radius based on layout", () => {
      const panelSchema = {
        layout: { w: 10, h: 10 },
        config: {},
      };
      const result = calculatePieChartRadius(panelSchema, 300, 300);

      expect(result).toBeGreaterThan(0);
    });

    it("should return minimum radius for zero layout dimensions", () => {
      const panelSchema = {
        layout: { w: 0, h: 0 },
        config: {},
      };
      const result = calculatePieChartRadius(panelSchema, 300, 300);

      // Function returns a minimum radius even with zero dimensions
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(100);
    });

    it("should handle full space usage", () => {
      const panelSchema = {
        layout: { w: 10, h: 10 },
        config: {},
      };
      const result = calculatePieChartRadius(panelSchema, 300, 300);

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(98);
    });
  });

  describe("shouldApplyChartAlignment", () => {
    it("should return false when legends are not shown", () => {
      const panelSchema = {
        config: { show_legends: false },
      };
      const result = shouldApplyChartAlignment(panelSchema, [{ name: "Series" }]);

      expect(result).toBe(false);
    });

    it("should return false when no series data", () => {
      const panelSchema = {
        config: { show_legends: true, legends_position: "right" },
      };
      const result = shouldApplyChartAlignment(panelSchema, []);

      expect(result).toBe(false);
    });

    it("should return false when legend is not on right", () => {
      const panelSchema = {
        config: { show_legends: true, legends_position: "bottom" },
      };
      const result = shouldApplyChartAlignment(panelSchema, [{ name: "Series" }]);

      expect(result).toBe(false);
    });

    it("should return true for right plain legends", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const result = shouldApplyChartAlignment(panelSchema, [{ name: "Series" }]);

      expect(result).toBe(true);
    });

    it("should return true for right scroll legends", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "scroll",
        },
      };
      const result = shouldApplyChartAlignment(panelSchema, [{ name: "Series" }]);

      expect(result).toBe(true);
    });

    it("should return true for right null-type legends", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: null,
        },
      };
      const result = shouldApplyChartAlignment(panelSchema, [{ name: "Series" }]);

      expect(result).toBe(true);
    });
  });

  describe("createBaseLegendConfig", () => {
    it("should create base legend config with horizontal orientation", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true, legends_position: "bottom", legends_type: "plain" },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(true);
      expect(result.type).toBe("plain");
      expect(result.orient).toBe("horizontal");
      expect(result.left).toBe("0");
      expect(result.top).toBe("bottom");
    });

    it("should create base legend config with vertical orientation", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true, legends_position: "right", legends_type: "scroll" },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(true);
      expect(result.type).toBe("scroll");
      expect(result.orient).toBe("vertical");
      expect(result.left).toBe(null);
      expect(result.right).toBe(0);
      expect(result.top).toBe("center");
    });

    it("should not show legend when show_legends is false", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: false },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(false);
    });

    it("should not show legend when trellis layout is enabled", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true, trellis: { layout: "grid" } },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(false);
    });

    it("should include tooltip with formatter", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.tooltip).toBeDefined();
      expect(result.tooltip.formatter).toBeDefined();
    });

    it("should escape HTML in the legend tooltip", () => {
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(
        { type: "line", config: { show_legends: true } },
        hoveredSeriesState,
      );

      expect(result.tooltip.formatter({ name: "<img src=x onerror=alert(1)>" })).toBe(
        "&lt;img src=x onerror=alert(1)&gt;",
      );
    });

    it("should handle formatter for hovered series", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true },
      };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: "Series 1", setHoveredSeriesName: vi.fn() },
      };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      const formatted = result.formatter?.("Series 1");
      expect(formatted).toContain("Series 1");
    });
  });

  describe("applyRightLegendPositioning", () => {
    it("should apply right positioning for plain legends", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyRightLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.right).toBeGreaterThan(0);
      expect(options.legend.left).toBeDefined();
    });

    it("should not apply positioning for non-applicable chart types", () => {
      const panelSchema = {
        type: "gauge",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyRightLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.right).toBeUndefined();
    });

    it("should apply right positioning with explicit width", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
          legend_width: { value: 200, unit: "px" },
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyRightLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.right).toBe(200);
    });

    it("should apply right positioning for scroll legends without explicit width", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "scroll",
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyRightLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.right).toBeGreaterThan(0);
      expect(options.legend.textStyle).toBeDefined();
    });
  });

  describe("applyBottomLegendPositioning", () => {
    it("should apply bottom positioning for plain legends", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyBottomLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.bottom).toBeGreaterThan(0);
      expect(options.legend.top).toBeDefined();
    });

    it("should not apply positioning for pie/donut charts", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }] }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyBottomLegendPositioning(panelSchema, options, chartPanelRef);

      // Should not apply to pie/donut charts
      expect(options.grid.bottom).toBeUndefined();
    });

    it("should apply bottom positioning with explicit height", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
          legend_height: { value: 100, unit: "px" },
        },
      };
      const options = {
        series: [{ name: "Series 1" }],
        grid: {},
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyBottomLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.grid.bottom).toBe(100);
    });
  });

  describe("applyPieDonutLegendPositioning", () => {
    it("should apply legend positioning for pie charts", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }] }],
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyPieDonutLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.legend.left).toBeDefined();
    });

    it("should apply legend positioning for donut charts", () => {
      const panelSchema = {
        type: "donut",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }] }],
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyPieDonutLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.legend.top).toBeDefined();
    });

    it("should handle scroll legends for pie charts", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "scroll",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }] }],
        legend: {},
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

      applyPieDonutLegendPositioning(panelSchema, options, chartPanelRef);

      expect(options.legend.left).toBeDefined();
      expect(options.legend.textStyle).toBeDefined();
    });
  });

  describe("applyPieDonutChartAlignment", () => {
    it("should apply alignment for pie charts with right legend", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
          chart_align: "center",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }],
      };

      applyPieDonutChartAlignment(panelSchema, options, 800, 400);

      expect(options.series[0].center).toBeDefined();
    });

    it("should not apply alignment when chart_align is not set", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }],
      };

      applyPieDonutChartAlignment(panelSchema, options, 800, 400);

      // Should call applyPieDonutCenterAdjustment instead
      expect(options.series[0].center).toBeDefined();
    });
  });

  describe("applyPieDonutCenterAdjustment", () => {
    it("should adjust center for right-positioned legend", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }],
      };

      applyPieDonutCenterAdjustment(panelSchema, options, 800, 400);

      // Center X should be adjusted
      expect(options.series[0].center[0]).not.toBe("50%");
      expect(options.series[0].center[1]).toBe("50%");
    });

    it("should adjust center for bottom-positioned legend", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }],
      };

      applyPieDonutCenterAdjustment(panelSchema, options, 800, 400);

      // Center Y should be adjusted
      expect(options.series[0].center[0]).toBe("50%");
      expect(options.series[0].center[1]).not.toBe("50%");
    });

    it("should handle scroll legends with right position", () => {
      const panelSchema = {
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "scroll",
        },
      };
      const options = {
        series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }],
      };

      applyPieDonutCenterAdjustment(panelSchema, options, 800, 400);

      expect(options.series[0].center[0]).not.toBe("50%");
    });
  });

  describe("applyLegendConfiguration", () => {
    it("should disable legends when trellis is enabled", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          trellis: { layout: "grid" },
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [] };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend).toEqual({ show: false });
    });

    it("should apply legend configuration for line chart with bottom legend", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [{ name: "Series 1" }], grid: {} };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend.show).toBe(true);
      expect(options.legend.orient).toBe("horizontal");
    });

    it("should apply legend configuration for line chart with right legend", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [{ name: "Series 1" }], grid: {} };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend.show).toBe(true);
      expect(options.legend.orient).toBe("vertical");
    });

    it("should apply legend configuration for pie chart", () => {
      const panelSchema = {
        type: "pie",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }] };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend.show).toBe(true);
    });

    it("should apply legend configuration for donut chart", () => {
      const panelSchema = {
        type: "donut",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [{ data: [{ name: "Item 1" }], center: ["50%", "50%"] }] };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend.show).toBe(true);
    });

    it("should handle null legend position", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: null,
          legends_type: "plain",
        },
      };
      const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
      const hoveredSeriesState = {
        value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() },
      };
      const options = { series: [{ name: "Series 1" }], grid: {} };

      applyLegendConfiguration(panelSchema, chartPanelRef, hoveredSeriesState, options);

      expect(options.legend.show).toBe(true);
      expect(options.legend.orient).toBe("horizontal");
    });
  });

  describe("Edge Cases and Integration Tests", () => {
    it("should handle empty series data gracefully", () => {
      const panelSchema = {
        type: "line",
        config: {
          show_legends: true,
          legends_position: "bottom",
          legends_type: "plain",
        },
      };
      const result = calculateChartDimensions(panelSchema, 800, 400, []);

      expect(result.hasLegends).toBe(false);
    });

    it("should handle very long series names", () => {
      const seriesData = [{ name: "a".repeat(1000) }];
      const result = calculateBottomLegendHeight(1, 800, seriesData);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle special characters in series names", () => {
      const seriesData = [{ name: "Series !@#$%^&*()" }];
      const result = calculateRightLegendWidth(1, 800, 400, seriesData, false);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle multiple series with varying name lengths", () => {
      const seriesData = [
        { name: "A" },
        { name: "Medium Name" },
        { name: "Very Long Series Name Here" },
      ];
      const result = calculateBottomLegendHeight(3, 800, seriesData);

      expect(result).toBeGreaterThan(0);
    });

    it("should handle extreme chart dimensions", () => {
      const result1 = calculateChartDimensions(
        { config: { show_legends: true, legends_position: "right", legends_type: "plain" } },
        100,
        50,
        [{ name: "Series" }],
      );

      // For extreme small dimensions, available width might be 0 or negative due to legend width constraints
      // The important thing is that it doesn't crash and returns a valid structure
      expect(result1).toHaveProperty("availableWidth");
      expect(result1).toHaveProperty("legendWidth");
      expect(result1.hasLegends).toBe(true);
    });

    it("should work together for complete workflow", () => {
      const panelSchema = {
        type: "bar",
        config: {
          show_legends: true,
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "Series 1" }, { name: "Series 2" }];

      // Calculate dimensions
      const dimensions = calculateChartDimensions(panelSchema, 800, 400, seriesData);
      expect(dimensions.hasLegends).toBe(true);

      // Check alignment
      const shouldAlign = shouldApplyChartAlignment(panelSchema, seriesData);
      expect(shouldAlign).toBe(true);

      // Generate properties
      const properties = generateChartAlignmentProperties("center", "right", shouldAlign);
      expect(properties).toHaveProperty("display", "grid");
    });
  });
});

describe("pie and donut legend values", () => {
  const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };
  const hovered = (name: string | null = null) => ({
    value: { hoveredSeriesName: name, setHoveredSeriesName: vi.fn() },
  });
  const pieSchema = (config: any, type = "pie") => ({
    type,
    config: { show_legends: true, legends_position: "bottom", legends_type: "plain", ...config },
  });
  const pieOptions = (data: any[]) => ({ series: [{ type: "pie", data, center: ["50%", "50%"] }] });
  const slices = [
    { name: "api", value: 30 },
    { name: "db", value: 10 },
  ];

  it("keeps the name-only formatter when legend_values is unset or empty", () => {
    for (const config of [{}, { legend_values: [] }]) {
      const options: any = pieOptions(slices);
      applyLegendConfiguration(pieSchema(config), chartPanelRef, hovered(), options);
      expect(options.legend.formatter("api")).toBe("{b|api}");
      expect(options.legend.textStyle.width).toBe(120);
    }
  });

  it("appends the value and percent to pie and donut entries", () => {
    for (const type of ["pie", "donut"]) {
      const options: any = pieOptions(slices);
      applyLegendConfiguration(
        pieSchema({ legend_values: ["percent", "value"], decimals: 1 }, type),
        chartPanelRef,
        hovered(),
        options,
      );
      expect(options.legend.formatter("api")).toBe("{b|api}  30.0  75.0%");
      expect(options.legend.formatter("db")).toBe("{b|db}  10.0  25.0%");
      expect(options.legend.textStyle.width).toBe(180);
    }
  });

  it("shows only the selected value and takes two percent decimals when decimals is unset", () => {
    const percentOnly: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"] }),
      chartPanelRef,
      hovered(),
      percentOnly,
    );
    expect(percentOnly.legend.formatter("db")).toBe("{b|db}  25.00%");

    const valueOnly: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["value"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      valueOnly,
    );
    expect(valueOnly.legend.formatter("db")).toBe("{b|db}  10");
  });

  it("rounds every slice's percent exactly as ECharts' largest-remainder seats do", () => {
    const many = Array.from({ length: 37 }, (_, i) => ({
      name: `s${i}`,
      value: ((i * 7919) % 97) + 0.3,
    }));
    const options: any = pieOptions(many);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 1 }),
      chartPanelRef,
      hovered(),
      options,
    );
    const values = many.map((slice) => slice.value);
    many.forEach((slice, index) => {
      const expected = echartsNumber.getPercentWithPrecision(values, index, 1).toFixed(1);
      expect(options.legend.formatter(slice.name)).toBe(`{b|${slice.name}}  ${expected}%`);
    });
  });

  it("bolds the hovered slice name only", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered("api"),
      options,
    );
    expect(options.legend.formatter("api")).toBe("{a|api}  75%");
  });

  it("sums slices that share a name and reads data merged after configuration", () => {
    const options: any = pieOptions([{ name: "api", value: 1 }]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["value", "percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    options.series[0].data = [
      { name: "api", value: 30 },
      { name: "api", value: 20 },
      { name: "db", value: 50 },
    ];
    expect(options.legend.formatter("api")).toBe("{b|api}  50  50%");
  });

  it.each(["pie", "donut"])(
    "leaves a negative same-name %s slice out of the percent, as the slices do",
    (type) => {
      const options: any = pieOptions([
        { name: "A", value: 10 },
        { name: "A", value: -9 },
        { name: "B", value: 10 },
        { name: "C", value: Infinity },
      ]);
      applyLegendConfiguration(
        pieSchema({ legend_values: ["value", "percent"], decimals: 0 }, type),
        chartPanelRef,
        hovered(),
        options,
      );
      expect(options.legend.formatter("A")).toBe("{b|A}  1  50%");
      expect(options.legend.formatter("B")).toBe("{b|B}  10  50%");
      expect(options.legend.formatter("C")).toBe("{b|C}  -  -");
    },
  );

  it("reuses the sized legend entries until a slice is hidden", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    vi.mocked(calculateWidthText).mockClear();
    options.legend.formatter("api");
    expect(calculateWidthText).not.toHaveBeenCalled();

    options.legend.selected = { api: true, db: false };
    options.legend.formatter("api");
    expect(calculateWidthText).toHaveBeenCalled();
  });

  it("gives a name the sum of its drawn slices' rounded percents", () => {
    const options: any = pieOptions([
      { name: "A", value: 1 },
      { name: "B", value: 1 },
      { name: "A", value: 3 },
      { name: "C", value: 1 },
      { name: "A", value: -9 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    const drawn = [1, 1, 3, 1];
    const seat = (index: number) => echartsNumber.getPercentWithPrecision(drawn, index, 0);
    expect(options.legend.formatter("A")).toBe(`{b|A}  ${seat(0) + seat(2)}%`);
    expect(options.legend.formatter("B")).toBe(`{b|B}  ${seat(1)}%`);
    expect(options.legend.formatter("C")).toBe(`{b|C}  ${seat(3)}%`);
  });

  it("leaves a negative same-name slice out of an override-decimals percent", () => {
    const options: any = pieOptions([
      { name: "A", value: 10 },
      { name: "A", value: -9 },
      { name: "B", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["percent"],
        override_config: [
          { field: { matchBy: "series", value: "A" }, config: [{ type: "decimals", value: 1 }] },
        ],
      }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("A")).toBe("{b|A}  50.0%");
  });

  it("takes the percent over the slices the legend leaves visible", () => {
    const options: any = pieOptions([
      { name: "api", value: 10 },
      { name: "db", value: 10 },
      { name: "cache", value: 20 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("api")).toBe("{b|api}  25%");

    options.legend.selected = { api: true, db: false, cache: false };
    expect(options.legend.formatter("api")).toBe("{b|api}  100%");
    expect(options.legend.formatter("db")).toBe("{b|db}  -");

    options.legend.selected = { api: true, db: true, cache: false };
    expect(options.legend.formatter("api")).toBe("{b|api}  50%");
  });

  it("keeps a hidden slice's value but shows no percent for it", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["value", "percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    options.legend.selected = { api: true, db: false };
    expect(options.legend.formatter("db")).toBe("{b|db}  10  -");
    expect(options.legend.formatter("api")).toBe("{b|api}  30  100%");
  });

  it("gives an explicit right legend width to the names instead of the values cap", () => {
    const longName = "ziox-querier-595748494c-2vlk5";
    const options: any = pieOptions([
      { name: longName, value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["value", "percent"],
        decimals: 0,
        legends_position: "right",
        legend_width: { value: 450, unit: "px" },
      }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.textStyle.width).toBe(390);
    expect(options.legend.formatter(longName)).toBe(`{b|${longName}}  30  75%`);
  });

  it("still caps an auto-sized right legend at the values width", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["value", "percent"], legends_position: "right" }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.textStyle.width).toBeLessThanOrEqual(180);
  });

  it("takes an override-decimals and a high-decimals percent over the visible slices too", () => {
    const override = {
      field: { matchBy: "series", value: "api" },
      config: [{ type: "decimals", value: 1 }],
    };
    for (const config of [{ decimals: 0, override_config: [override] }, { decimals: 20 }]) {
      const options: any = pieOptions(slices);
      applyLegendConfiguration(
        pieSchema({ legend_values: ["percent"], ...config }),
        chartPanelRef,
        hovered(),
        options,
      );
      options.legend.selected = { api: true, db: false };
      expect(options.legend.formatter("api")).toMatch(/100\.0+%$/);
    }
  });

  it("shows the override display name with the values", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["percent"],
        decimals: 0,
        override_config: [
          {
            field: { matchBy: "series", value: "api" },
            config: [{ type: "display_name", value: "Gateway" }],
          },
        ],
      }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("api")).toBe("{b|Gateway}  75%");
  });

  it("truncates a long name and never the values", () => {
    const options: any = pieOptions([
      { name: "x".repeat(40), value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("x".repeat(40))).toBe(`{b|${"x".repeat(14)}...}  75%`);
  });

  it("rounds percents the way the slice labels do, so they add up to 100", () => {
    const options: any = pieOptions([
      { name: "a", value: 1 },
      { name: "b", value: 1 },
      { name: "c", value: 1 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    const percents = ["a", "b", "c"].map((name) =>
      Number(options.legend.formatter(name).split("  ")[1].replace("%", "")),
    );
    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect([...percents].sort((a, b) => a - b)).toEqual([33, 33, 34]);
  });

  it("finishes on slices whose negative values cancel the total", () => {
    const options: any = pieOptions([
      { name: "big", value: 1e16 },
      { name: "small", value: 3 },
      { name: "neg", value: -1e16 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 8 }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("neg")).toBe("{b|neg}  0.00000000%");
  });

  it("takes a series override's decimals for that slice's percent", () => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["percent"],
        decimals: 0,
        override_config: [
          { field: { matchBy: "series", value: "db" }, config: [{ type: "decimals", value: 2 }] },
        ],
      }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("api")).toBe("{b|api}  75%");
    expect(options.legend.formatter("db")).toBe("{b|db}  25.00%");
  });

  it.each([
    [13, "{b|api}  75.0000000000000%"],
    [25, "{b|api}  75.0000000000000%"],
    [-1, "{b|api}  75.00%"],
    ["abc", "{b|api}  75.00%"],
    [1.7, "{b|api}  75.0%"],
  ])("reads decimals %s as a valid percent precision", (decimals, expected) => {
    const options: any = pieOptions(slices);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("api")).toBe(expected);
  });

  it("fits the entries to a narrow right scroll legend without cutting the values", () => {
    const options: any = pieOptions([
      { name: "a-long-service-name", value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({
        legends_position: "right",
        legends_type: null,
        legend_values: ["percent"],
        decimals: 0,
      }),
      { value: { offsetWidth: 300, offsetHeight: 300 } },
      hovered(),
      options,
    );
    const width = options.legend.textStyle.width;
    expect(width).toBeLessThan(180);
    const text = options.legend.formatter("a-long-service-name");
    expect(text.endsWith("75%")).toBe(true);
    // The spec's width mock is 8px per character; rich markup is not painted.
    expect(text.replace(/\{[ab]\|([^}]*)\}/, "$1").length * 8).toBeLessThanOrEqual(width);
  });

  it("gives an override-decimals slice the same percent as its slice label", () => {
    const options: any = pieOptions([
      { name: "a", value: 1 },
      { name: "b", value: 2 },
      { name: "neg", value: -1 },
    ]);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["percent"],
        override_config: [
          { field: { matchBy: "series", value: "a" }, config: [{ type: "decimals", value: 1 }] },
        ],
      }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("a")).toBe("{b|a}  33.3%");
  });

  it("fits a right plain legend's text to the width it reserves on a small panel", () => {
    const options: any = pieOptions([
      { name: "a-long-service-name", value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legends_position: "right", legend_values: ["value", "percent"], decimals: 0 }),
      { value: { offsetWidth: 300, offsetHeight: 300 } },
      hovered(),
      options,
    );
    const reserved = 300 - options.legend.left;
    expect(options.legend.textStyle.width).toBe(reserved - 60);
    const text = options.legend.formatter("a-long-service-name");
    expect(text).toBe("30  75%");
  });

  it("lets a right scroll legend with values take up to half the chart", () => {
    const many = [{ name: "a-very-long-service-name-indeed", value: 1 }];
    const legendLeft = (config: any) => {
      const options: any = pieOptions(many);
      applyLegendConfiguration(
        pieSchema({ legends_position: "right", legends_type: "scroll", ...config }),
        { value: { offsetWidth: 600, offsetHeight: 300 } },
        hovered(),
        options,
      );
      return options.legend.left;
    };
    expect(legendLeft({})).toBe(400);
    const withValues = legendLeft({ legend_values: ["percent"] });
    expect(withValues).toBeLessThan(400);
    expect(withValues).toBeGreaterThanOrEqual(300);
  });

  it("reserves a wider right legend for the values", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `slice-${i}`, value: i + 1 }));
    const legendLeft = (config: any) => {
      const options: any = pieOptions(many);
      applyLegendConfiguration(
        pieSchema({ legends_position: "right", ...config }),
        chartPanelRef,
        hovered(),
        options,
      );
      return options.legend.left;
    };
    expect(legendLeft({ legend_values: ["value", "percent"] })).toBeLessThan(legendLeft({}));
  });

  it("ignores legend_values on other chart types", () => {
    const options: any = { series: [{ name: "api", data: [1] }], grid: {} };
    applyLegendConfiguration(
      { type: "line", config: { show_legends: true, legend_values: ["value"] } },
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("api")).toBe("{b|api}");
  });

  it("sizes the legend from the entries with their values", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `slice-${i}`, value: i + 1 }));
    const plain = calculateChartDimensions(pieSchema({}), 800, 400, many);
    const withValues = calculateChartDimensions(
      pieSchema({ legend_values: ["value", "percent"] }),
      800,
      400,
      many,
    );
    expect(withValues.legendHeight).toBeGreaterThan(plain.legendHeight);

    const right = { legends_position: "right" };
    const plainRight = calculateChartDimensions(pieSchema(right), 800, 400, many);
    const valuesRight = calculateChartDimensions(
      pieSchema({ ...right, legend_values: ["value", "percent"] }),
      800,
      400,
      many,
    );
    expect(valuesRight.legendWidth).toBeGreaterThan(plainRight.legendWidth);
  });

  it("gives a negative slice 0% under an override's decimals or capped panel decimals", () => {
    const negatives = [
      { name: "api", value: 30 },
      { name: "loss", value: -10 },
    ];
    const withOverride: any = pieOptions(negatives);
    applyLegendConfiguration(
      pieSchema({
        legend_values: ["percent"],
        override_config: [
          { field: { matchBy: "series", value: "loss" }, config: [{ type: "decimals", value: 2 }] },
        ],
      }),
      chartPanelRef,
      hovered(),
      withOverride,
    );
    expect(withOverride.legend.formatter("loss")).toBe("{b|loss}  0.00%");

    const highPrecision: any = pieOptions(negatives);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["percent"], decimals: 14 }),
      chartPanelRef,
      hovered(),
      highPrecision,
    );
    expect(highPrecision.legend.formatter("loss")).toBe(`{b|loss}  ${(0).toFixed(13)}%`);
  });

  it("matches ECharts' seats on tied and zero remainders", () => {
    const cases = [
      [1, 1, 1, 1, 1, 1, 1],
      [0, 5, 5, 0, 5, 3],
      [2, 2, 2, 1e-9],
    ];
    for (const values of cases) {
      const data = values.map((value, i) => ({ name: `s${i}`, value }));
      const options: any = pieOptions(data);
      applyLegendConfiguration(
        pieSchema({ legend_values: ["percent"], decimals: 2 }),
        chartPanelRef,
        hovered(),
        options,
      );
      data.forEach((slice, index) => {
        const expected = echartsNumber.getPercentWithPrecision(values, index, 2).toFixed(2);
        expect(options.legend.formatter(slice.name)).toBe(`{b|${slice.name}}  ${expected}%`);
      });
    }
  });

  it("shows a dash, not a zero, for a slice with no finite value", () => {
    const options: any = pieOptions([
      { name: "api", value: 30 },
      { name: "gap", value: NaN },
      { name: "inf", value: Infinity },
    ]);
    applyLegendConfiguration(
      pieSchema({ legend_values: ["value", "percent"], decimals: 0 }),
      chartPanelRef,
      hovered(),
      options,
    );
    expect(options.legend.formatter("gap")).toBe("{b|gap}  -  -");
    expect(options.legend.formatter("inf")).toBe("{b|inf}  -  -");
    expect(options.legend.formatter("api")).toBe("{b|api}  30  100%");
  });

  it.each(["pie", "donut"])(
    "keeps short %s names beside the percents in a narrow right legend",
    (type) => {
      const options: any = pieOptions([
        { name: "A", value: 1 },
        { name: "B", value: 3 },
      ]);
      applyLegendConfiguration(
        pieSchema(
          { legends_position: "right", legends_type: "scroll", legend_values: ["percent"] },
          type,
        ),
        { value: { offsetWidth: 300, offsetHeight: 300 } },
        hovered(),
        options,
      );
      expect(options.legend.formatter("A")).toBe("{b|A}  25.00%");
      expect(options.legend.formatter("B")).toBe("{b|B}  75.00%");
      expect(calculateWidthText("A  25.00%")).toBeLessThanOrEqual(options.legend.textStyle.width);
    },
  );

  it("drops the name rather than push the values out when not one letter fits beside them", () => {
    const options: any = pieOptions([
      { name: "transcoding-service", value: 9837 },
      { name: "payment-service", value: 9785 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legends_position: "right", legend_values: ["value", "percent"] }),
      { value: { offsetWidth: 300, offsetHeight: 300 } },
      hovered(),
      options,
    );
    expect(options.legend.formatter("transcoding-service")).toBe("9837.00  50.13%");
  });

  it.each([
    [300, "{b|tra...}  75%"],
    [255, "75%"],
  ])("keeps a cut name only while it fits beside the values (panel %i)", (width, expected) => {
    const options: any = pieOptions([
      { name: "transcoding-service", value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legends_position: "right", legend_values: ["percent"], decimals: 0 }),
      { value: { offsetWidth: width, offsetHeight: 300 } },
      hovered(),
      options,
    );
    const text = options.legend.formatter("transcoding-service");
    expect(text).toBe(expected);
    expect(text.replace(/\{[ab]\|([^}]*)\}/, "$1").length * 8).toBeLessThanOrEqual(
      options.legend.textStyle.width,
    );
  });

  it("never swaps a short name for a wider cut one", () => {
    const options: any = pieOptions([
      { name: "ab", value: 30 },
      { name: "db", value: 10 },
    ]);
    applyLegendConfiguration(
      pieSchema({ legends_position: "right", legend_values: ["value", "percent"], decimals: 0 }),
      { value: { offsetWidth: 240, offsetHeight: 300 } },
      hovered(),
      options,
    );
    expect(["{b|ab}  30  75%", "30  75%"]).toContain(options.legend.formatter("ab"));
  });
});

describe("pie outside labels beside a right legend", () => {
  const panel = { value: { offsetWidth: 600, offsetHeight: 300 } };
  const hovered = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
  const schema = (type: string, config: any = {}) => ({
    type,
    config: { show_legends: true, legends_position: "right", ...config },
  });
  const pieSeries = (radius: any, label: any = { show: true }) => ({
    type: "pie",
    radius,
    center: ["50%", "50%"],
    label,
    data: [
      { name: "a-long-service-name", value: 2 },
      { name: "b", value: 1 },
    ],
  });
  // As ECharts lays it out: center x is a share of the box width, radius of half its shorter side.
  const pixels = (series: any) => {
    const boxWidth = 600 - (series.right ?? 0);
    const radii = [series.radius].flat().map((r: string) => parseFloat(r) / 100);
    return {
      cx: (parseFloat(series.center[0]) / 100) * boxWidth,
      radii: radii.map((r: number) => (r * Math.min(boxWidth, 300)) / 2),
    };
  };

  it.each([
    ["donut", { legends_type: "scroll" }, ["40%", "70%"]],
    ["donut", { legends_type: "plain" }, ["40%", "70%"]],
    ["pie", { legends_type: "scroll" }, "70%"],
    ["pie", { legends_type: "plain" }, "70%"],
    ["pie", { legends_type: "plain", chart_align: "left" }, "70%"],
  ])(
    "ends the %s series box at a right legend %o without moving the pie",
    (type, config, radius) => {
      const fitted: any = { series: [pieSeries(radius)] };
      applyLegendConfiguration(schema(type, config), panel, hovered, fitted);
      const inside: any = { series: [pieSeries(radius, { show: true, position: "inside" })] };
      applyLegendConfiguration(schema(type, config), panel, hovered, inside);

      const series = fitted.series[0];
      expect(series.right).toBeGreaterThan(0);
      expect(series.right).toBe(600 - fitted.legend.left);
      const after = pixels(series);
      const before = pixels(inside.series[0]);
      expect(after.cx).toBeCloseTo(before.cx);
      after.radii.forEach((r: number, i: number) => expect(r).toBeCloseTo(before.radii[i]));
    },
  );

  it("leaves inside labels, hidden labels and bottom legends alone", () => {
    const cases: [any, any][] = [
      [schema("pie"), pieSeries("70%", { show: true, position: "inside" })],
      [schema("donut"), pieSeries(["40%", "70%"], { show: false })],
      [schema("donut", { legends_position: "bottom" }), pieSeries(["40%", "70%"])],
    ];
    for (const [panelSchema, series] of cases) {
      const options: any = { series: [series] };
      applyLegendConfiguration(panelSchema, panel, hovered, options);
      expect(options.series[0].right).toBeUndefined();
    }
  });
});
