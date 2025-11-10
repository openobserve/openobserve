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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { convertTableData } from "@/utils/dashboard/convertTableData";
import { isTimeSeries, isTimeStamp } from "@/utils/dashboard/convertDataIntoUnitValue";

// Mock external dependencies
vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((date, timezone) => new Date(date)),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  findFirstValidMappedValue: vi.fn((value, mappings, type) => {
    if (mappings && mappings.length > 0) {
      const mapping = mappings.find((m: any) => m.from === value);
      return mapping ? { text: mapping.to } : null;
    }
    return null;
  }),
  formatDate: vi.fn((date) => "2024-01-01 12:00:00"),
  formatUnitValue: vi.fn((unitValue) => unitValue?.value || "0"),
  getUnitValue: vi.fn((value, unit, customUnit, decimals) => ({ value: value?.toString() || "0", unit: unit || "" })),
  isTimeSeries: vi.fn(() => false),
  isTimeStamp: vi.fn(() => false),
}));

describe("convertTableData", () => {
  let mockPanelSchema: any;
  let mockStore: any;
  let mockSearchQueryData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockStore = {
      state: {
        timezone: "UTC"
      }
    };

    mockPanelSchema = {
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }],
      config: {
        table_dynamic_columns: false,
        table_transpose: false,
        override_config: [],
        mappings: [],
        unit: "auto",
        unit_custom: "",
        decimals: 2
      }
    };

    mockSearchQueryData = [[
      { timestamp: "2023-01-01T00:00:00", value: 100 },
      { timestamp: "2023-01-01T01:00:00", value: 200 },
      { timestamp: "2023-01-01T02:00:00", value: 150 }
    ]];
  });

  // Test 1: Basic functionality with valid data
  it("should return rows and columns for valid data", () => {
    const result = convertTableData(mockPanelSchema, mockSearchQueryData, mockStore);
    
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("columns");
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(2);
  });

  // Test 2: Empty or invalid data scenarios
  it("should return empty arrays for non-array searchQueryData", () => {
    const result = convertTableData(mockPanelSchema, null, mockStore);
    
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  it("should return empty arrays for empty searchQueryData array", () => {
    const result = convertTableData(mockPanelSchema, [], mockStore);
    
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  it("should return empty arrays for searchQueryData with null first element", () => {
    const result = convertTableData(mockPanelSchema, [null], mockStore);
    
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  it("should return empty arrays for null panelSchema", () => {
    const result = convertTableData(null, mockSearchQueryData, mockStore);
    
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  // Test 3: Override configurations
  it("should handle override_config with unique_value_color type", () => {
    const schemaWithColorConfig = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        override_config: [
          {
            field: { value: "value" },
            config: [{ type: "unique_value_color", autoColor: true }]
          }
        ]
      }
    };

    const result = convertTableData(schemaWithColorConfig, mockSearchQueryData, mockStore);
    
    expect(result.columns[1]).toHaveProperty("colorMode", "auto");
  });

  it("should handle override_config with unit type", () => {
    const schemaWithUnitConfig = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        override_config: [
          {
            field: { value: "value" },
            config: [{ type: "unit", value: { unit: "bytes", customUnit: "MB" } }]
          }
        ]
      }
    };

    // Mock the data to have numeric values
    const numericData = [[
      { timestamp: "2023-01-01T00:00:00", value: 100.5 },
      { timestamp: "2023-01-01T01:00:00", value: 200.5 }
    ]];

    const result = convertTableData(schemaWithUnitConfig, numericData, mockStore);
    
    expect(result.columns[1]).toHaveProperty("format");
    expect(typeof result.columns[1].format).toBe("function");
  });

  it("should handle override_config with invalid structure", () => {
    const schemaWithInvalidConfig = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        override_config: [
          {
            field: null,
            config: null
          }
        ]
      }
    };

    const result = convertTableData(schemaWithInvalidConfig, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(2);
  });

  it("should handle override_config processing error gracefully", () => {
    const schemaWithCorruptConfig = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        override_config: [{}] // This will cause the forEach to potentially error
      }
    };

    const result = convertTableData(schemaWithCorruptConfig, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(2);
  });

  // Test 4: Dynamic columns functionality
  it("should handle table_dynamic_columns enabled", () => {
    const schemaWithDynamicColumns = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_dynamic_columns: true
      }
    };

    const dataWithExtraColumns = [[
      { timestamp: "2023-01-01T00:00:00", value: 100, extraField1: "test1", extraField2: 50 },
      { timestamp: "2023-01-01T01:00:00", value: 200, extraField1: "test2", extraField3: 75 }
    ]];

    const result = convertTableData(schemaWithDynamicColumns, dataWithExtraColumns, mockStore);
    
    expect(result.columns.length).toBeGreaterThan(2); // Should have more than just x and y fields
  });

  it("should handle table_dynamic_columns with empty response keys", () => {
    const schemaWithDynamicColumns = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_dynamic_columns: true
      }
    };

    const dataWithOnlyXYFields = [[
      { timestamp: "2023-01-01T00:00:00", value: 100 },
      { timestamp: "2023-01-01T01:00:00", value: 200 }
    ]];

    const result = convertTableData(schemaWithDynamicColumns, dataWithOnlyXYFields, mockStore);
    
    expect(result.columns).toHaveLength(2); // Should still have x and y fields
  });

  it("should handle table_dynamic_columns with null tableRows", () => {
    const schemaWithDynamicColumns = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_dynamic_columns: true
      }
    };

    // Use null data for the first element
    const nullData = [null];

    const result = convertTableData(schemaWithDynamicColumns, nullData, mockStore);
    
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  // Test 5: Histogram fields detection for non-custom queries
  it("should identify histogram fields for non-custom queries", () => {
    const schemaWithHistogramField = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp", aggregationFunction: "histogram" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }],
      config: mockPanelSchema.config
    };

    const result = convertTableData(schemaWithHistogramField, mockSearchQueryData, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  it("should detect time series data for non-custom queries", () => {
    vi.mocked(isTimeSeries).mockReturnValue(true);
    vi.mocked(isTimeStamp).mockReturnValue(false);

    const schemaWithTimeSeriesField = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }],
      config: mockPanelSchema.config
    };

    const result = convertTableData(schemaWithTimeSeriesField, mockSearchQueryData, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  it("should detect timestamp data for non-custom queries", () => {
    vi.mocked(isTimeSeries).mockReturnValue(false);
    vi.mocked(isTimeStamp).mockReturnValue(true);

    const schemaWithTimestampField = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp", treatAsNonTimestamp: false }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }],
      config: mockPanelSchema.config
    };

    const result = convertTableData(schemaWithTimestampField, mockSearchQueryData, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  // Test 6: Histogram fields detection for custom queries
  it("should identify histogram fields for custom queries", () => {
    const schemaWithCustomQuery = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp", aggregationFunction: "histogram" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: true
      }],
      config: mockPanelSchema.config
    };

    const result = convertTableData(schemaWithCustomQuery, mockSearchQueryData, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  it("should detect time series data for custom queries", () => {
    vi.mocked(isTimeSeries).mockReturnValue(true);
    vi.mocked(isTimeStamp).mockReturnValue(false);

    const schemaWithCustomQuery = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: true
      }],
      config: mockPanelSchema.config
    };

    const result = convertTableData(schemaWithCustomQuery, mockSearchQueryData, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  // Test 7: Table transpose functionality
  it("should handle table transpose basic functionality", () => {
    const schemaWithTranspose = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_transpose: true
      }
    };

    const result = convertTableData(schemaWithTranspose, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(1); // Should have 1 row (only "value" field after filtering out transpose column)
    expect(result.columns).toHaveLength(4); // Should have 4 columns (label + 3 data columns)
    expect(result.columns[0]).toHaveProperty("name", "label");
    expect(result.columns[0]).toHaveProperty("label", "Timestamp");
  });

  it("should handle transpose with duplicate column values", () => {
    const schemaWithTranspose = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_transpose: true
      }
    };

    const dataWithDuplicates = [[
      { timestamp: "2023-01-01T00:00:00", value: 100 },
      { timestamp: "2023-01-01T00:00:00", value: 200 }, // Duplicate timestamp
      { timestamp: "2023-01-01T01:00:00", value: 150 }
    ]];

    const result = convertTableData(schemaWithTranspose, dataWithDuplicates, mockStore);
    
    expect(result.rows).toHaveLength(1);
    expect(result.columns).toHaveLength(4); // Should handle duplicate by adding suffix
  });

  it("should handle transpose with histogram fields", () => {
    const schemaWithTransposeAndHistogram = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp", aggregationFunction: "histogram" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }],
      config: {
        ...mockPanelSchema.config,
        table_transpose: true
      }
    };

    const result = convertTableData(schemaWithTransposeAndHistogram, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(1);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  // Test 8: Value mapping functionality
  it("should apply value mappings correctly", () => {
    const schemaWithMappings = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        mappings: [
          { from: "100", to: "Low" },
          { from: "200", to: "High" }
        ]
      }
    };

    const result = convertTableData(schemaWithMappings, mockSearchQueryData, mockStore);
    
    expect(result.columns).toHaveLength(2);
    expect(typeof result.columns[0].format).toBe("function");
    expect(typeof result.columns[1].format).toBe("function");
  });

  it("should handle empty mappings", () => {
    const schemaWithEmptyMappings = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        mappings: []
      }
    };

    const result = convertTableData(schemaWithEmptyMappings, mockSearchQueryData, mockStore);
    
    expect(result.columns).toHaveLength(2);
    expect(typeof result.columns[0].format).toBe("function");
  });

  // Test 9: Timestamp formatting edge cases
  it("should handle 16-digit microsecond timestamps", () => {
    const schemaWithHistogram = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [{ alias: "timestamp", label: "Timestamp", aggregationFunction: "histogram" }],
          y: [{ alias: "value", label: "Value" }]
        },
        customQuery: false
      }]
    };

    const dataWith16DigitTimestamp = [[
      { timestamp: "1640995200000000", value: 100 }, // 16-digit microseconds
      { timestamp: "1640998800000000", value: 200 }
    ]];

    const result = convertTableData(schemaWithHistogram, dataWith16DigitTimestamp, mockStore);
    
    expect(result.columns[0]).toHaveProperty("format");
    expect(typeof result.columns[0].format).toBe("function");
  });

  it("should handle non-numeric values for number columns", () => {
    const dataWithMixedTypes = [[
      { timestamp: "2023-01-01T00:00:00", value: "invalid" },
      { timestamp: "2023-01-01T01:00:00", value: 200 },
      { timestamp: "2023-01-01T02:00:00", value: null }
    ]];

    const result = convertTableData(mockPanelSchema, dataWithMixedTypes, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(2);
    expect(typeof result.columns[1].format).toBe("function");
  });

  it("should detect numeric columns and set correct alignment", () => {
    const numericData = [[
      { timestamp: "2023-01-01T00:00:00", value: 100 },
      { timestamp: "2023-01-01T01:00:00", value: 200 },
      { timestamp: "2023-01-01T02:00:00", value: 300 }
    ]];
    
    const result = convertTableData(mockPanelSchema, numericData, mockStore);
    
    // Check that the value column has numeric alignment (indicating it's detected as numeric)
    expect(result.columns[1].align).toBe("right");
    expect(result.columns[0].align).toBe("left"); // timestamp column should be left-aligned
    expect(typeof result.columns[1].sort).toBe("function"); // Should have numeric sort function
  });

  it("should handle undefined and null values", () => {
    const dataWithNulls = [[
      { timestamp: "2023-01-01T00:00:00", value: undefined },
      { timestamp: "2023-01-01T01:00:00", value: null },
      { timestamp: "2023-01-01T02:00:00", value: "" }
    ]];

    const result = convertTableData(mockPanelSchema, dataWithNulls, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(2);
  });

  // Test 10: Complex edge case scenarios
  it("should handle data with no x or y fields", () => {
    const schemaWithoutFields = {
      ...mockPanelSchema,
      queries: [{
        fields: {
          x: [],
          y: []
        },
        customQuery: false
      }]
    };

    const result = convertTableData(schemaWithoutFields, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(0);
  });

  it("should handle transpose with empty underscore handling", () => {
    const schemaWithTranspose = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_transpose: true
      }
    };

    const dataWithUnderscores = [[
      { timestamp: "2023-01-01T08:12:00_1", value: 100 },
      { timestamp: "2023-01-01T08:15:00_2", value: 200 },
      { timestamp: "2023-01-01T08:18:00", value: 300 }
    ]];

    const result = convertTableData(schemaWithTranspose, dataWithUnderscores, mockStore);
    
    expect(result.rows).toHaveLength(1);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it("should handle missing fields in query", () => {
    const schemaWithoutQueryFields = {
      ...mockPanelSchema,
      queries: [{
        customQuery: false
      }]
    };

    const result = convertTableData(schemaWithoutQueryFields, mockSearchQueryData, mockStore);
    
    expect(result.rows).toHaveLength(3);
    expect(result.columns).toHaveLength(0);
  });

  it("should handle mixed column types with dynamic columns", () => {
    const schemaWithDynamicColumns = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        table_dynamic_columns: true
      }
    };

    const mixedData = [[
      { timestamp: "2023-01-01T00:00:00", value: 100, status: "active", count: 5 },
      { timestamp: "2023-01-01T01:00:00", value: 200, status: "inactive", count: "10" },
      { timestamp: "2023-01-01T02:00:00", value: "invalid", status: "pending", count: null }
    ]];

    const result = convertTableData(schemaWithDynamicColumns, mixedData, mockStore);
    expect(result.columns.length).toBeGreaterThan(2);
    expect(result.rows).toHaveLength(3);
  });

  it("should apply unit configuration from override_config for numeric columns", () => {
    const schemaWithUnitOverride = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        decimals: 3,
        unit: "bytes",
        unit_custom: "KB",
        override_config: [
          {
            field: {
              match_by: "exact",
              value: "value"
            },
            config: [
              {
                type: "unit",
                value: {
                  unit: "percent",
                  custom_unit: "%"
                }
              }
            ]
          }
        ]
      },
      queries: [{
        fields: {
          x: [],
          y: [{ alias: "value", column: "value" }]
        },
        customQuery: false
      }]
    };

    const numericData = [[
      { timestamp: "2023-01-01T00:00:00", value: 45.678 },
      { timestamp: "2023-01-01T01:00:00", value: 78.912 },
      { timestamp: "2023-01-01T02:00:00", value: 123.456 }
    ]];

    const result = convertTableData(schemaWithUnitOverride, numericData, mockStore);

    expect(result.columns).toBeDefined();
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(3);

    // Find the value column
    const valueColumn = result.columns.find((col: any) => col.field === "value");
    expect(valueColumn).toBeDefined();
    expect(valueColumn.format).toBeDefined();
  });

  it("should correctly sort numeric columns with custom sort function", () => {
    const schemaWithNumericColumn = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        decimals: 2
      },
      queries: [{
        fields: {
          x: [],
          y: [{ alias: "score", column: "score" }]
        },
        customQuery: false
      }]
    };

    const unsortedData = [[
      { timestamp: "2023-01-01T00:00:00", score: 45.5 },
      { timestamp: "2023-01-01T01:00:00", score: 12.3 },
      { timestamp: "2023-01-01T02:00:00", score: 89.7 },
      { timestamp: "2023-01-01T03:00:00", score: 3.14 }
    ]];

    const result = convertTableData(schemaWithNumericColumn, unsortedData, mockStore);

    // Find the score column
    const scoreColumn = result.columns.find((col: any) => col.field === "score");
    expect(scoreColumn).toBeDefined();
    expect(scoreColumn.sort).toBeDefined();
    expect(scoreColumn.sortable).toBe(true);
    expect(scoreColumn.align).toBe("right"); // Numbers should be right-aligned

    // Test the sort function
    if (scoreColumn.sort) {
      expect(scoreColumn.sort(12.3, 45.5)).toBeLessThan(0);
      expect(scoreColumn.sort(89.7, 45.5)).toBeGreaterThan(0);
      expect(scoreColumn.sort(45.5, 45.5)).toBe(0);
    }
  });

  it("should set colorMode to auto when autoColor is enabled in override_config", () => {
    const schemaWithAutoColor = {
      ...mockPanelSchema,
      config: {
        ...mockPanelSchema.config,
        override_config: [
          {
            field: {
              match_by: "exact",
              value: "status"
            },
            config: [
              {
                type: "unique_value_color",
                autoColor: true
              }
            ]
          }
        ]
      },
      queries: [{
        fields: {
          x: [],
          y: [{ alias: "status", column: "status" }]
        },
        customQuery: false
      }]
    };

    const colorData = [[
      { timestamp: "2023-01-01T00:00:00", status: "active" },
      { timestamp: "2023-01-01T01:00:00", status: "inactive" },
      { timestamp: "2023-01-01T02:00:00", status: "pending" }
    ]];

    const result = convertTableData(schemaWithAutoColor, colorData, mockStore);

    // Find the status column
    const statusColumn = result.columns.find((col: any) => col.field === "status");
    expect(statusColumn).toBeDefined();
    expect(statusColumn.colorMode).toBe("auto");
  });
});