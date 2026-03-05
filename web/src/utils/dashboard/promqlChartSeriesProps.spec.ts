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
import { getPropsByChartTypeForSeries } from "@/utils/dashboard/promqlChartSeriesProps";

describe("promqlChartSeriesProps", () => {
  describe("getPropsByChartTypeForSeries", () => {
    it("returns bar series props for 'bar' type", () => {
      const result = getPropsByChartTypeForSeries("bar");
      expect(result).toEqual({
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns line series props for 'line' type", () => {
      const result = getPropsByChartTypeForSeries("line");
      expect(result).toEqual({
        type: "line",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns scatter series props for 'scatter' type", () => {
      const result = getPropsByChartTypeForSeries("scatter");
      expect(result).toEqual({
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5,
      });
    });

    it("returns pie series props for 'pie' type", () => {
      const result = getPropsByChartTypeForSeries("pie");
      expect(result).toEqual({
        type: "pie",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns pie series props for 'donut' type (donut uses pie)", () => {
      const result = getPropsByChartTypeForSeries("donut");
      expect(result.type).toBe("pie");
      expect(result).toEqual({
        type: "pie",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns h-bar series props for 'h-bar' type", () => {
      const result = getPropsByChartTypeForSeries("h-bar");
      expect(result).toEqual({
        type: "bar",
        orientation: "h",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns area series props for 'area' type", () => {
      const result = getPropsByChartTypeForSeries("area");
      expect(result).toEqual({
        type: "line",
        emphasis: { focus: "series" },
        areaStyle: {},
        lineStyle: { width: 1.5 },
      });
    });

    it("returns stacked bar series props for 'stacked' type", () => {
      const result = getPropsByChartTypeForSeries("stacked");
      expect(result).toEqual({
        type: "bar",
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns area-stacked series props for 'area-stacked' type", () => {
      const result = getPropsByChartTypeForSeries("area-stacked");
      expect(result).toEqual({
        type: "line",
        stack: "Total",
        areaStyle: {},
        emphasis: { focus: "series" },
        lineStyle: { width: 1.5 },
      });
    });

    it("returns gauge series props for 'gauge' type", () => {
      const result = getPropsByChartTypeForSeries("gauge");
      expect(result.type).toBe("gauge");
      expect(result).toMatchObject({
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
      });
    });

    it("returns metric series props for 'metric' type", () => {
      const result = getPropsByChartTypeForSeries("metric");
      expect(result).toEqual({
        type: "custom",
        coordinateSystem: "polar",
      });
    });

    it("returns h-stacked series props for 'h-stacked' type", () => {
      const result = getPropsByChartTypeForSeries("h-stacked");
      expect(result).toEqual({
        type: "bar",
        emphasis: { focus: "series" },
        orientation: "h",
        lineStyle: { width: 1.5 },
      });
    });

    it("returns default bar props for unknown type", () => {
      const result = getPropsByChartTypeForSeries("unknown-type");
      expect(result).toEqual({ type: "bar" });
    });

    it("returns default bar props for empty string", () => {
      const result = getPropsByChartTypeForSeries("");
      expect(result).toEqual({ type: "bar" });
    });

    it("area type includes areaStyle property", () => {
      const result = getPropsByChartTypeForSeries("area");
      expect(result).toHaveProperty("areaStyle");
    });

    it("area-stacked type has stack 'Total'", () => {
      const result = getPropsByChartTypeForSeries("area-stacked");
      expect((result as any).stack).toBe("Total");
    });

    it("scatter type has symbolSize", () => {
      const result = getPropsByChartTypeForSeries("scatter");
      expect((result as any).symbolSize).toBe(5);
    });

    it("h-bar and h-stacked have horizontal orientation", () => {
      const hBar = getPropsByChartTypeForSeries("h-bar");
      const hStacked = getPropsByChartTypeForSeries("h-stacked");
      expect((hBar as any).orientation).toBe("h");
      expect((hStacked as any).orientation).toBe("h");
    });

    it("all common chart types return valid objects", () => {
      const types = [
        "bar", "line", "scatter", "pie", "donut", "h-bar",
        "area", "stacked", "area-stacked", "gauge", "metric", "h-stacked",
      ];
      types.forEach((type) => {
        const result = getPropsByChartTypeForSeries(type);
        expect(result).toBeDefined();
        expect(typeof result).toBe("object");
        expect(result).toHaveProperty("type");
      });
    });
  });
});
