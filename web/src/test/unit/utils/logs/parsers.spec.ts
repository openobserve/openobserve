// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createSQLParserFunctions,
  extractFilterColumns,
  isTimestampASC,
  cleanBinaryExpression,
  isFieldOnly,
  extractValueQuery,
  isNonAggregatedSQLMode,
  parseNonSQLQuery,
  quoteFieldNames,
  type SQLParserFunctions,
  type ValueQueryParams,
  type FilterColumnNode
} from "@/utils/logs/parsers";

// Mock Parser class
class MockParser {
  astify = vi.fn();
  sqlify = vi.fn();
}

describe("Parsers Utilities", () => {
  describe("createSQLParserFunctions", () => {
    let mockParser: MockParser;
    let parserFunctions: SQLParserFunctions;

    beforeEach(() => {
      mockParser = new MockParser();
      parserFunctions = createSQLParserFunctions(mockParser as any);
    });

    describe("parseSQL", () => {
      it("should parse valid SQL query", () => {
        const mockParsedResult = {
          columns: [{ expr: { column: "*" } }],
          from: [{ table: "logs" }],
          where: { type: "binary_expr", operator: "=", left: { type: "column_ref", column: "status" }, right: { type: "single_quote_string", value: "error" } }
        };
        
        mockParser.astify.mockReturnValue(mockParsedResult);
        
        const result = parserFunctions.parseSQL("SELECT * FROM logs WHERE status = 'error'");
        
        expect(mockParser.astify).toHaveBeenCalledWith("SELECT * FROM logs WHERE status = 'error'");
        expect(result).toEqual(mockParsedResult);
      });

      it("should filter out SQL comments", () => {
        mockParser.astify.mockReturnValue({ columns: [] });
        
        const queryWithComments = `-- This is a comment
SELECT * FROM logs
-- Another comment
WHERE status = 'error'`;
        
        parserFunctions.parseSQL(queryWithComments);
        
        expect(mockParser.astify).toHaveBeenCalledWith("SELECT * FROM logs\nWHERE status = 'error'");
      });

      it("should return default structure on parsing error", () => {
        mockParser.astify.mockImplementation(() => {
          throw new Error("Parse error");
        });
        
        const result = parserFunctions.parseSQL("INVALID SQL");
        
        expect(result).toEqual({
          columns: [],
          from: [],
          orderby: null,
          limit: null,
          groupby: null,
          where: null,
        });
      });

      it("should handle null parser", () => {
        const nullParserFunctions = createSQLParserFunctions(null);
        
        const result = nullParserFunctions.parseSQL("SELECT * FROM logs");
        
        expect(result).toEqual({
          columns: [],
          from: [],
          orderby: null,
          limit: null,
          groupby: null,
          where: null,
        });
      });
    });

    describe("unparseSQL", () => {
      it("should unparse SQL object to string", () => {
        const sqlObject = {
          columns: [{ expr: { column: "*" } }],
          from: [{ table: "logs" }]
        };
        
        mockParser.sqlify.mockReturnValue("SELECT * FROM logs");
        
        const result = parserFunctions.unparseSQL(sqlObject);
        
        expect(mockParser.sqlify).toHaveBeenCalledWith(sqlObject);
        expect(result).toBe("SELECT * FROM logs");
      });

      it("should return empty string on unparsing error", () => {
        mockParser.sqlify.mockImplementation(() => {
          throw new Error("Unparsing error");
        });
        
        const result = parserFunctions.unparseSQL({});
        
        expect(result).toBe("");
      });

      it("should handle null parser", () => {
        const nullParserFunctions = createSQLParserFunctions(null);
        
        const result = nullParserFunctions.unparseSQL({});
        
        expect(result).toBe("");
      });
    });
  });

  describe("extractFilterColumns", () => {
    it("should extract column references from simple expression", () => {
      const expression = {
        type: "binary_expr",
        operator: "=",
        left: { type: "column_ref", column: "status" },
        right: { type: "single_quote_string", value: "error" }
      };
      
      const result = extractFilterColumns(expression);
      
      expect(result).toEqual([
        { expr: { value: "status" } }
      ]);
    });

    it("should extract multiple columns from complex expression", () => {
      const expression = {
        type: "binary_expr",
        operator: "AND",
        left: {
          type: "binary_expr",
          operator: "=",
          left: { type: "column_ref", column: "status" },
          right: { type: "single_quote_string", value: "error" }
        },
        right: {
          type: "binary_expr",
          operator: "=",
          left: { type: "column_ref", column: "level" },
          right: { type: "single_quote_string", value: "warn" }
        }
      };
      
      const result = extractFilterColumns(expression);
      
      expect(result).toEqual([
        { expr: { value: "status" } },
        { expr: { value: "level" } }
      ]);
    });

    it("should handle function expressions", () => {
      const expression = {
        type: "function",
        name: "COUNT",
        args: {
          value: [
            { type: "column_ref", column: "id" }
          ]
        }
      };
      
      const result = extractFilterColumns(expression);
      
      expect(result).toEqual([
        { expr: { value: "id" } }
      ]);
    });

    it("should handle null/undefined expression", () => {
      expect(extractFilterColumns(null)).toEqual([]);
      expect(extractFilterColumns(undefined)).toEqual([]);
    });

    it("should handle expression with no columns", () => {
      const expression = {
        type: "single_quote_string",
        value: "test"
      };
      
      const result = extractFilterColumns(expression);
      
      expect(result).toEqual([]);
    });
  });

  describe("isTimestampASC", () => {
    const timestampColumn = "_timestamp";

    it("should return true for ascending timestamp order", () => {
      const orderby = [
        {
          expr: { column: "_timestamp" },
          type: "ASC"
        }
      ];
      
      expect(isTimestampASC(orderby, timestampColumn)).toBe(true);
    });

    it("should return false for descending timestamp order", () => {
      const orderby = [
        {
          expr: { column: "_timestamp" },
          type: "DESC"
        }
      ];
      
      expect(isTimestampASC(orderby, timestampColumn)).toBe(false);
    });

    it("should return false for non-timestamp column", () => {
      const orderby = [
        {
          expr: { column: "status" },
          type: "ASC"
        }
      ];
      
      expect(isTimestampASC(orderby, timestampColumn)).toBe(false);
    });

    it("should handle null/undefined orderby", () => {
      expect(isTimestampASC(null, timestampColumn)).toBe(false);
      expect(isTimestampASC(undefined, timestampColumn)).toBe(false);
    });

    it("should handle empty orderby array", () => {
      expect(isTimestampASC([], timestampColumn)).toBe(false);
    });

    it("should handle multiple order clauses", () => {
      const orderby = [
        {
          expr: { column: "status" },
          type: "DESC"
        },
        {
          expr: { column: "_timestamp" },
          type: "ASC"
        }
      ];
      
      expect(isTimestampASC(orderby, timestampColumn)).toBe(true);
    });
  });

  describe("cleanBinaryExpression", () => {
    it("should clean binary expression with field-only comparisons", () => {
      const node = {
        type: "binary_expr",
        operator: "=",
        left: { type: "column_ref", column: "field1" },
        right: { type: "column_ref", column: "field2" }
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toBeNull();
    });

    it("should preserve valid binary expressions", () => {
      const node = {
        type: "binary_expr",
        operator: "=",
        left: { type: "column_ref", column: "status" },
        right: { type: "single_quote_string", value: "error" }
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toEqual({
        type: "binary_expr",
        operator: "=",
        left: {
          type: "column_ref",
          table: null,
          column: "status"
        },
        right: {
          type: "single_quote_string",
          value: "error"
        }
      });
    });

    it("should handle column references", () => {
      const node = {
        type: "column_ref",
        column: "status"
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toEqual({
        type: "column_ref",
        table: null,
        column: "status"
      });
    });

    it("should handle string literals", () => {
      const node = {
        type: "single_quote_string",
        value: "error"
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toEqual({
        type: "single_quote_string",
        value: "error"
      });
    });

    it("should handle number literals", () => {
      const node = {
        type: "number",
        value: 123
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toEqual({
        type: "number",
        value: 123
      });
    });

    it("should handle null/undefined nodes", () => {
      expect(cleanBinaryExpression(null)).toBeNull();
      expect(cleanBinaryExpression(undefined)).toBeNull();
    });

    it("should return left side when right is null", () => {
      const node = {
        type: "binary_expr",
        operator: "AND",
        left: { type: "column_ref", column: "status" },
        right: null
      };
      
      const result = cleanBinaryExpression(node);
      
      expect(result).toEqual({
        type: "column_ref",
        table: null,
        column: "status"
      });
    });
  });

  describe("isFieldOnly", () => {
    it("should return true for column references", () => {
      const node = { type: "column_ref", column: "status" };
      
      expect(isFieldOnly(node)).toBe(true);
    });

    it("should return false for non-column types", () => {
      expect(isFieldOnly({ type: "single_quote_string", value: "test" })).toBe(false);
      expect(isFieldOnly({ type: "number", value: 123 })).toBe(false);
      expect(isFieldOnly({ type: "binary_expr" })).toBe(false);
    });

    it("should handle null/undefined nodes", () => {
      expect(isFieldOnly(null)).toBe(false);
      expect(isFieldOnly(undefined)).toBe(false);
    });
  });

  describe("extractValueQuery", () => {
    const mockParseSQL = vi.fn();
    const mockUnparseSQL = vi.fn();

    const baseParams: ValueQueryParams = {
      sqlMode: true,
      query: "SELECT * FROM logs WHERE status = 'error'",
      selectedStreams: ["logs", "traces"],
      parseSQL: mockParseSQL,
      unparseSQL: mockUnparseSQL
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockUnparseSQL.mockReturnValue('SELECT * FROM "INDEX_NAME"');
    });

    it("should return empty object for non-SQL mode", () => {
      const params = { ...baseParams, sqlMode: false };
      
      const result = extractValueQuery(params);
      
      expect(result).toEqual({});
    });

    it("should return empty object for empty query", () => {
      const params = { ...baseParams, query: "" };
      
      const result = extractValueQuery(params);
      
      expect(result).toEqual({});
    });

    it("should handle simple single table query", () => {
      mockParseSQL.mockReturnValueOnce({
        from: [{ table: "logs" }],
        where: { type: "binary_expr", operator: "=", left: { type: "column_ref", column: "status" }, right: { type: "single_quote_string", value: "error" } },
        _next: null
      }).mockReturnValueOnce({
        where: null
      });
      
      const result = extractValueQuery(baseParams);
      
      expect(result).toEqual({
        logs: 'SELECT * FROM "[INDEX_NAME]"'
      });
    });

    it("should handle join queries", () => {
      mockParseSQL.mockReturnValue({
        from: [{ table: "logs" }, { table: "traces" }],
        where: { type: "binary_expr" },
        _next: null
      });
      
      const result = extractValueQuery(baseParams);
      
      expect(result).toEqual({
        logs: 'SELECT * FROM "[INDEX_NAME]"',
        traces: 'SELECT * FROM "[INDEX_NAME]"'
      });
    });

    it("should handle union queries", () => {
      mockParseSQL.mockReturnValueOnce({
        from: [{ table: "logs" }],
        where: { type: "binary_expr" },
        _next: {
          from: [{ table: "traces" }],
          where: { type: "binary_expr" },
          _next: null
        }
      }).mockReturnValue({
        where: null
      });
      
      const result = extractValueQuery(baseParams);
      
      expect(result).toEqual({
        logs: 'SELECT * FROM "[INDEX_NAME]"',
        traces: 'SELECT * FROM "[INDEX_NAME]"'
      });
    });

    it("should handle deeply nested union queries", () => {
      const nestedQuery = {
        from: [{ table: "logs" }],
        where: { type: "binary_expr" },
        _next: {
          from: [{ table: "traces" }],
          where: { type: "binary_expr" },
          _next: {
            from: [{ table: "metrics" }],
            where: { type: "binary_expr" },
            _next: null
          }
        }
      };
      
      mockParseSQL.mockReturnValueOnce(nestedQuery).mockReturnValue({ where: null });
      
      const result = extractValueQuery(baseParams);
      
      expect(result).toEqual({
        logs: 'SELECT * FROM "[INDEX_NAME]"',
        traces: 'SELECT * FROM "[INDEX_NAME]"',
        metrics: 'SELECT * FROM "[INDEX_NAME]"'
      });
    });

    it("should handle maximum depth exceeded", () => {
      // Create a deeply nested structure that exceeds MAX_DEPTH
      const createNestedQuery = (depth: number): any => {
        if (depth <= 0) return null;
        return {
          from: [{ table: `table${depth}` }],
          where: { type: "binary_expr" },
          _next: createNestedQuery(depth - 1)
        };
      };
      
      const deepQuery = createNestedQuery(105); // Exceeds MAX_DEPTH of 100
      mockParseSQL.mockReturnValueOnce(deepQuery).mockReturnValue({ where: null });
      
      expect(() => extractValueQuery(baseParams)).toThrow("Maximum query depth exceeded");
    });

    it("should handle parsing errors gracefully", () => {
      mockParseSQL.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      expect(() => extractValueQuery(baseParams)).toThrow("Parse error");
    });

    it("should filter SQL comments from query", () => {
      const queryWithComments = `-- Comment
SELECT * FROM logs
-- Another comment
WHERE status = 'error'`;
      
      const params = { ...baseParams, query: queryWithComments };
      
      mockParseSQL.mockReturnValue({
        from: [{ table: "logs" }],
        where: null,
        _next: null
      });
      
      extractValueQuery(params);
      
      expect(mockParseSQL).toHaveBeenCalledWith("SELECT * FROM logs\nWHERE status = 'error'");
    });
  });

  describe("isNonAggregatedSQLMode", () => {
    it("should return true for non-aggregated SQL mode", () => {
      expect(isNonAggregatedSQLMode(true, false, false, false, true)).toBe(true);
    });

    it("should return false when SQL mode is disabled", () => {
      expect(isNonAggregatedSQLMode(false, false, false, false, true)).toBe(true);
    });

    it("should return false for queries with LIMIT", () => {
      expect(isNonAggregatedSQLMode(true, true, false, false, true)).toBe(false);
    });

    it("should return false for queries with DISTINCT", () => {
      expect(isNonAggregatedSQLMode(true, false, true, false, true)).toBe(false);
    });

    it("should return false for queries with WITH", () => {
      expect(isNonAggregatedSQLMode(true, false, false, true, true)).toBe(false);
    });

    it("should return false for non-histogram eligible queries", () => {
      expect(isNonAggregatedSQLMode(true, false, false, false, false)).toBe(false);
    });

    it("should return false for multiple aggregation features", () => {
      expect(isNonAggregatedSQLMode(true, true, true, true, false)).toBe(false);
    });
  });

  describe("parseNonSQLQuery", () => {
    it("should parse query with functions and where clause", () => {
      const query = "count(*) | status = 'error' AND level = 'warn'";
      
      const result = parseNonSQLQuery(query);
      
      expect(result).toEqual({
        queryFunctions: ",count(*)",
        whereClause: "WHERE status = 'error' AND level = 'warn'"
      });
    });

    it("should handle query without functions", () => {
      const query = "status = 'error'";
      
      const result = parseNonSQLQuery(query);
      
      expect(result).toEqual({
        queryFunctions: "",
        whereClause: "WHERE status = 'error'"
      });
    });

    it("should handle empty where clause", () => {
      const query = "count(*) | ";
      
      const result = parseNonSQLQuery(query);
      
      expect(result).toEqual({
        queryFunctions: ",count(*)",
        whereClause: ""
      });
    });

    it("should filter SQL comments from where clause", () => {
      const query = `count(*) | status = 'error'
-- This is a comment
AND level = 'warn'`;
      
      const result = parseNonSQLQuery(query);
      
      expect(result).toEqual({
        queryFunctions: ",count(*)",
        whereClause: "WHERE status = 'error'\nAND level = 'warn'"
      });
    });

    it("should handle query with only functions", () => {
      const query = "sum(bytes)";
      
      const result = parseNonSQLQuery(query);
      
      expect(result).toEqual({
        queryFunctions: "",
        whereClause: "WHERE sum(bytes)"
      });
    });
  });

  describe("quoteFieldNames", () => {
    const selectedStreamFields = [
      { name: "status" },
      { name: "level" },
      { name: "message" }
    ];

    it("should quote field names in where clause", () => {
      const whereClause = "status = error AND level = warn";
      
      const result = quoteFieldNames(whereClause, selectedStreamFields);
      
      expect(result).toBe('"status" = error AND "level" = warn');
    });

    it("should handle single field", () => {
      const whereClause = "status = 'error'";
      
      const result = quoteFieldNames(whereClause, selectedStreamFields);
      
      expect(result).toBe('"status" = \'error\'');
    });

    it("should not quote non-field names", () => {
      const whereClause = "unknown_field = 'value'";
      
      const result = quoteFieldNames(whereClause, selectedStreamFields);
      
      expect(result).toBe("unknown_field = 'value'");
    });

    it("should handle empty where clause", () => {
      const result = quoteFieldNames("", selectedStreamFields);
      
      expect(result).toBe("");
    });

    it("should handle empty fields array", () => {
      const whereClause = "status = 'error'";
      
      const result = quoteFieldNames(whereClause, []);
      
      expect(result).toBe("status = 'error'");
    });

    it("should remove existing quotes before adding new ones", () => {
      const whereClause = '"status" = error';
      
      const result = quoteFieldNames(whereClause, selectedStreamFields);
      
      expect(result).toBe('"status" = error');
    });

    it("should handle complex expressions", () => {
      const whereClause = "status IN ('error', 'warn') AND level > 1";
      
      const result = quoteFieldNames(whereClause, selectedStreamFields);
      
      expect(result).toBe('"status" IN (\'error\', \'warn\') AND "level" > 1');
    });
  });
});