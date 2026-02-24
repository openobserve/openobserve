import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, reactive, nextTick } from "vue";
import { usePanelEditor } from "./usePanelEditor";

// Mock vuex store
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      timezone: "UTC",
      theme: "light",
    },
    commit: vi.fn(),
  }),
}));

// Mock utility functions
vi.mock("@/utils/dashboard/checkConfigChangeApiCall", () => ({
  checkIfConfigChangeRequiredApiCallOrNot: vi.fn().mockReturnValue(false),
}));

vi.mock("@/utils/zincutils", () => ({
  processQueryMetadataErrors: vi.fn().mockReturnValue(""),
}));

vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: ref([]),
    cancelQuery: vi.fn(),
  }),
}));

describe("usePanelEditor", () => {
  let dashboardPanelData: any;
  let options: any;

  beforeEach(() => {
    // Reset dashboard panel data before each test
    dashboardPanelData = reactive({
      data: {
        description: "",
        type: "line",
        config: {
          unit: null,
          unit_custom: null,
        },
        queries: [
          {
            query: "SELECT * FROM logs",
            customQuery: false,
            fields: {
              stream: "logs",
              stream_type: "logs",
              x: [],
              y: [],
              z: [],
              breakdown: [],
              filter: {
                conditions: [],
              },
            },
          },
        ],
        htmlContent: "",
        markdownContent: "",
        customChartContent: "",
      },
      layout: {
        splitter: 20,
        showFieldList: true,
        showQueryBar: true,
        querySplitter: 50,
        currentQueryIndex: 0,
        isConfigPanelOpen: false,
      },
      meta: {
        dateTime: {
          start_time: new Date("2024-01-01T00:00:00Z"),
          end_time: new Date("2024-01-02T00:00:00Z"),
        },
        stream: {
          customQueryFields: [],
          vrlFunctionFieldList: [],
        },
        streamFields: {
          groupedFields: [],
        },
      },
    });

    options = {
      pageType: "dashboard" as const,
      config: {
        showQueryEditor: true,
        showQueryBuilder: true,
        showVariablesSelector: true,
        showLastRefreshedTime: true,
        showOutdatedWarning: true,
        showAddToDashboardButton: false,
        showQueryTypeSelector: false,
        showGeneratedQueryDisplay: false,
        hideChartPreview: false,
      },
      dashboardPanelData,
      editMode: ref(false),
      externalChartData: undefined,
      variablesData: undefined,
      updatedVariablesData: undefined,
      updateCommittedVariables: undefined,
      dateTimePickerRef: undefined,
      selectedDate: undefined,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("collapseFieldList", () => {
    it("should collapse field list when it is currently shown", () => {
      const { collapseFieldList } = usePanelEditor(options);

      expect(dashboardPanelData.layout.showFieldList).toBe(true);
      expect(dashboardPanelData.layout.splitter).toBe(20);

      collapseFieldList();

      expect(dashboardPanelData.layout.showFieldList).toBe(false);
      expect(dashboardPanelData.layout.splitter).toBe(0);
    });

    it("should expand field list when it is currently hidden", () => {
      dashboardPanelData.layout.showFieldList = false;
      dashboardPanelData.layout.splitter = 0;

      const { collapseFieldList } = usePanelEditor(options);

      collapseFieldList();

      expect(dashboardPanelData.layout.showFieldList).toBe(true);
      expect(dashboardPanelData.layout.splitter).toBe(20);
    });

    it("should toggle field list visibility on multiple calls", () => {
      const { collapseFieldList } = usePanelEditor(options);

      // Initial state: expanded
      expect(dashboardPanelData.layout.showFieldList).toBe(true);

      // First call: collapse
      collapseFieldList();
      expect(dashboardPanelData.layout.showFieldList).toBe(false);

      // Second call: expand
      collapseFieldList();
      expect(dashboardPanelData.layout.showFieldList).toBe(true);

      // Third call: collapse again
      collapseFieldList();
      expect(dashboardPanelData.layout.showFieldList).toBe(false);
    });
  });

  describe("layoutSplitterUpdated", () => {
    it("should dispatch resize event", () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      const { layoutSplitterUpdated } = usePanelEditor(options);
      layoutSplitterUpdated();

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
      expect(dispatchEventSpy.mock.calls[0][0].type).toBe("resize");
    });
  });

  describe("querySplitterUpdated", () => {
    it("should dispatch resize event", () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      const { querySplitterUpdated } = usePanelEditor(options);
      querySplitterUpdated(60);

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
      expect(dispatchEventSpy.mock.calls[0][0].type).toBe("resize");
    });

    it("should update expandedSplitterHeight when query bar is shown", () => {
      dashboardPanelData.layout.showQueryBar = true;

      const { querySplitterUpdated, expandedSplitterHeight } = usePanelEditor(options);
      querySplitterUpdated(75);

      expect(expandedSplitterHeight.value).toBe(75);
    });

    it("should not update expandedSplitterHeight when query bar is hidden", () => {
      dashboardPanelData.layout.showQueryBar = false;

      const { querySplitterUpdated, expandedSplitterHeight } = usePanelEditor(options);
      querySplitterUpdated(75);

      expect(expandedSplitterHeight.value).toBeNull();
    });
  });

  describe("seriesDataUpdate", () => {
    it("should update seriesData with provided data", () => {
      const { seriesDataUpdate, seriesData } = usePanelEditor(options);

      const testData = [
        { name: "series1", data: [1, 2, 3] },
        { name: "series2", data: [4, 5, 6] },
      ];

      seriesDataUpdate(testData);

      expect(seriesData.value).toEqual(testData);
    });

    it("should handle empty array", () => {
      const { seriesDataUpdate, seriesData } = usePanelEditor(options);

      seriesDataUpdate([]);

      expect(seriesData.value).toEqual([]);
    });

    it("should replace previous data", () => {
      const { seriesDataUpdate, seriesData } = usePanelEditor(options);

      seriesDataUpdate([{ name: "old" }]);
      seriesDataUpdate([{ name: "new" }]);

      expect(seriesData.value).toEqual([{ name: "new" }]);
    });

    it("should handle complex seriesData structures", () => {
      const { seriesDataUpdate, seriesData } = usePanelEditor(options);

      const complexData = [
        {
          name: "CPU Usage",
          type: "line",
          data: [
            [1704067200000, 45.5],
            [1704070800000, 52.3],
            [1704074400000, 48.1],
          ],
          stack: "total",
          areaStyle: { opacity: 0.5 },
          itemStyle: { color: "#5470c6" },
        },
        {
          name: "Memory Usage",
          type: "bar",
          data: [
            [1704067200000, 78.2],
            [1704070800000, 82.1],
            [1704074400000, 79.5],
          ],
          barWidth: "60%",
          label: { show: true, position: "top" },
        },
        {
          name: "Network I/O",
          type: "scatter",
          data: [
            { value: [100, 200], symbolSize: 10 },
            { value: [150, 250], symbolSize: 15 },
          ],
        },
      ];

      seriesDataUpdate(complexData);

      expect(seriesData.value).toEqual(complexData);
      expect(seriesData.value[0].areaStyle).toEqual({ opacity: 0.5 });
      expect(seriesData.value[1].label).toEqual({ show: true, position: "top" });
      expect(seriesData.value[2].data[0].symbolSize).toBe(10);
    });

    it("should handle nested object data", () => {
      const { seriesDataUpdate, seriesData } = usePanelEditor(options);

      const nestedData = [
        {
          name: "test",
          data: {
            values: [1, 2, 3],
            metadata: {
              source: "api",
              timestamp: Date.now(),
            },
          },
        },
      ];

      seriesDataUpdate(nestedData);

      expect(seriesData.value).toEqual(nestedData);
    });
  });

  describe("metaDataValue", () => {
    it("should update metaData with provided metadata", () => {
      const { metaDataValue, metaData } = usePanelEditor(options);

      const testMetadata = {
        total: 100,
        took: 50,
        scan_records: 1000,
      };

      metaDataValue(testMetadata);

      expect(metaData.value).toEqual(testMetadata);
    });

    it("should handle null metadata", () => {
      const { metaDataValue, metaData } = usePanelEditor(options);

      metaDataValue(null);

      expect(metaData.value).toBeNull();
    });

    it("should replace previous metadata", () => {
      const { metaDataValue, metaData } = usePanelEditor(options);

      metaDataValue({ total: 10 });
      metaDataValue({ total: 20 });

      expect(metaData.value).toEqual({ total: 20 });
    });
  });

  describe("hoveredSeriesState", () => {
    it("should initialize with default values", () => {
      const { hoveredSeriesState } = usePanelEditor(options);

      expect(hoveredSeriesState.value.hoveredSeriesName).toBe("");
      expect(hoveredSeriesState.value.panelId).toBe(-1);
      expect(hoveredSeriesState.value.dataIndex).toBe(-1);
      expect(hoveredSeriesState.value.seriesIndex).toBe(-1);
      expect(hoveredSeriesState.value.hoveredTime).toBeNull();
    });

    it("should update hoveredSeriesName via setHoveredSeriesName", () => {
      const { hoveredSeriesState } = usePanelEditor(options);

      hoveredSeriesState.value.setHoveredSeriesName("testSeries");

      expect(hoveredSeriesState.value.hoveredSeriesName).toBe("testSeries");
    });

    it("should handle null/undefined in setHoveredSeriesName", () => {
      const { hoveredSeriesState } = usePanelEditor(options);

      hoveredSeriesState.value.setHoveredSeriesName(null as any);

      expect(hoveredSeriesState.value.hoveredSeriesName).toBe("");
    });

    it("should update indices via setIndex", () => {
      const { hoveredSeriesState } = usePanelEditor(options);

      hoveredSeriesState.value.setIndex(5, 3, "panel-1", new Date("2024-01-01"));

      expect(hoveredSeriesState.value.dataIndex).toBe(5);
      expect(hoveredSeriesState.value.seriesIndex).toBe(3);
      expect(hoveredSeriesState.value.panelId).toBe("panel-1");
      expect(hoveredSeriesState.value.hoveredTime).toBeInstanceOf(Date);
    });

    it("should handle null values in setIndex", () => {
      const { hoveredSeriesState } = usePanelEditor(options);

      hoveredSeriesState.value.setIndex(null as any, null as any, null as any, null);

      expect(hoveredSeriesState.value.dataIndex).toBe(-1);
      expect(hoveredSeriesState.value.seriesIndex).toBe(-1);
      expect(hoveredSeriesState.value.panelId).toBe(-1);
      expect(hoveredSeriesState.value.hoveredTime).toBeNull();
    });
  });

  describe("updateVrlFunctionFieldList", () => {
    it("should filter out alias fields and update vrlFunctionFieldList", () => {
      // Setup with x and y fields that have aliases
      dashboardPanelData.data.queries[0].fields.x = [
        { alias: "timestamp", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].fields.y = [
        { alias: "count", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["timestamp", "count", "vrlField1", "vrlField2"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "vrlField1", type: "Utf8" },
        { name: "vrlField2", type: "Utf8" },
      ]);
    });

    it("should filter out customQueryFields", () => {
      dashboardPanelData.meta.stream.customQueryFields = [{ name: "customField" }];
      dashboardPanelData.data.queries[0].customQuery = true;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["customField", "vrlField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "vrlField", type: "Utf8" },
      ]);
    });

    it("should handle empty field list", () => {
      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      updateVrlFunctionFieldList([]);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([]);
    });

    it("should be case insensitive when filtering aliases", () => {
      dashboardPanelData.data.queries[0].fields.x = [
        { alias: "Timestamp", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["timestamp", "TIMESTAMP", "newField"];
      updateVrlFunctionFieldList(fieldList);

      // Both "timestamp" and "TIMESTAMP" should be filtered out
      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "newField", type: "Utf8" },
      ]);
    });

    it("should filter out latitude and longitude fields", () => {
      dashboardPanelData.data.queries[0].fields.latitude = {
        alias: "lat_field",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].fields.longitude = {
        alias: "lng_field",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["lat_field", "lng_field", "otherField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "otherField", type: "Utf8" },
      ]);
    });

    it("should filter out weight, source, target fields", () => {
      dashboardPanelData.data.queries[0].fields.weight = {
        alias: "weight_val",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].fields.source = {
        alias: "source_node",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].fields.target = {
        alias: "target_node",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["weight_val", "source_node", "target_node", "remainingField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "remainingField", type: "Utf8" },
      ]);
    });

    it("should filter out value, name, and value_for_maps fields", () => {
      dashboardPanelData.data.queries[0].fields.value = {
        alias: "val",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].fields.name = {
        alias: "item_name",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].fields.value_for_maps = {
        alias: "map_value",
        isDerived: false,
      };
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["val", "item_name", "map_value", "newField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "newField", type: "Utf8" },
      ]);
    });

    it("should NOT filter out derived fields (isDerived: true)", () => {
      dashboardPanelData.data.queries[0].fields.x = [
        { alias: "derivedField", isDerived: true },
      ];
      dashboardPanelData.data.queries[0].fields.y = [
        { alias: "normalField", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      // derivedField should NOT be filtered out because isDerived is true
      const fieldList = ["derivedField", "normalField", "vrlField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "derivedField", type: "Utf8" },
        { name: "vrlField", type: "Utf8" },
      ]);
    });

    it("should filter out breakdown fields", () => {
      dashboardPanelData.data.queries[0].fields.breakdown = [
        { alias: "category", isDerived: false },
        { alias: "region", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["category", "region", "newField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "newField", type: "Utf8" },
      ]);
    });

    it("should filter out z-axis fields", () => {
      dashboardPanelData.data.queries[0].fields.z = [
        { alias: "z_value", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["z_value", "otherField"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "otherField", type: "Utf8" },
      ]);
    });

    it("should handle fields with empty arrays", () => {
      // Set fields to empty arrays (valid state)
      dashboardPanelData.data.queries[0].fields.x = [];
      dashboardPanelData.data.queries[0].fields.y = [];
      dashboardPanelData.data.queries[0].fields.z = [];
      dashboardPanelData.data.queries[0].fields.breakdown = [];
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      // Should not throw and should work with remaining fields
      const fieldList = ["field1", "field2"];
      updateVrlFunctionFieldList(fieldList);

      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "field1", type: "Utf8" },
        { name: "field2", type: "Utf8" },
      ]);
    });

    it("should skip filtering when customQuery is true", () => {
      // With customQuery=true, x/y/z/breakdown aliases should NOT be filtered
      dashboardPanelData.data.queries[0].fields.x = [
        { alias: "timestamp", isDerived: false },
      ];
      dashboardPanelData.data.queries[0].customQuery = true;
      dashboardPanelData.meta.stream.customQueryFields = [];

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      const fieldList = ["timestamp", "otherField"];
      updateVrlFunctionFieldList(fieldList);

      // Both fields should remain since customQuery is true
      expect(dashboardPanelData.meta.stream.vrlFunctionFieldList).toEqual([
        { name: "timestamp", type: "Utf8" },
        { name: "otherField", type: "Utf8" },
      ]);
    });
  });

  describe("isOutDated", () => {
    it("should return false for initial dashboard panel data", () => {
      // Use default empty panel data
      const { isOutDated } = usePanelEditor(options);

      expect(isOutDated.value).toBe(false);
    });

    it("should return false for logs mode with external chart data", () => {
      options.pageType = "logs";
      options.externalChartData = ref({ type: "line" });

      const { isOutDated } = usePanelEditor(options);

      expect(isOutDated.value).toBe(false);
    });
  });

  describe("runQuery", () => {
    it("should copy dashboardPanelData.data to chartData", () => {
      const { runQuery, chartData } = usePanelEditor(options);

      runQuery();

      expect(chartData.value).toEqual(dashboardPanelData.data);
    });

    it("should set shouldRefreshWithoutCache when withoutCache is true", () => {
      const { runQuery, shouldRefreshWithoutCache } = usePanelEditor(options);

      runQuery(true);

      expect(shouldRefreshWithoutCache.value).toBe(true);
    });

    it("should not set shouldRefreshWithoutCache when withoutCache is false", () => {
      const { runQuery, shouldRefreshWithoutCache } = usePanelEditor(options);

      runQuery(false);

      expect(shouldRefreshWithoutCache.value).toBe(false);
    });

    it("should call updateCommittedVariables when available", () => {
      const mockUpdateCommittedVariables = vi.fn();
      options.updateCommittedVariables = mockUpdateCommittedVariables;
      options.config.showVariablesSelector = true;

      const { runQuery } = usePanelEditor(options);
      runQuery();

      expect(mockUpdateCommittedVariables).toHaveBeenCalled();
    });
  });

  describe("handleChartApiError", () => {
    it("should set errorMessage from string", () => {
      const { handleChartApiError, errorMessage, errorData } = usePanelEditor(options);

      handleChartApiError("Test error message");

      expect(errorMessage.value).toBe("Test error message");
      expect(errorData.errors).toContain("Test error message");
    });

    it("should set errorMessage from object with message property", () => {
      const { handleChartApiError, errorMessage, errorData } = usePanelEditor(options);

      handleChartApiError({ message: "Object error message" });

      expect(errorMessage.value).toBe("Object error message");
      expect(errorData.errors).toContain("Object error message");
    });

    it("should clear errorMessage for non-error values", () => {
      const { handleChartApiError, errorMessage } = usePanelEditor(options);

      // First set an error
      handleChartApiError("Initial error");
      expect(errorMessage.value).toBe("Initial error");

      // Then clear it
      handleChartApiError({});

      expect(errorMessage.value).toBe("");
    });
  });

  describe("handleLastTriggeredAtUpdate", () => {
    it("should update lastTriggeredAt", () => {
      const { handleLastTriggeredAtUpdate, lastTriggeredAt } = usePanelEditor(options);

      const testDate = new Date("2024-01-15T10:30:00Z");
      handleLastTriggeredAtUpdate(testDate);

      expect(lastTriggeredAt.value).toEqual(testDate);
    });
  });

  describe("handleLimitNumberOfSeriesWarningMessage", () => {
    it("should update limitNumberOfSeriesWarningMessage", () => {
      const { handleLimitNumberOfSeriesWarningMessage, limitNumberOfSeriesWarningMessage } =
        usePanelEditor(options);

      handleLimitNumberOfSeriesWarningMessage("Series limit exceeded");

      expect(limitNumberOfSeriesWarningMessage.value).toBe("Series limit exceeded");
    });
  });

  describe("handleResultMetadataUpdate", () => {
    it("should process metadata and update maxQueryRangeWarning", async () => {
      const { handleResultMetadataUpdate, maxQueryRangeWarning } = usePanelEditor(options);
      const { processQueryMetadataErrors } = await import("@/utils/zincutils");

      (processQueryMetadataErrors as any).mockReturnValue("Max query range warning");

      handleResultMetadataUpdate({ some: "metadata" });

      expect(processQueryMetadataErrors).toHaveBeenCalled();
      expect(maxQueryRangeWarning.value).toBe("Max query range warning");
    });
  });

  describe("onDataZoom", () => {
    it("should return start and end dates", () => {
      const { onDataZoom } = usePanelEditor(options);

      const result = onDataZoom({
        start: new Date("2024-01-01T10:30:45Z").getTime(),
        end: new Date("2024-01-01T12:45:30Z").getTime(),
      });

      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
    });

    it("should truncate seconds from dates", () => {
      const { onDataZoom } = usePanelEditor(options);

      const result = onDataZoom({
        start: new Date("2024-01-01T10:30:45Z").getTime(),
        end: new Date("2024-01-01T12:45:30Z").getTime(),
      });

      expect(result.start.getSeconds()).toBe(0);
      expect(result.start.getMilliseconds()).toBe(0);
      expect(result.end.getSeconds()).toBe(0);
      expect(result.end.getMilliseconds()).toBe(0);
    });

    it("should add 1 minute to end if start equals end after truncation", () => {
      const { onDataZoom } = usePanelEditor(options);

      // Same minute, different seconds - will be equal after truncation
      const result = onDataZoom({
        start: new Date("2024-01-01T10:30:15Z").getTime(),
        end: new Date("2024-01-01T10:30:45Z").getTime(),
      });

      expect(result.end.getTime() - result.start.getTime()).toBe(60000); // 1 minute
    });
  });

  describe("resetErrors", () => {
    it("should clear all error states", () => {
      const {
        resetErrors,
        errorData,
        errorMessage,
        maxQueryRangeWarning,
        limitNumberOfSeriesWarningMessage,
        handleChartApiError,
      } = usePanelEditor(options);

      // Set some errors first
      handleChartApiError("Test error");
      maxQueryRangeWarning.value = "Warning 1";
      limitNumberOfSeriesWarningMessage.value = "Warning 2";

      expect(errorData.errors.length).toBeGreaterThan(0);
      expect(errorMessage.value).toBeTruthy();

      // Reset errors
      resetErrors();

      expect(errorData.errors).toHaveLength(0);
      expect(errorMessage.value).toBe("");
      expect(maxQueryRangeWarning.value).toBe("");
      expect(limitNumberOfSeriesWarningMessage.value).toBe("");
    });
  });

  describe("updateDateTime", () => {
    it("should update dashboardPanelData.meta.dateTime", () => {
      const { updateDateTime } = usePanelEditor(options);

      const newDateTime = {
        start_time: new Date("2024-02-01T00:00:00Z").getTime(),
        end_time: new Date("2024-02-02T00:00:00Z").getTime(),
      };

      updateDateTime(newDateTime);

      expect(dashboardPanelData.meta.dateTime.start_time).toEqual(
        new Date("2024-02-01T00:00:00Z")
      );
      expect(dashboardPanelData.meta.dateTime.end_time).toEqual(
        new Date("2024-02-02T00:00:00Z")
      );
    });

    it("should handle string timestamps", () => {
      const { updateDateTime } = usePanelEditor(options);

      const newDateTime = {
        start_time: "2024-02-01T00:00:00Z",
        end_time: "2024-02-02T00:00:00Z",
      };

      updateDateTime(newDateTime);

      expect(dashboardPanelData.meta.dateTime.start_time).toBeInstanceOf(Date);
      expect(dashboardPanelData.meta.dateTime.end_time).toBeInstanceOf(Date);
    });

    it("should not update if dateTime is falsy", () => {
      const { updateDateTime } = usePanelEditor(options);

      const originalStartTime = dashboardPanelData.meta.dateTime.start_time;

      updateDateTime(null as any);

      expect(dashboardPanelData.meta.dateTime.start_time).toEqual(originalStartTime);
    });
  });

  describe("isLoading", () => {
    it("should return true when searchRequestTraceIds has items", async () => {
      const { isLoading, variablesAndPanelsDataLoadingState } = usePanelEditor(options);

      variablesAndPanelsDataLoadingState.searchRequestTraceIds["panel-1"] = ["trace-1"];

      await nextTick();

      expect(isLoading.value).toBe(true);
    });

    it("should return true when disable is true", () => {
      const { isLoading, disable } = usePanelEditor(options);

      disable.value = true;

      expect(isLoading.value).toBe(true);
    });

    it("should return false when no loading indicators", () => {
      const { isLoading } = usePanelEditor(options);

      expect(isLoading.value).toBe(false);
    });
  });

  describe("currentPanelData", () => {
    it("should combine renderer data with config", () => {
      dashboardPanelData.data.config = { unit: "bytes" };

      const { currentPanelData, panelSchemaRendererRef } = usePanelEditor(options);

      // Mock panelSchemaRendererRef
      panelSchemaRendererRef.value = {
        panelData: { series: [{ data: [1, 2, 3] }] },
      };

      expect(currentPanelData.value.series).toEqual([{ data: [1, 2, 3] }]);
      expect(currentPanelData.value.config).toEqual({ unit: "bytes" });
    });

    it("should handle missing panelSchemaRendererRef", () => {
      dashboardPanelData.data.config = { unit: "bytes" };

      const { currentPanelData } = usePanelEditor(options);

      expect(currentPanelData.value.config).toEqual({ unit: "bytes" });
    });
  });

  describe("Multiple Method Calls Together", () => {
    it("should handle multiple method calls in sequence", async () => {
      const {
        seriesDataUpdate,
        metaDataValue,
        handleChartApiError,
        collapseFieldList,
        seriesData,
        metaData,
        errorMessage,
      } = usePanelEditor(options);

      // Call multiple methods in sequence
      seriesDataUpdate([{ name: "test", data: [1, 2, 3] }]);
      metaDataValue({ total: 100, took: 50 });
      handleChartApiError("Test error");
      collapseFieldList();

      // Verify all state updates
      expect(seriesData.value).toEqual([{ name: "test", data: [1, 2, 3] }]);
      expect(metaData.value).toEqual({ total: 100, took: 50 });
      expect(errorMessage.value).toBe("Test error");
      expect(dashboardPanelData.layout.showFieldList).toBe(false);
    });

    it("should handle runQuery followed by error handling", () => {
      const { runQuery, handleChartApiError, chartData, errorMessage } =
        usePanelEditor(options);

      // Run query
      runQuery();
      expect(chartData.value).toBeDefined();

      // Then handle error
      handleChartApiError("Query failed");
      expect(errorMessage.value).toBe("Query failed");
    });

    it("should handle resetErrors after multiple errors", () => {
      const {
        handleChartApiError,
        handleLimitNumberOfSeriesWarningMessage,
        resetErrors,
        errorMessage,
        limitNumberOfSeriesWarningMessage,
        maxQueryRangeWarning,
      } = usePanelEditor(options);

      // Set multiple errors
      handleChartApiError("Error 1");
      handleLimitNumberOfSeriesWarningMessage("Series limit warning");
      maxQueryRangeWarning.value = "Query range warning";

      // Verify errors are set
      expect(errorMessage.value).toBe("Error 1");
      expect(limitNumberOfSeriesWarningMessage.value).toBe("Series limit warning");
      expect(maxQueryRangeWarning.value).toBe("Query range warning");

      // Reset all
      resetErrors();

      // Verify all cleared
      expect(errorMessage.value).toBe("");
      expect(limitNumberOfSeriesWarningMessage.value).toBe("");
      expect(maxQueryRangeWarning.value).toBe("");
    });
  });

  describe("Edge Cases", () => {
    it("should handle single query with minimal fields", () => {
      // Test with minimal but valid query structure
      dashboardPanelData.data.queries = [
        {
          query: "",
          customQuery: false,
          fields: {
            x: [],
            y: [],
            z: [],
            breakdown: [],
            filter: { conditions: [] },
          },
        },
      ];

      // Should not throw when accessing queries
      expect(() => usePanelEditor(options)).not.toThrow();
    });

    it("should handle partial field definitions", () => {
      dashboardPanelData.data.queries[0].fields = {
        x: [{ alias: "timestamp" }], // Missing isDerived
        y: [], // Empty array
        // Missing z, breakdown, filter
      };
      dashboardPanelData.data.queries[0].customQuery = false;

      const { updateVrlFunctionFieldList } = usePanelEditor(options);

      // Should not throw
      expect(() => {
        updateVrlFunctionFieldList(["timestamp", "newField"]);
      }).not.toThrow();
    });

    it("should handle undefined dashboardPanelData properties", () => {
      // The composable should handle missing nested properties
      expect(() => usePanelEditor(options)).not.toThrow();
    });

    it("should handle splitter value updates correctly", () => {
      const { collapseFieldList } = usePanelEditor(options);

      // Set initial values
      dashboardPanelData.layout.splitter = 50;
      dashboardPanelData.layout.showFieldList = true;

      // Collapse
      collapseFieldList();
      expect(dashboardPanelData.layout.splitter).toBe(0);
      expect(dashboardPanelData.layout.showFieldList).toBe(false);

      // Expand
      collapseFieldList();
      expect(dashboardPanelData.layout.splitter).toBe(20);
      expect(dashboardPanelData.layout.showFieldList).toBe(true);
    });

    it("should handle querySplitterUpdated with different heights", () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
      dashboardPanelData.layout.showQueryBar = true;

      const { querySplitterUpdated, expandedSplitterHeight } = usePanelEditor(options);

      // Test with various heights
      querySplitterUpdated(25);
      expect(expandedSplitterHeight.value).toBe(25);

      querySplitterUpdated(75);
      expect(expandedSplitterHeight.value).toBe(75);

      querySplitterUpdated(100);
      expect(expandedSplitterHeight.value).toBe(100);

      // Verify resize dispatched for each
      expect(dispatchEventSpy).toHaveBeenCalledTimes(3);
    });

    it("should handle dateTimePickerRef when available", () => {
      const mockRefresh = vi.fn();
      options.dateTimePickerRef = ref({
        refresh: mockRefresh,
      });

      const { runQuery } = usePanelEditor(options);
      runQuery();

      expect(mockRefresh).toHaveBeenCalled();
    });

    it("should handle selectedDate when available", () => {
      options.selectedDate = ref({
        start_time: new Date("2024-03-01").getTime(),
        end_time: new Date("2024-03-02").getTime(),
      });

      const { runQuery } = usePanelEditor(options);
      runQuery();

      expect(dashboardPanelData.meta.dateTime.start_time).toEqual(
        new Date("2024-03-01")
      );
    });
  });

  describe("Watchers", () => {
    it("should update chartData when chart type changes", async () => {
      const { chartData, runQuery } = usePanelEditor(options);

      // Initially undefined
      expect(chartData.value).toBeUndefined();

      // First run query to set initial chartData
      runQuery();
      expect(chartData.value?.type).toBe("line");

      // Change chart type
      dashboardPanelData.data.type = "bar";

      await nextTick();
      await nextTick(); // May need extra tick for watcher

      // chartData should be updated via watcher
      expect(chartData.value).toBeDefined();
      expect(chartData.value?.type).toBe("bar");
    });

    it("should dispatch resize when isConfigPanelOpen changes", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      usePanelEditor(options);

      // Change config panel state
      dashboardPanelData.layout.isConfigPanelOpen = true;

      await nextTick();

      expect(dispatchEventSpy).toHaveBeenCalled();
    });

    it("should sync showFieldList when splitter changes", async () => {
      usePanelEditor(options);

      // Set splitter to 0, showFieldList should become false
      dashboardPanelData.layout.splitter = 0;

      await nextTick();

      expect(dashboardPanelData.layout.showFieldList).toBe(false);

      // Set splitter > 0, showFieldList should become true
      dashboardPanelData.layout.splitter = 15;

      await nextTick();

      expect(dashboardPanelData.layout.showFieldList).toBe(true);
    });
  });
});
