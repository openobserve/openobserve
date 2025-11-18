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

import { describe, it, expect } from "vitest";
import {
  encodeVariableToUrl,
  encodeVariablesToUrl,
  parseVariableUrlKey,
  decodeVariablesFromUrl,
  getEffectiveVariableValue,
  resolveVariablesForContext,
} from "./variablesUrlUtils";

describe("variablesUrlUtils", () => {
  describe("encodeVariableToUrl", () => {
    describe("Global Scope", () => {
      it("should encode global variable with simple value", () => {
        const variable = {
          name: "namespace",
          scope: "global" as const,
          value: "dev-api",
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({ "var-namespace": "dev-api" });
      });

      it("should encode global variable with numeric value", () => {
        const variable = {
          name: "count",
          scope: "global" as const,
          value: 42,
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({ "var-count": 42 });
      });

      it("should encode global variable with null value", () => {
        const variable = {
          name: "nullVar",
          scope: "global" as const,
          value: null,
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({ "var-nullVar": null });
      });

      it("should encode global variable with array value", () => {
        const variable = {
          name: "items",
          scope: "global" as const,
          value: ["item1", "item2", "item3"],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({ "var-items": ["item1", "item2", "item3"] });
      });
    });

    describe("Tab Scope", () => {
      it("should encode tab variable with array of tab values", () => {
        const variable = {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: "us-west" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-region.t.tab1": "us-east",
          "var-region.t.tab2": "us-west",
        });
      });

      it("should encode tab variable with single value and current tab ID", () => {
        const variable = {
          name: "region",
          scope: "tabs" as const,
          value: "us-east",
        };

        const result = encodeVariableToUrl(variable, "tab1");

        expect(result).toEqual({
          "var-region.t.tab1": "us-east",
        });
      });

      it("should return empty object for tab variable without tab ID", () => {
        const variable = {
          name: "region",
          scope: "tabs" as const,
          value: "us-east",
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({});
      });

      it("should skip tab values with null or undefined", () => {
        const variable = {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: null },
            { tabId: "tab3", value: undefined },
            { tabId: "tab4", value: "us-west" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-region.t.tab1": "us-east",
          "var-region.t.tab4": "us-west",
        });
      });

      it("should skip tab values without tabId", () => {
        const variable = {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "", value: "us-central" },
            { value: "us-west" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-region.t.tab1": "us-east",
        });
      });
    });

    describe("Panel Scope", () => {
      it("should encode panel variable with array of panel values", () => {
        const variable = {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: "memory" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-metric.p.panel1": "cpu",
          "var-metric.p.panel2": "memory",
        });
      });

      it("should encode panel variable with single value and current panel ID", () => {
        const variable = {
          name: "metric",
          scope: "panels" as const,
          value: "cpu",
        };

        const result = encodeVariableToUrl(variable, undefined, "panel123");

        expect(result).toEqual({
          "var-metric.p.panel123": "cpu",
        });
      });

      it("should return empty object for panel variable without panel ID", () => {
        const variable = {
          name: "metric",
          scope: "panels" as const,
          value: "cpu",
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({});
      });

      it("should skip panel values with null or undefined", () => {
        const variable = {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: null },
            { panelId: "panel3", value: undefined },
            { panelId: "panel4", value: "memory" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-metric.p.panel1": "cpu",
          "var-metric.p.panel4": "memory",
        });
      });

      it("should skip panel values without panelId", () => {
        const variable = {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "", value: "disk" },
            { value: "memory" },
          ],
        };

        const result = encodeVariableToUrl(variable);

        expect(result).toEqual({
          "var-metric.p.panel1": "cpu",
        });
      });
    });
  });

  describe("encodeVariablesToUrl", () => {
    it("should encode multiple variables", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "dev" },
        { name: "region", scope: "tabs" as const, value: [{ tabId: "tab1", value: "us-east" }] },
        { name: "metric", scope: "panels" as const, value: [{ panelId: "p1", value: "cpu" }] },
      ];

      const result = encodeVariablesToUrl(variables, "tab1");

      expect(result).toEqual({
        "var-namespace": "dev",
        "var-region.t.tab1": "us-east",
        "var-metric.p.p1": "cpu",
      });
    });

    it("should handle empty variables array", () => {
      const result = encodeVariablesToUrl([]);

      expect(result).toEqual({});
    });

    it("should handle variables with same name but different scopes", () => {
      const variables = [
        { name: "env", scope: "global" as const, value: "production" },
        { name: "env", scope: "tabs" as const, value: [{ tabId: "tab1", value: "dev" }] },
      ];

      const result = encodeVariablesToUrl(variables, "tab1");

      expect(result).toEqual({
        "var-env": "production",
        "var-env.t.tab1": "dev",
      });
    });
  });

  describe("parseVariableUrlKey", () => {
    describe("Valid Keys", () => {
      it("should parse global variable key", () => {
        const result = parseVariableUrlKey("var-namespace");

        expect(result).toEqual({
          name: "namespace",
          scope: "global",
          value: null,
        });
      });

      it("should parse tab-scoped variable key", () => {
        const result = parseVariableUrlKey("var-region.t.tab1");

        expect(result).toEqual({
          name: "region",
          scope: "tabs",
          scopeId: "tab1",
          value: null,
        });
      });

      it("should parse panel-scoped variable key", () => {
        const result = parseVariableUrlKey("var-metric.p.panel123");

        expect(result).toEqual({
          name: "metric",
          scope: "panels",
          scopeId: "panel123",
          value: null,
        });
      });

      it("should handle variable names with hyphens", () => {
        const result = parseVariableUrlKey("var-my-variable-name");

        expect(result).toEqual({
          name: "my-variable-name",
          scope: "global",
          value: null,
        });
      });

      it("should handle variable names with numbers", () => {
        const result = parseVariableUrlKey("var-var123");

        expect(result).toEqual({
          name: "var123",
          scope: "global",
          value: null,
        });
      });

      it("should handle scope IDs with special characters", () => {
        const result = parseVariableUrlKey("var-region.t.tab-123-abc");

        expect(result).toEqual({
          name: "region",
          scope: "tabs",
          scopeId: "tab-123-abc",
          value: null,
        });
      });
    });

    describe("Invalid Keys", () => {
      it("should return null for key without var- prefix", () => {
        const result = parseVariableUrlKey("namespace");

        expect(result).toBeNull();
      });

      it("should return null for empty string", () => {
        const result = parseVariableUrlKey("");

        expect(result).toBeNull();
      });

      it("should return null for just var-", () => {
        const result = parseVariableUrlKey("var-");

        expect(result).toEqual({
          name: "",
          scope: "global",
          value: null,
        });
      });
    });
  });

  describe("decodeVariablesFromUrl", () => {
    it("should decode global variable from URL params", () => {
      const queryParams = {
        "var-namespace": "dev-api",
        "otherParam": "value",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result).toEqual({
        namespace: {
          name: "namespace",
          scope: "global",
          value: "dev-api",
        },
      });
    });

    it("should decode tab-scoped variables from URL params", () => {
      const queryParams = {
        "var-region.t.tab1": "us-east",
        "var-region.t.tab2": "us-west",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result).toEqual({
        region: {
          name: "region",
          scope: "tabs",
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: "us-west" },
          ],
        },
      });
    });

    it("should decode panel-scoped variables from URL params", () => {
      const queryParams = {
        "var-metric.p.panel1": "cpu",
        "var-metric.p.panel2": "memory",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result).toEqual({
        metric: {
          name: "metric",
          scope: "panels",
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: "memory" },
          ],
        },
      });
    });

    it("should decode mixed scope variables", () => {
      const queryParams = {
        "var-env": "production",
        "var-region.t.tab1": "us-east",
        "var-metric.p.panel1": "cpu",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result).toEqual({
        env: {
          name: "env",
          scope: "global",
          value: "production",
        },
        region: {
          name: "region",
          scope: "tabs",
          value: [{ tabId: "tab1", value: "us-east" }],
        },
        metric: {
          name: "metric",
          scope: "panels",
          value: [{ panelId: "panel1", value: "cpu" }],
        },
      });
    });

    it("should ignore non-variable params", () => {
      const queryParams = {
        "var-namespace": "dev",
        "page": "1",
        "limit": "10",
        "sort": "asc",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result).toEqual({
        namespace: {
          name: "namespace",
          scope: "global",
          value: "dev",
        },
      });
    });

    it("should handle empty query params", () => {
      const result = decodeVariablesFromUrl({});

      expect(result).toEqual({});
    });

    it("should ignore invalid variable keys", () => {
      const queryParams = {
        "var-": "value",
        "invalid-key": "value",
        "var-valid": "goodValue",
      };

      const result = decodeVariablesFromUrl(queryParams);

      expect(result.valid).toBeDefined();
      expect(result.valid.value).toBe("goodValue");
    });
  });

  describe("getEffectiveVariableValue", () => {
    it("should return global variable value", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "production" },
      ];

      const result = getEffectiveVariableValue("namespace", variables, {});

      expect(result).toBe("production");
    });

    it("should return tab variable value for matching tab", () => {
      const variables = [
        {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: "us-west" },
          ],
        },
      ];

      const result = getEffectiveVariableValue("region", variables, { tabId: "tab2" });

      expect(result).toBe("us-west");
    });

    it("should return panel variable value for matching panel", () => {
      const variables = [
        {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: "memory" },
          ],
        },
      ];

      const result = getEffectiveVariableValue("metric", variables, { panelId: "panel2" });

      expect(result).toBe("memory");
    });

    it("should return null for non-existent variable", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "production" },
      ];

      const result = getEffectiveVariableValue("nonexistent", variables, {});

      expect(result).toBeNull();
    });

    it("should return null for tab variable without matching tab", () => {
      const variables = [
        {
          name: "region",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: "us-east" }],
        },
      ];

      const result = getEffectiveVariableValue("region", variables, { tabId: "tab999" });

      expect(result).toBeNull();
    });

    it("should return null for panel variable without matching panel", () => {
      const variables = [
        {
          name: "metric",
          scope: "panels" as const,
          value: [{ panelId: "panel1", value: "cpu" }],
        },
      ];

      const result = getEffectiveVariableValue("metric", variables, { panelId: "panel999" });

      expect(result).toBeNull();
    });

    it("should return first value for tab variable without context", () => {
      const variables = [
        {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: "us-west" },
          ],
        },
      ];

      const result = getEffectiveVariableValue("region", variables, {});

      expect(result).toBe("us-east");
    });

    it("should return first value for panel variable without context", () => {
      const variables = [
        {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: "memory" },
          ],
        },
      ];

      const result = getEffectiveVariableValue("metric", variables, {});

      expect(result).toBe("cpu");
    });
  });

  describe("resolveVariablesForContext", () => {
    it("should resolve global variables", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "production" },
        { name: "env", scope: "global" as const, value: "prod" },
      ];

      const result = resolveVariablesForContext(variables, {});

      expect(result).toEqual({
        namespace: "production",
        env: "prod",
      });
    });

    it("should resolve tab-scoped variables for current tab", () => {
      const variables = [
        {
          name: "region",
          scope: "tabs" as const,
          value: [
            { tabId: "tab1", value: "us-east" },
            { tabId: "tab2", value: "us-west" },
          ],
        },
      ];

      const result = resolveVariablesForContext(variables, { tabId: "tab2" });

      expect(result).toEqual({
        region: "us-west",
      });
    });

    it("should resolve panel-scoped variables for current panel", () => {
      const variables = [
        {
          name: "metric",
          scope: "panels" as const,
          value: [
            { panelId: "panel1", value: "cpu" },
            { panelId: "panel2", value: "memory" },
          ],
        },
      ];

      const result = resolveVariablesForContext(variables, { panelId: "panel2" });

      expect(result).toEqual({
        metric: "memory",
      });
    });

    it("should apply precedence: panel > tab > global", () => {
      const variables = [
        { name: "var1", scope: "global" as const, value: "global-value" },
        {
          name: "var1",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: "tab-value" }],
        },
        {
          name: "var1",
          scope: "panels" as const,
          value: [{ panelId: "panel1", value: "panel-value" }],
        },
      ];

      const result = resolveVariablesForContext(variables, {
        tabId: "tab1",
        panelId: "panel1",
      });

      expect(result).toEqual({
        var1: "panel-value",
      });
    });

    it("should fall back to tab when panel not found", () => {
      const variables = [
        { name: "var1", scope: "global" as const, value: "global-value" },
        {
          name: "var1",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: "tab-value" }],
        },
        {
          name: "var1",
          scope: "panels" as const,
          value: [{ panelId: "panel999", value: "panel-value" }],
        },
      ];

      const result = resolveVariablesForContext(variables, {
        tabId: "tab1",
        panelId: "panel1",
      });

      expect(result).toEqual({
        var1: "tab-value",
      });
    });

    it("should fall back to global when tab and panel not found", () => {
      const variables = [
        { name: "var1", scope: "global" as const, value: "global-value" },
        {
          name: "var1",
          scope: "tabs" as const,
          value: [{ tabId: "tab999", value: "tab-value" }],
        },
        {
          name: "var1",
          scope: "panels" as const,
          value: [{ panelId: "panel999", value: "panel-value" }],
        },
      ];

      const result = resolveVariablesForContext(variables, {
        tabId: "tab1",
        panelId: "panel1",
      });

      expect(result).toEqual({
        var1: "global-value",
      });
    });

    it("should handle mixed variables with different scopes", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "production" },
        {
          name: "region",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: "us-east" }],
        },
        {
          name: "metric",
          scope: "panels" as const,
          value: [{ panelId: "panel1", value: "cpu" }],
        },
      ];

      const result = resolveVariablesForContext(variables, {
        tabId: "tab1",
        panelId: "panel1",
      });

      expect(result).toEqual({
        namespace: "production",
        region: "us-east",
        metric: "cpu",
      });
    });

    it("should handle empty variables array", () => {
      const result = resolveVariablesForContext([], {});

      expect(result).toEqual({});
    });

    it("should skip null and undefined values", () => {
      const variables = [
        { name: "var1", scope: "global" as const, value: null },
        {
          name: "var2",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: undefined }],
        },
      ];

      const result = resolveVariablesForContext(variables, { tabId: "tab1" });

      expect(result).toEqual({
        var1: null,
        var2: null,
      });
    });

    it("should handle context without tabId or panelId", () => {
      const variables = [
        { name: "namespace", scope: "global" as const, value: "production" },
        {
          name: "region",
          scope: "tabs" as const,
          value: [{ tabId: "tab1", value: "us-east" }],
        },
      ];

      const result = resolveVariablesForContext(variables, {});

      expect(result).toEqual({
        namespace: "production",
        region: null,
      });
    });
  });
});
