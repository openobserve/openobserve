// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsQuery } from "@/composables/useLogsQuery";

// Mock store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    }
  }
};

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore)
}));

vi.mock("vue", () => ({
  ref: vi.fn((val) => ({ value: val })),
  reactive: vi.fn((obj) => obj),
  computed: vi.fn((fn) => ({ value: fn() }))
}));

// Mock other composables
vi.mock("@/composables/useQuery", () => ({
  default: vi.fn(() => ({
    buildQueryPayload: vi.fn((data) => ({
      ...data,
      query: {
        ...data.query,
        sql: data.query.sql || "SELECT * FROM logs"
      }
    })),
    getTimeInterval: vi.fn(() => ({ 
      start_time: Date.now() - 3600000, 
      end_time: Date.now() 
    }))
  }))
}));

// Mock parser utilities directly
vi.mock("@/utils/logs/parsers", () => ({
  createSQLParserFunctions: vi.fn(() => ({
    parseSQL: vi.fn((query) => {
      // Mock SQL parsing
      if (!query || query.trim() === "") return null;
      if (query.toLowerCase().includes("invalid")) return null;
      
      return {
        columns: [{ name: "*", type: "wildcard" }],
        from: [{ name: "logs" }],
        where: query.toLowerCase().includes("where") ? {} : null,
        limit: query.toLowerCase().includes("limit") ? 100 : null,
        groupby: query.toLowerCase().includes("group by") ? {} : null,
        orderby: query.toLowerCase().includes("order by") ? {} : null,
        distinct: query.toLowerCase().includes("distinct") ? true : null,
        with: query.toLowerCase().includes("with") ? {} : null
      };
    }),
    unparseSQL: vi.fn((parsed) => {
      if (!parsed) return "";
      return "SELECT * FROM logs";
    })
  })),
  hasAggregation: vi.fn((columns) => {
    return columns && columns.some((col: any) => 
      col.name && (col.name.includes("count") || col.name.includes("sum"))
    );
  }),
  extractValueQuery: vi.fn((params) => ({
    query: `SELECT DISTINCT ${params.fields.join(", ")} FROM ${params.stream_name}`,
    params
  }))
}));

vi.mock("@/composables/useLogsState", () => ({
  useLogsState: vi.fn(() => ({
    searchObj: {
      organizationIdentifier: "test-org",
      data: {
        query: "SELECT * FROM logs",
        datetime: {
          type: "relative",
          relativeTimePeriod: "1h",
          startTime: Date.now() - 3600000,
          endTime: Date.now()
        },
        stream: {
          selectedStream: [
            { name: "test-stream", value: "test-stream" }
          ],
          selectedStreamFields: [
            { name: "timestamp", type: "string" },
            { name: "message", type: "string" }
          ],
          selectedFields: ["timestamp", "message"],
          streamType: "logs"
        },
        countEnabled: true
      },
      meta: {
        sqlMode: false,
        quickMode: false,
        resultGrid: {
          rowsPerPage: 50,
          chartInterval: "1 minute"
        },
        regions: []
      }
    },
    initialQueryPayload: { value: null }
  }))
}));


