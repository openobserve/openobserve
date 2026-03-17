import { describe, it, expect, beforeEach, vi } from "vitest";
import { reactive } from "vue";
import { usePanelAggregation } from "./usePanelAggregation";

const DEFAULT_CUSTOM_CHART_TEXT = "option = {};";
const getDefaultCustomChartText = vi.fn(() => DEFAULT_CUSTOM_CHART_TEXT);

const makeDefaultQuery = (overrides: any = {}) => ({
  query: "",
  customQuery: false,
  fields: {
    stream: "test_stream",
    stream_type: "logs",
    x: [] as any[],
    y: [] as any[],
    z: [] as any[],
    breakdown: [] as any[],
    filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
    latitude: null,
    longitude: null,
    weight: null,
    name: null,
    value_for_maps: null,
    source: null,
    target: null,
    value: null,
    promql_labels: [],
  },
  config: {
    time_shift: [],
    limit: 0,
  },
  ...overrides,
});

const makePanelData = (type = "bar", queryType = "sql") =>
  reactive({
    data: {
      type,
      queryType,
      htmlContent: "html",
      markdownContent: "markdown",
      customChartContent: "custom",
      queries: [makeDefaultQuery()],
    },
    layout: {
      currentQueryIndex: 0,
    },
  });

const makeAggregation = (panelData: any) =>
  usePanelAggregation({
    dashboardPanelData: panelData,
    getDefaultQueries: () => [makeDefaultQuery()],
    getDefaultCustomChartText,
  });

