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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  convertLogData,
  convertStackedLogData,
  formatDate,
  formatCount,
} from "./convertLogData";

// Stub the color-palette module so tests are not coupled to palette values.
vi.mock("@/utils/dashboard/colorPalette", () => ({
  classicColorPaletteLightTheme: ["#aaa", "#bbb", "#ccc"],
  classicColorPaletteDarkTheme:  ["#111", "#222", "#333"],
}));

describe("convertLogData.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, "getComputedStyle", {
      value: () => ({
        getPropertyValue: (prop: string) => {
          if (prop === "--o2-theme-color") return "#7A80C2";
          if (prop === "--o2-dark-theme-color") return "#5A60A2";
          return "";
        },
      }),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ---------------------------------------------------------------------------
  // convertLogData
  // ---------------------------------------------------------------------------
  describe("convertLogData", () => {
    it("returns all required top-level ECharts config keys", () => {
      const result = convertLogData([1640995200000], [10], {
        title: "T",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      for (const key of ["title", "backgroundColor", "grid", "tooltip", "xAxis", "yAxis", "toolbox", "series"]) {
        expect(result.options).toHaveProperty(key);
      }
    });

    it("sets backgroundColor to transparent", () => {
      const { options } = convertLogData([1640995200000], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.backgroundColor).toBe("transparent");
    });

    it("configures grid layout", () => {
      const { options } = convertLogData([1640995200000], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.grid).toEqual({
        containLabel: true,
        left: "20",
        right: "20",
        top: "5",
        bottom: "0",
      });
    });

    it("configures tooltip", () => {
      const { options } = convertLogData([1640995200000], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.tooltip.show).toBe(true);
      expect(options.tooltip.trigger).toBe("axis");
      expect(options.tooltip.textStyle.fontSize).toBe(12);
      // formatter_test was dead code and has been removed
      expect(options.tooltip).not.toHaveProperty("formatter_test");
    });

    it("sets xAxis type to time", () => {
      const { options } = convertLogData([1640995200000], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.xAxis.type).toBe("time");
    });

    it("sets yAxis splitNumber to 3 to keep tick density low on short charts", () => {
      const { options } = convertLogData([1, 2, 3], [10, 20, 5], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.yAxis.splitNumber).toBe(3);
    });

    it("yAxis axisLabel formatter formats values using the 'numbers' unit", () => {
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      // Small values keep 2 decimals with no unit suffix
      expect(options.yAxis.axisLabel.formatter(10.7)).toBe("10.70");
      expect(options.yAxis.axisLabel.formatter(0)).toBe("0.00");
      // Large values are abbreviated (K / M / B / T / Q)
      expect(options.yAxis.axisLabel.formatter(1500)).toBe("1.50K");
      expect(options.yAxis.axisLabel.formatter(2_500_000)).toBe("2.50M");
    });

    it("maps x/y data correctly for UTC timezone", () => {
      const x = [1640995200000, 1640998800000];
      const y = [10, 20];
      const { options } = convertLogData(x, y, {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].data).toEqual([
        [1640995200000, 10],
        [1640998800000, 20],
      ]);
    });

    it("converts timestamps for non-UTC timezone", () => {
      const { options } = convertLogData([1640995200000], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "America/New_York",
        itemStyle: null,
      });
      // toZonedTime shifts the timestamp; value must still be 10
      expect(options.series[0].data[0][1]).toBe(10);
      // The timestamp must differ from UTC raw value
      expect(options.series[0].data[0][0]).not.toBe(1640995200000);
    });

    it("defaults missing y values to 0 when x is longer", () => {
      const { options } = convertLogData([1, 2, 3], [10, 20], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].data[2][1]).toBe(0);
    });

    it("uses custom itemStyle when provided", () => {
      const itemStyle = { color: "#ff0000" };
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle,
      });
      expect(options.series[0].itemStyle).toBe(itemStyle);
    });

    it("reads theme color from CSS custom property in light mode", () => {
      document.body.classList.remove("body--dark");
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].itemStyle.color).toBe("#7A80C2");
    });

    it("reads theme color from body CSS property in dark mode", () => {
      document.body.classList.add("body--dark");
      Object.defineProperty(window, "getComputedStyle", {
        value: (el: Element) => ({
          getPropertyValue: (prop: string) => {
            if (el === document.body && prop === "--o2-dark-theme-color") return "#5A60A2";
            if (prop === "--o2-theme-color") return "#7A80C2";
            return "";
          },
        }),
        writable: true,
        configurable: true,
      });
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].itemStyle.color).toBe("#5A60A2");
      document.body.classList.remove("body--dark");
    });

    it("handles empty x and y arrays", () => {
      const { options } = convertLogData([], [], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].data).toEqual([]);
    });

    it("series type is bar with emphasis", () => {
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.series[0].type).toBe("bar");
      expect(options.series[0].emphasis).toEqual({ focus: "series" });
    });

    it("configures toolbox with hidden dataZoom buttons", () => {
      const { options } = convertLogData([1], [10], {
        title: "",
        unparsed_x_data: [],
        timezone: "UTC",
        itemStyle: null,
      });
      expect(options.toolbox.itemSize).toBe(0);
      expect(options.toolbox.bottom).toBe("100%");
      expect(options.toolbox.feature.dataZoom.show).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // formatCount
  // ---------------------------------------------------------------------------
  describe("formatCount", () => {
    it("returns raw value for numbers below 1000", () => {
      expect(formatCount(0)).toBe("0");
      expect(formatCount(1)).toBe("1");
      expect(formatCount(999)).toBe("999");
    });

    it("formats thousands with one decimal and k suffix", () => {
      expect(formatCount(1000)).toBe("1k");
      expect(formatCount(1500)).toBe("1.5k");
      expect(formatCount(3200)).toBe("3.2k");
      expect(formatCount(10000)).toBe("10k");
      expect(formatCount(999900)).toBe("999.9k");
    });

    it("strips trailing .0 for exact thousands", () => {
      expect(formatCount(2000)).toBe("2k");
      expect(formatCount(50000)).toBe("50k");
    });

    it("formats millions with M suffix", () => {
      expect(formatCount(1_000_000)).toBe("1M");
      expect(formatCount(1_500_000)).toBe("1.5M");
      expect(formatCount(2_200_000)).toBe("2.2M");
      expect(formatCount(10_000_000)).toBe("10M");
    });

    it("strips trailing .0 for exact millions", () => {
      expect(formatCount(3_000_000)).toBe("3M");
    });

    it("prefers M over k for values >= 1 000 000", () => {
      // Must not produce "1000k"
      const result = formatCount(1_000_000);
      expect(result).toBe("1M");
      expect(result).not.toContain("k");
    });
  });

  // ---------------------------------------------------------------------------
  // convertStackedLogData
  // ---------------------------------------------------------------------------
  describe("convertStackedLogData", () => {
    const baseParams = { title: "Test", timezone: "UTC", breakdownField: "level" };
    const ts1 = 1640995200000;
    const ts2 = 1640998800000;

    const makeBreakdown = (entries: [string, number[]][]) =>
      new Map<string, number[]>(entries);

    it("returns an options object with all required ECharts keys", () => {
      const bd = makeBreakdown([["error", [10, 20]]]);
      const { options } = convertStackedLogData([ts1, ts2], bd, baseParams, false);
      for (const key of ["backgroundColor", "grid", "tooltip", "legend", "xAxis", "yAxis", "toolbox", "series"]) {
        expect(options).toHaveProperty(key);
      }
    });

    it("produces one series per breakdown category", () => {
      const bd = makeBreakdown([["error", [10]], ["warn", [5]], ["info", [20]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series).toHaveLength(3);
    });

    it("stacks all series on 'total'", () => {
      const bd = makeBreakdown([["error", [10]], ["info", [5]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      options.series.forEach((s: any) => expect(s.stack).toBe("total"));
    });

    it("preserves the original case of each category label", () => {
      const bd = makeBreakdown([["error", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].name).toBe("error");
    });

    it("preserves all-uppercase category labels as-is", () => {
      const bd = makeBreakdown([["WARNING", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].name).toBe("WARNING");
    });

    it("keeps distinct-case categories as separate series", () => {
      const bd = makeBreakdown([
        ["INFO", [3]],
        ["Info", [2]],
        ["info", [1]],
      ]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      const names = options.series.map((s: any) => s.name);
      expect(names).toEqual(["INFO", "Info", "info"]);
    });

    it("maps empty-string category to '(empty)' label", () => {
      const bd = makeBreakdown([["", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].name).toBe("(empty)");
    });

    it("does NOT map numeric 0 category to '(empty)' — 0 is a real value", () => {
      // zo_sql_breakdown = 0 (numeric) must render as "0", not "(empty)".
      // The old `category || "(empty)"` pattern incorrectly treated 0 as falsy.
      const bd = new Map<string, number[]>([[0 as any, [5]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].name).toBe("0");
    });

    it("assigns semantic color for known levels in light theme", () => {
      const bd = makeBreakdown([["error", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#EF5350");
    });

    it("assigns semantic color for known levels in dark theme", () => {
      const bd = makeBreakdown([["error", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, true);
      expect(options.series[0].itemStyle.color).toBe("#D95C5C");
    });

    it("assigns info color for known info level in light theme", () => {
      const bd = makeBreakdown([["info", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#1E88E5");
    });

    it("maps numeric severity 6 to info blue (OTEL severity → semantic)", () => {
      const bd = makeBreakdown([["6", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#1E88E5");
    });

    it("maps numeric severity 3 to error red", () => {
      const bd = makeBreakdown([["3", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#EF5350");
    });

    it("maps numeric severity 0 to info blue (OTEL UNSPECIFIED)", () => {
      const bd = makeBreakdown([["0", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#1E88E5");
    });

    it("falls back to palette for numeric string outside 0-7 range (e.g. HTTP 200)", () => {
      const bd = makeBreakdown([["200", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(["#aaa", "#bbb", "#ccc"]).toContain(options.series[0].itemStyle.color);
    });

    it("falls back to palette for boolean-like string 'true'", () => {
      const bd = makeBreakdown([["true", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(["#aaa", "#bbb", "#ccc"]).toContain(options.series[0].itemStyle.color);
    });

    it("falls back to palette for boolean-like string 'false'", () => {
      const bd = makeBreakdown([["false", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(["#aaa", "#bbb", "#ccc"]).toContain(options.series[0].itemStyle.color);
    });

    it("recognizes 'ok' as success green (newly added key)", () => {
      const bd = makeBreakdown([["ok", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#43A047");
    });

    it("recognizes 'emergency' as fatal red (newly added key)", () => {
      const bd = makeBreakdown([["emergency", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.series[0].itemStyle.color).toBe("#E53935");
    });

    it("falls back to palette hash for unknown category labels", () => {
      const bd = makeBreakdown([["unknownXYZ", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      // Should be one of the mocked palette colors, not undefined
      expect(["#aaa", "#bbb", "#ccc"]).toContain(options.series[0].itemStyle.color);
    });

    it("falls back to dark palette for unknown labels in dark theme", () => {
      const bd = makeBreakdown([["unknownXYZ", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, true);
      expect(["#111", "#222", "#333"]).toContain(options.series[0].itemStyle.color);
    });

    it("passes UTC timestamps through unchanged", () => {
      const bd = makeBreakdown([["info", [5, 10]]]);
      const { options } = convertStackedLogData([ts1, ts2], bd, baseParams, false);
      expect(options.series[0].data[0][0]).toBe(ts1);
      expect(options.series[0].data[1][0]).toBe(ts2);
    });

    it("converts timestamps via toZonedTime for non-UTC timezone", () => {
      const params = { ...baseParams, timezone: "America/New_York" };
      const bd = makeBreakdown([["info", [5]]]);
      const { options } = convertStackedLogData([ts1], bd, params, false);
      // toZonedTime shifts the value — must differ from raw ts
      expect(options.series[0].data[0][0]).not.toBe(ts1);
      // But the count stays the same
      expect(options.series[0].data[0][1]).toBe(5);
    });

    it("uses 0 for missing count values (sparse data)", () => {
      // Series has fewer values than xData length
      const bd = new Map([["warn", [10]]]);
      const { options } = convertStackedLogData([ts1, ts2], bd, baseParams, false);
      expect(options.series[0].data[1][1]).toBe(0);
    });

    it("shows legend at the bottom", () => {
      const bd = makeBreakdown([["info", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.legend.show).toBe(true);
      expect(options.legend.bottom).toBe(0);
    });

    it("sets grid bottom to 20 to accommodate legend", () => {
      const bd = makeBreakdown([["info", [1]]]);
      const { options } = convertStackedLogData([ts1], bd, baseParams, false);
      expect(options.grid.bottom).toBe("20");
    });

    it("handles empty breakdownSeries Map", () => {
      const { options } = convertStackedLogData([ts1], new Map(), baseParams, false);
      expect(options.series).toHaveLength(0);
    });

    // Tooltip formatter tests
    describe("tooltip formatter", () => {
      const getFormatter = (isDark = false) => {
        const bd = makeBreakdown([["error", [10]], ["info", [5]]]);
        const { options } = convertStackedLogData([ts1], bd, baseParams, isDark);
        return options.tooltip.formatter;
      };

      it("returns empty string for empty params array", () => {
        const formatter = getFormatter();
        expect(formatter([])).toBe("");
        expect(formatter(null)).toBe("");
      });

      it("escapes HTML in axisValueLabel to prevent XSS", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "<script>alert(1)</script>", marker: "●", seriesName: "Info", value: [ts1, 5] },
        ]);
        expect(result).not.toContain("<script>");
        expect(result).toContain("&lt;script&gt;");
      });

      it("escapes HTML in seriesName to prevent XSS", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: "●", seriesName: "<b>Evil</b>", value: [ts1, 5] },
        ]);
        expect(result).not.toContain("<b>Evil</b>");
        expect(result).toContain("&lt;b&gt;Evil&lt;/b&gt;");
      });

      it("escapes ampersands in series names", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: "●", seriesName: "Errors & Warnings", value: [ts1, 10] },
        ]);
        expect(result).toContain("Errors &amp; Warnings");
      });

      it("renders p.marker HTML unescaped (ECharts-trusted content)", () => {
        const markerHtml = '<span style="color:#EF5350">●</span>';
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: markerHtml, seriesName: "Error", value: [ts1, 5] },
        ]);
        // marker is ECharts-generated HTML — must appear verbatim, not escaped
        expect(result).toContain(markerHtml);
      });

      it("formats counts using formatCount (1500 → 1.5k)", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: "●", seriesName: "Error", value: [ts1, 1500] },
        ]);
        expect(result).toContain("1.5k");
        expect(result).not.toContain("1500");
      });

      it("formats counts over 1M using M suffix", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: "●", seriesName: "Info", value: [ts1, 2_500_000] },
        ]);
        expect(result).toContain("2.5M");
      });

      it("uses dark tooltip background in dark theme", () => {
        const bd = makeBreakdown([["info", [1]]]);
        const { options } = convertStackedLogData([ts1], bd, baseParams, true);
        expect(options.tooltip.backgroundColor).toBe("#1e1e2e");
      });

      it("uses white tooltip background in light theme", () => {
        const bd = makeBreakdown([["info", [1]]]);
        const { options } = convertStackedLogData([ts1], bd, baseParams, false);
        expect(options.tooltip.backgroundColor).toBe("#ffffff");
      });

      it("uses no inline event handlers and no injected style blocks", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "Jan 1", marker: "●", seriesName: "Info", value: [ts1, 5] },
        ]);
        // Hover effect was removed to avoid repeated <style> injection and CSP violations
        expect(result).not.toContain("onmouseenter");
        expect(result).not.toContain("onmouseleave");
        expect(result).not.toContain("<style>");
      });

      it("contains the timestamp header in the tooltip", () => {
        const formatter = getFormatter();
        const result = formatter([
          { axisValueLabel: "2022-01-01", marker: "●", seriesName: "Info", value: [ts1, 5] },
        ]);
        expect(result).toContain("2022-01-01");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // formatDate
  // ---------------------------------------------------------------------------
  describe("formatDate", () => {
    it("formats date correctly", () => {
      expect(formatDate(new Date("2022-01-01T10:30:45"))).toBe("2022-01-01 10:30:45");
    });

    it("pads single-digit values with zeros", () => {
      expect(formatDate(new Date(2022, 2, 5, 9, 7, 8))).toBe("2022-03-05 09:07:08");
    });

    it("handles January (month 0)", () => {
      expect(formatDate(new Date(2022, 0, 15, 14, 25, 30))).toBe("2022-01-15 14:25:30");
    });

    it("handles December (month 11)", () => {
      expect(formatDate(new Date(2022, 11, 25, 23, 59, 59))).toBe("2022-12-25 23:59:59");
    });

    it("handles midnight", () => {
      expect(formatDate(new Date(2022, 5, 15, 0, 0, 0))).toBe("2022-06-15 00:00:00");
    });

    it("handles leap-year date", () => {
      expect(formatDate(new Date(2020, 1, 29, 12, 0, 0))).toBe("2020-02-29 12:00:00");
    });

    it("handles year boundaries", () => {
      expect(formatDate(new Date(2021, 11, 31, 23, 59, 59))).toBe("2021-12-31 23:59:59");
      expect(formatDate(new Date(2022, 0, 1, 0, 0, 0))).toBe("2022-01-01 00:00:00");
    });

    it("handles all months correctly", () => {
      const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];
      months.forEach((m, i) => {
        expect(formatDate(new Date(2022, i, 1, 0, 0, 0))).toContain(`2022-${m}-01`);
      });
    });

    it("handles future dates", () => {
      expect(formatDate(new Date(2030, 11, 25, 15, 30, 45))).toBe("2030-12-25 15:30:45");
    });
  });
});
