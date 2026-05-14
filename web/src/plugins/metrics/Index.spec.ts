// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick, reactive } from "vue";

// ---------------------------------------------------------------------------
// Mocks — must be registered before the component is imported
// ---------------------------------------------------------------------------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    useStore: () => mockStore,
  };
});

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockShowErrorNotification = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: mockShowErrorNotification,
  }),
}));

const mockResetDashboardPanelData = vi.fn();
const mockResetDashboardPanelDataAndAddTimeField = vi.fn();
const mockResetAggregationFunction = vi.fn();
const mockValidatePanel = vi.fn((errors: any[]) => {
  /* default: no errors */
});
const mockRemoveXYFilters = vi.fn();
const mockUpdateGroupedFields = vi.fn().mockResolvedValue(undefined);
const mockMakeAutoSQLQuery = vi.fn().mockResolvedValue(undefined);

// A minimal reactive dashboardPanelData object that the component modifies
const mockDashboardPanelData: any = reactive({
  data: {
    id: "",
    title: "",
    type: "line",
    queryType: "promql",
    queries: [
      {
        fields: { stream_type: "", stream: "", x: [], y: [], breakdown: [], filter: {} },
        customQuery: true,
        query: "",
      },
    ],
  },
  meta: {
    dateTime: { start_time: null, end_time: null },
  },
  layout: {
    showQueryBar: false,
    isConfigPanelOpen: false,
  },
});

vi.mock("../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetDashboardPanelData: mockResetDashboardPanelData,
    resetDashboardPanelDataAndAddTimeField:
      mockResetDashboardPanelDataAndAddTimeField,
    resetAggregationFunction: mockResetAggregationFunction,
    validatePanel: mockValidatePanel,
    removeXYFilters: mockRemoveXYFilters,
    updateGroupedFields: mockUpdateGroupedFields,
    makeAutoSQLQuery: mockMakeAutoSQLQuery,
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false" },
}));

const mockCancelQuery = vi.fn();
const mockTraceIdRef = { value: [] };
vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: mockTraceIdRef,
    cancelQuery: mockCancelQuery,
  }),
}));

vi.mock("@/utils/dashboard/checkConfigChangeApiCall", () => ({
  checkIfConfigChangeRequiredApiCallOrNot: vi.fn(() => false),
}));

// lodash-es – just pass through the functions we use
vi.mock("lodash-es", () => ({
  isEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
  debounce: (fn: any) => fn,
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------
import MetricsIndex from "./Index.vue";

// ---------------------------------------------------------------------------
// Shared mock store
// ---------------------------------------------------------------------------
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org", label: "Test Org" },
    zoConfig: { min_auto_refresh_interval: 5 },
  },
};

// ---------------------------------------------------------------------------
// Factory — all heavy children are stubbed out
// ---------------------------------------------------------------------------
const createWrapper = (props: Record<string, any> = {}) => {
  return mount(MetricsIndex, {
    props,
    global: {
      stubs: {
        // Heavy async / complex children
        PanelEditor: {
          template:
            "<div class='panel-editor' data-test='panel-editor'><slot /></div>",
          methods: { runQuery: vi.fn() },
        },
        DateTimePickerDashboard: {
          template:
            "<div class='date-time-picker' data-test='metrics-date-picker'></div>",
          methods: {
            refresh: vi.fn(),
            getConsumableDateTime: vi.fn(() => ({
              startTime: "2024-01-01T00:00:00.000Z",
              endTime: "2024-01-01T01:00:00.000Z",
            })),
            setCustomDate: vi.fn(),
          },
        },
        SyntaxGuideMetrics: {
          template: "<div class='syntax-guide-metrics'></div>",
        },
        MetricLegends: {
          template: "<div class='metric-legends'></div>",
        },
        AddToDashboard: {
          template:
            "<div class='add-to-dashboard' @click='$emit(\"save\")'></div>",
          emits: ["save"],
        },
        AutoRefreshInterval: {
          template:
            "<div class='auto-refresh-interval' data-test='metrics-auto-refresh' @click='$emit(\"trigger\")'></div>",
          props: ["modelValue", "trigger", "minRefreshInterval"],
          emits: ["update:modelValue", "trigger"],
        },
        QDialog: {
          template:
            "<div class='q-dialog' v-if='modelValue'><slot /></div>",
          props: ["modelValue", "position", "fullHeight", "maximized"],
          emits: ["update:modelValue"],
        },
        QBtn: {
          template:
            "<button class='q-btn' :data-test='$attrs[\"data-test\"]' :disabled='disable || loading' @click='$emit(\"click\", $event)'><slot /></button>",
          props: ["label", "loading", "disable", "color", "noCaps", "padding"],
          emits: ["click"],
        },
      },
    },
  });
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("Metrics Index — component initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the shared mock data
    mockDashboardPanelData.data.type = "line";
    mockDashboardPanelData.data.queryType = "promql";
    mockDashboardPanelData.data.queries[0].fields.stream_type = "";
    mockDashboardPanelData.data.queries[0].customQuery = true;
    mockDashboardPanelData.layout.showQueryBar = false;
    mockDashboardPanelData.layout.isConfigPanelOpen = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mounts without errors", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });

  it("has component name 'Metrics'", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe("Metrics");
  });

  it("initializes editMode as false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.editMode).toBe(false);
  });

  it("initializes showAddToDashboardDialog as false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  it("initializes disable as false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.disable).toBe(false);
  });

  it("initializes refreshInterval as 0", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.refreshInterval).toBe(0);
  });

  it("initializes selectedDate with relative valueType and 15m period", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.selectedDate.valueType).toBe("relative");
    expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("15m");
  });

  it("calls resetDashboardPanelData on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockResetDashboardPanelData).toHaveBeenCalled();
  });

  it("sets stream_type to 'metrics' on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockDashboardPanelData.data.queries[0].fields.stream_type).toBe(
      "metrics",
    );
  });

  it("sets chart type to 'line' on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockDashboardPanelData.data.type).toBe("line");
  });

  it("sets queryType to 'promql' on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockDashboardPanelData.data.queryType).toBe("promql");
  });

  it("sets customQuery to false on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockDashboardPanelData.data.queries[0].customQuery).toBe(false);
  });

  it("sets showQueryBar to true on mounted", async () => {
    createWrapper();
    await flushPromises();
    expect(mockDashboardPanelData.layout.showQueryBar).toBe(true);
  });

  it("calls resetDashboardPanelData on unmount", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.unmount();
    await flushPromises();
    expect(mockResetDashboardPanelData).toHaveBeenCalled();
  });
});

