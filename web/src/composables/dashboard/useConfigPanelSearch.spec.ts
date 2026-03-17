// Copyright 2023 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach } from "vitest";
import { nextTick } from "vue";
import { useConfigPanelSearch } from "./useConfigPanelSearch";
import type { ConfigOptions } from "./useConfigPanelSearch";
import { DEFAULT_EXPANDED_SECTIONS } from "../../utils/dashboard/searchLabelsConfig";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeOptions = (overrides: Partial<ConfigOptions> = {}): ConfigOptions => ({
  general: {
    description: { label: "Description" },
    step: { label: "Step Value", visible: true },
    hidden: { label: "Hidden Option", visible: false },
  },
  legend: {
    "show-legends": { label: "Show Legends", visible: true },
    "legend-position": { label: "Legend Position", visible: true },
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConfigPanelSearch", () => {
  let composable: ReturnType<typeof useConfigPanelSearch>;

  beforeEach(() => {
    composable = useConfigPanelSearch();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("initial state", () => {
    it("searchQuery starts as empty string", () => {
      expect(composable.searchQuery.value).toBe("");
    });

    it("expandedSections starts as a copy of DEFAULT_EXPANDED_SECTIONS", () => {
      expect(composable.expandedSections.value).toEqual(DEFAULT_EXPANDED_SECTIONS);
    });

    it("normalizedSearchQuery is empty string when searchQuery is empty", () => {
      expect(composable.normalizedSearchQuery.value).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // normalizedSearchQuery
  // -------------------------------------------------------------------------

  describe("normalizedSearchQuery", () => {
    it("trims whitespace and lowercases the query", async () => {
      composable.searchQuery.value = "  Legend  ";
      await nextTick();
      expect(composable.normalizedSearchQuery.value).toBe("legend");
    });

    it("handles null-like value via nullish coalescing", async () => {
      // Force value through the ref; computed should still return ""
      (composable.searchQuery as any).value = null;
      await nextTick();
      expect(composable.normalizedSearchQuery.value).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // matchesSearch
  // -------------------------------------------------------------------------

  describe("matchesSearch", () => {
    it("returns true for exact match", () => {
      expect(composable.matchesSearch("Legend", "Legend")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(composable.matchesSearch("Show Legends", "legend")).toBe(true);
      expect(composable.matchesSearch("legend", "LEGEND")).toBe(true);
    });

    it("returns true for partial match", () => {
      expect(composable.matchesSearch("Legend Position", "pos")).toBe(true);
    });

    it("returns false when label does not contain query", () => {
      expect(composable.matchesSearch("Legend", "axis")).toBe(false);
    });

    it("returns true for empty query (substring of everything)", () => {
      expect(composable.matchesSearch("Anything", "")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isConfigOptionVisible
  // -------------------------------------------------------------------------

  describe("isConfigOptionVisible", () => {
    it("returns false when option does not exist", () => {
      const opts = makeOptions();
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "nonexistent"),
      ).toBe(false);
    });

    it("returns false when option.visible is explicitly false", () => {
      const opts = makeOptions();
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "hidden"),
      ).toBe(false);
    });

    it("returns true when visible is true and no search query", () => {
      const opts = makeOptions();
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "step"),
      ).toBe(true);
    });

    it("returns true when visible is undefined (not set) and no search query", () => {
      const opts = makeOptions();
      // "description" has no visible field
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "description"),
      ).toBe(true);
    });

    it("returns true when label matches active search query", async () => {
      composable.searchQuery.value = "step";
      await nextTick();
      const opts = makeOptions();
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "step"),
      ).toBe(true);
    });

    it("returns false when label does not match active search query", async () => {
      composable.searchQuery.value = "axis";
      await nextTick();
      const opts = makeOptions();
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "step"),
      ).toBe(false);
    });

    it("supports array labels — returns true when any label matches", async () => {
      composable.searchQuery.value = "width";
      await nextTick();
      const opts: ConfigOptions = {
        legend: {
          "legend-size": {
            label: ["Legend Width", "Legend Height"],
            visible: true,
          },
        },
      };
      expect(
        composable.isConfigOptionVisible(opts, "legend" as any, "legend-size"),
      ).toBe(true);
    });

    it("returns false when option visible=false even if label matches query", async () => {
      composable.searchQuery.value = "hidden";
      await nextTick();
      const opts = makeOptions();
      // "hidden" has visible: false
      expect(
        composable.isConfigOptionVisible(opts, "general" as any, "hidden"),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isSectionVisible
  // -------------------------------------------------------------------------

  describe("isSectionVisible", () => {
    it("returns false when sectionId does not exist in configOptions", () => {
      const opts = makeOptions();
      expect(composable.isSectionVisible(opts, "axis" as any)).toBe(false);
    });

    it("returns true when at least one option in the section is visible", () => {
      const opts = makeOptions();
      expect(composable.isSectionVisible(opts, "general" as any)).toBe(true);
    });

    it("returns false when all options in section have visible=false", () => {
      const opts: ConfigOptions = {
        general: {
          a: { label: "A", visible: false },
          b: { label: "B", visible: false },
        },
      };
      expect(composable.isSectionVisible(opts, "general" as any)).toBe(false);
    });

    it("returns false when search query matches nothing in the section", async () => {
      composable.searchQuery.value = "zzznomatch";
      await nextTick();
      const opts = makeOptions();
      expect(composable.isSectionVisible(opts, "general" as any)).toBe(false);
    });

    it("returns true when search query matches at least one option label", async () => {
      composable.searchQuery.value = "legend pos";
      await nextTick();
      const opts = makeOptions();
      expect(composable.isSectionVisible(opts, "legend" as any)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // isExpanded
  // -------------------------------------------------------------------------

  describe("isExpanded", () => {
    it("returns true for sections in DEFAULT_EXPANDED_SECTIONS (all default true)", () => {
      expect(composable.isExpanded("general")).toBe(true);
    });

    it("returns true for unknown keys (default fallback)", () => {
      expect(composable.isExpanded("unknownSection")).toBe(true);
    });

    it("returns false after a section has been collapsed", () => {
      composable.expandedSections.value["general"] = false;
      expect(composable.isExpanded("general")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // toggleSection
  // -------------------------------------------------------------------------

  describe("toggleSection", () => {
    it("collapses an expanded section", () => {
      composable.toggleSection("general" as any);
      expect(composable.expandedSections.value["general"]).toBe(false);
    });

    it("expands a collapsed section", () => {
      composable.expandedSections.value["general"] = false;
      composable.toggleSection("general" as any);
      expect(composable.expandedSections.value["general"]).toBe(true);
    });

    it("only changes the targeted section", () => {
      composable.toggleSection("general" as any);
      expect(composable.expandedSections.value["legend"]).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // saveExpansionState / restoreExpansionState
  // -------------------------------------------------------------------------

  describe("saveExpansionState", () => {
    it("expands all sections", () => {
      composable.expandedSections.value["general"] = false;
      composable.expandedSections.value["legend"] = false;
      composable.saveExpansionState();
      expect(composable.expandedSections.value["general"]).toBe(true);
      expect(composable.expandedSections.value["legend"]).toBe(true);
    });

    it("captures the pre-save state so it can be restored", () => {
      composable.expandedSections.value["general"] = false;
      composable.saveExpansionState();
      composable.restoreExpansionState();
      expect(composable.expandedSections.value["general"]).toBe(false);
    });
  });

  describe("restoreExpansionState", () => {
    it("restores state that was saved", () => {
      composable.expandedSections.value["legend"] = false;
      composable.saveExpansionState();
      // Now legend is expanded (saveExpansionState expanded everything)
      expect(composable.expandedSections.value["legend"]).toBe(true);
      composable.restoreExpansionState();
      expect(composable.expandedSections.value["legend"]).toBe(false);
    });

    it("clears the saved snapshot after restore", () => {
      composable.saveExpansionState();
      composable.restoreExpansionState();
      // Calling restore again should be a no-op (snapshot is null)
      composable.expandedSections.value["general"] = false;
      composable.restoreExpansionState();
      expect(composable.expandedSections.value["general"]).toBe(false);
    });

    it("is a no-op when no state has been saved", () => {
      composable.expandedSections.value["general"] = false;
      composable.restoreExpansionState();
      // Should remain false — no snapshot to restore from
      expect(composable.expandedSections.value["general"]).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // resetSearch
  // -------------------------------------------------------------------------

  describe("resetSearch", () => {
    it("clears the search query", async () => {
      composable.searchQuery.value = "some query";
      await nextTick();
      composable.resetSearch();
      expect(composable.searchQuery.value).toBe("");
    });

    it("restores the expansion state if it was saved", async () => {
      composable.expandedSections.value["general"] = false;
      composable.saveExpansionState();
      composable.resetSearch();
      expect(composable.expandedSections.value["general"]).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // watch — auto save/restore on query change
  // -------------------------------------------------------------------------

  describe("watch(searchQuery)", () => {
    it("auto-saves expansion state when query goes from empty to non-empty", async () => {
      composable.expandedSections.value["general"] = false;
      composable.searchQuery.value = "legend";
      await nextTick();
      // All sections should now be expanded
      expect(composable.expandedSections.value["general"]).toBe(true);
    });

    it("auto-restores expansion state when query is cleared", async () => {
      composable.expandedSections.value["general"] = false;
      composable.searchQuery.value = "legend";
      await nextTick();
      composable.searchQuery.value = "";
      await nextTick();
      expect(composable.expandedSections.value["general"]).toBe(false);
    });

    it("does not re-save state on subsequent query changes", async () => {
      composable.expandedSections.value["general"] = false;
      composable.searchQuery.value = "leg";
      await nextTick();
      // Change query again (non-empty → non-empty) — no additional save
      composable.expandedSections.value["legend"] = false;
      composable.searchQuery.value = "legend";
      await nextTick();
      composable.searchQuery.value = "";
      await nextTick();
      // Should restore the state from first save, where general=false
      expect(composable.expandedSections.value["general"]).toBe(false);
    });
  });
});
