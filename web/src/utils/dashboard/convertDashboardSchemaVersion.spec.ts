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

import { describe, expect, it, beforeEach } from "vitest";
import { convertDashboardSchemaVersion, CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";

describe("convertDashboardSchemaVersion", () => {
  let mockData: any;

  beforeEach(() => {
    mockData = {
      version: 1,
      id: "dashboard-123",
      title: "Test Dashboard"
    };
  });

  // Test 1: Basic functionality - constants
  it("should have correct current schema version", () => {
    expect(CURRENT_DASHBOARD_SCHEMA_VERSION).toBe(5);
  });

  // Test 2: Edge cases - null/undefined data
  it("should return undefined for null data", () => {
    const result = convertDashboardSchemaVersion(null);
    expect(result).toBeUndefined();
  });

  it("should return undefined for undefined data", () => {
    const result = convertDashboardSchemaVersion(undefined);
    expect(result).toBeUndefined();
  });

  it("should assign version 1 if no version is present and handle empty data", () => {
    const dataWithoutVersion = {
      id: "dashboard-123",
      title: "Test Dashboard",
      layouts: [],
      panels: []
    };
    
    const result = convertDashboardSchemaVersion(dataWithoutVersion);
    expect(result.version).toBe(5); // Should be upgraded to version 5 through the switch cases
  });

  // Test 3: Version 1 conversion tests
  it("should convert version 1 dashboard with layouts and panels", () => {
    const dataV1 = {
      version: 1,
      title: "Test Dashboard",
      layouts: [
        {
          panelId: "panel-1",
          x: 0,
          y: 0,
          h: 3,
          w: 6,
          i: "panel-1"
        }
      ],
      panels: [
        {
          id: "panel-1",
          type: "bar",
          config: {
            title: "Test Panel",
            description: "Test Description",
            show_legends: true,
            legends_position: "right",
            unit: "bytes",
            unit_custom: "MB",
            promql_legend: "test_legend"
          },
          queryType: "sql",
          query: "SELECT * FROM test",
          customQuery: false,
          fields: {
            stream_type: "logs",
            stream: "test_stream",
            x: ["timestamp"],
            y: ["count"],
            filter: []
          }
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV1);
    
    expect(result.version).toBe(5);
    expect(result).not.toHaveProperty('layouts'); // layouts should be removed
    expect(result).not.toHaveProperty('panels'); // panels should be moved to tabs
    expect(result.tabs).toBeDefined();
    expect(result.tabs[0].panels[0].layout).toEqual({
      x: 0, // After version 2 conversion: 0 * 4 = 0
      y: 0,  
      h: 3,
      w: 24, // After version 2 conversion: 6 * 4 = 24
      i: "panel-1"
    });
  });

  it("should handle null layouts in version 1", () => {
    const dataV1WithNullLayouts = {
      version: 1,
      title: "Test Dashboard",
      layouts: null,
      panels: []
    };

    const result = convertDashboardSchemaVersion(dataV1WithNullLayouts);
    expect(result.version).toBe(5);
  });

  it("should handle panels with missing fields in convertPanelSchemaVersion", () => {
    const dataV1WithIncompletePanel = {
      version: 1,
      title: "Test Dashboard",
      layouts: [
        {
          panelId: "panel-1",
          x: 0,
          y: 0,
          h: 3,
          w: 6,
          i: "panel-1"
        }
      ],
      panels: [
        {
          id: "panel-1",
          type: "bar",
          config: {}, // Missing some config fields
          fields: {} // Missing fields
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV1WithIncompletePanel);
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels.length).toBe(1);
    expect(result.tabs[0].panels[0].queries[0].fields.z).toEqual([]); // Should add z field
    expect(result.tabs[0].panels[0].queries[0].fields.stream_type).toBe("logs"); // Should default to logs
  });

  // Test 4: Version 2 conversion tests
  it("should convert version 2 dashboard - layout width migration and tabs creation", () => {
    const dataV2 = {
      version: 2,
      title: "Test Dashboard",
      panels: [
        {
          id: "panel-1",
          type: "bar",
          layout: {
            x: 2,
            y: 1,
            h: 4,
            w: 3,
            i: "panel-1"
          },
          queries: [{
            fields: {
              x: ["timestamp"],
              y: ["count"]
            }
          }]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV2);
    
    expect(result.version).toBe(5);
    expect(result).not.toHaveProperty('panels'); // panels should be moved to tabs
    expect(result.tabs).toBeDefined();
    expect(result.tabs[0].name).toBe("Default");
    expect(result.tabs[0].tabId).toBe("default");
    expect(result.tabs[0].panels[0].layout.x).toBe(8); // 2 * 4 = 8
    expect(result.tabs[0].panels[0].layout.w).toBe(12); // 3 * 4 = 12
  });

  // Test 5: Version 3 conversion tests - breakdown fields migration
  it("should convert version 3 dashboard - move excess x-axis fields to breakdown for non-table panels", () => {
    const dataV3 = {
      version: 3,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar", // not table type
              queries: [
                {
                  fields: {
                    x: ["field1", "field2", "field3"], // multiple x fields
                    y: ["count"]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual(["field1"]); // only first x field
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual(["field2", "field3"]); // rest moved to breakdown
  });

  it("should not modify x fields for table panels in version 3", () => {
    const dataV3WithTable = {
      version: 3,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "table", // table type
              queries: [
                {
                  fields: {
                    x: ["field1", "field2", "field3"], // multiple x fields
                    y: ["count"]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithTable);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual(["field1", "field2", "field3"]); // all x fields preserved for table
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual([]); // breakdown should be empty array
  });

  it("should handle existing breakdown fields in version 3", () => {
    const dataV3WithExistingBreakdown = {
      version: 3,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "line",
              queries: [
                {
                  fields: {
                    x: ["field1", "field2"],
                    y: ["count"],
                    breakdown: ["existing1", "existing2"]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithExistingBreakdown);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual(["field1"]); // only first x field
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual(["existing1", "existing2", "field2"]); // existing + moved field
  });

  // Test 6: Version 4 conversion tests - filter format migration  
  it("should convert version 4 dashboard - migrate filter array to new format", () => {
    const dataV4 = {
      version: 4,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              queries: [
                {
                  fields: {
                    x: ["field1"],
                    y: ["count"],
                    filter: [
                      {
                        type: "condition",
                        values: ["value1"],
                        column: "status",
                        operator: "=",
                        value: "active"
                      },
                      {
                        type: "condition",
                        values: ["value2"],
                        column: "category",
                        operator: "!=",
                        value: "test"
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV4);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.filter).toEqual({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          type: "condition",
          values: ["value1"],
          column: "status",
          operator: "=",
          value: "active",
          logicalOperator: "AND",
          filterType: "condition"
        },
        {
          type: "condition",
          values: ["value2"],
          column: "category",
          operator: "!=",
          value: "test",
          logicalOperator: "AND",
          filterType: "condition"
        }
      ]
    });
  });

  it("should handle empty filter array in version 4", () => {
    const dataV4WithEmptyFilter = {
      version: 4,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              queries: [
                {
                  fields: {
                    x: ["field1"],
                    y: ["count"],
                    filter: [] // empty filter array
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV4WithEmptyFilter);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.filter).toEqual({
      filterType: "group",
      logicalOperator: "AND",
      conditions: []
    });
  });

  it("should handle missing filter property in version 4", () => {
    const dataV4WithNoFilter = {
      version: 4,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              queries: [
                {
                  fields: {
                    x: ["field1"],
                    y: ["count"]
                    // no filter property
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV4WithNoFilter);
    
    expect(result.version).toBe(5);
    // Should not modify fields that don't have filter property
  });

  // Test 7: Already converted versions (should not change)
  it("should not modify data that is already version 5", () => {
    const dataV5 = {
      version: 5,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              queries: [
                {
                  fields: {
                    x: ["field1"],
                    y: ["count"],
                    filter: {
                      filterType: "group",
                      logicalOperator: "AND",
                      conditions: []
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV5);
    
    expect(result.version).toBe(5);
    expect(result).toEqual(dataV5); // Should be unchanged
  });

  it("should handle version higher than current schema version", () => {
    const dataV6 = {
      version: 6,
      title: "Test Dashboard",
      tabs: []
    };

    const result = convertDashboardSchemaVersion(dataV6);
    
    expect(result.version).toBe(6);
    expect(result).toEqual(dataV6); // Should be unchanged
  });

  // Test 8: Additional edge cases for complete coverage
  it("should handle single x field for version 3 (no breakdown needed)", () => {
    const dataV3WithSingleX = {
      version: 3,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              queries: [
                {
                  fields: {
                    x: ["field1"], // single x field
                    y: ["count"]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithSingleX);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual(["field1"]); // unchanged
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual([]); // empty array added
  });

  it("should handle zero x fields for version 3", () => {
    const dataV3WithNoX = {
      version: 3,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "line",
              queries: [
                {
                  fields: {
                    x: [], // empty x fields
                    y: ["count"]
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithNoX);
    
    expect(result.version).toBe(5);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual([]); // unchanged
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual([]); // empty array added
  });
});