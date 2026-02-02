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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { useLogsHighlighter } from "@/composables/useLogsHighlighter";

// Mock store
const mockStore = {
  state: {
    theme: "light",
    zoConfig: {
      default_fts_keys: ["message", "content"],
    },
  },
};

// Mock searchState
const mockSearchState = {
  searchObj: {
    data: {
      queryType: "logs",
      stream: {
        streamLists: [],
        selectedStream: [],
        selectedStreamFields: [],
      },
      query: "",
      config: {},
    },
  },
};

// Mock getThemeColors
vi.mock("@/utils/logs/keyValueParser", () => ({
  getThemeColors: vi.fn(() => ({
    keyName: "#b71c1c",
    stringValue: "#2e7d32",
    numberValue: "#2563eb",
    booleanValue: "#6d28d9",
    nullValue: "#6b7280",
    objectValue: "#9ca3af",
    timestamp: "#e65100",
    ip: "#1976d2",
    url: "#00796b",
    email: "#7b1fa2",
    http_method: "#388e3c",
    status_code: "#f57c00",
    path: "#5d4037",
    uuid: "#455a64",
  })),
}));

// Mock textHighlighter composable
vi.mock("@/composables/useTextHighlighter", () => ({
  useTextHighlighter: () => ({
    processTextWithHighlights: vi.fn((text, query, colors, quotes) =>
      `<span class="log-string">${text}</span>`
    ),
    extractKeywords: vi.fn((query) => query ? ["test"] : []),
    splitTextByKeywords: vi.fn((text, keywords) =>
      keywords.length ? [
        { text: text, isHighlighted: true }
      ] : [
        { text: text, isHighlighted: false }
      ]
    ),
    escapeHtml: vi.fn((text) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;")),
    isFTSColumn: vi.fn((columnId, value, keys) => keys.includes(columnId) && typeof value === "string"),
  }),
}));

// Mock vuex
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock searchState
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => mockSearchState,
}));

// Mock vue reactivity
vi.mock("vue", () => ({
  ref: vi.fn((value) => ({ value })),
  computed: vi.fn((fn) => ({ value: fn() })),
  watch: vi.fn(),
}));

