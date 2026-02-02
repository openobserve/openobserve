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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convertLogData, formatDate } from "./convertLogData";

describe("convertLogData.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock getComputedStyle to return the expected theme color
    Object.defineProperty(window, 'getComputedStyle', {
      value: () => ({
        getPropertyValue: (prop: string) => {
          if (prop === '--o2-theme-color') {
            return '#7A80C2';
          }
          return '';
        }
      }),
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("convertLogData Function", () => {
    it("should return basic chart options structure", () => {
      const x = [1640995200000, 1640998800000]; // Jan 1, 2022 timestamps
      const y = [10, 20];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result).toHaveProperty("options");
      expect(result.options).toHaveProperty("title");
      expect(result.options).toHaveProperty("backgroundColor");
      expect(result.options).toHaveProperty("grid");
      expect(result.options).toHaveProperty("tooltip");
      expect(result.options).toHaveProperty("xAxis");
      expect(result.options).toHaveProperty("yAxis");
      expect(result.options).toHaveProperty("toolbox");
      expect(result.options).toHaveProperty("series");
    });

    it("should configure title correctly", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.title).toEqual({
        left: "center",
        textStyle: {
          fontSize: 12,
          fontWeight: "normal",
        },
      });
    });

    it("should set backgroundColor to transparent", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.backgroundColor).toBe("transparent");
    });

    it("should configure grid layout properly", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.grid).toEqual({
        containLabel: true,
        left: "20",
        right: "20",
        top: "5",
        bottom: "0",
      });
    });

    it("should configure tooltip correctly", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.tooltip.show).toBe(true);
      expect(result.options.tooltip.trigger).toBe("axis");
      expect(result.options.tooltip.textStyle.fontSize).toBe(12);
      expect(result.options.tooltip.axisPointer.type).toBe("cross");
      expect(result.options.tooltip.axisPointer.label.show).toBe(true);
      expect(result.options.tooltip.axisPointer.label.fontsize).toBe(12);
    });

    it("should configure xAxis as time type", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.xAxis.type).toBe("time");
    });

    it("should configure yAxis with correct properties", () => {
      const x = [1640995200000];
      const y = [10, 20, 5];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.yAxis.type).toBe("value");
      expect(result.options.yAxis.axisLine.show).toBe(true);
      expect(result.options.yAxis.axisPointer.label.precision).toBe(0);
      expect(result.options.yAxis.interval).toBe(10); // Math.max(...y) / 2 = 20 / 2 = 10
    });

    it("should calculate yAxis interval correctly with different values", () => {
      const x = [1640995200000];
      const y = [5, 15, 25, 35];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.yAxis.interval).toBe(17.5); // Math.max(...y) / 2 = 35 / 2 = 17.5
    });

    it("should have yAxis formatter that rounds values", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.yAxis.axisLabel.formatter(10.7)).toBe(11);
      expect(result.options.yAxis.axisLabel.formatter(10.3)).toBe(10);
      expect(result.options.yAxis.axisLabel.formatter(0)).toBe(0);
    });

    it("should configure toolbox correctly", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.toolbox).toEqual({
        orient: "vertical",
        show: true,
        showTitle: false,
        tooltip: {
          show: false,
        },
        itemSize: 0,
        itemGap: 0,
        bottom: "100%",
        feature: {
          dataZoom: {
            show: true,
            yAxisIndex: "none",
          },
        },
      });
    });

    it("should map x and y data correctly to series for UTC timezone", () => {
      const x = [1640995200000, 1640998800000]; // Jan 1, 2022 timestamps
      const y = [10, 20];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].data).toEqual([
        [1640995200000, 10],
        [1640998800000, 20],
      ]);
    });

    it("should handle non-UTC timezone with date conversion", () => {
      const x = [1640995200000]; // Jan 1, 2022 00:00:00 UTC
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "America/New_York" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toHaveLength(1);
      // The timestamp should be converted to the specified timezone
      expect(result.options.series[0].data[0][1]).toBe(10);
    });

    it("should configure series styling correctly", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].type).toBe("bar");
      expect(result.options.series[0].emphasis).toEqual({ focus: "series" });
      expect(result.options.series[0].itemStyle.color).toBe("#7A80C2");
    });

    it("should handle empty x array", () => {
      const x: any[] = [];
      const y: any[] = [];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([]);
    });

    it("should handle mismatched x and y arrays", () => {
      const x = [1640995200000, 1640998800000, 1641002400000];
      const y = [10, 20]; // y has fewer elements
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, 10],
        [1640998800000, 20],
        [1641002400000, 0], // Missing y value defaults to 0
      ]);
    });

    it("should handle x array longer than y array", () => {
      const x = [1640995200000, 1640998800000];
      const y = [10]; // y has fewer elements
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, 10],
        [1640998800000, 0], // Missing y value defaults to 0
      ]);
    });

    it("should handle y array with zero values", () => {
      const x = [1640995200000, 1640998800000];
      const y = [0, 0];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, 0],
        [1640998800000, 0],
      ]);
      expect(result.options.yAxis.interval).toBe(0); // Math.max(...y) / 2 = 0 / 2 = 0
    });

    it("should handle negative y values", () => {
      const x = [1640995200000, 1640998800000];
      const y = [-10, -5];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, -10],
        [1640998800000, -5],
      ]);
      expect(result.options.yAxis.interval).toBe(-2.5); // Math.max(...y) / 2 = -5 / 2 = -2.5
    });

    it("should handle mixed positive and negative y values", () => {
      const x = [1640995200000, 1640998800000, 1641002400000];
      const y = [-10, 0, 20];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, -10],
        [1640998800000, 0],
        [1641002400000, 20],
      ]);
      expect(result.options.yAxis.interval).toBe(10); // Math.max(...y) / 2 = 20 / 2 = 10
    });

    it("should handle single data point", () => {
      const x = [1640995200000];
      const y = [42];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([[1640995200000, 42]]);
      expect(result.options.yAxis.interval).toBe(21); // Math.max(...y) / 2 = 42 / 2 = 21
    });

    it("should handle different timezone formats", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "Europe/London" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toHaveLength(1);
      expect(result.options.series[0].data[0][1]).toBe(10);
    });

    it("should handle large numbers in y values", () => {
      const x = [1640995200000];
      const y = [1000000];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([[1640995200000, 1000000]]);
      expect(result.options.yAxis.interval).toBe(500000); // Math.max(...y) / 2 = 1000000 / 2 = 500000
    });

    it("should handle decimal values in y", () => {
      const x = [1640995200000, 1640998800000];
      const y = [10.5, 20.7];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.series[0].data).toEqual([
        [1640995200000, 10.5],
        [1640998800000, 20.7],
      ]);
      expect(result.options.yAxis.interval).toBe(10.35); // Math.max(...y) / 2 = 20.7 / 2 = 10.35
    });

    it("should handle params with different timezone settings", () => {
      const x = [1640995200000];
      const y = [10];
      const params1 = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };
      const params2 = { title: "Test Chart", unparsed_x_data: [], timezone: "Asia/Tokyo" };

      const result1 = convertLogData(x, y, params1);
      const result2 = convertLogData(x, y, params2);

      // Both should have valid series data but potentially different timestamps
      expect(result1.options.series[0].data).toHaveLength(1);
      expect(result2.options.series[0].data).toHaveLength(1);
      expect(result1.options.series[0].data[0][1]).toBe(10);
      expect(result2.options.series[0].data[0][1]).toBe(10);
    });

    it("should handle tooltip formatter_test function", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);

      expect(result.options.tooltip).toHaveProperty("formatter_test");
      expect(typeof result.options.tooltip.formatter_test).toBe("function");
    });

    it("should return empty string from formatter_test when name length is 0", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);
      const formatterResult = result.options.tooltip.formatter_test([]);

      expect(formatterResult).toBe("");
    });

    it("should format tooltip correctly with valid data", () => {
      const x = [1640995200000];
      const y = [10];
      const params = { title: "Test Chart", unparsed_x_data: [], timezone: "UTC" };

      const result = convertLogData(x, y, params);
      const mockData = [{ data: [1640995200000], value: [1640995200000, 10] }];
      const formatterResult = result.options.tooltip.formatter_test(mockData);

      expect(formatterResult).toContain("UTC");
      expect(formatterResult).toContain("<b>10</b>");
    });
  });

  describe("formatDate Function", () => {
    it("should format date correctly with basic date", () => {
      const date = new Date("2022-01-01T10:30:45");
      const result = formatDate(date);

      expect(result).toBe("2022-01-01 10:30:45");
    });

    it("should pad single digits with zeros", () => {
      const date = new Date("2022-03-05T09:07:08");
      const result = formatDate(date);

      expect(result).toBe("2022-03-05 09:07:08");
    });

    it("should handle January (month 0)", () => {
      const date = new Date(2022, 0, 15, 14, 25, 30); // January is month 0
      const result = formatDate(date);

      expect(result).toBe("2022-01-15 14:25:30");
    });

    it("should handle December (month 11)", () => {
      const date = new Date(2022, 11, 25, 23, 59, 59); // December is month 11
      const result = formatDate(date);

      expect(result).toBe("2022-12-25 23:59:59");
    });

    it("should handle leap year date", () => {
      const date = new Date(2020, 1, 29, 12, 0, 0); // Feb 29, 2020 (leap year)
      const result = formatDate(date);

      expect(result).toBe("2020-02-29 12:00:00");
    });

    it("should handle midnight time", () => {
      const date = new Date(2022, 5, 15, 0, 0, 0);
      const result = formatDate(date);

      expect(result).toBe("2022-06-15 00:00:00");
    });

    it("should handle noon time", () => {
      const date = new Date(2022, 5, 15, 12, 0, 0);
      const result = formatDate(date);

      expect(result).toBe("2022-06-15 12:00:00");
    });

    it("should handle end of day time", () => {
      const date = new Date(2022, 5, 15, 23, 59, 59);
      const result = formatDate(date);

      expect(result).toBe("2022-06-15 23:59:59");
    });

    it("should handle year boundaries", () => {
      const dateEndOfYear = new Date(2021, 11, 31, 23, 59, 59);
      const dateStartOfYear = new Date(2022, 0, 1, 0, 0, 0);

      expect(formatDate(dateEndOfYear)).toBe("2021-12-31 23:59:59");
      expect(formatDate(dateStartOfYear)).toBe("2022-01-01 00:00:00");
    });

    it("should handle single digit values correctly", () => {
      const date = new Date(2022, 0, 1, 1, 1, 1); // All single digits
      const result = formatDate(date);

      expect(result).toBe("2022-01-01 01:01:01");
    });

    it("should handle timestamp input", () => {
      const timestamp = 1640995200000; // Jan 1, 2022 00:00:00 UTC
      const date = new Date(timestamp);
      const result = formatDate(date);

      expect(result).toMatch(/2022-01-01 \d{2}:\d{2}:\d{2}/);
    });

    it("should handle future dates", () => {
      const date = new Date(2030, 11, 25, 15, 30, 45);
      const result = formatDate(date);

      expect(result).toBe("2030-12-25 15:30:45");
    });

    it("should handle past dates", () => {
      const date = new Date(1990, 5, 15, 10, 20, 30);
      const result = formatDate(date);

      expect(result).toBe("1990-06-15 10:20:30");
    });

    it("should handle different months correctly", () => {
      const dates = [
        new Date(2022, 0, 1), // January
        new Date(2022, 1, 1), // February
        new Date(2022, 2, 1), // March
        new Date(2022, 9, 1), // October
        new Date(2022, 10, 1), // November
        new Date(2022, 11, 1), // December
      ];

      const results = dates.map(formatDate);

      expect(results[0]).toContain("2022-01-01");
      expect(results[1]).toContain("2022-02-01");
      expect(results[2]).toContain("2022-03-01");
      expect(results[3]).toContain("2022-10-01");
      expect(results[4]).toContain("2022-11-01");
      expect(results[5]).toContain("2022-12-01");
    });

    it("should maintain consistency across different date objects with same values", () => {
      const date1 = new Date(2022, 5, 15, 12, 30, 45);
      const date2 = new Date("2022-06-15T12:30:45");

      const result1 = formatDate(date1);
      const result2 = formatDate(date2);

      expect(result1).toMatch(/2022-06-15 12:30:45/);
    });
  });
});