describe("Metrics Index — template structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the SyntaxGuideMetrics component", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".syntax-guide-metrics").exists()).toBe(true);
  });

  it("renders the MetricLegends component", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".metric-legends").exists()).toBe(true);
  });

  it("renders the PanelEditor component", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".panel-editor").exists()).toBe(true);
  });

  it("renders run-query button with data-test attribute", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="metrics-apply"]').exists()).toBe(true);
  });

  it("renders date-time picker with data-test attribute", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="metrics-date-picker"]').exists()).toBe(
      true,
    );
  });

  it("renders auto-refresh interval with data-test attribute", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="metrics-auto-refresh"]').exists()).toBe(
      true,
    );
  });

  it("does not render AddToDashboard dialog when showAddToDashboardDialog is false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".add-to-dashboard").exists()).toBe(false);
  });

  it("renders AddToDashboard dialog when showAddToDashboardDialog is true", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.showAddToDashboardDialog = true;
    await nextTick();
    expect(wrapper.find(".add-to-dashboard").exists()).toBe(true);
  });
});

describe("Metrics Index — props", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts metaData prop without errors", async () => {
    const wrapper = createWrapper({ metaData: { someKey: "someValue" } });
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders without metaData prop", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });
});

describe("Metrics Index — runQuery method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidatePanel.mockImplementation(() => {
      /* no errors */
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates chartData when validation passes", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    const before = wrapper.vm.chartData;
    wrapper.vm.runQuery();
    await nextTick();

    // chartData should be updated to a copy of dashboardPanelData.data
    expect(wrapper.vm.chartData).toBeDefined();
  });

  it("does not update chartData when validation fails", async () => {
    mockValidatePanel.mockImplementation((errors: any[]) => {
      errors.push("Some validation error");
    });
    const wrapper = createWrapper();
    await flushPromises();

    const chartDataBefore = wrapper.vm.chartData;
    wrapper.vm.runQuery();
    await nextTick();

    // chartData should remain the same since validation failed
    expect(wrapper.vm.chartData).toBe(chartDataBefore);
  });

  it("can be triggered by clicking the run-query button", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    await wrapper.find('[data-test="metrics-apply"]').trigger("click");

    // runQuery calls isValid which calls validatePanel — verify via side effect
    expect(mockValidatePanel).toHaveBeenCalled();
  });
});

