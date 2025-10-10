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

import { describe, expect, it } from "vitest";
import {
  shouldApplyChartAlign,
  shouldShowGridlines,
  shouldShowLegendsToggle,
  shouldShowLegendPosition,
  shouldShowLegendType,
  shouldShowLegendWidth,
  shouldShowLegendHeight,
  shouldShowLegendWidthUnitContainer,
  shouldShowLegendHeightUnitContainer,
} from "./configUtils";

describe("configUtils", () => {
  describe("shouldApplyChartAlign", () => {
    it("should return true for pie chart with right legend", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(true);
    });

    it("should return true for donut chart with right legend", () => {
      const dashboardPanelData = {
        data: {
          type: "donut",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "scroll",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(true);
    });

    it("should return true for null legends_type", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: null,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(true);
    });

    it("should return false when show_legends is false", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: false,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(false);
    });

    it("should return false when legends_position is not right", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(false);
    });

    it("should return false when chart type is not pie or donut", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: "grid" },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowGridlines", () => {
    it("should return true for line chart", () => {
      const dashboardPanelData = {
        data: { type: "line" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(true);
    });

    it("should return true for bar chart", () => {
      const dashboardPanelData = {
        data: { type: "bar" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(true);
    });

    it("should return true for area chart", () => {
      const dashboardPanelData = {
        data: { type: "area" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(true);
    });

    it("should return true for scatter chart", () => {
      const dashboardPanelData = {
        data: { type: "scatter" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(true);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: { type: "table" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for heatmap", () => {
      const dashboardPanelData = {
        data: { type: "heatmap" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for metric", () => {
      const dashboardPanelData = {
        data: { type: "metric" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for gauge", () => {
      const dashboardPanelData = {
        data: { type: "gauge" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for geomap", () => {
      const dashboardPanelData = {
        data: { type: "geomap" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for pie chart", () => {
      const dashboardPanelData = {
        data: { type: "pie" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for donut chart", () => {
      const dashboardPanelData = {
        data: { type: "donut" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: { type: "sankey" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });

    it("should return false for maps", () => {
      const dashboardPanelData = {
        data: { type: "maps" },
      };

      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendsToggle", () => {
    it("should return true for line chart", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
    });

    it("should return true for bar chart", () => {
      const dashboardPanelData = {
        data: {
          type: "bar",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
    });

    it("should return true for pie chart", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
    });

    it("should return true for donut chart", () => {
      const dashboardPanelData = {
        data: {
          type: "donut",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: {
          type: "table",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for heatmap", () => {
      const dashboardPanelData = {
        data: {
          type: "heatmap",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for metric", () => {
      const dashboardPanelData = {
        data: {
          type: "metric",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for gauge", () => {
      const dashboardPanelData = {
        data: {
          type: "gauge",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for geomap", () => {
      const dashboardPanelData = {
        data: {
          type: "geomap",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: {
          type: "sankey",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false for maps", () => {
      const dashboardPanelData = {
        data: {
          type: "maps",
          config: { trellis: { layout: null } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: { trellis: { layout: "grid" } },
        },
      };

      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendPosition", () => {
    it("should return true for line chart with legends enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(true);
    });

    it("should return false when show_legends is false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: false,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: {
          type: "table",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for heatmap", () => {
      const dashboardPanelData = {
        data: {
          type: "heatmap",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for metric", () => {
      const dashboardPanelData = {
        data: {
          type: "metric",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for gauge", () => {
      const dashboardPanelData = {
        data: {
          type: "gauge",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for geomap", () => {
      const dashboardPanelData = {
        data: {
          type: "geomap",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: {
          type: "sankey",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false for maps", () => {
      const dashboardPanelData = {
        data: {
          type: "maps",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            trellis: { layout: "grid" },
          },
        },
      };

      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendType", () => {
    it("should return true for line chart with legends enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(true);
    });

    it("should return false when show_legends is false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: false,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: {
          type: "table",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for heatmap", () => {
      const dashboardPanelData = {
        data: {
          type: "heatmap",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for metric", () => {
      const dashboardPanelData = {
        data: {
          type: "metric",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for gauge", () => {
      const dashboardPanelData = {
        data: {
          type: "gauge",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for geomap", () => {
      const dashboardPanelData = {
        data: {
          type: "geomap",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: {
          type: "sankey",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false for maps", () => {
      const dashboardPanelData = {
        data: {
          type: "maps",
          config: {
            show_legends: true,
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            trellis: { layout: "grid" },
          },
        },
      };

      expect(shouldShowLegendType(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendWidth", () => {
    it("should return true for line chart with right plain legend", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(true);
    });

    it("should return false when legends_position is not right", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });

    it("should return false when legends_type is not plain", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "scroll",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });

    it("should return false when show_legends is false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: false,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: {
          type: "table",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: {
          type: "sankey",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: "grid" },
          },
        },
      };

      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendHeight", () => {
    it("should return true for line chart with bottom plain legend", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(true);
    });

    it("should return true with null legends_position (defaults to bottom)", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: null,
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(true);
    });

    it("should return false when legends_position is right", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should return false when legends_type is not plain", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "scroll",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should return false when show_legends is false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: false,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should return false for table", () => {
      const dashboardPanelData = {
        data: {
          type: "table",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should return false for sankey", () => {
      const dashboardPanelData = {
        data: {
          type: "sankey",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should return false when trellis layout is enabled", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: "grid" },
          },
        },
      };

      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });
  });

  describe("shouldShowLegendWidthUnitContainer", () => {
    it("should return same result as shouldShowLegendWidth", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      const widthResult = shouldShowLegendWidth(dashboardPanelData);
      const widthUnitResult = shouldShowLegendWidthUnitContainer(dashboardPanelData);

      expect(widthResult).toBe(widthUnitResult);
      expect(widthUnitResult).toBe(true);
    });

    it("should return false when shouldShowLegendWidth returns false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      const widthResult = shouldShowLegendWidth(dashboardPanelData);
      const widthUnitResult = shouldShowLegendWidthUnitContainer(dashboardPanelData);

      expect(widthResult).toBe(widthUnitResult);
      expect(widthUnitResult).toBe(false);
    });
  });

  describe("shouldShowLegendHeightUnitContainer", () => {
    it("should return same result as shouldShowLegendHeight", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      const heightResult = shouldShowLegendHeight(dashboardPanelData);
      const heightUnitResult = shouldShowLegendHeightUnitContainer(dashboardPanelData);

      expect(heightResult).toBe(heightUnitResult);
      expect(heightUnitResult).toBe(true);
    });

    it("should return false when shouldShowLegendHeight returns false", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      const heightResult = shouldShowLegendHeight(dashboardPanelData);
      const heightUnitResult = shouldShowLegendHeightUnitContainer(dashboardPanelData);

      expect(heightResult).toBe(heightUnitResult);
      expect(heightUnitResult).toBe(false);
    });
  });

  describe("Edge Cases and Integration Tests", () => {
    it("should handle missing config object", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
        },
      };

      // Should not throw errors
      expect(() => shouldShowGridlines(dashboardPanelData)).not.toThrow();
    });

    it("should handle missing data object", () => {
      const dashboardPanelData = {} as any;

      // The functions expect data.type to exist, so they will throw if data is missing
      // This is expected behavior as the functions require valid input
      expect(() => shouldShowGridlines(dashboardPanelData)).toThrow();
    });

    it("should work for all chart types", () => {
      const chartTypes = [
        "line",
        "bar",
        "area",
        "scatter",
        "pie",
        "donut",
        "table",
        "heatmap",
        "metric",
        "gauge",
        "geomap",
        "sankey",
        "maps",
        "h-bar",
        "stacked",
        "area-stacked",
      ];

      chartTypes.forEach((type) => {
        const dashboardPanelData = {
          data: {
            type,
            config: {
              show_legends: true,
              legends_position: "right",
              legends_type: "plain",
              trellis: { layout: null },
            },
          },
        };

        // Should not throw for any chart type
        expect(() => shouldShowGridlines(dashboardPanelData)).not.toThrow();
        expect(() => shouldShowLegendsToggle(dashboardPanelData)).not.toThrow();
        expect(() => shouldShowLegendPosition(dashboardPanelData)).not.toThrow();
        expect(() => shouldShowLegendType(dashboardPanelData)).not.toThrow();
        expect(() => shouldShowLegendWidth(dashboardPanelData)).not.toThrow();
        expect(() => shouldShowLegendHeight(dashboardPanelData)).not.toThrow();
      });
    });

    it("should handle different trellis values", () => {
      const trellisValues = [null, undefined, "grid", "rows", "columns"];

      trellisValues.forEach((layout) => {
        const dashboardPanelData = {
          data: {
            type: "line",
            config: {
              show_legends: true,
              trellis: { layout },
            },
          },
        };

        const result = shouldShowLegendsToggle(dashboardPanelData);

        if (layout === null) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      });
    });

    it("should validate complete workflow for pie chart configuration", () => {
      const dashboardPanelData = {
        data: {
          type: "pie",
          config: {
            show_legends: true,
            legends_position: "right",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(true);
      expect(shouldShowGridlines(dashboardPanelData)).toBe(false);
      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendType(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(false);
    });

    it("should validate complete workflow for line chart configuration", () => {
      const dashboardPanelData = {
        data: {
          type: "line",
          config: {
            show_legends: true,
            legends_position: "bottom",
            legends_type: "plain",
            trellis: { layout: null },
          },
        },
      };

      expect(shouldApplyChartAlign(dashboardPanelData)).toBe(false);
      expect(shouldShowGridlines(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendsToggle(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendPosition(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendType(dashboardPanelData)).toBe(true);
      expect(shouldShowLegendWidth(dashboardPanelData)).toBe(false);
      expect(shouldShowLegendHeight(dashboardPanelData)).toBe(true);
    });
  });
});
