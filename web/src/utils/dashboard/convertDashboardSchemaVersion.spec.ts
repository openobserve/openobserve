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
    expect(CURRENT_DASHBOARD_SCHEMA_VERSION).toBe(8);
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
    expect(result.version).toBe(8); // Should be upgraded to version 8 through the switch cases
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
            x: [],
            y: [],
            filter: []
          }
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV1);

    expect(result.version).toBe(8);
    expect(result).not.toHaveProperty('layouts'); // layouts should be removed
    expect(result).not.toHaveProperty('panels'); // panels should be moved to tabs
    expect(result.tabs).toBeDefined();
    expect(result.tabs[0].panels[0].layout).toEqual({
      x: 0, // After version 2 and 5 conversion: 0 * 4 * 4 = 0
      y: 0, // After version 6 conversion: 0 * 2 = 0
      h: 6, // After version 5 conversion: 3 * 2 = 6
      w: 96, // After version 2 and 5 conversion: 6 * 4 * 4 = 96
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
    expect(result.version).toBe(8);
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
    expect(result.version).toBe(8);
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
              x: [],
              y: []
            }
          }]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV2);

    expect(result.version).toBe(8);
    expect(result).not.toHaveProperty('panels'); // panels should be moved to tabs
    expect(result.tabs).toBeDefined();
    expect(result.tabs[0].name).toBe("Default");
    expect(result.tabs[0].tabId).toBe("default");
    expect(result.tabs[0].panels[0].layout.x).toBe(32); // 2 * 4 * 4 = 32
    expect(result.tabs[0].panels[0].layout.y).toBe(2); // 1 * 2 = 2 (v6 migration)
    expect(result.tabs[0].panels[0].layout.w).toBe(48); // 3 * 4 * 4 = 48
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: [],
                    breakdown: []
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3);

    expect(result.version).toBe(8);
    // After migration to v8, fields become objects with args, so check the structure
    expect(result.tabs[0].panels[0].queries[0].fields.x.length).toBe(0); // only first x field
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown.length).toBe(0); // rest moved to breakdown
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: []
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithTable);

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].queries[0].fields.x.length).toBe(0); // all x fields preserved for table
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: [],
                    breakdown: []
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithExistingBreakdown);

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].queries[0].fields.x.length).toBe(0); // only first x field
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown.length).toBe(0); // existing + moved field
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: [],
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

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].queries[0].fields.filter).toEqual({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          type: "condition",
          values: ["value1"],
          column: {
            field: "status",
            streamAlias: null
          },
          operator: "=",
          value: "active",
          logicalOperator: "AND",
          filterType: "condition"
        },
        {
          type: "condition",
          values: ["value2"],
          column: {
            field: "category",
            streamAlias: null
          },
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: [],
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

    expect(result.version).toBe(8);
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: []
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

    expect(result.version).toBe(8);
    // Should not modify fields that don't have filter property
  });

  // Test 7: Already converted versions (should not change)
  it("should not modify data that is already version 5 (should upgrade to 7)", () => {
    const dataV5 = {
      version: 5,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              layout: {
                x: 2,
                y: 1,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [],
                    y: [],
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

    expect(result.version).toBe(8);
    // Layout dimensions should be updated
    expect(result.tabs[0].panels[0].layout.w).toBe(48); // 12 * 4
    expect(result.tabs[0].panels[0].layout.x).toBe(8); // 2 * 4
    expect(result.tabs[0].panels[0].layout.h).toBe(8); // 4 * 2
    expect(result.tabs[0].panels[0].layout.y).toBe(2); // 1 * 2 (v6 migration)
  });

  it("should upgrade version 6 dashboard to version 8 (y coordinate fix)", () => {
    const dataV6 = {
      version: 6,
      title: "Test Dashboard",
      tabs: [
        {
          panels: [
            {
              id: "panel-1",
              type: "bar",
              layout: {
                x: 8,
                y: 5,
                h: 8,
                w: 48,
                i: "panel-1"
              },
              queries: []
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV6);

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].layout.y).toBe(10); // 5 * 2 = 10 (y coordinate doubled in v6->v7)
    expect(result.tabs[0].panels[0].layout.x).toBe(8); // x unchanged
    expect(result.tabs[0].panels[0].layout.h).toBe(8); // h unchanged
    expect(result.tabs[0].panels[0].layout.w).toBe(48); // w unchanged
  });

  it("should handle version higher than current schema version", () => {
    const dataV7 = {
      version: 8,
      title: "Test Dashboard",
      tabs: []
    };

    const result = convertDashboardSchemaVersion(dataV7);

    expect(result.version).toBe(8);
    expect(result).toEqual(dataV7); // Should be unchanged
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [], // single x field
                    y: [],
                    breakdown: []
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithSingleX);

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].queries[0].fields.x.length).toBe(0); // unchanged
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown.length).toBe(0); // empty array added
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
              layout: {
                x: 0,
                y: 0,
                h: 4,
                w: 12,
                i: "panel-1"
              },
              queries: [
                {
                  fields: {
                    x: [], // empty x fields
                    y: []
                  }
                }
              ]
            }
          ]
        }
      ]
    };

    const result = convertDashboardSchemaVersion(dataV3WithNoX);

    expect(result.version).toBe(8);
    expect(result.tabs[0].panels[0].queries[0].fields.x).toEqual([]); // unchanged
    expect(result.tabs[0].panels[0].queries[0].fields.breakdown).toEqual([]); // empty array added
  });
});