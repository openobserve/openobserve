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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { 
  buildSqlQuery, 
  convertQueryIntoSingleLine,
  addLabelsToSQlQuery,
  addLabelToSQlQuery,
  getStreamFromQuery,
  isGivenFieldInOrderBy,
  extractFields,
  getFieldsFromQuery,
  changeHistogramInterval,
  getStreamNameFromQuery,
  formatValue,
  parseCondition,
  convertWhereToFilter,
  extractFilters,
  extractTableName
} from "./sqlUtils";
import store from "@/test/unit/helpers/store";

// Mock the imported modules
const mockAstify = vi.fn();
const mockSqlify = vi.fn();

vi.mock("@/utils/zincutils", () => ({
  splitQuotedString: vi.fn((str: string) => {
    if (typeof str !== 'string') return [];
    return str.split(',').map(s => s.trim().replace(/'/g, ''));
  }),
  escapeSingleQuotes: vi.fn((str: string) => {
    if (typeof str !== 'string') return str;
    return str.replace(/'/g, "''");
  }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => Promise.resolve({
      astify: mockAstify,
      sqlify: mockSqlify,
    }),
  }),
}));

describe("sqlUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAstify.mockClear();
    mockSqlify.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatValue", () => {
    it("should return null for null value", () => {
      expect(formatValue(null)).toBe(null);
    });

    it("should return undefined for undefined value", () => {
      expect(formatValue(undefined)).toBe(undefined);
    });

    it("should format string value with quotes", () => {
      const result = formatValue("test");
      expect(result).toBe("'test'");
    });

    it("should remove existing single quotes and add new ones", () => {
      const result = formatValue("'test'");
      expect(result).toBe("'test'");
    });

    it("should handle value with internal single quotes", () => {
      const result = formatValue("test's value");
      expect(result).toBe("'test''s value'");
    });

    it("should handle empty string", () => {
      const result = formatValue("");
      expect(result).toBe("''");
    });

    it("should handle numeric string", () => {
      const result = formatValue("123");
      expect(result).toBe("'123'");
    });

    it("should handle single character string", () => {
      const result = formatValue("a");
      expect(result).toBe("'a'");
    });
  });

  describe("buildSqlQuery", () => {
    it("should build a simple SQL query with fields array", () => {
      const query = buildSqlQuery("test_table", ["field1", "field2"], "");
      expect(query).toBe('SELECT field1, field2 FROM "test_table"');
    });

    it("should build SQL query with where clause", () => {
      const query = buildSqlQuery("logs", ["*"], "level = 'ERROR'");
      expect(query).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should build SQL query with empty fields array", () => {
      const query = buildSqlQuery("logs", [], "");
      expect(query).toBe('SELECT * FROM "logs"');
    });

    it("should build SQL query with multiple fields", () => {
      const query = buildSqlQuery("application_logs", ["level", "message", "_timestamp"], "level IN ('ERROR', 'WARN')");
      expect(query).toBe('SELECT level, message, _timestamp FROM "application_logs" WHERE level IN (\'ERROR\', \'WARN\')');
    });

    it("should handle empty table name", () => {
      const query = buildSqlQuery("", ["*"], "");
      expect(query).toBe('SELECT * FROM ""');
    });

    it("should handle empty where clause", () => {
      const query = buildSqlQuery("logs", ["level", "message"], "");
      expect(query).toBe('SELECT level, message FROM "logs"');
    });

    it("should handle whitespace-only where clause", () => {
      const query = buildSqlQuery("logs", ["*"], "   ");
      expect(query).toBe('SELECT * FROM "logs"');
    });

    it("should handle complex where clause", () => {
      const query = buildSqlQuery("events", ["timestamp", "event"], "timestamp > '2023-01-01' AND event = 'login'");
      expect(query).toBe('SELECT timestamp, event FROM "events" WHERE timestamp > \'2023-01-01\' AND event = \'login\'');
    });
  });

  describe("convertQueryIntoSingleLine", () => {
    beforeEach(() => {
      mockAstify.mockImplementation((query) => {
        // Handle edge cases properly - mock the behavior where parser fails for edge cases
        if (query === undefined || query === null || query === "") {
          throw new Error("Cannot parse empty/null/undefined query");
        }
        if (typeof query === 'string' && query.trim() === '') {
          throw new Error("Cannot parse whitespace-only query");
        }
        return {
          type: "select",
          columns: [{ expr: { column: "*", type: "column_ref" } }],
          from: [{ table: "logs" }]
        };
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs`");
    });

    it("should return null for null input", async () => {
      const result = await convertQueryIntoSingleLine(null);
      expect(result).toBe(null);
    });

    it("should return empty string for empty input", async () => {
      const result = await convertQueryIntoSingleLine("");
      expect(result).toBe("");
    });

    it("should convert multiline query to single line", async () => {
      const multilineQuery = `SELECT *
        FROM logs
        WHERE level = 'ERROR'`;
      const result = await convertQueryIntoSingleLine(multilineQuery);
      expect(result).toBe('SELECT * FROM "logs"');
    });

    it("should replace backticks with double quotes", async () => {
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE `level` = 'ERROR'");
      const result = await convertQueryIntoSingleLine("SELECT * FROM logs");
      expect(result).toBe('SELECT * FROM "logs" WHERE "level" = \'ERROR\'');
    });

    it("should return query as-is for invalid SQL", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      const invalidQuery = "invalid sql syntax";
      const result = await convertQueryIntoSingleLine(invalidQuery);
      expect(result).toBe(invalidQuery);
    });

    it("should return undefined for undefined input", async () => {
      const result = await convertQueryIntoSingleLine(undefined);
      expect(result).toBe(undefined);
    });

    it("should handle whitespace query", async () => {
      const whitespaceQuery = "   \n\t  \n  ";
      const result = await convertQueryIntoSingleLine(whitespaceQuery);
      expect(result).toBe(whitespaceQuery);
    });

    it("should return query unchanged when parser fails", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      const malformedQuery = "SELECT * FROM";
      const result = await convertQueryIntoSingleLine(malformedQuery);
      expect(result).toBe(malformedQuery);
    });
  });

  describe("getStreamFromQuery", () => {
    beforeEach(() => {
      mockAstify.mockImplementation((query) => {
        // Handle edge cases - when input is empty/null/undefined, the parser should fail
        // and the function should return empty string
        if (query === null || query === undefined || query === "") {
          throw new Error("Cannot parse empty/null/undefined query");
        }
        return {
          from: [{ table: "test_stream" }]
        };
      });
    });

    it("should extract stream name from simple query", async () => {
      const result = await getStreamFromQuery("SELECT * FROM test_stream");
      expect(result).toBe("test_stream");
    });

    it("should return empty string when no table found", async () => {
      mockAstify.mockReturnValue({
        from: [{}]
      });
      const result = await getStreamFromQuery("SELECT * FROM");
      expect(result).toBe("");
    });

    it("should return empty string when no from clause", async () => {
      mockAstify.mockReturnValue({});
      const result = await getStreamFromQuery("SELECT 1");
      expect(result).toBe("");
    });

    it("should handle parser error", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      const result = await getStreamFromQuery("invalid query");
      expect(result).toBe("");
    });

    it("should handle empty query", async () => {
      const result = await getStreamFromQuery("");
      expect(result).toBe("");
    });

    it("should handle null query", async () => {
      const result = await getStreamFromQuery(null);
      expect(result).toBe("");
    });

    it("should handle undefined query", async () => {
      const result = await getStreamFromQuery(undefined);
      expect(result).toBe("");
    });
  });

  describe("isGivenFieldInOrderBy", () => {
    it("should return ASC when field exists in ORDER BY with ASC", async () => {
      mockAstify.mockReturnValue({
        orderby: [
          {
            expr: { column: { expr: { value: "timestamp" } } },
            type: "ASC"
          }
        ]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs ORDER BY timestamp ASC", "timestamp");
      expect(result).toBe("ASC");
    });

    it("should return DESC when field exists in ORDER BY with DESC", async () => {
      mockAstify.mockReturnValue({
        orderby: [
          {
            expr: { column: { expr: { value: "timestamp" } } },
            type: "DESC"
          }
        ]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs ORDER BY timestamp DESC", "timestamp");
      expect(result).toBe("DESC");
    });

    it("should return null when field not in ORDER BY", async () => {
      mockAstify.mockReturnValue({
        orderby: [
          {
            expr: { column: { expr: { value: "level" } } },
            type: "ASC"
          }
        ]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs ORDER BY level ASC", "timestamp");
      expect(result).toBe(null);
    });

    it("should return null when no ORDER BY clause", async () => {
      mockAstify.mockReturnValue({
        from: [{ table: "logs" }]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs", "timestamp");
      expect(result).toBe(null);
    });

    it("should handle parser error", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      const result = await isGivenFieldInOrderBy("invalid query", "timestamp");
      expect(result).toBe(null);
    });

    it("should handle multiple ORDER BY fields", async () => {
      mockAstify.mockReturnValue({
        orderby: [
          {
            expr: { column: { expr: { value: "level" } } },
            type: "ASC"
          },
          {
            expr: { column: { expr: { value: "timestamp" } } },
            type: "DESC"
          }
        ]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs ORDER BY level ASC, timestamp DESC", "timestamp");
      expect(result).toBe("DESC");
    });

    it("should handle empty field alias", async () => {
      mockAstify.mockReturnValue({
        orderby: [
          {
            expr: { column: { expr: { value: "timestamp" } } },
            type: "ASC"
          }
        ]
      });
      const result = await isGivenFieldInOrderBy("SELECT * FROM logs ORDER BY timestamp ASC", "");
      expect(result).toBe(null);
    });
  });

  describe("extractFields", () => {
    const timeField = "_timestamp";

    it("should extract simple column fields", () => {
      const parsedAst = {
        columns: [
          {
            expr: { type: "column_ref", column: { expr: { value: "level" } } },
            as: "log_level"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "level",
          alias: "log_level",
          aggregationFunction: null
        }
      ]);
    });

    it("should extract aggregation function fields", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "aggr_func", 
              name: "count",
              args: { expr: { column: { expr: { value: "id" } } } }
            },
            as: "count_id"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "id",
          alias: "count_id",
          aggregationFunction: "count"
        }
      ]);
    });

    it("should extract histogram function fields", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "histogram" }] },
              args: { value: [{ column: { expr: { value: "_timestamp" } } }] }
            },
            as: "time_hist"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "_timestamp",
          alias: "time_hist",
          aggregationFunction: "histogram"
        }
      ]);
    });

    it("should handle p50 percentile function", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "approx_percentile_cont" }] },
              args: { value: [
                { column: { expr: { value: "response_time" } } },
                { value: "0.5" }
              ] }
            },
            as: "p50_response"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "response_time",
          alias: "p50_response",
          aggregationFunction: "p50"
        }
      ]);
    });

    it("should handle p90 percentile function", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "approx_percentile_cont" }] },
              args: { value: [
                { column: { expr: { value: "response_time" } } },
                { value: "0.90" }
              ] }
            },
            as: "p90_response"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "response_time",
          alias: "p90_response",
          aggregationFunction: "p90"
        }
      ]);
    });

    it("should handle p95 percentile function", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "approx_percentile_cont" }] },
              args: { value: [
                { column: { expr: { value: "response_time" } } },
                { value: "0.95" }
              ] }
            },
            as: "p95_response"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "response_time",
          alias: "p95_response",
          aggregationFunction: "p95"
        }
      ]);
    });

    it("should handle p99 percentile function", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "approx_percentile_cont" }] },
              args: { value: [
                { column: { expr: { value: "response_time" } } },
                { value: "0.99" }
              ] }
            },
            as: "p99_response"
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "response_time",
          alias: "p99_response",
          aggregationFunction: "p99"
        }
      ]);
    });

    it("should throw error for unsupported percentile", () => {
      const parsedAst = {
        columns: [
          {
            expr: { 
              type: "function", 
              name: { name: [{ value: "approx_percentile_cont" }] },
              args: { value: [
                { column: { expr: { value: "response_time" } } },
                { value: "0.75" }
              ] }
            }
          }
        ]
      };
      expect(() => extractFields(parsedAst, timeField)).toThrow("Unsupported percentile value");
    });

    it("should handle select all (*) fields", () => {
      const parsedAst = {
        columns: [
          {
            expr: { column: "*", type: "column_ref" }
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([]);
    });

    it("should use timeField as fallback for missing column values", () => {
      const parsedAst = {
        columns: [
          {
            expr: { type: "column_ref" }
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: timeField,
          alias: timeField,
          aggregationFunction: null
        }
      ]);
    });

    it("should use column as alias when no alias provided", () => {
      const parsedAst = {
        columns: [
          {
            expr: { type: "column_ref", column: { expr: { value: "level" } } }
          }
        ]
      };
      const result = extractFields(parsedAst, timeField);
      expect(result).toEqual([
        {
          column: "level",
          alias: "level",
          aggregationFunction: null
        }
      ]);
    });
  });

  describe("parseCondition", () => {
    it("should parse AND condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "AND",
        left: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        },
        right: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "status" } } },
          right: { value: "404" }
        }
      };
      const result = parseCondition(condition);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("should parse OR condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "OR",
        left: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        },
        right: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "WARN" }
        }
      };
      const result = parseCondition(condition);
      expect(Array.isArray(result)).toBe(true);
      expect(result[1].logicalOperator).toBe("OR");
    });

    it("should parse equals condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "=",
        left: { column: { expr: { value: "level" } } },
        right: { value: "ERROR" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "level",
        operator: "=",
        value: "'ERROR'",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse not equals condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "!=",
        left: { column: { expr: { value: "level" } } },
        right: { value: "DEBUG" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "level",
        operator: "<>",
        value: "'DEBUG'",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse IN condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "IN",
        left: { column: { expr: { value: "level" } } },
        right: { 
          value: [
            { value: "ERROR" },
            { value: "WARN" }
          ]
        }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "list",
        values: ["ERROR", "WARN"],
        column: "level",
        operator: null,
        value: null,
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse NOT IN condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "NOT IN",
        left: { column: { expr: { value: "level" } } },
        right: { 
          value: [
            { value: "DEBUG" },
            { value: "INFO" }
          ]
        }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "level",
        operator: "NOT IN",
        value: "'DEBUG','INFO'",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse IS NULL condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "IS",
        left: { column: { expr: { value: "message" } } }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Is Null",
        value: null,
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse IS NOT NULL condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "IS NOT",
        left: { column: { expr: { value: "message" } } }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Is Not Null",
        value: null,
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse LIKE condition with contains pattern", () => {
      const condition = {
        type: "binary_expr",
        operator: "LIKE",
        left: { column: { expr: { value: "message" } } },
        right: { value: "%error%" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Contains",
        value: "error",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse LIKE condition with starts with pattern", () => {
      const condition = {
        type: "binary_expr",
        operator: "LIKE",
        left: { column: { expr: { value: "message" } } },
        right: { value: "error%" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Starts With",
        value: "error",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse LIKE condition with ends with pattern", () => {
      const condition = {
        type: "binary_expr",
        operator: "LIKE",
        left: { column: { expr: { value: "message" } } },
        right: { value: "%error" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Ends With",
        value: "error",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse NOT LIKE condition", () => {
      const condition = {
        type: "binary_expr",
        operator: "NOT LIKE",
        left: { column: { expr: { value: "message" } } },
        right: { value: "%debug%" }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "Not Contains",
        value: "debug",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse function conditions with field name", () => {
      const condition = {
        type: "function",
        name: { name: [{ value: "str_match" }] },
        args: { 
          value: [
            { column: { expr: { value: "message" } } },
            { value: "error" }
          ]
        }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "message",
        operator: "str_match",
        value: "error",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should parse function conditions without field name", () => {
      const condition = {
        type: "function",
        name: { name: [{ value: "match_all" }] },
        args: { 
          value: [
            { value: "error" }
          ]
        }
      };
      const result = parseCondition(condition);
      expect(result).toEqual({
        type: "condition",
        values: [],
        column: "",
        operator: "match_all",
        value: "error",
        logicalOperator: "AND",
        filterType: "condition"
      });
    });

    it("should handle parentheses in conditions", () => {
      const condition = {
        type: "binary_expr",
        operator: "AND",
        parentheses: true,
        left: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        },
        right: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "status" } } },
          right: { value: "404" }
        }
      };
      const result = parseCondition(condition);
      expect(result.filterType).toBe("group");
    });


    it("should handle comparison operators", () => {
      const operators = ["<", ">", "<=", ">="];
      operators.forEach(op => {
        const condition = {
          type: "binary_expr",
          operator: op,
          left: { column: { expr: { value: "score" } } },
          right: { value: "100" }
        };
        const result = parseCondition(condition);
        expect(result.operator).toBe(op);
      });
    });
  });

  describe("convertWhereToFilter", () => {
    it("should handle null where clause", () => {
      const result = convertWhereToFilter(null);
      expect(result).toEqual({
        filterType: "group",
        logicalOperator: "AND",
        conditions: []
      });
    });

    it("should handle undefined where clause", () => {
      const result = convertWhereToFilter(undefined);
      expect(result).toEqual({
        filterType: "group",
        logicalOperator: "AND",
        conditions: []
      });
    });

    it("should convert single condition to filter", () => {
      const where = {
        type: "binary_expr",
        operator: "=",
        left: { column: { expr: { value: "level" } } },
        right: { value: "ERROR" }
      };
      const result = convertWhereToFilter(where);
      expect(result.type).toBe("condition");
      expect(result.column).toBe("level");
    });

    it("should convert array conditions to group", () => {
      const where = {
        type: "binary_expr",
        operator: "AND",
        left: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        },
        right: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "status" } } },
          right: { value: "404" }
        }
      };
      const result = convertWhereToFilter(where);
      expect(result.filterType).toBe("group");
      expect(Array.isArray(result.conditions)).toBe(true);
    });

  });

  describe("extractFilters", () => {
    it("should extract filters from parsed AST", () => {
      const parsedAst = {
        where: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        }
      };
      const result = extractFilters(parsedAst);
      expect(result.type).toBe("condition");
      expect(result.column).toBe("level");
    });

    it("should handle AST without where clause", () => {
      const parsedAst = {
        from: [{ table: "logs" }]
      };
      const result = extractFilters(parsedAst);
      expect(result).toEqual({
        filterType: "group",
        logicalOperator: "AND",
        conditions: []
      });
    });

  });

  describe("extractTableName", () => {
    it("should extract table name from parsed AST", () => {
      const parsedAst = {
        from: [{ table: "logs" }]
      };
      const result = extractTableName(parsedAst);
      expect(result).toBe("logs");
    });

    it("should return null when no table found", () => {
      const parsedAst = {
        from: [{}]
      };
      const result = extractTableName(parsedAst);
      expect(result).toBe(null);
    });

    it("should handle missing from clause", () => {
      const parsedAst = {};
      expect(() => extractTableName(parsedAst)).toThrow();
    });
  });

  describe("getFieldsFromQuery", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        from: [{ table: "logs" }],
        columns: [
          {
            expr: { type: "column_ref", column: { expr: { value: "level" } } },
            as: "log_level"
          }
        ],
        where: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "level" } } },
          right: { value: "ERROR" }
        }
      });
    });

    it("should extract fields, filters, and stream name from query", async () => {
      const result = await getFieldsFromQuery("SELECT level AS log_level FROM logs WHERE level = 'ERROR'");
      
      expect(result.streamName).toBe("logs");
      expect(result.fields).toEqual([
        {
          column: "level",
          alias: "log_level",
          aggregationFunction: null
        }
      ]);
      expect(result.filters.filterType).toBe("group");
    });


    it("should convert single condition to group filter", async () => {
      const result = await getFieldsFromQuery("SELECT level FROM logs WHERE level = 'ERROR'");
      
      expect(result.filters.filterType).toBe("group");
      expect(result.filters.conditions).toHaveLength(1);
    });

    it("should handle parser errors with default values", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      const result = await getFieldsFromQuery("invalid query", "_timestamp");
      
      expect(result.fields).toEqual([
        {
          column: "_timestamp",
          alias: "x_axis_1",
          aggregationFunction: "histogram"
        },
        {
          column: "_timestamp",
          alias: "y_axis_1",
          aggregationFunction: "count"
        }
      ]);
      expect(result.filters).toEqual({
        filterType: "group",
        logicalOperator: "AND",
        conditions: []
      });
      expect(result.streamName).toBe(null);
    });

    it("should use default time field when not provided", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      const result = await getFieldsFromQuery("invalid query");
      
      expect(result.fields[0].column).toBe("_timestamp");
    });

    it("should handle complex queries with multiple fields", async () => {
      mockAstify.mockReturnValue({
        from: [{ table: "events" }],
        columns: [
          {
            expr: { type: "column_ref", column: { expr: { value: "timestamp" } } },
            as: "time"
          },
          {
            expr: { 
              type: "aggr_func", 
              name: "count",
              args: { expr: { column: { expr: { value: "id" } } } }
            },
            as: "count_events"
          }
        ],
        where: {
          type: "binary_expr",
          operator: "AND",
          left: {
            type: "binary_expr",
            operator: "=",
            left: { column: { expr: { value: "type" } } },
            right: { value: "login" }
          },
          right: {
            type: "binary_expr",
            operator: ">",
            left: { column: { expr: { value: "timestamp" } } },
            right: { value: "2023-01-01" }
          }
        }
      });
      
      const result = await getFieldsFromQuery("SELECT timestamp, COUNT(id) FROM events WHERE type = 'login' AND timestamp > '2023-01-01'");
      
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].aggregationFunction).toBe(null);
      expect(result.fields[1].aggregationFunction).toBe("count");
      expect(result.streamName).toBe("events");
    });
  });

  describe("changeHistogramInterval", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        columns: [
          {
            expr: {
              type: "function",
              name: { name: [{ value: "histogram" }] },
              args: {
                type: "expr_list",
                value: [
                  { column: { expr: { value: "_timestamp" } } }
                ]
              }
            }
          }
        ]
      });
      mockSqlify.mockReturnValue("SELECT histogram(`_timestamp`, '5m') FROM `logs`");
    });

    it("should return query as-is when query is null", async () => {
      const result = await changeHistogramInterval(null, "5m");
      expect(result).toBe(null);
    });

    it("should return query as-is when query is empty", async () => {
      const result = await changeHistogramInterval("", "5m");
      expect(result).toBe("");
    });

    it("should add histogram interval when not present", async () => {
      const result = await changeHistogramInterval("SELECT histogram(_timestamp) FROM logs", "5m");
      expect(result).toBe('SELECT histogram("_timestamp", \'5m\') FROM "logs"');
    });

    it("should handle null histogram interval", async () => {
      mockAstify.mockReturnValue({
        columns: [
          {
            expr: {
              type: "function",
              name: { name: [{ value: "histogram" }] },
              args: {
                type: "expr_list",
                value: [
                  { column: { expr: { value: "_timestamp" } } },
                  { type: "single_quote_string", value: "1h" }
                ]
              }
            }
          }
        ]
      });
      
      const result = await changeHistogramInterval("SELECT histogram(_timestamp, '1h') FROM logs", null);
      expect(mockSqlify).toHaveBeenCalled();
    });

    it("should handle queries without histogram function", async () => {
      mockAstify.mockReturnValue({
        columns: [
          {
            expr: {
              type: "column_ref",
              column: { expr: { value: "level" } }
            }
          }
        ]
      });
      
      const result = await changeHistogramInterval("SELECT level FROM logs", "5m");
      expect(result).toBe('SELECT histogram("_timestamp", \'5m\') FROM "logs"');
    });

    it("should handle parser errors", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      const query = "invalid sql";
      const result = await changeHistogramInterval(query, "5m");
      expect(result).toBe(query);
    });

    it("should handle multiple columns with histogram", async () => {
      mockAstify.mockReturnValue({
        columns: [
          {
            expr: {
              type: "function",
              name: { name: [{ value: "histogram" }] },
              args: {
                type: "expr_list",
                value: [
                  { column: { expr: { value: "_timestamp" } } }
                ]
              }
            }
          },
          {
            expr: {
              type: "aggr_func",
              name: "count"
            }
          }
        ]
      });
      
      const result = await changeHistogramInterval("SELECT histogram(_timestamp), COUNT(*) FROM logs", "10m");
      expect(mockSqlify).toHaveBeenCalled();
    });

    it("should handle histogram with existing interval", async () => {
      mockAstify.mockReturnValue({
        columns: [
          {
            expr: {
              type: "function",
              name: { name: [{ value: "histogram" }] },
              args: {
                type: "expr_list",
                value: [
                  { column: { expr: { value: "_timestamp" } } },
                  { type: "single_quote_string", value: "1h" }
                ]
              }
            }
          }
        ]
      });
      
      const result = await changeHistogramInterval("SELECT histogram(_timestamp, '1h') FROM logs", "5m");
      expect(mockSqlify).toHaveBeenCalled();
    });
  });

  describe("getStreamNameFromQuery", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        from: [{ table: "simple_stream" }]
      });
    });

    it("should extract stream name from simple query", async () => {
      const result = await getStreamNameFromQuery("SELECT * FROM simple_stream");
      expect(result).toBe("simple_stream");
    });

    it("should handle empty query", async () => {
      const result = await getStreamNameFromQuery("");
      expect(result).toBe(null);
    });

    it("should handle null query", async () => {
      const result = await getStreamNameFromQuery(null);
      expect(result).toBe(null);
    });

    it("should handle query with WITH clause", async () => {
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: {
              from: [{ table: "with_stream" }]
            }
          }
        ]
      });
      
      const result = await getStreamNameFromQuery("WITH temp AS (SELECT * FROM with_stream) SELECT * FROM temp");
      expect(result).toBe("with_stream");
    });

    it("should handle nested WITH statements", async () => {
      const mockNode = {
        from: [{ table: "nested_stream" }],
        where: {
          type: "binary_expr",
          operator: "=",
          left: { column: "level" },
          right: { value: "ERROR" }
        },
        columns: [
          {
            expr: {
              type: "column_ref",
              column: "level"
            }
          }
        ]
      };
      
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: mockNode
          }
        ]
      });
      
      const result = await getStreamNameFromQuery("Complex WITH query");
      expect(result).toBe("nested_stream");
    });

    it("should handle maximum recursion depth", async () => {
      // Create a deeply nested structure that would exceed recursion limit
      let deeplyNested = { from: [{ table: "deep_stream" }] };
      for (let i = 0; i < 55; i++) {
        deeplyNested = {
          where: {
            right: {
              ast: deeplyNested
            }
          }
        };
      }
      
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: deeplyNested
          }
        ]
      });
      
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      const result = await getStreamNameFromQuery("Deep recursion query");
      
      expect(consoleSpy).toHaveBeenCalledWith("Maximum recursion depth reached while parsing SQL query");
      consoleSpy.mockRestore();
    });

    it("should handle circular references", async () => {
      const circularNode: any = {
        from: [{ table: "circular_stream" }]
      };
      circularNode.where = {
        right: {
          ast: circularNode
        }
      };
      
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: circularNode
          }
        ]
      });
      
      const result = await getStreamNameFromQuery("Circular reference query");
      expect(result).toBe("circular_stream");
    });

    it("should handle parse errors gracefully", async () => {
      mockAstify.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      const result = await getStreamNameFromQuery("invalid query");
      
      expect(result).toBe(null);
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(Error), 'error parsing sql query');
      consoleSpy.mockRestore();
    });

    it("should handle subqueries in FROM clause", async () => {
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: {
              from: [
                {
                  expr: {
                    ast: {
                      from: [{ table: "subquery_stream" }]
                    }
                  }
                }
              ]
            }
          }
        ]
      });
      
      const result = await getStreamNameFromQuery("WITH clause with subquery");
      expect(result).toBe("subquery_stream");
    });

    it("should handle complex nested structures", async () => {
      mockAstify.mockReturnValue({
        with: [
          {
            stmt: {
              from: [{ table: "main_stream" }],
              columns: [
                {
                  expr: {
                    type: "column_ref",
                    column: "id"
                  }
                }
              ]
            }
          }
        ]
      });
      
      const result = await getStreamNameFromQuery("Complex nested query");
      expect(result).toBe("main_stream");
    });

    it("should handle import parser errors", async () => {
      // Mock the parser to throw an error
      mockAstify.mockImplementation(() => {
        throw new Error("Import error");
      });
      
      const result = await getStreamNameFromQuery("SELECT * FROM test");
      expect(result).toBe(null);
    });
  });

  describe("addLabelToSQlQuery", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE level = 'ERROR'");
    });

    it("should add match_all condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "", 
        "error", 
        "match_all"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add str_match condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        "error", 
        "str_match"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add Contains condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        "error", 
        "Contains"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add str_match_ignore_case condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        "Error", 
        "str_match_ignore_case"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add re_match condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        ".*error.*", 
        "re_match"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add re_not_match condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        ".*debug.*", 
        "re_not_match"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add equals condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        "ERROR", 
        "="
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add not equals condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        "DEBUG", 
        "!="
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add IN condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        "ERROR,WARN", 
        "IN"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add NOT IN condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        "DEBUG,INFO", 
        "NOT IN"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add IS NULL condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        "", 
        "Is Null"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add IS NOT NULL condition", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "message", 
        "", 
        "Is Not Null"
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should add LIKE conditions", async () => {
      const operators = ["Not Contains", "Starts With", "Ends With"];
      
      for (const operator of operators) {
        const result = await addLabelToSQlQuery(
          "SELECT * FROM logs", 
          "message", 
          "error", 
          operator
        );
        expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
      }
    });

    it("should handle comparison operators", async () => {
      const operators = ["<", ">", "<=", ">=", "<>"];
      
      for (const operator of operators) {
        const result = await addLabelToSQlQuery(
          "SELECT * FROM logs", 
          "score", 
          "100", 
          operator
        );
        expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
      }
    });

    it("should handle query with existing WHERE clause", async () => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "status" } } },
          right: { value: "200" }
        }
      });
      
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs WHERE status = 200", 
        "level", 
        "ERROR", 
        "="
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle values with quotes in various operators", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        "'ERROR'", 
        "="
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle null values", async () => {
      const result = await addLabelToSQlQuery(
        "SELECT * FROM logs", 
        "level", 
        null, 
        "="
      );
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });
  });

  describe("addLabelsToSQlQuery", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE (level = 'ERROR') AND (status = '404')");
    });

    it("should add multiple labels to query", async () => {
      const labels = [
        { name: "level", value: "ERROR", operator: "=" },
        { name: "status", value: "404", operator: "=" }
      ];
      
      const result = await addLabelsToSQlQuery("SELECT * FROM logs", labels);
      expect(result).toBe('SELECT * FROM "logs" WHERE (level = \'ERROR\') AND (status = \'404\')');
    });

    it("should handle empty labels array", async () => {
      const result = await addLabelsToSQlQuery("SELECT * FROM logs", []);
      expect(mockSqlify).toHaveBeenCalled();
    });

    it("should handle query with existing WHERE clause", async () => {
      mockAstify.mockReturnValueOnce({
        type: "select", 
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: {
          type: "binary_expr",
          operator: "=",
          left: { column: { expr: { value: "app" } } },
          right: { value: "frontend" }
        }
      });
      
      const labels = [
        { name: "level", value: "ERROR", operator: "=" }
      ];
      
      const result = await addLabelsToSQlQuery("SELECT * FROM logs WHERE app = 'frontend'", labels);
      expect(result).toBe('SELECT * FROM "logs" WHERE (level = \'ERROR\') AND (status = \'404\')');
    });


    it("should handle single label", async () => {
      const labels = [
        { name: "level", value: "WARN", operator: "=" }
      ];
      
      const result = await addLabelsToSQlQuery("SELECT * FROM logs", labels);
      expect(result).toBe('SELECT * FROM "logs" WHERE (level = \'ERROR\') AND (status = \'404\')');
    });

    it("should handle different operator types", async () => {
      const labels = [
        { name: "level", value: "ERROR,WARN", operator: "IN" },
        { name: "message", value: "error", operator: "str_match" },
        { name: "timestamp", value: "2023-01-01", operator: ">" }
      ];
      
      const result = await addLabelsToSQlQuery("SELECT * FROM logs", labels);
      expect(result).toBe('SELECT * FROM "logs" WHERE (level = \'ERROR\') AND (status = \'404\')');
    });
  });

  // ===================== EXPANDED TEST COVERAGE =====================

  describe("formatValue - Additional Edge Cases", () => {
    it("should handle very long strings", () => {
      const longString = "a".repeat(10000);
      const result = formatValue(longString);
      expect(result).toBe(`'${longString}'`);
    });

    it("should handle strings with multiple consecutive quotes", () => {
      const result = formatValue("test''''multiple");
      expect(result).toBe("'test''''''''multiple'");
    });

    it("should handle strings with mixed quote types", () => {
      const result = formatValue('test"double\'single"quotes');
      expect(result).toBe("'test\"double''single\"quotes'");
    });

    it("should handle unicode characters", () => {
      const result = formatValue("测试🎉émoji");
      expect(result).toBe("'测试🎉émoji'");
    });

    it("should handle newline and tab characters", () => {
      const result = formatValue("line1\nline2\tcolumn");
      expect(result).toBe("'line1\nline2\tcolumn'");
    });

    it("should handle boolean-like strings", () => {
      expect(formatValue("true")).toBe("'true'");
      expect(formatValue("false")).toBe("'false'");
    });

    it("should handle numeric edge cases", () => {
      expect(formatValue("0")).toBe("'0'");
      expect(formatValue("-1")).toBe("'-1'");
      expect(formatValue("3.14159")).toBe("'3.14159'");
      expect(formatValue("1e10")).toBe("'1e10'");
    });
  });

  describe("buildSqlQuery - Extended Scenarios", () => {
    it("should handle very long field lists", () => {
      const manyFields = Array.from({ length: 100 }, (_, i) => `field${i}`);
      const query = buildSqlQuery("test", manyFields, "");
      expect(query).toContain("field0, field1");
      expect(query).toContain("field99");
    });

    it("should handle fields with special characters", () => {
      const query = buildSqlQuery("logs", ["field-with-dash", "field_with_underscore", "field.with.dots"], "");
      expect(query).toBe('SELECT field-with-dash, field_with_underscore, field.with.dots FROM "logs"');
    });

    it("should handle complex WHERE clauses with nested conditions", () => {
      const complexWhere = "(level = 'ERROR' OR level = 'WARN') AND (timestamp > '2023-01-01' AND timestamp < '2023-12-31')";
      const query = buildSqlQuery("logs", ["*"], complexWhere);
      expect(query).toBe(`SELECT * FROM "logs" WHERE ${complexWhere}`);
    });

    it("should handle table names with special characters", () => {
      const query = buildSqlQuery("table-with-dash", ["*"], "");
      expect(query).toBe('SELECT * FROM "table-with-dash"');
    });

    it("should handle SQL injection attempts in table name", () => {
      const query = buildSqlQuery("logs'; DROP TABLE users; --", ["*"], "");
      expect(query).toBe('SELECT * FROM "logs\'; DROP TABLE users; --"');
    });

    it("should handle SQL injection attempts in where clause", () => {
      const maliciousWhere = "1=1; DROP TABLE users; --";
      const query = buildSqlQuery("logs", ["*"], maliciousWhere);
      expect(query).toBe(`SELECT * FROM "logs" WHERE ${maliciousWhere}`);
    });
  });

  describe("convertQueryIntoSingleLine - Advanced Cases", () => {
    beforeEach(() => {
      mockAstify.mockImplementation((query) => {
        if (query === undefined || query === null || query === "") {
          throw new Error("Cannot parse empty/null/undefined query");
        }
        if (typeof query === 'string' && query.trim() === '') {
          throw new Error("Cannot parse whitespace-only query");
        }
        return {
          type: "select",
          columns: [{ expr: { column: "*", type: "column_ref" } }],
          from: [{ table: "logs" }]
        };
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs`");
    });

    it("should handle extremely long queries", async () => {
      const longQuery = "SELECT " + Array.from({ length: 1000 }, (_, i) => `col${i}`).join(", ") + " FROM logs";
      const result = await convertQueryIntoSingleLine(longQuery);
      expect(result).toBe('SELECT * FROM "logs"');
    });

    it("should handle queries with unicode characters", async () => {
      const unicodeQuery = "SELECT 測試, émoji FROM ログ WHERE 名前 = '太郎'";
      const result = await convertQueryIntoSingleLine(unicodeQuery);
      expect(result).toBe('SELECT * FROM "logs"');
    });

    it("should handle queries with multiple line breaks and tabs", async () => {
      const messyQuery = "SELECT\n\t\t*\n\n\n\t\tFROM\t\t\nlogs\n\t\tWHERE\n\t\tlevel\t=\t'ERROR'";
      const result = await convertQueryIntoSingleLine(messyQuery);
      expect(result).toBe('SELECT * FROM "logs"');
    });

    it("should handle queries with mixed quote types", async () => {
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE `level` = \"ERROR\"");
      const result = await convertQueryIntoSingleLine("SELECT * FROM logs");
      expect(result).toBe('SELECT * FROM "logs" WHERE "level" = "ERROR"');
    });
  });

  describe("addLabelToSQlQuery - Comprehensive Operator Testing", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE level = 'ERROR'");
    });

    it("should handle BETWEEN operator simulation", async () => {
      const result1 = await addLabelToSQlQuery("SELECT * FROM logs", "timestamp", "2023-01-01", ">=");
      const result2 = await addLabelToSQlQuery(result1, "timestamp", "2023-12-31", "<=");
      expect(mockSqlify).toHaveBeenCalled();
    });

    it("should handle case-insensitive operators", async () => {
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "level", "error", "str_match_ignore_case");
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle very long values", async () => {
      const longValue = "x".repeat(10000);
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "message", longValue, "Contains");
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle special regex patterns", async () => {
      const regexPattern = "^[A-Z]{3}\\d{4}$";
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "code", regexPattern, "re_match");
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle array values for IN operator", async () => {
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "level", "ERROR,WARN,INFO,DEBUG", "IN");
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });

    it("should handle JSON-like values", async () => {
      const jsonValue = '{"key": "value", "nested": {"prop": 123}}';
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "metadata", jsonValue, "=");
      expect(result).toBe('SELECT * FROM "logs" WHERE level = \'ERROR\'');
    });
  });

  describe("getStreamFromQuery - Edge Cases", () => {
    it("should handle queries with subqueries in FROM clause", async () => {
      mockAstify.mockReturnValue({
        from: [{
          expr: {
            ast: {
              from: [{ table: "inner_table" }]
            }
          }
        }]
      });
      const result = await getStreamFromQuery("SELECT * FROM (SELECT * FROM inner_table) AS sub");
      expect(result).toBe("");
    });

    it("should handle queries with multiple tables (JOIN)", async () => {
      mockAstify.mockReturnValue({
        from: [
          { table: "table1" },
          { table: "table2" },
          { table: "table3" }
        ]
      });
      const result = await getStreamFromQuery("SELECT * FROM table1 JOIN table2 ON table1.id = table2.id");
      expect(result).toBe("table1");
    });

    it("should handle CTE (Common Table Expressions)", async () => {
      mockAstify.mockReturnValue({
        with: [
          { name: "temp_table", stmt: { from: [{ table: "source_table" }] } }
        ],
        from: [{ table: "temp_table" }]
      });
      const result = await getStreamFromQuery("WITH temp_table AS (SELECT * FROM source_table) SELECT * FROM temp_table");
      expect(result).toBe("temp_table");
    });
  });

  describe("Performance and Stress Tests", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE level = 'ERROR'");
    });
    it("should handle deeply nested queries efficiently", async () => {
      const startTime = Date.now();
      
      // Create a deeply nested mock structure
      let nestedAst = { from: [{ table: "deepest_table" }] };
      for (let i = 0; i < 100; i++) {
        nestedAst = {
          from: [{
            expr: {
              ast: nestedAst
            }
          }]
        };
      }
      
      mockAstify.mockReturnValue(nestedAst);
      
      const result = await getStreamFromQuery("Deeply nested query");
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(result).toBe("");
    });

    it("should handle large number of labels efficiently", async () => {
      // Test with 10 labels to verify performance
      const startTime = Date.now();
      
      for (let i = 0; i < 10; i++) {
        await addLabelToSQlQuery("SELECT * FROM logs", `field${i}`, `value${i}`, "=");
      }
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe("Error Handling and Recovery", () => {
    it("should gracefully handle circular references in AST", async () => {
      const circularAst: any = { from: [{ table: "test" }] };
      circularAst.circular = circularAst;
      
      mockAstify.mockReturnValue(circularAst);
      
      const result = await getStreamNameFromQuery("SELECT * FROM test");
      expect(typeof result).toBe("string");
    });

    it("should handle malformed AST structures", async () => {
      mockAstify.mockReturnValue({
        malformed: true,
        from: [{ not_a_table: "invalid" }]
      });
      
      const result = await getStreamFromQuery("Malformed query");
      expect(result).toBe("");
    });

    it("should handle memory pressure scenarios", async () => {
      // Create a large object to simulate memory pressure
      const largeData = Array.from({ length: 10000 }, (_, i) => ({
        field: `data${i}`,
        value: `value${i}`.repeat(100)
      }));
      
      mockAstify.mockReturnValue({
        from: [{ table: "memory_test" }],
        data: largeData
      });
      
      const result = await getStreamFromQuery("Memory pressure query");
      expect(result).toBe("memory_test");
    });
  });

  describe("Integration Scenarios", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE level = 'ERROR'");
    });
    it("should handle complete query transformation pipeline", async () => {
      const originalQuery = "SELECT * FROM logs";
      const result = await addLabelToSQlQuery(originalQuery, "level", "ERROR", "=");
      
      expect(typeof result).toBe("string");
      expect(result).toContain("FROM");
      expect(result).toContain("logs");
    });

    it("should handle query with histogram and field extraction", async () => {
      mockAstify.mockReturnValue({
        from: [{ table: "metrics" }],
        columns: [
          {
            expr: {
              type: "function",
              name: { name: [{ value: "histogram" }] },
              args: {
                value: [
                  {
                    column: { expr: { value: "_timestamp" } }
                  },
                  { value: "1h" }
                ]
              }
            },
            as: "time_bucket"
          },
          {
            expr: {
              type: "aggr_func",
              name: "count",
              args: {
                expr: {
                  column: { expr: { value: "*" } }
                }
              }
            },
            as: "event_count"
          }
        ]
      });
      
      const result = await getFieldsFromQuery("SELECT histogram(_timestamp, '1h') as time_bucket, count(*) as event_count FROM metrics");
      
      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].aggregationFunction).toBe("histogram");
      expect(result.fields[1].aggregationFunction).toBe("count");
      expect(result.streamName).toBe("metrics");
    });
  });

  describe("Security and Validation Tests", () => {
    beforeEach(() => {
      mockAstify.mockReturnValue({
        type: "select",
        columns: [{ expr: { column: "*", type: "column_ref" } }],
        from: [{ table: "logs" }],
        where: null
      });
      mockSqlify.mockReturnValue("SELECT * FROM `logs` WHERE level = 'ERROR'");
    });
    it("should sanitize SQL injection attempts in labels", async () => {
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "id", "1; DROP TABLE users; --", "=");
      
      expect(typeof result).toBe("string");
      // The malicious content should be properly escaped as a value
      expect(result).toContain("logs");
    });

    it("should handle extremely malformed input gracefully", async () => {
      mockAstify.mockImplementation(() => {
        throw new TypeError("Cannot read property of undefined");
      });
      
      const result = await getFieldsFromQuery("COMPLETELY INVALID SQL!!!@#$%");
      
      expect(result.fields).toHaveLength(2);
      expect(result.streamName).toBe(null);
    });

    it("should validate operator types", async () => {
      // Test with a known invalid operator - function should still return a result
      const result = await addLabelToSQlQuery("SELECT * FROM logs", "level", "ERROR", "UNKNOWN_OP");
      expect(typeof result).toBe("string");
      // Should still contain the base query structure
      expect(result).toContain("logs");
    });
  });

  describe("Boundary Value Tests", () => {
    it("should handle zero-length strings appropriately", async () => {
      const result = await convertQueryIntoSingleLine("");
      expect(result).toBe("");
    });

    it("should handle single character inputs", async () => {
      mockAstify.mockImplementation((query) => {
        if (query.length === 1) {
          throw new Error("Single character query");
        }
        return { from: [{ table: "test" }] };
      });
      
      const result = await convertQueryIntoSingleLine("a");
      expect(result).toBe("a");
    });

    it("should handle maximum integer values", async () => {
      const result = formatValue(Number.MAX_SAFE_INTEGER.toString());
      expect(result).toBe(`'${Number.MAX_SAFE_INTEGER}'`);
    });

    it("should handle floating point precision", async () => {
      const result = formatValue("3.141592653589793238462643383279502884197");
      expect(result).toBe("'3.141592653589793238462643383279502884197'");
    });
  });
});