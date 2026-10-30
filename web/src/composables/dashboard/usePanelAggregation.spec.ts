import { describe, it, expect, beforeEach, vi } from "vitest";
import { reactive } from "vue";
import {
  defaultFlameGraphPanelQuery,
  isPanelStarterQuery,
  usePanelAggregation,
} from "./usePanelAggregation";

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

    describe("state-timeline chart type", () => {
      it("drops a count y and keeps only the first other y, read with max", () => {
        const panelData = makePanelData("state-timeline");
        panelData.data.queries[0].fields.y = [
          { functionName: "count", args: [{ type: "field" }] },
          { functionName: null, args: [{ type: "field" }, { type: "extra" }] },
          { functionName: "min", args: [{ type: "field" }] },
        ];
        panelData.data.queries[0].config.time_shift = [{ offSet: "1h" }] as any;
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        const y = panelData.data.queries[0].fields.y;
        expect(y.map((item: any) => item.functionName)).toEqual(["max"]);
        expect(y[0].args).toHaveLength(1);
        expect(panelData.data.queries[0].config.time_shift).toEqual([]);
      });

      it("clears PromQL time shifts too, though PromQL keeps its fields", () => {
        const panelData = makePanelData("state-timeline", "promql");
        panelData.data.queries[0].config.time_shift = [{ offSet: "1h" }] as any;
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].config.time_shift).toEqual([]);
      });
    });

    describe("hostmap chart type", () => {
      it("drops a time-bucket entity, keeps one value and two group levels", () => {
        const panelData: any = makePanelData("hostmap");
        panelData.data.config = { color: { mode: "palette-classic-by-series", fixedColor: [] } };
        const query = panelData.data.queries[0];
        query.fields.x = [{ functionName: "histogram" }, { functionName: null, alias: "gpu" }];
        query.fields.y = [
          { functionName: null, args: [{ type: "field" }, { type: "extra" }] },
          { functionName: "avg", args: [{ type: "field" }] },
        ];
        query.fields.breakdown = [{ alias: "a" }, { alias: "b" }, { alias: "c" }];
        query.config.time_shift = [{ offSet: "1h" }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(query.fields.x).toEqual([{ functionName: null, alias: "gpu" }]);
        expect(query.fields.y.map((item: any) => item.functionName)).toEqual(["count"]);
        expect(query.fields.breakdown.map((item: any) => item.alias)).toEqual(["a", "b"]);
        expect(query.config.time_shift).toEqual([]);
        expect(panelData.data.config.color.mode).toBe("continuous-green-yellow-red");
      });

      it("keeps a value scale the panel already chose, and PromQL fields untouched", () => {
        const panelData: any = makePanelData("hostmap", "promql");
        panelData.data.config = { color: { mode: "continuous-temperature", fixedColor: ["#fff"] } };
        panelData.data.queries[0].fields.y = [{ functionName: "avg", args: [] }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(panelData.data.config.color.mode).toBe("continuous-temperature");
        expect(panelData.data.queries[0].fields.y).toHaveLength(1);
      });
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

      it("resets y functionName and clears breakdown on all queries in sql multi-query mode", () => {
        const q2 = makeDefaultQuery();
        q2.fields.y = [{ functionName: "sum", args: [{ type: "field" }] }];
        q2.fields.breakdown = [{ alias: "bd1" }];
        panelData.data.queries.push(q2);
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(2);
        expect(panelData.data.queries[1].fields.y[0].functionName).toBeNull();
        expect(panelData.data.queries[1].fields.breakdown).toHaveLength(0);
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
        panelData.data.queries[0].fields.x = [{ alias: "x1" }, { alias: "x2" }];
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

    describe.each([
      "bar",
      "line",
      "area",
      "scatter",
      "area-stacked",
      "stacked",
      "h-stacked",
      "h-bar",
    ])("%s chart type", (chartType) => {
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

      it("resets y functionName and clears z on all queries in sql multi-query mode", () => {
        const q2 = makeDefaultQuery();
        q2.fields.y = [{ functionName: null, isDerived: false, args: [{ type: "field" }] }];
        q2.fields.z = [{ alias: "z1" }];
        panelData.data.queries.push(q2);
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(2);
        expect(panelData.data.queries[1].fields.y[0].functionName).toBe("count");
        expect(panelData.data.queries[1].fields.z).toHaveLength(0);
      });
    });

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

      it("clears z field but preserves breakdown fields for pivot table mode", () => {
        panelData.data.queries[0].fields.z = [{ alias: "z1" }];
        panelData.data.queries[0].fields.breakdown = [{ alias: "bd1" }];
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].fields.z).toHaveLength(0);
        // breakdown is intentionally preserved for table type (used in pivot table mode)
        expect(panelData.data.queries[0].fields.breakdown).toHaveLength(1);
      });

      it("resets y functionName and clears z on all queries in sql multi-query mode", () => {
        const q2 = makeDefaultQuery();
        q2.fields.y = [{ functionName: null, isDerived: false, args: [{ type: "field" }] }];
        q2.fields.z = [{ alias: "z1" }];
        panelData.data.queries.push(q2);
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(2);
        expect(panelData.data.queries[1].fields.y[0].functionName).toBe("count");
        expect(panelData.data.queries[1].fields.z).toHaveLength(0);
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

      it("resets y functionName, clears z and breakdown on all queries in sql multi-query mode", () => {
        const q2 = makeDefaultQuery();
        q2.fields.y = [{ functionName: null, isDerived: false, args: [{ type: "field" }] }];
        q2.fields.z = [{ alias: "z1" }];
        q2.fields.breakdown = [{ alias: "bd1" }];
        panelData.data.queries.push(q2);
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(2);
        expect(panelData.data.queries[1].fields.y[0].functionName).toBe("count");
        expect(panelData.data.queries[1].fields.z).toHaveLength(0);
        expect(panelData.data.queries[1].fields.breakdown).toHaveLength(0);
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

      it("resets y functionName, clears z and breakdown on all queries in sql multi-query mode", () => {
        const q2 = makeDefaultQuery();
        q2.fields.y = [{ functionName: null, isDerived: false, args: [{ type: "field" }] }];
        q2.fields.z = [{ alias: "z1" }];
        q2.fields.breakdown = [{ alias: "bd1" }];
        panelData.data.queries.push(q2);
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(2);
        expect(panelData.data.queries[1].fields.y[0].functionName).toBe("count");
        expect(panelData.data.queries[1].fields.z).toHaveLength(0);
        expect(panelData.data.queries[1].fields.breakdown).toHaveLength(0);
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

    describe.each(["html", "markdown", "custom_chart"])("%s chart type", (chartType) => {
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

      it("resets currentQueryIndex to 0 (and preserves the active query's stream) when collapsing a multi-query layout", () => {
        // Reproduces the crash: on a multi-query chart with the SECOND tab
        // active, switching to a single-query type collapses queries via
        // getDefaultQueries(); the previously-active index (1) would then be
        // out of bounds and queries[currentQueryIndex] reads would throw.
        const panelData = makePanelData(chartType);
        panelData.data.queries = [makeDefaultQuery(), makeDefaultQuery()];
        panelData.data.queries[0].fields.stream = "first";
        panelData.data.queries[1].fields.stream = "second";
        panelData.data.queries[1].fields.stream_type = "metrics";
        panelData.layout.currentQueryIndex = 1;

        const { resetAggregationFunction } = makeAggregation(panelData);
        expect(() => resetAggregationFunction()).not.toThrow();

        expect(panelData.layout.currentQueryIndex).toBe(0);
        expect(panelData.data.queries).toHaveLength(1);
        // the active query's stream/type are carried onto the single query
        expect(panelData.data.queries[0].fields.stream).toBe("second");
        expect(panelData.data.queries[0].fields.stream_type).toBe("metrics");
      });
    });

    // custom_chart always uses a hand-written (custom) query, so resetting to it
    // must put the query in custom mode (otherwise the query editor is read-only).
    describe("custom_chart custom-query mode", () => {
      it("sets the query to custom mode (customQuery=true)", () => {
        const panelData = makePanelData("custom_chart");
        panelData.data.queries[0].customQuery = false;
        const { resetAggregationFunction } = makeAggregation(panelData);
        resetAggregationFunction();
        expect(panelData.data.queries[0].customQuery).toBe(true);
      });
    });

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

      it("node graph clears the x/y slots like a sankey", () => {
        const panelData = makePanelData("node-graph");
        const fields = panelData.data.queries[0].fields;
        fields.x = [{ alias: "x1" }];
        fields.y = [{ alias: "y1", functionName: "count" }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.x).toEqual([]);
        expect(fields.y).toEqual([]);
      });
    });

    describe("bar gauge chart type", () => {
      const yField = (functionName: string | null) => ({
        functionName,
        args: [{ type: "field" }, { type: "extra" }],
      });

      it("resets like a gauge", () => {
        const panelData = makePanelData("bar-gauge");
        const fields = panelData.data.queries[0].fields;
        fields.x = [{ alias: "x1" }, { alias: "x2" }];
        fields.y = [yField("avg"), yField("sum")];
        fields.breakdown = [{ alias: "b1" }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.x).toHaveLength(1);
        expect(fields.y).toHaveLength(1);
        expect(fields.breakdown).toEqual([]);
      });
    });
    describe("distribution", () => {
      const yField = (functionName: string | null) => ({
        functionName,
        args: [{ type: "field" }, { type: "extra" }],
      });

      it("drops aggregation, the x fields and extra breakdowns", () => {
        const panelData = makePanelData("distribution");
        const fields = panelData.data.queries[0].fields;
        fields.x = [{ alias: "x" }];
        fields.y = [yField("count"), yField("avg")];
        fields.breakdown = [{ alias: "b1" }, { alias: "b2" }];
        panelData.data.queries[0].config.time_shift = [{ offSet: "1h" }] as any;
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.x).toEqual([]);
        expect(fields.y.map((item: any) => item.functionName)).toEqual([null, null]);
        expect(fields.y[0].args).toHaveLength(1);
        expect(fields.breakdown).toEqual([{ alias: "b1" }]);
        expect(panelData.data.queries[0].config.time_shift).toEqual([]);
      });

      it("clears y HAVING filters left over from the previous chart type", () => {
        const panelData = makePanelData("distribution");
        const fields = panelData.data.queries[0].fields;
        fields.y = [{ ...yField("count"), havingConditions: [{ operator: ">", value: 5 }] }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.y[0].havingConditions).toEqual([]);
      });

      it("never keeps a timestamp y, and falls back to a numeric column", () => {
        const panelData: any = makePanelData("distribution");
        panelData.meta = {
          streamFields: {
            groupedFields: [
              {
                name: "demo_app",
                schema: [
                  { name: "_timestamp", type: "Int64" },
                  { name: "host", type: "Utf8" },
                  { name: "cpu_pct", type: "Float64" },
                ],
              },
            ],
          },
        };
        const fields = panelData.data.queries[0].fields;
        fields.stream = "demo_app";
        fields.x = [{ alias: "x_axis_1", column: "_timestamp", functionName: "histogram" }];
        fields.y = [
          {
            alias: "y_axis_1",
            column: "_timestamp",
            functionName: "count",
            args: [{ type: "field", value: { field: "_timestamp" } }],
          },
        ];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.y).toHaveLength(1);
        expect(fields.y[0]).toMatchObject({ column: "cpu_pct", functionName: null });
      });

      it("keeps a numeric y and leaves y empty when the stream has no numeric column", () => {
        const kept = makePanelData("distribution");
        kept.data.queries[0].fields.y = [
          { functionName: "avg", args: [{ type: "field", value: { field: "latency_ms" } }] },
        ];
        makeAggregation(kept).resetAggregationFunction();
        expect(kept.data.queries[0].fields.y[0].args[0].value.field).toBe("latency_ms");

        const empty = makePanelData("distribution");
        empty.data.queries[0].fields.y = [
          { functionName: "count", args: [{ type: "field", value: { field: "_timestamp" } }] },
        ];
        makeAggregation(empty).resetAggregationFunction();
        expect(empty.data.queries[0].fields.y).toEqual([]);
      });
    });
    describe("treemap chart type", () => {
      const yField = (functionName: string | null) => ({
        functionName,
        args: [{ type: "field" }, { type: "extra" }],
      });

      it("keeps every group level, one y counted and one breakdown", () => {
        const panelData = makePanelData("treemap");
        const fields = panelData.data.queries[0].fields;
        fields.x = [{ alias: "x1" }, { alias: "x2" }];
        fields.y = [yField(null), yField("sum")];
        fields.breakdown = [{ alias: "b1" }, { alias: "b2" }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.x).toEqual([{ alias: "x1" }, { alias: "x2" }]);
        expect(fields.y.map((item: any) => item.functionName)).toEqual(["count"]);
        expect(fields.breakdown).toEqual([{ alias: "b1" }]);
      });

      it("turns a size a parent tile cannot add up into a count, and keeps a sum", () => {
        const panelData = makePanelData("treemap");
        const fields = panelData.data.queries[0].fields;
        fields.x = [{ alias: "x1" }];
        fields.y = [yField("avg")];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.y[0].functionName).toBe("count");
        expect(fields.y[0].args).toEqual([{ type: "field" }]);

        fields.y = [yField("sum")];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.y[0].functionName).toBe("sum");
      });

      it("trims to five levels, dropping the breakdown before a group field", () => {
        const panelData = makePanelData("treemap");
        const fields = panelData.data.queries[0].fields;
        fields.x = ["x1", "x2", "x3", "x4", "x5", "x6"].map((alias) => ({ alias }));
        fields.y = [yField("count")];
        fields.breakdown = [{ alias: "b1" }];
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.x.map((item: any) => item.alias)).toEqual(["x1", "x2", "x3", "x4", "x5"]);
        expect(fields.breakdown).toEqual([]);
      });

      it("keeps the count of rows as the tile size instead of a raw column", () => {
        const panelData = makePanelData("treemap");
        const fields = panelData.data.queries[0].fields;
        const countRows = {
          alias: "y_axis_1",
          functionName: "count",
          args: [{ type: "field", value: { field: "_timestamp" } }],
          isDerived: false,
        };
        fields.y = [countRows];
        panelData.meta = {
          streamFields: {
            groupedFields: [{ name: "test_stream", schema: [{ name: "bytes", type: "Int64" }] }],
          },
        };
        makeAggregation(panelData).resetAggregationFunction();
        expect(fields.y).toEqual([countRows]);
      });
    });
    describe("sunburst chart type", () => {
      const yField = (functionName: string | null) => ({
        functionName,
        args: [{ type: "field" }, { type: "extra" }],
      });

      it("keeps every x ring, one y counted and one breakdown", () => {
        const sunburst = makePanelData("sunburst");
        const ring = sunburst.data.queries[0].fields;
        ring.x = [{ alias: "x1" }, { alias: "x2" }];
        ring.y = [yField(null), yField("sum")];
        ring.breakdown = [{ alias: "b1" }, { alias: "b2" }];
        makeAggregation(sunburst).resetAggregationFunction();
        expect(ring.x).toEqual([{ alias: "x1" }, { alias: "x2" }]);
        expect(ring.y.map((item: any) => item.functionName)).toEqual(["count"]);
        expect(ring.breakdown).toEqual([{ alias: "b1" }]);
      });

      it("turns a size the rings cannot add up into a count and keeps a sum", () => {
        const sunburst = makePanelData("sunburst");
        const ring = sunburst.data.queries[0].fields;
        ring.x = [{ alias: "x1" }];
        ring.y = [yField("avg")];
        makeAggregation(sunburst).resetAggregationFunction();
        expect(ring.y[0].functionName).toBe("count");
        ring.y = [yField("sum")];
        makeAggregation(sunburst).resetAggregationFunction();
        expect(ring.y[0].functionName).toBe("sum");
      });

      it("trims to five rings, dropping the breakdown when the x fields fill them", () => {
        const sunburst = makePanelData("sunburst");
        const ring = sunburst.data.queries[0].fields;
        ring.x = Array.from({ length: 6 }, (_, i) => ({ alias: `x${i + 1}` }));
        ring.y = [yField(null)];
        ring.breakdown = [{ alias: "b1" }];
        makeAggregation(sunburst).resetAggregationFunction();
        expect(ring.x.map((item: any) => item.alias)).toEqual(["x1", "x2", "x3", "x4", "x5"]);
        expect(ring.breakdown).toEqual([]);
      });

      it("keeps the default count of the timestamp as the size, never a raw field", () => {
        const sunburst = makePanelData("sunburst");
        sunburst.meta = {
          streamFields: {
            groupedFields: [{ name: "s", schema: [{ name: "bytes", type: "Int64" }] }],
          },
        };
        const ring = sunburst.data.queries[0].fields;
        ring.y = [
          {
            alias: "y_axis_1",
            column: "_timestamp",
            functionName: "count",
            args: [{ type: "field", value: { field: "_timestamp" } }],
          },
        ];
        makeAggregation(sunburst).resetAggregationFunction();
        expect(ring.y).toHaveLength(1);
        expect(ring.y[0].functionName).toBe("count");
        expect(ring.y[0].args[0].value.field).toBe("_timestamp");
      });
    });
    describe("funnel chart type", () => {
      const yField = (functionName: string | null) => ({
        functionName,
        args: [{ type: "field" }, { type: "extra" }],
      });

      it("funnel resets like a pie", () => {
        const funnel = makePanelData("funnel");
        const stages = funnel.data.queries[0].fields;
        stages.x = [{ alias: "x1" }, { alias: "x2" }];
        stages.y = [yField(null), yField("sum")];
        stages.breakdown = [{ alias: "b1" }];
        makeAggregation(funnel).resetAggregationFunction();
        expect(stages.x).toHaveLength(1);
        expect(stages.y.map((item: any) => item.functionName)).toEqual(["count"]);
        expect(stages.breakdown).toEqual([]);
      });
    });

    describe("flame graph and starter queries", () => {
      const twoQueries = (type: string) => {
        const panelData = makePanelData(type);
        panelData.data.queries.push(makeDefaultQuery({ query: "SELECT 2" }));
        panelData.layout.currentQueryIndex = 1;
        panelData.data.queries[1].fields.stream = "demo_app";
        panelData.data.queries[1].config.time_shift = [{ offSet: "1h" }] as any;
        return panelData;
      };

      it("flame graph resets to a starter custom SQL query on the chosen stream", () => {
        const panelData = twoQueries("flame-graph");
        makeAggregation(panelData).resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(1);
        expect(panelData.data.queries[0]).toMatchObject({
          customQuery: true,
          query: 'SELECT stack, sum(samples) AS value FROM "demo_app" GROUP BY stack',
        });
        expect(panelData.data.queries[0].config.time_shift).toEqual([]);
        expect(panelData.data.queryType).toBe("sql");
        expect((panelData.layout as any).showQueryBar).toBe(true);
        expect(defaultFlameGraphPanelQuery("")).toBe("");
      });

      it("keeps hand-written SQL on a switch to flame graph", () => {
        const typed = makePanelData("flame-graph");
        Object.assign(typed.data.queries[0], {
          customQuery: true,
          query: 'SELECT stack, count(*) AS value FROM "test_stream" GROUP BY stack',
        });
        makeAggregation(typed).resetAggregationFunction();
        expect(typed.data.queries[0]).toMatchObject({
          customQuery: true,
          query: 'SELECT stack, count(*) AS value FROM "test_stream" GROUP BY stack',
        });
      });

      it("returns an untouched flame graph starter to the builder on a switch to a line chart", () => {
        const panelData = makePanelData("flame-graph");
        panelData.data.queries[0].fields.stream = "test_stream";
        makeAggregation(panelData).resetAggregationFunction();
        expect(panelData.data.queries[0].query).toBe(defaultFlameGraphPanelQuery("test_stream"));
        expect(isPanelStarterQuery(panelData.data.queries[0])).toBe(true);
        panelData.data.type = "line";
        makeAggregation(panelData).resetAggregationFunction();
        const [query] = panelData.data.queries;
        expect(query.customQuery).toBe(false);
        expect(query.query).toBe("");
        expect(query.fields.x.map((field: any) => field.alias)).toEqual(["x_axis_1"]);
        expect(query.fields.y.map((field: any) => field.functionName)).toEqual(["count"]);
      });

      it("leaves hand-written SQL in custom mode on a switch to a builder chart", () => {
        const panelData = makePanelData("state-timeline");
        Object.assign(panelData.data.queries[0], {
          customQuery: true,
          query: 'SELECT histogram(_timestamp) AS x, count(*) AS y FROM "test_stream" GROUP BY x',
        });
        makeAggregation(panelData).resetAggregationFunction();
        expect(panelData.data.queries[0].customQuery).toBe(true);
        expect(panelData.data.queries[0].query).toContain("histogram(_timestamp)");
      });
    });

    describe("alert list", () => {
      const twoQueries = (type: string) => {
        const panelData = makePanelData(type);
        panelData.data.queries.push(makeDefaultQuery({ query: "SELECT 2" }));
        panelData.layout.currentQueryIndex = 1;
        panelData.data.queries[1].fields.stream = "demo_app";
        panelData.data.queries[1].config.time_shift = [{ offSet: "1h" }] as any;
        return panelData;
      };

      it("keeps one empty builder query and no query type", () => {
        const panelData = twoQueries("alert-list");
        makeAggregation(panelData).resetAggregationFunction();
        expect(panelData.data.queries).toHaveLength(1);
        expect(panelData.data.queries[0]).toMatchObject({ customQuery: false, query: "" });
        expect(panelData.data.queries[0].fields.stream).toBe("demo_app");
        expect(panelData.data.queryType).toBe("");
      });
    });
  });
});
