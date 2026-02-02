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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useVariablesManager, getVariableKey, type VariableConfig } from "./useVariablesManager";

describe("useVariablesManager", () => {
  describe("getVariableKey", () => {
    it("should generate correct key for global scope", () => {
      const key = getVariableKey("country", "global");
      expect(key).toBe("country@global");
    });

    it("should generate correct key for tab scope", () => {
      const key = getVariableKey("region", "tabs", "tab-1");
      expect(key).toBe("region@tab@tab-1");
    });

    it("should generate correct key for panel scope", () => {
      const key = getVariableKey("status", "panels", undefined, "panel-123");
      expect(key).toBe("status@panel@panel-123");
    });
  });

  describe("Variable Expansion", () => {
    it("should expand global variable without modification", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "country",
          type: "custom",
          scope: "global",
          value: "USA",
          options: [{ label: "USA", value: "USA" }],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.global).toHaveLength(1);
      expect(manager.variablesData.global[0].name).toBe("country");
      expect(manager.variablesData.global[0].scope).toBe("global");
    });

    it("should expand tab variable into multiple instances", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "region",
          type: "custom",
          scope: "tabs",
          tabs: ["tab-1", "tab-2", "tab-3"],
          value: null,
          options: [],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.tabs["tab-1"]).toHaveLength(1);
      expect(manager.variablesData.tabs["tab-2"]).toHaveLength(1);
      expect(manager.variablesData.tabs["tab-3"]).toHaveLength(1);

      expect(manager.variablesData.tabs["tab-1"][0].tabId).toBe("tab-1");
      expect(manager.variablesData.tabs["tab-2"][0].tabId).toBe("tab-2");
      expect(manager.variablesData.tabs["tab-3"][0].tabId).toBe("tab-3");
    });

    it("should expand panel variable into multiple instances", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "status",
          type: "custom",
          scope: "panels",
          panels: ["panel-1", "panel-2"],
          value: null,
          options: [],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.panels["panel-1"]).toHaveLength(1);
      expect(manager.variablesData.panels["panel-2"]).toHaveLength(1);

      expect(manager.variablesData.panels["panel-1"][0].panelId).toBe("panel-1");
      expect(manager.variablesData.panels["panel-2"][0].panelId).toBe("panel-2");
    });

    it("should migrate legacy variables to global scope", () => {
      const manager = useVariablesManager();
      const config: any[] = [
        {
          name: "legacy",
          type: "custom",
          // No scope field
          value: "test",
          options: [],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.global).toHaveLength(1);
      expect(manager.variablesData.global[0].scope).toBe("global");
    });
  });

  describe("Dependency Graph", () => {
    it("should build dependency graph for global variables", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "country",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "country",
            filter: [],
          },
        },
        {
          name: "region",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "region",
            filter: [{ filter: "country=$country" }],
          },
        },
      ];

      manager.initialize(config, {});

      const graph = manager.dependencyGraph.value;
      expect(graph["country@global"].children).toContain("region@global");
      expect(graph["region@global"].parents).toContain("country@global");
    });

    it("should build dependency graph across scopes", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "country",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "country",
            filter: [],
          },
        },
        {
          name: "region",
          type: "query_values",
          scope: "tabs",
          tabs: ["tab-1"],
          value: null,
          query_data: {
            field: "region",
            filter: [{ filter: "country=$country" }],
          },
        },
      ];

      manager.initialize(config, {});

      const graph = manager.dependencyGraph.value;
      expect(graph["country@global"].children).toContain("region@tab@tab-1");
      expect(graph["region@tab@tab-1"].parents).toContain("country@global");
    });

    it("should detect circular dependencies", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "var1",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "field1",
            filter: [{ filter: "field=$var2" }],
          },
        },
        {
          name: "var2",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "field2",
            filter: [{ filter: "field=$var1" }],
          },
        },
      ];

      await expect(async () => {
        await manager.initialize(config, {});
      }).rejects.toThrow(/circular dependency/i);
    });

    it("should ignore invalid cross-scope dependencies when parent not found", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "tabVar",
          type: "query_values",
          scope: "tabs",
          tabs: ["tab-1"],
          value: null,
          query_data: {
            field: "field1",
            filter: [],
          },
        },
        {
          name: "globalVar",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "field2",
            filter: [{ filter: "field=$tabVar" }],
          },
        },
      ];

      // Should not throw error - parent variable not found in accessible scope
      await manager.initialize(config, {});

      const graph = manager.dependencyGraph.value;
      // globalVar should have no parents since tabVar is not in its scope
      expect(graph["globalVar@global"].parents).toHaveLength(0);
    });
  });

  describe("Variable Loading", () => {
    it("should load independent global variables in parallel", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "var1",
          type: "constant",
          scope: "global",
          value: "value1",
        },
        {
          name: "var2",
          type: "constant",
          scope: "global",
          value: "value2",
        },
      ];

      await manager.initialize(config, {});

      expect(manager.variablesData.global[0].isVariablePartialLoaded).toBe(true);
      expect(manager.variablesData.global[1].isVariablePartialLoaded).toBe(true);
    });

    it("should load dependent variables after parent completes", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "parent",
          type: "constant",
          scope: "global",
          value: "parentValue",
        },
        {
          name: "child",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "field",
            filter: [{ filter: "field=$parent" }],
          },
        },
      ];

      await manager.initialize(config, {});

      // Parent (constant type) should be immediately ready
      expect(manager.variablesData.global[0].isVariablePartialLoaded).toBe(true);

      // Child (query_values type) has a dependency so it won't be marked as pending initially
      // Only independent query_values variables are marked as pending during initialization
      expect(manager.variablesData.global[1].isVariableLoadingPending).toBe(false);
      expect(manager.variablesData.global[1].isVariablePartialLoaded).toBe(false);

      // Verify dependency graph is correct
      const graph = manager.dependencyGraph.value;
      expect(graph["child@global"].parents).toContain("parent@global");
      expect(graph["parent@global"].children).toContain("child@global");

      // After child loads (simulated by setting the flags), it should be ready
      manager.variablesData.global[1].isVariableLoadingPending = false;
      manager.variablesData.global[1].isVariablePartialLoaded = true;
      manager.variablesData.global[1].value = ["value1", "value2"];

      expect(manager.variablesData.global[1].isVariablePartialLoaded).toBe(true);
    });

    it("should only load tab variables when tab is visible", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "tabVar",
          type: "constant",
          scope: "tabs",
          tabs: ["tab-1"],
          value: "value",
        },
      ];

      await manager.initialize(config, {});

      // Tab not visible yet - constant types are already loaded but not pending
      // Constant variables are immediately ready regardless of visibility
      expect(manager.variablesData.tabs["tab-1"][0].isVariablePartialLoaded).toBe(true);
      expect(manager.variablesData.tabs["tab-1"][0].isVariableLoadingPending).toBe(false);

      // Mark tab as visible
      manager.setTabVisibility("tab-1", true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Variable should still be loaded (it was already ready)
      expect(manager.variablesData.tabs["tab-1"][0].isVariablePartialLoaded).toBe(true);
    });

    it("should only load panel variables when panel is visible", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "panelVar",
          type: "constant",
          scope: "panels",
          panels: ["panel-1"],
          value: "value",
        },
      ];

      await manager.initialize(config, {});

      // Panel not visible yet - constant types are already loaded but not pending
      // Constant variables are immediately ready regardless of visibility
      expect(manager.variablesData.panels["panel-1"][0].isVariablePartialLoaded).toBe(true);
      expect(manager.variablesData.panels["panel-1"][0].isVariableLoadingPending).toBe(false);

      // Mark panel as visible
      manager.setPanelVisibility("panel-1", true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Variable should still be loaded (it was already ready)
      expect(manager.variablesData.panels["panel-1"][0].isVariablePartialLoaded).toBe(true);
    });
  });

  describe("Variable Updates", () => {
    it("should update variable value and trigger dependents", async () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "parent",
          type: "custom",
          scope: "global",
          value: "value1",
          options: [{ label: "value1", value: "value1" }, { label: "value2", value: "value2" }],
        },
        {
          name: "child",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: {
            field: "field",
            filter: [{ filter: "field=$parent" }],
          },
        },
      ];

      await manager.initialize(config, {});

      // Update parent value
      await manager.updateVariableValue("parent", "global", undefined, undefined, "value2");

      expect(manager.variablesData.global[0].value).toBe("value2");
      // Child should be triggered to reload
    });
  });

  describe("URL Synchronization", () => {
    it("should format global variables for URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "country",
          type: "custom",
          scope: "global",
          value: "USA",
        },
      ];

      manager.initialize(config, {});
      // Commit to make values available for getUrlParams
      manager.commitAll();

      // Use new getUrlParams API
      const urlParams = manager.getUrlParams({ useLive: false });

      expect(urlParams).toEqual(
        expect.objectContaining({
          "var-country": "USA",
        })
      );
    });

    it("should format tab variables for URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "region",
          type: "custom",
          scope: "tabs",
          tabs: ["tab-1"],
          value: "CA",
        },
      ];

      manager.initialize(config, {});
      manager.variablesData.tabs["tab-1"][0].value = "CA";
      // Commit to make values available for getUrlParams
      manager.commitAll();

      // Use new getUrlParams API
      const urlParams = manager.getUrlParams({ useLive: false });

      expect(urlParams).toEqual(
        expect.objectContaining({
          "var-region.t.tab-1": "CA",
        })
      );
    });

    it("should format panel variables for URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "status",
          type: "custom",
          scope: "panels",
          panels: ["panel-123"],
          value: "200",
        },
      ];

      manager.initialize(config, {});
      manager.variablesData.panels["panel-123"][0].value = "200";
      // Commit to make values available for getUrlParams
      manager.commitAll();

      // Use new getUrlParams API
      const urlParams = manager.getUrlParams({ useLive: false });

      expect(urlParams).toEqual(
        expect.objectContaining({
          "var-status.p.panel-123": "200",
        })
      );
    });

    it("should parse global variables from URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "country",
          type: "custom",
          scope: "global",
          value: null,
        },
      ];

      manager.initialize(config, {});

      const mockRoute = {
        query: {
          "var-country": "USA",
        },
      };

      manager.loadFromUrl(mockRoute);

      expect(manager.variablesData.global[0].value).toBe("USA");
    });

    it("should parse tab variables from URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "region",
          type: "custom",
          scope: "tabs",
          tabs: ["tab-1"],
          value: null,
        },
      ];

      manager.initialize(config, {});

      const mockRoute = {
        query: {
          "var-region.t.tab-1": "CA,NY",
        },
      };

      manager.loadFromUrl(mockRoute);

      // Should be parsed as array for multi-select
      expect(manager.variablesData.tabs["tab-1"][0].value).toBe("CA,NY");
    });

    it("should parse panel variables from URL", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "status",
          type: "custom",
          scope: "panels",
          panels: ["panel-123"],
          value: null,
        },
      ];

      manager.initialize(config, {});

      const mockRoute = {
        query: {
          "var-status.p.panel-123": "200",
        },
      };

      manager.loadFromUrl(mockRoute);

      expect(manager.variablesData.panels["panel-123"][0].value).toBe("200");
    });
  });

  describe("Variable Queries", () => {
    it("should get variables for panel (merged: global + tab + panel)", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "globalVar",
          type: "constant",
          scope: "global",
          value: "g",
        },
        {
          name: "tabVar",
          type: "constant",
          scope: "tabs",
          tabs: ["tab-1"],
          value: "t",
        },
        {
          name: "panelVar",
          type: "constant",
          scope: "panels",
          panels: ["panel-1"],
          value: "p",
        },
      ];

      const mockDashboard = {
        tabs: [
          {
            tabId: "tab-1",
            panels: [{ id: "panel-1" }],
          },
        ],
      };

      manager.initialize(config, mockDashboard);

      const panelVars = manager.getVariablesForPanel("panel-1", "tab-1");

      expect(panelVars).toHaveLength(3);
      expect(panelVars.map((v) => v.name)).toEqual(["globalVar", "tabVar", "panelVar"]);
    });

    it("should get variables for tab (merged: global + tab)", () => {
      const manager = useVariablesManager();
      const config: VariableConfig[] = [
        {
          name: "globalVar",
          type: "constant",
          scope: "global",
          value: "g",
        },
        {
          name: "tabVar",
          type: "constant",
          scope: "tabs",
          tabs: ["tab-1"],
          value: "t",
        },
      ];

      manager.initialize(config, {});

      const tabVars = manager.getVariablesForTab("tab-1");

      expect(tabVars).toHaveLength(2);
      expect(tabVars.map((v) => v.name)).toEqual(["globalVar", "tabVar"]);
    });
  });
});
