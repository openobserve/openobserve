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
  buildTooltip,
  buildXAxis,
  buildYAxis,
  buildCategoryXAxis,
  buildCategoryYAxis,
  buildValueAxis,
} from "./axisBuilder";

// Mock the convertDataIntoUnitValue module
vi.mock("../../convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((obj) => {
    const { unit, value } = obj;
    if (["$", "€", "£", "¥", "₹"].includes(unit)) {
      return `${unit}${value}`;
    }
    return `${value}${unit}`;
  }),
  getUnitValue: vi.fn((value, unit, unitCustom, decimals = 2) => {
    // Simple mock implementation
    if (unit === "bytes") {
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

describe("axisBuilder", () => {
  describe("buildTooltip", () => {
    it("should build tooltip with default trigger type 'axis'", () => {
      const panelSchema = {
        config: {
          decimals: 2,
          unit: "bytes",
        },
      };

      const result = buildTooltip(panelSchema);

      expect(result.trigger).toBe("axis");
      expect(result.textStyle.fontSize).toBe(12);
      expect(result.axisPointer.type).toBe("cross");
      expect(result.formatter).toBeDefined();
    });

    it("should build tooltip with custom trigger type 'item'", () => {
      const panelSchema = {
        config: {
          decimals: 2,
          unit: "bytes",
        },
      };

      const result = buildTooltip(panelSchema, "item");

      expect(result.trigger).toBe("item");
    });

    it("should use default decimals of 2 if not specified", () => {
      const panelSchema = {
        config: {
          unit: "bytes",
        },
      };

      const result = buildTooltip(panelSchema);
      expect(result.formatter).toBeDefined();
    });

    it("should handle empty config", () => {
      const panelSchema = {};

      const result = buildTooltip(panelSchema);

      expect(result.trigger).toBe("axis");
      expect(result.formatter).toBeDefined();
    });

    describe("tooltip formatter", () => {
      it("should return empty string for null params", () => {
        const panelSchema = { config: {} };
        const tooltip = buildTooltip(panelSchema);

        const result = tooltip.formatter(null);

        expect(result).toBe("");
      });

      it("should return empty string for empty array params", () => {
        const panelSchema = { config: {} };
        const tooltip = buildTooltip(panelSchema);

        const result = tooltip.formatter([]);

        expect(result).toBe("");
      });

      it("should handle single item (non-array params)", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "bytes",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = {
          seriesName: "Series 1",
          value: [1609459200000, 100],
          marker: '<span style="color:red">●</span>',
          axisValue: "2021-01-01",
        };

        const result = tooltip.formatter(params);

        expect(result).toContain("2021-01-01");
        expect(result).toContain("Series 1");
        expect(result).toContain("100.00B");
      });

      it("should handle array of items with axis value", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "bytes",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            seriesName: "Series 1",
            value: [1609459200000, 100],
            marker: '<span style="color:red">●</span>',
            axisValue: "2021-01-01",
          },
          {
            seriesName: "Series 2",
            value: [1609459200000, 200],
            marker: '<span style="color:blue">●</span>',
            axisValue: "2021-01-01",
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).toContain("2021-01-01");
        expect(result).toContain("Series 1");
        expect(result).toContain("100.00B");
        expect(result).toContain("Series 2");
        expect(result).toContain("200.00B");
      });

      it("should handle params without axisValue", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "bytes",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            seriesName: "Series 1",
            value: 100,
            marker: '<span style="color:red">●</span>',
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).toContain("Series 1");
        expect(result).toContain("100.00B");
      });

      it("should handle value as direct number (not array)", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "percent",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            seriesName: "Series 1",
            value: 75.5,
            marker: '<span style="color:red">●</span>',
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).toContain("Series 1");
        expect(result).toContain("75.50%");
      });

      it("should handle params without marker", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "bytes",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            seriesName: "Series 1",
            value: 100,
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).toContain("Series 1");
        expect(result).toContain("100.00B");
      });

      it("should skip items without seriesName", () => {
        const panelSchema = {
          config: {
            decimals: 2,
            unit: "bytes",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            value: 100,
            marker: '<span style="color:red">●</span>',
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).not.toContain("100.00B");
      });

      it("should format with custom unit", () => {
        const panelSchema = {
          config: {
            decimals: 3,
            unit: "custom",
            unit_custom: "req/s",
          },
        };
        const tooltip = buildTooltip(panelSchema);

        const params = [
          {
            seriesName: "Requests",
            value: 125.456,
            marker: '<span style="color:green">●</span>',
          },
        ];

        const result = tooltip.formatter(params);

        expect(result).toContain("Requests");
        expect(result).toContain("125.456req/s");
      });
    });
  });

  describe("buildXAxis", () => {
    let mockStore: any;

    beforeEach(() => {
      mockStore = {
        state: {
          timezone: "UTC",
        },
      };
    });

    it("should build basic X-axis configuration", () => {
      const panelSchema = {
        config: {},
      };

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.type).toBe("time");
      expect(result.axisLine.show).toBe(false);
      expect(result.axisLine.onZero).toBe(false);
      expect(result.axisLabel.show).toBe(true);
      expect(result.axisLabel.hideOverlap).toBe(true);
      expect(result.splitLine.show).toBe(true);
    });

    it("should show axis line when hasData is false", () => {
      const panelSchema = {
        config: {},
      };

      const result = buildXAxis(panelSchema, mockStore, false);

      expect(result.axisLine.show).toBe(true);
    });

    it("should hide grid lines when show_grid is false", () => {
      const panelSchema = {
        config: {
          show_grid: false,
        },
      };

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.splitLine.show).toBe(false);
    });

    it("should hide axis labels when axis_label is false", () => {
      const panelSchema = {
        config: {
          axis_label: false,
        },
      };

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.axisLabel.show).toBe(false);
    });

    it("should override axisLine when axis_border_show is defined", () => {
      const panelSchema = {
        config: {
          axis_border_show: true,
        },
      };

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.axisLine.show).toBe(true);
    });

    it("should handle axis_border_show false", () => {
      const panelSchema = {
        config: {
          axis_border_show: false,
        },
      };

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.axisLine.show).toBe(false);
    });

    it("should handle empty panel schema", () => {
      const panelSchema = {};

      const result = buildXAxis(panelSchema, mockStore, true);

      expect(result.type).toBe("time");
      expect(result.splitLine.show).toBe(true);
    });
  });

  describe("buildYAxis", () => {
    it("should build basic Y-axis configuration", () => {
      const panelSchema = {
        config: {},
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.type).toBe("value");
      expect(result.axisLabel.show).toBe(true);
      expect(result.axisLabel.formatter).toBeDefined();
      expect(result.splitLine.show).toBe(true);
    });

    it("should hide grid lines when show_grid is false", () => {
      const panelSchema = {
        config: {
          show_grid: false,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.splitLine.show).toBe(false);
    });

    it("should hide axis labels when axis_label is false", () => {
      const panelSchema = {
        config: {
          axis_label: false,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.axisLabel.show).toBe(false);
    });

    it("should add axis border when axis_border_show is true", () => {
      const panelSchema = {
        config: {
          axis_border_show: true,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.axisLine.show).toBe(true);
    });

    it("should apply Y-axis min value", () => {
      const panelSchema = {
        config: {
          y_axis_min: 0,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.min).toBe(0);
    });

    it("should apply Y-axis max value", () => {
      const panelSchema = {
        config: {
          y_axis_max: 100,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.max).toBe(100);
    });

    it("should apply both Y-axis min and max values", () => {
      const panelSchema = {
        config: {
          y_axis_min: 0,
          y_axis_max: 100,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.min).toBe(0);
      expect(result.max).toBe(100);
    });

    it("should add axis name from query label", () => {
      const panelSchema = {
        config: {},
        queries: [
          {
            fields: {
              y: [{ label: "Response Time (ms)" }],
            },
          },
        ],
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.name).toBe("Response Time (ms)");
      expect(result.nameLocation).toBe("middle");
      expect(result.nameGap).toBe(50);
      expect(result.nameTextStyle.fontWeight).toBe("bold");
      expect(result.nameTextStyle.fontSize).toBe(14);
    });

    it("should handle query index out of bounds", () => {
      const panelSchema = {
        config: {},
        queries: [
          {
            fields: {
              y: [{ label: "Response Time" }],
            },
          },
        ],
      };

      const result = buildYAxis(panelSchema, 5);

      expect(result.name).toBeUndefined();
    });

    it("should handle missing queries", () => {
      const panelSchema = {
        config: {},
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.name).toBeUndefined();
    });

    it("should handle axis_width configuration", () => {
      const panelSchema = {
        config: {
          axis_width: 100,
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      expect(result.axisLabel.width).toBe(100);
      expect(result.axisLabel.formatter).toBeDefined();
    });

    it("should preserve formatter when axis_width is set", () => {
      const panelSchema = {
        config: {
          axis_width: 100,
          unit: "bytes",
          decimals: 3,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      const formatted = result.axisLabel.formatter(1024);
      expect(formatted).toBe("1024.000B");
    });

    it("should format Y-axis labels with unit", () => {
      const panelSchema = {
        config: {
          unit: "percent",
          decimals: 1,
        },
      };

      const result = buildYAxis(panelSchema, 0);

      const formatted = result.axisLabel.formatter(75.5);
      expect(formatted).toBe("75.5%");
    });

    it("should handle empty config", () => {
      const panelSchema = {};

      const result = buildYAxis(panelSchema, 0);

      expect(result.type).toBe("value");
      expect(result.splitLine.show).toBe(true);
    });
  });

  describe("buildCategoryXAxis", () => {
    it("should build basic category X-axis", () => {
      const categories = ["Category 1", "Category 2", "Category 3"];
      const panelSchema = {
        config: {},
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.type).toBe("category");
      expect(result.data).toEqual(categories);
      expect(result.axisLabel.show).toBe(true);
      expect(result.axisLabel.rotate).toBe(0);
      expect(result.splitLine.show).toBe(true);
    });

    it("should apply label rotation", () => {
      const categories = ["Category 1", "Category 2"];
      const panelSchema = {
        config: {
          axis_label_rotate: 45,
        },
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.axisLabel.rotate).toBe(45);
    });

    it("should hide grid lines when show_grid is false", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          show_grid: false,
        },
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.splitLine.show).toBe(false);
    });

    it("should hide axis labels when axis_label is false", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          axis_label: false,
        },
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.axisLabel.show).toBe(false);
    });

    it("should add axis border when axis_border_show is true", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          axis_border_show: true,
        },
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.axisLine.show).toBe(true);
    });

    it("should handle empty categories array", () => {
      const categories: string[] = [];
      const panelSchema = {
        config: {},
      };

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.data).toEqual([]);
    });

    it("should handle empty config", () => {
      const categories = ["Category 1"];
      const panelSchema = {};

      const result = buildCategoryXAxis(categories, panelSchema);

      expect(result.type).toBe("category");
      expect(result.data).toEqual(categories);
    });
  });

  describe("buildCategoryYAxis", () => {
    it("should build basic category Y-axis", () => {
      const categories = ["Category 1", "Category 2", "Category 3"];
      const panelSchema = {
        config: {},
      };

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.type).toBe("category");
      expect(result.data).toEqual(categories);
      expect(result.axisLabel.show).toBe(true);
      expect(result.splitLine.show).toBe(true);
    });

    it("should hide grid lines when show_grid is false", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          show_grid: false,
        },
      };

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.splitLine.show).toBe(false);
    });

    it("should hide axis labels when axis_label is false", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          axis_label: false,
        },
      };

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.axisLabel.show).toBe(false);
    });

    it("should add axis border when axis_border_show is true", () => {
      const categories = ["Category 1"];
      const panelSchema = {
        config: {
          axis_border_show: true,
        },
      };

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.axisLine.show).toBe(true);
    });

    it("should handle empty categories array", () => {
      const categories: string[] = [];
      const panelSchema = {
        config: {},
      };

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.data).toEqual([]);
    });

    it("should handle empty config", () => {
      const categories = ["Category 1"];
      const panelSchema = {};

      const result = buildCategoryYAxis(categories, panelSchema);

      expect(result.type).toBe("category");
      expect(result.data).toEqual(categories);
    });
  });

  describe("buildValueAxis", () => {
    it("should build basic value axis", () => {
      const panelSchema = {
        config: {},
      };

      const result = buildValueAxis(panelSchema);

      expect(result.type).toBe("value");
      expect(result.axisLabel.show).toBe(true);
      expect(result.axisLabel.formatter).toBeDefined();
      expect(result.splitLine.show).toBe(true);
    });

    it("should hide grid lines when show_grid is false", () => {
      const panelSchema = {
        config: {
          show_grid: false,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.splitLine.show).toBe(false);
    });

    it("should hide axis labels when axis_label is false", () => {
      const panelSchema = {
        config: {
          axis_label: false,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.axisLabel.show).toBe(false);
    });

    it("should add axis border when axis_border_show is true", () => {
      const panelSchema = {
        config: {
          axis_border_show: true,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.axisLine.show).toBe(true);
    });

    it("should apply Y-axis min value (for h-bar)", () => {
      const panelSchema = {
        config: {
          y_axis_min: 0,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.min).toBe(0);
    });

    it("should apply Y-axis max value (for h-bar)", () => {
      const panelSchema = {
        config: {
          y_axis_max: 100,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.max).toBe(100);
    });

    it("should apply both Y-axis min and max values", () => {
      const panelSchema = {
        config: {
          y_axis_min: 0,
          y_axis_max: 100,
        },
      };

      const result = buildValueAxis(panelSchema);

      expect(result.min).toBe(0);
      expect(result.max).toBe(100);
    });

    it("should format value axis labels with unit", () => {
      const panelSchema = {
        config: {
          unit: "bytes",
          decimals: 2,
        },
      };

      const result = buildValueAxis(panelSchema);

      const formatted = result.axisLabel.formatter(1024);
      expect(formatted).toBe("1024.00B");
    });

    it("should format value axis labels with custom unit", () => {
      const panelSchema = {
        config: {
          unit: "custom",
          unit_custom: "ops/s",
          decimals: 1,
        },
      };

      const result = buildValueAxis(panelSchema);

      const formatted = result.axisLabel.formatter(150.5);
      expect(formatted).toBe("150.5ops/s");
    });

    it("should handle empty config", () => {
      const panelSchema = {};

      const result = buildValueAxis(panelSchema);

      expect(result.type).toBe("value");
      expect(result.splitLine.show).toBe(true);
    });
  });
});
