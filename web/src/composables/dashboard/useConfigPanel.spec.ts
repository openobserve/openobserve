// Copyright 2026 OpenObserve Inc.
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
  shouldShowThresholds,
  shouldShowSeriesOverrides,
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
  shouldShowLegendValues: vi.fn(() => false),
  shouldShowTopResultsConfig: vi.fn(() => false),
  shouldShowAreaLineStyleConfig: vi.fn(() => false),
  shouldShowNoValueReplacement: vi.fn(() => false),
  shouldShowNoDataText: vi.fn(() => false),
  shouldShowAxisConfig: vi.fn(() => false),
  shouldShowAxisBorderConfig: vi.fn(() => false),
  shouldShowCartesianAxisConfig: vi.fn(() => false),
  shouldShowCartesianSeriesConfig: vi.fn(() => false),
  shouldShowStackMode: vi.fn(() => false),
  shouldShowSortOrder: vi.fn(() => false),
  shouldShowBarRadius: vi.fn(() => false),
  shouldShowScatterEncoding: vi.fn(() => false),
  shouldShowConnectNullsThreshold: vi.fn(() => false),
  shouldShowGridlines: vi.fn(() => false),
  shouldShowAxisLabelConfig: vi.fn(() => false),
  shouldShowAreaFillConfig: vi.fn(() => false),
  shouldShowScatterPointConfig: vi.fn(() => false),
  shouldShowBarStyleConfig: vi.fn(() => false),
  shouldShowBarWidthConfig: vi.fn(() => false),
  shouldShowDrilldown: vi.fn(() => false),
  shouldShowTimeShift: vi.fn(() => false),
  allVisibleQueriesInstant: vi.fn(() => false),
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
) => useConfigPanel(panelData, promqlMode, pageKey, showTrellis, showColors, isPivot);

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
    "general",
    "promqlTable",
    "geographic",
    "legend",
    "data",
    "stateTimeline",
    "hostmap",
    "axis",
    "labels",
    "lineStyle",
    "table",
    "pivotTable",
    "valueTransformations",
    "fieldOverrides",
    "seriesOverrides",
    "map",
    "gauge",
    "pie",
    "layout",
    "colors",
    "drilldown",
    "comparison",
    "markLines",
    "thresholds",
    "metric",
    "background",
    "sparkline",
    "alertList",
    "flameGraph",
  ];

  it("lists each section once", () => {
    expect(new Set(ORDERED_SECTION_IDS).size).toBe(ORDERED_SECTION_IDS.length);
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

  it("defaults all sections to false (collapsed)", () => {
    expect(Object.values(DEFAULT_EXPANDED_SECTIONS).every((v) => v === false)).toBe(true);
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
    c.expandedSections.value["legend"] = true;
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

  it("isExpanded returns false by default for all known sections", () => {
    for (const id of ORDERED_SECTION_IDS) {
      expect(c.isExpanded(id)).toBe(false);
    }
  });

  it("isExpanded returns false for unknown section keys (fallback)", () => {
    expect(c.isExpanded("unknownSection")).toBe(false);
  });

  it("toggleSection collapses an expanded section", () => {
    c.expandedSections.value["general"] = true;
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
    expect(c.isExpanded("legend")).toBe(false);
  });

  it("allSectionsExpanded is true when all are open", () => {
    Object.keys(c.expandedSections.value).forEach((k) => {
      c.expandedSections.value[k] = true;
    });
    expect(c.allSectionsExpanded.value).toBe(true);
  });

  it("allSectionsExpanded is false when any section is collapsed", () => {
    c.expandedSections.value["general"] = false;
    expect(c.allSectionsExpanded.value).toBe(false);
  });

  it("toggleAllSections collapses everything when all are expanded", () => {
    Object.keys(c.expandedSections.value).forEach((k) => {
      c.expandedSections.value[k] = true;
    });
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

  it.each([
    ["stacked", true, true],
    ["pie", true, true],
    ["table", true, true],
    ["line", true, false],
    ["stacked", false, false],
  ])("promql-series-limit for %s with promqlMode=%s is visible=%s", (type, promql, visible) => {
    const c = makeComposable(makePanelData(type), ref(promql));
    expect(c.isConfigOptionVisible("general", "promql-series-limit")).toBe(visible);
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
    const c = makeComposable(makePanelData("table", { promql_table_mode: "all" }), ref(true));
    expect(c.isConfigOptionVisible("promqlTable", "table-aggregations")).toBe(true);
  });

  it("table-aggregations is hidden when mode is not 'all'", () => {
    const c = makeComposable(
      makePanelData("table", { promql_table_mode: "expanded_timeseries" }),
      ref(true),
    );
    expect(c.isConfigOptionVisible("promqlTable", "table-aggregations")).toBe(false);
  });

  it.each([
    "visible-columns",
    "hidden-columns",
    "sticky-first-column",
    "sticky-columns",
    "configure-column-order",
  ])("%s is visible for promqlMode + table + mode=all", (optionId) => {
    const c = makeComposable(makePanelData("table", { promql_table_mode: "all" }), ref(true));
    expect(c.isConfigOptionVisible("promqlTable", optionId)).toBe(true);
  });

  it.each([
    "visible-columns",
    "hidden-columns",
    "sticky-first-column",
    "sticky-columns",
    "configure-column-order",
  ])("%s is visible for promqlMode + table + mode=expanded_timeseries", (optionId) => {
    const c = makeComposable(
      makePanelData("table", { promql_table_mode: "expanded_timeseries" }),
      ref(true),
    );
    expect(c.isConfigOptionVisible("promqlTable", optionId)).toBe(true);
  });
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
    expect(c.isConfigOptionVisible("legend", "promql-legend")).toBe(true);
  });

  it("promql-legend is hidden for maps type even in promqlMode", () => {
    const c = makeComposable(makePanelData("maps"), ref(true));
    expect(c.isConfigOptionVisible("legend", "promql-legend")).toBe(false);
  });

  it("promql-legend is hidden when promqlMode=false", () => {
    const c = makeComposable(makePanelData("bar"), ref(false));
    expect(c.isConfigOptionVisible("legend", "promql-legend")).toBe(false);
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

describe("useConfigPanel – host map section", () => {
  const shared = ["reduction", "group-sort", "cell-sort", "cell-shape", "cell-label"];

  it("shows the cell options for SQL and keeps unit, decimals and thresholds", () => {
    const c = makeComposable(makePanelData("hostmap"));
    for (const option of shared) expect(c.isConfigOptionVisible("hostmap", option)).toBe(true);
    expect(c.isConfigOptionVisible("hostmap", "entity-label")).toBe(false);
    expect(c.isConfigOptionVisible("data", "unit")).toBe(true);
    expect(c.isConfigOptionVisible("data", "decimals")).toBe(true);
    expect(c.isSectionVisible("thresholds")).toBe(true);
  });

  it("shows the label inputs only for PromQL", () => {
    const c = makeComposable(makePanelData("hostmap"), ref(true));
    expect(c.isConfigOptionVisible("hostmap", "entity-label")).toBe(true);
    expect(c.isConfigOptionVisible("hostmap", "group-by")).toBe(true);
    // The host map's own cell cap bounds its PromQL series, so the panel series limit stays hidden.
    expect(c.isConfigOptionVisible("general", "promql-series-limit")).toBe(false);
  });

  it("hides the host map options for other types", () => {
    expect(makeComposable(makePanelData("line")).isSectionVisible("hostmap")).toBe(false);
  });
});

describe("useConfigPanel – state timeline section", () => {
  const options = ["merge-gaps", "row-size", "show-state-text", "row-sort", "tooltip-mode"];

  it("shows the state timeline options and hides unit and decimals for that type", () => {
    const c = makeComposable(makePanelData("state-timeline"));
    for (const option of options) {
      expect(c.isConfigOptionVisible("stateTimeline", option)).toBe(true);
    }
    expect(c.isConfigOptionVisible("data", "unit")).toBe(false);
    expect(c.isConfigOptionVisible("data", "decimals")).toBe(false);
    expect(c.isSectionVisible("thresholds")).toBe(true);
  });

  it("hides the state timeline options for other types", () => {
    const c = makeComposable(makePanelData("line"));
    expect(c.isSectionVisible("stateTimeline")).toBe(false);
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

  it("axis-border visibility delegates to shouldShowAxisBorderConfig", async () => {
    const { shouldShowAxisBorderConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAxisBorderConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "axis-border")).toBe(true);
    vi.mocked(shouldShowAxisBorderConfig).mockReturnValue(false);
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

  it("axis-label-mode is visible for a cartesian SQL panel and hidden in PromQL mode", async () => {
    const { shouldShowCartesianAxisConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(true);
    expect(makeComposable().isConfigOptionVisible("axis", "axis-label-mode")).toBe(true);
    expect(
      makeComposable(makePanelData(), ref(true)).isConfigOptionVisible("axis", "axis-label-mode"),
    ).toBe(false);
    vi.mocked(shouldShowCartesianAxisConfig).mockReturnValue(false);
  });

  it("bar-track follows shouldShowBarStyleConfig and bar-width shouldShowBarWidthConfig", async () => {
    const { shouldShowBarStyleConfig, shouldShowBarWidthConfig } =
      await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowBarStyleConfig).mockReturnValue(true);
    vi.mocked(shouldShowBarWidthConfig).mockReturnValue(false);
    let c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "bar-track")).toBe(true);
    expect(c.isConfigOptionVisible("axis", "bar-width")).toBe(false);
    vi.mocked(shouldShowBarStyleConfig).mockReturnValue(false);
    vi.mocked(shouldShowBarWidthConfig).mockReturnValue(true);
    c = makeComposable();
    expect(c.isConfigOptionVisible("axis", "bar-track")).toBe(false);
    expect(c.isConfigOptionVisible("axis", "bar-width")).toBe(true);
    vi.mocked(shouldShowBarWidthConfig).mockReturnValue(false);
  });

  it("axis-label-mode is hidden for a non-cartesian panel", () => {
    expect(makeComposable().isConfigOptionVisible("axis", "axis-label-mode")).toBe(false);
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

  it("line-thickness visibility delegates to shouldShowAreaLineStyleConfig", async () => {
    const { shouldShowAreaLineStyleConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "line-thickness")).toBe(true);
    vi.mocked(shouldShowAreaLineStyleConfig).mockReturnValue(false);
  });

  it("fill opacity and gradient visibility delegate to shouldShowAreaFillConfig", async () => {
    const { shouldShowAreaFillConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowAreaFillConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "fill-opacity")).toBe(true);
    expect(c.isConfigOptionVisible("lineStyle", "fill-gradient")).toBe(true);
    vi.mocked(shouldShowAreaFillConfig).mockReturnValue(false);
    expect(makeComposable().isConfigOptionVisible("lineStyle", "fill-opacity")).toBe(false);
  });

  it("point size and opacity visibility delegate to shouldShowScatterPointConfig", async () => {
    const { shouldShowScatterPointConfig } = await import("@/utils/dashboard/configUtils");
    vi.mocked(shouldShowScatterPointConfig).mockReturnValue(true);
    const c = makeComposable();
    expect(c.isConfigOptionVisible("lineStyle", "point-size")).toBe(true);
    expect(c.isConfigOptionVisible("lineStyle", "point-opacity")).toBe(true);
    vi.mocked(shouldShowScatterPointConfig).mockReturnValue(false);
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

  it("expandable-rows is visible for table type in sql and promql mode", () => {
    expect(
      makeComposable(makePanelData("table"), ref(false)).isConfigOptionVisible(
        "table",
        "expandable-rows",
      ),
    ).toBe(true);
    expect(
      makeComposable(makePanelData("table"), ref(true)).isConfigOptionVisible(
        "table",
        "expandable-rows",
      ),
    ).toBe(true);
  });

  it("expandable-rows is hidden in pivot mode", () => {
    const c = makeComposable(
      makePanelData("table"),
      ref(false),
      undefined,
      undefined,
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("table", "expandable-rows")).toBe(false);
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
    const c = makeComposable(
      makePanelData("table"),
      ref(false),
      computed(() => false),
      computed(() => false),
      pivotMode,
    );
    expect(c.isConfigOptionVisible("pivotTable", "pivot-show-row-totals")).toBe(true);
  });

  it("pivot-show-row-totals is hidden in promqlMode", () => {
    const c = makeComposable(
      makePanelData("table"),
      ref(true),
      computed(() => false),
      computed(() => false),
      pivotMode,
    );
    expect(c.isConfigOptionVisible("pivotTable", "pivot-show-row-totals")).toBe(false);
  });

  it("pivot-show-row-totals is hidden when not pivot mode", () => {
    const c = makeComposable(
      makePanelData("table"),
      ref(false),
      computed(() => false),
      computed(() => false),
      computed(() => false),
    );
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

  it("map-roam is searchable for maps only", () => {
    expect(makeComposable(makePanelData("maps")).isConfigOptionVisible("map", "map-roam")).toBe(
      true,
    );
    expect(makeComposable(makePanelData("geomap")).isConfigOptionVisible("map", "map-roam")).toBe(
      false,
    );
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
    expect(c.isConfigOptionVisible("gauge", "gauge-range-mode")).toBe(false);
    expect(c.isConfigOptionVisible("gauge", "gauge-end-labels")).toBe(false);
  });

  it("range mode and end labels are visible for gauge type", () => {
    const c = makeComposable(makePanelData("gauge"));
    expect(c.isConfigOptionVisible("gauge", "gauge-range-mode")).toBe(true);
    expect(c.isConfigOptionVisible("gauge", "gauge-end-labels")).toBe(true);
  });

  it("auto range mode hides the fixed min and max", () => {
    const c = makeComposable(makePanelData("gauge", {}, { config: { range_mode: "auto" } }));
    expect(c.isConfigOptionVisible("gauge", "gauge-min")).toBe(false);
    expect(c.isConfigOptionVisible("gauge", "gauge-max")).toBe(false);
    expect(c.isConfigOptionVisible("gauge", "gauge-range-mode")).toBe(true);
  });
});

describe("useConfigPanel – alert list section", () => {
  it("shows the alert list only its own section and general", () => {
    const c = makeComposable(makePanelData("alert-list"));
    expect(ORDERED_SECTION_IDS.filter((id) => c.isSectionVisible(id))).toEqual([
      "general",
      "alertList",
    ]);
  });

  it("hides the panel time option for the alert list, which reads no time range", () => {
    expect(
      makeComposable(makePanelData("alert-list")).isConfigOptionVisible(
        "general",
        "panel-default-time",
      ),
    ).toBe(false);
    expect(
      makeComposable(makePanelData("bar")).isConfigOptionVisible("general", "panel-default-time"),
    ).toBe(true);
  });

  it("leaves other charts' sections as they were", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isSectionVisible("data")).toBe(true);
    expect(c.isSectionVisible("general")).toBe(true);
    expect(c.isSectionVisible("alertList")).toBe(false);
  });
});
describe("useConfigPanel – flame graph sections", () => {
  it("shows the flame graph only its own section, general and data", () => {
    const c = makeComposable(makePanelData("flame-graph"));
    expect(ORDERED_SECTION_IDS.filter((id) => c.isSectionVisible(id))).toEqual([
      "general",
      "data",
      "flameGraph",
    ]);
  });

  it("leaves other charts' sections as they were", () => {
    const c = makeComposable(makePanelData("bar"));
    expect(c.isSectionVisible("data")).toBe(true);
    expect(c.isSectionVisible("general")).toBe(true);
    expect(c.isSectionVisible("flameGraph")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — layout section
// ---------------------------------------------------------------------------

describe("useConfigPanel – layout section", () => {
  it("trellis-layout is visible when showTrellisConfig=true", () => {
    const c = makeComposable(
      makePanelData(),
      ref(false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("layout", "trellis-layout")).toBe(true);
  });

  it("trellis-layout is hidden when showTrellisConfig=false", () => {
    const c = makeComposable(
      makePanelData(),
      ref(false),
      computed(() => false),
    );
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
    const c = makeComposable(
      makePanelData(),
      ref(false),
      computed(() => false),
      computed(() => true),
    );
    expect(c.isConfigOptionVisible("colors", "colors")).toBe(true);
  });

  it("colors is hidden when showColorPalette=false", () => {
    const c = makeComposable(
      makePanelData(),
      ref(false),
      computed(() => false),
      computed(() => false),
    );
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
// useConfigPanel — thresholds section
// ---------------------------------------------------------------------------

describe("useConfigPanel – thresholds section", () => {
  it.each([
    "line",
    "area",
    "area-stacked",
    "bar",
    "h-bar",
    "stacked",
    "h-stacked",
    "scatter",
    "gauge",
    "metric",
  ])("is visible for %s", (type) => {
    const c = makeComposable(makePanelData(type));
    expect(c.isSectionVisible("thresholds")).toBe(true);
  });

  it.each(["pie", "donut", "heatmap", "table", "geomap"])("is hidden for %s", (type) => {
    const c = makeComposable(makePanelData(type));
    expect(c.isSectionVisible("thresholds")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useConfigPanel — series overrides section
// ---------------------------------------------------------------------------

describe("useConfigPanel – series overrides section", () => {
  it.each([
    "line",
    "area",
    "area-stacked",
    "bar",
    "h-bar",
    "stacked",
    "h-stacked",
    "scatter",
    "pie",
    "donut",
    "gauge",
    "metric",
  ])("is visible for %s", (type) => {
    const c = makeComposable(makePanelData(type));
    expect(c.isSectionVisible("seriesOverrides")).toBe(true);
  });

  it.each(["table", "heatmap", "geomap", "maps", "sankey", "html", "markdown", "custom_chart"])(
    "is hidden for %s",
    (type) => {
      const c = makeComposable(makePanelData(type));
      expect(c.isSectionVisible("seriesOverrides")).toBe(false);
    },
  );
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

describe("useConfigPanel – show exemplars option", () => {
  const promqlPanel = (type: string, queryType = "range") => {
    const panel = makePanelData(type, {}, { config: { query_type: queryType } });
    (panel.data as Record<string, unknown>).queryType = "promql";
    return panel;
  };

  it.each(["line", "heatmap"])(
    "is found by searching 'exemplars' on an eligible PromQL %s panel",
    async (type) => {
      const c = makeComposable(promqlPanel(type), ref(true));
      c.searchQuery.value = "exemplars";
      await nextTick();
      expect(c.isConfigOptionVisible("general", "show-exemplars")).toBe(true);
    },
  );

  it.each([
    ["h-bar", "range", true],
    ["line", "instant", true],
    ["heatmap", "instant", true],
    ["line", "range", false],
    ["heatmap", "range", false],
  ])("stays hidden for %s/%s with promqlMode=%s", (type, queryType, promql) => {
    const c = makeComposable(promqlPanel(type, queryType), ref(promql));
    expect(c.isConfigOptionVisible("general", "show-exemplars")).toBe(false);
  });
});

describe("filterOption – plural queries", () => {
  it.each([
    ["limits", "Limit line only"],
    ["units", "Unit"],
    ["thresholds", "Thresholds"],
    ["labels", "Label position"],
  ])("%j finds %j", (query, label) => {
    expect(filterOption({ label }, query)).toBe(true);
  });

  it.each([
    ["axis", "Max value"],
    ["units", "Unity"],
    ["gas", "Ga"],
  ])("%j does not widen to %j", (query, label) => {
    expect(filterOption({ label }, query)).toBe(false);
  });
});

describe("useConfigPanel – heatmap colour range", () => {
  it("is visible only for heatmap panels", () => {
    expect(
      makeComposable(makePanelData("heatmap")).isConfigOptionVisible("data", "heatmap-color-range"),
    ).toBe(true);
    expect(
      makeComposable(makePanelData("bar")).isConfigOptionVisible("data", "heatmap-color-range"),
    ).toBe(false);
  });

  it.each(["heatmap-palette", "heatmap-palette-reverse", "heatmap-color-scale"])(
    "shows %s for heatmap panels only, SQL and PromQL alike",
    (option) => {
      expect(makeComposable(makePanelData("heatmap")).isConfigOptionVisible("data", option)).toBe(
        true,
      );
      expect(
        makeComposable(makePanelData("heatmap"), ref(true)).isConfigOptionVisible("data", option),
      ).toBe(true);
      expect(makeComposable(makePanelData("bar")).isConfigOptionVisible("data", option)).toBe(
        false,
      );
    },
  );

  it("shows the histogram mode switch for PromQL heatmaps only", () => {
    const visible = (type: string, promql: boolean) =>
      makeComposable(makePanelData(type), ref(promql)).isConfigOptionVisible(
        "data",
        "heatmap-histogram-mode",
      );
    expect(visible("heatmap", true)).toBe(true);
    expect(visible("heatmap", false)).toBe(false);
    expect(visible("line", true)).toBe(false);
  });

  it("shows the bucket unit only in histogram mode, and its custom text only for a custom unit", () => {
    const visible = (config: Record<string, any>, option: string) =>
      makeComposable(makePanelData("heatmap", config), ref(true)).isConfigOptionVisible(
        "data",
        option,
      );
    expect(visible({}, "bucket-unit")).toBe(false);
    expect(visible({ heatmap_mode: "prometheus_histogram" }, "bucket-unit")).toBe(true);
    expect(visible({ heatmap_mode: "prometheus_histogram" }, "bucket-unit-custom")).toBe(false);
    expect(
      visible(
        { heatmap_mode: "prometheus_histogram", bucket_unit: "custom" },
        "bucket-unit-custom",
      ),
    ).toBe(true);
  });

  it("is found by searching either label", () => {
    const c = makeComposable(makePanelData("heatmap"));
    // The i18n mock returns keys, so the search matches the key text.
    c.searchQuery.value = "heatmapcolormax";
    expect(c.isConfigOptionVisible("data", "heatmap-color-range")).toBe(true);
    c.searchQuery.value = "legend";
    expect(c.isConfigOptionVisible("data", "heatmap-color-range")).toBe(false);
  });
});

describe("useConfigPanel – heatmap y axis", () => {
  const numericY = {
    fields: {
      y: [{ alias: "y", functionName: null, args: [{ type: "field", value: { field: "age" } }] }],
    },
  };
  const withSchema = (panel: any, type = "Int64") => ({
    ...panel,
    meta: {
      streamFields: { groupedFields: [{ stream_alias: null, schema: [{ name: "age", type }] }] },
    },
  });
  const visible = (panel: any, option: string, promql = false) =>
    makeComposable(panel, ref(promql)).isConfigOptionVisible("axis", option);

  it("shows the y sort for SQL and generic PromQL heatmaps, not histogram mode or other charts", () => {
    expect(visible(makePanelData("heatmap"), "heatmap-y-sort")).toBe(true);
    expect(visible(makePanelData("heatmap", {}, { customQuery: true }), "heatmap-y-sort")).toBe(
      true,
    );
    expect(visible(makePanelData("heatmap"), "heatmap-y-sort", true)).toBe(true);
    expect(
      visible(
        makePanelData("heatmap", { heatmap_mode: "prometheus_histogram" }),
        "heatmap-y-sort",
        true,
      ),
    ).toBe(false);
    expect(visible(makePanelData("bar"), "heatmap-y-sort")).toBe(false);
  });

  it("shows y bucketing only for a builder heatmap whose y is a numeric column", () => {
    expect(visible(withSchema(makePanelData("heatmap", {}, numericY)), "heatmap-y-bucket")).toBe(
      true,
    );
    expect(
      visible(withSchema(makePanelData("heatmap", {}, numericY), "Utf8"), "heatmap-y-bucket"),
    ).toBe(false);
    expect(
      visible(
        withSchema(makePanelData("heatmap", {}, { ...numericY, customQuery: true })),
        "heatmap-y-bucket",
      ),
    ).toBe(false);
    expect(
      visible(withSchema(makePanelData("heatmap", {}, numericY)), "heatmap-y-bucket", true),
    ).toBe(false);
    expect(visible(withSchema(makePanelData("bar", {}, numericY)), "heatmap-y-bucket")).toBe(false);
  });

  it("shows the y range only while bucketing is on", () => {
    expect(visible(withSchema(makePanelData("heatmap", {}, numericY)), "heatmap-y-range")).toBe(
      false,
    );
    expect(
      visible(
        withSchema(makePanelData("heatmap", { heatmap_y_bucket: { mode: "log" } }, numericY)),
        "heatmap-y-range",
      ),
    ).toBe(true);
  });
});

describe("cartesian series options", () => {
  it.each([
    ["shouldShowCartesianSeriesConfig", "legend", "chart-tooltip-mode"],
    ["shouldShowCartesianSeriesConfig", "legend", "tooltip-sort"],
    ["shouldShowCartesianSeriesConfig", "axis", "y-axis-scale"],
    ["shouldShowCartesianSeriesConfig", "axis", "y-axis-label"],
    ["shouldShowCartesianSeriesConfig", "axis", "y-axis-hard-range"],
    ["shouldShowCartesianSeriesConfig", "markLines", "mark-areas"],
    ["shouldShowStackMode", "axis", "stack-mode"],
    ["shouldShowSortOrder", "axis", "sort-order"],
    ["shouldShowBarRadius", "lineStyle", "bar-radius"],
    ["shouldShowAreaLineStyleConfig", "lineStyle", "line-style"],
    ["shouldShowScatterEncoding", "data", "scatter-encoding"],
    ["shouldShowConnectNullsThreshold", "data", "connect-nulls-threshold"],
  ] as const)("%s drives %s/%s", async (helper, section, option) => {
    const utils: any = await import("@/utils/dashboard/configUtils");
    expect(makeComposable().isConfigOptionVisible(section, option)).toBe(false);
    vi.mocked(utils[helper]).mockReturnValue(true);
    expect(makeComposable().isConfigOptionVisible(section, option)).toBe(true);
    vi.mocked(utils[helper]).mockReturnValue(false);
  });
});

describe("useConfigPanel – metric, gauge, pie, table, heatmap, state timeline and geomap options", () => {
  const visible = (type: string, section: any, option: string, config = {}, promql = false) =>
    makeComposable(makePanelData(type, config), ref(promql)).isConfigOptionVisible(section, option);

  it("shows each option on its own chart type only", () => {
    expect(visible("metric", "metric", "stat-text-mode")).toBe(true);
    expect(visible("bar", "metric", "stat-text-mode")).toBe(false);
    expect(visible("gauge", "gauge", "gauge-style")).toBe(true);
    expect(visible("pie", "pie", "pie-other-threshold")).toBe(true);
    expect(visible("pie", "pie", "donut-inner-radius")).toBe(false);
    expect(visible("donut", "pie", "donut-inner-radius")).toBe(true);
    expect(visible("heatmap", "data", "heatmap-cells")).toBe(true);
    expect(visible("state-timeline", "stateTimeline", "state-value-align")).toBe(true);
    expect(visible("geomap", "map", "map-cluster")).toBe(true);
    expect(visible("maps", "map", "map-cluster")).toBe(false);
  });

  it("keeps footer calculations to SQL tables", () => {
    expect(visible("table", "table", "table-footer-calcs")).toBe(true);
    expect(visible("table", "table", "table-footer-calcs", {}, true)).toBe(false);
    expect(visible("table", "table", "table-density", {}, true)).toBe(true);
  });

  it("shows thresholds on a SQL table once a column is a bar gauge", () => {
    const table = (overrides: any[], queryType = "sql") => ({
      data: { type: "table", queryType, config: { override_config: overrides } },
    });
    const barGauge = {
      field: { matchBy: "name", value: "latency" },
      config: [{ type: "field_type", value: "bar_gauge" }],
    };
    expect(shouldShowThresholds(table([]))).toBe(false);
    expect(shouldShowThresholds(table([barGauge]))).toBe(true);
    expect(shouldShowThresholds(table([barGauge], "promql"))).toBe(false);
  });
});

describe("useConfigPanel – bar gauge options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows the bar gauge options on the bar gauge only", () => {
    expect(visible("bar-gauge", "gauge", "bar-gauge-range-mode")).toBe(true);
    expect(visible("gauge", "gauge", "bar-gauge-range-mode")).toBe(false);
    expect(visible("bar-gauge", "gauge", "gauge-min")).toBe(false);
    const fixed = makePanelData("bar-gauge", {}, { config: { range_mode: "fixed" } });
    expect(makeComposable(fixed, ref(false)).isConfigOptionVisible("gauge", "gauge-min")).toBe(
      true,
    );
    expect(visible("bar-gauge", "gauge", "bar-gauge-mode")).toBe(true);
    expect(visible("bar-gauge", "gauge", "gauge-style")).toBe(false);
    expect(visible("gauge", "gauge", "bar-gauge-orientation")).toBe(false);
  });

  it("shows thresholds and series overrides on the bar gauge", () => {
    expect(shouldShowThresholds({ data: { type: "bar-gauge", config: {} } })).toBe(true);
    expect(shouldShowSeriesOverrides({ data: { type: "bar-gauge" } })).toBe(true);
  });
});
describe("useConfigPanel – distribution options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows the bucket settings on distribution only", () => {
    expect(visible("distribution", "data", "distribution-buckets")).toBe(true);
    expect(visible("heatmap", "data", "distribution-buckets")).toBe(false);
  });
});
describe("useConfigPanel – state timeline display", () => {
  const visible = (config: any, option: string) =>
    makeComposable(makePanelData("state-timeline", config), ref(false)).isConfigOptionVisible(
      "stateTimeline",
      option,
    );

  it("offers the display choice on state timeline only", () => {
    expect(visible({}, "display")).toBe(true);
    expect(
      makeComposable(makePanelData("line", {}), ref(false)).isConfigOptionVisible(
        "stateTimeline",
        "display",
      ),
    ).toBe(false);
  });

  it("hides merge gaps in cells mode, where every bucket is its own cell", () => {
    expect(visible({}, "merge-gaps")).toBe(true);
    expect(visible({ state_timeline_display: "cells" }, "merge-gaps")).toBe(false);
  });
});
describe("useConfigPanel – sunburst options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows the label switch on sunburst only", () => {
    expect(visible("sunburst", "data", "sunburst-labels")).toBe(true);
    expect(visible("pie", "data", "sunburst-labels")).toBe(false);
  });

  it("shows no thresholds or series overrides on sunburst", () => {
    expect(shouldShowThresholds({ data: { type: "sunburst", config: {} } })).toBe(false);
    expect(shouldShowSeriesOverrides({ data: { type: "sunburst" } })).toBe(false);
  });
});
describe("useConfigPanel – funnel options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows each option on its own chart type only", () => {
    for (const option of ["funnel-sort", "funnel-orient", "funnel-show-percent"]) {
      expect(visible("funnel", "data", option), option).toBe(true);
      expect(visible("pie", "data", option), option).toBe(false);
    }
  });

  it("shows no thresholds or series overrides on a funnel", () => {
    expect(shouldShowThresholds({ data: { type: "funnel", config: {} } })).toBe(false);
    expect(shouldShowSeriesOverrides({ data: { type: "funnel" } })).toBe(false);
  });
});
describe("useConfigPanel – node graph options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows each option on its own chart type only", () => {
    expect(visible("node-graph", "data", "node-graph-layout")).toBe(true);
    expect(visible("node-graph", "data", "node-graph-edge-labels")).toBe(true);
    expect(visible("sankey", "data", "node-graph-layout")).toBe(false);
  });

  it("shows no thresholds or series overrides on a node graph", () => {
    expect(shouldShowThresholds({ data: { type: "node-graph", config: {} } })).toBe(false);
    expect(shouldShowSeriesOverrides({ data: { type: "node-graph" } })).toBe(false);
  });
});

describe("useConfigPanel – sparkline search visibility", () => {
  it("drops the sparkline option for an all-instant PromQL metric only", async () => {
    const { allVisibleQueriesInstant } = await import("@/utils/dashboard/configUtils");
    const metric = (queryType: string) => ({
      ...makePanelData("metric"),
      data: { ...makePanelData("metric").data, queryType },
    });
    vi.mocked(allVisibleQueriesInstant).mockReturnValue(true);
    expect(makeComposable(metric("promql")).isConfigOptionVisible("sparkline", "sparkline")).toBe(
      false,
    );
    expect(makeComposable(metric("sql")).isConfigOptionVisible("sparkline", "sparkline")).toBe(
      true,
    );
    vi.mocked(allVisibleQueriesInstant).mockReturnValue(false);
    expect(makeComposable(metric("promql")).isConfigOptionVisible("sparkline", "sparkline")).toBe(
      true,
    );
  });
});

describe("useConfigPanel – treemap options", () => {
  const visible = (type: string, section: any, option: string) =>
    makeComposable(makePanelData(type, {}), ref(false)).isConfigOptionVisible(section, option);

  it("shows the breadcrumb option on a treemap only, and no thresholds", () => {
    expect(visible("treemap", "data", "treemap-breadcrumb")).toBe(true);
    expect(visible("pie", "data", "treemap-breadcrumb")).toBe(false);
    expect(shouldShowThresholds({ data: { type: "treemap", config: {} } })).toBe(false);
  });
});
