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
// The shipped Overview dashboard, asserted against directly so the persona behaviour is
// pinned to the real panel set rather than a fixture that can drift from it.
import overviewDashboard from "./overview.json";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";

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
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 6, 4, "SELECT session_id FROM _rumdata"),
      ]);

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
      const result = filterDashboardBySchema(dashboard, presentFields, { gridWidth: 12 });

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

  // -------------------------------------------------------------------------
  // Platform gating — panels tagged for a platform with no data in the range.
  // -------------------------------------------------------------------------

  describe("filterDashboardBySchema — platform gating", () => {
    /** A common panel, a mobile-tagged panel and a browser-tagged panel. */
    const makeMixedDashboard = () =>
      makeDashboard([
        { ...makePanel(1, 0, 0, 3, 4, "SELECT session_id FROM _rumdata") },
        {
          ...makePanel(2, 3, 0, 3, 4, "SELECT count(*) FROM _rumdata"),
          o2Platform: "mobile",
        },
        {
          ...makePanel(3, 6, 0, 3, 4, "SELECT count(*) FROM _rumdata"),
          o2Platform: "browser",
        },
      ]);

    const ALL_FIELDS = new Set(["session_id"]);

    it("drops mobile-tagged panels when only browser data is in range", () => {
      // Arrange
      const dashboard = makeMixedDashboard();

      // Act
      const result = filterDashboardBySchema(dashboard, ALL_FIELDS, {
        platforms: { hasBrowser: true, hasMobile: false },
      });

      // Assert
      expect(result.dashboard.panels?.map((p) => p.o2Platform)).toEqual([undefined, "browser"]);
      expect(result.droppedCount).toBe(1);
    });

    it("drops browser-tagged panels when only mobile data is in range", () => {
      // Arrange
      const dashboard = makeMixedDashboard();

      // Act
      const result = filterDashboardBySchema(dashboard, ALL_FIELDS, {
        platforms: { hasBrowser: false, hasMobile: true },
      });

      // Assert
      expect(result.dashboard.panels?.map((p) => p.o2Platform)).toEqual([undefined, "mobile"]);
      expect(result.droppedCount).toBe(1);
    });

    it("keeps every panel when both platforms have data in range", () => {
      // Arrange
      const dashboard = makeMixedDashboard();

      // Act
      const result = filterDashboardBySchema(dashboard, ALL_FIELDS, {
        platforms: { hasBrowser: true, hasMobile: true },
      });

      // Assert — nothing dropped, so the SAME reference comes back
      expect(result.dashboard).toBe(dashboard);
      expect(result.keptCount).toBe(3);
    });

    it("ignores platform tags when platforms is not supplied", () => {
      // Arrange — the Vitals / Errors / API tabs, which never probe for sources
      const dashboard = makeMixedDashboard();

      // Act
      const result = filterDashboardBySchema(dashboard, ALL_FIELDS);

      // Assert
      expect(result.dashboard).toBe(dashboard);
      expect(result.keptCount).toBe(3);
    });

    it("gates on platform even when the schema is unknown", () => {
      // Arrange — detection resolved before the schema fetch did
      const dashboard = makeMixedDashboard();

      // Act
      const result = filterDashboardBySchema(dashboard, null, {
        platforms: { hasBrowser: true, hasMobile: false },
      });

      // Assert
      expect(result.dashboard.panels).toHaveLength(2);
      expect(result.droppedCount).toBe(1);
    });

    it("keeps untagged panels for every platform combination", () => {
      // Arrange
      const dashboard = makeDashboard([
        makePanel(1, 0, 0, 3, 4, "SELECT session_id FROM _rumdata"),
      ]);

      // Act
      const noData = filterDashboardBySchema(dashboard, ALL_FIELDS, {
        platforms: { hasBrowser: false, hasMobile: false },
      });

      // Assert
      expect(noData.keptCount).toBe(1);
      expect(noData.droppedCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Section headers — panels with no SQL that must vanish with their section.
  // -------------------------------------------------------------------------

  describe("filterDashboardBySchema — o2RequiresAnyField", () => {
    const makeHeader = () => ({
      ...makePanel("header", 0, 0, 12, 2),
      type: "html",
      title: "App stability",
      o2Platform: "mobile",
      o2RequiresAnyField: ["error_is_crash", "error_category"],
    });

    it("keeps the header when at least one required column is present", () => {
      // Arrange
      const dashboard = makeDashboard([makeHeader()]);

      // Act
      const result = filterDashboardBySchema(dashboard, new Set(["error_category"]), {
        platforms: { hasBrowser: false, hasMobile: true },
      });

      // Assert
      expect(result.keptCount).toBe(1);
      expect(result.droppedCount).toBe(0);
    });

    it("drops the header when none of the required columns are present", () => {
      // Arrange — a mobile app that has never crashed: no crash columns in the schema
      const dashboard = makeDashboard([makeHeader()]);

      // Act
      const result = filterDashboardBySchema(dashboard, new Set(["session_id"]), {
        platforms: { hasBrowser: false, hasMobile: true },
      });

      // Assert
      expect(result.keptCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });

    it("ignores the requirement when the schema is unknown", () => {
      // Arrange
      const dashboard = makeDashboard([makeHeader()]);

      // Act
      const result = filterDashboardBySchema(dashboard, null, {
        platforms: { hasBrowser: false, hasMobile: true },
      });

      // Assert
      expect(result.keptCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // The shipped Overview dashboard, exercised through the three ingestion personas.
  // -------------------------------------------------------------------------

  describe("overview.json — persona adaptation", () => {
    const BROWSER_FIELDS = [
      "view_largest_contentful_paint",
      "view_interaction_to_next_paint",
      "view_cumulative_layout_shift",
    ];
    const MOBILE_FIELDS = [
      "error_is_crash",
      "error_category",
      "vital_app_launch_metric",
      "vital_startup_type",
      "vital_duration",
      "view_slow_frames_rate",
      "view_freeze_rate",
      "view_frozen_frame_count",
      "view_refresh_rate_average",
    ];
    const COMMON_FIELDS = ["session_id", "error_id", "error_handling", "type", "source"];

    const titlesOf = (dashboard: RumDashboard) =>
      (dashboard.panels ?? []).map((p) => p.title as string);

    const filterOverview = (fields: string[], hasBrowser: boolean, hasMobile: boolean) =>
      filterDashboardBySchema(overviewDashboard as RumDashboard, new Set(fields), {
        gridWidth: 12,
        platforms: { hasBrowser, hasMobile },
      });

    it("shows the browser section and no mobile sections for a browser-only stream", () => {
      // Act
      const titles = titlesOf(
        filterOverview([...COMMON_FIELDS, ...BROWSER_FIELDS], true, false).dashboard,
      );

      // Assert
      expect(titles).toContain("Health at a glance");
      expect(titles).toContain("Web Vitals");
      expect(titles).toContain("Largest Contentful Paint ( LCP )");
      expect(titles).not.toContain("App stability");
      expect(titles).not.toContain("Rendering & responsiveness");
      expect(titles).not.toContain("Crash-free Sessions");
    });

    it("shows the mobile sections and no Web Vitals for a mobile-only stream", () => {
      // Act
      const titles = titlesOf(
        filterOverview([...COMMON_FIELDS, ...MOBILE_FIELDS], false, true).dashboard,
      );

      // Assert
      expect(titles).toContain("App stability");
      expect(titles).toContain("Crash-free Sessions");
      expect(titles).toContain("Cold Start ( p95 )");
      expect(titles).toContain("Rendering & responsiveness");
      expect(titles).not.toContain("Web Vitals");
      expect(titles).not.toContain("Largest Contentful Paint ( LCP )");
    });

    it("keeps the cross-platform tiles for every persona", () => {
      // Arrange
      const leadershipTiles = [
        "Total Sessions",
        "Total Errors",
        "Session with Errors",
        "Total Unhandled Errors",
      ];

      // Act
      const browserOnly = titlesOf(
        filterOverview([...COMMON_FIELDS, ...BROWSER_FIELDS], true, false).dashboard,
      );
      const mobileOnly = titlesOf(
        filterOverview([...COMMON_FIELDS, ...MOBILE_FIELDS], false, true).dashboard,
      );

      // Assert
      leadershipTiles.forEach((title) => {
        expect(browserOnly).toContain(title);
        expect(mobileOnly).toContain(title);
      });
    });

    it("keeps every panel for a mixed stream", () => {
      // Act
      const result = filterOverview(
        [...COMMON_FIELDS, ...BROWSER_FIELDS, ...MOBILE_FIELDS],
        true,
        true,
      );

      // Assert
      expect(result.droppedCount).toBe(0);
      expect(result.keptCount).toBe((overviewDashboard as RumDashboard).panels?.length);
    });

    it("drops the mobile sections when mobile columns exist but no mobile data is in range", () => {
      // Arrange — an org that trialled mobile months ago: columns linger in the schema
      // forever, so field gating alone would leave the mobile sections empty on screen.

      // Act
      const titles = titlesOf(
        filterOverview([...COMMON_FIELDS, ...BROWSER_FIELDS, ...MOBILE_FIELDS], true, false)
          .dashboard,
      );

      // Assert
      expect(titles).not.toContain("App stability");
      expect(titles).not.toContain("Crash-free Sessions");
      expect(titles).toContain("Web Vitals");
    });

    it("adapts the same way after the real v2 → v8 schema migration", () => {
      // Arrange — the production path is convert-then-filter, on the 192-column grid the
      // dashboard actually renders on. The converter mutates its input, so clone first.
      const converted = convertDashboardSchemaVersion(
        JSON.parse(JSON.stringify(overviewDashboard)),
      ) as RumDashboard;

      // Act
      const result = filterDashboardBySchema(
        converted,
        new Set([...COMMON_FIELDS, ...MOBILE_FIELDS]),
        {
          platforms: { hasBrowser: false, hasMobile: true },
        },
      );
      const panels = result.dashboard.tabs?.[0]?.panels ?? [];
      const titles = panels.map((p) => p.title as string);

      // Assert — panels live under tabs[] now, and the browser section is gone
      expect(panels.length).toBeGreaterThan(0);
      expect(titles).toContain("App stability");
      expect(titles).not.toContain("Web Vitals");
      // Repacked on the 192-col grid, not clamped to some smaller width
      const sectionHeader = panels.find((p) => p.title === "App stability");
      expect(sectionHeader?.layout.w).toBe(192);
      expect(panels.every((p) => p.layout.x + p.layout.w <= 192)).toBe(true);
    });

    it("packs survivors into full rows with no gaps for a mobile-only stream", () => {
      // Act
      const panels =
        filterOverview([...COMMON_FIELDS, ...MOBILE_FIELDS], false, true).dashboard.panels ?? [];

      // Assert — every row starts at x=0 and no row exceeds the grid
      const rows = new Map<number, number>();
      panels.forEach((p) => {
        rows.set(p.layout.y, (rows.get(p.layout.y) ?? 0) + p.layout.w);
      });
      rows.forEach((width) => expect(width).toBeLessThanOrEqual(12));
      expect(Math.min(...panels.map((p) => p.layout.x))).toBe(0);
    });
  });
});
