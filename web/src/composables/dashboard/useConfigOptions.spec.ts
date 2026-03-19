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
import { ref, computed } from "vue";
import { useConfigOptions } from "./useConfigOptions";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    // Return the key so assertions can just check the i18n key name
    t: (key: string) => key,
  }),
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
      ...configOverrides,
    },
  },
  layout: { currentQueryIndex: 0 },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useConfigOptions", () => {
  const promqlMode = ref(false);
  const showTrellisConfig = computed(() => false);
  const showColorPalette = computed(() => false);

  const getOptions = (
    panelData = makePanelData(),
    pMode = ref(false),
    trellisConfig = computed(() => false),
    colorPalette = computed(() => false),
    isPivotMode = computed(() => false),
  ) => {
    const { configOptions } = useConfigOptions(
      panelData,
      pMode,
      "dashboard",
      trellisConfig,
      colorPalette,
      isPivotMode,
    );
    return configOptions.value;
  };

  beforeEach(() => {
    promqlMode.value = false;
  });

  // -------------------------------------------------------------------------
  // Structure
  // -------------------------------------------------------------------------

  describe("structure", () => {
    it("returns all 20 top-level section keys", () => {
      const opts = getOptions();
      const expectedSections = [
        "general",
        "promqlTable",
        "geographic",
        "legend",
        "data",
        "axis",
        "labels",
        "lineStyle",
        "table",
        "pivotTable",
        "valueTransformations",
        "fieldOverrides",
        "map",
        "gauge",
        "layout",
        "colors",
        "drilldown",
        "comparison",
        "markLines",
        "background",
      ];
      for (const section of expectedSections) {
        expect(opts).toHaveProperty(section);
      }
    });

    it("each section is an object with at least one option key", () => {
      const opts = getOptions();
      for (const section of Object.values(opts)) {
        expect(typeof section).toBe("object");
        expect(Object.keys(section as object).length).toBeGreaterThan(0);
      }
    });

    it("every option has a label property", () => {
      const opts = getOptions();
      for (const section of Object.values(opts)) {
        for (const option of Object.values(section as Record<string, any>)) {
          expect(option).toHaveProperty("label");
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // general section
  // -------------------------------------------------------------------------

  describe("general section", () => {
    it("description option exists with correct i18n key", () => {
      const opts = getOptions();
      expect(opts.general.description.label).toBe("dashboard.description");
    });

    it("step is hidden when promqlMode is false", () => {
      const opts = getOptions(makePanelData(), ref(false));
      expect(opts.general.step.visible).toBe(false);
    });

    it("step is visible when promqlMode is true", () => {
      const opts = getOptions(makePanelData(), ref(true));
      expect(opts.general.step.visible).toBe(true);
    });

    it("promql-chart-config is visible for promqlMode + non-geomap type", () => {
      const opts = getOptions(makePanelData("bar"), ref(true));
      expect(opts.general["promql-chart-config"].visible).toBe(true);
    });

    it("promql-chart-config is hidden for geomap type even with promqlMode", () => {
      const opts = getOptions(makePanelData("geomap"), ref(true));
      expect(opts.general["promql-chart-config"].visible).toBe(false);
    });

    it("promql-chart-config is hidden when promqlMode is false", () => {
      const opts = getOptions(makePanelData("bar"), ref(false));
      expect(opts.general["promql-chart-config"].visible).toBe(false);
    });

    it("panel-default-time option exists", () => {
      const opts = getOptions();
      expect(opts.general["panel-default-time"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // geographic section
  // -------------------------------------------------------------------------

  describe("geographic section", () => {
    it("geographic-config is hidden for non-map types in promqlMode", () => {
      const opts = getOptions(makePanelData("bar"), ref(true));
      expect(opts.geographic["geographic-config"].visible).toBe(false);
    });

    it("geographic-config is visible for geomap type in promqlMode", () => {
      const opts = getOptions(makePanelData("geomap"), ref(true));
      expect(opts.geographic["geographic-config"].visible).toBe(true);
    });

    it("geographic-config is visible for maps type in promqlMode", () => {
      const opts = getOptions(makePanelData("maps"), ref(true));
      expect(opts.geographic["geographic-config"].visible).toBe(true);
    });

    it("geographic-config is hidden when promqlMode is false", () => {
      const opts = getOptions(makePanelData("geomap"), ref(false));
      expect(opts.geographic["geographic-config"].visible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // data section
  // -------------------------------------------------------------------------

  describe("data section", () => {
    it("unit option always exists", () => {
      const opts = getOptions();
      expect(opts.data.unit).toBeDefined();
    });

    it("custom-unit is hidden when unit is not 'custom'", () => {
      const opts = getOptions(makePanelData("bar", { unit: "bytes" }));
      expect(opts.data["custom-unit"].visible).toBe(false);
    });

    it("custom-unit is visible when unit is 'custom'", () => {
      const opts = getOptions(makePanelData("bar", { unit: "custom" }));
      expect(opts.data["custom-unit"].visible).toBe(true);
    });

    it("limit is hidden when promqlMode is true", () => {
      const opts = getOptions(makePanelData("bar"), ref(true));
      expect(opts.data.limit.visible).toBe(false);
    });

    it("limit is hidden when customQuery is true", () => {
      const opts = getOptions(
        makePanelData("bar", {}, { customQuery: true }),
        ref(false),
      );
      expect(opts.data.limit.visible).toBe(false);
    });

    it("limit is visible when promqlMode=false and customQuery=false", () => {
      const opts = getOptions(makePanelData("bar"), ref(false));
      expect(opts.data.limit.visible).toBe(true);
    });

    it("decimals option always exists", () => {
      const opts = getOptions();
      expect(opts.data.decimals).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // table section
  // -------------------------------------------------------------------------

  describe("table section", () => {
    it("wrap is hidden for non-table types", () => {
      const opts = getOptions(makePanelData("bar"));
      expect(opts.table.wrap.visible).toBe(false);
    });

    it("wrap is visible for table type", () => {
      const opts = getOptions(makePanelData("table"));
      expect(opts.table.wrap.visible).toBe(true);
    });

    it("transpose is hidden in promqlMode even for table type", () => {
      const opts = getOptions(makePanelData("table"), ref(true));
      expect(opts.table.transpose.visible).toBe(false);
    });

    it("transpose is visible for table type in sql mode", () => {
      const opts = getOptions(makePanelData("table"), ref(false));
      expect(opts.table.transpose.visible).toBe(true);
    });

    it("pagination is hidden for non-table types", () => {
      const opts = getOptions(makePanelData("bar"));
      expect(opts.table.pagination.visible).toBe(false);
    });

    it("pagination is visible for table type", () => {
      const opts = getOptions(makePanelData("table"));
      expect(opts.table.pagination.visible).toBe(true);
    });

    it("rows-per-page is hidden when pagination is disabled", () => {
      const opts = getOptions(
        makePanelData("table", { table_pagination: false }),
      );
      expect(opts.table["rows-per-page"].visible).toBe(false);
    });

    it("rows-per-page is visible when pagination is enabled for table type", () => {
      const opts = getOptions(
        makePanelData("table", { table_pagination: true }),
      );
      expect(opts.table["rows-per-page"].visible).toBe(true);
    });

    it("dynamic-columns is hidden when promqlMode is true", () => {
      const opts = getOptions(makePanelData("table"), ref(true));
      expect(opts.table["dynamic-columns"].visible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // map section
  // -------------------------------------------------------------------------

  describe("map section", () => {
    it("map-config is hidden for non-map types", () => {
      const opts = getOptions(makePanelData("bar"));
      expect(opts.map["map-config"].visible).toBe(false);
    });

    it("map-config is visible for geomap type", () => {
      const opts = getOptions(makePanelData("geomap"));
      expect(opts.map["map-config"].visible).toBe(true);
    });

    it("map-config is visible for maps type", () => {
      const opts = getOptions(makePanelData("maps"));
      expect(opts.map["map-config"].visible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // gauge section
  // -------------------------------------------------------------------------

  describe("gauge section", () => {
    it("gauge-min and gauge-max are hidden for non-gauge types", () => {
      const opts = getOptions(makePanelData("bar"));
      expect(opts.gauge["gauge-min"].visible).toBe(false);
      expect(opts.gauge["gauge-max"].visible).toBe(false);
    });

    it("gauge-min and gauge-max are visible for gauge type", () => {
      const opts = getOptions(makePanelData("gauge"));
      expect(opts.gauge["gauge-min"].visible).toBe(true);
      expect(opts.gauge["gauge-max"].visible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // layout section
  // -------------------------------------------------------------------------

  describe("layout section", () => {
    it("trellis-layout is hidden when showTrellisConfig is false", () => {
      const opts = getOptions(
        makePanelData(),
        ref(false),
        computed(() => false),
      );
      expect(opts.layout["trellis-layout"].visible).toBe(false);
    });

    it("trellis-layout is visible when showTrellisConfig is true", () => {
      const opts = getOptions(
        makePanelData(),
        ref(false),
        computed(() => true),
      );
      expect(opts.layout["trellis-layout"].visible).toBe(true);
    });

    it("trellis-columns is hidden when layout is not 'custom'", () => {
      const opts = getOptions(
        makePanelData("bar", { trellis: { layout: "auto" } }),
        ref(false),
        computed(() => true),
      );
      expect(opts.layout["trellis-columns"].visible).toBe(false);
    });

    it("trellis-columns is visible when showTrellis and layout is 'custom'", () => {
      const opts = getOptions(
        makePanelData("bar", { trellis: { layout: "custom" } }),
        ref(false),
        computed(() => true),
      );
      expect(opts.layout["trellis-columns"].visible).toBe(true);
    });

    it("trellis-group-by is hidden when trellis layout is null", () => {
      const opts = getOptions(
        makePanelData("bar", { trellis: { layout: null } }),
        ref(false),
        computed(() => true),
      );
      expect(opts.layout["trellis-group-by"].visible).toBe(false);
    });

    it("trellis-group-by is visible when showTrellis and layout is non-null", () => {
      const opts = getOptions(
        makePanelData("bar", { trellis: { layout: "auto" } }),
        ref(false),
        computed(() => true),
      );
      expect(opts.layout["trellis-group-by"].visible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // colors section
  // -------------------------------------------------------------------------

  describe("colors section", () => {
    it("colors is hidden when showColorPalette is false", () => {
      const opts = getOptions(
        makePanelData(),
        ref(false),
        computed(() => false),
        computed(() => false),
      );
      expect(opts.colors.colors.visible).toBe(false);
    });

    it("colors is visible when showColorPalette is true", () => {
      const opts = getOptions(
        makePanelData(),
        ref(false),
        computed(() => false),
        computed(() => true),
      );
      expect(opts.colors.colors.visible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // background section
  // -------------------------------------------------------------------------

  describe("background section", () => {
    it("background is hidden for non-metric types", () => {
      const opts = getOptions(makePanelData("bar"));
      expect(opts.background.background.visible).toBe(false);
    });

    it("background is visible for metric type", () => {
      const opts = getOptions(makePanelData("metric"));
      expect(opts.background.background.visible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // legend section — array label
  // -------------------------------------------------------------------------

  describe("legend section", () => {
    it("legend-size has an array label", () => {
      const opts = getOptions();
      expect(Array.isArray(opts.legend["legend-size"].label)).toBe(true);
    });

    it("promql-legend is hidden when promqlMode is false", () => {
      const opts = getOptions(makePanelData(), ref(false));
      expect(opts.legend["promql-legend"].visible).toBe(false);
    });

    it("promql-legend is visible for promqlMode + non-geomap type", () => {
      const opts = getOptions(makePanelData("bar"), ref(true));
      expect(opts.legend["promql-legend"].visible).toBe(true);
    });

    it("promql-legend is hidden for maps type even in promqlMode", () => {
      const opts = getOptions(makePanelData("maps"), ref(true));
      expect(opts.legend["promql-legend"].visible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // configUtils delegation
  // -------------------------------------------------------------------------

  describe("configUtils delegation", () => {
    it("axis-width.visible reflects shouldShowAxisConfig result", async () => {
      const { shouldShowAxisConfig } = await import(
        "@/utils/dashboard/configUtils"
      );
      (shouldShowAxisConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        true,
      );
      const opts = getOptions();
      expect(opts.axis["axis-width"].visible).toBe(true);
    });

    it("gridlines.visible reflects shouldShowGridlines result", async () => {
      const { shouldShowGridlines } = await import(
        "@/utils/dashboard/configUtils"
      );
      (shouldShowGridlines as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        true,
      );
      const opts = getOptions();
      expect(opts.axis.gridlines.visible).toBe(true);
    });

    it("symbol.visible reflects shouldShowAreaLineStyleConfig result", async () => {
      const { shouldShowAreaLineStyleConfig } = await import(
        "@/utils/dashboard/configUtils"
      );
      // The function is called multiple times in the computed (connect-nulls, symbol, interpolation)
      // so use mockReturnValue (not Once) to ensure all calls return true
      (
        shouldShowAreaLineStyleConfig as ReturnType<typeof vi.fn>
      ).mockReturnValue(true);
      const opts = getOptions();
      expect(opts.lineStyle.symbol.visible).toBe(true);
      // Restore default
      (
        shouldShowAreaLineStyleConfig as ReturnType<typeof vi.fn>
      ).mockReturnValue(false);
    });
  });
});
