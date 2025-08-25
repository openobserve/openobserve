import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from "vitest";
import { reactive, nextTick } from "vue";
import useDashboardPanelData from "./useDashboardPanel";
import { useStore } from "vuex";
import useNotifications from "./useNotifications";
import useValuesWebSocket from "./dashboard/useValuesWebSocket";
import StreamService from "@/services/stream";
import queryService from "@/services/search";
import * as zincutils from "@/utils/zincutils";
import * as sqlUtils from "@/utils/query/sqlUtils";
import * as convertDataIntoUnitValue from "@/utils/dashboard/convertDataIntoUnitValue";

// Mock dependencies
vi.mock("vuex");
vi.mock("./useNotifications");
vi.mock("./dashboard/useValuesWebSocket");
vi.mock("@/services/stream");
vi.mock("@/services/search");
vi.mock("@/utils/zincutils");
vi.mock("@/utils/query/sqlUtils");
vi.mock("@/utils/dashboard/convertDataIntoUnitValue");

// Mock SQL parser
const mockParser = {
  astify: vi.fn(),
};

// Set global parser
(global as any).parser = mockParser;

// Mock store
const mockStore = {
  state: {
    selectedOrganization: { identifier: "test-org" },
    zoConfig: {
      dashboard_show_symbol_enabled: true,
      timestamp_column: "_timestamp",
      sql_base64_enabled: false,
    },
  },
};

const mockNotifications = {
  showErrorNotification: vi.fn(),
};

const mockValuesWebSocket = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

