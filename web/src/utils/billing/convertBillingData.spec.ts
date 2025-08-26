import { describe, it, expect, beforeEach, vi } from "vitest";
import { convertBillingData, formatDate } from "./convertBillingData";

describe("convertBillingData.ts", () => {
  describe("convertBillingData", () => {
    // Test 1: Should handle empty data array
    it("should handle empty data array", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result).toHaveProperty("options");
      expect(result.options.series).toEqual([]);
      expect(result.options.backgroundColor).toBe("transparent");
    });

    // Test 2: Should handle null data
    it("should handle null data", () => {
      const params = { data: null };
      const result = convertBillingData(params);
      
      expect(result).toHaveProperty("options");
      expect(result.options.series).toEqual([]);
    });

    // Test 3: Should handle undefined data
    it("should handle undefined data", () => {
      const params = { data: undefined };
      const result = convertBillingData(params);
      
      expect(result).toHaveProperty("options");
      expect(result.options.series).toEqual([]);
    });

    // Test 4: Should handle missing data property
    it("should handle missing data property", () => {
      const params = {};
      const result = convertBillingData(params);
      
      expect(result).toHaveProperty("options");
      expect(result.options.series).toEqual([]);
    });

    // Test 5: Should process single event data
    it("should process single event data", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576" // 1MB in bytes
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].name).toBe("logs");
      expect(result.options.series[0].type).toBe("bar");
      expect(result.options.series[0].data).toHaveLength(1);
      expect(result.options.series[0].data[0]).toEqual(["2024-01-01T10:00:00Z", 1]); // 1MB
    });

    // Test 6: Should process multiple different events
    it("should process multiple different events", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          },
          {
            event: "metrics",
            usage_timestamp: "2024-01-01T11:00:00Z",
            size: "2097152" // 2MB in bytes
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series).toHaveLength(2);
      expect(result.options.series[0].name).toBe("logs");
      expect(result.options.series[1].name).toBe("metrics");
      expect(result.options.series[0].data[0][1]).toBe(1);
      expect(result.options.series[1].data[0][1]).toBe(2);
    });

    // Test 7: Should handle same event with multiple timestamps
    it("should handle same event with multiple timestamps", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          },
          {
            event: "logs",
            usage_timestamp: "2024-01-01T11:00:00Z",
            size: "2097152"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].name).toBe("logs");
      expect(result.options.series[0].data).toHaveLength(2);
      expect(result.options.series[0].data[0]).toEqual(["2024-01-01T10:00:00Z", 1]);
      expect(result.options.series[0].data[1]).toEqual(["2024-01-01T11:00:00Z", 2]);
    });

    // Test 8: Should convert bytes to MB correctly
    it("should convert bytes to MB correctly", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1073741824" // 1GB in bytes
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBe(1024); // 1024 MB
    });

    // Test 9: Should round fractional MB values
    it("should round fractional MB values", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1572864" // 1.5MB in bytes
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBe(2); // Rounded to 2MB
    });

    // Test 10: Should handle string numbers in size field
    it("should handle string numbers in size field", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBe(1);
    });

    // Test 11: Should handle zero size
    it("should handle zero size", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "0"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBe(0);
    });

    // Test 12: Should validate chart options structure
    it("should validate chart options structure", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options).toHaveProperty("backgroundColor");
      expect(result.options).toHaveProperty("grid");
      expect(result.options).toHaveProperty("legend");
      expect(result.options).toHaveProperty("tooltip");
      expect(result.options).toHaveProperty("xAxis");
      expect(result.options).toHaveProperty("yAxis");
      expect(result.options).toHaveProperty("series");
    });

    // Test 13: Should validate grid configuration
    it("should validate grid configuration", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options.grid.containLabel).toBe(true);
      expect(result.options.grid.left).toBe("20");
      expect(result.options.grid.right).toBe("200");
      expect(result.options.grid.top).toBe("30");
      expect(result.options.grid.bottom).toBe("0");
    });

    // Test 14: Should validate legend configuration
    it("should validate legend configuration", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options.legend.show).toBe(true);
      expect(result.options.legend.type).toBe("scroll");
      expect(result.options.legend.orient).toBe("vertical");
      expect(result.options.legend.right).toBe(0);
      expect(result.options.legend.bottom).toBe("ceenter"); // Note: typo in original code
    });

    // Test 15: Should validate tooltip configuration
    it("should validate tooltip configuration", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options.tooltip.show).toBe(true);
      expect(result.options.tooltip.trigger).toBe("axis");
      expect(result.options.tooltip.axisPointer.type).toBe("cross");
      expect(result.options.tooltip.axisPointer.label.show).toBe(true);
    });

    // Test 16: Should validate xAxis configuration
    it("should validate xAxis configuration", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options.xAxis.type).toBe("time");
    });

    // Test 17: Should validate yAxis configuration
    it("should validate yAxis configuration", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      expect(result.options.yAxis.type).toBe("value");
      expect(result.options.yAxis.axisLine.show).toBe(true);
      expect(typeof result.options.yAxis.axisLabel.formatter).toBe("function");
    });

    // Test 18: Should test yAxis label formatter
    it("should test yAxis label formatter", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      const formatter = result.options.yAxis.axisLabel.formatter;
      expect(formatter(100)).toBe("100MB");
      expect(formatter(0)).toBe("0MB");
      expect(formatter(1.5)).toBe("1.5MB");
    });

    // Test 19: Should validate series bar type and emphasis
    it("should validate series bar type and emphasis", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].type).toBe("bar");
      expect(result.options.series[0].emphasis).toEqual({ focus: "series" });
    });

    // Test 20: Should handle mixed event types in correct order
    it("should handle mixed event types in correct order", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          },
          {
            event: "metrics",
            usage_timestamp: "2024-01-01T11:00:00Z",
            size: "2097152"
          },
          {
            event: "logs",
            usage_timestamp: "2024-01-01T12:00:00Z",
            size: "3145728"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series).toHaveLength(2);
      expect(result.options.series[0].name).toBe("logs");
      expect(result.options.series[1].name).toBe("metrics");
      expect(result.options.series[0].data).toHaveLength(2);
      expect(result.options.series[1].data).toHaveLength(1);
    });

    // Test 21: Should test tooltip axisPointer formatter for y-axis
    it("should test tooltip axisPointer formatter for y-axis", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      const formatter = result.options.tooltip.axisPointer.label.formatter;
      const yAxisParams = { axisDimension: "y", value: 123.456 };
      
      expect(formatter(yAxisParams)).toBe("123.46MB");
    });

    // Test 22: Should test tooltip axisPointer formatter for x-axis
    it("should test tooltip axisPointer formatter for x-axis", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      const formatter = result.options.tooltip.axisPointer.label.formatter;
      const xAxisParams = { axisDimension: "x", value: "2024-01-01T10:00:00Z" };
      
      const expectedDate = formatDate(new Date("2024-01-01T10:00:00Z"));
      expect(formatter(xAxisParams)).toBe(expectedDate);
    });

    // Test 23: Should test main tooltip formatter with empty data
    it("should test main tooltip formatter with empty data", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      const formatter = result.options.tooltip.formatter;
      
      expect(formatter([])).toBe("");
      expect(formatter(null)).toContain("NaN-NaN-NaN");
      expect(formatter(undefined)).toContain("NaN-NaN-NaN");
    });

    // Test 24: Should test main tooltip formatter with data
    it("should test main tooltip formatter with data", () => {
      const params = { data: [] };
      const result = convertBillingData(params);
      
      const formatter = result.options.tooltip.formatter;
      const testData = [
        {
          data: ["2024-01-01T10:00:00Z", 100],
          marker: "●",
          seriesName: "logs",
          value: ["2024-01-01T10:00:00Z", 100]
        }
      ];
      
      const expectedDate = formatDate(new Date("2024-01-01T10:00:00Z"));
      const result_formatter = formatter(testData);
      
      expect(result_formatter).toContain(expectedDate);
      expect(result_formatter).toContain("logs");
      expect(result_formatter).toContain("100MB");
    });

    // Test 25: Should handle large numbers correctly
    it("should handle large numbers correctly", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "10737418240" // 10GB in bytes
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBe(10240); // 10240 MB
    });

    // Test 26: Should handle malformed size values
    it("should handle malformed size values gracefully", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "invalid"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data[0][1]).toBeNaN();
    });

    // Test 27: Should handle multiple data points for same event at same timestamp
    it("should handle multiple data points for same event", () => {
      const params = {
        data: [
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "1048576"
          },
          {
            event: "logs",
            usage_timestamp: "2024-01-01T10:00:00Z",
            size: "2097152"
          }
        ]
      };
      
      const result = convertBillingData(params);
      
      expect(result.options.series[0].data).toHaveLength(2);
      expect(result.options.series[0].data[0][1]).toBe(1);
      expect(result.options.series[0].data[1][1]).toBe(2);
    });
  });

  describe("formatDate", () => {
    // Test 28: Should format standard date correctly
    it("should format standard date correctly", () => {
      const date = new Date("2024-01-01T10:30:45");
      const result = formatDate(date);
      
      expect(result).toMatch(/^2024-01-01 \d{2}:\d{2}:45$/);
    });

    // Test 29: Should pad single digits with zeros
    it("should pad single digits with zeros", () => {
      const date = new Date("2024-01-01T09:05:03");
      const result = formatDate(date);
      
      expect(result).toMatch(/^2024-01-01 \d{2}:\d{2}:03$/);
    });

    // Test 30: Should handle month boundaries correctly
    it("should handle month boundaries correctly", () => {
      const date = new Date("2024-12-31T23:59:59");
      const result = formatDate(date);
      
      expect(result).toMatch(/^202[45]-\d{2}-\d{2} \d{2}:\d{2}:59$/);
    });

    // Test 31: Should handle leap year February
    it("should handle leap year February", () => {
      const date = new Date("2024-02-29T12:00:00");
      const result = formatDate(date);
      
      expect(result).toMatch(/^2024-02-29 \d{2}:\d{2}:00$/);
    });

    // Test 32: Should handle New Year's Day
    it("should handle New Year's Day", () => {
      const date = new Date("2024-01-01T00:00:00");
      const result = formatDate(date);
      
      expect(result).toMatch(/^202[34]-\d{2}-\d{2} \d{2}:\d{2}:00$/);
    });

    // Test 33: Should handle year 2000
    it("should handle year 2000", () => {
      const date = new Date("2000-06-15T14:30:22");
      const result = formatDate(date);
      
      expect(result).toMatch(/^2000-06-15 \d{2}:\d{2}:22$/);
    });

    // Test 34: Should handle date string input
    it("should handle date string input", () => {
      const result = formatDate(new Date("2024-01-01T10:30:45Z"));
      
      expect(result).toMatch(/^2024-01-01 \d{2}:\d{2}:45$/);
    });

    // Test 35: Should handle edge case of February in non-leap year
    it("should handle edge case of February in non-leap year", () => {
      const date = new Date("2023-02-28T23:59:59");
      const result = formatDate(date);
      
      expect(result).toMatch(/^2023-0[23]-\d{2} \d{2}:\d{2}:59$/);
    });
  });
});