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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, computed, nextTick } from "vue";
import {
  useConfigPanel,
  filterOption,
  filterSection,
} from "./useConfigPanel";
import type { ConfigOption } from "./useConfigPanel";
import {
  DEFAULT_EXPANDED_SECTIONS,
  ORDERED_SECTION_IDS,
} from "../../utils/dashboard/searchLabelsConfig";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/dashboard/configUtils", () => ({
  shouldShowLegendsToggle: vi.fn(() => false),
  shouldShowLegendPosition: vi.fn(() => false),
  shouldShowLegendType: vi.fn(() => false),
  shouldShowLegendWidth: vi.fn(() => false),
  shouldShowLegendHeight: vi.fn(() => false),
  shouldApplyChartAlign: vi.fn(() => false),
  shouldShowTopResultsConfig: vi.fn(() => false),
  shouldShowAreaLineStyleConfig: vi.fn(() => false),
  shouldShowNoValueReplacement: vi.fn(() => false),
  shouldShowAxisConfig: vi.fn(() => false),
  shouldShowCartesianAxisConfig: vi.fn(() => false),
  shouldShowGridlines: vi.fn(() => false),
  shouldShowAxisLabelConfig: vi.fn(() => false),
  shouldShowLineThickness: vi.fn(() => false),
  shouldShowDrilldown: vi.fn(() => false),
  shouldShowTimeShift: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePanelData = (
  type = "bar",
  configOverrides: Record<string, any> = {},
  queryOverrides: Record<string, any> = {},
) => ({
  data: {
    type,
    queries: [{ customQuery: false, ...queryOverrides }],
    config: {
      unit: "default",
      table_pagination: false,
      trellis: { layout: null },
      promql_table_mode: null,
      table_pivot_show_row_totals: false,
      table_pivot_show_col_totals: false,
      ...configOverrides,
    },
  },
  layout: { currentQueryIndex: 0 },
});

/** Create a composable instance with sensible defaults. */
const makeComposable = (
  panelData = makePanelData(),
  promqlMode = ref(false),
  showTrellis = computed(() => false),
  showColors = computed(() => false),
  isPivot = computed(() => false),
  pageKey: string = "dashboard",
) =>
  useConfigPanel(panelData, promqlMode, pageKey, showTrellis, showColors, isPivot);

// ---------------------------------------------------------------------------
// filterOption — pure helper
// ---------------------------------------------------------------------------

