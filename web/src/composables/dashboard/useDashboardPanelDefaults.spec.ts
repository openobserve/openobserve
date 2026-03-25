import { describe, it, expect } from "vitest";
import {
  getDefaultDashboardPanelData,
  getDefaultCustomChartText,
} from "./useDashboardPanelDefaults";

const makeStore = (overrides: any = {}) => ({
  state: {
    zoConfig: {
      dashboard_show_symbol_enabled: true,
      timestamp_column: "_timestamp",
      ...overrides,
    },
  },
});

describe("getDefaultDashboardPanelData", () => {
  it("returns an object with data, layout, and meta sections", () => {
    const result = getDefaultDashboardPanelData(makeStore());
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("layout");
    expect(result).toHaveProperty("meta");
  });

  describe("data section", () => {
    it("initializes type as bar", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.type).toBe("bar");
    });

    it("initializes queryType as sql", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.queryType).toBe("sql");
    });

    it("initializes id and title as empty strings", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.id).toBe("");
      expect(data.title).toBe("");
    });

    it("initializes version as 5", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.version).toBe(5);
    });

    it("initializes with one default query", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.queries).toHaveLength(1);
    });

    it("initializes default query with empty stream and logs type", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.queries[0].fields.stream).toBe("");
      expect(data.queries[0].fields.stream_type).toBe("logs");
    });

    it("initializes query fields with empty x, y, z arrays", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      const fields = data.queries[0].fields;
      expect(fields.x).toEqual([]);
      expect(fields.y).toEqual([]);
      expect(fields.z).toEqual([]);
      expect(fields.breakdown).toEqual([]);
    });
  });

  describe("config section", () => {
    it("sets table_pagination to false", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.table_pagination).toBe(false);
    });

    it("sets table_pagination_rows_per_page to null", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.table_pagination_rows_per_page).toBeNull();
    });

    it("sets show_gridlines to true", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.show_gridlines).toBe(true);
    });

    it("sets show_legends to true", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.show_legends).toBe(true);
    });

    it("sets decimals to 2", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.decimals).toBe(2);
    });

    it("sets line_thickness to 1.5", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.line_thickness).toBe(1.5);
    });

    it("uses dashboard_show_symbol_enabled from store for show_symbol", () => {
      const storeTrue = makeStore({ dashboard_show_symbol_enabled: true });
      const storeFalse = makeStore({ dashboard_show_symbol_enabled: false });
      expect(getDefaultDashboardPanelData(storeTrue).data.config.show_symbol).toBe(true);
      expect(getDefaultDashboardPanelData(storeFalse).data.config.show_symbol).toBe(false);
    });

    it("defaults show_symbol to false when store is null", () => {
      const { data } = getDefaultDashboardPanelData(null);
      expect(data.config.show_symbol).toBe(false);
    });

    it("sets color config with palette-classic-by-series mode", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.color.mode).toBe("palette-classic-by-series");
    });

    it("sets trellis with default layout null and 1 column", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.trellis.layout).toBeNull();
      expect(data.config.trellis.num_of_columns).toBe(1);
    });

    it("initializes drilldown, mark_line and override_config as empty arrays", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.drilldown).toEqual([]);
      expect(data.config.mark_line).toEqual([]);
      expect(data.config.override_config).toEqual([]);
    });

    it("sets aggregation to last", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.aggregation).toBe("last");
    });

    it("sets map_view with zoom=1, lat=0, lng=0", () => {
      const { data } = getDefaultDashboardPanelData(makeStore());
      expect(data.config.map_view).toEqual({ zoom: 1, lat: 0, lng: 0 });
    });
  });

  describe("layout section", () => {
    it("initializes splitter to 20", () => {
      const { layout } = getDefaultDashboardPanelData(makeStore());
      expect(layout.splitter).toBe(20);
    });

    it("initializes showQueryBar to true", () => {
      const { layout } = getDefaultDashboardPanelData(makeStore());
      expect(layout.showQueryBar).toBe(true);
    });

    it("initializes currentQueryIndex to 0", () => {
      const { layout } = getDefaultDashboardPanelData(makeStore());
      expect(layout.currentQueryIndex).toBe(0);
    });

    it("initializes hiddenQueries as empty array", () => {
      const { layout } = getDefaultDashboardPanelData(makeStore());
      expect(layout.hiddenQueries).toEqual([]);
    });
  });

  describe("meta section", () => {
    it("initializes dragAndDrop with dragging=false", () => {
      const { meta } = getDefaultDashboardPanelData(makeStore());
      expect(meta.dragAndDrop.dragging).toBe(false);
    });

    it("initializes errors.queryErrors as empty array", () => {
      const { meta } = getDefaultDashboardPanelData(makeStore());
      expect(meta.errors.queryErrors).toEqual([]);
    });

    it("initializes stream fields as empty", () => {
      const { meta } = getDefaultDashboardPanelData(makeStore());
      expect(meta.stream.selectedStreamFields).toEqual([]);
      expect(meta.stream.interestingFieldList).toEqual([]);
    });

    it("initializes promql with empty availableLabels and empty labelValuesMap", () => {
      const { meta } = getDefaultDashboardPanelData(makeStore());
      expect(meta.promql.availableLabels).toEqual([]);
      expect(meta.promql.labelValuesMap).toBeInstanceOf(Map);
      expect(meta.promql.labelValuesMap.size).toBe(0);
    });
  });

  it("returns distinct objects on each call (no shared references)", () => {
    const result1 = getDefaultDashboardPanelData(makeStore());
    const result2 = getDefaultDashboardPanelData(makeStore());
    result1.data.title = "Modified";
    expect(result2.data.title).toBe("");
  });
});

describe("getDefaultCustomChartText", () => {
  it("returns a non-empty string", () => {
    const result = getDefaultCustomChartText();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("contains 'option =' for ECharts configuration", () => {
    const result = getDefaultCustomChartText();
    expect(result).toContain("option =");
  });

  it("references ECharts documentation", () => {
    const result = getDefaultCustomChartText();
    expect(result).toContain("echarts.apache.org");
  });

  it("returns the same value on repeated calls", () => {
    expect(getDefaultCustomChartText()).toBe(getDefaultCustomChartText());
  });
});
