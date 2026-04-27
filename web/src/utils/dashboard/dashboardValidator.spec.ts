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
} from "@/utils/dashboard/dashboardValidator";

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  CURRENT_DASHBOARD_SCHEMA_VERSION: 8,
}));

vi.mock("@schemas/functions/functionValidation.json", () => ({
  default: [],
}));

describe("panelValidation", () => {
  describe("findFirstValidMappedValue", () => {
    describe("value type mappings", () => {
      it("matches exact value and returns mapping", () => {
        const mappings = [
          { type: "value", value: "critical", color: "#FF0000" },
        ];
        const result = findFirstValidMappedValue("critical", mappings, "color");
        expect(result).toBeDefined();
        expect(result?.color).toBe("#FF0000");
      });

      it("does not match different value", () => {
        const mappings = [
          { type: "value", value: "critical", color: "#FF0000" },
        ];
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
        const mappings = [
          { type: "range", from: "0", to: "100", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue(50, mappings, "color");
        expect(result).toBeDefined();
      });

      it("matches boundary value (from)", () => {
        const mappings = [
          { type: "range", from: "0", to: "100", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue(0, mappings, "color");
        expect(result).toBeDefined();
      });

      it("matches boundary value (to)", () => {
        const mappings = [
          { type: "range", from: "0", to: "100", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue(100, mappings, "color");
        expect(result).toBeDefined();
      });

      it("does not match value outside range", () => {
        const mappings = [
          { type: "range", from: "0", to: "100", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue(150, mappings, "color");
        expect(result).toBeUndefined();
      });

      it("does not match when from/to are NaN", () => {
        const mappings = [
          { type: "range", from: "abc", to: "xyz", color: "#00FF00" },
        ];
        const result = findFirstValidMappedValue(50, mappings, "color");
        expect(result).toBeUndefined();
      });
    });

    describe("regex type mappings", () => {
      it("matches value against regex pattern", () => {
        const mappings = [
          { type: "regex", pattern: "^error.*", text: "Error!" },
        ];
        const result = findFirstValidMappedValue("error_500", mappings, "text");
        expect(result).toBeDefined();
      });

      it("does not match value that doesn't fit pattern", () => {
        const mappings = [
          { type: "regex", pattern: "^error.*", text: "Error!" },
        ];
        const result = findFirstValidMappedValue(
          "warning_404",
          mappings,
          "text",
        );
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
        const result = findFirstValidMappedValue(
          "critical",
          null as any,
          "color",
        );
        expect(result).toBeUndefined();
      });

      it("returns undefined for undefined mappings", () => {
        const result = findFirstValidMappedValue(
          "critical",
          undefined as any,
          "color",
        );
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
      version: 8,
      tabs: [
        {
          tabId: "tab-001",
          name: "Tab 1",
          panels: [
            {
              id: "panel-001",
              type: "bar",
              title: "Test Panel",
              layout: { i: 1, x: 0, y: 0, w: 12, h: 6 },
              queries: [],
              config: {},
            },
          ],
        },
      ],
    };

    it("returns no errors for valid dashboard", () => {
      const errors = validateDashboardJson(validDashboard);
      expect(errors).toEqual([]);
    });

    it("returns errors for null dashboard", () => {
      const errors = validateDashboardJson(null);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns errors for undefined dashboard", () => {
      const errors = validateDashboardJson(undefined);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns error for missing title", () => {
      const errors = validateDashboardJson({
        ...validDashboard,
        title: undefined,
      });
      expect(errors.some((e) => e.toLowerCase().includes("title"))).toBe(true);
    });

    it("returns error for missing version", () => {
      const errors = validateDashboardJson({
        ...validDashboard,
        version: undefined,
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns error for wrong version", () => {
      const errors = validateDashboardJson({ ...validDashboard, version: 7 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns error for missing tabs", () => {
      const errors = validateDashboardJson({
        ...validDashboard,
        tabs: undefined,
      });
      expect(errors.some((e) => e.toLowerCase().includes("tab"))).toBe(true);
    });

    it("returns error for empty tabs array", () => {
      const errors = validateDashboardJson({ ...validDashboard, tabs: [] });
      expect(errors.some((e) => e.toLowerCase().includes("tab"))).toBe(true);
    });

    it("returns error for tab missing tabId", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ name: "Tab 1", panels: [] }],
      };
      const errors = validateDashboardJson(dashboard);
      expect(
        errors.some(
          (e) =>
            e.toLowerCase().includes("tabid") ||
            e.toLowerCase().includes("tab"),
        ),
      ).toBe(true);
    });

    it("returns error for tab missing name", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", panels: [] }],
      };
      const errors = validateDashboardJson(dashboard);
      expect(errors.some((e) => e.toLowerCase().includes("name"))).toBe(true);
    });

    it("returns error for duplicate tab IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          { tabId: "tab-001", name: "Tab 1", panels: [] },
          { tabId: "tab-001", name: "Tab 2", panels: [] },
        ],
      };
      const errors = validateDashboardJson(dashboard);
      expect(errors.some((e) => e.includes("Duplicate tab ID"))).toBe(true);
    });

    it("returns error for panel missing required fields", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [{ layout: { i: 1, x: 0, y: 0, w: 1, h: 1 } }],
          },
        ],
      };
      const errors = validateDashboardJson(dashboard);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns error for duplicate panel IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [
              {
                id: "panel-001",
                type: "bar",
                title: "P1",
                layout: { i: 1, x: 0, y: 0, w: 1, h: 1 },
                queries: [],
                config: {},
              },
              {
                id: "panel-001",
                type: "bar",
                title: "P2",
                layout: { i: 2, x: 0, y: 0, w: 1, h: 1 },
                queries: [],
                config: {},
              },
            ],
          },
        ],
      };
      const errors = validateDashboardJson(dashboard);
      expect(errors.some((e) => e.includes("Duplicate panel ID"))).toBe(true);
    });

    it("can return multiple errors", () => {
      const errors = validateDashboardJson({
        version: 8,
        tabs: [{ tabId: "t1", name: "T", panels: [] }],
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("returns error when tab panels is not an array", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", name: "Tab 1", panels: "not-array" }],
      };
      const errors = validateDashboardJson(dashboard);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
