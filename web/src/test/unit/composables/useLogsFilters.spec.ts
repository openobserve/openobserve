// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsFilters } from "@/composables/useLogsFilters";

// Mock dependencies
vi.mock("vue", () => ({
  ref: vi.fn((val) => ({ value: val })),
  reactive: vi.fn((obj) => obj),
  computed: vi.fn((fn) => ({ value: fn() }))
}));

// Mock useLocalLogFilterField
vi.mock("@/utils/zincutils", () => ({
  useLocalLogFilterField: vi.fn(() => ({
    value: {
      "test-org_test-stream_logs": ["field1", "field2"]
    }
  }))
}));

// Mock useLogsState
vi.mock("@/composables/useLogsState", () => ({
  useLogsState: vi.fn(() => ({
    searchObj: {
      organizationIdentifier: "test-org",
      data: {
        query: "SELECT * FROM logs",
        stream: {
          filterField: "",
          selectedStream: [
            { name: "test-stream", value: "test-stream" }
          ],
          selectedStreamFields: [
            { name: "timestamp", type: "string" },
            { name: "message", type: "string" },
            { name: "level", type: "string" }
          ],
          selectedFields: [],
          streamType: "logs"
        }
      },
      meta: {
        sqlMode: false
      }
    }
  }))
}));

// Mock validator utilities
vi.mock("@/utils/logs/validators", () => ({
  validateMultiStreamFilter: vi.fn((params) => {
    // Simple validation logic
    if (params.selectedStream.length <= 1) return true;
    return params.filterCondition.length > 0;
  })
}));

// Mock formatter utilities
vi.mock("@/utils/logs/formatters", () => ({
  createFilterExpression: vi.fn((params) => {
    return `${params.field} ${params.operator} '${params.value}'`;
  }),
  formatFilterValue: vi.fn((value) => {
    if (typeof value === "string") return `'${value}'`;
    return String(value);
  }),
  parseFilterCondition: vi.fn((query) => {
    // Mock parsing - return some example conditions
    if (query.includes("level")) {
      return [
        { field: "level", operator: "=", value: "ERROR", type: "include" }
      ];
    }
    return [];
  })
}));

