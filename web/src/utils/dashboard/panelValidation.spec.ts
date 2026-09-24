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
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi } from "vitest";
import {
  findFirstValidMappedValue,
  validateDashboardJson,
  validateSQLPanelFields,
} from "@/utils/dashboard/panelValidation";
import { gt } from "@/types/i18n";

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  CURRENT_DASHBOARD_SCHEMA_VERSION: "v3",
}));

vi.mock("@/components/dashboards/addPanel/dynamicFunction/functionValidation.json", () => ({
  default: [],
}));

describe("panelValidation", () => {
  describe("findFirstValidMappedValue", () => {
    describe("value type mappings", () => {
      it("matches exact value and returns mapping", () => {
        const mappings = [{ type: "value", value: "critical", color: "#FF0000" }];
        const result = findFirstValidMappedValue("critical", mappings, "color");
        expect(result).toBeDefined();
        expect(result?.color).toBe("#FF0000");
      });

      it("does not match different value", () => {
        const mappings = [{ type: "value", value: "critical", color: "#FF0000" }];
        const result = findFirstValidMappedValue("warning", mappings, "color");
        expect(result).toBeUndefined();
      });

      it("returns undefined when fieldToCheck is missing from mapping", () => {
        const mappings = [{ type: "value", value: "critical" }]; // no color
        const result = findFirstValidMappedValue("critical", mappings, "color");
        expect(result).toBeUndefined();
      });
    });

    describe("range type mappings", () => {
      it("matches value within range", () => {
        const mappings = [{ type: "range", from: "0", to: "100", color: "#00FF00" }];
        const result = findFirstValidMappedValue(50, mappings, "color");
        expect(result).toBeDefined();
      });

      it("matches boundary value (from)", () => {
        const mappings = [{ type: "range", from: "0", to: "100", color: "#00FF00" }];
        const result = findFirstValidMappedValue(0, mappings, "color");
        expect(result).toBeDefined();
      });

      it("matches boundary value (to)", () => {
        const mappings = [{ type: "range", from: "0", to: "100", color: "#00FF00" }];
        const result = findFirstValidMappedValue(100, mappings, "color");
        expect(result).toBeDefined();
      });

      it("does not match value outside range", () => {
        const mappings = [{ type: "range", from: "0", to: "100", color: "#00FF00" }];
        const result = findFirstValidMappedValue(150, mappings, "color");
        expect(result).toBeUndefined();
      });

      it("does not match when from/to are NaN", () => {
        const mappings = [{ type: "range", from: "abc", to: "xyz", color: "#00FF00" }];
        const result = findFirstValidMappedValue(50, mappings, "color");
        expect(result).toBeUndefined();
      });
    });

    describe("regex type mappings", () => {
      it("matches value against regex pattern", () => {
        const mappings = [{ type: "regex", pattern: "^error.*", text: "Error!" }];
        const result = findFirstValidMappedValue("error_500", mappings, "text");
        expect(result).toBeDefined();
      });

      it("does not match value that doesn't fit pattern", () => {
        const mappings = [{ type: "regex", pattern: "^error.*", text: "Error!" }];
        const result = findFirstValidMappedValue("warning_404", mappings, "text");
        expect(result).toBeUndefined();
      });

      it("uses empty pattern when pattern is null (matches everything)", () => {
        const mappings = [{ type: "regex", pattern: null, text: "Default" }];
        const result = findFirstValidMappedValue("anything", mappings, "text");
        expect(result).toBeDefined();
      });
    });

    describe("first match wins", () => {
      it("returns first matching mapping", () => {
        const mappings = [
          { type: "value", value: "critical", color: "#FF0000" },
          { type: "value", value: "critical", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue("critical", mappings, "color");
        expect(result?.color).toBe("#FF0000");
      });
    });

    describe("null/undefined input", () => {
      it("returns undefined for null mappings", () => {
        const result = findFirstValidMappedValue("critical", null as any, "color");
        expect(result).toBeUndefined();
      });

      it("returns undefined for undefined mappings", () => {
        const result = findFirstValidMappedValue("critical", undefined as any, "color");
        expect(result).toBeUndefined();
      });

      it("returns undefined for empty mappings", () => {
        const result = findFirstValidMappedValue("critical", [], "color");
        expect(result).toBeUndefined();
      });
    });
  });

  describe("validateDashboardJson", () => {
    const validDashboard = {
      dashboardId: "dash-001",
      title: "Test Dashboard",
      version: "v3",
      tabs: [
        {
          tabId: "tab-001",
          name: "Tab 1",
          panels: [
            {
              id: "panel-001",
              type: "bar",
              title: "Test Panel",
              layout: { i: "panel-001", x: 0, y: 0, w: 12, h: 6 },
            },
          ],
        },
      ],
    };

    it("returns no errors for valid dashboard", () => {
      const errors = validateDashboardJson(gt, validDashboard);
      expect(errors).toEqual([]);
    });

    it("accepts a numeric layout.i of 0", () => {
      const tabs = [
        {
          ...validDashboard.tabs[0],
          panels: [
            { ...validDashboard.tabs[0].panels[0], layout: { i: 0, x: 0, y: 0, w: 12, h: 6 } },
          ],
        },
      ];
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs });
      expect(errors).toEqual([]);
    });

    it("returns error for null dashboard", () => {
      const errors = validateDashboardJson(gt, null);
      expect(errors).toContain("Dashboard JSON is empty or invalid");
    });

    it("returns error for undefined dashboard", () => {
      const errors = validateDashboardJson(gt, undefined);
      expect(errors).toContain("Dashboard JSON is empty or invalid");
    });

    it("returns error for missing dashboardId", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, dashboardId: undefined });
      expect(errors).toContain("Dashboard ID is required");
    });

    it("returns error for missing title", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, title: undefined });
      expect(errors).toContain("Dashboard title is required");
    });

    it("returns error for missing version", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, version: undefined });
      expect(errors).toContain("Dashboard version is required");
    });

    it("returns error for wrong version", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, version: "v1" });
      expect(errors.some((e) => e.includes("v3"))).toBe(true);
    });

    it("returns error for missing tabs", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs: undefined });
      expect(errors).toContain("Dashboard must have at least one tab");
    });

    it("returns error for empty tabs array", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs: [] });
      expect(errors).toContain("Dashboard must have at least one tab");
    });

    it("returns error for tab missing tabId", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ name: "Tab 1", panels: [] }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors).toContain("Each tab must have a tabId");
    });

    it("returns error for tab missing name", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", panels: [] }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("must have a name"))).toBe(true);
    });

    it("returns error for duplicate tab IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          { tabId: "tab-001", name: "Tab 1", panels: [] },
          { tabId: "tab-001", name: "Tab 2", panels: [] },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("Duplicate tab ID"))).toBe(true);
    });

    it("returns error for panel missing ID", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [{ layout: { i: "panel-001" } }], // no id
          },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("missing an ID"))).toBe(true);
    });

    it("returns error for duplicate panel IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [
              { id: "panel-001", layout: { i: "panel-001" } },
              { id: "panel-001", layout: { i: "panel-001" } },
            ],
          },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("Duplicate panel ID"))).toBe(true);
    });

    it("can return multiple errors", () => {
      const errors = validateDashboardJson(gt, {
        version: "v3",
        tabs: [{ tabId: "t1", name: "T", panels: [] }],
        // no dashboardId, no title
      });
      expect(errors.length).toBeGreaterThan(1);
    });

    it("returns error when tab panels is not an array", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", name: "Tab 1", panels: null }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("must have a panels array"))).toBe(true);
    });
  });

  /**
   * openobserve#2188 — a gauge panel whose fields are wrong shows a validation
   * message instead of a chart. `panelValidation.ts` has a `case "gauge"` branch
   * for exactly that, and before this block the whole suite had NO gauge case:
   * deleting either rule left every test green. The rules are asymmetric and easy
   * to get backwards — a gauge needs EXACTLY one value field, but zero OR one
   * label field — so each edge is pinned here rather than just the happy path.
   */
  describe("validateSQLPanelFields — gauge field rules", () => {
    const panel = (fields: any) => ({
      type: "gauge",
      queryType: "sql",
      queries: [{ customQuery: false, fields }],
    });
    const errorsFor = (fields: any, pageKey?: string) => {
      const errors: string[] = [];
      validateSQLPanelFields(gt, panel(fields), 0, "X", "Y", errors, true, pageKey);
      return errors;
    };
    // `type: "raw"` short-circuits the per-field aggregation-function check, which
    // this file mocks `functionValidation.json` to an empty list for — without it every
    // field would fail that check and drown out the gauge rules under test.
    const field = (alias: string) => ({
      alias,
      column: alias,
      label: alias,
      type: "raw",
      rawQuery: `count(${alias})`,
    });

    it("accepts exactly one value field and one label field", () => {
      expect(errorsFor({ x: [field("service")], y: [field("count")] })).toEqual([]);
    });

    it("accepts exactly one value field and no label field", () => {
      expect(errorsFor({ x: [], y: [field("count")] })).toEqual([]);
    });

    it("rejects a gauge with no value field", () => {
      const errors = errorsFor({ x: [field("service")], y: [] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/value field/i);
    });

    it("rejects a gauge with more than one value field", () => {
      const errors = errorsFor({ x: [field("service")], y: [field("count"), field("total")] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/value field/i);
    });

    it("rejects a gauge with more than one label field", () => {
      const errors = errorsFor({ x: [field("service"), field("pod")], y: [field("count")] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/label field/i);
    });

    it("reports both rules when the value and label counts are each wrong", () => {
      const errors = errorsFor({ x: [field("service"), field("pod")], y: [] });
      expect(errors).toHaveLength(2);
    });

    it("uses the logs-page wording when validating from the logs page", () => {
      const errors = errorsFor({ x: [field("service")], y: [] }, "logs");
      expect(errors).toHaveLength(1);
      // The logs page has no X/Y axis vocabulary, so it must not borrow the
      // dashboard wording that names those axes.
      expect(errors[0]).not.toMatch(/gauge chart/i);
    });

    it("skips field validation for a custom query, which the user writes by hand", () => {
      const errors: string[] = [];
      validateSQLPanelFields(
        gt,
        { type: "gauge", queryType: "sql", queries: [{ customQuery: true, fields: { x: [], y: [] } }] },
        0,
        "X",
        "Y",
        errors,
      );
      expect(errors).toEqual([]);
    });
  });

});