describe("useLogsHighlighter", () => {
  let logsHighlighter: ReturnType<typeof useLogsHighlighter>;

  beforeEach(() => {
    vi.clearAllMocks();
    logsHighlighter = useLogsHighlighter();
  });

  describe("processHitsInChunks", () => {
    const mockHits = [
      { message: "Error occurred", level: "error", _p_timestamp: 1640995200000 },
      { message: "Warning message", level: "warn", _p_timestamp: 1640995300000 },
      { message: "Info message", level: "info", _p_timestamp: 1640995400000 },
    ];

    const mockColumns = [
      { id: "message", accessorFn: null },
      { id: "level", accessorFn: null },
      { id: "source", accessorFn: null },
    ];

    const selectedStreamFtsKeys = ["message"];

    it("should process hits in chunks asynchronously", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        mockColumns,
        false,
        "match_all('error')",
        2,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("should handle empty hits array", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        [],
        mockColumns,
        false,
        "",
        50,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should handle empty columns array", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        [],
        false,
        "",
        50,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should clear cache when clearCache is true", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        mockColumns,
        true,
        "",
        50,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should handle different chunk sizes", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        mockColumns,
        false,
        "",
        1, // Very small chunk size
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should process FTS columns differently from non-FTS columns", async () => {
      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        mockColumns,
        false,
        "match_all('error')",
        50,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should handle columns with accessorFn", async () => {
      const columnsWithAccessor = [
        {
          id: "custom",
          accessorFn: (row: any) => `${row.level}: ${row.message}`
        },
      ];

      const result = await logsHighlighter.processHitsInChunks(
        mockHits,
        columnsWithAccessor,
        false,
        "",
        50,
        selectedStreamFtsKeys
      );

      expect(result).toBeDefined();
    });

    it("should yield control between chunks", async () => {
      const startTime = Date.now();
      await logsHighlighter.processHitsInChunks(
        mockHits,
        mockColumns,
        false,
        "",
        1, // Small chunk size to trigger multiple async operations
        selectedStreamFtsKeys
      );
      const endTime = Date.now();

      // Should take some time due to setTimeout calls
      expect(endTime - startTime).toBeGreaterThan(0);
    });
  });

  describe("colorizedJson", () => {
    it("should handle null data", () => {
      const result = logsHighlighter.colorizedJson({
        data: null,
        simpleMode: false,
        queryString: "",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toBe("");
    });

    it("should handle undefined data", () => {
      const result = logsHighlighter.colorizedJson({
        data: undefined,
        simpleMode: false,
        queryString: "",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toBe("");
    });

    it("should handle string data in simple mode", () => {
      const result = logsHighlighter.colorizedJson({
        data: "test message",
        simpleMode: true,
        queryString: "match_all('test')",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toContain("test message");
    });

    it("should handle string data with semantic colorization", () => {
      const result = logsHighlighter.colorizedJson({
        data: "Error in system",
        simpleMode: false,
        queryString: "match_all('error')",
        showQuotes: true,
        showBraces: false,
      });

      expect(result).toContain("Error in system");
    });

    it("should handle number data", () => {
      const result = logsHighlighter.colorizedJson({
        data: 42,
        simpleMode: false,
        queryString: "",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toContain("42");
    });

    it("should handle large number (timestamp) data", () => {
      const result = logsHighlighter.colorizedJson({
        data: 1640995200000,
        simpleMode: false,
        queryString: "",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toContain("1640995200000");
    });

    it("should handle boolean data", () => {
      const result = logsHighlighter.colorizedJson({
        data: true,
        simpleMode: false,
        queryString: "",
        showQuotes: false,
        showBraces: false,
      });

      expect(result).toContain("true");
    });

    it("should handle complex object data", () => {
      const complexObject = {
        level: "error",
        message: "Something went wrong",
        timestamp: 1640995200000,
      };

      const result = logsHighlighter.colorizedJson({
        data: complexObject,
        simpleMode: false,
        queryString: "",
        showQuotes: true,
        showBraces: true,
      });

      expect(result).toContain("level");
      expect(result).toContain("error");
      expect(result).toContain("message");
    });

    it("should handle arrays in object data", () => {
      const objectWithArray = {
        items: ["item1", "item2", "item3"],
        count: 3,
      };

      const result = logsHighlighter.colorizedJson({
        data: objectWithArray,
        simpleMode: false,
        queryString: "",
        showQuotes: true,
        showBraces: true,
      });

      expect(result).toContain("items");
      expect(result).toContain("count");
    });
  });

  describe("simpleHighlight", () => {
    it("should highlight matching keywords", () => {
      const result = logsHighlighter.simpleHighlight(
        "error in system",
        "match_all('error')"
      );

      expect(result).toContain("error in system");
    });

    it("should handle text without keywords", () => {
      const result = logsHighlighter.simpleHighlight(
        "normal text",
        ""
      );

      expect(result).toContain("normal text");
    });

    it("should escape HTML in text", () => {
      const result = logsHighlighter.simpleHighlight(
        "<script>alert('xss')</script>",
        ""
      );

      expect(result).toContain("&lt;script&gt;");
    });
  });

  describe("detectSemanticType", () => {
    it("should detect IP addresses", () => {
      const result = logsHighlighter.detectSemanticType("192.168.1.1");
      expect(result).toBe("ip");
    });

    it("should detect URLs", () => {
      const result = logsHighlighter.detectSemanticType("https://example.com");
      expect(result).toBe("url");
    });

    it("should detect email addresses", () => {
      const result = logsHighlighter.detectSemanticType("user@example.com");
      expect(result).toBe("email");
    });

    it("should detect HTTP methods", () => {
      const result = logsHighlighter.detectSemanticType("GET");
      expect(result).toBe("http-method");
    });

    it("should detect valid HTTP status codes", () => {
      // Valid 2xx codes
      expect(logsHighlighter.detectSemanticType("200")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("201")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("204")).toBe("status-code");

      // Valid 3xx codes
      expect(logsHighlighter.detectSemanticType("301")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("302")).toBe("status-code");

      // Valid 4xx codes
      expect(logsHighlighter.detectSemanticType("400")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("404")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("429")).toBe("status-code");

      // Valid 5xx codes
      expect(logsHighlighter.detectSemanticType("500")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("502")).toBe("status-code");
      expect(logsHighlighter.detectSemanticType("503")).toBe("status-code");
    });

    it("should NOT detect invalid 3-digit numbers as status codes", () => {
      // Address numbers (like "147 Birch Way")
      expect(logsHighlighter.detectSemanticType("147")).not.toBe("status-code");
      expect(logsHighlighter.detectSemanticType("189")).not.toBe("status-code");

      // Invalid status code ranges
      expect(logsHighlighter.detectSemanticType("104")).not.toBe("status-code"); // 1xx invalid
      expect(logsHighlighter.detectSemanticType("209")).not.toBe("status-code"); // 2xx invalid
      expect(logsHighlighter.detectSemanticType("309")).not.toBe("status-code"); // 3xx invalid
      expect(logsHighlighter.detectSemanticType("432")).not.toBe("status-code"); // 4xx invalid
      expect(logsHighlighter.detectSemanticType("512")).not.toBe("status-code"); // 5xx invalid
      expect(logsHighlighter.detectSemanticType("600")).not.toBe("status-code"); // 6xx doesn't exist
      expect(logsHighlighter.detectSemanticType("999")).not.toBe("status-code"); // way out of range
    });

    it("should detect UUIDs", () => {
      const result = logsHighlighter.detectSemanticType(
        "550e8400-e29b-41d4-a716-446655440000"
      );
      expect(result).toBe("uuid");
    });

    it("should detect file paths", () => {
      const result = logsHighlighter.detectSemanticType("/var/log/system.log");
      expect(result).toBe("path");
    });

    it("should detect Windows file paths", () => {
      const result = logsHighlighter.detectSemanticType("C:\\Windows\\System32");
      expect(result).toBe("path");
    });

    it("should detect large numbers as timestamps", () => {
      const result = logsHighlighter.detectSemanticType("1640995200000");
      expect(result).toBe("timestamp");
    });

    it("should default to string for unknown patterns", () => {
      const result = logsHighlighter.detectSemanticType("regular text");
      expect(result).toBe("string");
    });

    it("should handle empty or invalid input", () => {
      expect(logsHighlighter.detectSemanticType("")).toBe("default");
      expect(logsHighlighter.detectSemanticType(null as any)).toBe("default");
      expect(logsHighlighter.detectSemanticType(undefined as any)).toBe("default");
    });
  });

  describe("createStyledSpanWithClasses", () => {
    it("should create span with appropriate classes", () => {
      const result = logsHighlighter.createStyledSpanWithClasses(
        "192.168.1.1",
        "ip",
        "",
        false
      );

      expect(result).toContain("log-ip");
      expect(result).toContain("192.168.1.1");
    });

    it("should add quotes when requested", () => {
      const result = logsHighlighter.createStyledSpanWithClasses(
        "test text",
        "string",
        "",
        true
      );

      expect(result).toContain('"');
    });

    it("should highlight matching keywords", () => {
      const result = logsHighlighter.createStyledSpanWithClasses(
        "error message",
        "string",
        "match_all('error')",
        false
      );

      expect(result).toContain("error message");
    });
  });

  describe("isLogLineWithMixedContent", () => {
    it("should detect HTTP log lines with mixed content", () => {
      const logLine = '192.168.1.1 - - [01/Jan/2023:12:00:00 +0000] "GET /api/users HTTP/1.1" 200';
      const result = logsHighlighter.isLogLineWithMixedContent(logLine);
      expect(result).toBe(true);
    });

    it("should detect quoted HTTP methods with IPs", () => {
      const logLine = 'IP 192.168.1.1 made "GET /path" request';
      const result = logsHighlighter.isLogLineWithMixedContent(logLine);
      expect(result).toBe(true);
    });

    it("should detect HTTP protocol with URLs", () => {
      const logLine = "Request to https://api.example.com via HTTP/1.1";
      const result = logsHighlighter.isLogLineWithMixedContent(logLine);
      expect(result).toBe(true);
    });

    it("should not detect lines with only HTTP indicators", () => {
      const logLine = "HTTP/1.1 request made";
      const result = logsHighlighter.isLogLineWithMixedContent(logLine);
      expect(result).toBe(false);
    });

    it("should not detect lines with only semantic types", () => {
      const logLine = "User user@example.com from 192.168.1.1";
      const result = logsHighlighter.isLogLineWithMixedContent(logLine);
      expect(result).toBe(false);
    });

    it("should handle empty strings", () => {
      const result = logsHighlighter.isLogLineWithMixedContent("");
      expect(result).toBe(false);
    });
  });

  describe("colorizeObjectWithClasses", () => {
    it("should colorize simple object", () => {
      const obj = { level: "error", message: "Something wrong" };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, true, "");

      expect(result).toContain("level");
      expect(result).toContain("error");
      expect(result).toContain("message");
      expect(result).toContain("log-object-brace");
    });

    it("should handle objects without braces", () => {
      const obj = { level: "error" };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, false, true, "");

      expect(result).toContain("level");
      expect(result).not.toContain("log-object-brace");
    });

    it("should handle objects without quotes", () => {
      const obj = { level: "error" };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, false, "");

      expect(result).toContain("level");
      expect(result).not.toContain('"level"');
    });

    it("should handle nested objects", () => {
      const obj = {
        user: {
          id: 123,
          email: "user@example.com"
        }
      };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, true, "");

      expect(result).toContain("user");
      expect(result).toContain("id");
      expect(result).toContain("email");
    });

    it("should handle arrays in objects", () => {
      const obj = { items: [1, 2, 3] };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, true, "");

      expect(result).toContain("items");
      expect(result).toContain("[1,2,3]");
    });

    it("should handle different data types", () => {
      const obj = {
        string: "text",
        number: 42,
        boolean: true,
        null: null,
        timestamp: 1640995200000,
      };
      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, true, "");

      expect(result).toContain("text");
      expect(result).toContain("42");
      expect(result).toContain("true");
      expect(result).toContain("null");
      expect(result).toContain("1640995200000");
    });
  });

  describe("legacy compatibility", () => {
    it("should maintain backward compatibility with processHitsHighlighting", async () => {
      const data = [
        { message: "error occurred", level: "error" },
        { message: "warning message", level: "warn" },
      ];

      const result = await logsHighlighter.processHitsHighlighting(data);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should maintain backward compatibility with colorizeObject", () => {
      const obj = { level: "error", message: "test" };
      const colors = { keyName: "#000", stringValue: "#333" };

      const result = logsHighlighter.colorizeObject(obj, colors, true, true, "");
      expect(result).toContain("level");
      expect(result).toContain("error");
    });

    it("should maintain backward compatibility with createStyledSpan", () => {
      const result = logsHighlighter.createStyledSpan(
        "192.168.1.1",
        "#1976d2",
        "",
        false
      );

      expect(result).toContain("192.168.1.1");
    });
  });

  describe("performance and edge cases", () => {
    it("should handle large datasets efficiently", async () => {
      const largeHits = Array.from({ length: 1000 }, (_, i) => ({
        message: `Message ${i}`,
        level: "info",
        id: i,
      }));

      const columns = [
        { id: "message", accessorFn: null },
        { id: "level", accessorFn: null },
      ];

      const startTime = Date.now();
      const result = await logsHighlighter.processHitsInChunks(
        largeHits,
        columns,
        false,
        "",
        100,
        ["message"]
      );
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it("should handle malformed objects gracefully", () => {
      const malformedObj = {
        [Symbol("test")]: "symbol key",
        normalProperty: "normal value",
      };

      // Should not throw error for objects with symbol keys
      expect(() => {
        logsHighlighter.colorizeObjectWithClasses(malformedObj, true, true, "");
      }).not.toThrow();
    });

    it("should handle very long strings", () => {
      const longString = "x".repeat(10000);
      const result = logsHighlighter.simpleHighlight(longString, "");
      expect(result).toContain("x");
    });

    it("should handle special characters in object keys", () => {
      const obj = {
        "key with spaces": "value1",
        "key-with-dashes": "value2",
        "key.with.dots": "value3",
        "key@with@symbols": "value4",
      };

      const result = logsHighlighter.colorizeObjectWithClasses(obj, true, true, "");
      expect(result).toContain("key with spaces");
      expect(result).toContain("key-with-dashes");
      expect(result).toContain("key.with.dots");
      expect(result).toContain("key@with@symbols");
    });
  });
});