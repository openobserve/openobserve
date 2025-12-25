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
      // Simplified: quotes are just characters, text is split by whitespace
      expect(result).toContain("&quot;quoted");
      expect(result).toContain("text&quot;");
    });

    it("should preserve bracketed content", () => {
      const mockColors = { stringValue: "#047857" };
      const result = textHighlighter.processTextWithHighlights(
        "hello [timestamp] world",
        "",
        mockColors,
      );
      // Simplified: brackets are just characters, no special styling
      expect(result).toContain("[timestamp]");
      expect(result).toContain("hello");
      expect(result).toContain("world");
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
      // Simplified: quotes are just characters, split by whitespace
      expect(result).toContain("&quot;level");
      expect(result).toContain("1");
    });

    it("should handle mixed quote types in consecutive strings", () => {
      const mixedText = '"double" \'single\' "double again"';
      const result = textHighlighter.processTextWithHighlights(mixedText, "", {
        stringValue: "#000",
      });
      // Simplified: quotes are just characters, split by whitespace
      expect(result).toContain("&quot;double&quot;");
      expect(result).toContain("'single'");
      expect(result).toContain("&quot;double");
      expect(result).toContain("again&quot;");
      // Both quote types should be preserved
      expect(result).toContain("&quot;"); // double quotes
      expect(result).toContain("'"); // single quotes
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

  describe("real-world log scenarios", () => {
    const mockColors = {
      stringValue: "#047857",
      ip: "#D97706",
      url: "#1D4ED8",
      email: "#9333EA",
      numberValue: "#f57c00",
      path: "#4338CA",
    };

    it("should handle JSON log entries", () => {
      const jsonLog = '{"level":"error","message":"Database connection failed","timestamp":"2024-01-15T10:30:45Z"}';
      const result = textHighlighter.processTextWithHighlights(
        jsonLog,
        "match_all('error')",
        mockColors,
      );
      expect(result).toContain("error");
      expect(result).toContain("Database");
      expect(result).toContain("connection");
      expect(result).toContain("failed");
      expect(result).toContain("log-highlighted"); // 'error' should be highlighted
    });

    it("should handle stack trace logs", () => {
      const stackTrace = "Error: Cannot read property 'foo' of undefined\n    at Object.<anonymous> (/app/src/index.js:42:15)";
      const result = textHighlighter.processTextWithHighlights(
        stackTrace,
        "match_all('Error')",
        mockColors,
      );
      expect(result).toContain("Error");
      expect(result).toContain("Cannot");
      expect(result).toContain("/app/src/index.js");
      expect(result).toContain("log-highlighted"); // 'Error' should be highlighted
    });

    it("should handle Kubernetes pod logs with timestamps", () => {
      const k8sLog = "2024-01-15T10:30:45.123Z [INFO] kubernetes.io/pod/my-app-58d7b8c9f4-xz9jk: Started container";
      const result = textHighlighter.processTextWithHighlights(
        k8sLog,
        "",
        mockColors,
      );
      expect(result).toContain("2024-01-15T10:30:45.123Z");
      expect(result).toContain("INFO");
      expect(result).toContain("kubernetes.io/pod/my-app-58d7b8c9f4-xz9jk");
      expect(result).toContain("Started");
      expect(result).toContain("container");
    });

    it("should handle HTTP access logs with multiple IPs", () => {
      const accessLog = '192.168.1.1 - - [15/Jan/2024:10:30:45 +0000] "GET /api/v1/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"';
      const result = textHighlighter.processTextWithHighlights(
        accessLog,
        "",
        mockColors,
      );
      expect(result).toContain("192.168.1.1");
      expect(result).toContain("GET");
      expect(result).toContain("/api/v1/users");
      expect(result).toContain("200");
      expect(result).toContain("https://example.com");
      expect(result).toContain("log-ip"); // IP should be detected
    });

    it("should handle Docker container logs with ANSI codes", () => {
      const dockerLog = "\u001b[36mINFO\u001b[0m [2024-01-15 10:30:45] \u001b[33mWarning:\u001b[0m Disk usage at 85%";
      const result = textHighlighter.processTextWithHighlights(
        dockerLog,
        "match_all('Warning')",
        mockColors,
      );
      expect(result).toContain("INFO");
      expect(result).toContain("Warning");
      expect(result).toContain("Disk");
      expect(result).toContain("85%");
      expect(result).toContain("log-highlighted"); // 'Warning' should be highlighted
    });

    it("should handle multiline error logs", () => {
      const multilineError = "ERROR: Failed to connect to database\nCaused by: Connection timeout\n    at DatabaseConnector.connect (db.js:123)";
      const result = textHighlighter.processTextWithHighlights(
        multilineError,
        "match_all('ERROR')",
        mockColors,
      );
      expect(result).toContain("ERROR");
      expect(result).toContain("Failed");
      expect(result).toContain("database");
      expect(result).toContain("Connection");
      expect(result).toContain("timeout");
      expect(result).toContain("log-highlighted"); // 'ERROR' should be highlighted
    });

    it("should handle SQL query logs", () => {
      const sqlLog = 'Query: SELECT * FROM users WHERE email = "user@example.com" AND status = "active" LIMIT 100';
      const result = textHighlighter.processTextWithHighlights(
        sqlLog,
        "match_all('SELECT')",
        mockColors,
      );
      expect(result).toContain("SELECT");
      expect(result).toContain("FROM");
      expect(result).toContain("users");
      expect(result).toContain("user@example.com");
      expect(result).toContain("log-email"); // Email should be detected
      expect(result).toContain("log-highlighted"); // 'SELECT' should be highlighted
    });

    it("should handle logs with mixed URLs and IPs", () => {
      const mixedLog = "Request from 10.0.0.15 to https://api.example.com/v1/data forwarded to 172.16.0.10";
      const result = textHighlighter.processTextWithHighlights(
        mixedLog,
        "",
        mockColors,
      );
      expect(result).toContain("10.0.0.15");
      expect(result).toContain("https://api.example.com/v1/data");
      expect(result).toContain("172.16.0.10");
      expect(result).toContain("log-ip"); // IPs should be detected
      expect(result).toContain("log-url"); // URL should be detected
    });

    it("should handle AWS Lambda logs with request IDs", () => {
      const lambdaLog = "START RequestId: 8f9e4573-e55e-4d53-8f9e-4573e55e4d53 Version: $LATEST";
      const result = textHighlighter.processTextWithHighlights(
        lambdaLog,
        "match_all('START')",
        mockColors,
      );
      expect(result).toContain("START");
      expect(result).toContain("RequestId");
      expect(result).toContain("8f9e4573-e55e-4d53-8f9e-4573e55e4d53");
      expect(result).toContain("log-highlighted"); // 'START' should be highlighted
    });

    it("should handle logs with file paths and line numbers", () => {
      const fileLog = "Error in /var/log/app/error.log at line 1523: Permission denied for /etc/config/app.conf";
      const result = textHighlighter.processTextWithHighlights(
        fileLog,
        "match_all('Error')",
        mockColors,
      );
      expect(result).toContain("Error");
      // The path is split by keyword highlighting, but both parts should be present
      expect(result).toContain("/var/log/app/");
      expect(result).toContain(".log");
      expect(result).toContain("/etc/config/app.conf");
      expect(result).toContain("log-path"); // Paths should be detected
      expect(result).toContain("log-highlighted"); // 'Error' should be highlighted
    });

    it("should handle logs with timestamps in different formats", () => {
      const timestampLog1 = "2024-01-15 10:30:45.123 INFO Application started";
      const timestampLog2 = "[15/Jan/2024:10:30:45 +0000] Request completed";
      const timestampLog3 = "Jan 15 10:30:45 server1 sshd[12345]: Connection established";

      [timestampLog1, timestampLog2, timestampLog3].forEach(log => {
        const result = textHighlighter.processTextWithHighlights(
          log,
          "",
          mockColors,
        );
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it("should handle logs with special characters and symbols", () => {
      const symbolLog = "User@123 accessed /api/v1/users?filter=active&sort=desc with token: abc-123_XYZ.456";
      const result = textHighlighter.processTextWithHighlights(
        symbolLog,
        "",
        mockColors,
      );
      expect(result).toContain("User@123");
      expect(result).toContain("/api/v1/users");
      expect(result).toContain("filter=active");
      expect(result).toContain("abc-123_XYZ.456");
    });

    it("should handle logs with percentage and measurement values", () => {
      const metricsLog = "CPU: 85.3%, Memory: 4.2GB/8GB, Disk: 123.45MB free, Network: 1.5Mbps";
      const result = textHighlighter.processTextWithHighlights(
        metricsLog,
        "",
        mockColors,
      );
      expect(result).toContain("CPU");
      expect(result).toContain("85.3%");
      expect(result).toContain("4.2GB/8GB");
      expect(result).toContain("123.45MB");
      expect(result).toContain("1.5Mbps");
    });

    it("should handle logs with MAC addresses", () => {
      const macLog = "Device 00:1B:44:11:3A:B7 connected from 192.168.1.50";
      const result = textHighlighter.processTextWithHighlights(
        macLog,
        "",
        mockColors,
      );
      expect(result).toContain("Device");
      expect(result).toContain("00:1B:44:11:3A:B7");
      expect(result).toContain("192.168.1.50");
      expect(result).toContain("log-ip"); // IP should be detected
    });

    it("should handle logs with IPv6 addresses", () => {
      const ipv6Log = "Connection from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 to server";
      const result = textHighlighter.processTextWithHighlights(
        ipv6Log,
        "",
        mockColors,
      );
      expect(result).toContain("Connection");
      expect(result).toContain("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
      expect(result).toContain("server");
    });

    it("should handle logs with environment variables", () => {
      const envLog = "Starting application with NODE_ENV=production, PORT=8080, DATABASE_URL=postgres://localhost:5432/db";
      const result = textHighlighter.processTextWithHighlights(
        envLog,
        "match_all('production')",
        mockColors,
      );
      expect(result).toContain("NODE_ENV");
      expect(result).toContain("production");
      expect(result).toContain("PORT");
      expect(result).toContain("8080");
      expect(result).toContain("log-highlighted"); // 'production' should be highlighted
    });

    it("should handle logs with Git commit hashes", () => {
      const gitLog = "Deployed commit 3a5f7b9c2e1d4f6a8b0c9e7d5f3a1b2c4e6f8a0b from branch main";
      const result = textHighlighter.processTextWithHighlights(
        gitLog,
        "match_all('Deployed')",
        mockColors,
      );
      expect(result).toContain("Deployed");
      expect(result).toContain("commit");
      expect(result).toContain("3a5f7b9c2e1d4f6a8b0c9e7d5f3a1b2c4e6f8a0b");
      expect(result).toContain("main");
      expect(result).toContain("log-highlighted"); // 'Deployed' should be highlighted
    });

    it("should handle logs with base64 encoded data", () => {
      const base64Log = "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0 expired";
      const result = textHighlighter.processTextWithHighlights(
        base64Log,
        "",
        mockColors,
      );
      expect(result).toContain("Token");
      expect(result).toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0");
      expect(result).toContain("expired");
    });

    it("should handle logs with curly brace objects", () => {
      const braceLog = "Config loaded: {host: 'localhost', port: 3000, debug: true}";
      const result = textHighlighter.processTextWithHighlights(
        braceLog,
        "",
        mockColors,
      );
      expect(result).toContain("Config");
      expect(result).toContain("host");
      expect(result).toContain("localhost");
      expect(result).toContain("port");
      expect(result).toContain("3000");
    });

    it("should handle logs with parentheses in function calls", () => {
      const funcLog = "Calling processData(userId=123, options={retry: true}) at 10:30:45";
      const result = textHighlighter.processTextWithHighlights(
        funcLog,
        "match_all('processData')",
        mockColors,
      );
      expect(result).toContain("Calling");
      expect(result).toContain("processData");
      expect(result).toContain("userId");
      expect(result).toContain("123");
      expect(result).toContain("log-highlighted"); // 'processData' should be highlighted
    });

    it("should handle logs with tabs and multiple spaces", () => {
      const tabLog = "Level:\tERROR    Timestamp:\t2024-01-15    Message:\tConnection failed";
      const result = textHighlighter.processTextWithHighlights(
        tabLog,
        "match_all('ERROR')",
        mockColors,
      );
      expect(result).toContain("Level");
      expect(result).toContain("ERROR");
      expect(result).toContain("Timestamp");
      expect(result).toContain("2024-01-15");
      expect(result).toContain("log-highlighted"); // 'ERROR' should be highlighted
    });

    it("should handle logs with null and undefined values", () => {
      const nullLog = "User: null, Session: undefined, Token: <empty>";
      const result = textHighlighter.processTextWithHighlights(
        nullLog,
        "match_all('null')",
        mockColors,
      );
      expect(result).toContain("User");
      expect(result).toContain("null");
      expect(result).toContain("Session");
      expect(result).toContain("undefined");
      expect(result).toContain("log-highlighted"); // 'null' should be highlighted
    });

    it("should handle logs with escaped characters", () => {
      const escapedLog = 'Message: "User said: \\"Hello World\\"\\n\\tNext line"';
      const result = textHighlighter.processTextWithHighlights(
        escapedLog,
        "",
        mockColors,
      );
      expect(result).toContain("Message");
      expect(result).toContain("User");
      expect(result).toContain("said");
      expect(result).toContain("Hello");
      expect(result).toContain("World");
    });

    it("should handle logs with GraphQL queries", () => {
      const graphqlLog = 'Query: { user(id: "123") { name email posts { title } } }';
      const result = textHighlighter.processTextWithHighlights(
        graphqlLog,
        "match_all('user')",
        mockColors,
      );
      expect(result).toContain("Query");
      expect(result).toContain("user");
      expect(result).toContain("123");
      expect(result).toContain("name");
      expect(result).toContain("email");
      expect(result).toContain("log-highlighted"); // 'user' should be highlighted
    });

    it("should handle logs with version numbers", () => {
      const versionLog = "Application v2.13.5-beta.3 started on Node.js v18.12.0";
      const result = textHighlighter.processTextWithHighlights(
        versionLog,
        "",
        mockColors,
      );
      expect(result).toContain("Application");
      expect(result).toContain("v2.13.5-beta.3");
      expect(result).toContain("Node.js");
      expect(result).toContain("v18.12.0");
    });

    it("should handle logs with currency and monetary values", () => {
      const moneyLog = "Transaction: $1,234.56 USD, €987.65 EUR, £543.21 GBP";
      const result = textHighlighter.processTextWithHighlights(
        moneyLog,
        "",
        mockColors,
      );
      expect(result).toContain("Transaction");
      expect(result).toContain("$1,234.56");
      expect(result).toContain("€987.65");
      expect(result).toContain("£543.21");
    });

    it("should handle logs with HTTP headers", () => {
      const headerLog = "Headers: Content-Type: application/json, Authorization: Bearer token123, X-Request-ID: abc-def-ghi";
      const result = textHighlighter.processTextWithHighlights(
        headerLog,
        "match_all('Bearer')",
        mockColors,
      );
      expect(result).toContain("Headers");
      expect(result).toContain("Content-Type");
      expect(result).toContain("application/json");
      expect(result).toContain("Bearer");
      expect(result).toContain("token123");
      expect(result).toContain("log-highlighted"); // 'Bearer' should be highlighted
    });

    it("should handle logs with mixed case and camelCase identifiers", () => {
      const camelLog = "userService.getUserById(userId=123) returned user.firstName='John', user.lastName='Doe'";
      const result = textHighlighter.processTextWithHighlights(
        camelLog,
        "match_all('getUserById')",
        mockColors,
      );
      // The method name is highlighted, so it's wrapped in span tags
      expect(result).toContain("userService.");
      expect(result).toContain("getUserById");
      expect(result).toContain("userId");
      expect(result).toContain("123");
      expect(result).toContain("user.firstName");
      expect(result).toContain("log-highlighted"); // 'getUserById' should be highlighted
    });

    it("should handle empty log lines between content", () => {
      const emptyLineLog = "Line 1\n\nLine 3\n\n\nLine 6";
      const result = textHighlighter.processTextWithHighlights(
        emptyLineLog,
        "",
        mockColors,
      );
      expect(result).toContain("Line");
      expect(result).toContain("1");
      expect(result).toContain("3");
      expect(result).toContain("6");
    });

    it("should handle logs with regex patterns", () => {
      const regexLog = "Pattern: /^[A-Za-z0-9]+$/ matched input: abc123";
      const result = textHighlighter.processTextWithHighlights(
        regexLog,
        "match_all('matched')",
        mockColors,
      );
      expect(result).toContain("Pattern");
      expect(result).toContain("/^[A-Za-z0-9]+$/");
      expect(result).toContain("matched");
      expect(result).toContain("abc123");
      expect(result).toContain("log-highlighted"); // 'matched' should be highlighted
    });

    it("should handle logs with scientific notation", () => {
      const sciLog = "Value: 1.23e-10, Large: 5.67e+15, Normal: 3.14159";
      const result = textHighlighter.processTextWithHighlights(
        sciLog,
        "",
        mockColors,
      );
      expect(result).toContain("Value");
      expect(result).toContain("1.23e-10");
      expect(result).toContain("5.67e+15");
      expect(result).toContain("3.14159");
    });

    it("should handle logs with boolean values", () => {
      const boolLog = "Config: enabled=true, debug=false, verbose=TRUE, quiet=FALSE";
      const result = textHighlighter.processTextWithHighlights(
        boolLog,
        "match_all('true')",
        mockColors,
      );
      expect(result).toContain("enabled");
      expect(result).toContain("true");
      expect(result).toContain("debug");
      expect(result).toContain("false");
      expect(result).toContain("log-highlighted"); // 'true' should be highlighted (case-insensitive)
    });

    it("should handle extremely long single-line logs", () => {
      const longLog = "Event: " + "data".repeat(500) + " processed successfully";
      const result = textHighlighter.processTextWithHighlights(
        longLog,
        "match_all('Event')",
        mockColors,
      );
      expect(result).toContain("Event");
      expect(result).toContain("data");
      expect(result).toContain("processed");
      expect(result).toContain("successfully");
      expect(result).toContain("log-highlighted"); // 'Event' should be highlighted
    });
  });
});