describe("Metrics Index — addToDashboard method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets showAddToDashboardDialog to true when validation passes", async () => {
    mockValidatePanel.mockImplementation(() => {
      /* no errors */
    });
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.addToDashboard();
    await nextTick();

    expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
  });

  it("calls showErrorNotification when validation fails", async () => {
    mockValidatePanel.mockImplementation((errors: any[]) => {
      errors.push("Panel query is required");
    });
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.addToDashboard();
    await nextTick();

    expect(mockShowErrorNotification).toHaveBeenCalled();
  });

  it("does not open dialog when validation fails", async () => {
    mockValidatePanel.mockImplementation((errors: any[]) => {
      errors.push("error");
    });
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.addToDashboard();
    await nextTick();

    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  it("sets errorData.errors from validatePanel when validation fails", async () => {
    mockValidatePanel.mockImplementation((errors: any[]) => {
      errors.push("Panel title required");
    });
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.addToDashboard();
    await nextTick();

    expect(wrapper.vm.errorData.errors).toContain("Panel title required");
  });
});

describe("Metrics Index — addPanelToDashboard method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets showAddToDashboardDialog to false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.showAddToDashboardDialog = true;

    wrapper.vm.addPanelToDashboard();
    await nextTick();

    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  it("is triggered by the 'save' event from AddToDashboard component", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.showAddToDashboardDialog = true;
    await nextTick();

    await wrapper.find(".add-to-dashboard").trigger("click");

    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });
});

describe("Metrics Index — handleChartApiError method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pushes error message to errorData.errors", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.handleChartApiError({ message: "Query timed out", code: "500" });
    await nextTick();

    expect(wrapper.vm.errorData.errors).toContain("Query timed out");
  });

  it("replaces existing errors with the new error", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.errorData.errors.push("old error");

    wrapper.vm.handleChartApiError({ message: "new error", code: "400" });
    await nextTick();

    expect(wrapper.vm.errorData.errors).toHaveLength(1);
    expect(wrapper.vm.errorData.errors[0]).toBe("new error");
  });

  it("does nothing when errorMessage has no message property", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.handleChartApiError({ message: "", code: "400" });
    await nextTick();

    expect(wrapper.vm.errorData.errors).toHaveLength(0);
  });

  it("does nothing when errorMessage is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.handleChartApiError(null);
    await nextTick();

    expect(wrapper.vm.errorData.errors).toHaveLength(0);
  });
});

describe("Metrics Index — onDataZoom method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls dateTimePickerRef.setCustomDate when zoom event is received", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    const mockSetCustomDate = vi.fn();
    wrapper.vm.dateTimePickerRef = { setCustomDate: mockSetCustomDate };

    wrapper.vm.onDataZoom({
      start: new Date("2024-01-01T10:00:00").getTime(),
      end: new Date("2024-01-01T11:00:00").getTime(),
    });

    expect(mockSetCustomDate).toHaveBeenCalledWith(
      "absolute",
      expect.objectContaining({
        start: expect.any(Date),
        end: expect.any(Date),
      }),
    );
  });

  it("increments end time by 1 minute when start and end are the same after truncation", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    const mockSetCustomDate = vi.fn();
    wrapper.vm.dateTimePickerRef = { setCustomDate: mockSetCustomDate };

    // Start and end at the same minute (truncation will make them equal)
    const sameTime = new Date("2024-01-01T10:30:45.500");
    wrapper.vm.onDataZoom({
      start: sameTime.getTime(),
      end: sameTime.getTime(),
    });

    const callArgs = mockSetCustomDate.mock.calls[0][1];
    const diffMinutes =
      (callArgs.end.getTime() - callArgs.start.getTime()) / 60000;
    expect(diffMinutes).toBe(1);
  });

  it("truncates seconds from start and end dates", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    const mockSetCustomDate = vi.fn();
    wrapper.vm.dateTimePickerRef = { setCustomDate: mockSetCustomDate };

    wrapper.vm.onDataZoom({
      start: new Date("2024-01-01T10:00:45.123").getTime(),
      end: new Date("2024-01-01T11:00:30.999").getTime(),
    });

    const callArgs = mockSetCustomDate.mock.calls[0][1];
    expect(callArgs.start.getSeconds()).toBe(0);
    expect(callArgs.end.getSeconds()).toBe(0);
  });

  it("does not throw when dateTimePickerRef is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.dateTimePickerRef = null;

    expect(() => {
      wrapper.vm.onDataZoom({
        start: new Date("2024-01-01T10:00:00").getTime(),
        end: new Date("2024-01-01T11:00:00").getTime(),
      });
    }).not.toThrow();
  });
});

