import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import DashboardQueryBuilder from "./DashboardQueryBuilder.vue";
import { createI18n } from "vue-i18n";
import { reactive } from "vue";

// Mock composables
const mockUseDashboardPanelData = {
  dashboardPanelData: {
    data: {
      type: "bar",
      id: "test-id",
      queryType: "sql",
      queries: [
        {
          customQuery: false,
          fields: {
            x: [
              {
                type: "build",
                label: "Field 1",
                functionName: "histogram",
                treatAsNonTimestamp: false,
                args: [
                  { value: "5m" },
                  {
                    type: "field",
                    value: { field: "field1", streamAlias: "" },
                  },
                ],
                isDerived: false,
                havingConditions: [],
              },
            ],
            y: [
              {
                type: "build",
                label: "Field 2",
                functionName: "sum",
                args: [
                  {
                    type: "field",
                    value: { field: "field2", streamAlias: "" },
                  },
                ],
                color: "#ff0000",
                treatAsNonTimestamp: false,
                isDerived: false,
                havingConditions: [],
              },
            ],
            z: [
              {
                type: "build",
                label: "Field 3",
                functionName: "avg",
                args: [
                  {
                    type: "field",
                    value: { field: "field3", streamAlias: "" },
                  },
                ],
                color: "#00ff00",
                isDerived: false,
                havingConditions: [],
              },
            ],
            breakdown: [
              {
                type: "build",
                label: "Field 4",
                functionName: "count",
                args: [
                  {
                    type: "field",
                    value: { field: "field4", streamAlias: "" },
                  },
                ],
                isDerived: false,
                havingConditions: [],
              },
            ],
          },
        },
      ],
    },
    layout: {
      currentQueryIndex: 0,
    },
    meta: {
      dragAndDrop: {
        dragging: false,
        dragSource: null,
        dragSourceIndex: -1,
        dragElement: null,
        targetDragIndex: -1,
        currentDragArea: null,
      },
      stream: {
        customQueryFields: [],
      },
    },
  },
  addXAxisItem: vi.fn(),
  addYAxisItem: vi.fn(),
  addZAxisItem: vi.fn(),
  addBreakDownAxisItem: vi.fn(),
  removeXAxisItem: vi.fn(),
  removeYAxisItem: vi.fn(),
  removeZAxisItem: vi.fn(),
  removeBreakdownItem: vi.fn(),
  addFilteredItem: vi.fn(),
  promqlMode: false,
  updateArrayAlias: vi.fn(),
  isAddXAxisNotAllowed: { value: false },
  isAddYAxisNotAllowed: { value: false },
  isAddZAxisNotAllowed: { value: false },
  isAddBreakdownNotAllowed: { value: false },
  isPivotMode: { value: false },
  cleanupDraggingFields: vi.fn(),
  selectedStreamFieldsBasedOnUserDefinedSchema: {
    value: [
      { name: "field1", type: "text" },
      { name: "field2", type: "number" },
      { name: "field3", type: "number" },
      { name: "field4", type: "text" },
    ],
  },
};

const mockUseNotifications = {
  showErrorNotification: vi.fn(),
};

const mockStore = {
  state: {
    zoConfig: {
      timestamp_column: "_timestamp",
    },
  },
};

vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: () => mockUseDashboardPanelData,
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => mockUseNotifications,
}));

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock child components
vi.mock("./DashboardGeoMapsQueryBuilder.vue", () => ({
  default: { name: "DashboardGeoMapsQueryBuilder", template: "<div></div>" },
}));

vi.mock("./DashboardMapsQueryBuilder.vue", () => ({
  default: { name: "DashboardMapsQueryBuilder", template: "<div></div>" },
}));

vi.mock("./DashboardSankeyChartBuilder.vue", () => ({
  default: { name: "DashboardSankeyChartBuilder", template: "<div></div>" },
}));

vi.mock("./SortByBtnGrp.vue", () => ({
  default: { name: "SortByBtnGrp", template: "<div></div>" },
}));

vi.mock("./HistogramIntervalDropDown.vue", () => ({
  default: {
    name: "HistogramIntervalDropDown",
    template: "<div></div>",
    props: ["modelValue"],
    emits: ["update:modelValue"],
  },
}));

vi.mock("./CommonAutoComplete.vue", () => ({
  default: { name: "CommonAutoComplete", template: "<div></div>" },
}));

vi.mock("@/components/SanitizedHtmlRenderer.vue", () => ({
  default: { name: "SanitizedHtmlRenderer", template: "<div></div>" },
}));

vi.mock("@/views/Dashboards/addPanel/DashboardFiltersOption.vue", () => ({
  default: { name: "DashboardFiltersOption", template: "<div></div>" },
}));

vi.mock("@/views/Dashboards/addPanel/DashboardJoinsOption.vue", () => ({
  default: { name: "DashboardJoinsOption", template: "<div></div>" },
}));