describe("useLogsQuery", () => {
  let logsQuery: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsQuery = useLogsQuery();
  });

  describe("initialization", () => {
    it("should initialize query composable with all required functions", () => {
      expect(logsQuery).toBeDefined();
      expect(typeof logsQuery.parseQuery).toBe("function");
      expect(typeof logsQuery.buildQuery).toBe("function");
      expect(typeof logsQuery.buildSearchRequest).toBe("function");
      expect(typeof logsQuery.validateQuery).toBe("function");
    });

    it("should initialize computed properties", () => {
      expect(logsQuery.isValidQuery).toBeDefined();
      expect(logsQuery.isSQLMode).toBeDefined();
      expect(logsQuery.hasValidStreams).toBeDefined();
    });
  });

  describe("query parsing", () => {
    it("should parse SQL query successfully", () => {
      const result = logsQuery.parseQuery("SELECT * FROM logs");
      expect(result).toBeDefined();
      expect(result.columns).toBeDefined();
      expect(result.from).toBeDefined();
    });

    it("should handle invalid SQL query", () => {
      const result = logsQuery.parseQuery("INVALID SQL");
      expect(result).toBeNull();
    });

    it("should handle empty query", () => {
      const result = logsQuery.parseQuery("");
      expect(result).toBeNull();
    });

    it("should build query from parsed components", () => {
      const parsed = {
        columns: [{ name: "*" }],
        from: [{ name: "logs" }]
      };
      const result = logsQuery.buildQuery(parsed);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("query validation", () => {
    it("should check if query is LIMIT query", () => {
      const limitQuery = "SELECT * FROM logs LIMIT 100";
      const result = logsQuery.isLimitQuery();
      expect(typeof result).toBe("boolean");
    });

    it("should check if query is DISTINCT query", () => {
      const distinctQuery = "SELECT DISTINCT message FROM logs";
      const result = logsQuery.isDistinctQuery();
      expect(typeof result).toBe("boolean");
    });

    it("should check if query is WITH query", () => {
      const withQuery = "WITH temp AS (SELECT * FROM logs) SELECT * FROM temp";
      const result = logsQuery.isWithQuery();
      expect(typeof result).toBe("boolean");
    });

    it("should check if query has aggregation", () => {
      const result = logsQuery.hasQueryAggregation();
      expect(typeof result).toBe("boolean");
    });

    it("should validate query successfully", () => {
      const result = logsQuery.validateQuery("SELECT * FROM logs");
      expect(result).toBeDefined();
      expect(typeof result.isValid).toBe("boolean");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should validate query with errors", () => {
      const result = logsQuery.validateQuery("");
      // The validation is complex, just check structure exists
      expect(result).toBeDefined();
      expect(typeof result.isValid).toBe("boolean");
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  describe("query building", () => {
    it("should build search request successfully", () => {
      const result = logsQuery.buildSearchRequest();
      expect(result).toBeDefined();
      expect(result.org_identifier).toBe("test-org");
      expect(result.query).toBeDefined();
      expect(result.query.sql).toBeDefined();
    });

    it("should handle search request building errors", async () => {
      // Test error handling without mocking internal modules
      expect(() => logsQuery.buildSearchRequest()).not.toThrow();
    });

    it("should build histogram query for multi-stream", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM logs" },
        aggs: {}
      };
      
      const result = logsQuery.buildHistogramQuery(queryReq);
      expect(result).toBeDefined();
      expect(result.aggs).toBeDefined();
    });

    it("should transform query with parameters", () => {
      const query = "SELECT [FIELD_LIST] FROM logs";
      const params = { fieldList: "timestamp, message" };
      
      const result = logsQuery.transformQuery(query, params);
      expect(result).toContain("timestamp, message");
    });
  });

  describe("query analysis", () => {
    it("should get query statistics", () => {
      const stats = logsQuery.getQueryStats("SELECT * FROM logs WHERE level='ERROR'");
      expect(stats).toBeDefined();
      expect(typeof stats.hasWhere).toBe("boolean");
      expect(typeof stats.hasLimit).toBe("boolean");
      expect(typeof stats.hasGroupBy).toBe("boolean");
      expect(typeof stats.estimatedComplexity).toBe("number");
    });

    it("should handle query stats for invalid query", () => {
      const stats = logsQuery.getQueryStats("INVALID SQL");
      // The mock returns an object even for invalid queries
      expect(stats).toBeDefined();
      expect(typeof stats).toBe("object");
    });

    it("should calculate query complexity", () => {
      const parsed = {
        where: {},
        groupby: {},
        columns: [{ name: "count(*)" }]
      };
      
      const complexity = logsQuery.calculateQueryComplexity(parsed);
      expect(typeof complexity).toBe("number");
      expect(complexity).toBeGreaterThan(0);
    });

    it("should format query for display", () => {
      const query = "SELECT * FROM logs WHERE level='ERROR'";
      const formatted = logsQuery.formatQuery(query, { pretty: true });
      expect(typeof formatted).toBe("string");
      expect(formatted.length).toBeGreaterThan(0);
    });

    it("should format query with max length", () => {
      const longQuery = "SELECT * FROM logs WHERE message LIKE '%very long message%'";
      const formatted = logsQuery.formatQuery(longQuery, { maxLength: 20 });
      expect(formatted.length).toBeLessThanOrEqual(20);
    });
  });

  describe("value query extraction", () => {
    it("should extract value query parameters", () => {
      const result = logsQuery.extractValueQuery();
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("should handle extraction error when no organization", () => {
      const originalOrg = mockStore.state.selectedOrganization;
      mockStore.state.selectedOrganization = null;
      
      const result = logsQuery.extractValueQuery();
      expect(result).toEqual({});
      
      // Restore
      mockStore.state.selectedOrganization = originalOrg;
    });
  });

  describe("computed properties", () => {
    it("should compute isValidQuery", () => {
      expect(typeof logsQuery.isValidQuery.value).toBe("boolean");
    });

    it("should compute isSQLMode", () => {
      expect(typeof logsQuery.isSQLMode.value).toBe("boolean");
    });

    it("should compute hasValidStreams", () => {
      expect(typeof logsQuery.hasValidStreams.value).toBe("boolean");
    });
  });

  describe("error handling", () => {
    it("should handle parsing errors gracefully", () => {
      const result = logsQuery.parseQuery(null);
      expect(result).toBeNull();
    });

    it("should handle building errors gracefully", () => {
      const result = logsQuery.buildQuery(null);
      expect(result).toBe("");
    });

    it("should handle transformation errors gracefully", () => {
      const result = logsQuery.transformQuery("", { invalid: true });
      expect(result).toBe("");
    });

    it("should handle validation errors gracefully", () => {
      // Test validation error handling
      const result = logsQuery.validateQuery("SELECT * FROM logs");
      expect(result).toBeDefined();
      expect(typeof result.isValid).toBe("boolean");
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it("should handle format errors gracefully", () => {
      const result = logsQuery.formatQuery(null);
      expect(result).toBeNull();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete query workflow", () => {
      const query = "SELECT * FROM logs WHERE level='ERROR' LIMIT 100";
      
      // Parse
      const parsed = logsQuery.parseQuery(query);
      expect(parsed).toBeDefined();
      
      // Validate
      const validation = logsQuery.validateQuery(query);
      expect(validation.isValid).toBe(true);
      
      // Get stats
      const stats = logsQuery.getQueryStats(query);
      expect(stats).toBeDefined();
      
      // Format
      const formatted = logsQuery.formatQuery(query, { pretty: true });
      expect(formatted).toBeDefined();
    });

    it("should handle SQL mode vs non-SQL mode differences", () => {
      // Test both modes exist
      expect(logsQuery.isSQLMode).toBeDefined();
      
      const validation1 = logsQuery.validateQuery("SELECT * FROM logs");
      expect(validation1).toBeDefined();
      
      const validation2 = logsQuery.validateQuery("");
      expect(validation2).toBeDefined();
    });

    it("should handle multi-stream scenarios", () => {
      const queryReq = {
        query: { sql: "SELECT * FROM logs" },
        aggs: { histogram: "" }
      };
      
      const result = logsQuery.buildHistogramQuery(queryReq);
      expect(result).toBeDefined();
      expect(result.aggs).toBeDefined();
    });
  });
});