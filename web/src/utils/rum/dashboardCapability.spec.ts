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

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
// File: src/utils/rum/dashboardCapability.ts
// Exports: filterDashboardBySchema(dashboard, presentFields), presentFieldsFromSchemaMap
//          (schemaMap), CAPABILITY_GATED_FIELDS (const array)
// Pure functions — no mocking required.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  filterDashboardBySchema,
  presentFieldsFromSchemaMap,
  CAPABILITY_GATED_FIELDS,
  type DashboardPanel,
  type RumDashboard,
} from "./dashboardCapability";

/** Build a single panel fixture with a given layout and SQL. */
function makePanel(
  i: number | string,
  x: number,
  y: number,
  w: number,
  h: number,
  sql?: string,
): DashboardPanel {
  return {
    layout: { x, y, w, h, i },
    queries: sql !== undefined ? [{ query: sql }] : [],
  };
}

/** Build a dashboard fixture from a list of panels. */
function makeDashboard(panels: DashboardPanel[]): RumDashboard {
  return { panels };
}

describe("dashboardCapability", () => {
  describe("filterDashboardBySchema — no-op paths", () => {
    it("returns the SAME dashboard reference when presentFields is null", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
      ]);

      // Act
      const result = filterDashboardBySchema(dashboard, null);

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(1);
    });

    it("returns the SAME dashboard reference when presentFields is undefined", () => {
      // Arrange
      const dashboard = makeDashboard([makePanel(1, 0, 0, 6, 4, "SELECT session_id FROM _rumdata")]);

      // Act
      const result = filterDashboardBySchema(dashboard, undefined);

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.droppedCount).toBe(0);
    });

    it("returns the SAME dashboard reference when presentFields is an empty Set", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
      ]);

      // Act
      const result = filterDashboardBySchema(dashboard, new Set());

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(1);
    });

    it("returns the SAME dashboard reference when nothing is dropped (all gated fields present)", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id, error_id FROM _rumdata"),
      ]);
      const presentFields = new Set(["view_largest_contentful_paint", "session_id", "error_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(2);
    });
  });

  describe("filterDashboardBySchema — dropping panels", () => {
    it("drops a panel referencing an absent gated field and keeps a panel using only session_id/error_id", () => {
      // Arrange
      const gatedPanel = makePanel(
        1,
        0,
        0,
        6,
        4,
        "SELECT view_largest_contentful_paint FROM _rumdata",
      );
      const commonPanel = makePanel(2, 6, 0, 6, 4, "SELECT session_id, error_id FROM _rumdata");
      const dashboard = makeDashboard([gatedPanel, commonPanel]);
      const presentFields = new Set(["session_id", "error_id"]); // no LCP field

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.dashboard.panels).toHaveLength(1);
      expect(result.dashboard.panels?.[0].layout.i).toBe(2);
    });

    it("reports correct droppedCount and keptCount", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id FROM _rumdata"),
        makePanel(3, 0, 4, 6, 4, "SELECT view_url FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.droppedCount).toBe(2);
      expect(result.keptCount).toBe(1);
    });

    it("never drops a panel with no queries", () => {
      // Arrange
      const noQueryPanel = makePanel(1, 0, 0, 6, 4, undefined);
      const dashboard = makeDashboard([noQueryPanel]);
      const presentFields = new Set(["session_id"]); // nothing gated present, but no SQL either

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(1);
      expect(result.dashboard).toBe(dashboard);
    });

    it("never drops a panel whose queries array is entirely absent from the panel object", () => {
      // Arrange
      const panelWithoutQueriesKey: DashboardPanel = { layout: { x: 0, y: 0, w: 6, h: 4, i: 1 } };
      const dashboard = makeDashboard([panelWithoutQueriesKey]);
      const presentFields = new Set(["session_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(1);
    });

    it("drops a panel referencing SPLIT_PART(view_url,...) when view_url is absent (word-boundary match)", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(
          1,
          0,
          0,
          6,
          4,
          "SELECT SPLIT_PART(view_url, '?', 1) as path FROM _rumdata GROUP BY path",
        ),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]); // view_url absent

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.droppedCount).toBe(1);
      expect(result.dashboard.panels?.[0].layout.i).toBe(2);
    });

    it("does NOT drop a panel referencing a longer field name that merely contains a gated field as a substring", () => {
      // Arrange — "view_url_hash" is a distinct column; \bview_url\b must not match inside it.
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_url_hash FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]); // view_url (and view_url_hash) absent from schema,
      // but view_url_hash is not itself a gated field, so it must never be evaluated as one.

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(1);
    });
  });

  describe("filterDashboardBySchema — reflow", () => {
    it("packs remaining panels left-to-right, top-to-bottom with no horizontal gaps and total width per row <= grid, preserving w/h", () => {
      // Arrange — 4 panels, each half-width (w=6); the second panel (top-right) is dropped.
      // Uses an explicit 12-col grid so the packing/wrapping is readable at small scale.
      const p1 = makePanel(1, 0, 0, 6, 4, "SELECT session_id FROM _rumdata");
      const p2 = makePanel(2, 6, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata");
      const p3 = makePanel(3, 0, 4, 6, 4, "SELECT error_id FROM _rumdata");
      const p4 = makePanel(4, 6, 4, 6, 4, "SELECT service FROM _rumdata");
      const dashboard = makeDashboard([p1, p2, p3, p4]);
      const presentFields = new Set(["session_id", "error_id", "service"]); // LCP absent

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields, 12);

      // Assert
      const panels = result.dashboard.panels ?? [];
      expect(panels).toHaveLength(3);
      expect(panels.map((p) => p.layout.i)).toEqual([1, 3, 4]);

      expect(panels[0].layout).toEqual({ x: 0, y: 0, w: 6, h: 4, i: 1 });
      expect(panels[1].layout).toEqual({ x: 6, y: 0, w: 6, h: 4, i: 3 });
      expect(panels[2].layout).toEqual({ x: 0, y: 4, w: 6, h: 4, i: 4 });

      // No row exceeds the 12-col grid.
      const rows = new Map<number, number>();
      panels.forEach((p) => {
        rows.set(p.layout.y, (rows.get(p.layout.y) ?? 0) + p.layout.w);
      });
      rows.forEach((totalWidth) => {
        expect(totalWidth).toBeLessThanOrEqual(12);
      });
    });

    it("packs 192-grid tiles into one full-width row by default (mobile-only Overview regression)", () => {
      // Arrange — the real RUM Overview after schema conversion: four w=48 stat tiles that
      // were spread across columns x=48/96 and rows y=0/6/12, plus three browser-only
      // Web Vitals tiles in column x=0 that get dropped for a mobile-only stream.
      const totalErrors = makePanel(1, 48, 0, 48, 8, "SELECT error_id FROM _rumdata");
      const totalSessions = makePanel(2, 96, 0, 48, 8, "SELECT session_id FROM _rumdata");
      const totalUnhandled = makePanel(3, 48, 6, 48, 8, "SELECT error_handling FROM _rumdata");
      const sessionWithErrors = makePanel(4, 48, 12, 48, 8, "SELECT session_id FROM _rumdata");
      const lcp = makePanel(5, 0, 0, 48, 8, "SELECT view_largest_contentful_paint FROM _rumdata");
      const dashboard = makeDashboard([
        totalErrors,
        totalSessions,
        totalUnhandled,
        sessionWithErrors,
        lcp,
      ]);
      const presentFields = new Set(["error_id", "session_id", "error_handling"]); // LCP absent

      // Act — default grid width (192), i.e. the production path.
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert — the four survivors sit side-by-side in a single row at full width,
      // NOT clamped to w=12 and stacked one per row.
      const panels = result.dashboard.panels ?? [];
      expect(panels).toHaveLength(4);
      panels.forEach((p) => expect(p.layout.w).toBe(48));
      expect(panels.map((p) => p.layout.x)).toEqual([0, 48, 96, 144]);
      expect(panels.every((p) => p.layout.y === 0)).toBe(true);
    });

    it("preserves original width and height of surviving panels exactly", () => {
      // Arrange — panels with distinct, non-uniform sizes.
      const p1 = makePanel(1, 0, 0, 4, 3, "SELECT session_id FROM _rumdata");
      const p2 = makePanel(2, 4, 0, 8, 5, "SELECT view_url FROM _rumdata"); // dropped
      const p3 = makePanel(3, 0, 3, 12, 6, "SELECT error_id FROM _rumdata");
      const dashboard = makeDashboard([p1, p2, p3]);
      const presentFields = new Set(["session_id", "error_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      const panels = result.dashboard.panels ?? [];
      expect(panels.find((p) => p.layout.i === 1)?.layout.w).toBe(4);
      expect(panels.find((p) => p.layout.i === 1)?.layout.h).toBe(3);
      expect(panels.find((p) => p.layout.i === 3)?.layout.w).toBe(12);
      expect(panels.find((p) => p.layout.i === 3)?.layout.h).toBe(6);
    });

    it("returns a new dashboard object (not the original reference) when panels are dropped", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_url FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.dashboard).not.toBe(dashboard);
    });
  });

  describe("filterDashboardBySchema — edge cases", () => {
    it("returns an empty dashboard with zero counts when panels array is empty", () => {
      // Arrange
      const dashboard = makeDashboard([]);

      // Act
      const result = filterDashboardBySchema(dashboard, new Set(["session_id"]));

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(0);
    });

    it("handles a dashboard with no panels property at all", () => {
      // Arrange
      const dashboard: RumDashboard = {};

      // Act
      const result = filterDashboardBySchema(dashboard, new Set(["session_id"]));

      // Assert
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe(0);
    });

    it("drops every panel when every panel references a different absent gated field", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_url FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT resource_duration FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]);

      // Act
      const result = filterDashboardBySchema(dashboard, presentFields);

      // Assert
      expect(result.keptCount).toBe(0);
      expect(result.droppedCount).toBe(2);
      expect(result.dashboard.panels).toEqual([]);
    });
  });

  describe("filterDashboardBySchema — v8 tabs[] shape", () => {
    // convertDashboardSchemaVersion upgrades the RUM dashboards to v8, which nests panels
    // under tabs[].panels rather than a flat top-level panels[]. The gate must read that
    // container; otherwise it sees zero panels, reports keptCount 0, and every tab shows
    // its empty state the moment the schema resolves — for browser AND mobile users.
    function makeTabbedDashboard(panels: DashboardPanel[]): RumDashboard {
      return { tabs: [{ tabId: "t1", name: "Default", panels }] };
    }

    it("keeps all panels when their gated fields are present (no false empty state)", () => {
      const dashboard = makeTabbedDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT COUNT(*) FROM _rumdata WHERE type='error'"),
      ]);
      const presentFields = new Set(["view_largest_contentful_paint", "session_id"]);

      const result = filterDashboardBySchema(dashboard, presentFields);

      expect(result.keptCount).toBe(2);
      expect(result.droppedCount).toBe(0);
      expect(result.dashboard).toBe(dashboard);
    });

    it("counts panels inside tabs on the unknown-schema no-op path", () => {
      const dashboard = makeTabbedDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id FROM _rumdata"),
      ]);

      const result = filterDashboardBySchema(dashboard, null);

      expect(result.dashboard).toBe(dashboard);
      expect(result.keptCount).toBe(2);
    });

    it("drops only the unrenderable panels and keeps the survivors in the tab", () => {
      const dashboard = makeTabbedDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT session_id FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]);

      const result = filterDashboardBySchema(dashboard, presentFields);

      expect(result.keptCount).toBe(1);
      expect(result.droppedCount).toBe(1);
      expect(result.dashboard.tabs?.[0].panels).toHaveLength(1);
    });

    it("reports keptCount 0 only when every panel in the tab is unrenderable", () => {
      const dashboard = makeTabbedDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT view_largest_contentful_paint FROM _rumdata"),
        makePanel(2, 6, 0, 6, 4, "SELECT view_first_byte FROM _rumdata"),
      ]);
      const presentFields = new Set(["session_id"]);

      const result = filterDashboardBySchema(dashboard, presentFields);

      expect(result.keptCount).toBe(0);
      expect(result.droppedCount).toBe(2);
    });
  });

  describe("CAPABILITY_GATED_FIELDS", () => {
    it("is a non-empty array of unique field names", () => {
      // Arrange / Act
      const unique = new Set(CAPABILITY_GATED_FIELDS);

      // Assert
      expect(CAPABILITY_GATED_FIELDS.length).toBeGreaterThan(0);
      expect(unique.size).toBe(CAPABILITY_GATED_FIELDS.length);
    });

    it("includes both browser-only and mobile-only fields", () => {
      expect(CAPABILITY_GATED_FIELDS).toContain("view_largest_contentful_paint");
      expect(CAPABILITY_GATED_FIELDS).toContain("error_is_crash");
    });
  });

  describe("presentFieldsFromSchemaMap", () => {
    it("returns null for a null schema map", () => {
      expect(presentFieldsFromSchemaMap(null)).toBeNull();
    });

    it("returns null for an undefined schema map", () => {
      expect(presentFieldsFromSchemaMap(undefined)).toBeNull();
    });

    it("returns null for an empty schema map", () => {
      expect(presentFieldsFromSchemaMap({})).toBeNull();
    });

    it("returns a Set of the schema map's keys otherwise", () => {
      // Arrange
      const schemaMap = { session_id: { type: "Utf8" }, error_id: { type: "Utf8" } };

      // Act
      const result = presentFieldsFromSchemaMap(schemaMap);

      // Assert
      expect(result).toEqual(new Set(["session_id", "error_id"]));
    });

    it("returns a Set with a single key for a single-field schema map", () => {
      const result = presentFieldsFromSchemaMap({ service: { type: "Utf8" } });

      expect(result).toEqual(new Set(["service"]));
    });
  });
});
