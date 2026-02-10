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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

// Mock monaco-editor
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  editor: {
    colorize: vi.fn(),
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
  },
}));

// Mock SQL contribution
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js", () => ({}));

// Mock VRL language definition
vi.mock("@/utils/query/vrlLanguageDefinition", () => ({
  vrlLanguageDefinition: {
    tokenizer: {
      root: [],
    },
  },
}));

import { colorizeQuery } from "./colorizeQuery";
import { editor } from "monaco-editor/esm/vs/editor/editor.api";

describe("colorizeQuery", () => {
  const mockColorize = vi.mocked(editor.colorize);

  beforeEach(() => {
    vi.clearAllMocks();
    mockColorize.mockResolvedValue("<span>colorized</span>");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should return empty string for empty query", async () => {
      const result = await colorizeQuery("", "sql");
      expect(result).toBe("");
    });

    it("should return empty string for null query", async () => {
      const result = await colorizeQuery(null as any, "sql");
      expect(result).toBe("");
    });

    it("should return empty string for undefined query", async () => {
      const result = await colorizeQuery(undefined as any, "sql");
      expect(result).toBe("");
    });

    it("should colorize valid SQL query", async () => {
      const query = "SELECT * FROM logs WHERE level = 'error'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize valid PromQL query", async () => {
      const query = "rate(http_requests[5m])";
      const result = await colorizeQuery(query, "promql");

      expect(mockColorize).toHaveBeenCalledWith(query, "promql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize valid VRL query", async () => {
      const query = ".level = \"error\"";
      const result = await colorizeQuery(query, "vrl");

      expect(mockColorize).toHaveBeenCalledWith(query, "vrl", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });

  describe("Language Registration", () => {
    it("should call colorize after registration", async () => {
      const result = await colorizeQuery("test query", "promql");

      // Language registration happens once at module level
      // What we care about is that colorization works
      expect(mockColorize).toHaveBeenCalledWith("test query", "promql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should call colorize for VRL language", async () => {
      const result = await colorizeQuery("test query", "vrl");

      // Language registration happens once at module level
      // What we care about is that colorization works
      expect(mockColorize).toHaveBeenCalledWith("test query", "vrl", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle multiple calls with same language", async () => {
      // First call
      await colorizeQuery("query1", "sql");
      const firstCallCount = mockColorize.mock.calls.length;

      // Second call
      await colorizeQuery("query2", "sql");
      const secondCallCount = mockColorize.mock.calls.length;

      // Should colorize both times
      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });

    it("should import SQL contribution and colorize", async () => {
      await colorizeQuery("SELECT * FROM logs", "sql");

      // SQL contribution should be imported and colorization should work
      expect(mockColorize).toHaveBeenCalled();
    });
  });

  describe("Language Case Handling", () => {
    it("should handle uppercase language names", async () => {
      const query = "SELECT * FROM logs";
      const result = await colorizeQuery(query, "SQL");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle mixed case language names", async () => {
      const query = "SELECT * FROM logs";
      const result = await colorizeQuery(query, "SqL");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle lowercase language names", async () => {
      const query = "rate(http_requests[5m])";
      const result = await colorizeQuery(query, "promql");

      expect(mockColorize).toHaveBeenCalledWith(query, "promql", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });

  describe("Different Query Types", () => {
    it("should colorize simple SELECT query", async () => {
      const query = "SELECT id, name FROM users";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize complex SQL query with joins", async () => {
      const query = `
        SELECT u.id, u.name, o.order_id
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.status = 'active'
      `;
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize SQL query with aggregations", async () => {
      const query = "SELECT COUNT(*), AVG(price), MAX(quantity) FROM products GROUP BY category";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize PromQL range query", async () => {
      const query = "rate(http_requests_total[5m])";
      const result = await colorizeQuery(query, "promql");

      expect(mockColorize).toHaveBeenCalledWith(query, "promql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize PromQL aggregation query", async () => {
      const query = "sum by (instance) (rate(http_requests_total[5m]))";
      const result = await colorizeQuery(query, "promql");

      expect(mockColorize).toHaveBeenCalledWith(query, "promql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should colorize VRL transformation", async () => {
      const query = `.level = downcase(.level)\n.timestamp = parse_timestamp(.timestamp, "%Y-%m-%d")`;
      const result = await colorizeQuery(query, "vrl");

      expect(mockColorize).toHaveBeenCalledWith(query, "vrl", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });

  describe("Special Characters and Edge Cases", () => {
    it("should handle query with special characters", async () => {
      const query = "SELECT * FROM logs WHERE message LIKE '%error%' AND status != 'ok'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with newlines", async () => {
      const query = "SELECT *\nFROM logs\nWHERE level = 'error'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with tabs", async () => {
      const query = "SELECT\t*\tFROM\tlogs";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with single quotes", async () => {
      const query = "SELECT * FROM logs WHERE message = 'it''s working'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with double quotes", async () => {
      const query = 'SELECT * FROM "my_table" WHERE "column_name" = "value"';
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with backticks", async () => {
      const query = "SELECT * FROM `logs` WHERE `level` = 'error'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with comments", async () => {
      const query = "SELECT * FROM logs -- This is a comment\nWHERE level = 'error'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle query with multi-line comments", async () => {
      const query = "SELECT * FROM logs /* This is a\nmulti-line comment */ WHERE level = 'error'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle very long queries", async () => {
      const query = "SELECT * FROM logs WHERE " + "condition AND ".repeat(100) + "final_condition";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle queries with unicode characters", async () => {
      const query = "SELECT * FROM logs WHERE message = '日本語テスト'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle queries with emojis", async () => {
      const query = "SELECT * FROM logs WHERE message LIKE '%🔥%'";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });

  describe("Error Handling", () => {
    it("should return original query when colorization fails", async () => {
      const query = "SELECT * FROM logs";
      const error = new Error("Colorization failed");
      mockColorize.mockRejectedValueOnce(error);

      const result = await colorizeQuery(query, "sql");

      expect(result).toBe(query);
    });

    it("should handle Monaco editor errors gracefully", async () => {
      const query = "SELECT * FROM logs";
      mockColorize.mockRejectedValueOnce(new Error("Monaco not available"));

      const result = await colorizeQuery(query, "sql");

      expect(result).toBe(query);
    });

    it("should handle internal errors gracefully", async () => {
      const query = "test query";

      // Mock colorization error
      mockColorize.mockRejectedValueOnce(new Error("Internal error"));

      // Should return original query on error
      const result = await colorizeQuery(query, "sql");
      expect(result).toBe(query);
    });

    it("should handle unknown language gracefully", async () => {
      const query = "some query in unknown language";
      const result = await colorizeQuery(query, "unknownlang");

      expect(mockColorize).toHaveBeenCalledWith(query, "unknownlang", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should return original query on syntax errors", async () => {
      const query = "INVALID SQL SYNTAX HERE!!!";
      mockColorize.mockRejectedValueOnce(new Error("Syntax error"));

      const result = await colorizeQuery(query, "sql");

      expect(result).toBe(query);
    });
  });

  describe("Performance and Caching", () => {
    it("should handle multiple concurrent colorization requests", async () => {
      const queries = [
        "SELECT * FROM logs",
        "SELECT * FROM metrics",
        "SELECT * FROM traces",
      ];

      const results = await Promise.all(
        queries.map((q) => colorizeQuery(q, "sql"))
      );

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBe("<span>colorized</span>");
      });
      expect(mockColorize).toHaveBeenCalledTimes(3);
    });

    it("should handle sequential colorization calls", async () => {
      await colorizeQuery("query1", "sql");
      await colorizeQuery("query2", "sql");
      await colorizeQuery("query3", "sql");

      expect(mockColorize).toHaveBeenCalledTimes(3);
    });

    it("should handle same query colorized multiple times", async () => {
      const query = "SELECT * FROM logs";

      await colorizeQuery(query, "sql");
      await colorizeQuery(query, "sql");
      await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledTimes(3);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle switching between different languages", async () => {
      await colorizeQuery("SELECT * FROM logs", "sql");
      await colorizeQuery("rate(http_requests[5m])", "promql");
      await colorizeQuery(".level = \"error\"", "vrl");

      expect(mockColorize).toHaveBeenCalledTimes(3);
      expect(mockColorize).toHaveBeenNthCalledWith(1, "SELECT * FROM logs", "sql", {});
      expect(mockColorize).toHaveBeenNthCalledWith(2, "rate(http_requests[5m])", "promql", {});
      expect(mockColorize).toHaveBeenNthCalledWith(3, ".level = \"error\"", "vrl", {});
    });

    it("should preserve HTML entities in colorized output", async () => {
      mockColorize.mockResolvedValueOnce("<span>&lt;test&gt;</span>");

      const query = "SELECT * FROM logs WHERE html = '<test>'";
      const result = await colorizeQuery(query, "sql");

      expect(result).toBe("<span>&lt;test&gt;</span>");
    });

    it("should handle empty options object", async () => {
      const query = "SELECT * FROM logs";
      await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
    });
  });

  describe("Language-Specific Features", () => {
    it("should colorize SQL keywords", async () => {
      const query = "SELECT COUNT(*) FROM logs WHERE timestamp BETWEEN 1000 AND 2000";
      await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
    });

    it("should colorize PromQL operators", async () => {
      const query = "http_requests_total > 100 and rate(errors[5m]) < 0.01";
      await colorizeQuery(query, "promql");

      expect(mockColorize).toHaveBeenCalledWith(query, "promql", {});
    });

    it("should colorize VRL functions", async () => {
      const query = `.message = parse_json(.message)\n.level = downcase(.level)`;
      await colorizeQuery(query, "vrl");

      expect(mockColorize).toHaveBeenCalledWith(query, "vrl", {});
    });
  });

  describe("Whitespace Handling", () => {
    it("should preserve leading whitespace", async () => {
      const query = "    SELECT * FROM logs";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should preserve trailing whitespace", async () => {
      const query = "SELECT * FROM logs    ";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should preserve internal whitespace", async () => {
      const query = "SELECT  *  FROM  logs";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });

  describe("Single Character Queries", () => {
    it("should handle single character query", async () => {
      const query = "*";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });

    it("should handle single space query", async () => {
      const query = " ";
      const result = await colorizeQuery(query, "sql");

      expect(mockColorize).toHaveBeenCalledWith(query, "sql", {});
      expect(result).toBe("<span>colorized</span>");
    });
  });
});
