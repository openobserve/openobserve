// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import {
  generateHistogramTitle,
  generateFilterExpressionByFieldType,
  formatFieldValue,
  formatList,
  formatNumber,
  truncateText,
  escapeText,
  type HistogramTitleParams,
  type FilterExpressionParams
} from "@/utils/logs/formatters";

// Mock formatSizeFromMB
vi.mock("@/utils/zincutils", () => ({
  formatSizeFromMB: vi.fn((size: number) => `${size} MB`),
}));

describe("Formatters Utilities", () => {
  describe("generateHistogramTitle", () => {
    const baseParams: HistogramTitleParams = {
      currentPage: 1,
      rowsPerPage: 50,
      totalCount: 1000,
      hitsLength: 1000,
      showPagination: true,
      communicationMethod: "http",
      jobId: "",
      paginationLength: 20,
      partitionPaginationLength: 20,
      sqlMode: false,
      aggregationTotal: 0,
      hasAggregation: false,
      partitionCount: 1,
      showHistogram: true,
      took: 45,
      scanSize: 2.5,
    };

    it("should generate basic histogram title", () => {
      const result = generateHistogramTitle(baseParams);
      
      expect(result).toBe("Showing 1 to 50 out of 1,000 events in 45 ms. (Scan Size: 2.5 MB)");
    });

    it("should handle pagination correctly", () => {
      const params = { ...baseParams, currentPage: 2 };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 51 to 100 out of 1,000 events in 45 ms. (Scan Size: 2.5 MB)");
    });

    it("should show plus sign for multiple partitions", () => {
      const params = {
        ...baseParams,
        partitionCount: 5,
        showHistogram: false,
        hitsLength: 50,
        totalCount: 1000
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 1 to 50 out of 1,000+ events in 45 ms. (Scan Size: 2.5 MB+)");
    });

    it("should handle WebSocket communication method", () => {
      const params = {
        ...baseParams,
        communicationMethod: "ws",
        showHistogram: false,
        hitsLength: 50,
        totalCount: 1000
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 1 to 50 out of 1,000+ events in 45 ms. (Scan Size: 2.5 MB+)");
    });

    it("should handle no pagination mode", () => {
      const params = {
        ...baseParams,
        showPagination: false,
        hitsLength: 150
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 1 to 150 out of 150 events in 45 ms. (Scan Size: 2.5 MB)");
    });

    it("should handle SQL mode with aggregation", () => {
      const params = {
        ...baseParams,
        sqlMode: true,
        hasAggregation: true,
        aggregationTotal: 2500
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 1 to 50 out of 2,500 events in 45 ms. (Scan Size: 2.5 MB)");
    });

    it("should handle result cache ratio", () => {
      const params = {
        ...baseParams,
        resultCacheRatio: 0.8
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toBe("Showing 1 to 50 out of 1,000 events in 45 ms. (Delta Scan Size: 2.5 MB)");
    });

    it("should handle invalid numbers gracefully", () => {
      const params = {
        ...baseParams,
        totalCount: NaN,
        rowsPerPage: NaN
      };
      const result = generateHistogramTitle(params);
      
      expect(result).toContain("out of 0 events");
    });

    it("should handle errors gracefully", () => {
      const invalidParams = null as any;
      const result = generateHistogramTitle(invalidParams);
      
      expect(result).toBe("");
    });
  });

  describe("generateFilterExpressionByFieldType", () => {
    const baseParams: FilterExpressionParams = {
      field: "status",
      fieldValue: "error",
      action: "include",
      streamResults: [
        {
          name: "logs",
          schema: [
            { name: "status", type: "utf8" },
            { name: "count", type: "int64" },
            { name: "active", type: "boolean" }
          ]
        }
      ],
      selectedStreams: ["logs"]
    };

    it("should generate basic string filter expression", () => {
      const result = generateFilterExpressionByFieldType(baseParams);
      
      expect(result).toBe("status = 'error'");
    });

    it("should generate exclude filter expression", () => {
      const params = { ...baseParams, action: "exclude" };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("status != 'error'");
    });

    it("should handle numeric field types", () => {
      const params = {
        ...baseParams,
        field: "count",
        fieldValue: 100
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("count = 100");
    });

    it("should handle boolean field types", () => {
      const params = {
        ...baseParams,
        field: "active",
        fieldValue: true,
        action: "include"
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("active is true");
    });

    it("should handle null values", () => {
      const params = {
        ...baseParams,
        fieldValue: null
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("status is null");
    });

    it("should handle empty string values", () => {
      const params = {
        ...baseParams,
        fieldValue: ""
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("status is null");
    });

    it("should handle unknown field types", () => {
      const params = {
        ...baseParams,
        field: "unknown_field"
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("unknown_field = 'error'");
    });

    it("should handle streams without schema", () => {
      const params = {
        ...baseParams,
        streamResults: [{ name: "logs" }]
      };
      const result = generateFilterExpressionByFieldType(params);
      
      expect(result).toBe("status = 'error'");
    });

    it("should handle errors gracefully", () => {
      const invalidParams = { ...baseParams, streamResults: null } as any;
      const result = generateFilterExpressionByFieldType(invalidParams);
      
      expect(result).toBe("status = 'error'");
    });
  });

  describe("formatFieldValue", () => {
    it("should format null and undefined values", () => {
      expect(formatFieldValue(null)).toBe("null");
      expect(formatFieldValue(undefined)).toBe("null");
    });

    it("should format string values", () => {
      expect(formatFieldValue("hello")).toBe("hello");
      expect(formatFieldValue("")).toBe("");
    });

    it("should format numeric values", () => {
      expect(formatFieldValue(123)).toBe("123");
      expect(formatFieldValue(123.45)).toBe("123.45");
    });

    it("should format numeric values with type info", () => {
      expect(formatFieldValue(1234, "int64")).toBe("1,234");
      expect(formatFieldValue(1234.56, "float64")).toBe("1,234.56");
    });

    it("should format boolean values", () => {
      expect(formatFieldValue(true)).toBe("true");
      expect(formatFieldValue(false)).toBe("false");
    });

    it("should format object values", () => {
      const obj = { name: "test", value: 123 };
      const result = formatFieldValue(obj);
      expect(result).toContain("\"name\": \"test\"");
      expect(result).toContain("\"value\": 123");
    });

    it("should handle circular references in objects", () => {
      const obj: any = { name: "test" };
      obj.circular = obj;
      
      const result = formatFieldValue(obj);
      expect(result).toBe("[Object]");
    });

    it("should format other types as strings", () => {
      expect(formatFieldValue(Symbol("test"))).toContain("Symbol(test)");
    });
  });

  describe("formatList", () => {
    it("should format simple lists", () => {
      expect(formatList(["a", "b", "c"])).toBe("a, b, c");
    });

    it("should handle empty arrays", () => {
      expect(formatList([])).toBe("");
    });

    it("should handle non-array input", () => {
      expect(formatList(null as any)).toBe("");
      expect(formatList(undefined as any)).toBe("");
    });

    it("should truncate long lists", () => {
      const items = ["a", "b", "c", "d", "e", "f", "g"];
      const result = formatList(items, ", ", 3);
      
      expect(result).toBe("a, b, c... (and 4 more)");
    });

    it("should use custom separator", () => {
      expect(formatList(["a", "b", "c"], " | ")).toBe("a | b | c");
    });

    it("should handle lists at maxItems limit", () => {
      const items = ["a", "b", "c", "d", "e"];
      const result = formatList(items, ", ", 5);
      
      expect(result).toBe("a, b, c, d, e");
    });
  });

  describe("formatNumber", () => {
    it("should format numbers with units", () => {
      expect(formatNumber(1500)).toBe("1.5K");
      expect(formatNumber(2500000)).toBe("2.5M");
      expect(formatNumber(3500000000)).toBe("3.5B");
    });

    it("should format small numbers without units", () => {
      expect(formatNumber(500)).toBe("500");
      expect(formatNumber(99)).toBe("99");
    });

    it("should handle negative numbers", () => {
      expect(formatNumber(-1500)).toBe("-1.5K");
      expect(formatNumber(-2500000)).toBe("-2.5M");
    });

    it("should handle zero and invalid numbers", () => {
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(NaN)).toBe("0");
      expect(formatNumber(null as any)).toBe("0");
      expect(formatNumber(undefined as any)).toBe("0");
    });

    it("should respect precision parameter", () => {
      expect(formatNumber(1234, 2)).toBe("1.23K");
      expect(formatNumber(1234, 0)).toBe("1K");
    });
  });

  describe("truncateText", () => {
    it("should truncate long text", () => {
      expect(truncateText("This is a very long text", 10)).toBe("This is...");
    });

    it("should not truncate short text", () => {
      expect(truncateText("Short", 10)).toBe("Short");
    });

    it("should handle custom suffix", () => {
      expect(truncateText("Long text here", 8, "...")).toBe("Long ...");
    });

    it("should handle non-string input", () => {
      expect(truncateText(123 as any, 5)).toBe("123");
      expect(truncateText(null as any, 5)).toBe("null");
    });

    it("should handle edge cases", () => {
      expect(truncateText("", 5)).toBe("");
      expect(truncateText("abc", 3)).toBe("abc");
      expect(truncateText("abc", 2)).toBe("...");
    });
  });

  describe("escapeText", () => {
    it("should escape HTML characters", () => {
      expect(escapeText("<div>")).toBe("&lt;div&gt;");
      expect(escapeText("A & B")).toBe("A &amp; B");
    });

    it("should escape quotes", () => {
      expect(escapeText('Say "hello"')).toBe("Say &quot;hello&quot;");
      expect(escapeText("It's working")).toBe("It&#39;s working");
    });

    it("should escape multiple characters", () => {
      const input = `<script>alert('xss & "test"')</script>`;
      const expected = "&lt;script&gt;alert(&#39;xss &amp; &quot;test&quot;&#39;)&lt;/script&gt;";
      
      expect(escapeText(input)).toBe(expected);
    });

    it("should handle non-string input", () => {
      expect(escapeText(123 as any)).toBe("123");
      expect(escapeText(null as any)).toBe("null");
      expect(escapeText(undefined as any)).toBe("undefined");
    });

    it("should handle empty string", () => {
      expect(escapeText("")).toBe("");
    });
  });
});