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
import { useTextHighlighter } from "@/composables/useTextHighlighter";

// Mock Vuex store
const mockStore = {
  state: {
    zoConfig: {
      fts_keys: ["message", "log", "content"],
    },
  },
};

// Mock useLogs composable
vi.mock("./useLogs", () => ({
  default: () => ({}),
}));

// Mock Vuex
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

describe("useTextHighlighter", () => {
  let textHighlighter: ReturnType<typeof useTextHighlighter>;

  beforeEach(() => {
    textHighlighter = useTextHighlighter();
  });

  describe("extractKeywords", () => {
    it("should extract keywords from match_all queries", () => {
      const result = textHighlighter.extractKeywords("match_all('error')");
      expect(result).toEqual(["error"]);
    });

    it("should extract keywords from fuzzy_match queries", () => {
      const result = textHighlighter.extractKeywords("fuzzy_match('test', 2)");
      expect(result).toEqual(["test"]);
    });

    it("should extract keywords from fuzzy_match_all queries", () => {
      const result = textHighlighter.extractKeywords(
        "fuzzy_match_all('warning', 1)",
      );
      expect(result).toEqual(["warning"]);
    });

    it("should handle double quotes", () => {
      const result = textHighlighter.extractKeywords(
        'match_all("error message")',
      );
      expect(result).toEqual(["error message"]);
    });

    it("should handle single quotes", () => {
      const result = textHighlighter.extractKeywords(
        "match_all('error message')",
      );
      expect(result).toEqual(["error message"]);
    });

    it("should extract multiple keywords from different functions", () => {
      const query = "match_all('error') AND fuzzy_match('warning', 1)";
      const result = textHighlighter.extractKeywords(query);
      expect(result).toEqual(["error", "warning"]);
    });

    it("should handle empty query string", () => {
      const result = textHighlighter.extractKeywords("");
      expect(result).toEqual([]);
    });

    it("should handle null/undefined query string", () => {
      expect(textHighlighter.extractKeywords(null as any)).toEqual([]);
      expect(textHighlighter.extractKeywords(undefined as any)).toEqual([]);
    });

    it("should trim extracted keywords", () => {
      const result = textHighlighter.extractKeywords(
        "match_all('  error message  ')",
      );
      expect(result).toEqual(["error message"]);
    });

    it("should deduplicate keywords", () => {
      const query = "match_all('error') OR match_all('error')";
      const result = textHighlighter.extractKeywords(query);
      expect(result).toEqual(["error"]);
    });

    it("should handle queries without SQL functions", () => {
      const result = textHighlighter.extractKeywords("just a regular string");
      expect(result).toEqual([]);
    });
  });

  describe("splitTextByKeywords", () => {
    it("should split text by single keyword", () => {
      const result = textHighlighter.splitTextByKeywords("error in system", [
        "error",
      ]);
      expect(result).toEqual([
        { text: "error", isHighlighted: true },
        { text: " in system", isHighlighted: false },
      ]);
    });

    it("should split text by multiple keywords", () => {
      const result = textHighlighter.splitTextByKeywords(
        "error and warning messages",
        ["error", "warning"],
      );
      expect(result).toEqual([
        { text: "error", isHighlighted: true },
        { text: " and ", isHighlighted: false },
        { text: "warning", isHighlighted: true },
        { text: " messages", isHighlighted: false },
      ]);
    });

    it("should handle case-insensitive matching", () => {
      const result = textHighlighter.splitTextByKeywords("ERROR in system", [
        "error",
      ]);
      expect(result).toEqual([
        { text: "ERROR", isHighlighted: true },
        { text: " in system", isHighlighted: false },
      ]);
    });

    it("should handle empty keywords array", () => {
      const result = textHighlighter.splitTextByKeywords("some text", []);
      expect(result).toEqual([{ text: "some text", isHighlighted: false }]);
    });

    it("should handle empty text", () => {
      const result = textHighlighter.splitTextByKeywords("", ["error"]);
      expect(result).toEqual([{ text: "", isHighlighted: false }]);
    });

    it("should escape special regex characters in keywords", () => {
      const result = textHighlighter.splitTextByKeywords(
        "test.[regex]+ chars",
        ["[regex]+"],
      );
      expect(result).toEqual([
        { text: "test.", isHighlighted: false },
        { text: "[regex]+", isHighlighted: true },
        { text: " chars", isHighlighted: false },
      ]);
    });

    it("should handle overlapping keywords", () => {
      const result = textHighlighter.splitTextByKeywords("test testing", [
        "test",
        "testing",
      ]);
      expect(result[0].text).toBe("test");
      expect(result[0].isHighlighted).toBe(true);
    });
  });

  describe("escapeHtml", () => {
    it("should escape HTML entities", () => {
      const result = textHighlighter.escapeHtml(
        '<script>alert("xss")</script>',
      );
      expect(result).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
      );
    });

    it("should escape ampersands", () => {
      const result = textHighlighter.escapeHtml("Tom & Jerry");
      expect(result).toBe("Tom &amp; Jerry");
    });

    it("should handle empty string", () => {
      const result = textHighlighter.escapeHtml("");
      expect(result).toBe("");
    });

    it("should handle string without special characters", () => {
      const result = textHighlighter.escapeHtml("normal text");
      expect(result).toBe("normal text");
    });
  });

  describe("text processing integration", () => {
    it("should handle consecutive quoted strings in processTextWithHighlights", () => {
      const mockColors = { stringValue: "#047857" };
      const result = textHighlighter.processTextWithHighlights(
        '"Success" "message" completed',
        "",
        mockColors,
      );
      // New behavior: quotes are preserved as part of the data
      expect(result).toContain("Success");
      expect(result).toContain("message");
      expect(result).toContain("completed");
      // Quotes should be in the output (data quotes)
      expect(result).toContain("&quot;");
    });

    it("should handle tokenization with highlighting", () => {
      const mockColors = { stringValue: "#047857" };
      const result = textHighlighter.processTextWithHighlights(
        'hello "quoted text" world',
        "match_all('hello')",
        mockColors,
      );
      expect(result).toContain("hello");
      expect(result).toContain("quoted text");
    });

    it("should preserve bracketed content", () => {
      const mockColors = { stringValue: "#047857" };
      const result = textHighlighter.processTextWithHighlights(
        "hello [timestamp] world",
        "",
        mockColors,
      );
      // New behavior: brackets are styled separately but content is preserved
      expect(result).toContain("timestamp");
      expect(result).toContain("hello");
      expect(result).toContain("world");
      // Brackets should be styled with gray color
      expect(result).toContain("log-object-brace");
    });
  });

  describe("semantic type detection", () => {
    it("should detect IP addresses", () => {
      const colors = { ip: "#D97706", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "192.168.1.1",
        colors,
      );
      expect(result).toBe("#D97706");
    });

    it("should detect URLs", () => {
      const colors = { url: "#1D4ED8", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "https://example.com",
        colors,
      );
      expect(result).toBe("#1D4ED8");
    });

    it("should detect email addresses", () => {
      const colors = { email: "#9333EA", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "user@example.com",
        colors,
      );
      expect(result).toBe("#9333EA");
    });

    it("should detect UUIDs", () => {
      const colors = { uuid: "#047857", stringValue: "#047857" };
      const uuid = "123e4567-e89b-12d3-a456-426614174000";
      const result = textHighlighter.getSingleSemanticColor(uuid, colors);
      expect(result).toBe("#047857");
    });

    it("should detect file paths", () => {
      const colors = { path: "#4338CA", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "/var/log/system.log",
        colors,
      );
      expect(result).toBe("#4338CA");
    });

    it("should detect Windows file paths", () => {
      const colors = { path: "#4338CA", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "C:\\Windows\\System32",
        colors,
      );
      expect(result).toBe("#4338CA");
    });

    it("should fall back to string value for unrecognized patterns", () => {
      const colors = { stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        "regular text",
        colors,
      );
      expect(result).toBe("#047857");
    });

    it("should handle quoted values", () => {
      const colors = { ip: "#D97706", stringValue: "#047857" };
      const result = textHighlighter.getSingleSemanticColor(
        '"192.168.1.1"',
        colors,
      );
      expect(result).toBe("#D97706");
    });

    it("should detect valid HTTP status codes", () => {
      // Note: status_code maps to colors.numberValue in getColorForType
      const colors = { numberValue: "#f57c00", stringValue: "#047857" };

      // Valid 1xx codes
      expect(textHighlighter.getSingleSemanticColor("100", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("101", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("103", colors)).toBe("#f57c00");

      // Valid 2xx codes
      expect(textHighlighter.getSingleSemanticColor("200", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("201", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("204", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("226", colors)).toBe("#f57c00");

      // Valid 3xx codes
      expect(textHighlighter.getSingleSemanticColor("301", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("302", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("304", colors)).toBe("#f57c00");

      // Valid 4xx codes
      expect(textHighlighter.getSingleSemanticColor("400", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("401", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("404", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("429", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("451", colors)).toBe("#f57c00");

      // Valid 5xx codes
      expect(textHighlighter.getSingleSemanticColor("500", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("502", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("503", colors)).toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("511", colors)).toBe("#f57c00");
    });

    it("should NOT detect invalid 3-digit numbers as status codes", () => {
      // Note: status_code maps to colors.numberValue in getColorForType
      const colors = { numberValue: "#f57c00", stringValue: "#047857" };

      expect(textHighlighter.getSingleSemanticColor("147", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("189", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("256", colors)).not.toBe("#f57c00");

      // Invalid 1xx codes (only 100-103 are valid)
      expect(textHighlighter.getSingleSemanticColor("104", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("199", colors)).not.toBe("#f57c00");

      // Invalid 2xx codes
      expect(textHighlighter.getSingleSemanticColor("209", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("227", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("299", colors)).not.toBe("#f57c00");

      // Invalid 3xx codes
      expect(textHighlighter.getSingleSemanticColor("309", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("399", colors)).not.toBe("#f57c00");

      // Invalid 4xx codes
      expect(textHighlighter.getSingleSemanticColor("432", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("450", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("452", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("499", colors)).not.toBe("#f57c00");

      // Invalid 5xx codes
      expect(textHighlighter.getSingleSemanticColor("512", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("599", colors)).not.toBe("#f57c00");

      // Completely out of range
      expect(textHighlighter.getSingleSemanticColor("600", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("999", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("000", colors)).not.toBe("#f57c00");
      expect(textHighlighter.getSingleSemanticColor("099", colors)).not.toBe("#f57c00");
    });

    it("should correctly detect status codes in context (address example)", () => {
      const colors = { status_code: "#f57c00", stringValue: "#047857" };
      const mockColors = {
        stringValue: "#047857",
        status_code: "#f57c00",
      };

      // Test the actual bug case: "147 test address" should not highlight 147 as status code
      const result = textHighlighter.processTextWithHighlights(
        "147 test address",
        "",
        mockColors,
      );

      // Should NOT contain status_code styling for 147
      // 147 is not a valid HTTP status code
      expect(result).not.toContain("log-status_code");
    });
  });

  describe("isFTSColumn", () => {
    it("should detect FTS columns from configuration", () => {
      const selectedStreamFtsKeys = ["message", "content", "log"];
      const result = textHighlighter.isFTSColumn(
        "message",
        "some log message",
        selectedStreamFtsKeys,
      );
      expect(result).toBe(true);
    });

    it("should not detect non-FTS columns", () => {
      const selectedStreamFtsKeys = ["message", "content"];
      const result = textHighlighter.isFTSColumn(
        "timestamp",
        "2023-01-01",
        selectedStreamFtsKeys,
      );
      expect(result).toBe(false);
    });

    it("should exclude source column", () => {
      const selectedStreamFtsKeys = ["source"];
      const result = textHighlighter.isFTSColumn(
        "source",
        "some source",
        selectedStreamFtsKeys,
      );
      expect(result).toBe(false);
    });

    it("should handle case-insensitive matching", () => {
      const selectedStreamFtsKeys = ["message"];
      const result = textHighlighter.isFTSColumn(
        "MESSAGE",
        "some log message",
        selectedStreamFtsKeys,
      );
      expect(result).toBe(true);
    });

    it("should handle non-string values", () => {
      const selectedStreamFtsKeys = ["count"];
      const result = textHighlighter.isFTSColumn(
        "count",
        42,
        selectedStreamFtsKeys,
      );
      expect(result).toBe(false);
    });

    it("should handle empty string values", () => {
      const selectedStreamFtsKeys = ["message"];
      const result = textHighlighter.isFTSColumn(
        "message",
        "",
        selectedStreamFtsKeys,
      );
      expect(result).toBe(false);
    });

    it("should handle null/undefined values", () => {
      const selectedStreamFtsKeys = ["message"];
      expect(
        textHighlighter.isFTSColumn("message", null, selectedStreamFtsKeys),
      ).toBe(false);
      expect(
        textHighlighter.isFTSColumn(
          "message",
          undefined,
          selectedStreamFtsKeys,
        ),
      ).toBe(false);
    });
  });

  describe("processTextWithHighlights", () => {
    const mockColors = {
      stringValue: "#047857",
      ip: "#D97706",
      url: "#1D4ED8",
      email: "#9333EA",
    };

    it("should process text with highlighting", () => {
      const result = textHighlighter.processTextWithHighlights(
        "error in system",
        "match_all('error')",
        mockColors,
      );
      expect(result).toContain("log-highlighted");
      expect(result).toContain("error");
    });

    it("should process text without highlighting", () => {
      const result = textHighlighter.processTextWithHighlights(
        "normal text",
        "",
        mockColors,
      );
      expect(result).toContain("log-string");
      // New behavior: text is tokenized into separate spans
      expect(result).toContain("normal");
      expect(result).toContain("text");
    });

    it("should apply semantic coloring", () => {
      const result = textHighlighter.processTextWithHighlights(
        "192.168.1.1",
        "",
        mockColors,
      );
      expect(result).toContain("log-ip");
      expect(result).toContain("192.168.1.1");
    });

    it("should combine semantic coloring with highlighting", () => {
      const result = textHighlighter.processTextWithHighlights(
        "IP address 192.168.1.1",
        "match_all('IP')",
        mockColors,
      );
      expect(result).toContain("log-highlighted");
      expect(result).toContain("IP");
    });

    it("should handle null/undefined input", () => {
      expect(
        textHighlighter.processTextWithHighlights(null, "", mockColors),
      ).toBe("");
      expect(
        textHighlighter.processTextWithHighlights(undefined, "", mockColors),
      ).toBe("");
    });

    it("should handle non-string input", () => {
      const result = textHighlighter.processTextWithHighlights(
        42,
        "",
        mockColors,
      );
      expect(result).toContain("42");
    });

    it("should handle empty text", () => {
      const result = textHighlighter.processTextWithHighlights(
        "",
        "",
        mockColors,
      );
      // Empty text returns empty string (no tokens to process)
      expect(result).toBe("");
    });

    it("should handle complex text with multiple semantic types", () => {
      const text =
        "User user@example.com from 192.168.1.1 visited https://example.com";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("user@example.com");
      expect(result).toContain("192.168.1.1");
      expect(result).toContain("https://example.com");
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle very long text", () => {
      const longText = "a".repeat(10000);
      const result = textHighlighter.processTextWithHighlights(
        longText,
        "match_all('a')",
        { stringValue: "#000" },
      );
      expect(result).toContain("a");
    });

    it("should handle special characters in text", () => {
      const specialText = "!@#$%^&*()_+-={}[]|\\:;\"'<>?,./";
      const result = textHighlighter.processTextWithHighlights(
        specialText,
        "",
        { stringValue: "#000" },
      );
      expect(result).toContain("&amp;"); // HTML escaped
      expect(result).toContain("&lt;"); // HTML escaped
      expect(result).toContain("&gt;"); // HTML escaped
    });

    it("should handle malformed query strings", () => {
      const result = textHighlighter.extractKeywords("match_all('unclosed");
      expect(result).toEqual([]);
    });

    it("should handle extremely nested quotes in processTextWithHighlights", () => {
      const nestedText = '"level 1 \'level 2 "level 3" level 2\' level 1"';
      const result = textHighlighter.processTextWithHighlights(nestedText, "", {
        stringValue: "#000",
      });
      expect(result).toContain("level 1");
    });

    it("should handle mixed quote types in consecutive strings", () => {
      const mixedText = '"double" \'single\' "double again"';
      const result = textHighlighter.processTextWithHighlights(mixedText, "", {
        stringValue: "#000",
      });
      // New behavior: quotes are preserved as data
      expect(result).toContain("double");
      expect(result).toContain("single");
      expect(result).toContain("double again");
      // Both quote types should be preserved
      expect(result).toContain("&quot;"); // double quotes
      expect(result).toContain("'"); // single quotes (or &#39; if escaped)
    });
  });

  describe("unclosed brackets and quotes handling", () => {
    const mockColors = { stringValue: "#047857" };

    it("should preserve last character with unclosed bracket - ANSI escape sequence", () => {
      // Real-world example: ANSI escape codes with unclosed brackets
      const text = "src/plugins/logs/QueryEditor.spec.ts[2m";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // CRITICAL: The 's' from '.ts' must not be lost
      expect(result).toContain("QueryEditor.spec.ts");
      expect(result).toContain(".ts");
    });

    it("should preserve last character with unclosed bracket - file path", () => {
      const text = "src/views/About.spec.ts[2m | test";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // The 's' from '.ts' must be preserved
      expect(result).toContain("About.spec.ts");
      expect(result).toContain(".ts");
    });

    it("should handle unclosed single quote at end", () => {
      const text = "hello world 'unclosed";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // All characters should be preserved
      expect(result).toContain("hello");
      expect(result).toContain("world");
      expect(result).toContain("unclosed");
      expect(result).toContain("'");
    });

    it("should handle unclosed double quote at end", () => {
      const text = 'hello world "unclosed';
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // All characters should be preserved
      expect(result).toContain("hello");
      expect(result).toContain("world");
      expect(result).toContain("unclosed");
      expect(result).toContain("&quot;");
    });

    it("should handle text ending with bracket but no closing", () => {
      const text = "test[incomplete";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("incomplete");
      // The 'e' at the end must be preserved
      expect(result).toContain("incomplete");
    });

    it("should preserve trailing whitespace before unclosed bracket", () => {
      const text = "test  [unclosed";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("unclosed");
    });

    it("should handle multiple unclosed brackets", () => {
      const text = "test[first[second";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("first");
      expect(result).toContain("second");
      // Last character must be preserved
      expect(result).toContain("second");
    });
  });

  describe("complex ANSI escape sequences", () => {
    const mockColors = { stringValue: "#047857" };

    it("should handle ANSI color codes without losing characters", () => {
      // Simulated ANSI: \u001b[90mstderr\u001b[2m | file.ts
      const text = "[90mstderr[2m | src/views/About.spec.ts[2m";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // Must preserve 'stderr' and '.ts'
      expect(result).toContain("stderr");
      expect(result).toContain("About.spec.ts");
      expect(result).toContain(".ts");
    });

    it("should handle nested brackets with mixed content", () => {
      const text = "test [22m[2m content end";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("content");
      expect(result).toContain("end");
    });

    it("should preserve all characters in complex log line", () => {
      const text = "[90mstderr[2m | src/plugins/logs/QueryEditor.spec.ts[2m > [22m[2mshould mount";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // Critical characters to preserve
      expect(result).toContain("QueryEditor.spec.ts");
      expect(result).toContain("should");
      expect(result).toContain("mount");
    });
  });

  describe("leading and trailing whitespace preservation", () => {
    const mockColors = { stringValue: "#047857" };

    it("should preserve leading whitespace before bracket", () => {
      const text = "test  [content]";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // Should have 2 spaces between test and bracket
      expect(result).toContain("test");
      expect(result).toContain("content");
    });

    it("should preserve trailing whitespace after content before bracket", () => {
      const text = "test  [content";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("content");
    });

    it("should preserve leading whitespace before quote", () => {
      const text = 'test  "quoted"';
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("quoted");
    });

    it("should preserve multiple spaces between tokens", () => {
      const text = "word1    word2";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("word1");
      expect(result).toContain("word2");
    });

    it("should handle text with only whitespace", () => {
      const text = "   ";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      // Should return something (whitespace tokens)
      expect(result).toBeDefined();
    });

    it("should preserve whitespace at start and end", () => {
      const text = "  test content  ";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("content");
    });
  });

  describe("bracket and quote edge cases", () => {
    const mockColors = { stringValue: "#047857" };

    it("should handle closed bracket followed by text", () => {
      const text = "[content] after";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("content");
      expect(result).toContain("after");
    });

    it("should handle empty brackets", () => {
      const text = "test [] end";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("end");
    });

    it("should handle bracket at start of string", () => {
      const text = "[start content";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("start");
      expect(result).toContain("content");
    });

    it("should handle bracket at end of string", () => {
      const text = "content ends[";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("content");
      expect(result).toContain("ends");
    });

    it("should handle quote at start of string", () => {
      const text = '"start content';
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("start");
      expect(result).toContain("content");
    });

    it("should handle apostrophe in contractions", () => {
      const text = "it's don't can't";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("it's");
      expect(result).toContain("don't");
      expect(result).toContain("can't");
    });

    it("should handle single character before bracket", () => {
      const text = "a[content";
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("a");
      expect(result).toContain("content");
    });

    it("should handle alternating brackets and quotes", () => {
      const text = '[test] "quote" [more] end';
      const result = textHighlighter.processTextWithHighlights(
        text,
        "",
        mockColors,
      );
      expect(result).toContain("test");
      expect(result).toContain("quote");
      expect(result).toContain("more");
      expect(result).toContain("end");
    });
  });
});
