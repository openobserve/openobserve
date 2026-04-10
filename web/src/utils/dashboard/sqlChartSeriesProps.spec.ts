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

import { describe, expect, it } from "vitest";
import { getPropsByChartTypeForSeries } from "@/utils/dashboard/sqlChartSeriesProps";

const makeSchema = (type: string, config: any = {}) => ({ type, config });

describe("sqlChartSeriesProps - getPropsByChartTypeForSeries", () => {
  describe("bar chart", () => {
    it("returns bar type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("bar")).type).toBe("bar");
    });

    it("includes emphasis focus series", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("bar")) as any;
      expect(result.emphasis.focus).toBe("series");
    });
  });

  describe("line chart", () => {
    it("returns line type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("line")).type).toBe("line");
    });

    it("uses smooth interpolation by default (null)", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: null })) as any;
      expect(result.smooth).toBe(true);
    });

    it("uses smooth interpolation when config is 'smooth'", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "smooth" })) as any;
      expect(result.smooth).toBe(true);
    });

    it("does not use smooth for step-start", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "step-start" })) as any;
      expect(result.smooth).toBe(false);
    });

    it("returns step for step-start", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "step-start" })) as any;
      expect(result.step).toBe("start");
    });

    it("returns step for step-end", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "step-end" })) as any;
      expect(result.step).toBe("end");
    });

    it("returns step for step-middle", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "step-middle" })) as any;
      expect(result.step).toBe("middle");
    });

    it("returns false for step when not step interpolation", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_interpolation: "smooth" })) as any;
      expect(result.step).toBe(false);
    });

    it("uses show_symbol from config", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { show_symbol: true })) as any;
      expect(result.showSymbol).toBe(true);
    });

    it("defaults showSymbol to false", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line")) as any;
      expect(result.showSymbol).toBe(false);
    });

    it("uses line_thickness from config", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line", { line_thickness: 3 })) as any;
      expect(result.lineStyle.width).toBe(3);
    });

    it("defaults line thickness to 1.5", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line")) as any;
      expect(result.lineStyle.width).toBe(1.5);
    });

    it("areaStyle is null for line (not area)", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("line")) as any;
      expect(result.areaStyle).toBeNull();
    });
  });

  describe("scatter chart", () => {
    it("returns scatter type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("scatter")).type).toBe("scatter");
    });

    it("has symbolSize 5", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("scatter")) as any;
      expect(result.symbolSize).toBe(5);
    });
  });

  describe("pie chart", () => {
    it("returns pie type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("pie")).type).toBe("pie");
    });

    it("has avoidLabelOverlap false", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("pie")) as any;
      expect(result.avoidLabelOverlap).toBe(false);
    });

    it("has radius 50%", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("pie")) as any;
      expect(result.radius).toBe("50%");
    });
  });

  describe("donut chart", () => {
    it("returns pie type (donut uses pie)", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("donut")).type).toBe("pie");
    });

    it("has two-element radius array", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("donut")) as any;
      expect(Array.isArray(result.radius)).toBe(true);
      expect(result.radius).toHaveLength(2);
    });

    it("has avoidLabelOverlap false", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("donut")) as any;
      expect(result.avoidLabelOverlap).toBe(false);
    });
  });

  describe("h-bar chart", () => {
    it("returns bar type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("h-bar")).type).toBe("bar");
    });
  });

  describe("area chart", () => {
    it("returns line type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("area")).type).toBe("line");
    });

    it("has areaStyle object", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("area")) as any;
      expect(result.areaStyle).toBeDefined();
      expect(result.areaStyle).not.toBeNull();
    });

    it("uses smooth interpolation by default", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("area")) as any;
      expect(result.smooth).toBe(true);
    });

    it("handles step interpolation", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("area", { line_interpolation: "step-start" })) as any;
      expect(result.step).toBe("start");
    });
  });

  describe("stacked chart", () => {
    it("returns bar type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("stacked")).type).toBe("bar");
    });
  });

  describe("heatmap chart", () => {
    it("returns heatmap type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("heatmap")).type).toBe("heatmap");
    });

    it("shows label", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("heatmap")) as any;
      expect(result.label.show).toBe(true);
    });
  });

  describe("area-stacked chart", () => {
    it("returns line type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("area-stacked")).type).toBe("line");
    });

    it("has stack Total", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("area-stacked")) as any;
      expect(result.stack).toBe("Total");
    });

    it("has areaStyle", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("area-stacked")) as any;
      expect(result.areaStyle).toBeDefined();
    });
  });

  describe("metric chart", () => {
    it("returns custom type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("metric")).type).toBe("custom");
    });

    it("has polar coordinateSystem", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("metric")) as any;
      expect(result.coordinateSystem).toBe("polar");
    });
  });

  describe("h-stacked chart", () => {
    it("returns bar type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("h-stacked")).type).toBe("bar");
    });
  });

  describe("gauge chart", () => {
    it("returns gauge type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("gauge")).type).toBe("gauge");
    });

    it("has startAngle 205", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("gauge")) as any;
      expect(result.startAngle).toBe(205);
    });

    it("has endAngle -25", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("gauge")) as any;
      expect(result.endAngle).toBe(-25);
    });

    it("shows progress", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("gauge")) as any;
      expect(result.progress.show).toBe(true);
    });

    it("hides pointer", () => {
      const result = getPropsByChartTypeForSeries(makeSchema("gauge")) as any;
      expect(result.pointer.show).toBe(false);
    });
  });

  describe("default / unknown type", () => {
    it("returns bar for unknown type", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("unknown")).type).toBe("bar");
    });

    it("returns bar for empty string", () => {
      expect(getPropsByChartTypeForSeries(makeSchema("")).type).toBe("bar");
    });
  });

  describe("all chart types return valid objects", () => {
    const types = [
      "bar", "line", "scatter", "pie", "donut", "h-bar",
      "area", "stacked", "heatmap", "area-stacked", "metric", "h-stacked", "gauge",
    ];

    types.forEach((type) => {
      it(`returns object with type for '${type}'`, () => {
        const result = getPropsByChartTypeForSeries(makeSchema(type));
        expect(result).toBeDefined();
        expect(result).toHaveProperty("type");
      });
    });
  });
});