vi.mock("@/views/Dashboards/addPanel/DynamicFunctionPopUp.vue", () => ({
  default: { name: "DynamicFunctionPopUp", template: "<div></div>" },
}));

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      panel: {
        firstColumn: "First Column",
        otherColumn: "Other Columns",
        yAxis: "Y Axis",
        xAxis: "X Axis",
        zAxis: "Z Axis",
        xAxisShort: "X-Axis",
        yAxisShort: "Y-Axis",
        rowFields: "Row Fields",
        valueFields: "Value Fields",
        breakdown: "Breakdown",
        joins: "Joins",
        addJoin: "Add Join",
      },
      dashboard: {
        count: "Count",
        countDistinct: "Count Distinct",
        sum: "Sum",
        avg: "Average",
        min: "Minimum",
        max: "Maximum",
        p50: "P50",
        p90: "P90",
        p95: "P95",
        p99: "P99",
        histogram: "Histogram",
        oneLabelFieldMessage: "Add one label field here",
        xaxisFieldNAMessage: "X-axis field is not applicable for metric chart",
        oneOrMoreFieldsMessage: "Add one or more fields here",
        twoFieldsMessage: "Add up to two fields here",
        oneFieldMessage: "Add one field here",
        maxtwofieldMessage: "Add maximum two fields here",
        zeroOrOneFieldMessage: "Add zero or one field here",
        oneValueFieldMessage: "Add one value field here",
      },
      common: {
        aggregation: "Aggregation",
        label: "Label",
      },
    },
  },
});