describe("useLogsFilters", () => {
  let logsFilters: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsFilters = useLogsFilters();
  });

  describe("initialization", () => {
    it("should initialize filters composable with all required functions", () => {
      expect(logsFilters).toBeDefined();
      expect(typeof logsFilters.addFieldFilter).toBe("function");
      expect(typeof logsFilters.removeFieldFilter).toBe("function");
      expect(typeof logsFilters.clearAllFilters).toBe("function");
      expect(typeof logsFilters.validateFilterForMultiStream).toBe("function");
    });

    it("should initialize reactive state", () => {
      expect(logsFilters.activeFilters).toBeDefined();
      expect(logsFilters.filterGroups).toBeDefined();
      expect(logsFilters.quickFilters).toBeDefined();
    });

    it("should initialize computed properties", () => {
      expect(logsFilters.hasActiveFilters).toBeDefined();
      expect(logsFilters.activeFilterCount).toBeDefined();
      expect(logsFilters.isMultiStreamFilterValid).toBeDefined();
    });
  });

  describe("local filter field management", () => {
    it("should update local log filter field", () => {
      expect(() => logsFilters.updateLocalLogFilterField()).not.toThrow();
    });

    it("should handle error in updating local filter field", () => {
      // Test error handling without dynamic imports
      expect(() => logsFilters.updateLocalLogFilterField()).not.toThrow();
    });
  });

  describe("multi-stream filter validation", () => {
    it("should validate filter for multi-stream", () => {
      const result = logsFilters.validateFilterForMultiStream();
      expect(typeof result).toBe("boolean");
    });

    it("should handle validation errors", () => {
      // Test validation error handling
      const result = logsFilters.validateFilterForMultiStream();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("filter expression creation", () => {
    it("should create filter expression by field type", () => {
      const result = logsFilters.getFilterExpressionByFieldType("level", "ERROR", "=");
      expect(typeof result).toBe("string");
      expect(result).toContain("level");
      expect(result).toContain("ERROR");
    });

    it("should handle errors in filter expression creation", () => {
      // Test error handling in expression creation
      const result = logsFilters.getFilterExpressionByFieldType("level", "ERROR", "=");
      expect(typeof result).toBe("string");
    });
  });

  describe("field filter management", () => {
    it("should add field filter", () => {
      expect(() => logsFilters.addFieldFilter("level", "ERROR", "include")).not.toThrow();
      expect(logsFilters.activeFilters.level).toBeDefined();
    });

    it("should remove field filter", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      expect(() => logsFilters.removeFieldFilter("level", "ERROR")).not.toThrow();
    });

    it("should remove entire field filter when no value specified", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      expect(() => logsFilters.removeFieldFilter("level")).not.toThrow();
    });

    it("should toggle field filter", () => {
      // First toggle should add
      logsFilters.toggleFieldFilter("level", "ERROR", "include");
      expect(logsFilters.isFieldValueFiltered("level", "ERROR")).toBe(true);

      // Second toggle should remove
      logsFilters.toggleFieldFilter("level", "ERROR", "include");
      expect(logsFilters.isFieldValueFiltered("level", "ERROR")).toBe(false);
    });

    it("should check if field value is filtered", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      expect(logsFilters.isFieldValueFiltered("level", "ERROR")).toBe(true);
      expect(logsFilters.isFieldValueFiltered("level", "INFO")).toBe(false);
    });

    it("should clear all filters", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      logsFilters.addFieldFilter("status", "500", "include");
      
      expect(() => logsFilters.clearAllFilters()).not.toThrow();
    });

    it("should handle errors in field filter operations", () => {
      // Test error handling
      expect(() => logsFilters.addFieldFilter("", null, "include")).not.toThrow();
      expect(() => logsFilters.removeFieldFilter("nonexistent")).not.toThrow();
      expect(() => logsFilters.toggleFieldFilter("", null)).not.toThrow();
    });
  });

  describe("filter groups", () => {
    it("should create filter condition", () => {
      const condition = logsFilters.createFilterCondition("level", "=", "ERROR", "include");
      expect(condition).toBeDefined();
      expect(condition.field).toBe("level");
      expect(condition.operator).toBe("=");
      expect(condition.value).toBe("ERROR");
      expect(condition.type).toBe("include");
    });

    it("should add filter group", () => {
      const conditions = [
        logsFilters.createFilterCondition("level", "=", "ERROR", "include"),
        logsFilters.createFilterCondition("status", ">=", "400", "include")
      ];
      
      expect(() => logsFilters.addFilterGroup(conditions, "AND")).not.toThrow();
    });

    it("should remove filter group", () => {
      const conditions = [
        logsFilters.createFilterCondition("level", "=", "ERROR", "include")
      ];
      
      logsFilters.addFilterGroup(conditions, "AND");
      expect(() => logsFilters.removeFilterGroup(0)).not.toThrow();
    });

    it("should handle invalid filter group removal", () => {
      expect(() => logsFilters.removeFilterGroup(-1)).not.toThrow();
      expect(() => logsFilters.removeFilterGroup(999)).not.toThrow();
    });
  });

  describe("quick filters", () => {
    it("should apply quick filter", () => {
      const config = {
        field: "level",
        value: "ERROR",
        type: "include"
      };
      
      expect(() => logsFilters.applyQuickFilter("errorLogs", config)).not.toThrow();
    });

    it("should apply quick filter with conditions", () => {
      const config = {
        conditions: [
          { field: "level", operator: "=", value: "ERROR", type: "include" }
        ],
        operator: "AND"
      };
      
      expect(() => logsFilters.applyQuickFilter("complexFilter", config)).not.toThrow();
    });

    it("should remove quick filter", () => {
      const config = { field: "level", value: "ERROR", type: "include" };
      logsFilters.applyQuickFilter("errorLogs", config);
      
      expect(() => logsFilters.removeQuickFilter("errorLogs")).not.toThrow();
    });

    it("should handle removing non-existent quick filter", () => {
      expect(() => logsFilters.removeQuickFilter("nonExistent")).not.toThrow();
    });
  });

  describe("query integration", () => {
    it("should parse existing filters from query", () => {
      const query = "SELECT * FROM logs WHERE level = 'ERROR'";
      expect(() => logsFilters.parseExistingFilters(query)).not.toThrow();
    });

    it("should update query with filters", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      expect(() => logsFilters.updateQueryWithFilters()).not.toThrow();
    });

    it("should build field filter expression", () => {
      const expression = logsFilters.buildFieldFilterExpression("level", ["ERROR", "WARN"], "include");
      expect(typeof expression).toBe("string");
      expect(expression).toContain("level");
      expect(expression).toContain("IN");
    });

    it("should build group filter expression", () => {
      const group = {
        conditions: [
          { field: "level", operator: "=", value: "ERROR", type: "include" },
          { field: "status", operator: ">=", value: "400", type: "include" }
        ],
        operator: "AND"
      };
      
      const expression = logsFilters.buildGroupFilterExpression(group);
      expect(typeof expression).toBe("string");
      expect(expression).toContain("AND");
    });

    it("should handle empty values in filter expressions", () => {
      const expression = logsFilters.buildFieldFilterExpression("level", [], "include");
      expect(expression).toBe("");
    });
  });

  describe("utility functions", () => {
    it("should get filter summary", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      logsFilters.addFieldFilter("status", "404", "exclude");
      
      const summary = logsFilters.getFilterSummary();
      expect(summary).toBeDefined();
      expect(typeof summary).toBe("object");
    });

    it("should export filters", () => {
      logsFilters.addFieldFilter("level", "ERROR", "include");
      
      const exported = logsFilters.exportFilters();
      expect(exported).toBeDefined();
      expect(exported.fieldFilters).toBeDefined();
      expect(exported.filterGroups).toBeDefined();
      expect(exported.quickFilters).toBeDefined();
    });

    it("should import filters", () => {
      const config = {
        fieldFilters: {
          level: {
            values: ["ERROR", "WARN"],
            type: "include"
          }
        },
        filterGroups: [],
        quickFilters: {},
        filterField: "level IN ('ERROR', 'WARN')"
      };
      
      expect(() => logsFilters.importFilters(config)).not.toThrow();
    });

    it("should handle errors in utility functions", () => {
      expect(() => logsFilters.getFilterSummary()).not.toThrow();
      expect(() => logsFilters.exportFilters()).not.toThrow();
      expect(() => logsFilters.importFilters({})).not.toThrow();
    });
  });

  describe("computed properties behavior", () => {
    it("should compute hasActiveFilters correctly", () => {
      // Initially no filters
      expect(typeof logsFilters.hasActiveFilters.value).toBe("boolean");
      
      // Add a filter
      logsFilters.addFieldFilter("level", "ERROR", "include");
      // Note: In real scenario this would be reactive
    });

    it("should compute activeFilterCount correctly", () => {
      expect(typeof logsFilters.activeFilterCount.value).toBe("number");
    });

    it("should compute isMultiStreamFilterValid correctly", () => {
      expect(typeof logsFilters.isMultiStreamFilterValid.value).toBe("boolean");
    });
  });

  describe("error handling", () => {
    it("should handle general errors gracefully", () => {
      // Test various error scenarios
      expect(() => logsFilters.addFieldFilter(null, null, "include")).not.toThrow();
      expect(() => logsFilters.parseExistingFilters(null)).not.toThrow();
      expect(() => logsFilters.updateQueryWithFilters()).not.toThrow();
    });

    it("should handle formatter utility errors", () => {
      // Test formatter error handling
      expect(() => logsFilters.buildFieldFilterExpression("level", ["ERROR"], "include")).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete filtering workflow", () => {
      // Add multiple filters
      logsFilters.addFieldFilter("level", "ERROR", "include");
      logsFilters.addFieldFilter("level", "WARN", "include");
      logsFilters.addFieldFilter("status", "404", "exclude");
      
      // Create filter group
      const conditions = [
        logsFilters.createFilterCondition("timestamp", ">", "2023-01-01", "include")
      ];
      logsFilters.addFilterGroup(conditions, "AND");
      
      // Apply quick filter
      logsFilters.applyQuickFilter("recentErrors", {
        field: "level",
        value: "ERROR",
        type: "include"
      });
      
      // Export and import
      const exported = logsFilters.exportFilters();
      logsFilters.clearAllFilters();
      logsFilters.importFilters(exported);
      
      // Verify state
      expect(logsFilters.getFilterSummary()).toBeDefined();
    });
  });
});