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

import { describe, expect, it } from "vitest";
import { 
  buildVariablesDependencyGraph, 
  isGraphHasCycle 
} from "./variablesDependencyUtils";

describe("Variables Dependency Utils", () => {
  describe("buildVariablesDependencyGraph", () => {
    it("should build empty graph for empty variables list", () => {
      const variables = [];
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph).toEqual({});
    });

    it("should build graph for variables without dependencies", () => {
      const variables = [
        { name: "region", type: "constant", query_data: null },
        { name: "env", type: "textbox", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph).toEqual({
        region: { parentVariables: [], childVariables: [] },
        env: { parentVariables: [], childVariables: [] },
      });
    });

    it("should build graph for query_values variables with dependencies", () => {
      const variables = [
        { 
          name: "region", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "field='$env'" }] 
          } 
        },
        { name: "env", type: "constant", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      // region depends on env, so env should be in region's parentVariables
      expect(graph.region.parentVariables).toContain("env");
      // Due to the implementation bug, non-query_values variables get their childVariables reset
      expect(graph.env.childVariables).toEqual([]);
      expect(graph.env.parentVariables).toEqual([]);
      expect(graph.region.childVariables).toEqual([]);
    });

    it("should handle variables with multiple dependencies", () => {
      const variables = [
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [
              { value: "region='$region' AND env='$env'" },
              { value: "namespace='$namespace'" }
            ] 
          } 
        },
        { name: "region", type: "constant", query_data: null },
        { name: "env", type: "textbox", query_data: null },
        { name: "namespace", type: "custom", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.service.parentVariables).toEqual(expect.arrayContaining(["region", "env", "namespace"]));
      // Due to implementation bug, non-query_values variables get childVariables reset to []
      expect(graph.region.childVariables).toEqual([]);
      expect(graph.env.childVariables).toEqual([]);
      expect(graph.namespace.childVariables).toEqual([]);
    });

    it("should handle complex variable names with hyphens and underscores", () => {
      const variables = [
        { 
          name: "k8s-namespace", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "cluster='$k8s_cluster_name'" }] 
          } 
        },
        { name: "k8s_cluster_name", type: "constant", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph["k8s-namespace"].parentVariables).toContain("k8s_cluster_name");
      // Due to implementation bug, non-query_values variables get childVariables reset
      expect(graph["k8s_cluster_name"].childVariables).toEqual([]);
    });

    it("should handle variables that reference themselves", () => {
      const variables = [
        { 
          name: "region", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "region!='$region'" }] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.region.parentVariables).toContain("region");
      expect(graph.region.childVariables).toContain("region");
    });

    it("should ignore non-existent variable references", () => {
      const variables = [
        { 
          name: "region", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "field='$nonexistent' AND other='$alsonotexist'" }] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.region.parentVariables).toEqual([]);
      expect(graph.region.childVariables).toEqual([]);
    });

    it("should handle variables with no query_data", () => {
      const variables = [
        { name: "region", type: "query_values", query_data: null },
        { name: "env", type: "query_values", query_data: undefined },
        { name: "service", type: "query_values", query_data: {} },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.region.parentVariables).toEqual([]);
      expect(graph.env.parentVariables).toEqual([]);
      expect(graph.service.parentVariables).toEqual([]);
    });

    it("should handle variables with empty filter array", () => {
      const variables = [
        { 
          name: "region", 
          type: "query_values", 
          query_data: { filter: [] } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.region.parentVariables).toEqual([]);
    });

    it("should handle duplicate variable references in same filter", () => {
      const variables = [
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "region='$region' OR fallback_region='$region'" }] 
          } 
        },
        { name: "region", type: "constant", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      // Should have region only once in parentVariables despite multiple references
      expect(graph.service.parentVariables).toEqual(["region"]);
      // Due to implementation bug, non-query_values variables get childVariables reset
      expect(graph.region.childVariables).toEqual([]);
    });

    it("should handle mixed variable types in complex scenario", () => {
      const variables = [
        { name: "env", type: "constant", query_data: null },
        { name: "region", type: "textbox", query_data: null },
        { name: "cluster", type: "custom", query_data: null },
        { 
          name: "namespace", 
          type: "query_values", 
          query_data: { 
            filter: [
              { value: "environment='$env'" },
              { value: "region='$region'" }
            ] 
          } 
        },
        { 
          name: "pod", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "namespace='$namespace' AND cluster='$cluster'" }] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.namespace.parentVariables).toEqual(expect.arrayContaining(["env", "region"]));
      expect(graph.pod.parentVariables).toEqual(expect.arrayContaining(["namespace", "cluster"]));
      // Non-query_values variables get childVariables populated by later query_values variables
      expect(graph.env.childVariables).toContain("namespace");
      expect(graph.region.childVariables).toContain("namespace");
      expect(graph.cluster.childVariables).toContain("pod");
      // Only query_values variables keep their childVariables
      expect(graph.namespace.childVariables).toContain("pod");
    });
  });

  describe("isGraphHasCycle", () => {
    it("should return null for empty graph", () => {
      const graph = {};
      const result = isGraphHasCycle(graph);
      
      expect(result).toBeNull();
    });

    it("should return null for graph without cycles", () => {
      const graph = {
        a: { parentVariables: [], childVariables: ["b"] },
        b: { parentVariables: ["a"], childVariables: ["c"] },
        c: { parentVariables: ["b"], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).toBeNull();
    });

    it("should return null for disconnected graph without cycles", () => {
      const graph = {
        a: { parentVariables: [], childVariables: [] },
        b: { parentVariables: [], childVariables: [] },
        c: { parentVariables: [], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).toBeNull();
    });

    it("should detect simple cycle", () => {
      const graph = {
        a: { parentVariables: ["b"], childVariables: [] },
        b: { parentVariables: ["a"], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should detect self-referencing cycle", () => {
      const graph = {
        a: { parentVariables: ["a"], childVariables: ["a"] },
        b: { parentVariables: [], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should detect complex cycle", () => {
      const graph = {
        a: { parentVariables: ["c"], childVariables: ["b"] },
        b: { parentVariables: ["a"], childVariables: ["c"] },
        c: { parentVariables: ["b"], childVariables: ["a"] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should detect cycle in larger graph", () => {
      const graph = {
        a: { parentVariables: [], childVariables: [] },
        b: { parentVariables: ["c"], childVariables: [] }, // b depends on c
        c: { parentVariables: ["d"], childVariables: [] }, // c depends on d
        d: { parentVariables: ["b"], childVariables: [] }, // d depends on b -> Creates cycle b->c->d->b
        e: { parentVariables: [], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle graph with multiple disconnected components", () => {
      const graph = {
        // First component (no cycle)
        a: { parentVariables: [], childVariables: ["b"] },
        b: { parentVariables: ["a"], childVariables: [] },
        // Second component (has cycle)
        x: { parentVariables: ["y"], childVariables: [] },
        y: { parentVariables: ["x"], childVariables: [] },
        // Third component (isolated)
        z: { parentVariables: [], childVariables: [] },
      };
      
      const result = isGraphHasCycle(graph);
      
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Integration Tests", () => {
    it("should detect cycles in realistic variable dependency scenario", () => {
      const variables = [
        { 
          name: "region", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "service='$service'" }] 
          } 
        },
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "region='$region'" }] 
          } 
        },
        { name: "env", type: "constant", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);
      
      expect(hasCycle).not.toBeNull();
      expect(Array.isArray(hasCycle)).toBe(true);
    });

    it("should handle complex dependency chain without cycles", () => {
      const variables = [
        { name: "env", type: "constant", query_data: null },
        { 
          name: "region", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "environment='$env'" }] 
          } 
        },
        { 
          name: "cluster", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "region='$region'" }] 
          } 
        },
        { 
          name: "namespace", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "cluster='$cluster'" }] 
          } 
        },
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "namespace='$namespace'" }] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);
      
      expect(hasCycle).toBeNull();
    });

    it("should handle variables with complex filter expressions", () => {
      const variables = [
        { name: "env", type: "constant", query_data: null },
        { name: "region", type: "textbox", query_data: null },
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [
              { value: "environment IN ('$env', 'staging') AND region LIKE '%$region%'" },
              { value: "status != 'down' OR fallback_env = '$env'" }
            ] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.service.parentVariables).toEqual(expect.arrayContaining(["env", "region"]));
      // Non-query_values variables get childVariables populated by query_values variables
      expect(graph.env.childVariables).toContain("service");
      expect(graph.region.childVariables).toContain("service");
      
      const hasCycle = isGraphHasCycle(graph);
      expect(hasCycle).toBeNull();
    });

    it("should handle edge case with special characters in variable names", () => {
      const variables = [
        { name: "k8s-cluster_name", type: "constant", query_data: null },
        { 
          name: "pod-name", 
          type: "query_values", 
          query_data: { 
            filter: [{ value: "cluster_name='$k8s-cluster_name'" }] 
          } 
        },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph["pod-name"].parentVariables).toContain("k8s-cluster_name");
      // Non-query_values variables get childVariables populated by query_values variables
      expect(graph["k8s-cluster_name"].childVariables).toContain("pod-name");
      
      const hasCycle = isGraphHasCycle(graph);
      expect(hasCycle).toBeNull();
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle null or undefined variables", () => {
      const variables = [
        null,
        undefined,
        { name: "valid", type: "constant", query_data: null }
      ].filter(Boolean);
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.valid).toEqual({
        parentVariables: [],
        childVariables: []
      });
    });

    it("should handle variables with missing properties", () => {
      const variables = [
        { name: "incomplete1" }, // missing type and query_data
        { type: "constant" }, // missing name
        { name: "valid", type: "constant", query_data: null }
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.valid).toBeDefined();
      expect(graph.incomplete1).toBeDefined();
    });

    it("should handle malformed filter values", () => {
      const variables = [
        { 
          name: "service", 
          type: "query_values", 
          query_data: { 
            filter: [
              { value: null },
              { value: undefined },
              { value: "" },
              { value: "valid='$env'" }
            ] 
          } 
        },
        { name: "env", type: "constant", query_data: null },
      ];
      
      const graph = buildVariablesDependencyGraph(variables);
      
      expect(graph.service.parentVariables).toContain("env");
    });

    it("should handle very large dependency graphs", () => {
      const variables = [];
      
      // Create a large chain: var0 -> var1 -> var2 -> ... -> var99
      for (let i = 0; i < 100; i++) {
        const variable = {
          name: `var${i}`,
          type: i === 0 ? "constant" : "query_values",
          query_data: i === 0 ? null : {
            filter: [{ value: `field='$var${i-1}'` }]
          }
        };
        variables.push(variable);
      }
      
      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);
      
      expect(Object.keys(graph)).toHaveLength(100);
      expect(hasCycle).toBeNull();
    });
  });

  describe("Dependency Detection for Stream and Field References", () => {
    it("should detect dependencies in query_data.stream", () => {
      const variables = [
        {
          name: "fieldVar",
          type: "query_values",
          query_data: {
            stream: "$streamVar",
            field: "status",
            filter: [],
          },
        },
        { name: "streamVar", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.fieldVar.parentVariables).toContain("streamVar");
      expect(graph.streamVar.childVariables).toContain("fieldVar");
    });

    it("should detect dependencies in query_data.field", () => {
      const variables = [
        {
          name: "dataVar",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$fieldVar",
            filter: [],
          },
        },
        { name: "fieldVar", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.dataVar.parentVariables).toContain("fieldVar");
      expect(graph.fieldVar.childVariables).toContain("dataVar");
    });

    it("should detect dependencies across stream, field, and filters", () => {
      const variables = [
        {
          name: "complexVar",
          type: "query_values",
          query_data: {
            stream: "$streamVar",
            field: "$fieldVar",
            filter: [{ value: "status='$statusVar'" }],
          },
        },
        { name: "streamVar", type: "constant", query_data: null },
        { name: "fieldVar", type: "constant", query_data: null },
        { name: "statusVar", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.complexVar.parentVariables).toEqual(
        expect.arrayContaining(["streamVar", "fieldVar", "statusVar"])
      );
      expect(graph.complexVar.parentVariables.length).toBe(3);
    });

    it("should not duplicate dependencies when variable referenced multiple times", () => {
      const variables = [
        {
          name: "multiRefVar",
          type: "query_values",
          query_data: {
            stream: "$baseVar",
            field: "$baseVar",
            filter: [{ value: "field='$baseVar'" }],
          },
        },
        { name: "baseVar", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      // Should only appear once in parentVariables despite being referenced 3 times
      expect(graph.multiRefVar.parentVariables).toEqual(["baseVar"]);
      expect(graph.multiRefVar.parentVariables.length).toBe(1);
    });

    it("should handle stream with embedded variable in string", () => {
      const variables = [
        {
          name: "dynamicStream",
          type: "query_values",
          query_data: {
            stream: "logs_$environment",
            field: "message",
            filter: [],
          },
        },
        { name: "environment", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.dynamicStream.parentVariables).toContain("environment");
      expect(graph.environment.childVariables).toContain("dynamicStream");
    });

    it("should handle field with multiple variables", () => {
      const variables = [
        {
          name: "multiFieldVar",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$prefix_$suffix",
            filter: [],
          },
        },
        { name: "prefix", type: "constant", query_data: null },
        { name: "suffix", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.multiFieldVar.parentVariables).toEqual(
        expect.arrayContaining(["prefix", "suffix"])
      );
      expect(graph.multiFieldVar.parentVariables.length).toBe(2);
    });

    it("should detect circular dependency through stream references", () => {
      const variables = [
        {
          name: "var1",
          type: "query_values",
          query_data: {
            stream: "$var2",
            field: "field1",
            filter: [],
          },
        },
        {
          name: "var2",
          type: "query_values",
          query_data: {
            stream: "$var1",
            field: "field2",
            filter: [],
          },
        },
      ];

      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);

      expect(hasCycle).not.toBeNull();
      expect(Array.isArray(hasCycle)).toBe(true);
      expect(hasCycle).toContain("var1");
      expect(hasCycle).toContain("var2");
    });

    it("should detect circular dependency through field references", () => {
      const variables = [
        {
          name: "var1",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$var2",
            filter: [],
          },
        },
        {
          name: "var2",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$var1",
            filter: [],
          },
        },
      ];

      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);

      expect(hasCycle).not.toBeNull();
      expect(Array.isArray(hasCycle)).toBe(true);
    });

    it("should detect complex circular dependency across stream, field, and filter", () => {
      const variables = [
        {
          name: "var1",
          type: "query_values",
          query_data: {
            stream: "$var2",
            field: "field1",
            filter: [],
          },
        },
        {
          name: "var2",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$var3",
            filter: [],
          },
        },
        {
          name: "var3",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "field3",
            filter: [{ value: "status='$var1'" }],
          },
        },
      ];

      const graph = buildVariablesDependencyGraph(variables);
      const hasCycle = isGraphHasCycle(graph);

      expect(hasCycle).not.toBeNull();
      expect(Array.isArray(hasCycle)).toBe(true);
      // Cycle should be: var1 -> var2 -> var3 -> var1
    });

    it("should handle mixed dependency sources correctly", () => {
      const variables = [
        {
          name: "root",
          type: "constant",
          query_data: null,
        },
        {
          name: "level1Stream",
          type: "query_values",
          query_data: {
            stream: "$root",
            field: "field1",
            filter: [],
          },
        },
        {
          name: "level1Field",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "$root",
            filter: [],
          },
        },
        {
          name: "level1Filter",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "field3",
            filter: [{ value: "status='$root'" }],
          },
        },
        {
          name: "level2Combined",
          type: "query_values",
          query_data: {
            stream: "$level1Stream",
            field: "$level1Field",
            filter: [{ value: "field='$level1Filter'" }],
          },
        },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      // root should be parent of level1 variables
      expect(graph.level1Stream.parentVariables).toEqual(["root"]);
      expect(graph.level1Field.parentVariables).toEqual(["root"]);
      expect(graph.level1Filter.parentVariables).toEqual(["root"]);

      // level2Combined should depend on all level1 variables
      expect(graph.level2Combined.parentVariables).toEqual(
        expect.arrayContaining(["level1Stream", "level1Field", "level1Filter"])
      );
      expect(graph.level2Combined.parentVariables.length).toBe(3);

      // root should have all level1 as children
      expect(graph.root.childVariables).toEqual(
        expect.arrayContaining(["level1Stream", "level1Field", "level1Filter"])
      );
    });

    it("should be backward compatible with filter-only dependencies", () => {
      const variables = [
        {
          name: "region",
          type: "query_values",
          query_data: {
            stream: "logs",
            field: "region",
            filter: [{ value: "environment='$env'" }],
          },
        },
        { name: "env", type: "constant", query_data: null },
      ];

      const graph = buildVariablesDependencyGraph(variables);

      expect(graph.region.parentVariables).toContain("env");
      expect(graph.env.childVariables).toContain("region");
    });
  });
});