describe("DashboardQueryBuilder", () => {
  let wrapper: any;
  const dashboardData = {
    id: "test-dashboard",
    title: "Test Dashboard",
  };

  const createWrapper = (overrides = {}) => {
    const defaultMockData = JSON.parse(
      JSON.stringify(mockUseDashboardPanelData.dashboardPanelData),
    );

    if (overrides) {
      Object.keys(overrides).forEach((key) => {
        if (key.includes(".")) {
          const keys = key.split(".");
          let target = defaultMockData;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) {
              target[keys[i]] = {};
            }
            target = target[keys[i]];
          }
          target[keys[keys.length - 1]] = overrides[key];
        } else {
          defaultMockData[key] = overrides[key];
        }
      });
    }

    // REACTIVE, as it is in production (`useDashboardPanel` holds a reactive
    // object). A plain clone meant no watcher in the component ever fired for a
    // post-mount mutation, so any test that changes panel state after mounting was
    // quietly asserting against a component that had stopped listening.
    mockUseDashboardPanelData.dashboardPanelData = reactive(defaultMockData);

    return mount(DashboardQueryBuilder, {
      props: {
        dashboardData,
      },
      global: {
        plugins: [i18n],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          DashboardGeoMapsQueryBuilder: {
            name: "DashboardGeoMapsQueryBuilder",
            template: "<div data-test='dashboard-geo-maps-builder' class='geo-maps-builder'></div>",
            props: ["dashboardData"],
          },
          DashboardMapsQueryBuilder: {
            name: "DashboardMapsQueryBuilder",
            template: "<div data-test='dashboard-maps-builder' class='maps-builder'></div>",
            props: ["dashboardData"],
          },
          DashboardSankeyChartBuilder: {
            name: "DashboardSankeyChartBuilder",
            template: "<div data-test='dashboard-sankey-builder' class='sankey-builder'></div>",
            props: ["dashboardData"],
          },
          SortByBtnGrp: true,
          HistogramIntervalDropDown: true,
          CommonAutoComplete: true,
          SanitizedHtmlRenderer: true,
          DashboardFiltersOption: {
            name: "DashboardFiltersOption",
            template: "<div data-test='dashboard-filters-option' class='filters-option'></div>",
            props: ["dashboardData"],
          },
          DashboardJoinsOption: {
            name: "DashboardJoinsOption",
            template: "<div data-test='dashboard-joins-option' class='joins-option'></div>",
            props: ["dashboardData"],
          },
          DynamicFunctionPopUp: {
            name: "DynamicFunctionPopUp",
            template:
              "<div data-test='dashboard-dynamic-function-popup' class='dynamic-function-popup'></div>",
          },
          QIcon: true,
          QTooltip: true,
          QSeparator: true,
          QBtn: true,
          QBtnGroup: true,
          QMenu: true,
          QSelect: true,
          QInput: true,
          QCheckbox: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock data to initial state
    mockUseDashboardPanelData.dashboardPanelData = {
      data: {
        type: "bar",
        id: "test-id",
        queryType: "sql",
        queries: [
          {
            customQuery: false,
            fields: {
              x: [
                {
                  type: "build",
                  label: "Field 1",
                  functionName: "histogram",
                  treatAsNonTimestamp: false,
                  args: [
                    { value: "5m" },
                    {
                      type: "field",
                      value: { field: "field1", streamAlias: "" },
                    },
                  ],
                  isDerived: false,
                  havingConditions: [],
                },
              ],
              y: [
                {
                  type: "build",
                  label: "Field 2",
                  functionName: "sum",
                  args: [
                    {
                      type: "field",
                      value: { field: "field2", streamAlias: "" },
                    },
                  ],
                  color: "#ff0000",
                  treatAsNonTimestamp: false,
                  isDerived: false,
                  havingConditions: [],
                },
              ],
              z: [
                {
                  type: "build",
                  label: "Field 3",
                  functionName: "avg",
                  args: [
                    {
                      type: "field",
                      value: { field: "field3", streamAlias: "" },
                    },
                  ],
                  color: "#00ff00",
                  isDerived: false,
                  havingConditions: [],
                },
              ],
              breakdown: [
                {
                  type: "build",
                  label: "Field 4",
                  functionName: "count",
                  args: [
                    {
                      type: "field",
                      value: { field: "field4", streamAlias: "" },
                    },
                  ],
                  isDerived: false,
                  havingConditions: [],
                },
              ],
            },
          },
        ],
      },
      layout: {
        currentQueryIndex: 0,
      },
      meta: {
        dragAndDrop: {
          dragging: false,
          dragSource: null,
          dragSourceIndex: -1,
          dragElement: null,
          targetDragIndex: -1,
          currentDragArea: null,
        },
        stream: {
          customQueryFields: [],
        },
      },
    };

    mockUseDashboardPanelData.promqlMode = false;
    mockUseDashboardPanelData.isAddXAxisNotAllowed.value = false;
    mockUseDashboardPanelData.isAddYAxisNotAllowed.value = false;
    mockUseDashboardPanelData.isAddZAxisNotAllowed.value = false;
    mockUseDashboardPanelData.isAddBreakdownNotAllowed.value = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render component with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should handle promqlMode correctly", () => {
      mockUseDashboardPanelData.promqlMode = true;
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.promqlMode).toBe(true);
      mockUseDashboardPanelData.promqlMode = false;
    });

    it("should not render main content for geomap type", () => {
      wrapper = createWrapper({ "data.type": "geomap" });
      // Should render child components like DashboardGeoMapsQueryBuilder
      expect(wrapper.findComponent({ name: "DashboardGeoMapsQueryBuilder" }).exists()).toBe(true);
    });

    it("should not render main content for maps type", () => {
      wrapper = createWrapper({ "data.type": "maps" });
      // Should render child components like DashboardMapsQueryBuilder
      expect(wrapper.findComponent({ name: "DashboardMapsQueryBuilder" }).exists()).toBe(true);
    });

    it("should not render main content for sankey type", () => {
      wrapper = createWrapper({ "data.type": "sankey" });
      // Should render child components like DashboardSankeyChartBuilder
      expect(wrapper.findComponent({ name: "DashboardSankeyChartBuilder" }).exists()).toBe(true);
    });

    it("should render for supported chart types", () => {
      wrapper = createWrapper({ "data.type": "bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("bar");
    });
  });

  describe("X-Axis Configuration", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should have x-axis data in component", () => {
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.x).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.x).toHaveLength(1);
    });

    it("should display x-axis field data", () => {
      const xField = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      expect(xField.args[1].value.field).toBe("field1");
      expect(xField.label).toBe("Field 1");
    });

    it("should show correct x-axis label for different chart types", () => {
      wrapper = createWrapper({ "data.type": "table" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("table");

      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "h-bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("h-bar");

      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("bar");
    });

    it("should handle x-axis field removal", async () => {
      mockUseDashboardPanelData.removeXAxisItem("field1");
      expect(mockUseDashboardPanelData.removeXAxisItem).toHaveBeenCalledWith("field1");
    });

    it("should show x-axis hint when no fields", () => {
      wrapper = createWrapper({ "data.queries.0.fields.x": [] });
      expect(wrapper.vm.xAxisHint).toContain("Add");
    });

    it("should handle aggregation function selection", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      expect(field.functionName).toBe("histogram");
    });

    it("should clear aggregation function", async () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      field.functionName = null;
      expect(field.functionName).toBeNull();
    });

    it("should handle histogram interval configuration", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      expect(field.args[0].value).toBe("5m");
    });

    it("should handle label updates", async () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      field.label = "Updated Label";
      expect(field.label).toBe("Updated Label");
    });

    it("should handle treatAsNonTimestamp for table charts", async () => {
      wrapper = createWrapper({ "data.type": "table" });
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      field.treatAsNonTimestamp = true;
      expect(field.treatAsNonTimestamp).toBe(true);
    });
  });

  describe("Y-Axis Configuration", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should have y-axis data in component", () => {
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.y).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.y).toHaveLength(1);
    });

    it("should display y-axis field data", () => {
      const yField = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(yField.args[0].value.field).toBe("field2");
      expect(yField.label).toBe("Field 2");
    });

    it("should show correct y-axis types for different chart types", () => {
      wrapper = createWrapper({ "data.type": "table" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("table");

      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "h-bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("h-bar");

      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("bar");
    });

    it("should handle y-axis field removal", async () => {
      mockUseDashboardPanelData.removeYAxisItem("field2");
      expect(mockUseDashboardPanelData.removeYAxisItem).toHaveBeenCalledWith("field2");
    });

    it("should handle aggregation function for y-axis", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.functionName).toBe("sum");
    });

    it("should handle color picker for y-axis", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.color).toBe("#ff0000");
    });

    it("should handle color display for supported charts", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.color).toBe("#ff0000");

      // Test table type doesn't show color
      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "table" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("table");

      // Test pie type doesn't show color
      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "pie" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("pie");
    });

    it("should handle histogram configuration for y-axis", () => {
      wrapper = createWrapper({
        "data.queries.0.fields.y.0.functionName": "histogram",
        "data.queries.0.fields.y.0.args": [{ value: "10m" }],
      });
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.functionName).toBe("histogram");
      expect(field.args[0].value).toBe("10m");
    });
  });

  describe("Z-Axis Configuration (Heatmap)", () => {
    beforeEach(() => {
      wrapper = createWrapper({ "data.type": "heatmap" });
    });

    it("should have z-axis data for heatmap", () => {
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.z).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.z).toHaveLength(1);
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("heatmap");
    });

    it("should display z-axis field data", () => {
      const zField = wrapper.vm.dashboardPanelData.data.queries[0].fields.z[0];
      expect(zField.args[0].value.field).toBe("field3");
      expect(zField.label).toBe("Field 3");
    });

    it("should handle z-axis field removal", async () => {
      mockUseDashboardPanelData.removeZAxisItem("field3");
      expect(mockUseDashboardPanelData.removeZAxisItem).toHaveBeenCalledWith("field3");
    });

    it("should handle aggregation function for z-axis", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.z[0];
      expect(field.functionName).toBe("avg");
    });

    it("should handle color picker for z-axis", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.z[0];
      expect(field.color).toBe("#00ff00");
    });

    it("should not have z-axis for non-heatmap charts", () => {
      wrapper.unmount();
      wrapper = createWrapper({ "data.type": "bar" });
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("bar");
      // Z-axis should still exist in data but not be rendered
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.z).toBeDefined();
    });
  });

  describe("Breakdown Configuration", () => {
    beforeEach(() => {
      wrapper = createWrapper({ "data.type": "area" });
    });

    it("should have breakdown data for supported charts", () => {
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown).toHaveLength(1);
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("area");
    });

    it("should display breakdown field data", () => {
      const breakdownField = wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown[0];
      expect(breakdownField.args[0].value.field).toBe("field4");
      expect(breakdownField.label).toBe("Field 4");
    });

    it("should handle breakdown field removal", async () => {
      mockUseDashboardPanelData.removeBreakdownItem("field4");
      expect(mockUseDashboardPanelData.removeBreakdownItem).toHaveBeenCalledWith("field4");
    });

    it("should handle aggregation function for breakdown", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown[0];
      expect(field.functionName).toBe("count");
    });

    it("should render breakdown for supported chart types", () => {
      const supportedTypes = [
        "area",
        "bar",
        "line",
        "h-bar",
        "h-stacked",
        "scatter",
        "area-stacked",
        "stacked",
      ];

      supportedTypes.forEach((type) => {
        wrapper.unmount();
        wrapper = createWrapper({ "data.type": type });
        expect(wrapper.vm.dashboardPanelData.data.type).toBe(type);
      });
    });

    it("should handle unsupported chart types", () => {
      const unsupportedTypes = ["pie", "donut", "metric", "table"];

      unsupportedTypes.forEach((type) => {
        wrapper.unmount();
        wrapper = createWrapper({ "data.type": type });
        expect(wrapper.vm.dashboardPanelData.data.type).toBe(type);
        // Breakdown data still exists but may not be rendered
        expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown).toBeDefined();
      });
    });
  });

  describe("Drag and Drop Functionality", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle drag start for x-axis field", async () => {
      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

      wrapper.vm.onFieldDragStart(mockEvent, { column: "field1" }, "x", 0);

      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragging).toBe(true);
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragSource).toBe("x");
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragSourceIndex).toBe(0);
    });

    it("should handle drag over", () => {
      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDragOver(mockEvent, "x");
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should handle drag enter", () => {
      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDragEnter(mockEvent, "x", 1);

      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(1);
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.currentDragArea).toBe("x");
    });

    it("should handle drag end", () => {
      wrapper.vm.onDragEnd();
      expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
    });

    it("should handle drop for reordering within same axis", () => {
      mockUseDashboardPanelData.dashboardPanelData.meta.dragAndDrop = {
        dragSource: "x",
        dragSourceIndex: 0,
        dragElement: {
          type: "build",
          functionName: "histogram",
          args: [{ value: "5m" }, { type: "field", value: { field: "field1", streamAlias: "" } }],
        },
      };

      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDrop(mockEvent, "x", 1);

      expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
    });

    it("should handle drop from field list to axis", () => {
      mockUseDashboardPanelData.dashboardPanelData.meta.dragAndDrop = {
        dragSource: "fieldList",
        dragElement: {
          type: "build",
          args: [{ type: "field", value: { field: "newField", streamAlias: "" } }],
        },
      };

      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDrop(mockEvent, "x", 0);

      expect(mockUseDashboardPanelData.addXAxisItem).toHaveBeenCalled();
    });

    it("should show drag indicators during drag", () => {
      wrapper = createWrapper({
        "meta.dragAndDrop.dragging": true,
        "meta.dragAndDrop.currentDragArea": "x",
        "meta.dragAndDrop.targetDragIndex": 0,
      });

      expect(wrapper.find('[data-test="dashboard-query-builder-drag-item"]').exists()).toBe(true);
    });

    it("should apply drop target styling during drag", () => {
      wrapper = createWrapper({
        "meta.dragAndDrop.dragging": true,
      });

      const xAxis = wrapper.find('[data-test="dashboard-x-layout"]');
      expect(xAxis.classes()).toContain("[border-style:dotted]");
    });

    it("should apply drop entered styling", () => {
      wrapper = createWrapper({
        "meta.dragAndDrop.dragging": true,
        "meta.dragAndDrop.currentDragArea": "x",
      });

      const xAxis = wrapper.find('[data-test="dashboard-x-layout"]');
      // Colours-only transition (not transition-all) so the drop-zone highlight
      // fades without animating height/layout on add — avoids the add "bounce".
      expect(xAxis.classes()).toContain("transition-colors");
    });
  });

  describe("Having Conditions", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should check if having filter exists", () => {
      wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0].havingConditions = [
        { operator: ">=", value: 10 },
      ];

      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.havingConditions).toHaveLength(1);
      expect(field.havingConditions[0]).toEqual({ operator: ">=", value: 10 });
    });

    it("should handle having filter addition", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      field.havingConditions = [{ operator: ">=", value: 10 }];

      expect(field.havingConditions).toHaveLength(1);
      expect(field.havingConditions[0].operator).toBe(">=");
      expect(field.havingConditions[0].value).toBe(10);
    });

    it("should handle having filter removal", () => {
      wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0].havingConditions = [
        { operator: ">=", value: 10 },
      ];

      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      field.havingConditions = [];

      expect(field.havingConditions).toHaveLength(0);
    });

    it("should handle having condition data", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      field.havingConditions = [{ operator: ">=", value: 10 }];

      expect(field.havingConditions[0]).toEqual({ operator: ">=", value: 10 });
    });

    it("should handle empty having conditions", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];
      expect(field.havingConditions).toBeDefined();
    });

    it("should not show having conditions for heatmap charts", () => {
      wrapper = createWrapper({ "data.type": "heatmap" });

      expect(wrapper.text()).not.toContain("Having");
    });
  });

  describe("Computed Properties", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should compute xLabel correctly", () => {
      expect(wrapper.vm.xLabel).toEqual(["histogram(field1)"]);
    });

    it("should compute yLabel correctly", () => {
      expect(wrapper.vm.yLabel).toEqual(["sum(field2)"]);
    });

    it("should compute zLabel correctly", () => {
      wrapper = createWrapper({ "data.type": "heatmap" });
      expect(wrapper.vm.zLabel).toEqual(["avg(field3)"]);
    });

    it("should compute bLabel correctly", () => {
      wrapper = createWrapper({ "data.type": "area" });
      expect(wrapper.vm.bLabel).toEqual(["count(field4)"]);
    });

    it("should show field data for custom query", () => {
      wrapper = createWrapper({
        "data.queries.0.customQuery": true,
      });
      // For custom queries, fields should still be defined
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.x).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.y).toBeDefined();
    });

    it("should compute axis hints correctly for different chart types", () => {
      const chartTypes = [
        { type: "pie", xHint: "Add one label field here" },
        {
          type: "metric",
          xHint: "X-axis field is not applicable for metric chart",
        },
        { type: "table", xHint: "Add one or more fields here" },
        { type: "heatmap", xHint: "Add one field here" },
      ];

      chartTypes.forEach(({ type, xHint }) => {
        wrapper.unmount();
        wrapper = createWrapper({ "data.type": type });
        expect(wrapper.vm.xAxisHint).toBe(xHint);
      });
    });
  });

  describe("Histogram Interval Configuration", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle histogram interval updates", () => {
      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      if (field.args && field.args[0]) {
        field.args[0].value = "10m";
        expect(field.args[0].value).toBe("10m");
      } else {
        // Initialize args if not present
        field.args = [{ value: "10m" }];
        expect(field.args[0].value).toBe("10m");
      }
    });
  });

  describe("Trigger Operators", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should provide standard trigger operators", () => {
      const expectedOperators = [
        "count",
        "count-distinct",
        "sum",
        "avg",
        "min",
        "max",
        "p50",
        "p90",
        "p95",
        "p99",
      ];

      expectedOperators.forEach((op) => {
        expect(wrapper.vm.triggerOperators.some((item) => item.value === op)).toBe(true);
      });
    });

    it("should provide histogram operator", () => {
      expect(wrapper.vm.triggerOperatorsWithHistogram).toEqual([
        { label: "Histogram", value: "histogram" },
      ]);
    });

    it("should use triggerOperatorsWithHistogram for heatmap y-axis", () => {
      wrapper = createWrapper({ "data.type": "heatmap" });
      // The component logic checks if chart type is heatmap for y-axis aggregation options
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("heatmap");
    });
  });

  describe("TreatAsNonTimestamp Initialization", () => {
    it("should initialize treatAsNonTimestamp for new panel", async () => {
      wrapper = createWrapper({
        "data.id": null, // New panel
        "data.type": "table",
      });

      await wrapper.vm.$nextTick();

      const xField = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      const yField = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];

      // field1 is not timestamp column, should be true
      expect(xField.treatAsNonTimestamp).toBe(true);
      // field2 is not timestamp column, should be true
      expect(yField.treatAsNonTimestamp).toBe(true);
    });

    it("should preserve treatAsNonTimestamp for existing panel", async () => {
      wrapper = createWrapper({
        "data.id": "existing-panel",
        "data.type": "table",
        "data.queries.0.fields.x.0.treatAsNonTimestamp": true,
        "data.queries.0.fields.y.0.treatAsNonTimestamp": false,
      });

      await wrapper.vm.$nextTick();

      const xField = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      const yField = wrapper.vm.dashboardPanelData.data.queries[0].fields.y[0];

      expect(xField.treatAsNonTimestamp).toBe(true);
      expect(yField.treatAsNonTimestamp).toBe(false);
    });

    it("should handle timestamp column for new panel", async () => {
      wrapper = createWrapper({
        "data.id": null,
        "data.type": "table",
        "data.queries.0.fields.x.0.column": "_timestamp",
      });

      await wrapper.vm.$nextTick();

      const xField = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      expect(xField.treatAsNonTimestamp).toBe(false);
    });
  });

  describe("Chart Type Watchers", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle chart type changes", async () => {
      const originalType = wrapper.vm.dashboardPanelData.data.type;
      expect(originalType).toBe("bar");

      wrapper.vm.dashboardPanelData.data.type = "table";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.data.type).toBe("table");
    });

    it("should handle expansion items configuration", async () => {
      // Initially should have default expansion state
      expect(wrapper.vm.expansionItems).toBeDefined();
      expect(wrapper.vm.expansionItems.x).toBe(true);
      expect(wrapper.vm.expansionItems.y).toBe(true);

      // Test dragging state changes
      const oldDragging = wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragging;
      wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragging = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.expansionItems.x).toBe(true);
      expect(wrapper.vm.expansionItems.y).toBe(true);
      expect(wrapper.vm.expansionItems.z).toBe(true);
      expect(wrapper.vm.expansionItems.breakdown).toBe(true);
      expect(oldDragging).toBe(false);
    });
  });

  describe("Field Validation and Error Handling", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle drag drop validation scenarios", () => {
      // Test with valid setup
      mockUseDashboardPanelData.dashboardPanelData.meta.dragAndDrop = {
        dragSource: "breakdown",
        dragElement: { column: "field1" },
        dragging: true,
        dragSourceIndex: 0,
        targetDragIndex: 0,
        currentDragArea: "x",
      };

      mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
        { name: "field1", type: "text" },
      ];

      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDrop(mockEvent, "x", 0);

      // Should call cleanup regardless of outcome
      expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
    });

    it("should handle field limit validation", () => {
      // Test the validation flags
      expect(mockUseDashboardPanelData.isAddXAxisNotAllowed).toBeDefined();
      expect(mockUseDashboardPanelData.isAddYAxisNotAllowed).toBeDefined();
      expect(mockUseDashboardPanelData.isAddZAxisNotAllowed).toBeDefined();
      expect(mockUseDashboardPanelData.isAddBreakdownNotAllowed).toBeDefined();
    });

    it("should handle axis field data access", () => {
      // Test accessing axis data directly from the component
      const xAxis = wrapper.vm.dashboardPanelData.data.queries[0].fields.x;
      const yAxis = wrapper.vm.dashboardPanelData.data.queries[0].fields.y;
      const zAxis = wrapper.vm.dashboardPanelData.data.queries[0].fields.z;
      const breakdown = wrapper.vm.dashboardPanelData.data.queries[0].fields.breakdown;

      expect(xAxis).toBeDefined();
      expect(yAxis).toBeDefined();
      expect(zAxis).toBeDefined();
      expect(breakdown).toBeDefined();
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle missing dragElement in onDrop", () => {
      mockUseDashboardPanelData.dashboardPanelData.meta.dragAndDrop = {
        dragSource: "fieldList",
        dragElement: null,
      };

      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDrop(mockEvent, "x", 0);

      expect(mockUseDashboardPanelData.addXAxisItem).not.toHaveBeenCalled();
    });

    it("should handle drag operations safely", () => {
      // Test various drag operations
      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

      wrapper.vm.onDragStart(mockEvent, { column: "test" });
      expect(mockEvent.preventDefault).toHaveBeenCalled();

      wrapper.vm.onDragOver(mockEvent, "x");
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should handle field drag operations", () => {
      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      const testItem = {
        type: "build",
        args: [{ type: "field", value: { field: "testField", streamAlias: "" } }],
      };

      wrapper.vm.onFieldDragStart(mockEvent, testItem, "x", 0);

      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragging).toBe(true);
      // `toEqual`, not `toBe`: the panel data is `reactive`, so what comes back out
      // is a PROXY of what went in. Identity was only ever holding because the mock
      // was a plain object — which also meant no watcher fired for a post-mount
      // mutation, i.e. the harness was not modelling production. The value is what
      // matters here, not the reference.
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragElement).toEqual(testItem);
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragSource).toBe("x");
      expect(wrapper.vm.dashboardPanelData.meta.dragAndDrop.dragSourceIndex).toBe(0);
    });

    it("should prevent invalid drag operations", () => {
      mockUseDashboardPanelData.dashboardPanelData.meta.dragAndDrop.dragSource = "x";

      const mockEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      wrapper.vm.onDragEnter(mockEvent, "f", 0);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe("Accessibility and UX", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should provide helpful axis hints", () => {
      expect(wrapper.vm.xAxisHint).toBeDefined();
      expect(wrapper.vm.yAxisHint).toBeDefined();
      expect(wrapper.vm.zAxisHint).toBeDefined();
      expect(wrapper.vm.bAxisHint).toBeDefined();
    });

    it("should show appropriate hints for empty axes", () => {
      wrapper = createWrapper({
        "data.queries.0.fields.x": [],
        "data.queries.0.fields.y": [],
        "data.queries.0.fields.breakdown": [],
      });

      expect(wrapper.vm.xAxisHint).toContain("Add");
      expect(wrapper.vm.yAxisHint).toContain("Add");
    });

    it("should handle component structure properly", () => {
      // Verify basic component structure
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.triggerOperators).toBeDefined();
      expect(wrapper.vm.triggerOperatorsWithHistogram).toBeDefined();
    });
  });

  describe("Performance Optimizations", () => {
    it("should use computed properties for labels", () => {
      wrapper = createWrapper();

      // Verify that labels are computed properties
      expect(typeof wrapper.vm.xLabel).toBe("object"); // computed returns ref object
      expect(typeof wrapper.vm.yLabel).toBe("object");
      expect(typeof wrapper.vm.zLabel).toBe("object");
      expect(typeof wrapper.vm.bLabel).toBe("object");
    });

    it("should efficiently handle axis hint computations", () => {
      wrapper = createWrapper();

      const hint1 = wrapper.vm.xAxisHint;
      const hint2 = wrapper.vm.xAxisHint;
      expect(hint1).toBe(hint2); // Should be same reference due to computed caching
    });
  });

  describe("Integration with Child Components", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should render all required child components", () => {
      expect(wrapper.find('[data-test="dashboard-geo-maps-builder"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-maps-builder"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-sankey-builder"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-filters-option"]').exists()).toBe(true);
    });

    it("should pass dashboard data to child components", () => {
      const geoMapsComponent = wrapper.findComponent({
        name: "DashboardGeoMapsQueryBuilder",
      });
      const mapsComponent = wrapper.findComponent({
        name: "DashboardMapsQueryBuilder",
      });
      const sankeyComponent = wrapper.findComponent({
        name: "DashboardSankeyChartBuilder",
      });
      const filtersComponent = wrapper.findComponent({
        name: "DashboardFiltersOption",
      });

      expect(geoMapsComponent.exists()).toBe(true);
      expect(mapsComponent.exists()).toBe(true);
      expect(sankeyComponent.exists()).toBe(true);
      expect(filtersComponent.exists()).toBe(true);
    });

    it("should handle histogram interval configuration", async () => {
      wrapper = createWrapper({
        "data.queries.0.fields.x.0.functionName": "histogram",
        "data.queries.0.fields.x.0.args": [
          { value: "5m" },
          { type: "field", value: { field: "field1", streamAlias: "" } },
        ],
      });

      const field = wrapper.vm.dashboardPanelData.data.queries[0].fields.x[0];
      field.args[0].value = "15m";

      expect(field.args[0].value).toBe("15m");
    });
  });
  describe("seeding a slot the stream watcher structurally cannot see", () => {
    const METRIC_STREAMS = [
      {
        name: "http_requests_total",
        stream_type: "metrics",
        metrics_meta: {
          metric_type: "Counter",
          metric_family_name: "http_requests_total",
          help: "",
          unit: "",
        },
        stats: { doc_num: 100 },
      },
    ];

    /**
     * NOTE: `createWrapper` deep-CLONES the mock panel data and swaps the clone in,
     * so the object the component mutates is only reachable AFTER mounting — see
     * `live()`. Reading the pre-mount reference asserts against a discarded object.
     */
    const live = () => mockUseDashboardPanelData.dashboardPanelData;

    const promqlPanel = (queries: any[], currentQueryIndex = 0) => {
      const dpd = mockUseDashboardPanelData.dashboardPanelData;
      mockUseDashboardPanelData.promqlMode = true;
      dpd.data.queryType = "promql";
      dpd.data.type = "bar";
      dpd.data.queries = queries;
      dpd.layout.currentQueryIndex = currentQueryIndex;
      dpd.meta.stream.streamResults = METRIC_STREAMS;
      dpd.meta.stream.streamResultsType = "metrics";
      // The PromQL builder's label picker reads this.
      dpd.meta.streamFields = { groupedFields: [] };
      return dpd;
    };

    const slot = (query: string) => ({
      query,
      customQuery: false,
      fields: {
        stream: "http_requests_total",
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        promql_labels: [],
        promql_operations: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: {},
    });

    afterEach(() => {
      mockUseDashboardPanelData.promqlMode = false;
    });

    it("seeds a NEW query tab, whose cloned stream never fires the stream watcher", async () => {
      // `addQuery` copies `fields.stream` from the current slot, so the value the
      // stream watcher tracks does not change and it never fires. The tab was left
      // with an empty query — which renders as a bare `metric{}`: a raw cumulative
      // counter, exactly what the seeding exists to prevent.
      promqlPanel([slot("sum(rate(http_requests_total{}[5m]))"), slot("")], 1);

      wrapper = createWrapper();
      await flushPromises();

      expect(live().data.queries[1].query).toContain("rate(http_requests_total");
      expect(live().data.queries[1].fields.promql_operations).toEqual([
        { id: "rate", params: ["$__rate_interval"] },
        { id: "sum", params: [[]] },
      ]);
    });

    /**
     * The scalar-math steps were renamed away from the ids panels were saved
     * under. Rendering an old panel correctly is not enough — if the builder
     * kept writing the old id back, the compatibility table could never be
     * retired. Opening the panel has to MIGRATE it.
     */
    describe("a panel saved under the previous scalar-math step ids", () => {
      const savedWithLegacyOps = (ops: any[]) => {
        const s = slot("http_requests_total{} * 8");
        s.fields.promql_operations = ops as any;
        return s;
      };

      it("rewrites the stored ids, so saving the panel migrates it", async () => {
        promqlPanel([
          savedWithLegacyOps([
            { id: "rate", params: ["$__rate_interval"] },
            { id: "__multiply_by", params: [8] },
          ]),
        ]);

        wrapper = createWrapper();
        await flushPromises();

        // The panel now holds the CURRENT id: whatever writes the dashboard next
        // persists `scalar_multiply`, and one more panel stops needing the table.
        expect(live().data.queries[0].fields.promql_operations).toEqual([
          { id: "rate", params: ["$__rate_interval"] },
          { id: "scalar_multiply", params: [8] },
        ]);
      });

      it("renders the same query it rendered before the rename", async () => {
        // The migration must be invisible in the output. If the numbers on the
        // chart move, we have not migrated the panel — we have broken it.
        promqlPanel([savedWithLegacyOps([{ id: "__multiply_by", params: [8] }])]);

        wrapper = createWrapper();
        await flushPromises();

        expect(live().data.queries[0].query).toBe("http_requests_total{} * 8");
      });

      it("migrates EVERY query tab, not just the one on screen", async () => {
        // The builder only loads the tab you are looking at. If migration
        // followed the same rule, a two-tab panel would be saved half-upgraded
        // and whether it migrated would depend on which tabs its author clicked
        // — so the compatibility table could never be retired.
        promqlPanel(
          [
            savedWithLegacyOps([{ id: "__multiply_by", params: [8] }]),
            savedWithLegacyOps([{ id: "__divide_by", params: [1024] }]),
          ],
          0, // tab 2 is never visited
        );

        wrapper = createWrapper();
        await flushPromises();

        expect(live().data.queries[1].fields.promql_operations).toEqual([
          { id: "scalar_divide", params: [1024] },
        ]);
      });

      it("leaves a panel already on the current ids untouched", async () => {
        promqlPanel([savedWithLegacyOps([{ id: "scalar_multiply", params: [8] }])]);

        wrapper = createWrapper();
        await flushPromises();

        expect(live().data.queries[0].fields.promql_operations).toEqual([
          { id: "scalar_multiply", params: [8] },
        ]);
        expect(live().data.queries[0].query).toBe("http_requests_total{} * 8");
      });
    });

    it("never rewrites a tab that already has a query", async () => {
      const written = 'sum(rate(http_requests_total{code="500"}[1h]))';
      promqlPanel([slot("sum(rate(http_requests_total{}[5m]))"), slot(written)], 1);

      wrapper = createWrapper();
      await flushPromises();

      expect(live().data.queries[1].query).toBe(written);
    });

    it("does not write a bare metric{} before the stream list has arrived", async () => {
      // A panel restored from a URL sets `fields.stream` before `getStreams` resolves.
      // Seeding then would fall back to the bare selector and never revisit it.
      const dpd = promqlPanel([slot("")], 0);
      dpd.meta.stream.streamResults = []; // not loaded yet

      wrapper = createWrapper();
      await flushPromises();

      expect(live().data.queries[0].query).not.toBe("http_requests_total{}");

      // ...and once the list lands, the slot gets seeded properly.
      live().meta.stream.streamResults = METRIC_STREAMS;
      await flushPromises();

      expect(live().data.queries[0].query).toContain("rate(http_requests_total");
    });
  });
});
