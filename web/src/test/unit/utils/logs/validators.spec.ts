// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  validateLimitQuery,
  validateDistinctQuery,
  validateWithQuery,
  validateAggregationQuery,
  validateMultiStreamFilter,
  validateSQLSyntax,
  validateStreamName,
  validateSelectedStreams,
  validateFieldName,
  validateTimestampRange,
  validatePaginationParams,
  type MultiStreamFilterParams,
  type MultiStreamFilterResult
} from "@/utils/logs/validators";

describe("Validators Utilities", () => {
  describe("validateLimitQuery", () => {
    it("should return true for query with LIMIT clause", () => {
      const parsedSQL = {
        limit: {
          value: [{ value: 100 }]
        }
      };
      
      expect(validateLimitQuery(parsedSQL)).toBe(true);
    });

    it("should return false for query without LIMIT clause", () => {
      const parsedSQL = {
        select: ["*"]
      };
      
      expect(validateLimitQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null/undefined input", () => {
      expect(validateLimitQuery(null)).toBe(false);
      expect(validateLimitQuery(undefined)).toBe(false);
    });

    it("should return false for LIMIT with empty values", () => {
      const parsedSQL = {
        limit: {
          value: []
        }
      };
      
      expect(validateLimitQuery(parsedSQL)).toBe(false);
    });
  });

  describe("validateDistinctQuery", () => {
    it("should return true for query with DISTINCT clause", () => {
      const parsedSQL = {
        distinct: {
          type: "DISTINCT"
        }
      };
      
      expect(validateDistinctQuery(parsedSQL)).toBe(true);
    });

    it("should return false for query without DISTINCT clause", () => {
      const parsedSQL = {
        select: ["*"]
      };
      
      expect(validateDistinctQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null/undefined input", () => {
      expect(validateDistinctQuery(null)).toBe(false);
      expect(validateDistinctQuery(undefined)).toBe(false);
    });

    it("should return false for non-DISTINCT type", () => {
      const parsedSQL = {
        distinct: {
          type: "ALL"
        }
      };
      
      expect(validateDistinctQuery(parsedSQL)).toBe(false);
    });
  });

  describe("validateWithQuery", () => {
    it("should return true for query with WITH clause", () => {
      const parsedSQL = {
        with: [
          { name: "cte1", query: "SELECT * FROM table1" }
        ]
      };
      
      expect(validateWithQuery(parsedSQL)).toBe(true);
    });

    it("should return false for query without WITH clause", () => {
      const parsedSQL = {
        select: ["*"]
      };
      
      expect(validateWithQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null/undefined input", () => {
      expect(validateWithQuery(null)).toBe(false);
      expect(validateWithQuery(undefined)).toBe(false);
    });

    it("should return false for empty WITH array", () => {
      const parsedSQL = {
        with: []
      };
      
      expect(validateWithQuery(parsedSQL)).toBe(false);
    });
  });

  describe("validateAggregationQuery", () => {
    it("should return true for query with aggregation functions", () => {
      const parsedSQL = {
        columns: [
          {
            expr: {
              type: "aggr_func",
              name: "COUNT"
            }
          }
        ]
      };
      
      expect(validateAggregationQuery(parsedSQL)).toBe(true);
    });

    it("should return true for query with GROUP BY in string", () => {
      const parsedSQL = {};
      const queryString = "SELECT field1, COUNT(*) FROM logs GROUP BY field1";
      
      expect(validateAggregationQuery(parsedSQL, queryString)).toBe(true);
    });

    it("should return false for query without aggregation", () => {
      const parsedSQL = {
        columns: [
          {
            expr: {
              type: "column_ref",
              name: "field1"
            }
          }
        ]
      };
      
      expect(validateAggregationQuery(parsedSQL)).toBe(false);
    });

    it("should return false for null/undefined input", () => {
      expect(validateAggregationQuery(null)).toBe(false);
      expect(validateAggregationQuery(undefined)).toBe(false);
    });

    it("should handle mixed case GROUP BY", () => {
      expect(validateAggregationQuery({}, "SELECT * FROM logs Group By field1")).toBe(true);
      expect(validateAggregationQuery({}, "SELECT * FROM logs group by field1")).toBe(true);
      expect(validateAggregationQuery({}, "SELECT * FROM logs GROUP BY field1")).toBe(true);
    });
  });

  describe("validateMultiStreamFilter", () => {
    const mockFnParsedSQL = vi.fn();
    const mockExtractFilterColumns = vi.fn();

    const baseParams: MultiStreamFilterParams = {
      filterCondition: "status = 'error'",
      selectedStreamFields: [
        {
          name: "status",
          streams: ["logs", "traces"]
        }
      ],
      selectedStream: ["logs", "traces"],
      fnParsedSQL: mockFnParsedSQL,
      extractFilterColumns: mockExtractFilterColumns
    };

    beforeEach(() => {
      vi.clearAllMocks();
      mockFnParsedSQL.mockReturnValue({
        where: { /* mock where clause */ }
      });
      mockExtractFilterColumns.mockReturnValue([
        {
          expr: { value: "status" }
        }
      ]);
    });

    it("should return valid result for proper multi-stream filter", () => {
      const result = validateMultiStreamFilter(baseParams);
      
      expect(result.isValid).toBe(true);
      expect(result.errorMessage).toBe("");
      expect(mockFnParsedSQL).toHaveBeenCalledWith("select * from stream where status = 'error'");
    });

    it("should detect field missing in streams", () => {
      const params = {
        ...baseParams,
        selectedStreamFields: [] // No fields available
      };
      
      const result = validateMultiStreamFilter(params);
      
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain("Field 'status' does not exist in the one or more stream");
    });

    it("should detect fields with different stream counts", () => {
      const params = {
        ...baseParams,
        selectedStreamFields: [
          {
            name: "status",
            streams: ["logs"] // Only in logs
          },
          {
            name: "status", 
            streams: ["logs", "traces"] // In both streams
          }
        ]
      };
      
      const result = validateMultiStreamFilter(params);
      
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toContain("Field 'status' exists in different number of streams");
    });

    it("should handle parsing errors gracefully", () => {
      const params = {
        ...baseParams,
        fnParsedSQL: vi.fn().mockImplementation(() => {
          throw new Error("Parse error");
        })
      };
      
      const result = validateMultiStreamFilter(params);
      
      expect(result.isValid).toBe(false);
      expect(result.errorMessage).toBe("Failed to validate filter conditions");
    });

    it("should identify missing streams", () => {
      mockExtractFilterColumns.mockReturnValue([
        {
          expr: { value: "field_not_in_all_streams" }
        }
      ]);

      const params = {
        ...baseParams,
        selectedStreamFields: [
          {
            name: "field_not_in_all_streams",
            streams: ["logs"] // Only in logs stream
          }
        ],
        selectedStream: ["logs", "traces"] // But we want both streams
      };
      
      const result = validateMultiStreamFilter(params);
      
      expect(result.missingStreamMultiStreamFilter).toContain("traces");
      expect(result.missingStreamMessage).toContain("traces");
    });
  });

  describe("validateSQLSyntax", () => {
    const mockParser = vi.fn();

    it("should return true for valid SQL", () => {
      mockParser.mockReturnValue({ valid: true });
      
      expect(validateSQLSyntax("SELECT * FROM logs", mockParser)).toBe(true);
      expect(mockParser).toHaveBeenCalledWith("SELECT * FROM logs");
    });

    it("should return false for invalid SQL", () => {
      mockParser.mockImplementation(() => {
        throw new Error("Parse error");
      });
      
      expect(validateSQLSyntax("INVALID SQL", mockParser)).toBe(false);
    });

    it("should return false for empty/null query", () => {
      expect(validateSQLSyntax("", mockParser)).toBe(false);
      expect(validateSQLSyntax("   ", mockParser)).toBe(false);
      expect(validateSQLSyntax(null as any, mockParser)).toBe(false);
      expect(validateSQLSyntax(undefined as any, mockParser)).toBe(false);
    });

    it("should return false when parser returns null/undefined", () => {
      mockParser.mockReturnValue(null);
      expect(validateSQLSyntax("SELECT *", mockParser)).toBe(false);
      
      mockParser.mockReturnValue(undefined);
      expect(validateSQLSyntax("SELECT *", mockParser)).toBe(false);
    });
  });

  describe("validateStreamName", () => {
    it("should return true for valid stream names", () => {
      expect(validateStreamName("logs")).toBe(true);
      expect(validateStreamName("my-stream")).toBe(true);
      expect(validateStreamName("stream_123")).toBe(true);
      expect(validateStreamName("Stream-With-Dashes")).toBe(true);
    });

    it("should return false for invalid stream names", () => {
      expect(validateStreamName("")).toBe(false);
      expect(validateStreamName("stream with spaces")).toBe(false);
      expect(validateStreamName("stream@special")).toBe(false);
      expect(validateStreamName("stream.dot")).toBe(false);
      expect(validateStreamName(null as any)).toBe(false);
      expect(validateStreamName(undefined as any)).toBe(false);
    });

    it("should return false for names that are too long", () => {
      const longName = "a".repeat(101);
      expect(validateStreamName(longName)).toBe(false);
    });
  });

  describe("validateSelectedStreams", () => {
    it("should return true for valid stream arrays", () => {
      expect(validateSelectedStreams(["logs"])).toBe(true);
      expect(validateSelectedStreams(["logs", "traces", "metrics"])).toBe(true);
    });

    it("should return false for invalid stream arrays", () => {
      expect(validateSelectedStreams([])).toBe(false);
      expect(validateSelectedStreams(["logs", "invalid stream name"])).toBe(false);
      expect(validateSelectedStreams(["logs", ""])).toBe(false);
      expect(validateSelectedStreams(null as any)).toBe(false);
      expect(validateSelectedStreams(undefined as any)).toBe(false);
    });
  });

  describe("validateFieldName", () => {
    it("should return true for valid field names", () => {
      expect(validateFieldName("timestamp")).toBe(true);
      expect(validateFieldName("field_name")).toBe(true);
      expect(validateFieldName("_private_field")).toBe(true);
      expect(validateFieldName("field123")).toBe(true);
    });

    it("should return false for invalid field names", () => {
      expect(validateFieldName("")).toBe(false);
      expect(validateFieldName("123field")).toBe(false); // Can't start with number
      expect(validateFieldName("field-name")).toBe(false); // Dashes not allowed
      expect(validateFieldName("field.name")).toBe(false); // Dots not allowed
      expect(validateFieldName("field name")).toBe(false); // Spaces not allowed
      expect(validateFieldName(null as any)).toBe(false);
      expect(validateFieldName(undefined as any)).toBe(false);
    });

    it("should return false for names that are too long", () => {
      const longName = "a".repeat(201);
      expect(validateFieldName(longName)).toBe(false);
    });
  });

  describe("validateTimestampRange", () => {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    it("should return true for valid timestamp ranges", () => {
      expect(validateTimestampRange(oneHourAgo, now)).toBe(true);
      expect(validateTimestampRange(0, 1000)).toBe(true);
    });

    it("should return false for invalid timestamp ranges", () => {
      expect(validateTimestampRange(now, oneHourAgo)).toBe(false); // Start after end
      expect(validateTimestampRange(now, now)).toBe(false); // Start equals end
      expect(validateTimestampRange(NaN, now)).toBe(false);
      expect(validateTimestampRange(now, NaN)).toBe(false);
      expect(validateTimestampRange("invalid" as any, now)).toBe(false);
      expect(validateTimestampRange(now, "invalid" as any)).toBe(false);
    });

    it("should return false for timestamps outside reasonable range", () => {
      const futureTimestamp = Date.now() + (2 * 365 * 24 * 60 * 60 * 1000); // 2 years in future
      expect(validateTimestampRange(-1000, now)).toBe(false); // Negative start
      expect(validateTimestampRange(now, futureTimestamp)).toBe(false); // Too far in future
    });
  });

  describe("validatePaginationParams", () => {
    it("should return true for valid pagination parameters", () => {
      expect(validatePaginationParams(1, 50)).toBe(true);
      expect(validatePaginationParams(10, 100)).toBe(true);
      expect(validatePaginationParams(1, 1)).toBe(true);
      expect(validatePaginationParams(1, 1000)).toBe(true);
    });

    it("should return false for invalid pagination parameters", () => {
      expect(validatePaginationParams(0, 50)).toBe(false); // Page < 1
      expect(validatePaginationParams(-1, 50)).toBe(false); // Negative page
      expect(validatePaginationParams(1, 0)).toBe(false); // Zero rows per page
      expect(validatePaginationParams(1, -1)).toBe(false); // Negative rows per page
      expect(validatePaginationParams(1, 1001)).toBe(false); // Too many rows per page
      expect(validatePaginationParams(NaN, 50)).toBe(false);
      expect(validatePaginationParams(1, NaN)).toBe(false);
      expect(validatePaginationParams("invalid" as any, 50)).toBe(false);
      expect(validatePaginationParams(1, "invalid" as any)).toBe(false);
    });
  });
});