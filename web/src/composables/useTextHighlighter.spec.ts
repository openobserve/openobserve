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
      expect(result).toContain("Success message");
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
      expect(result).toContain("[timestamp]");
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
      expect(result).toContain("normal text");
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
      expect(result).toContain("<span");
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
      expect(result).toContain("double single double again");
    });
  });
});