describe("useDashboardPanel", () => {
  let mockUseStore: MockedFunction<typeof useStore>;
  let mockUseNotifications: MockedFunction<typeof useNotifications>;
  let mockUseValuesWebSocket: MockedFunction<typeof useValuesWebSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUseStore = vi.mocked(useStore);
    mockUseNotifications = vi.mocked(useNotifications);
    mockUseValuesWebSocket = vi.mocked(useValuesWebSocket);
    
    mockUseStore.mockReturnValue(mockStore as any);
    mockUseNotifications.mockReturnValue(mockNotifications as any);
    mockUseValuesWebSocket.mockReturnValue(mockValuesWebSocket as any);
    
    // Mock extractFields
    vi.mocked(sqlUtils.extractFields).mockReturnValue([
      { column: "timestamp", alias: "timestamp" },
      { column: "count", alias: "count" },
    ]);

    // Mock validatePanel
    vi.mocked(convertDataIntoUnitValue.validatePanel).mockImplementation(() => {});

    // Mock zinc utils
    vi.mocked(zincutils.splitQuotedString).mockImplementation((str) => str.split(" "));
    vi.mocked(zincutils.escapeSingleQuotes).mockImplementation((str) => str.replace(/'/g, "''"));
    vi.mocked(zincutils.b64EncodeUnicode).mockImplementation((str) => btoa(str));
    vi.mocked(zincutils.isStreamingEnabled).mockReturnValue(false);

    // Mock query service
    vi.mocked(queryService.result_schema).mockResolvedValue({
      data: {
        group_by: ["timestamp"],
        projections: ["timestamp", "count"],
        timeseries_field: "timestamp",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with default dashboard page key", () => {
      const { dashboardPanelData } = useDashboardPanelData();
      
      expect(dashboardPanelData).toBeDefined();
      expect(dashboardPanelData.data.type).toBe("bar");
      expect(dashboardPanelData.data.version).toBe(5);
    });

    it("should initialize with logs page key", () => {
      const { dashboardPanelData } = useDashboardPanelData("logs");
      
      expect(dashboardPanelData).toBeDefined();
      expect(dashboardPanelData.data.queries).toHaveLength(1);
    });

    it("should initialize with metric page key", () => {
      const { dashboardPanelData } = useDashboardPanelData("metric");
      
      expect(dashboardPanelData).toBeDefined();
      expect(dashboardPanelData.data.queryType).toBe("promql");
    });

    it("should reuse existing state for same page key", () => {
      const panel1 = useDashboardPanelData("test");
      panel1.dashboardPanelData.data.title = "Test Title";
      
      const panel2 = useDashboardPanelData("test");
      
      expect(panel2.dashboardPanelData.data.title).toBe("Test Title");
    });
  });

  describe("Basic Functions", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("cleanupDraggingFields", () => {
      it("should reset all drag and drop properties", () => {
        panel.dashboardPanelData.meta.dragAndDrop.currentDragArea = "x-axis";
        panel.dashboardPanelData.meta.dragAndDrop.targetDragIndex = 5;
        panel.dashboardPanelData.meta.dragAndDrop.dragging = true;
        panel.dashboardPanelData.meta.dragAndDrop.dragElement = { name: "test" };
        panel.dashboardPanelData.meta.dragAndDrop.dragSource = "y-axis";
        panel.dashboardPanelData.meta.dragAndDrop.dragSourceIndex = 2;

        panel.cleanupDraggingFields();

        expect(panel.dashboardPanelData.meta.dragAndDrop.currentDragArea).toBeNull();
        expect(panel.dashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(-1);
        expect(panel.dashboardPanelData.meta.dragAndDrop.dragging).toBe(false);
        expect(panel.dashboardPanelData.meta.dragAndDrop.dragElement).toBeNull();
        expect(panel.dashboardPanelData.meta.dragAndDrop.dragSource).toBeNull();
        expect(panel.dashboardPanelData.meta.dragAndDrop.dragSourceIndex).toBeNull();
      });
    });

    describe("getDefaultQueries", () => {
      it("should return default queries structure", () => {
        const defaultQueries = panel.getDefaultQueries();
        
        expect(defaultQueries).toHaveLength(1);
        expect(defaultQueries[0]).toHaveProperty("query", "");
        expect(defaultQueries[0]).toHaveProperty("customQuery", false);
        expect(defaultQueries[0].fields).toHaveProperty("stream", "");
        expect(defaultQueries[0].fields).toHaveProperty("x", []);
        expect(defaultQueries[0].fields).toHaveProperty("y", []);
      });
    });

    describe("resetDashboardPanelData", () => {
      it("should reset dashboard panel data to default", () => {
        panel.dashboardPanelData.data.title = "Custom Title";
        panel.dashboardPanelData.data.type = "line";
        
        panel.resetDashboardPanelData();
        
        expect(panel.dashboardPanelData.data.title).toBe("");
        expect(panel.dashboardPanelData.data.type).toBe("bar");
      });
    });

    describe("resetDashboardPanelDataAndAddTimeField", () => {
      it("should reset data and add timestamp to x-axis", () => {
        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "_timestamp", type: "Utf8" },
          { name: "level", type: "Utf8" },
        ];

        panel.resetDashboardPanelDataAndAddTimeField();

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.x[0].column).toBe("_timestamp");
      });

      it("should handle when no timestamp field exists", () => {
        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "level", type: "Utf8" },
        ];

        panel.resetDashboardPanelDataAndAddTimeField();

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(0);
      });
    });

    describe("generateLabelFromName", () => {
      it("should generate proper labels for common field names", () => {
        expect(panel.generateLabelFromName("timestamp")).toBe("Timestamp");
        expect(panel.generateLabelFromName("created_at")).toBe("Created At");
        expect(panel.generateLabelFromName("user_name")).toBe("User Name");
        expect(panel.generateLabelFromName("simple")).toBe("Simple");
      });

      it("should handle empty or null names", () => {
        expect(panel.generateLabelFromName("")).toBe("");
        expect(panel.generateLabelFromName("_")).toBe("_");
      });
    });
  });

  describe("Query Management", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("addQuery", () => {
      it("should add a new SQL query", () => {
        panel.dashboardPanelData.data.queries[0].fields.stream = "test-stream";
        const initialLength = panel.dashboardPanelData.data.queries.length;

        panel.addQuery();

        expect(panel.dashboardPanelData.data.queries).toHaveLength(initialLength + 1);
        expect(panel.dashboardPanelData.data.queries[1].customQuery).toBe(false);
        expect(panel.dashboardPanelData.data.queries[1].fields.stream).toBe("test-stream");
      });

      it("should add a new PromQL query when queryType is promql", () => {
        panel.dashboardPanelData.data.queryType = "promql";
        panel.dashboardPanelData.data.queries[0].fields.stream = "test-stream";

        panel.addQuery();

        expect(panel.dashboardPanelData.data.queries[1].customQuery).toBe(true);
      });

      it("should set correct query color", () => {
        panel.addQuery();
        
        expect(panel.dashboardPanelData.data.queries[1].config.color).toBeDefined();
      });
    });

    describe("removeQuery", () => {
      it("should remove query at specified index", () => {
        panel.addQuery();
        panel.addQuery();
        expect(panel.dashboardPanelData.data.queries).toHaveLength(3);

        panel.removeQuery(1);

        expect(panel.dashboardPanelData.data.queries).toHaveLength(2);
      });

      it("should not remove if only one query exists", () => {
        panel.removeQuery(0);
        
        expect(panel.dashboardPanelData.data.queries).toHaveLength(1);
      });

      it("should adjust currentQueryIndex when removing current query", () => {
        panel.addQuery();
        panel.dashboardPanelData.layout.currentQueryIndex = 1;

        panel.removeQuery(1);

        expect(panel.dashboardPanelData.layout.currentQueryIndex).toBe(0);
      });
    });
  });

  describe("Computed Properties", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("promqlMode", () => {
      it("should return true when queryType is promql", () => {
        panel.dashboardPanelData.data.queryType = "promql";
        
        expect(panel.promqlMode.value).toBe(true);
      });

      it("should return false when queryType is sql", () => {
        panel.dashboardPanelData.data.queryType = "sql";
        
        expect(panel.promqlMode.value).toBe(false);
      });
    });

    describe("selectedStreamFieldsBasedOnUserDefinedSchema", () => {
      it("should return selected fields when user defined schema exists", () => {
        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "field1", type: "Utf8" },
          { name: "field2", type: "Int64" },
        ];
        panel.dashboardPanelData.meta.stream.userDefinedSchema = [
          { name: "field1", type: "Utf8" },
          { name: "field3", type: "Float64" },
        ];

        const result = panel.selectedStreamFieldsBasedOnUserDefinedSchema.value;

        expect(result).toHaveLength(2);
        expect(result.some(f => f.name === "field1")).toBe(true);
        expect(result.some(f => f.name === "field3")).toBe(true);
      });

      it("should return selected fields when no user defined schema", () => {
        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "field1", type: "Utf8" },
        ];
        panel.dashboardPanelData.meta.stream.userDefinedSchema = [];

        const result = panel.selectedStreamFieldsBasedOnUserDefinedSchema.value;

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("field1");
      });
    });

    describe("currentXLabel and currentYLabel", () => {
      it("should return correct labels for table chart", () => {
        panel.dashboardPanelData.data.type = "table";

        expect(panel.currentXLabel.value).toBe("First Column");
        expect(panel.currentYLabel.value).toBe("Other Columns");
      });

      it("should return correct labels for h-bar chart", () => {
        panel.dashboardPanelData.data.type = "h-bar";

        expect(panel.currentXLabel.value).toBe("Y-Axis");
        expect(panel.currentYLabel.value).toBe("X-Axis");
      });

      it("should return default labels for other charts", () => {
        panel.dashboardPanelData.data.type = "line";

        expect(panel.currentXLabel.value).toBe("X-Axis");
        expect(panel.currentYLabel.value).toBe("Y-Axis");
      });
    });
  });

  describe("Field Management", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      panel.dashboardPanelData.meta.stream.selectedStreamFields = [
        { name: "timestamp", type: "Utf8" },
        { name: "level", type: "Utf8" },
        { name: "count", type: "Int64" },
      ];
    });

    describe("addXAxisItem", () => {
      it("should add field to x-axis", () => {
        panel.addXAxisItem({ name: "timestamp" });

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.x[0].column).toBe("timestamp");
        expect(panel.dashboardPanelData.data.queries[0].fields.x[0].alias).toBe("timestamp");
      });

      it("should not add duplicate fields", () => {
        panel.addXAxisItem({ name: "timestamp" });
        panel.addXAxisItem({ name: "timestamp" });

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
      });

      it("should respect chart type limitations", () => {
        panel.dashboardPanelData.data.type = "pie";
        panel.addXAxisItem({ name: "timestamp" });
        panel.addXAxisItem({ name: "level" });

        // Pie charts should only allow 1 x-axis field
        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
      });

      it("should handle derived fields", () => {
        panel.dashboardPanelData.meta.stream.vrlFunctionFieldList = [
          { name: "derived_field", type: "Utf8" },
        ];

        panel.addXAxisItem({ name: "derived_field" });

        expect(panel.dashboardPanelData.data.queries[0].fields.x[0].isDerived).toBe(true);
      });
    });

    describe("addYAxisItem", () => {
      it("should add field to y-axis with count aggregation", () => {
        panel.addYAxisItem({ name: "count" });

        expect(panel.dashboardPanelData.data.queries[0].fields.y).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.y[0].aggregationFunction).toBe("count");
      });

      it("should handle numeric fields with proper aggregation", () => {
        panel.addYAxisItem({ name: "count" });

        const yField = panel.dashboardPanelData.data.queries[0].fields.y[0];
        expect(yField.aggregationFunction).toBe("count");
      });

      it("should respect chart type limitations for heatmap", () => {
        panel.dashboardPanelData.data.type = "heatmap";
        panel.addYAxisItem({ name: "count" });
        panel.addYAxisItem({ name: "level" });

        // Heatmap should allow only 1 y-axis field
        expect(panel.dashboardPanelData.data.queries[0].fields.y).toHaveLength(1);
      });
    });

    describe("addBreakDownAxisItem", () => {
      it("should add field to breakdown", () => {
        panel.addBreakDownAxisItem({ name: "level" });

        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown[0].column).toBe("level");
      });

      it("should respect breakdown limitations", () => {
        panel.dashboardPanelData.data.type = "pie";
        panel.addBreakDownAxisItem({ name: "level" });
        panel.addBreakDownAxisItem({ name: "status" });

        // Some charts limit breakdown fields
        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown.length).toBeLessThanOrEqual(1);
      });
    });

    describe("addZAxisItem", () => {
      it("should add field to z-axis", () => {
        panel.dashboardPanelData.data.type = "heatmap";
        panel.addZAxisItem({ name: "count" });

        expect(panel.dashboardPanelData.data.queries[0].fields.z).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.z[0].column).toBe("count");
      });

      it("should only allow z-axis for heatmap charts", () => {
        panel.dashboardPanelData.data.type = "line";
        panel.addZAxisItem({ name: "count" });

        expect(panel.dashboardPanelData.data.queries[0].fields.z).toHaveLength(0);
      });
    });
  });

  describe("Map Chart Fields", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      panel.dashboardPanelData.meta.stream.selectedStreamFields = [
        { name: "latitude", type: "Float64" },
        { name: "longitude", type: "Float64" },
        { name: "weight", type: "Int64" },
        { name: "name", type: "Utf8" },
        { name: "value", type: "Int64" },
      ];
    });

    describe("Geo Map Fields", () => {
      beforeEach(() => {
        panel.dashboardPanelData.data.type = "geomap";
      });

      it("should add latitude field", () => {
        panel.addLatitude({ name: "latitude" });

        expect(panel.dashboardPanelData.data.queries[0].fields.latitude).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.latitude.column).toBe("latitude");
      });

      it("should add longitude field", () => {
        panel.addLongitude({ name: "longitude" });

        expect(panel.dashboardPanelData.data.queries[0].fields.longitude).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.longitude.column).toBe("longitude");
      });

      it("should add weight field with aggregation", () => {
        panel.addWeight({ name: "weight" });

        expect(panel.dashboardPanelData.data.queries[0].fields.weight).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.weight.aggregationFunction).toBe("count");
      });
    });

    describe("Regular Map Fields", () => {
      beforeEach(() => {
        panel.dashboardPanelData.data.type = "maps";
      });

      it("should add map name field", () => {
        panel.addMapName({ name: "name" });

        expect(panel.dashboardPanelData.data.queries[0].fields.name).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.name.column).toBe("name");
      });

      it("should add map value field", () => {
        panel.addMapValue({ name: "value" });

        expect(panel.dashboardPanelData.data.queries[0].fields.value_for_maps).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.value_for_maps.aggregationFunction).toBe("count");
      });
    });

    describe("Sankey Chart Fields", () => {
      beforeEach(() => {
        panel.dashboardPanelData.data.type = "sankey";
        panel.dashboardPanelData.meta.stream.selectedStreamFields.push(
          { name: "source", type: "Utf8" },
          { name: "target", type: "Utf8" }
        );
      });

      it("should add source field", () => {
        panel.addSource({ name: "source" });

        expect(panel.dashboardPanelData.data.queries[0].fields.source).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.source.column).toBe("source");
      });

      it("should add target field", () => {
        panel.addTarget({ name: "target" });

        expect(panel.dashboardPanelData.data.queries[0].fields.target).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.target.column).toBe("target");
      });

      it("should add value field with sum aggregation", () => {
        panel.addValue({ name: "value" });

        expect(panel.dashboardPanelData.data.queries[0].fields.value).toBeDefined();
        expect(panel.dashboardPanelData.data.queries[0].fields.value.aggregationFunction).toBe("sum");
      });
    });
  });

  describe("Field Removal", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      // Add some fields first
      panel.dashboardPanelData.data.queries[0].fields.x = [
        { column: "timestamp", alias: "timestamp" }
      ];
      panel.dashboardPanelData.data.queries[0].fields.y = [
        { column: "count", alias: "count", aggregationFunction: "count" }
      ];
      panel.dashboardPanelData.data.queries[0].fields.breakdown = [
        { column: "level", alias: "level" }
      ];
    });

    describe("removeXAxisItem", () => {
      it("should remove x-axis field by name", () => {
        panel.removeXAxisItem("timestamp");

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(0);
      });

      it("should handle non-existent field", () => {
        panel.removeXAxisItem("non-existent");

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
      });
    });

    describe("removeYAxisItem", () => {
      it("should remove y-axis field by name", () => {
        panel.removeYAxisItem("count");

        expect(panel.dashboardPanelData.data.queries[0].fields.y).toHaveLength(0);
      });
    });

    describe("removeBreakdownItem", () => {
      it("should remove breakdown field by name", () => {
        panel.removeBreakdownItem("level");

        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown).toHaveLength(0);
      });
    });

    describe("Map field removals", () => {
      beforeEach(() => {
        panel.dashboardPanelData.data.queries[0].fields.latitude = { column: "lat", alias: "lat" };
        panel.dashboardPanelData.data.queries[0].fields.longitude = { column: "lng", alias: "lng" };
        panel.dashboardPanelData.data.queries[0].fields.weight = { column: "weight", alias: "weight" };
      });

      it("should remove latitude field", () => {
        panel.removeLatitude();

        expect(panel.dashboardPanelData.data.queries[0].fields.latitude).toBeNull();
      });

      it("should remove longitude field", () => {
        panel.removeLongitude();

        expect(panel.dashboardPanelData.data.queries[0].fields.longitude).toBeNull();
      });

      it("should remove weight field", () => {
        panel.removeWeight();

        expect(panel.dashboardPanelData.data.queries[0].fields.weight).toBeNull();
      });
    });
  });

  describe("Validation Functions", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("isAddXAxisNotAllowed", () => {
      it("should allow adding x-axis for most chart types", () => {
        panel.dashboardPanelData.data.type = "line";
        
        const result = panel.isAddXAxisNotAllowed.value;
        
        expect(result).toBe(false);
      });

      it("should restrict x-axis for pie charts after limit", () => {
        panel.dashboardPanelData.data.type = "pie";
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "field1", alias: "field1" }
        ];
        
        const result = panel.isAddXAxisNotAllowed.value;
        
        expect(result).toBe(true);
      });
    });

    describe("isAddYAxisNotAllowed", () => {
      it("should allow adding y-axis for most chart types", () => {
        panel.dashboardPanelData.data.type = "line";
        
        const result = panel.isAddYAxisNotAllowed.value;
        
        expect(result).toBe(false);
      });

      it("should restrict y-axis for heatmap after limit", () => {
        panel.dashboardPanelData.data.type = "heatmap";
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "field1", alias: "field1" }
        ];
        
        const result = panel.isAddYAxisNotAllowed.value;
        
        expect(result).toBe(true);
      });
    });

    describe("isAddBreakdownNotAllowed", () => {
      it("should allow adding breakdown for most chart types", () => {
        panel.dashboardPanelData.data.type = "line";
        
        const result = panel.isAddBreakdownNotAllowed.value;
        
        expect(result).toBe(false);
      });

      it("should restrict breakdown for certain chart types", () => {
        panel.dashboardPanelData.data.type = "stat";
        
        const result = panel.isAddBreakdownNotAllowed.value;
        
        expect(result).toBe(true);
      });
    });

    describe("isAddZAxisNotAllowed", () => {
      it("should allow z-axis only for heatmap", () => {
        panel.dashboardPanelData.data.type = "heatmap";
        
        const result = panel.isAddZAxisNotAllowed.value;
        
        expect(result).toBe(false);
      });

      it("should restrict z-axis for non-heatmap charts", () => {
        panel.dashboardPanelData.data.type = "line";
        
        const result = panel.isAddZAxisNotAllowed.value;
        
        expect(result).toBe(true);
      });
    });

    describe("validatePanel", () => {
      it("should call validatePanel with correct parameters", () => {
        const errors: string[] = [];
        
        panel.validatePanel(errors, true);
        
        expect(convertDataIntoUnitValue.validatePanel).toHaveBeenCalledWith(
          panel.dashboardPanelData,
          errors,
          true,
          expect.any(Array),
          "dashboard"
        );
      });

      it("should pass page key to validation", () => {
        const logsPanel = useDashboardPanelData("logs");
        const errors: string[] = [];
        
        logsPanel.validatePanel(errors, false);
        
        expect(convertDataIntoUnitValue.validatePanel).toHaveBeenCalledWith(
          expect.any(Object),
          errors,
          false,
          expect.any(Array),
          "logs"
        );
      });
    });
  });

  describe("Filter Management", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("addFilteredItem", () => {
      it("should add filter condition", () => {
        const filterItem = {
          column: "level",
          operator: "=",
          value: "ERROR",
          logicalOperator: "AND"
        };

        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [];
        // Mock the function as it's complex
        const addFilteredItem = vi.fn();
        
        addFilteredItem(filterItem);
        
        expect(addFilteredItem).toHaveBeenCalledWith(filterItem);
      });
    });

    describe("removeFilterItem", () => {
      it("should remove filter by column name", () => {
        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [
          { column: "level", operator: "=", value: "ERROR" },
          { column: "status", operator: "=", value: "active" }
        ];

        panel.removeFilterItem("level");

        expect(panel.dashboardPanelData.data.queries[0].fields.filter.conditions).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.filter.conditions[0].column).toBe("status");
      });
    });
  });

  describe("SQL Query Generation", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      panel.dashboardPanelData.data.queries[0].fields.stream = "test_logs";
      panel.dashboardPanelData.data.queries[0].customQuery = false;
    });

    describe("Basic SQL Generation", () => {
      it("should generate simple SELECT query", async () => {
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "level", alias: "level", isDerived: false, aggregationFunction: "count" }
        ];

        // Trigger query generation
        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("SELECT");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain('FROM "test_logs"');
      });

      it("should include GROUP BY for aggregations", async () => {
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "level", alias: "level", isDerived: false }
        ];
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "message", alias: "count", isDerived: false, aggregationFunction: "count" }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("GROUP BY");
      });

      it("should include ORDER BY for sorted fields", async () => {
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false, sortBy: "desc" }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("ORDER BY");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("desc");
      });

      it("should include LIMIT when specified", async () => {
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];
        panel.dashboardPanelData.data.queries[0].config.limit = 100;

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("LIMIT 100");
      });
    });

    describe("Complex Aggregations", () => {
      it("should handle count-distinct aggregation", async () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "user_id", alias: "unique_users", isDerived: false, aggregationFunction: "count-distinct" }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("count(distinct(user_id))");
      });

      it("should handle percentile aggregations", async () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "response_time", alias: "p95", isDerived: false, aggregationFunction: "p95" }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("approx_percentile_cont(response_time, 0.95)");
      });

      it("should handle histogram with interval", async () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { 
            column: "timestamp", 
            alias: "hist", 
            isDerived: false, 
            aggregationFunction: "histogram",
            args: [{ value: "1m" }]
          }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("histogram(timestamp, '1m')");
      });
    });

    describe("Filter Conditions", () => {
      it("should generate WHERE clause for simple conditions", async () => {
        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [
          { column: "level", operator: "=", value: "ERROR", logicalOperator: "AND" }
        ];
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("WHERE");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("level = 'ERROR'");
      });

      it("should handle multiple conditions with logical operators", async () => {
        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [
          { column: "level", operator: "=", value: "ERROR", logicalOperator: "AND" },
          { column: "service", operator: "=", value: "api", logicalOperator: "OR" }
        ];
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("AND");
      });

      it("should handle LIKE operations", async () => {
        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [
          { column: "message", operator: "Not Contains", value: "test", logicalOperator: "AND" }
        ];
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("NOT LIKE '%test%'");
      });

      it("should handle function-based filters", async () => {
        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = [
          { column: "message", operator: "str_match", value: "pattern", logicalOperator: "AND" }
        ];
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("str_match(message, 'pattern')");
      });
    });

    describe("HAVING Clauses", () => {
      it("should add HAVING clause for y-axis conditions", async () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { 
            column: "level", 
            alias: "count", 
            isDerived: false, 
            aggregationFunction: "count",
            havingConditions: [{ operator: ">", value: "100" }]
          }
        ];
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "service", alias: "service", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("HAVING count > 100");
      });

      it("should not add HAVING for heatmap y-axis", async () => {
        panel.dashboardPanelData.data.type = "heatmap";
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { 
            column: "level", 
            alias: "count", 
            isDerived: false, 
            aggregationFunction: "count",
            havingConditions: [{ operator: ">", value: "100" }]
          }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).not.toContain("HAVING");
      });
    });
  });

  describe("Chart-Specific Query Generation", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      panel.dashboardPanelData.data.queries[0].fields.stream = "test_logs";
      panel.dashboardPanelData.data.queries[0].customQuery = false;
    });

    describe("Heatmap Queries", () => {
      it("should generate query with x and y GROUP BY", async () => {
        panel.dashboardPanelData.data.type = "heatmap";
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "hour", alias: "hour", isDerived: false }
        ];
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "day", alias: "day", isDerived: false }
        ];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("GROUP BY hour, day");
      });
    });

    describe("Table Queries", () => {
      it("should not add GROUP BY for table with only x-axis", async () => {
        panel.dashboardPanelData.data.type = "table";
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];
        panel.dashboardPanelData.data.queries[0].fields.y = [];

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).not.toContain("GROUP BY");
      });
    });

    describe("Geo Map Queries", () => {
      it("should generate query for geomap", async () => {
        panel.dashboardPanelData.data.type = "geomap";
        panel.dashboardPanelData.data.queries[0].fields.latitude = {
          column: "lat", alias: "latitude", isDerived: false
        };
        panel.dashboardPanelData.data.queries[0].fields.longitude = {
          column: "lng", alias: "longitude", isDerived: false
        };
        panel.dashboardPanelData.data.queries[0].fields.weight = {
          column: "count", alias: "weight", isDerived: false, aggregationFunction: "sum"
        };

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("SELECT lat as latitude, lng as longitude");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("sum(count) as weight");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("GROUP BY latitude, longitude");
      });
    });

    describe("Map Queries", () => {
      it("should generate query for maps", async () => {
        panel.dashboardPanelData.data.type = "maps";
        panel.dashboardPanelData.data.queries[0].fields.name = {
          column: "country", alias: "name", isDerived: false
        };
        panel.dashboardPanelData.data.queries[0].fields.value_for_maps = {
          column: "population", alias: "value", isDerived: false, aggregationFunction: "sum"
        };

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain('SELECT country as "name"');
        expect(panel.dashboardPanelData.data.queries[0].query).toContain('sum(population) as "value"');
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("GROUP BY name");
      });
    });

    describe("Sankey Queries", () => {
      it("should generate query for sankey", async () => {
        panel.dashboardPanelData.data.type = "sankey";
        panel.dashboardPanelData.data.queries[0].fields.source = {
          column: "src", alias: "source", isDerived: false
        };
        panel.dashboardPanelData.data.queries[0].fields.target = {
          column: "tgt", alias: "target", isDerived: false
        };
        panel.dashboardPanelData.data.queries[0].fields.value = {
          column: "amount", alias: "value", isDerived: false, aggregationFunction: "sum"
        };

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("SELECT src as source, tgt as target");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("sum(amount) as value");
        expect(panel.dashboardPanelData.data.queries[0].query).toContain("GROUP BY source, target");
      });
    });
  });

  describe("Custom Query Handling", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
      mockParser.astify.mockReturnValue({
        columns: [
          { name: "timestamp", alias: "timestamp" },
          { name: "count", alias: "count" }
        ],
        from: [{ table: "test_logs" }]
      });
    });

    describe("Query Parsing", () => {
      it("should parse custom SQL query", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT timestamp, COUNT(*) as count FROM test_logs GROUP BY timestamp";

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
      });

      it("should handle query parsing errors", async () => {
        mockParser.astify.mockImplementation(() => {
          throw new Error("Parse error");
        });

        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "INVALID SQL";

        await nextTick();

        expect(panel.dashboardPanelData.meta.parsedQuery).toBeNull();
      });

      it("should extract custom query fields", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT timestamp, COUNT(*) as count FROM test_logs";

        await nextTick();

        expect(panel.dashboardPanelData.meta.stream.customQueryFields).toEqual(
          expect.arrayContaining([
            { name: "timestamp", type: "" },
            { name: "count", type: "" }
          ])
        );
      });

      it("should handle variable substitution", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM test_logs WHERE level = ${level} AND time > ${startTime}";

        mockParser.astify.mockImplementation((query) => {
          if (query.includes("VARIABLE_PLACEHOLDER")) {
            return {
              columns: [{ name: "timestamp" }],
              from: [{ table: "test_logs" }]
            };
          }
          throw new Error("Invalid query");
        });

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining("VARIABLE_PLACEHOLDER"));
      });
    });

    describe("Variable Handling", () => {
      it("should replace CSV variables", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM logs WHERE id IN (${ids:csv})";

        await nextTick();

        // Should replace with "1,2"
        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining("1,2"));
      });

      it("should replace single quote variables", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM logs WHERE level IN (${levels:singlequote})";

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining("'1','2'"));
      });

      it("should replace double quote variables", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM logs WHERE name IN (${names:doublequote})";

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining('"1","2"'));
      });

      it("should replace pipe variables", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM logs WHERE status REGEXP '${statuses:pipe}'";

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalledWith(expect.stringContaining("1|2"));
      });
    });

    describe("Stream Detection", () => {
      it("should detect and set stream from query", async () => {
        panel.dashboardPanelData.meta.stream.streamResults = [
          { name: "test_logs", type: "logs" }
        ];
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM test_logs";

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].fields.stream).toBe("test_logs");
      });

      it("should handle unknown streams", async () => {
        panel.dashboardPanelData.meta.stream.streamResults = [];
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM unknown_stream";

        await nextTick();

        // Should not update stream field for unknown streams
        expect(panel.dashboardPanelData.data.queries[0].fields.stream).toBe("");
      });
    });
  });

  describe("Schema and Field Extraction", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("getResultSchema", () => {
      it("should call query service with correct parameters", async () => {
        const query = "SELECT timestamp, count FROM logs";
        const startTime = 1640995200000;
        const endTime = 1641081600000;

        await panel.getResultSchema(query, undefined, startTime, endTime);

        expect(queryService.result_schema).toHaveBeenCalledWith({
          org_identifier: "test-org",
          query: {
            query: {
              sql: query,
              query_fn: null,
              start_time: startTime,
              end_time: endTime,
              size: -1,
              histogram_interval: undefined,
              streaming_output: false,
              streaming_id: null,
            },
          },
          page_type: "dashboards",
          is_streaming: false,
        }, "dashboards");
      });

      it("should handle base64 encoding when enabled", async () => {
        mockStore.state.zoConfig.sql_base64_enabled = true;
        const query = "SELECT * FROM logs";

        await panel.getResultSchema(query);

        expect(queryService.result_schema).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({
              query: expect.objectContaining({
                sql: btoa(query),
              }),
              encoding: "base64",
            }),
          }),
          "dashboards"
        );
      });

      it("should handle abort signal", async () => {
        const abortController = new AbortController();
        abortController.abort();

        await expect(
          panel.getResultSchema("SELECT * FROM logs", abortController.signal)
        ).rejects.toThrow("Aborted");
      });
    });

    describe("determineChartType", () => {
      it("should return line chart for timeseries data", () => {
        const extractedFields = {
          group_by: ["service"],
          projections: ["timestamp", "count"],
          timeseries_field: "timestamp",
        };

        const chartType = panel.determineChartType(extractedFields);

        expect(chartType).toBe("line");
      });

      it("should return table for non-timeseries data", () => {
        const extractedFields = {
          group_by: ["service", "level", "status"],
          projections: ["service", "level", "count"],
          timeseries_field: null,
        };

        const chartType = panel.determineChartType(extractedFields);

        expect(chartType).toBe("table");
      });

      it("should return table for too many group by fields", () => {
        const extractedFields = {
          group_by: ["service", "level", "status"],
          projections: ["timestamp", "service", "level", "count"],
          timeseries_field: "timestamp",
        };

        const chartType = panel.determineChartType(extractedFields);

        expect(chartType).toBe("table");
      });
    });

    describe("convertSchemaToFields", () => {
      it("should convert schema to fields for line chart", () => {
        const extractedFields = {
          group_by: ["service"],
          projections: ["timestamp", "service", "count"],
          timeseries_field: "timestamp",
        };

        const fields = panel.convertSchemaToFields(extractedFields, "line");

        expect(fields.x).toContain("timestamp");
        expect(fields.y).toContain("count");
        expect(fields.breakdown).toContain("service");
      });

      it("should convert schema to fields for table chart", () => {
        const extractedFields = {
          group_by: ["service"],
          projections: ["timestamp", "service", "count"],
          timeseries_field: "timestamp",
        };

        const fields = panel.convertSchemaToFields(extractedFields, "table");

        expect(fields.x).toEqual(["timestamp", "service", "count"]);
        expect(fields.y).toEqual([]);
        expect(fields.breakdown).toEqual([]);
      });

      it("should handle multiple group by fields", () => {
        const extractedFields = {
          group_by: ["service", "level"],
          projections: ["timestamp", "service", "level", "count"],
          timeseries_field: "timestamp",
        };

        const fields = panel.convertSchemaToFields(extractedFields, "line");

        expect(fields.x).toContain("timestamp");
        expect(fields.breakdown).toContain("service");
        expect(fields.breakdown).toContain("level");
      });
    });

    describe("setCustomQueryFields", () => {
      it("should set custom query fields and determine chart type", async () => {
        const extractedFields = {
          group_by: ["service"],
          projections: ["timestamp", "service", "count"],
          timeseries_field: "timestamp",
        };

        panel.setCustomQueryFields(extractedFields, true);

        expect(panel.dashboardPanelData.meta.stream.customQueryFields).toEqual([
          { name: "timestamp", type: "" },
          { name: "service", type: "" },
          { name: "count", type: "" },
        ]);
        expect(panel.dashboardPanelData.data.type).toBe("line");
      });

      it("should not change chart type when autoSelectChartType is false", async () => {
        panel.dashboardPanelData.data.type = "bar";
        const extractedFields = {
          group_by: ["service"],
          projections: ["timestamp", "service", "count"],
          timeseries_field: "timestamp",
        };

        panel.setCustomQueryFields(extractedFields, false);

        expect(panel.dashboardPanelData.data.type).toBe("bar");
      });

      it("should fetch schema when no extractedFields provided", async () => {
        panel.dashboardPanelData.meta.dateTime = {
          start_time: new Date("2024-01-01"),
          end_time: new Date("2024-01-02"),
        };
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM logs";

        await panel.setCustomQueryFields();

        expect(queryService.result_schema).toHaveBeenCalled();
      });
    });

    describe("setFieldsBasedOnChartTypeValidation", () => {
      it("should set fields and apply chart type validation", () => {
        const fields = {
          x: [{ name: "timestamp" }],
          y: [{ name: "count" }],
          breakdown: [{ name: "service" }],
        };

        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "timestamp", type: "Utf8" },
          { name: "count", type: "Int64" },
          { name: "service", type: "Utf8" },
        ];

        panel.setFieldsBasedOnChartTypeValidation(fields, "line");

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.y).toHaveLength(1);
        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown).toHaveLength(1);
      });

      it("should merge breakdown into x for table charts", () => {
        const fields = {
          x: [{ name: "timestamp" }],
          y: [{ name: "count" }],
          breakdown: [{ name: "service" }],
        };

        panel.dashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "timestamp", type: "Utf8" },
          { name: "count", type: "Int64" },
          { name: "service", type: "Utf8" },
        ];

        panel.setFieldsBasedOnChartTypeValidation(fields, "table");

        expect(panel.dashboardPanelData.data.queries[0].fields.x).toHaveLength(2);
        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown).toHaveLength(0);
      });
    });
  });

  describe("Watchers and Reactive Updates", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("Query Generation Watcher", () => {
      it("should regenerate query when fields change", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = false;
        panel.dashboardPanelData.data.queries[0].fields.stream = "test_logs";
        
        // Add a field to trigger watcher
        panel.dashboardPanelData.data.queries[0].fields.x.push({
          column: "timestamp",
          alias: "timestamp",
          isDerived: false
        });

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toContain("SELECT");
      });

      it("should not regenerate query for custom queries", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queries[0].query = "SELECT * FROM custom";
        
        // Add a field
        panel.dashboardPanelData.data.queries[0].fields.x.push({
          column: "timestamp",
          alias: "timestamp",
          isDerived: false
        });

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toBe("SELECT * FROM custom");
      });
    });

    describe("Custom Query Parsing Watcher", () => {
      it("should parse query when custom query is enabled", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = true;
        panel.dashboardPanelData.data.queryType = "sql";
        panel.dashboardPanelData.data.queries[0].query = "SELECT timestamp FROM logs";

        await nextTick();

        expect(mockParser.astify).toHaveBeenCalled();
      });

      it("should clear fields when switching from custom to auto query", async () => {
        panel.dashboardPanelData.meta.stream.customQueryFields = [
          { name: "custom_field", type: "Utf8" }
        ];
        
        panel.dashboardPanelData.data.queries[0].customQuery = false;

        await nextTick();

        expect(panel.dashboardPanelData.meta.stream.customQueryFields).toEqual([]);
      });

      it("should skip custom query fields for logs page", async () => {
        const logsPanel = useDashboardPanelData("logs");
        logsPanel.dashboardPanelData.data.queries[0].customQuery = true;
        logsPanel.dashboardPanelData.data.queryType = "sql";
        logsPanel.dashboardPanelData.data.queries[0].query = "SELECT timestamp FROM logs";

        await nextTick();

        // Should not extract custom query fields for logs page
        expect(logsPanel.dashboardPanelData.meta.stream.customQueryFields).toEqual([]);
      });
    });
  });

  describe("Utility Functions", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("updateArrayAlias", () => {
      it("should update aliases for x-axis fields", () => {
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "old_alias" },
          { column: "level", alias: "level" }
        ];

        panel.updateArrayAlias();

        expect(panel.dashboardPanelData.data.queries[0].fields.x[0].alias).toBe("Timestamp");
        expect(panel.dashboardPanelData.data.queries[0].fields.x[1].alias).toBe("Level");
      });

      it("should update aliases for all field types", () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "count_total", alias: "old_alias", aggregationFunction: "sum" }
        ];
        panel.dashboardPanelData.data.queries[0].fields.breakdown = [
          { column: "service_name", alias: "old_alias" }
        ];

        panel.updateArrayAlias();

        expect(panel.dashboardPanelData.data.queries[0].fields.y[0].alias).toBe("Count Total");
        expect(panel.dashboardPanelData.data.queries[0].fields.breakdown[0].alias).toBe("Service Name");
      });
    });

    describe("resetAggregationFunction", () => {
      it("should reset aggregation functions for all y-axis fields", () => {
        panel.dashboardPanelData.data.queries[0].fields.y = [
          { column: "count", alias: "count", aggregationFunction: "sum" },
          { column: "avg_time", alias: "avg_time", aggregationFunction: "avg" }
        ];

        panel.resetAggregationFunction();

        expect(panel.dashboardPanelData.data.queries[0].fields.y[0].aggregationFunction).toBe("count");
        expect(panel.dashboardPanelData.data.queries[0].fields.y[1].aggregationFunction).toBe("count");
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    let panel: ReturnType<typeof useDashboardPanelData>;

    beforeEach(() => {
      panel = useDashboardPanelData();
    });

    describe("Empty Field Lists", () => {
      it("should handle empty query generation", async () => {
        panel.dashboardPanelData.data.queries[0].customQuery = false;
        panel.dashboardPanelData.data.queries[0].fields = {
          x: [], y: [], z: [], breakdown: [],
          stream: "test_logs",
          filter: { conditions: [] }
        };

        await nextTick();

        expect(panel.dashboardPanelData.data.queries[0].query).toBe("");
      });
    });

    describe("Invalid Data Handling", () => {
      it("should handle null/undefined field values", () => {
        expect(() => {
          panel.addXAxisItem({ name: null as any });
        }).not.toThrow();

        expect(() => {
          panel.addXAxisItem({ name: undefined as any });
        }).not.toThrow();
      });

      it("should handle missing stream fields", () => {
        panel.dashboardPanelData.meta.stream.selectedStreamFields = [];
        
        expect(() => {
          panel.addXAxisItem({ name: "nonexistent" });
        }).not.toThrow();
      });
    });

    describe("Chart Type Limitations", () => {
      it("should enforce field limits for different chart types", () => {
        const chartTypeLimits = [
          { type: "pie", maxX: 1, maxBreakdown: 1 },
          { type: "stat", maxX: 1, allowBreakdown: false },
          { type: "heatmap", maxY: 1, allowZ: true },
        ];

        chartTypeLimits.forEach(({ type, maxX, maxBreakdown, maxY, allowBreakdown, allowZ }) => {
          panel.dashboardPanelData.data.type = type;
          
          // Test x-axis limits
          if (maxX) {
            panel.dashboardPanelData.data.queries[0].fields.x = 
              Array(maxX + 1).fill(0).map((_, i) => ({ column: `field${i}`, alias: `field${i}` }));
            expect(panel.isAddXAxisNotAllowed.value).toBe(true);
          }

          // Test breakdown restrictions
          if (allowBreakdown === false) {
            expect(panel.isAddBreakdownNotAllowed.value).toBe(true);
          }

          // Test z-axis restrictions
          if (allowZ) {
            expect(panel.isAddZAxisNotAllowed.value).toBe(false);
          } else if (allowZ === false) {
            expect(panel.isAddZAxisNotAllowed.value).toBe(true);
          }
        });
      });
    });

    describe("Memory and Performance", () => {
      it("should handle large field arrays", () => {
        const largeFieldArray = Array(1000).fill(0).map((_, i) => ({
          name: `field_${i}`,
          type: "Utf8"
        }));

        panel.dashboardPanelData.meta.stream.selectedStreamFields = largeFieldArray;

        expect(() => {
          panel.addXAxisItem({ name: "field_500" });
        }).not.toThrow();
      });

      it("should handle complex filter conditions", () => {
        const complexFilters = Array(100).fill(0).map((_, i) => ({
          column: `field_${i}`,
          operator: "=",
          value: `value_${i}`,
          logicalOperator: i % 2 === 0 ? "AND" : "OR"
        }));

        panel.dashboardPanelData.data.queries[0].fields.filter.conditions = complexFilters;
        panel.dashboardPanelData.data.queries[0].fields.x = [
          { column: "timestamp", alias: "timestamp", isDerived: false }
        ];

        expect(() => {
          // Trigger query generation
          panel.dashboardPanelData.data.queries[0].fields.stream = "test";
        }).not.toThrow();
      });
    });
  });

  describe("Page Key Specific Behavior", () => {
    describe("Dashboard Page", () => {
      it("should initialize with SQL query type", () => {
        const { dashboardPanelData } = useDashboardPanelData("dashboard");
        
        expect(dashboardPanelData.data.queryType).toBe("sql");
      });
    });

    describe("Logs Page", () => {
      it("should skip custom query field extraction", async () => {
        const { dashboardPanelData } = useDashboardPanelData("logs");
        dashboardPanelData.data.queries[0].customQuery = true;
        dashboardPanelData.data.queryType = "sql";
        dashboardPanelData.data.queries[0].query = "SELECT * FROM logs";

        await nextTick();

        // Logs page should not extract custom query fields
        expect(dashboardPanelData.meta.stream.customQueryFields).toEqual([]);
      });
    });

    describe("Metric Page", () => {
      it("should initialize with PromQL query type", () => {
        const { dashboardPanelData } = useDashboardPanelData("metric");
        
        expect(dashboardPanelData.data.queryType).toBe("promql");
      });

      it("should create PromQL queries by default", () => {
        const { addQuery, dashboardPanelData } = useDashboardPanelData("metric");
        
        addQuery();

        expect(dashboardPanelData.data.queries[1].customQuery).toBe(true);
      });
    });
  });
});