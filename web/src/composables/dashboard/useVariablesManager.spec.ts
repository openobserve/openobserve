// Copyright 2026 OpenObserve Inc.
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

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { gt } from "@/types/i18n";
import {
  useVariablesManager,
  getVariableKey,
  LIVE_COMMIT_DEBOUNCE_MS,
  type VariableConfig,
} from "./useVariablesManager";

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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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

    it("should use the option marked as default (selected) for single-select custom variables", () => {
      // Regression: previously the first option was always used as the default,
      // ignoring the per-option "Default" checkbox (option.selected).
      const manager = useVariablesManager(gt);
      const config: VariableConfig[] = [
        {
          name: "custom_stream",
          type: "custom",
          scope: "panels",
          panels: ["panel-1"],
          multiSelect: false,
          value: "",
          options: [
            { label: "e2e_automate", value: "e2e_automate", selected: false },
            { label: "default", value: "default", selected: true },
          ],
        },
      ];

      manager.initialize(config, {});

      // Should resolve to the default-marked option ("default"), not the first option
      expect(manager.variablesData.panels["panel-1"][0].value).toBe("default");
    });

    it("should use options marked as default (selected) for multiSelect custom variables", () => {
      const manager = useVariablesManager(gt);
      const config: VariableConfig[] = [
        {
          name: "custom_multi",
          type: "custom",
          scope: "global",
          multiSelect: true,
          value: "",
          options: [
            { label: "one", value: "one", selected: false },
            { label: "two", value: "two", selected: true },
            { label: "three", value: "three", selected: true },
          ],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.global[0].value).toEqual(["two", "three"]);
    });

    it("should fall back to the first option when no custom option is marked default", () => {
      const manager = useVariablesManager(gt);
      const config: VariableConfig[] = [
        {
          name: "custom_no_default",
          type: "custom",
          scope: "global",
          multiSelect: false,
          value: "",
          options: [
            { label: "alpha", value: "alpha", selected: false },
            { label: "beta", value: "beta", selected: false },
          ],
        },
      ];

      manager.initialize(config, {});

      expect(manager.variablesData.global[0].value).toBe("alpha");
    });

    it("should migrate legacy variables to global scope", () => {
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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

      // Parent (constant type) should be immediately ready and marked as pending to load
      expect(manager.variablesData.global[0].isVariablePartialLoaded).toBe(true);
      expect(manager.variablesData.global[0].isVariableLoadingPending).toBe(true);

      // Child (query_values type) depends on a non-API type parent (constant)
      // With the fix, children of non-API parents are now marked as pending during initialization
      expect(manager.variablesData.global[1].isVariableLoadingPending).toBe(true);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
      const config: VariableConfig[] = [
        {
          name: "parent",
          type: "custom",
          scope: "global",
          value: "value1",
          options: [
            { label: "value1", value: "value1" },
            { label: "value2", value: "value2" },
          ],
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
      const manager = useVariablesManager(gt);
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
        }),
      );
    });

    it("should format tab variables for URL", () => {
      const manager = useVariablesManager(gt);
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
        }),
      );
    });

    it("should format panel variables for URL", () => {
      const manager = useVariablesManager(gt);
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
        }),
      );
    });

    it("should parse global variables from URL", () => {
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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
      const manager = useVariablesManager(gt);
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

  // A chained child is fast-tracked to pending when EVERY parent loads without
  // an API call, because then there is nothing to wait for. `loadOptionsWithAllDefault`
  // breaks that premise: it makes an all-sentinel parent genuinely fetch its
  // options, so a child pre-marked pending races the parent's response and ships
  // its filter with the parent placeholder never substituted — observed on the
  // wire as `... WHERE "k8s_namespace_name" IN ('$namespace')`, which returns no
  // values and leaves the child picker permanently empty.
  describe("chained loading order when the all-default parent still fetches", () => {
    const chained = (parentExtra: Record<string, unknown>): VariableConfig[] =>
      [
        {
          name: "namespace",
          type: "query_values",
          scope: "global",
          value: "",
          multiSelect: true,
          selectAllValueForMultiSelect: "all",
          query_data: { stream: "k8s_pod_memory_usage", field: "k8s_namespace_name" },
          ...parentExtra,
        },
        {
          name: "pod",
          type: "query_values",
          scope: "global",
          value: "",
          multiSelect: true,
          selectAllValueForMultiSelect: "all",
          query_data: {
            stream: "k8s_pod_memory_usage",
            field: "k8s_pod_name",
            filter: [{ name: "k8s_namespace_name", operator: "IN", value: "$namespace" }],
          },
        },
      ] as VariableConfig[];

    const pendingByName = (config: VariableConfig[]) => {
      const manager = useVariablesManager(gt);
      manager.initialize(config, {});
      return Object.fromEntries(
        manager.variablesData.global.map((v) => [v.name, v.isVariableLoadingPending]),
      );
    };

    it("does NOT pre-mark the child when the all-default parent fetches its options", () => {
      const pending = pendingByName(chained({ loadOptionsWithAllDefault: true }));
      expect(pending.namespace).toBe(true);
      expect(pending.pod).toBe(false);
    });

    it("still pre-marks the child for a pure all-default parent that never fetches", () => {
      const pending = pendingByName(chained({}));
      expect(pending.namespace).toBe(false);
      expect(pending.pod).toBe(true);
    });
  });
});