describe("usePanelAggregation", () => {
  describe("resetAggregationFunction", () => {
    it("returns early without changes when queryType is promql", () => {
      const panelData = makePanelData("bar", "promql");
      panelData.data.htmlContent = "some html";
      const { resetAggregationFunction } = makeAggregation(panelData);
      resetAggregationFunction();
      // no mutation should have happened
      expect(panelData.data.htmlContent).toBe("some html");
    });

    // ── heatmap ──────────────────────────────────────────────────────────

    describe("heatmap chart type", () => {
      let panelData: ReturnType<typeof makePanelData>;

      beforeEach(() => {
        panelData = makePanelData("heatmap");
        panelData.data.queries[0].fields.y = [
          { functionName: "count", args: [{ type: "field" }, { type: "extra" }] },
        ];
        panelData.data.queries[0].fields.breakdown = [{ alias: "bd1" }];
      });

      it("sets y functionName to null", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.y[0].functionName).toBeNull();
      });

      it("trims y args to first element only", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.y[0].args).toHaveLength(1);
      });

      it("clears breakdown array", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.breakdown).toHaveLength(0);
      });

      it("truncates to first query for sql queryType", () => {
        panelData.data.queries.push(makeDefaultQuery());
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(1);
      });

      it("clears htmlContent and markdownContent", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.htmlContent).toBe("");
        expect(panelData.data.markdownContent).toBe("");
      });

      it("resets customChartContent to default text", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.customChartContent).toBe(DEFAULT_CUSTOM_CHART_TEXT);
      });

      it("limits x and y to one field each", () => {
        panelData.data.queries[0].fields.x = [
          { alias: "x1" },
          { alias: "x2" },
        ];
        panelData.data.queries[0].fields.y = [
          { functionName: null, args: [] },
          { functionName: null, args: [] },
        ];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(1);
        expect(panelData.data.queries[0].fields.y).toHaveLength(1);
      });

      it("clears geo/map fields in all queries", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        const q = panelData.data.queries[0];
        expect(q.fields.latitude).toBeNull();
        expect(q.fields.longitude).toBeNull();
        expect(q.fields.weight).toBeNull();
      });
    });

    // ── bar / line / area / scatter / stacked variants ────────────────────

    describe.each(["bar", "line", "area", "scatter", "area-stacked", "stacked", "h-stacked", "h-bar"])(
      "%s chart type",
      (chartType) => {
        let panelData: ReturnType<typeof makePanelData>;

        beforeEach(() => {
          panelData = makePanelData(chartType);
          panelData.data.queries[0].fields.y = [
            { functionName: null, isDerived: false, args: [{ type: "field" }] },
          ];
        });

        it("sets y functionName to count when null and not derived", () => {
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.y[0].functionName).toBe("count");
        });

        it("clears z axis", () => {
          panelData.data.queries[0].fields.z = [{ alias: "z1" }];
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.z).toHaveLength(0);
        });

        it("moves second x field to breakdown when breakdown is empty", () => {
          panelData.data.queries[0].fields.x = [{ alias: "x1" }, { alias: "x2" }];
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.x).toHaveLength(1);
          expect(panelData.data.queries[0].fields.breakdown).toHaveLength(1);
        });

        it("keeps existing breakdown and just truncates x when breakdown is non-empty", () => {
          panelData.data.queries[0].fields.x = [{ alias: "x1" }, { alias: "x2" }];
          panelData.data.queries[0].fields.breakdown = [{ alias: "bd1" }];
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.x).toHaveLength(1);
          expect(panelData.data.queries[0].fields.breakdown).toHaveLength(1);
        });

        it("does not change y functionName if already set", () => {
          panelData.data.queries[0].fields.y[0].functionName = "sum";
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.y[0].functionName).toBe("sum");
        });
      },
    );

    // ── table ─────────────────────────────────────────────────────────────

    describe("table chart type", () => {
      let panelData: ReturnType<typeof makePanelData>;

      beforeEach(() => {
        panelData = makePanelData("table");
        panelData.data.queries[0].fields.y = [
          { functionName: null, isDerived: false, args: [{ type: "field" }] },
        ];
      });

      it("sets y functionName to count when null and not derived", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.y[0].functionName).toBe("count");
      });

      it("clears z and breakdown fields", () => {
        panelData.data.queries[0].fields.z = [{ alias: "z1" }];
        panelData.data.queries[0].fields.breakdown = [{ alias: "bd1" }];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.z).toHaveLength(0);
        expect(panelData.data.queries[0].fields.breakdown).toHaveLength(0);
      });
    });

    // ── pie / donut / gauge ────────────────────────────────────────────────

    describe.each(["pie", "donut", "gauge"])("%s chart type", (chartType) => {
      let panelData: ReturnType<typeof makePanelData>;

      beforeEach(() => {
        panelData = makePanelData(chartType);
        panelData.data.queries[0].fields.y = [
          { functionName: null, isDerived: false, args: [{ type: "field" }] },
        ];
      });

      it("sets y functionName to count when null and not derived", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.y[0].functionName).toBe("count");
      });

      it("clears breakdown and z", () => {
        panelData.data.queries[0].fields.breakdown = [{ alias: "bd1" }];
        panelData.data.queries[0].fields.z = [{ alias: "z1" }];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.breakdown).toHaveLength(0);
        expect(panelData.data.queries[0].fields.z).toHaveLength(0);
      });

      it("limits x and y to single field", () => {
        panelData.data.queries[0].fields.x = [{ alias: "x1" }, { alias: "x2" }];
        panelData.data.queries[0].fields.y = [
          { functionName: null, isDerived: false, args: [] },
          { functionName: null, isDerived: false, args: [] },
        ];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(1);
        expect(panelData.data.queries[0].fields.y).toHaveLength(1);
      });
    });

    // ── metric ─────────────────────────────────────────────────────────────

    describe("metric chart type", () => {
      let panelData: ReturnType<typeof makePanelData>;

      beforeEach(() => {
        panelData = makePanelData("metric");
        panelData.data.queries[0].fields.x = [{ alias: "x1" }, { alias: "x2" }];
        panelData.data.queries[0].fields.y = [
          { functionName: null, isDerived: false, args: [] },
          { functionName: null, isDerived: false, args: [] },
        ];
      });

      it("removes all x axis fields", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(0);
      });

      it("limits y to single field", () => {
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.y).toHaveLength(1);
      });
    });

    // ── geomap ─────────────────────────────────────────────────────────────

    describe("geomap chart type", () => {
      it("clears x, y, z, breakdown, and map-specific fields", () => {
        const panelData = makePanelData("geomap");
        panelData.data.queries[0].fields.x = [{ alias: "x1" }];
        panelData.data.queries[0].fields.y = [{ functionName: "count", args: [] }];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(0);
        expect(panelData.data.queries[0].fields.y).toHaveLength(0);
        expect(panelData.data.queries[0].fields.z).toHaveLength(0);
        expect(panelData.data.queries[0].fields.breakdown).toHaveLength(0);
      });
    });

    // ── html / markdown / custom_chart ─────────────────────────────────────

    describe.each(["html", "markdown", "custom_chart"])(
      "%s chart type",
      (chartType) => {
        it("preserves stream and stream_type, resets queries to default", () => {
          const panelData = makePanelData(chartType);
          panelData.data.queries[0].fields.stream = "keep_stream";
          panelData.data.queries[0].fields.stream_type = "metrics";
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queries[0].fields.stream).toBe("keep_stream");
          expect(panelData.data.queries[0].fields.stream_type).toBe("metrics");
        });

        it("sets queryType to empty string", () => {
          const panelData = makePanelData(chartType);
          const { resetAggregationFunction } = makeAggregation(panelData);
          resetAggregationFunction();
          expect(panelData.data.queryType).toBe("");
        });
      },
    );

    // ── maps ───────────────────────────────────────────────────────────────

    describe("maps chart type", () => {
      it("clears x, y, z, breakdown and geo fields", () => {
        const panelData = makePanelData("maps");
        panelData.data.queries[0].fields.x = [{ alias: "x1" }];
        panelData.data.queries[0].fields.y = [{ functionName: "count", args: [] }];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(0);
        expect(panelData.data.queries[0].fields.y).toHaveLength(0);
        expect(panelData.data.queries[0].fields.latitude).toBeNull();
        expect(panelData.data.queries[0].fields.longitude).toBeNull();
        expect(panelData.data.queries[0].fields.weight).toBeNull();
      });
    });

    // ── sankey ─────────────────────────────────────────────────────────────

    describe("sankey chart type", () => {
      it("clears x, y, z, breakdown and resets filter", () => {
        const panelData = makePanelData("sankey");
        panelData.data.queries[0].fields.x = [{ alias: "x1" }];
        panelData.data.queries[0].fields.source = { alias: "src" };
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.x).toHaveLength(0);
        expect(panelData.data.queries[0].fields.filter.conditions).toHaveLength(0);
      });
    });
  });
});
