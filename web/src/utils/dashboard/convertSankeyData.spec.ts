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
import { convertSankeyData } from "./convertSankeyData";

// Mock the convertDataIntoUnitValue module
vi.mock("./convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((value) => `formatted_${value}`),
  getUnitValue: vi.fn((value, unit, unitCustom, decimals) => `unit_${value}`)
}));

describe("convertSankeyData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Input validation", () => {
    it("should return null options when searchQueryData is not an array", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source" },
            target: { alias: "target" },
            value: { alias: "value" }
          }
        }]
      };
      const searchQueryData = null;

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when searchQueryData is empty array", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source" },
            target: { alias: "target" },
            value: { alias: "value" }
          }
        }]
      };
      const searchQueryData: any[] = [];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when first element of searchQueryData is falsy", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source" },
            target: { alias: "target" },
            value: { alias: "value" }
          }
        }]
      };
      const searchQueryData = [null];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when source field is missing", () => {
      const panelSchema = {
        queries: [{
          fields: {
            target: { alias: "target" },
            value: { alias: "value" }
          }
        }]
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when target field is missing", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source" },
            value: { alias: "value" }
          }
        }]
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when value field is missing", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source" },
            target: { alias: "target" }
          }
        }]
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });
  });

  describe("Data processing", () => {
    it("should process valid sankey data successfully", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }],
        config: {
          unit: "bytes",
          unit_custom: null,
          decimals: 2
        }
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 100
        },
        {
          source_field: "B",
          target_field: "C",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options).not.toBeNull();
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].type).toBe("sankey");
      expect(result.options.series[0].data).toHaveLength(3); // A, B, C nodes
      expect(result.options.series[0].links).toHaveLength(2);
      
      // Check nodes
      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");

      // Check links
      expect(result.options.series[0].links).toEqual([
        {
          source: "A",
          target: "B",
          value: 100,
          lineStyle: { curveness: 0.5 }
        },
        {
          source: "B",
          target: "C", 
          value: 200,
          lineStyle: { curveness: 0.5 }
        }
      ]);
    });

    it("should filter out items with null source values", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: null,
          target_field: "B",
          value_field: 100
        },
        {
          source_field: "A",
          target_field: "B",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].source).toBe("A");
    });

    it("should filter out items with null target values", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: null,
          value_field: 100
        },
        {
          source_field: "A",
          target_field: "B",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].target).toBe("B");
    });

    it("should filter out items with null value values", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: null
        },
        {
          source_field: "A",
          target_field: "C",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].value).toBe(200);
    });

    it("should skip items with falsy source in inner condition", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "",  // Falsy but not null
          target_field: "B",
          value_field: 100
        },
        {
          source_field: "A",
          target_field: "B",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].source).toBe("A");
    });

    it("should skip items with falsy target in inner condition", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "",  // Falsy but not null
          value_field: 100
        },
        {
          source_field: "A",
          target_field: "B",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].target).toBe("B");
    });

    it("should skip items with falsy value in inner condition", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 0  // Falsy but not null
        },
        {
          source_field: "A",
          target_field: "C",
          value_field: 200
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].value).toBe(200);
    });
  });

  describe("Tooltip formatter", () => {
    it("should format tooltip with unit value when functions are available", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }],
        config: {
          unit: "bytes",
          unit_custom: null,
          decimals: 2
        }
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 1024
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);
      
      // Test the tooltip formatter
      const tooltipFormatter = result.options.tooltip.formatter;
      const mockParams = {
        name: "TestNode",
        value: 1024
      };
      
      const formattedTooltip = tooltipFormatter(mockParams);
      
      // Since we have mocked functions at the top, they will be available
      expect(formattedTooltip).toBe("TestNode : formatted_unit_1024");
    });

    it("should handle basic tooltip structure", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 1024
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);
      
      expect(result.options.tooltip).toBeDefined();
      expect(result.options.tooltip.trigger).toBe("item");
      expect(typeof result.options.tooltip.formatter).toBe("function");
    });
  });

  describe("Multiple queries", () => {
    it("should handle multiple queries with data", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" }
            }
          },
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" }
            }
          }
        ]
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100
          }
        ],
        [
          {
            source_field: "C",
            target_field: "D",
            value_field: 200
          }
        ]
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].data).toHaveLength(4); // A, B, C, D nodes
      expect(result.options.series[0].links).toHaveLength(2);
      
      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");
      expect(nodeNames).toContain("D");
    });

    it("should handle empty query data in multiple queries", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" }
            }
          },
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" }
            }
          }
        ]
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100
          }
        ],
        [] // Empty second query
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].data).toHaveLength(2); // Only A, B nodes
      expect(result.options.series[0].links).toHaveLength(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle duplicate nodes correctly", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 100
        },
        {
          source_field: "A", // Duplicate source
          target_field: "C",
          value_field: 200
        },
        {
          source_field: "B", // B appears as both source and target
          target_field: "C",
          value_field: 150
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      // Should have unique nodes only
      expect(result.options.series[0].data).toHaveLength(3); // A, B, C (unique)
      expect(result.options.series[0].links).toHaveLength(3);
      
      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");
    });

    it("should verify series configuration properties", () => {
      const panelSchema = {
        queries: [{
          fields: {
            source: { alias: "source_field" },
            target: { alias: "target_field" },
            value: { alias: "value_field" }
          }
        }]
      };
      const searchQueryData = [[
        {
          source_field: "A",
          target_field: "B",
          value_field: 100
        }
      ]];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].type).toBe("sankey");
      expect(result.options.series[0].layout).toBe("none");
      expect(result.options.series[0].emphasis.focus).toBe("adjacency");
      expect(result.options.backgroundColor).toBe("transparent");
    });
  });
});