import { describe, it, expect, beforeEach } from "vitest";
import { reactive } from "vue";
import { usePanelFields } from "./usePanelFields";

// Mock Vue to enable computed() in unit test context
import { vi } from "vitest";

vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return { ...actual };
});

const makeStore = (timestampColumn = "_timestamp") => ({
  state: {
    zoConfig: {
      timestamp_column: timestampColumn,
    },
  },
});

const makeDefaultQuery = () => ({
  query: "",
  customQuery: false,
  fields: {
    stream: "",
    stream_type: "logs",
    x: [] as any[],
    y: [] as any[],
    z: [] as any[],
    breakdown: [] as any[],
    filter: { filterType: "group", logicalOperator: "AND", conditions: [] as any[] },
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
  config: {},
});

const makePanelData = (type = "bar") =>
  reactive({
    data: {
      type,
      queryType: "sql",
      queries: [makeDefaultQuery()],
    },
    layout: {
      currentQueryIndex: 0,
    },
    meta: {
      stream: {
        vrlFunctionFieldList: [] as any[],
        customQueryFields: [] as any[],
      },
    },
  });

describe("usePanelFields", () => {
  let store: any;
  let panelData: ReturnType<typeof makePanelData>;
  let fields: ReturnType<typeof usePanelFields>;

  beforeEach(() => {
    store = makeStore();
    panelData = makePanelData();
    fields = usePanelFields({ dashboardPanelData: panelData, store });
  });

  // ── generateLabelFromName ──────────────────────────────────────────────────

  describe("generateLabelFromName", () => {
    it("capitalizes the first letter of a single word", () => {
      expect(fields.generateLabelFromName("simple")).toBe("Simple");
    });

    it("replaces underscores with spaces and capitalizes", () => {
      expect(fields.generateLabelFromName("test_field")).toBe("Test Field");
    });

    it("replaces hyphens with spaces and capitalizes", () => {
      expect(fields.generateLabelFromName("my-field")).toBe("My Field");
    });

    it("replaces dots with spaces and capitalizes", () => {
      expect(fields.generateLabelFromName("my.field")).toBe("My Field");
    });

    it("handles multi-word name with mixed separators", () => {
      expect(fields.generateLabelFromName("request_count_total")).toBe(
        "Request Count Total",
      );
    });
  });

  // ── checkIsDerivedField ───────────────────────────────────────────────────

  describe("checkIsDerivedField", () => {
    it("returns false when no VRL function fields are present", () => {
      expect(fields.checkIsDerivedField("some_field")).toBe(false);
    });

    it("returns true when field is in vrlFunctionFieldList", () => {
      panelData.meta.stream.vrlFunctionFieldList = [{ name: "derived_col" }];
      expect(fields.checkIsDerivedField("derived_col")).toBe(true);
    });

    it("returns false when field is not in vrlFunctionFieldList", () => {
      panelData.meta.stream.vrlFunctionFieldList = [{ name: "other_col" }];
      expect(fields.checkIsDerivedField("my_col")).toBe(false);
    });
  });

  // ── getNewColorValue ──────────────────────────────────────────────────────

  describe("getNewColorValue", () => {
    it("returns a color string when y axis is empty", () => {
      const color = fields.getNewColorValue();
      expect(typeof color).toBe("string");
      expect(color.startsWith("#")).toBe(true);
    });

    it("returns a color not already in the y axis", () => {
      const color1 = fields.getNewColorValue();
      panelData.data.queries[0].fields.y.push({ color: color1 });
      const color2 = fields.getNewColorValue();
      expect(color2).not.toBe(color1);
    });
  });

  // ── addXAxisItem ──────────────────────────────────────────────────────────

  describe("addXAxisItem", () => {
    it("adds an item to x axis", () => {
      fields.addXAxisItem({ name: "status" });
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
    });

    it("sets alias to x_axis_1 for non-custom, non-derived field", () => {
      fields.addXAxisItem({ name: "status" });
      expect(panelData.data.queries[0].fields.x[0].alias).toBe("x_axis_1");
    });

    it("uses histogram function for timestamp column", () => {
      fields.addXAxisItem({ name: "_timestamp" });
      const item = panelData.data.queries[0].fields.x[0];
      expect(item.functionName).toBe("histogram");
    });

    it("sets functionName to null for non-timestamp column", () => {
      fields.addXAxisItem({ name: "status" });
      const item = panelData.data.queries[0].fields.x[0];
      expect(item.functionName).toBeNull();
    });

    it("does not add a second item to pie chart (max 1)", () => {
      panelData.data.type = "pie";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addXAxisItem({ name: "status" });
      fields.addXAxisItem({ name: "another" }); // should be blocked
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
    });

    it("allows unlimited items for table chart", () => {
      panelData.data.type = "table";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addXAxisItem({ name: "field1" });
      fields.addXAxisItem({ name: "field2" });
      fields.addXAxisItem({ name: "field3" });
      expect(panelData.data.queries[0].fields.x).toHaveLength(3);
    });

    it("uses field name as alias for custom query", () => {
      panelData.data.queries[0].customQuery = true;
      fields.addXAxisItem({ name: "custom_field" });
      expect(panelData.data.queries[0].fields.x[0].alias).toBe("custom_field");
    });

    it("generates label using generateLabelFromName for non-custom query", () => {
      fields.addXAxisItem({ name: "my_field" });
      expect(panelData.data.queries[0].fields.x[0].label).toBe("My Field");
    });
  });

  // ── addYAxisItem ──────────────────────────────────────────────────────────

  describe("addYAxisItem", () => {
    it("adds an item to y axis", () => {
      fields.addYAxisItem({ name: "count" });
      expect(panelData.data.queries[0].fields.y).toHaveLength(1);
    });

    it("sets alias to y_axis_1 for non-custom field", () => {
      fields.addYAxisItem({ name: "count" });
      expect(panelData.data.queries[0].fields.y[0].alias).toBe("y_axis_1");
    });

    it("sets functionName to count for non-heatmap, non-derived field", () => {
      fields.addYAxisItem({ name: "events" });
      expect(panelData.data.queries[0].fields.y[0].functionName).toBe("count");
    });

    it("sets functionName to null for heatmap chart type", () => {
      panelData.data.type = "heatmap";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addYAxisItem({ name: "value" });
      expect(panelData.data.queries[0].fields.y[0].functionName).toBeNull();
    });

    it("does not add second item to pie chart (max 1 y)", () => {
      panelData.data.type = "pie";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addYAxisItem({ name: "val1" });
      fields.addYAxisItem({ name: "val2" }); // blocked
      expect(panelData.data.queries[0].fields.y).toHaveLength(1);
    });
  });

  // ── addZAxisItem ──────────────────────────────────────────────────────────

  describe("addZAxisItem", () => {
    it("adds a z axis item for heatmap", () => {
      panelData.data.type = "heatmap";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addZAxisItem({ name: "value" });
      expect(panelData.data.queries[0].fields.z).toHaveLength(1);
    });

    it("sets functionName to count for non-derived z field", () => {
      fields.addZAxisItem({ name: "value" });
      expect(panelData.data.queries[0].fields.z[0].functionName).toBe("count");
    });

    it("does not add second z item for heatmap (max 1)", () => {
      panelData.data.type = "heatmap";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addZAxisItem({ name: "v1" });
      fields.addZAxisItem({ name: "v2" }); // blocked
      expect(panelData.data.queries[0].fields.z).toHaveLength(1);
    });
  });

  // ── addBreakDownAxisItem ──────────────────────────────────────────────────

  describe("addBreakDownAxisItem", () => {
    it("adds a breakdown item for bar chart", () => {
      fields.addBreakDownAxisItem({ name: "region" });
      expect(panelData.data.queries[0].fields.breakdown).toHaveLength(1);
    });

    it("sets alias to breakdown_1 for non-custom field", () => {
      fields.addBreakDownAxisItem({ name: "region" });
      expect(panelData.data.queries[0].fields.breakdown[0].alias).toBe("breakdown_1");
    });

    it("does not add a second breakdown item for bar chart", () => {
      fields.addBreakDownAxisItem({ name: "region" });
      fields.addBreakDownAxisItem({ name: "country" }); // blocked
      expect(panelData.data.queries[0].fields.breakdown).toHaveLength(1);
    });
  });

  // ── updateArrayAlias ──────────────────────────────────────────────────────

  describe("updateArrayAlias", () => {
    it("re-indexes x axis aliases after adding a field", () => {
      // Use table type which allows unlimited x fields
      panelData.data.type = "table";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addXAxisItem({ name: "field1" });
      fields.addXAxisItem({ name: "field2" });
      panelData.data.queries[0].fields.x.splice(0, 1);
      fields.updateArrayAlias();
      expect(panelData.data.queries[0].fields.x[0].alias).toBe("x_axis_1");
    });

    it("re-indexes y axis aliases", () => {
      // Use default bar type which allows multiple y fields
      fields.addYAxisItem({ name: "count1" });
      fields.addYAxisItem({ name: "count2" });
      panelData.data.queries[0].fields.y.splice(0, 1);
      fields.updateArrayAlias();
      expect(panelData.data.queries[0].fields.y[0].alias).toBe("y_axis_1");
    });
  });

  // ── remove functions ──────────────────────────────────────────────────────

  describe("removeXAxisItemByIndex", () => {
    it("removes the item at the given index", () => {
      // Use table type to allow multiple x fields
      panelData.data.type = "table";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.addXAxisItem({ name: "f1" });
      fields.addXAxisItem({ name: "f2" });
      fields.removeXAxisItemByIndex(0);
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
    });

    it("does nothing for negative index", () => {
      fields.addXAxisItem({ name: "f1" });
      fields.removeXAxisItemByIndex(-1);
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
    });
  });

  describe("removeYAxisItemByIndex", () => {
    it("removes the item at the given index", () => {
      fields.addYAxisItem({ name: "c1" });
      fields.removeYAxisItemByIndex(0);
      expect(panelData.data.queries[0].fields.y).toHaveLength(0);
    });
  });

  describe("removeZAxisItemByIndex", () => {
    it("removes the item at the given index", () => {
      fields.addZAxisItem({ name: "v1" });
      fields.removeZAxisItemByIndex(0);
      expect(panelData.data.queries[0].fields.z).toHaveLength(0);
    });
  });

  describe("removeBreakdownItemByIndex", () => {
    it("removes the item at the given index", () => {
      fields.addBreakDownAxisItem({ name: "region" });
      fields.removeBreakdownItemByIndex(0);
      expect(panelData.data.queries[0].fields.breakdown).toHaveLength(0);
    });
  });

  describe("removeFilterItem", () => {
    it("removes filter condition by column name", () => {
      panelData.data.queries[0].fields.filter.conditions.push({
        column: "status",
        operator: "=",
        value: "200",
      });
      fields.removeFilterItem("status");
      expect(panelData.data.queries[0].fields.filter.conditions).toHaveLength(0);
    });

    it("does nothing if column is not found", () => {
      panelData.data.queries[0].fields.filter.conditions.push({
        column: "status",
        operator: "=",
        value: "200",
      });
      fields.removeFilterItem("nonexistent");
      expect(panelData.data.queries[0].fields.filter.conditions).toHaveLength(1);
    });
  });

  // ── geo field setters/removers ───────────────────────────────────────────

  describe("addLatitude / removeLatitude", () => {
    it("sets latitude field", () => {
      fields.addLatitude({ name: "lat", streamAlias: "" });
      expect(panelData.data.queries[0].fields.latitude).not.toBeNull();
      expect(panelData.data.queries[0].fields.latitude.alias).toBe("latitude");
    });

    it("removes latitude field", () => {
      fields.addLatitude({ name: "lat" });
      fields.removeLatitude();
      expect(panelData.data.queries[0].fields.latitude).toBeNull();
    });
  });

  describe("addLongitude / removeLongitude", () => {
    it("sets longitude field", () => {
      fields.addLongitude({ name: "lng" });
      expect(panelData.data.queries[0].fields.longitude).not.toBeNull();
    });

    it("removes longitude field", () => {
      fields.addLongitude({ name: "lng" });
      fields.removeLongitude();
      expect(panelData.data.queries[0].fields.longitude).toBeNull();
    });
  });

  describe("addWeight / removeWeight", () => {
    it("sets weight field with count function", () => {
      fields.addWeight({ name: "cnt" });
      expect(panelData.data.queries[0].fields.weight).not.toBeNull();
      expect(panelData.data.queries[0].fields.weight.functionName).toBe("count");
    });

    it("removes weight field", () => {
      fields.addWeight({ name: "cnt" });
      fields.removeWeight();
      expect(panelData.data.queries[0].fields.weight).toBeNull();
    });
  });

  describe("addSource / removeSource", () => {
    it("sets source field", () => {
      fields.addSource({ name: "src" });
      expect(panelData.data.queries[0].fields.source).not.toBeNull();
    });

    it("removes source field", () => {
      fields.addSource({ name: "src" });
      fields.removeSource();
      expect(panelData.data.queries[0].fields.source).toBeNull();
    });
  });

  describe("addTarget / removeTarget", () => {
    it("sets target field", () => {
      fields.addTarget({ name: "tgt" });
      expect(panelData.data.queries[0].fields.target).not.toBeNull();
    });

    it("removes target field", () => {
      fields.addTarget({ name: "tgt" });
      fields.removeTarget();
      expect(panelData.data.queries[0].fields.target).toBeNull();
    });
  });

  describe("addValue / removeValue", () => {
    it("sets value field with sum function", () => {
      fields.addValue({ name: "amount" });
      expect(panelData.data.queries[0].fields.value).not.toBeNull();
      expect(panelData.data.queries[0].fields.value.functionName).toBe("sum");
    });

    it("removes value field", () => {
      fields.addValue({ name: "amount" });
      fields.removeValue();
      expect(panelData.data.queries[0].fields.value).toBeNull();
    });
  });

  // ── resetFields ───────────────────────────────────────────────────────────

  describe("resetFields", () => {
    it("clears all axis fields", () => {
      fields.addXAxisItem({ name: "status" });
      fields.addYAxisItem({ name: "count" });
      fields.resetFields();
      expect(panelData.data.queries[0].fields.x).toHaveLength(0);
      expect(panelData.data.queries[0].fields.y).toHaveLength(0);
    });

    it("preserves stream name and type", () => {
      panelData.data.queries[0].fields.stream = "my_stream";
      panelData.data.queries[0].fields.stream_type = "metrics";
      fields.addXAxisItem({ name: "status" });
      fields.resetFields();
      expect(panelData.data.queries[0].fields.stream).toBe("my_stream");
      expect(panelData.data.queries[0].fields.stream_type).toBe("metrics");
    });

    it("resets latitude, longitude, weight to null", () => {
      fields.addLatitude({ name: "lat" });
      fields.resetFields();
      expect(panelData.data.queries[0].fields.latitude).toBeNull();
    });
  });

  // ── removeXYFilters ───────────────────────────────────────────────────────

  describe("removeXYFilters", () => {
    it("clears x and y fields for non-custom, non-promql query", () => {
      fields.addXAxisItem({ name: "status" });
      fields.addYAxisItem({ name: "count" });
      fields.removeXYFilters();
      expect(panelData.data.queries[0].fields.x).toHaveLength(0);
      expect(panelData.data.queries[0].fields.y).toHaveLength(0);
    });

    it("clears vrlFunctionFieldList and customQueryFields", () => {
      panelData.meta.stream.vrlFunctionFieldList = [{ name: "vrl_field" }];
      panelData.meta.stream.customQueryFields = [{ name: "cq_field" }];
      fields.removeXYFilters();
      expect(panelData.meta.stream.vrlFunctionFieldList).toHaveLength(0);
      expect(panelData.meta.stream.customQueryFields).toHaveLength(0);
    });

    it("does not clear fields for custom query (fields are preserved)", () => {
      panelData.data.queries[0].customQuery = true;
      fields.addXAxisItem({ name: "f1" });
      // removeXYFilters condition: promqlMode || customQuery == false
      // customQuery=true, promqlMode=false → condition is false → fields NOT cleared
      fields.removeXYFilters();
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
    });
  });

  // ── setFieldsBasedOnChartTypeValidation ───────────────────────────────────

  describe("setFieldsBasedOnChartTypeValidation", () => {
    it("adds valid x and y fields according to chart type rules", () => {
      fields.setFieldsBasedOnChartTypeValidation(
        { x: [{ name: "status" }], y: [{ name: "count" }], z: [], breakdown: [] },
        "bar",
      );
      expect(panelData.data.queries[0].fields.x).toHaveLength(1);
      expect(panelData.data.queries[0].fields.y).toHaveLength(1);
    });

    it("keeps breakdown fields separate from x for table chart type (pivot table mode)", () => {
      // Must set panel type to "table" so isAddXAxisNotAllowed returns false
      panelData.data.type = "table";
      fields = usePanelFields({ dashboardPanelData: panelData, store });
      fields.setFieldsBasedOnChartTypeValidation(
        {
          x: [{ name: "col1" }],
          y: [],
          z: [],
          breakdown: [{ name: "col2" }],
        },
        "table",
      );
      // table: x fields go into x, breakdown fields stay in breakdown (for pivot table mode)
      const xNames = panelData.data.queries[0].fields.x.map((f: any) => f.label);
      const breakdownNames = panelData.data.queries[0].fields.breakdown.map((f: any) => f.label);
      expect(xNames).toContain("Col1");
      expect(breakdownNames).toContain("Col2");
    });
  });

  // ── computed: promqlMode ──────────────────────────────────────────────────

  describe("promqlMode", () => {
    it("is false when queryType is sql", () => {
      panelData.data.queryType = "sql";
      expect(fields.promqlMode.value).toBe(false);
    });

    it("is true when queryType is promql", () => {
      panelData.data.queryType = "promql";
      expect(fields.promqlMode.value).toBe(true);
    });
  });
});