describe("filterOption", () => {
  it("returns false for undefined option", () => {
    expect(filterOption(undefined, "")).toBe(false);
  });

  it("returns false when visible is explicitly false", () => {
    expect(filterOption({ label: "Legend", visible: false }, "")).toBe(false);
  });

  it("returns true when visible is true and no query", () => {
    expect(filterOption({ label: "Legend", visible: true }, "")).toBe(true);
  });

  it("returns true when visible is undefined and no query", () => {
    expect(filterOption({ label: "Legend" }, "")).toBe(true);
  });

  it("is case-insensitive (query is pre-normalized to lowercase by the composable)", () => {
    // filterOption receives a pre-lowercased query; the label comparison lowercases the label
    expect(filterOption({ label: "Show Legends" }, "legend")).toBe(true);
    expect(filterOption({ label: "LEGEND" }, "legend")).toBe(true);
  });

  it("matches on partial query", () => {
    expect(filterOption({ label: "Legend Position" }, "pos")).toBe(true);
  });

  it("returns false when label does not contain query", () => {
    expect(filterOption({ label: "Legend" }, "axis")).toBe(false);
  });

  it("supports array labels — true when any label matches", () => {
    const opt: ConfigOption = { label: ["Legend Width", "Legend Height"] };
    expect(filterOption(opt, "width")).toBe(true);
    expect(filterOption(opt, "height")).toBe(true);
    expect(filterOption(opt, "axis")).toBe(false);
  });

  it("returns false when visible=false even if label matches query", () => {
    expect(filterOption({ label: "hidden", visible: false }, "hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterSection — pure helper
// ---------------------------------------------------------------------------

describe("filterSection", () => {
  const sectionOpts: Record<string, ConfigOption> = {
    a: { label: "Show Legends", visible: true },
    b: { label: "Legend Position", visible: true },
    c: { label: "Hidden Option", visible: false },
  };

  it("returns false for undefined section", () => {
    expect(filterSection(undefined, "")).toBe(false);
  });

  it("returns true when at least one option is visible and no query", () => {
    expect(filterSection(sectionOpts, "")).toBe(true);
  });

  it("returns false when all options have visible=false", () => {
    const allHidden: Record<string, ConfigOption> = {
      a: { label: "A", visible: false },
      b: { label: "B", visible: false },
    };
    expect(filterSection(allHidden, "")).toBe(false);
  });

  it("returns true when query matches at least one visible label", () => {
    expect(filterSection(sectionOpts, "legend pos")).toBe(true);
  });

  it("returns false when query matches nothing visible", () => {
    expect(filterSection(sectionOpts, "zzznomatch")).toBe(false);
  });

  it("does not match hidden options even if their label matches the query", () => {
    expect(filterSection(sectionOpts, "hidden option")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchLabelsConfig — section registry
// ---------------------------------------------------------------------------

describe("ORDERED_SECTION_IDS", () => {
  const expectedSections = [
    "general", "promqlTable", "geographic", "legend", "data",
    "axis", "labels", "lineStyle", "table", "pivotTable",
    "valueTransformations", "fieldOverrides", "map", "gauge", "layout",
    "colors", "drilldown", "comparison", "markLines", "background",
  ];

  it("contains all 20 sections", () => {
    expect(ORDERED_SECTION_IDS).toHaveLength(20);
  });

  it("contains every expected section id", () => {
    for (const id of expectedSections) {
      expect(ORDERED_SECTION_IDS).toContain(id);
    }
  });
});

describe("DEFAULT_EXPANDED_SECTIONS", () => {
  it("has an entry for every section in ORDERED_SECTION_IDS", () => {
    for (const id of ORDERED_SECTION_IDS) {
      expect(DEFAULT_EXPANDED_SECTIONS).toHaveProperty(id);
    }
  });

  it("defaults all sections to true", () => {
    expect(Object.values(DEFAULT_EXPANDED_SECTIONS).every((v) => v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — search state
// ---------------------------------------------------------------------------

describe("useConfigPanel – search state", () => {
  let c: ReturnType<typeof makeComposable>;

  beforeEach(() => {
    c = makeComposable();
  });

  it("searchQuery starts as empty string", () => {
    expect(c.searchQuery.value).toBe("");
  });

  it("expandedSections starts as a copy of DEFAULT_EXPANDED_SECTIONS", () => {
    expect(c.expandedSections.value).toEqual(DEFAULT_EXPANDED_SECTIONS);
  });

  it("auto-expands all sections when typing starts", async () => {
    c.expandedSections.value["general"] = false;
    c.expandedSections.value["legend"] = false;
    c.searchQuery.value = "axis";
    await nextTick();
    expect(c.expandedSections.value["general"]).toBe(true);
    expect(c.expandedSections.value["legend"]).toBe(true);
  });

  it("auto-restores expansion state when search is cleared", async () => {
    c.expandedSections.value["general"] = false;
    c.searchQuery.value = "axis";
    await nextTick();
    c.searchQuery.value = "";
    await nextTick();
    expect(c.expandedSections.value["general"]).toBe(false);
  });

  it("does not re-save state on subsequent query changes (non-empty → non-empty)", async () => {
    c.expandedSections.value["general"] = false;
    c.searchQuery.value = "ax";
    await nextTick();
    // Change section state after first search (should not affect saved snapshot)
    c.expandedSections.value["legend"] = false;
    c.searchQuery.value = "axis";
    await nextTick();
    c.searchQuery.value = "";
    await nextTick();
    // Restored to state from FIRST save: general=false, legend=true
    expect(c.expandedSections.value["general"]).toBe(false);
    expect(c.expandedSections.value["legend"]).toBe(true);
  });

  it("resetSearch clears the query", async () => {
    c.searchQuery.value = "some query";
    await nextTick();
    c.resetSearch();
    expect(c.searchQuery.value).toBe("");
  });

  it("resetSearch restores the expansion state", async () => {
    c.expandedSections.value["general"] = false;
    c.searchQuery.value = "legend";
    await nextTick();
    c.resetSearch();
    expect(c.expandedSections.value["general"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — expand / collapse controls
// ---------------------------------------------------------------------------

describe("useConfigPanel – expand/collapse", () => {
  let c: ReturnType<typeof makeComposable>;

  beforeEach(() => {
    c = makeComposable();
  });

  it("isExpanded returns true by default for all known sections", () => {
    for (const id of ORDERED_SECTION_IDS) {
      expect(c.isExpanded(id)).toBe(true);
    }
  });

  it("isExpanded returns true for unknown section keys (fallback)", () => {
    expect(c.isExpanded("unknownSection")).toBe(true);
  });

  it("toggleSection collapses an expanded section", () => {
    c.toggleSection("general");
    expect(c.isExpanded("general")).toBe(false);
  });

  it("toggleSection expands a collapsed section", () => {
    c.expandedSections.value["general"] = false;
    c.toggleSection("general");
    expect(c.isExpanded("general")).toBe(true);
  });

  it("toggleSection does not affect other sections", () => {
    c.toggleSection("general");
    expect(c.isExpanded("legend")).toBe(true);
  });

  it("allSectionsExpanded is true when all are open", () => {
    expect(c.allSectionsExpanded.value).toBe(true);
  });

  it("allSectionsExpanded is false when any section is collapsed", () => {
    c.expandedSections.value["general"] = false;
    expect(c.allSectionsExpanded.value).toBe(false);
  });

  it("toggleAllSections collapses everything when all are expanded", () => {
    c.toggleAllSections();
    expect(c.allSectionsExpanded.value).toBe(false);
    expect(Object.values(c.expandedSections.value).every((v) => !v)).toBe(true);
  });

  it("toggleAllSections expands everything when at least one is collapsed", () => {
    c.expandedSections.value["general"] = false;
    c.toggleAllSections();
    expect(c.allSectionsExpanded.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — anySectionVisible
// ---------------------------------------------------------------------------

describe("useConfigPanel – anySectionVisible", () => {
  it("is true when at least one section has a visible option", () => {
    // 'description' in general section is always visible (no visibility condition)
    const c = makeComposable();
    expect(c.anySectionVisible.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — general section
// ---------------------------------------------------------------------------

describe("useConfigPanel – general section", () => {
  it("description is always visible", () => {
    const c = makeComposable();
    expect(c.isConfigOptionVisible("general", "description")).toBe(true);
  });

  it("step is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData(), ref(false));
    expect(c.isConfigOptionVisible("general", "step")).toBe(false);
  });

  it("step is visible when promqlMode=true", () => {
    const c = makeComposable(makePanelData(), ref(true));
    expect(c.isConfigOptionVisible("general", "step")).toBe(true);
  });

  it("panel-default-time is always visible", () => {
    const c = makeComposable();
    expect(c.isConfigOptionVisible("general", "panel-default-time")).toBe(true);
  });

  it("promql-chart-config is visible when promqlMode=true and type is not geomap/maps/table", () => {
    const c = makeComposable(makePanelData("bar"), ref(true));
    expect(c.isConfigOptionVisible("general", "promql-chart-config")).toBe(true);
  });

  it("promql-chart-config is hidden for geomap even in promqlMode", () => {
    const c = makeComposable(makePanelData("geomap"), ref(true));
    expect(c.isConfigOptionVisible("general", "promql-chart-config")).toBe(false);
  });

  it("promql-chart-config is hidden for maps even in promqlMode", () => {
    const c = makeComposable(makePanelData("maps"), ref(true));
    expect(c.isConfigOptionVisible("general", "promql-chart-config")).toBe(false);
  });

  it("promql-chart-config is hidden for table even in promqlMode", () => {
    const c = makeComposable(makePanelData("table"), ref(true));
    expect(c.isConfigOptionVisible("general", "promql-chart-config")).toBe(false);
  });

  it("promql-chart-config is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData("bar"), ref(false));
    expect(c.isConfigOptionVisible("general", "promql-chart-config")).toBe(false);
  });

  it("general section is visible (isSectionVisible)", () => {
    const c = makeComposable();
    expect(c.isSectionVisible("general")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — promqlTable section
// ---------------------------------------------------------------------------

describe("useConfigPanel – promqlTable section", () => {
  it("promql-table-mode is visible for table type in promqlMode", () => {
    const c = makeComposable(makePanelData("table"), ref(true));
    expect(c.isConfigOptionVisible("promqlTable", "promql-table-mode")).toBe(true);
  });

  it("promql-table-mode is hidden for non-table type", () => {
    const c = makeComposable(makePanelData("bar"), ref(true));
    expect(c.isConfigOptionVisible("promqlTable", "promql-table-mode")).toBe(false);
  });

  it("promql-table-mode is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData("table"), ref(false));
    expect(c.isConfigOptionVisible("promqlTable", "promql-table-mode")).toBe(false);
  });

  it("table-aggregations is visible when promqlMode=true, type=table, mode=all", () => {
    const c = makeComposable(
      makePanelData("table", { promql_table_mode: "all" }),
      ref(true),
    );
    expect(c.isConfigOptionVisible("promqlTable", "table-aggregations")).toBe(true);
  });

  it("table-aggregations is hidden when mode is not 'all'", () => {
    const c = makeComposable(
      makePanelData("table", { promql_table_mode: "expanded_timeseries" }),
      ref(true),
    );
    expect(c.isConfigOptionVisible("promqlTable", "table-aggregations")).toBe(false);
  });

  it.each(["visible-columns", "hidden-columns", "sticky-first-column", "sticky-columns", "configure-column-order"])(
    "%s is visible for promqlMode + table + mode=all",
    (optionId) => {
      const c = makeComposable(
        makePanelData("table", { promql_table_mode: "all" }),
        ref(true),
      );
      expect(c.isConfigOptionVisible("promqlTable", optionId)).toBe(true);
    },
  );

  it.each(["visible-columns", "hidden-columns", "sticky-first-column", "sticky-columns", "configure-column-order"])(
    "%s is visible for promqlMode + table + mode=expanded_timeseries",
    (optionId) => {
      const c = makeComposable(
        makePanelData("table", { promql_table_mode: "expanded_timeseries" }),
        ref(true),
      );
      expect(c.isConfigOptionVisible("promqlTable", optionId)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// useConfigPanel — geographic section
// ---------------------------------------------------------------------------

describe("useConfigPanel – geographic section", () => {
  it("geographic-config is visible for geomap type in promqlMode", () => {
    const c = makeComposable(makePanelData("geomap"), ref(true));
    expect(c.isConfigOptionVisible("geographic", "geographic-config")).toBe(true);
  });

  it("geographic-config is visible for maps type in promqlMode", () => {
    const c = makeComposable(makePanelData("maps"), ref(true));
    expect(c.isConfigOptionVisible("geographic", "geographic-config")).toBe(true);
  });

  it("geographic-config is hidden for non-map types", () => {
    const c = makeComposable(makePanelData("bar"), ref(true));
    expect(c.isConfigOptionVisible("geographic", "geographic-config")).toBe(false);
  });

  it("geographic-config is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData("geomap"), ref(false));
    expect(c.isConfigOptionVisible("geographic", "geographic-config")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — legend section (configUtils delegation)
// ---------------------------------------------------------------------------

describe("useConfigPanel – legend section", () => {
  it("show-legends visibility delegates to shouldShowLegendsToggle", async () => {
    const { shouldShowLegendsToggle } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowLegendsToggle).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("legend", "show-legends")).toBe(true);
  });

  it("legend-position visibility delegates to shouldShowLegendPosition", async () => {
    const { shouldShowLegendPosition } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowLegendPosition).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("legend", "legend-position")).toBe(true);
  });

  it("legend-type visibility delegates to shouldShowLegendType", async () => {
    const { shouldShowLegendType } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowLegendType).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("legend", "legend-type")).toBe(true);
  });

  it("legend-size has an array label (Width + Height)", async () => {
    const { shouldShowLegendWidth } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowLegendWidth).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("legend", "legend-size")).toBe(true);
  });

  it("promql-legend is visible when promqlMode=true and type is not geomap/maps", () => {
    const c = makeComposable(makePanelData("bar"), ref(true));
    expect(c.isConfigOptionVisible("data", "promql-legend")).toBe(true);
  });

  it("promql-legend is hidden for maps type even in promqlMode", () => {
    const c = makeComposable(makePanelData("maps"), ref(true));
    expect(c.isConfigOptionVisible("data", "promql-legend")).toBe(false);
  });

  it("promql-legend is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData("bar"), ref(false));
    expect(c.isConfigOptionVisible("data", "promql-legend")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — data section
// ---------------------------------------------------------------------------

describe("useConfigPanel – data section", () => {
  it("unit is always visible", () => {
    const c = makeComposable();
    expect(c.isConfigOptionVisible("data", "unit")).toBe(true);
  });

  it("decimals is always visible", () => {
    const c = makeComposable();
    expect(c.isConfigOptionVisible("data", "decimals")).toBe(true);
  });

  it("custom-unit is hidden when unit is not 'custom'", () => {
    const c = makeComposable(makePanelData("bar", { unit: "bytes" }));
    expect(c.isConfigOptionVisible("data", "custom-unit")).toBe(false);
  });

  it("custom-unit is visible when unit is 'custom'", () => {
    const c = makeComposable(makePanelData("bar", { unit: "custom" }));
    expect(c.isConfigOptionVisible("data", "custom-unit")).toBe(true);
  });

  it("limit is visible when promqlMode=false and customQuery=false", () => {
    const c = makeComposable(makePanelData("bar", {}, { customQuery: false }), ref(false));
    expect(c.isConfigOptionVisible("data", "limit")).toBe(true);
  });

  it("limit is hidden when promqlMode=true", () => {
    const c = makeComposable(makePanelData("bar"), ref(true));
    expect(c.isConfigOptionVisible("data", "limit")).toBe(false);
  });

  it("limit is hidden when customQuery=true", () => {
    const c = makeComposable(makePanelData("bar", {}, { customQuery: true }), ref(false));
    expect(c.isConfigOptionVisible("data", "limit")).toBe(false);
  });

  it("connect-nulls visibility delegates to shouldShowAreaLineStyleConfig", async () => {
    const { shouldShowAreaLineStyleConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("data", "connect-nulls")).toBe(true);
  });

  it("no-value-replacement visibility delegates to shouldShowNoValueReplacement", async () => {
    const { shouldShowNoValueReplacement } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowNoValueReplacement).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("data", "no-value-replacement")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — axis section
// ---------------------------------------------------------------------------

describe("useConfigPanel – axis section", () => {
  it("axis-width visibility delegates to shouldShowAxisConfig", async () => {
    const { shouldShowAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAxisConfig).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "axis-width")).toBe(true);
  });

  it("axis-border visibility delegates to shouldShowAxisConfig", async () => {
    const { shouldShowAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAxisConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "axis-border")).toBe(true);
    vi.mocked(shouldShowAxisConfig).mockReturnValue(false);
  });

  it("y-axis visibility delegates to shouldShowCartesianAxisConfig", async () => {
    const { shouldShowCartesianAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "y-axis")).toBe(true);
  });

  it("gridlines visibility delegates to shouldShowGridlines", async () => {
    const { shouldShowGridlines } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowGridlines).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "gridlines")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — labels section
// ---------------------------------------------------------------------------

describe("useConfigPanel – labels section", () => {
  it("label-position visibility delegates to shouldShowCartesianAxisConfig", async () => {
    // shouldShowCartesianAxisConfig is called multiple times per configOptions evaluation
    // (y-axis, label-position, label-rotate, mark-lines), so use mockReturnValue not Once
    const { shouldShowCartesianAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("labels", "label-position")).toBe(true);
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(false);
  });

  it("label-rotate visibility delegates to shouldShowCartesianAxisConfig", async () => {
    const { shouldShowCartesianAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("labels", "label-rotate")).toBe(true);
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(false);
  });

  it("axis-label visibility delegates to shouldShowAxisLabelConfig", async () => {
    const { shouldShowAxisLabelConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAxisLabelConfig).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("labels", "axis-label")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — lineStyle section
// ---------------------------------------------------------------------------

describe("useConfigPanel – lineStyle section", () => {
  it("symbol visibility delegates to shouldShowAreaLineStyleConfig", async () => {
    // shouldShowAreaLineStyleConfig is called for connect-nulls, symbol, and interpolation
    const { shouldShowAreaLineStyleConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "symbol")).toBe(true);
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(false);
  });

  it("interpolation visibility delegates to shouldShowAreaLineStyleConfig", async () => {
    const { shouldShowAreaLineStyleConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "interpolation")).toBe(true);
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(false);
  });

  it("line-thickness visibility delegates to shouldShowLineThickness", async () => {
    const { shouldShowLineThickness } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowLineThickness).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "line-thickness")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — table section
// ---------------------------------------------------------------------------

describe("useConfigPanel – table section", () => {
  it("wrap is visible for table type", () => {
    const c = makeComposable(makePanelData("table"));
    expect(c.isConfigOptionVisible("table", "wrap")).toBe(true);
  });

  it("wrap is hidden for non-table type", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isConfigOptionVisible("table", "wrap")).toBe(false);
  });

  it("transpose is visible for table type in sql mode", () => {
    const c = makeComposable(makePanelData("table"), ref(false));
    expect(c.isConfigOptionVisible("table", "transpose")).toBe(true);
  });

  it("transpose is hidden in promqlMode even for table type", () => {
    const c = makeComposable(makePanelData("table"), ref(true));
    expect(c.isConfigOptionVisible("table", "transpose")).toBe(false);
  });

  it("dynamic-columns is visible for table type in sql mode", () => {
    const c = makeComposable(makePanelData("table"), ref(false));
    expect(c.isConfigOptionVisible("table", "dynamic-columns")).toBe(true);
  });

  it("dynamic-columns is hidden in promqlMode", () => {
    const c = makeComposable(makePanelData("table"), ref(true));
    expect(c.isConfigOptionVisible("table", "dynamic-columns")).toBe(false);
  });

  it("pagination is visible for table type", () => {
    const c = makeComposable(makePanelData("table"));
    expect(c.isConfigOptionVisible("table", "pagination")).toBe(true);
  });

  it("pagination is hidden for non-table type", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isConfigOptionVisible("table", "pagination")).toBe(false);
  });

  it("rows-per-page is hidden when pagination is disabled", () => {
    const c = makeComposable(makePanelData("table", { table_pagination: false }));
    expect(c.isConfigOptionVisible("table", "rows-per-page")).toBe(false);
  });

  it("rows-per-page is visible when pagination is enabled for table type", () => {
    const c = makeComposable(makePanelData("table", { table_pagination: true }));
    expect(c.isConfigOptionVisible("table", "rows-per-page")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — pivotTable section
// ---------------------------------------------------------------------------

describe("useConfigPanel – pivotTable section", () => {
  const pivotMode = computed(() => true);

  it("pivot-show-row-totals is visible for table in sql mode with pivot", () => {
    const c = makeComposable(makePanelData("table"), ref(false), computed(() => false), computed(() => false), pivotMode);
    expect(c.isConfigOptionVisible("pivotTable", "pivot-show-row-totals")).toBe(true);
  });

  it("pivot-show-row-totals is hidden in promqlMode", () => {
    const c = makeComposable(makePanelData("table"), ref(true), computed(() => false), computed(() => false), pivotMode);
    expect(c.isConfigOptionVisible("pivotTable", "pivot-show-row-totals")).toBe(false);
  });

  it("pivot-show-row-totals is hidden when not pivot mode", () => {
    const c = makeComposable(makePanelData("table"), ref(false), computed(() => false), computed(() => false), computed(() => false));
    expect(c.isConfigOptionVisible("pivotTable", "pivot-show-row-totals")).toBe(false);
  });

  it("pivot-sticky-row-totals is visible when pivot + col totals enabled", () => {
    const c = makeComposable(
      makePanelData("table", { table_pivot_show_col_totals: true }),
      ref(false),
      computed(() => false),
      computed(() => false),
      pivotMode,
    );
    expect(c.isConfigOptionVisible("pivotTable", "pivot-sticky-row-totals")).toBe(true);
  });

  it("pivot-sticky-col-totals is visible when pivot + row totals enabled", () => {
    const c = makeComposable(
      makePanelData("table", { table_pivot_show_row_totals: true }),
      ref(false),
      computed(() => false),
      computed(() => false),
      pivotMode,
    );
    expect(c.isConfigOptionVisible("pivotTable", "pivot-sticky-col-totals")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — map section
// ---------------------------------------------------------------------------

describe("useConfigPanel – map section", () => {
  it("map-config is visible for geomap type", () => {
    const c = makeComposable(makePanelData("geomap"));
    expect(c.isConfigOptionVisible("map", "map-config")).toBe(true);
  });

  it("map-config is visible for maps type", () => {
    const c = makeComposable(makePanelData("maps"));
    expect(c.isConfigOptionVisible("map", "map-config")).toBe(true);
  });

  it("map-config is hidden for non-map types", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isConfigOptionVisible("map", "map-config")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — gauge section
// ---------------------------------------------------------------------------

describe("useConfigPanel – gauge section", () => {
  it("gauge-min and gauge-max are visible for gauge type", () => {
    const c = makeComposable(makePanelData("gauge"));
    expect(c.isConfigOptionVisible("gauge", "gauge-min")).toBe(true);
    expect(c.isConfigOptionVisible("gauge", "gauge-max")).toBe(true);
  });

  it("gauge-min and gauge-max are hidden for non-gauge types", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isConfigOptionVisible("gauge", "gauge-min")).toBe(false);
    expect(c.isConfigOptionVisible("gauge", "gauge-max")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — layout section
// ---------------------------------------------------------------------------

describe("useConfigPanel – layout section", () => {
  it("trellis-layout is visible when showTrellisConfig=true", () => {
    const c = makeComposable(makePanelData(), ref(false), computed(() => true));
    expect(c.isConfigOptionVisible("layout", "trellis-layout")).toBe(true);
  });

  it("trellis-layout is hidden when showTrellisConfig=false", () => {
    const c = makeComposable(makePanelData(), ref(false), computed(() => false));
    expect(c.isConfigOptionVisible("layout", "trellis-layout")).toBe(false);
  });

  it("trellis-columns is visible when showTrellis and layout='custom'", () => {
    const c = makeComposable(
      makePanelData("bar", { trellis: { layout: "custom" } }),
      ref(false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("layout", "trellis-columns")).toBe(true);
  });

  it("trellis-columns is hidden when layout is not 'custom'", () => {
    const c = makeComposable(
      makePanelData("bar", { trellis: { layout: "auto" } }),
      ref(false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("layout", "trellis-columns")).toBe(false);
  });

  it("trellis-group-by is visible when showTrellis and layout is non-null", () => {
    const c = makeComposable(
      makePanelData("bar", { trellis: { layout: "auto" } }),
      ref(false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("layout", "trellis-group-by")).toBe(true);
  });

  it("trellis-group-by is hidden when layout is null", () => {
    const c = makeComposable(
      makePanelData("bar", { trellis: { layout: null } }),
      ref(false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("layout", "trellis-group-by")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — colors section
// ---------------------------------------------------------------------------

describe("useConfigPanel – colors section", () => {
  it("colors is visible when showColorPalette=true", () => {
    const c = makeComposable(makePanelData(), ref(false), computed(() => false), computed(() => true));
    expect(c.isConfigOptionVisible("colors", "colors")).toBe(true);
  });

  it("colors is hidden when showColorPalette=false", () => {
    const c = makeComposable(makePanelData(), ref(false), computed(() => false), computed(() => false));
    expect(c.isConfigOptionVisible("colors", "colors")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — drilldown section
// ---------------------------------------------------------------------------

describe("useConfigPanel – drilldown section", () => {
  it("drilldown visibility delegates to shouldShowDrilldown", async () => {
    const { shouldShowDrilldown } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowDrilldown).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("drilldown", "drilldown")).toBe(true);
  });

  it("drilldown is hidden when shouldShowDrilldown returns false", () => {
    // mock already returns false by default
    const c = makeComposable();
    expect(c.isConfigOptionVisible("drilldown", "drilldown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — comparison section
// ---------------------------------------------------------------------------

describe("useConfigPanel – comparison section", () => {
  it("comparison visibility delegates to shouldShowTimeShift", async () => {
    const { shouldShowTimeShift } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowTimeShift).mockReturnValueOnce(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("comparison", "comparison")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — markLines section
// ---------------------------------------------------------------------------

describe("useConfigPanel – markLines section", () => {
  it("mark-lines visibility delegates to shouldShowCartesianAxisConfig", async () => {
    // shouldShowCartesianAxisConfig is called for y-axis, label-position, label-rotate, and mark-lines
    const { shouldShowCartesianAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("markLines", "mark-lines")).toBe(true);
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — background section
// ---------------------------------------------------------------------------

describe("useConfigPanel – background section", () => {
  it("background is visible for metric type", () => {
    const c = makeComposable(makePanelData("metric"));
    expect(c.isConfigOptionVisible("background", "background")).toBe(true);
  });

  it("background is hidden for non-metric types", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isConfigOptionVisible("background", "background")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — isSectionVisible
// ---------------------------------------------------------------------------

describe("useConfigPanel – isSectionVisible", () => {
  it("general is visible (description is always shown)", () => {
    const c = makeComposable();
    expect(c.isSectionVisible("general")).toBe(true);
  });

  it("gauge is visible for gauge type", () => {
    const c = makeComposable(makePanelData("gauge"));
    expect(c.isSectionVisible("gauge")).toBe(true);
  });

  it("gauge is hidden for non-gauge type (all options have visible=false)", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isSectionVisible("gauge")).toBe(false);
  });

  it("table section is visible for table type", () => {
    const c = makeComposable(makePanelData("table"));
    expect(c.isSectionVisible("table")).toBe(true);
  });

  it("table section is hidden for bar type (all options have visible=false)", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isSectionVisible("table")).toBe(false);
  });

  it("data section is always visible (unit and decimals have no visibility condition)", () => {
    const c = makeComposable();
    expect(c.isSectionVisible("data")).toBe(true);
  });

  it("background is hidden for bar type", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isSectionVisible("background")).toBe(false);
  });

  it("background is visible for metric type", () => {
    const c = makeComposable(makePanelData("metric"));
    expect(c.isSectionVisible("background")).toBe(true);
  });

  it("returns false for a section that has no visible options when searching", async () => {
    const c = makeComposable(makePanelData("bar"));
    c.searchQuery.value = "zzznomatch";
    await nextTick();
    expect(c.isSectionVisible("general")).toBe(false);
  });

  it("returns true for a section whose option label matches the search query", async () => {
    const c = makeComposable();
    c.searchQuery.value = "description";
    await nextTick();
    expect(c.isSectionVisible("general")).toBe(true);
  });
});
