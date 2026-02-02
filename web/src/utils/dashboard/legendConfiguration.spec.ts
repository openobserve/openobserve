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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

// Mock calculateWidthText
vi.mock("./convertDataIntoUnitValue", () => ({
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
      expect(result).toBeGreaterThanOrEqual(50); // Minimum height of 3.125rem = 50px
    });

    it("should calculate height for multiple legend items", () => {
      const seriesData = [
        { name: "Series 1" },
        { name: "Series 2" },
        { name: "Series 3" },
      ];
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
        chartHeight
      );

      expect(gridConfig.bottom).toBeDefined();
      expect(legendConfig.top).toBeDefined();
      expect(legendConfig.height).toBeDefined();
    });

    it("should handle series with different name properties", () => {
      const seriesData = [
        { seriesName: "Series 1" },
        { name: "Series 2" },
        { other: "Series 3" },
      ];
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
      const seriesData = [
        { name: "Series 1" },
        { name: "Series 2" },
        { name: "Series 3" },
      ];
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
      const seriesData = [
        { seriesName: "Series 1" },
        { seriesName: "Series 2" },
      ];
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };

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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };

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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(false);
    });

    it("should not show legend when trellis layout is enabled", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true, trellis: { layout: "grid" } },
      };
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.show).toBe(false);
    });

    it("should include tooltip with formatter", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true },
      };
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };

      const result = createBaseLegendConfig(panelSchema, hoveredSeriesState);

      expect(result.tooltip).toBeDefined();
      expect(result.tooltip.formatter).toBeDefined();
    });

    it("should handle formatter for hovered series", () => {
      const panelSchema = {
        type: "line",
        config: { show_legends: true },
      };
      const hoveredSeriesState = { value: { hoveredSeriesName: "Series 1", setHoveredSeriesName: vi.fn() } };

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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
      const hoveredSeriesState = { value: { hoveredSeriesName: null, setHoveredSeriesName: vi.fn() } };
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
        [{ name: "Series" }]
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
      const seriesData = [
        { name: "Series 1" },
        { name: "Series 2" },
      ];

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
