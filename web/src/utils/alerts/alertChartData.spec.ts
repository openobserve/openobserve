import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getChartData } from "./alertChartData";

describe("alertChartData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create basic chart data with simple x and y arrays", () => {
    const x = [1640995200000, 1640998800000, 1641002400000]; // timestamps
    const y = [10, 20, 30];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    
    expect(result).toBeDefined();
    expect(result.options).toBeDefined();
    expect(result.options.series).toHaveLength(1);
    expect(result.options.series[0].data).toHaveLength(3);
  });

  it("should create chart options with correct structure", () => {
    const x = [1640995200000];
    const y = [10];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const options = result.options;
    
    // Verify main structure
    expect(options.title).toBeDefined();
    expect(options.backgroundColor).toBe("transparent");
    expect(options.grid).toBeDefined();
    expect(options.tooltip).toBeDefined();
    expect(options.xAxis).toBeDefined();
    expect(options.yAxis).toBeDefined();
    expect(options.toolbox).toBeDefined();
    expect(options.series).toBeDefined();
    
    // Verify xAxis configuration
    expect(options.xAxis.type).toBe("time");
    
    // Verify yAxis configuration
    expect(options.yAxis.type).toBe("value");
    expect(options.yAxis.axisLine.show).toBe(true);
  });

  it("should calculate correct yAxis interval based on max y value", () => {
    const x = [1640995200000, 1640998800000, 1641002400000];
    const y = [10, 50, 30]; // max value is 50
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const options = result.options;
    
    // yAxis interval should be Math.max(...y) / 2 = 50 / 2 = 25
    expect(options.yAxis.interval).toBe(25);
  });

  it("should format yAxis labels as rounded integers", () => {
    const x = [1640995200000];
    const y = [10];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const formatter = result.options.yAxis.axisLabel.formatter;
    
    // Test the formatter function
    expect(formatter(10.7)).toBe(11); // should round up
    expect(formatter(10.3)).toBe(10); // should round down
    expect(formatter(10.5)).toBe(11); // should round up at 0.5
    expect(formatter(10)).toBe(10); // should remain the same for integers
  });

  it("should handle UTC timezone in series data", () => {
    const x = [1640995200000, 1640998800000]; // timestamps
    const y = [10, 20];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    // For UTC timezone, timestamps should remain unchanged
    expect(seriesData[0][0]).toBe(1640995200000);
    expect(seriesData[0][1]).toBe(10);
    expect(seriesData[1][0]).toBe(1640998800000);
    expect(seriesData[1][1]).toBe(20);
  });

  it("should handle non-UTC timezone in series data using toZonedTime", () => {
    const x = [1640995200000]; // timestamp
    const y = [10];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "America/New_York"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    // For non-UTC timezone, toZonedTime should be called
    // The exact result depends on the date-fns-tz implementation
    // but we can verify it's a Date object and the y value is correct
    expect(seriesData[0][0]).toBeInstanceOf(Date);
    expect(seriesData[0][1]).toBe(10);
  });

  it("should handle missing y values by defaulting to 0", () => {
    const x = [1640995200000, 1640998800000, 1641002400000]; // 3 timestamps
    const y = [10, 20]; // only 2 values, third should default to 0
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    expect(seriesData).toHaveLength(3);
    expect(seriesData[0][1]).toBe(10); // first y value
    expect(seriesData[1][1]).toBe(20); // second y value
    expect(seriesData[2][1]).toBe(0);  // missing y value defaults to 0
  });

  it("should handle empty array in tooltip formatter", () => {
    const x = [1640995200000];
    const y = [10];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "America/New_York"
    };

    const result = getChartData(x, y, params);
    const formatter = result.options.tooltip.formatter_test;
    
    // Test with empty array
    expect(formatter([])).toBe("");
  });

  it("should format tooltip with valid data", () => {
    const x = [1640995200000]; // 2022-01-01 00:00:00 UTC
    const y = [10];
    const params = {
      title: "Test Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const formatter = result.options.tooltip.formatter_test;
    
    // Mock tooltip data structure
    const mockTooltipData = [
      {
        data: [1640995200000, 10],
        value: [1640995200000, 10]
      }
    ];
    
    const formatted = formatter(mockTooltipData);
    expect(formatted).toContain("UTC");
    expect(formatted).toContain("<b>10</b>");
    expect(formatted).toContain("(");
    expect(formatted).toContain(")");
  });

  it("should handle empty x and y arrays", () => {
    const x: any[] = [];
    const y: any[] = [];
    const params = {
      title: "Empty Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    expect(seriesData).toHaveLength(0);
    expect(result.options.yAxis.interval).toBe(-Infinity); // Math.max(...[]) returns -Infinity
  });

  it("should handle zero values in y array", () => {
    const x = [1640995200000, 1640998800000];
    const y = [0, 0];
    const params = {
      title: "Zero Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    expect(seriesData[0][1]).toBe(0);
    expect(seriesData[1][1]).toBe(0);
    expect(result.options.yAxis.interval).toBe(0); // Math.max(0, 0) / 2 = 0
  });

  it("should handle negative values in y array", () => {
    const x = [1640995200000, 1640998800000, 1641002400000];
    const y = [-10, -20, 5]; // max is 5
    const params = {
      title: "Negative Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    const seriesData = result.options.series[0].data;
    
    expect(seriesData[0][1]).toBe(-10);
    expect(seriesData[1][1]).toBe(-20);
    expect(seriesData[2][1]).toBe(5);
    expect(result.options.yAxis.interval).toBe(2.5); // Math.max(-10, -20, 5) / 2 = 5/2 = 2.5
  });

  it("should handle very large numbers", () => {
    const x = [1640995200000];
    const y = [1000000];
    const params = {
      title: "Large Numbers Chart",
      unparsed_x_data: x,
      timezone: "UTC"
    };

    const result = getChartData(x, y, params);
    
    expect(result.options.yAxis.interval).toBe(500000); // 1000000 / 2
    expect(result.options.series[0].data[0][1]).toBe(1000000);
  });
});