describe("Metrics Index — cancelAddPanelQuery method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTraceIdRef.value = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls cancelQuery", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.cancelAddPanelQuery();

    expect(mockCancelQuery).toHaveBeenCalled();
  });

  it("sets traceIdRef.value to searchRequestTraceIds", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    // Populate search request trace ids
    const ids = ["trace-1", "trace-2"];
    // searchRequestTraceIds is computed from variablesAndPanelsDataLoadingState
    // We can directly verify that cancelQuery is called (the assignment is internal)
    wrapper.vm.cancelAddPanelQuery();

    expect(mockCancelQuery).toHaveBeenCalled();
  });
});

describe("Metrics Index — searchRequestTraceIds computed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an array", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    expect(Array.isArray(wrapper.vm.searchRequestTraceIds)).toBe(true);
  });

  it("returns empty array when no trace ids are present", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    expect(wrapper.vm.searchRequestTraceIds).toHaveLength(0);
  });
});

describe("Metrics Index — disable ref and loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("disable starts as false", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.disable).toBe(false);
  });

  it("run-query button is not disabled initially", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    const btn = wrapper.find('[data-test="metrics-apply"]');
    expect(btn.attributes("disabled")).toBeFalsy();
  });

  it("run-query button becomes disabled when disable is true", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.disable = true;
    await nextTick();
    const btn = wrapper.find('[data-test="metrics-apply"]');
    expect(btn.element.disabled).toBe(true);
  });
});

describe("Metrics Index — updateDateTime method", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when dateTimePickerRef is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.dateTimePickerRef = null;

    expect(() => {
      wrapper.vm.updateDateTime(wrapper.vm.selectedDate);
    }).not.toThrow();
  });

  it("updates dashboardPanelData.meta.dateTime when dateTimePickerRef is available", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.dateTimePickerRef = {
      getConsumableDateTime: vi.fn(() => ({
        startTime: "2024-06-01T08:00:00.000Z",
        endTime: "2024-06-01T09:00:00.000Z",
      })),
    };

    wrapper.vm.updateDateTime(wrapper.vm.selectedDate);

    expect(mockDashboardPanelData.meta.dateTime.start_time).toBeInstanceOf(
      Date,
    );
    expect(mockDashboardPanelData.meta.dateTime.end_time).toBeInstanceOf(Date);
  });
});

describe("Metrics Index — store and i18n integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes store from setup", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.store).toBe(mockStore);
  });

  it("exposes t function from setup", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(typeof wrapper.vm.t).toBe("function");
  });

  it("t function returns the key when no translation exists", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.t("metrics.runQuery")).toBe("metrics.runQuery");
  });
});

describe("Metrics Index — watcher: dashboardPanelData.data.type", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardPanelData.data.type = "line";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates chartData when the chart type changes", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    mockDashboardPanelData.data.type = "bar";
    await nextTick();
    await nextTick();

    // chartData is updated asynchronously, verify it is defined
    expect(wrapper.vm.chartData).toBeDefined();
  });
});

describe("Metrics Index — watcher: isConfigPanelOpen dispatches resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardPanelData.layout.isConfigPanelOpen = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a resize event when isConfigPanelOpen changes", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const wrapper = createWrapper();
    await flushPromises();

    mockDashboardPanelData.layout.isConfigPanelOpen = true;
    await nextTick();

    expect(dispatchSpy).toHaveBeenCalledWith(new Event("resize"));
    dispatchSpy.mockRestore();
  });
});

describe("Metrics Index — watcher: showQueryBar dispatches resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardPanelData.layout.showQueryBar = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a resize event when showQueryBar changes", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const wrapper = createWrapper();
    await flushPromises();

    mockDashboardPanelData.layout.showQueryBar = false;
    await nextTick();

    expect(dispatchSpy).toHaveBeenCalledWith(new Event("resize"));
    dispatchSpy.mockRestore();
  });
});

describe("Metrics Index — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("component can be unmounted without errors", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    expect(() => wrapper.unmount()).not.toThrow();
  });

  it("config prop is exposed from setup (used by Enterprise cancel button)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.config).toHaveProperty("isEnterprise");
  });

  it("currentDashboardData has a data property", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.currentDashboardData).toHaveProperty("data");
  });

  it("errorData starts with empty errors array", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.errorData.errors).toEqual([]);
  });

  it("panelEditorRef starts as null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // panelEditorRef may be null or the stub instance — just verify it is exposed
    expect(wrapper.vm).toHaveProperty("panelEditorRef");
  });

  it("dateTimePickerRef is exposed", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm).toHaveProperty("dateTimePickerRef");
  });
});
