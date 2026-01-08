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
import {
  buildDynamicGrid,
  buildLegendConfig,
  buildPieChartConfig,
} from "./gridBuilder";

// Mock the legendConfiguration module
vi.mock("../../legendConfiguration", () => ({
  calculateBottomLegendHeight: vi.fn((seriesCount, width, series, height) => {
    return `${Math.min(50 + seriesCount * 2, 100)}px`;
  }),
  calculateRightLegendWidth: vi.fn(
    (seriesCount, width, height, series, scrollable) => {
      return scrollable ? 200 : 150;
    },
  ),
  getChartDimensions: vi.fn((ref) => ({
    chartWidth: 800,
    chartHeight: 600,
  })),
  calculatePieChartRadius: vi.fn(() => 70),
  calculateChartDimensions: vi.fn(() => ({
    availableWidth: 700,
    availableHeight: 500,
  })),
}));

describe("gridBuilder", () => {
  let mockChartPanelRef: any;

  beforeEach(() => {
    mockChartPanelRef = {
      clientWidth: 800,
      clientHeight: 600,
    };
  });

  describe("buildDynamicGrid", () => {
    it("should return default grid configuration", () => {
      const panelSchema = { config: {} };
      const result = buildDynamicGrid(panelSchema, mockChartPanelRef, []);

      expect(result).toEqual({
        left: "3%",
        right: "4%",
        top: "3%",
        bottom: "3%",
        containLabel: true,
      });
    });

    it("should apply custom axis width when configured", () => {
      const panelSchema = {
        config: {
          axis_width: "100px",
        },
      };

      const result = buildDynamicGrid(panelSchema, mockChartPanelRef, []);

      expect(result.left).toBe("100px");
    });

    it("should calculate bottom spacing when legend is at bottom", () => {
      const panelSchema = {
        config: {
          legends_position: "bottom",
          show_legends: true,
        },
      };
      const seriesData = [{ name: "series1" }, { name: "series2" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.bottom).toBe("54px");
    });

    it("should calculate right spacing when legend is at right with scroll", () => {
      const panelSchema = {
        config: {
          legends_position: "right",
          show_legends: true,
          legends_type: "scroll",
        },
      };
      const seriesData = [{ name: "series1" }, { name: "series2" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.right).toBe(200);
    });

    it("should calculate right spacing when legend is at right with plain", () => {
      const panelSchema = {
        config: {
          legends_position: "right",
          show_legends: true,
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.right).toBe(150);
    });

    it("should set top spacing when legend is at top", () => {
      const panelSchema = {
        config: {
          legends_position: "top",
          show_legends: true,
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.top).toBe("15%");
    });

    it("should set left spacing when legend is at left", () => {
      const panelSchema = {
        config: {
          legends_position: "left",
          show_legends: true,
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.left).toBe("15%");
    });

    it("should use custom axis width when legend is at left", () => {
      const panelSchema = {
        config: {
          legends_position: "left",
          show_legends: true,
          axis_width: "120px",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.left).toBe("120px");
    });

    it("should not adjust grid when show_legends is false", () => {
      const panelSchema = {
        config: {
          legends_position: "bottom",
          show_legends: false,
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.bottom).toBe("3%");
    });

    it("should not adjust grid when seriesData is empty", () => {
      const panelSchema = {
        config: {
          legends_position: "bottom",
          show_legends: true,
        },
      };

      const result = buildDynamicGrid(panelSchema, mockChartPanelRef, []);

      expect(result.bottom).toBe("3%");
    });

    it("should default to bottom legend position when not specified", () => {
      const panelSchema = {
        config: {
          show_legends: true,
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.bottom).toBe("52px");
    });

    it("should handle missing config object", () => {
      const panelSchema = {};
      const result = buildDynamicGrid(panelSchema, mockChartPanelRef, []);

      expect(result).toEqual({
        left: "3%",
        right: "4%",
        top: "3%",
        bottom: "3%",
        containLabel: true,
      });
    });

    it("should default legends_type to scroll when not specified", () => {
      const panelSchema = {
        config: {
          legends_position: "right",
          show_legends: true,
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildDynamicGrid(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.right).toBe(200);
    });
  });

  describe("buildLegendConfig", () => {
    it("should return hidden legend when show_legends is false", () => {
      const panelSchema = {
        config: {
          show_legends: false,
        },
      };

      const result = buildLegendConfig(panelSchema, mockChartPanelRef, []);

      expect(result).toEqual({ show: false });
    });

    it("should return bottom horizontal legend by default", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.show).toBe(true);
      expect(result.type).toBe("scroll");
      expect(result.orient).toBe("horizontal");
      expect(result.left).toBe("0");
      expect(result.top).toBe("bottom");
    });

    it("should configure right vertical legend", async () => {
      const panelSchema = {
        config: {
          legends_position: "right",
          legends_type: "scroll",
        },
      };
      const seriesData = [{ name: "series1" }, { name: "series2" }];

      // Reset mock to return 200
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculateRightLegendWidth).mockReturnValueOnce(
        200,
      );

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.orient).toBe("vertical");
      expect(result.right).toBe(0);
      expect(result.top).toBe("center");
      expect(result.width).toBe(180);
    });

    it("should configure vertical legend when position is vertical", () => {
      const panelSchema = {
        config: {
          legends_position: "vertical",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.orient).toBe("vertical");
      expect(result.right).toBe(0);
      expect(result.top).toBe("center");
    });

    it("should configure top horizontal legend", () => {
      const panelSchema = {
        config: {
          legends_position: "top",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.orient).toBe("horizontal");
      expect(result.left).toBe("0");
      expect(result.top).toBe("bottom");
    });

    it("should use plain legend type when explicitly set", () => {
      const panelSchema = {
        config: {
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.type).toBe("plain");
    });

    it("should default to scroll legend type", () => {
      const panelSchema = {
        config: {},
      };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.type).toBe("scroll");
    });

    it("should include text style configuration", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.textStyle).toEqual({
        width: 150,
        overflow: "truncate",
        rich: {
          a: { fontWeight: "bold" },
          b: { fontStyle: "normal" },
        },
      });
    });

    it("should include tooltip configuration", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.tooltip).toEqual({
        show: true,
        padding: 10,
        textStyle: {
          fontSize: 12,
        },
      });
    });

    it("should include padding configuration", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.padding).toEqual([10, 20, 10, 10]);
    });

    it("should not set width for non-scroll legends on right", () => {
      const panelSchema = {
        config: {
          legends_position: "right",
          legends_type: "plain",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.width).toBeUndefined();
    });

    it("should handle empty seriesData", () => {
      const panelSchema = { config: {} };

      const result = buildLegendConfig(panelSchema, mockChartPanelRef, []);

      expect(result.show).toBe(true);
    });

    it("should handle missing config object", () => {
      const panelSchema = {};
      const seriesData = [{ name: "series1" }];

      const result = buildLegendConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.show).toBe(true);
      expect(result.type).toBe("scroll");
    });
  });

  describe("buildPieChartConfig", () => {
    it("should return radius and center for regular pie chart", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.radius).toBe("70%");
      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should return radius range for donut chart", () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        true,
      );

      expect(result.radius).toEqual(["40%", "70%"]);
      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should ensure minimum inner radius for donut chart", async () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      // Mock small radius
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculatePieChartRadius).mockReturnValueOnce(50);

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        true,
      );

      expect(result.radius).toEqual(["40%", "50%"]);
    });

    it("should use custom center position when configured", async () => {
      const panelSchema = {
        config: {
          center_position: ["30%", "40%"],
        },
      };
      const seriesData = [{ name: "series1" }];

      // Reset mock to return 70
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculatePieChartRadius).mockReturnValueOnce(70);

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.center).toEqual(["30%", "40%"]);
    });

    it("should align left when chart_align is left and legend is right", () => {
      const panelSchema = {
        config: {
          chart_align: "left",
          legends_position: "right",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.center).toEqual(["25%", "50%"]);
    });

    it("should align center when chart_align is center and legend is right", () => {
      const panelSchema = {
        config: {
          chart_align: "center",
          legends_position: "right",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should align right when chart_align is right and legend is right", () => {
      const panelSchema = {
        config: {
          chart_align: "right",
          legends_position: "right",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.center).toEqual(["75%", "50%"]);
    });

    it("should not apply chart_align when legend is not right", () => {
      const panelSchema = {
        config: {
          chart_align: "left",
          legends_position: "bottom",
        },
      };
      const seriesData = [{ name: "series1" }];

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should handle empty seriesData", async () => {
      const panelSchema = { config: {} };

      // Reset mock to return 70
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculatePieChartRadius).mockReturnValueOnce(70);

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        [],
        false,
      );

      expect(result.radius).toBe("70%");
      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should handle missing config object", async () => {
      const panelSchema = {};
      const seriesData = [{ name: "series1" }];

      // Reset mock to return 70
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculatePieChartRadius).mockReturnValueOnce(70);

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
        false,
      );

      expect(result.radius).toBe("70%");
      expect(result.center).toEqual(["50%", "50%"]);
    });

    it("should default isDonut to false when not specified", async () => {
      const panelSchema = { config: {} };
      const seriesData = [{ name: "series1" }];

      // Reset mock to return 70
      const legendConfig = await import("../../legendConfiguration");
      vi.mocked(legendConfig.calculatePieChartRadius).mockReturnValueOnce(70);

      const result = buildPieChartConfig(
        panelSchema,
        mockChartPanelRef,
        seriesData,
      );

      expect(result.radius).toBe("70%");
    });
  });
});