describe("useVariablesManager live apply and commit-once", () => {
  const chainConfig = (): VariableConfig[] => [
    {
      name: "env",
      type: "custom",
      scope: "global",
      value: "prod",
      options: [
        { label: "prod", value: "prod" },
        { label: "dev", value: "dev" },
      ],
    },
    {
      name: "service",
      type: "query_values",
      scope: "global",
      value: null,
      query_data: { field: "service", filter: [{ filter: "env=$env" }] },
    },
    {
      name: "region",
      type: "custom",
      scope: "global",
      value: "eu",
      options: [
        { label: "eu", value: "eu" },
        { label: "us", value: "us" },
      ],
    },
  ];

  const finishLoading = (v: any, value?: any) => {
    if (value !== undefined) v.value = value;
    v.isLoading = false;
    v.isVariableLoadingPending = false;
    v.isVariablePartialLoaded = true;
  };

  const setupSettled = async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(chainConfig(), {});
    const [env, service, region] = manager.variablesData.global;
    finishLoading(env);
    finishLoading(service, "api");
    finishLoading(region);
    manager.commitAll();
    await nextTick();
    const commits = vi.fn();
    manager.onAutoCommit(commits);
    return { manager, env, service, region, commits };
  };

  const committed = (manager: any, name: string) =>
    manager.committedVariablesData.global.find((v: any) => v.name === name)?.value;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits a live change after the 300ms debounce, not before", async () => {
    const { manager, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS - 1);
    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "region")).toBe("eu");

    vi.advanceTimersByTime(1);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "region")).toBe("us");
    expect(manager.hasUncommittedChanges.value).toBe(false);
  });

  it("uses one debounce for the whole dashboard, so quick changes commit together", async () => {
    const { manager, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    vi.advanceTimersByTime(200);
    manager.updateVariableValue("region", "global", undefined, undefined, "eu");
    vi.advanceTimersByTime(200);
    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "region")).toBe("us");
  });

  it("commits a live textbox change at once, since the input already debounced it", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [{ name: "search", type: "textbox", scope: "global", value: "a" }],
      {},
    );
    finishLoading(manager.variablesData.global[0]);
    manager.commitAll();
    await nextTick();
    const commits = vi.fn();
    manager.onAutoCommit(commits);
    manager.setLiveMode(true);

    manager.updateVariableValue("search", "global", undefined, undefined, "ab");

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "search")).toBe("ab");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it("a variable outside the changed chain does not hold the live commit", async () => {
    const { manager, service, commits } = await setupSettled();
    service.isLoading = true;
    await nextTick();
    manager.setLiveMode(true);

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "region")).toBe("us");
  });

  it("a query blocked by a parent with no data does not hold the commit", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [
        { name: "search", type: "textbox", scope: "global", value: "a" },
        {
          name: "ns",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: { field: "ns", filter: [{ filter: "q=$search" }] },
        },
        {
          name: "ctr",
          type: "query_values",
          scope: "global",
          value: null,
          query_data: { field: "ctr", filter: [{ filter: "ns=$ns" }] },
        },
      ],
      {},
    );
    const [search, ns, ctr] = manager.variablesData.global;
    finishLoading(search);
    finishLoading(ns, null);
    ctr.isVariablePartialLoaded = false;
    ctr.isVariableLoadingPending = true;
    manager.commitAll();
    await nextTick();
    const commits = vi.fn();
    manager.onAutoCommit(commits);
    manager.setLiveMode(true);

    manager.updateVariableValue("search", "global", undefined, undefined, "ab");
    expect(ns.isVariableLoadingPending).toBe(true);
    await nextTick();
    expect(commits).not.toHaveBeenCalled();

    // ns finishes with no options, which leaves ctr pending behind an empty parent.
    finishLoading(ns, null);
    ctr.isVariableLoadingPending = true;
    ctr.isVariablePartialLoaded = false;
    await nextTick();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "search")).toBe("ab");
  });

  it("keeps the textbox on Refresh-to-apply when live mode is off", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [{ name: "search", type: "textbox", scope: "global", value: "a" }],
      {},
    );
    finishLoading(manager.variablesData.global[0]);
    manager.commitAll();

    manager.updateVariableValue("search", "global", undefined, undefined, "ab");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS * 10);

    expect(committed(manager, "search")).toBe("a");
  });

  it("waits for every dependent variable to resolve, then commits once", async () => {
    const { manager, service, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    expect(service.isVariableLoadingPending).toBe(true);
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    await nextTick();
    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "env")).toBe("prod");

    finishLoading(service, "web");
    await nextTick();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "env")).toBe("dev");
    expect(committed(manager, "service")).toBe("web");
  });

  it("keeps today's Refresh-to-apply behaviour when live mode is off", async () => {
    const { manager, commits } = await setupSettled();

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS * 10);

    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "region")).toBe("eu");
    expect(manager.hasUncommittedChanges.value).toBe(true);
  });

  it("turning live mode off drops a pending commit", async () => {
    const { manager, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    manager.setLiveMode(false);
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);

    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "region")).toBe("eu");
  });

  it("turning live mode on applies changes that were waiting for Refresh", async () => {
    const { manager, commits } = await setupSettled();

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    manager.setLiveMode(true);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "region")).toBe("us");
  });

  it("a manual refresh cancels the pending live commit so it does not commit twice", async () => {
    const { manager, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("region", "global", undefined, undefined, "us");
    manager.cancelPendingCommit();
    manager.commitAll();
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);

    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "region")).toBe("us");
  });

  it("commitWhenSettled commits at once when nothing is loading", async () => {
    const { manager, commits } = await setupSettled();
    manager.getVariable("region", "global")!.value = "us";

    manager.commitWhenSettled();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "region")).toBe("us");
  });

  it("repeated commit requests during loading collapse into one commit", async () => {
    const { manager, service, commits } = await setupSettled();
    service.isVariableLoadingPending = true;
    await nextTick();

    manager.commitWhenSettled();
    manager.commitWhenSettled();
    manager.commitWhenSettled();
    expect(commits).not.toHaveBeenCalled();

    finishLoading(service, "web");
    await nextTick();
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it("waits however long a dependent load takes, with no time limit", async () => {
    const { manager, service, commits } = await setupSettled();
    manager.setLiveMode(true);

    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    service.isLoading = true;
    await nextTick();
    vi.advanceTimersByTime(120_000);
    await nextTick();
    expect(commits).not.toHaveBeenCalled();
    expect(committed(manager, "env")).toBe("prod");

    finishLoading(service, "web");
    await nextTick();
    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "service")).toBe("web");
  });

  it("waits for the whole chain when the child is still waiting on a reloading parent", async () => {
    const { manager, env, service, commits } = await setupSettled();
    manager.setLiveMode(true);
    // Opening env's dropdown refetches its options, so env is loading when the user picks.
    env.isLoading = true;
    env.isVariablePartialLoaded = false;

    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    expect(service.isVariableLoadingPending).toBe(false);
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    await nextTick();
    expect(commits).not.toHaveBeenCalled();

    finishLoading(env);
    manager.onVariablePartiallyLoaded("env@global");
    await nextTick();
    expect(service.isVariableLoadingPending).toBe(true);
    expect(commits).not.toHaveBeenCalled();

    finishLoading(service, "web");
    await nextTick();
    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "env")).toBe("dev");
    expect(committed(manager, "service")).toBe("web");
  });

  it("an errored dependent load releases the commit", async () => {
    const { manager, service, commits } = await setupSettled();
    manager.setLiveMode(true);
    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    service.isLoading = true;
    await nextTick();
    expect(commits).not.toHaveBeenCalled();

    // The selector's error path: no value, not loading, marked loaded.
    finishLoading(service, null);
    await nextTick();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "env")).toBe("dev");
  });

  it("an aborted dependent load releases the commit", async () => {
    const { manager, service, commits } = await setupSettled();
    manager.setLiveMode(true);
    manager.updateVariableValue("env", "global", undefined, undefined, "dev");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);
    service.isLoading = true;
    await nextTick();
    expect(commits).not.toHaveBeenCalled();

    // The selector's abort path (markLoadEnded): not loading, no value, marked as done.
    service.isLoading = false;
    service.isVariableLoadingPending = false;
    service.isVariablePartialLoaded = true;
    await nextTick();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(committed(manager, "env")).toBe("dev");
  });

  it("applies live changes in tab and panel scopes through the same debounce", async () => {
    const manager = useVariablesManager(gt);
    await manager.initialize(
      [
        {
          name: "tabVar",
          type: "custom",
          scope: "tabs",
          tabs: ["t1"],
          value: "a",
        },
        {
          name: "panelVar",
          type: "custom",
          scope: "panels",
          panels: ["p1"],
          value: "x",
        },
      ],
      { tabs: [{ tabId: "t1", panels: [{ id: "p1" }] }] },
    );
    manager.setTabVisibility("t1", true);
    manager.setPanelVisibility("p1", true);
    finishLoading(manager.variablesData.tabs.t1[0]);
    finishLoading(manager.variablesData.panels.p1[0]);
    manager.commitAll();
    await nextTick();
    const commits = vi.fn();
    manager.onAutoCommit(commits);
    manager.setLiveMode(true);

    manager.updateVariableValue("tabVar", "tabs", "t1", undefined, "b");
    manager.updateVariableValue("panelVar", "panels", undefined, "p1", "y");
    vi.advanceTimersByTime(LIVE_COMMIT_DEBOUNCE_MS);

    expect(commits).toHaveBeenCalledTimes(1);
    expect(manager.committedVariablesData.tabs.t1[0].value).toBe("b");
    expect(manager.committedVariablesData.panels.p1[0].value).toBe("y");
  });
});
