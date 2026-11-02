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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import ViewPanel from "./ViewPanel.vue";
import config from "@/aws-exports";
import PanelErrorButtons from "@/components/dashboards/PanelErrorButtons.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: {
    dashboard: "test-dashboard",
    folder: "test-folder",
    tab: "test-tab",
    refresh: "30s",
  },
  name: "viewPanel",
};

const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));

// Mock vue-i18n
const mockI18n = {
  t: (key: string) => {
    const translations: any = {
      "panel.cancel": "Cancel",
    };
    return translations[key] || key;
  },
};

vi.mock("vue-i18n", () => ({
  useI18n: () => mockI18n,
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    currentSelectedDashboard: {
      data: {
        title: "Test Dashboard",
        variables: {
          list: [],
          showDynamicFilters: false,
        },
      },
    },
    theme: "light",
    zoConfig: {
      min_auto_refresh_interval: 5,
    },
  },
};

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => mockStore,
  };
});

// Mock other composables that may be imported
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    searchAround: vi.fn(),
  }),
}));

// Mock additional utilities that may cause import issues
vi.mock("@/utils/zincutils", () => ({
  useLocalWrapContent: vi.fn(() => null),
}));
vi.mock("@/utils/query/sqlUtils", () => ({}));
vi.mock("@/utils/query/search", () => ({}));

// Mock dashboard composable
const mockDashboardPanelData = {
  data: {
    title: "Test Panel",
    type: "line",
    queries: [
      {
        query: "SELECT * FROM logs",
        fields: {
          x: [],
          y: [],
          z: [],
        },
      },
    ],
    queryType: "sql",
    panels: [
      {
        tabId: "tab1",
      },
    ],
  },
  meta: {
    dateTime: {
      start_time: new Date("2023-01-01"),
      end_time: new Date("2023-01-02"),
    },
  },
};

const mockResetDashboardPanelData = vi.fn();

vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: false,
    resetDashboardPanelData: mockResetDashboardPanelData,
  }),
}));

// Mock utilities
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
  getPanel: vi.fn(),
  checkIfVariablesAreLoaded: vi.fn(),
}));

// Mock SQL parser
const mockSqlParser = vi.fn();
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () =>
      Promise.resolve({
        astify: mockSqlParser,
      }),
  }),
}));

// Mock cancel query composable
vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: { value: "test-trace-id" },
    cancelQuery: vi.fn(),
  }),
}));

// Mock date utilities
vi.mock("@/utils/date", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  parseDuration: vi.fn((duration: string) => {
    if (duration === "30s") return 30;
    if (duration === "1m") return 60;
    return 0;
  }),
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
  },
}));

// Mock lodash-es
vi.mock("lodash-es", () => ({
  isEqual: vi.fn((a, b) => JSON.stringify(a) === JSON.stringify(b)),
}));

const pickerSetSavedDate = vi.fn();

describe("ViewPanel", () => {
  let wrapper: VueWrapper<any>;
  let mockGetDashboard: any;
  let mockGetPanel: any;
  let mockCheckIfVariablesAreLoaded: any;

  const defaultProps = {
    panelId: "test-panel-id",
    dashboardId: "test-dashboard-id",
    folderId: "test-folder-id",
    selectedDateForViewPanel: {
      startTime: new Date("2023-01-01"),
      endTime: new Date("2023-01-02"),
    },
    initialVariableValues: {},
    searchType: "logs",
  };

  const createWrapper = (props = {}, extraStubs: Record<string, unknown> = {}) => {
    return mount(ViewPanel, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          DateTimePickerDashboard: {
            name: "DateTimePickerDashboard",
            template: '<div data-test="date-time-picker-dashboard"><slot /></div>',
            props: ["modelValue", "autoApplyDashboard", "disable"],
            emits: ["update:modelValue", "show", "hide", "timezone-change"],
            methods: {
              refresh: vi.fn(),
              setSavedDate: pickerSetSavedDate,
              getConsumableDateTime: () => ({
                startTime: "2023-01-01T00:00:00Z",
                endTime: "2023-01-02T00:00:00Z",
              }),
            },
          },
          AutoRefreshInterval: {
            template: '<div data-test="auto-refresh-interval"><slot /></div>',
            props: ["modelValue", "trigger", "minRefreshInterval"],
            emits: ["trigger"],
          },
          HistogramIntervalDropDown: {
            template: '<div data-test="histogram-interval-dropdown"><slot /></div>',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          VariablesValueSelector: {
            template: '<div data-test="variables-value-selector"><slot /></div>',
            props: [
              "variablesConfig",
              "showDynamicFilters",
              "selectedTimeDate",
              "initialVariableValues",
            ],
            emits: ["variablesData"],
          },
          PanelSchemaRenderer: {
            template: '<div data-test="panel-schema-renderer"><slot /></div>',
            props: [
              "panelSchema",
              "dashboardId",
              "folderId",
              "selectedTimeObj",
              "variablesData",
              "width",
              "searchType",
            ],
            emits: [
              "error",
              "updated:data-zoom",
              "update:initialVariableValues",
              "last-triggered-at-update",
            ],
          },
          DashboardErrorsComponent: {
            template: '<div data-test="dashboard-errors-component"><slot /></div>',
            props: ["errors"],
          },
          RelativeTime: {
            template: '<span data-test="relative-time">{{ timestamp }}</span>',
            props: ["timestamp", "fullTimePrefix"],
          },
          PanelErrorButtons: {
            template: `<div>
              <button v-if="error" data-test="panel-error-data" class="warning">
                <span>{{ error }}</span>
              </button>
              <button v-if="maxQueryRangeWarning" data-test="panel-max-duration-warning" class="warning">
                <span>{{ maxQueryRangeWarning }}</span>
              </button>
              <button v-if="limitNumberOfSeriesWarningMessage" data-test="panel-limit-number-of-series-warning" class="warning">
                <span>{{ limitNumberOfSeriesWarningMessage }}</span>
              </button>
              <button v-if="isCachedDataDifferWithCurrentTimeRange" data-test="panel-is-cached-data-differ-with-current-time-range-warning">
                <span>The data shown is cached</span>
              </button>
              <button v-if="isPartialData && !isPanelLoading" data-test="panel-partial-data-warning" class="warning">
                <span>Partial data</span>
              </button>
              <span v-if="lastTriggeredAt && !viewOnly" class="lastRefreshedAt">
                <span data-test="relative-time">{{ lastTriggeredAt }}</span>
              </span>
            </div>`,
            props: [
              "error",
              "maxQueryRangeWarning",
              "limitNumberOfSeriesWarningMessage",
              "isCachedDataDifferWithCurrentTimeRange",
              "isPartialData",
              "isPanelLoading",
              "lastTriggeredAt",
              "viewOnly",
            ],
          },
          OIcon: {
            template: '<i class="OIcon"></i>',
            props: ["name"],
          },
          OButton: {
            name: "OButton",
            template:
              '<button @click="$emit(\'click\', $event)" :disabled="disabled" :data-test="$attrs[\'data-test\']"><slot name="icon-left" /><slot /></button>',
            props: ["variant", "size", "disabled", "loading", "label"],
            emits: ["click"],
            inheritAttrs: false,
          },
          ODialog: {
            name: "ODialog",
            inheritAttrs: false,
            template:
              '<div data-test="o-dialog" v-if="open"><slot name="header" /><slot /><slot name="footer" /></div>',
            props: [
              "open",
              "size",
              "title",
              "subTitle",
              "showClose",
              "persistent",
              "width",
              "primaryButtonLabel",
              "secondaryButtonLabel",
              "neutralButtonLabel",
              "primaryButtonVariant",
              "secondaryButtonVariant",
              "neutralButtonVariant",
              "primaryButtonDisabled",
              "secondaryButtonDisabled",
              "neutralButtonDisabled",
              "primaryButtonLoading",
              "secondaryButtonLoading",
              "neutralButtonLoading",
            ],
            emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
          },
          ShowLegendsPopup: {
            name: "ShowLegendsPopup",
            template:
              '<div data-test="show-legends-popup"><button data-test="show-legends-popup-close" @click="$emit(\'update:open\', false)">close</button></div>',
            props: ["panelData", "open"],
            emits: ["update:open"],
          },
          ...extraStubs,
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked functions
    const { getDashboard, getPanel, checkIfVariablesAreLoaded } =
      await import("../../../utils/commons");

    mockGetDashboard = getDashboard as any;
    mockGetPanel = getPanel as any;
    mockCheckIfVariablesAreLoaded = checkIfVariablesAreLoaded as any;

    mockGetDashboard.mockResolvedValue({
      title: "Test Dashboard",
      variables: {
        list: [],
        showDynamicFilters: false,
      },
    });

    mockGetPanel.mockResolvedValue({
      title: "Test Panel",
      type: "line",
      queries: [
        {
          query: "SELECT * FROM logs",
          fields: { x: [], y: [], z: [] },
        },
      ],
    });

    mockCheckIfVariablesAreLoaded.mockReturnValue(true);

    mockSqlParser.mockReturnValue({
      columns: [],
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("notice chips with the real PanelErrorButtons", () => {
    const VRL_ERROR = "error[E203]: syntax error";
    it("feeds the renderer's diagnostics into the chips and drops VRL errors from the range warning", async () => {
      wrapper = createWrapper({}, { PanelErrorButtons });
      await flushPromises();
      wrapper.vm.handleResultMetadataUpdate([[{ function_error: [VRL_ERROR] }]]);
      wrapper.vm.handlePanelDiagnosticsUpdate({
        queries: [],
        serverPartial: false,
        rowsCapped: false,
        partialReasons: [],
        functionErrors: [VRL_ERROR],
      });
      wrapper.vm.handleSeriesLimitUpdate({ shown: 100, total: 342, cap: 100 });
      await flushPromises();

      const buttons = wrapper.findComponent(PanelErrorButtons);
      expect(buttons.exists()).toBe(true);
      expect(buttons.props("functionErrors")).toEqual([VRL_ERROR]);
      expect(buttons.props("seriesLimit")).toEqual({ shown: 100, total: 342, cap: 100 });
      expect(buttons.props("canEdit")).toBe(true);
      expect(buttons.props("canRefresh")).toBe(true);
      expect(buttons.props("canInspect")).toBe(false);
      expect(wrapper.vm.maxQueryRangeWarning).toBe("");
      expect(wrapper.find('[data-test="panel-max-duration-warning"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="panel-notice-chip-function-error"]').exists()).toBe(true);
    });

    it("closes the view and opens the editor on the fix for Edit function and Use Top N", async () => {
      wrapper = createWrapper({}, { PanelErrorButtons });
      await flushPromises();
      const buttons = wrapper.findComponent(PanelErrorButtons);

      buttons.vm.$emit("edit-panel", "edit-function");
      expect(wrapper.emitted("closePanel")).toHaveLength(1);
      expect(mockRouter.push).toHaveBeenLastCalledWith(
        expect.objectContaining({
          path: "/dashboards/add_panel",
          query: expect.objectContaining({ panelId: "test-panel-id", focus: "vrl" }),
        }),
      );

      buttons.vm.$emit("edit-panel", "use-top-n");
      expect(mockRouter.push).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ focus: "top-n" }) }),
      );
    });

    it("hides the editor actions in a view-only embedding", async () => {
      wrapper = createWrapper({ viewOnly: true }, { PanelErrorButtons });
      await flushPromises();
      expect(wrapper.findComponent(PanelErrorButtons).props("canEdit")).toBe(false);
    });

    it("refreshes the view from a notice's Refresh", async () => {
      wrapper = createWrapper({}, { PanelErrorButtons });
      await flushPromises();
      const listener = wrapper.findComponent(PanelErrorButtons).vm.$.vnode.props?.onRefreshPanel;
      expect(listener).toBe(wrapper.vm.refreshData);
    });
  });

  describe("Component Initialization", () => {
    it("should display panel title", () => {
      wrapper = createWrapper();

      const titleElement = wrapper.find('[data-test="dashboard-viewpanel-title"]');
      expect(titleElement.text()).toBe("Test Panel");
    });

    it("should resolve variables in the panel title from the applied values", async () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.title = "Inlet temperature — $row";
      wrapper.vm.currentVariablesDataRef.values = [{ name: "row", value: "C" }];
      await wrapper.vm.$nextTick();

      const titleElement = wrapper.find('[data-test="dashboard-viewpanel-title"]');
      expect(titleElement.text()).toBe("Inlet temperature — C");
    });
  });

  describe("Histogram Functionality", () => {
    it("should show histogram dropdown when promql is false and histogram fields exist", async () => {
      // Setup histogram fields
      wrapper = createWrapper();
      wrapper.vm.histogramFields = [{ field: "timestamp" }];
      wrapper.vm.promqlMode = false;
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="dashboard-viewpanel-histogram-interval-dropdown"]').exists(),
      ).toBe(true);
    });

    it("should not show histogram dropdown when promql mode is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.histogramFields = [{ field: "timestamp" }];
      wrapper.vm.promqlMode = true;
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="dashboard-viewpanel-histogram-interval-dropdown"]').exists(),
      ).toBe(false);
    });
  });

  describe("Histogram Interval Extraction (Bug Fix Tests)", () => {
    /**
     * These tests verify the fix for the bug where histogram intervals displayed as "[object object]"
     * The bug was caused by incorrectly accessing args[0].value instead of args[1]
     *
     * Histogram function signature: histogram(field, interval)
     * - args[0] = timestamp field (object)
     * - args[1] = interval value (string or object with value property)
     */

    beforeEach(async () => {
      // Setup common test data
      mockGetPanel.mockResolvedValue({
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [
          {
            query: 'SELECT histogram(_timestamp, "5m") FROM logs',
            fields: { x: [], y: [], z: [] },
          },
        ],
      });
    });

    it("should correctly extract string interval from histogram args (e.g., '5m', '1h')", async () => {
      // Test case 1: String intervals
      // Simulates: histogram(_timestamp, '5m')
      const histogramFieldWithStringInterval = {
        functionName: "histogram",
        args: [
          { column: "_timestamp" }, // args[0] - timestamp field
          "5m", // args[1] - interval as string
        ],
      };

      const panelData = {
        title: "Test Panel",
        type: "line",
        queryType: "sql",
        queries: [
          {
            query: 'SELECT histogram(_timestamp, "5m") FROM logs',
            fields: {
              x: [histogramFieldWithStringInterval],
              y: [],
              z: [],
            },
          },
        ],
      };

      mockGetPanel.mockResolvedValue(panelData);

      // Also update the mockDashboardPanelData to ensure the component reads the correct data
      Object.assign(mockDashboardPanelData.data, panelData);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      // Wait for async operations in onMounted
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The component should extract '5m' from args[1]
      expect(wrapper.vm.histogramInterval).toBe("5m");
      expect(wrapper.vm.histogramInterval).not.toBe("[object object]");
    });
  });

  describe("Button Actions", () => {
    it("shows a labelled Cancel while an enterprise query runs, with the options arrow to match", async () => {
      const wasEnterprise = config.isEnterprise;
      config.isEnterprise = "true";
      try {
        wrapper = createWrapper();
        await flushPromises();
        const loading = (wrapper.vm as any).$.provides.variablesAndPanelsDataLoadingState;
        loading.searchRequestTraceIds = { p1: ["trace-id-1"] };
        loading.panels = { p1: true };
        await flushPromises();

        const cancel = wrapper
          .findAllComponents({ name: "OButton" })
          .find((b) => b.attributes("data-test") === "dashboard-viewpanel-cancel-btn")!;
        expect(cancel.props("variant")).toBe("cancel-query");
        expect(cancel.text()).toContain("Cancel");
        expect(wrapper.vm.refreshOptionsVariant).toBe("cancel-query");
        // No X icon on wide screens; a hidden Refresh label keeps the button width. The OButton
        // stub keeps icon-left in $attrs rather than on the DOM.
        expect(cancel.vm.$attrs["icon-left"]).toBeUndefined();
        expect(cancel.find('[aria-hidden="true"]').text()).toContain(
          "dashboard.viewDashboard.refresh",
        );
      } finally {
        config.isEnterprise = wasEnterprise;
      }
    });
  });

  describe("Data Loading", () => {
    it("should load panel data on mount when panelId is provided", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(mockGetPanel).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard",
        "test-panel-id",
        "test-folder",
        "test-tab",
      );
    });
  });

  describe("DateTime Handling", () => {
    it("should update datetime when selected date changes", async () => {
      wrapper = createWrapper();

      const newDate = {
        startTime: new Date("2023-02-01"),
        endTime: new Date("2023-02-02"),
      };

      wrapper.vm.selectedDate = newDate;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.meta.dateTime.start_time).toEqual(newDate.startTime);
      expect(wrapper.vm.dashboardPanelData.meta.dateTime.end_time).toEqual(newDate.endTime);
    });
  });

  describe("Variables Handling", () => {
    it("should handle variables data update", async () => {
      wrapper = createWrapper();

      const variableData = {
        values: [{ name: "var1", value: "value1" }],
      };

      wrapper.vm.variablesDataUpdated(variableData);

      expect(wrapper.vm.variablesData.values).toEqual(variableData.values);
    });

    it("should emit update for initial variable values", async () => {
      wrapper = createWrapper();

      wrapper.vm.onUpdateInitialVariableValues({ var1: "updated" });

      expect(wrapper.emitted("update:initialVariableValues")).toBeTruthy();
      expect(wrapper.emitted("update:initialVariableValues")[0]).toEqual([{ var1: "updated" }]);
    });
  });

  describe("Refresh Functionality", () => {
    it("should refresh data when not disabled", () => {
      wrapper = createWrapper();
      wrapper.vm.disable = false;
      const appliedBefore = wrapper.vm.selectedDate;

      wrapper.vm.refreshData();

      expect(wrapper.vm.selectedDate).not.toBe(appliedBefore);
      expect(wrapper.vm.selectedDate).toEqual(appliedBefore);
    });

    it("should not refresh data when disabled", () => {
      wrapper = createWrapper();
      wrapper.vm.disable = true;
      const appliedBefore = wrapper.vm.selectedDate;

      wrapper.vm.refreshData();

      expect(wrapper.vm.selectedDate).toBe(appliedBefore);
    });
  });

  describe("time range without Apply", () => {
    const MINUTE = 60 * 1_000_000;
    const relative = (period: string) => ({
      valueType: "relative",
      relativeTimePeriod: period,
      startTime: 1,
      endTime: 2,
    });
    const setAutoRun = (on: boolean) => {
      mockStore.state.zoConfig = { ...mockStore.state.zoConfig, auto_query_enabled: on };
      localStorage.setItem("oo_toggle_auto_run", String(on));
    };
    const picker = () => wrapper.findComponent({ name: "DateTimePickerDashboard" });
    const pick = async (value: any) => {
      picker().vm.$emit("update:modelValue", value);
      await flushPromises();
    };
    const refreshTooltip = () =>
      wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((tip) => tip.find('[data-test="dashboard-viewpanel-refresh-data-btn"]').exists())
        ?.props("content");
    const chartSpan = () => {
      const time = wrapper.vm.dashboardPanelData.meta.dateTime;
      return time.end_time.getTime() - time.start_time.getTime();
    };
    const mountOnRange = async () => {
      wrapper = createWrapper({ selectedDateForViewPanel: relative("15m") });
      await flushPromises();
      await pick(relative("15m"));
    };

    afterEach(() => {
      localStorage.removeItem("oo_toggle_auto_run");
      mockStore.state.zoConfig = { ...mockStore.state.zoConfig, auto_query_enabled: false };
    });

    it("uses the picker without an Apply button", async () => {
      await mountOnRange();

      expect(picker().props("autoApplyDashboard")).toBe(true);
      expect(chartSpan()).toBe(15 * MINUTE);
    });

    it("keeps a picked range waiting with Auto Run off and turns Refresh yellow", async () => {
      setAutoRun(false);
      await mountOnRange();

      await pick(relative("1h"));

      expect(picker().props("modelValue").relativeTimePeriod).toBe("1h");
      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("15m");
      expect(chartSpan()).toBe(15 * MINUTE);
      expect(wrapper.vm.showApplyHint).toBe(true);
      expect(refreshTooltip()).toBe("dashboard.refreshToApplyTimeRange");
    });

    it("applies the waiting range on Refresh", async () => {
      setAutoRun(false);
      await mountOnRange();
      await pick(relative("1h"));

      wrapper.vm.disable = false;
      wrapper.vm.refreshData();
      await flushPromises();

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
      expect(chartSpan()).toBe(60 * MINUTE);
      expect(wrapper.vm.showApplyHint).toBe(false);
    });

    it("names both when variables are waiting too", async () => {
      setAutoRun(false);
      await mountOnRange();
      wrapper.vm.isVariablesChanged = true;

      await pick(relative("1h"));

      expect(refreshTooltip()).toBe("dashboard.refreshToApplyTimeRangeAndVariables");
    });

    it("loads variables on the applied range when the picker closes", async () => {
      setAutoRun(false);
      await mountOnRange();
      picker().vm.$emit("show");
      await pick(relative("1h"));

      picker().vm.$emit("hide");
      await flushPromises();

      const time = wrapper.vm.dateTimeForVariables;
      expect(time.end_time.getTime() - time.start_time.getTime()).toBe(15 * MINUTE);
    });

    it("puts the picker back on the applied range when it closes on a broken range", async () => {
      setAutoRun(false);
      await mountOnRange();
      pickerSetSavedDate.mockClear();
      picker().vm.$emit("show");
      await pick({ valueType: "absolute", startTime: 300 * MINUTE, endTime: 200 * MINUTE });

      picker().vm.$emit("hide");
      await flushPromises();

      expect(pickerSetSavedDate).toHaveBeenCalledWith({
        type: "relative",
        relativeTimePeriod: "15m",
      });
      expect(picker().props("modelValue").relativeTimePeriod).toBe("15m");
      expect(wrapper.vm.showApplyHint).toBe(false);
      expect(chartSpan()).toBe(15 * MINUTE);
    });

    it("applies a preset at once with Auto Run on", async () => {
      setAutoRun(true);
      await mountOnRange();

      await pick(relative("1h"));

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
      expect(chartSpan()).toBe(60 * MINUTE);
      expect(wrapper.vm.showApplyHint).toBe(false);
    });
  });

  describe("Refresh apply state and Auto Run", () => {
    const setAutoQuery = (enabled: boolean) => {
      mockStore.state.zoConfig = { ...mockStore.state.zoConfig, auto_query_enabled: enabled };
    };

    const changeAppliedVariables = async () => {
      mockCheckIfVariablesAreLoaded.mockReturnValue(true);
      wrapper.vm.variablesDataUpdated({ values: [{ name: "a", value: "1" }] });
      await flushPromises();
      wrapper.vm.variablesDataUpdated({ values: [{ name: "a", value: "2" }] });
      await flushPromises();
    };

    const refreshButton = () =>
      wrapper
        .findAllComponents({ name: "OButton" })
        .find((b) => b.attributes("data-test") === "dashboard-viewpanel-refresh-data-btn")!;
    const refreshTooltipWrapper = () =>
      wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((tip) => tip.find('[data-test="dashboard-viewpanel-refresh-data-btn"]').exists())!;

    afterEach(() => {
      localStorage.removeItem("oo_toggle_auto_run");
      setAutoQuery(false);
    });

    it("Refresh is not amber when nothing has changed", async () => {
      wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.variablesDataUpdated({ isVariablesLoading: false, values: [] });
      await flushPromises();

      expect(wrapper.vm.isVariablesChanged).toBe(false);
      expect(wrapper.vm.showApplyHint).toBe(false);
      expect(refreshButton().props("variant")).toBe("primary");
      expect(refreshButton().text()).toContain("dashboard.viewDashboard.refresh");
      expect(refreshTooltipWrapper().props("disabled")).toBe(true);
    });

    it("Refresh turns amber on an unapplied change and clears after Refresh", async () => {
      wrapper = createWrapper();
      await flushPromises();
      await changeAppliedVariables();
      expect(wrapper.vm.showApplyHint).toBe(true);
      expect(refreshButton().props("variant")).toBe("pending");
      expect(refreshTooltipWrapper().props("disabled")).toBe(false);

      wrapper.vm.disable = false;
      wrapper.vm.refreshData();
      await flushPromises();
      expect(wrapper.vm.showApplyHint).toBe(false);
      expect(refreshButton().props("variant")).toBe("primary");
    });

    it("hides the Auto Run menu when the server flag is off", async () => {
      setAutoQuery(false);
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-viewpanel-refresh-options-btn"]').exists()).toBe(
        false,
      );
    });

    it("offers the Auto Run menu and never shows amber while Auto Run is on", async () => {
      setAutoQuery(true);
      wrapper = createWrapper();
      await flushPromises();
      await changeAppliedVariables();

      expect(wrapper.find('[data-test="dashboard-viewpanel-refresh-options-btn"]').exists()).toBe(
        true,
      );
      expect(wrapper.vm.isAutoRunOn).toBe(true);
      expect(wrapper.vm.showApplyHint).toBe(false);
      expect(refreshButton().props("variant")).toBe("primary");
    });

    it("uses the dashboard Auto Run copy for the Refresh tooltip while Auto Run is on", async () => {
      setAutoQuery(true);
      wrapper = createWrapper();
      await flushPromises();

      const tooltip = wrapper
        .findAllComponents({ name: "OTooltip" })
        .find((tip) => tip.find('[data-test="dashboard-viewpanel-refresh-data-btn"]').exists())
        ?.props("content");
      expect(tooltip).toBe("dashboard.viewDashboard.autoRunDescription");
    });

    it("describes Auto Run in its menu item like the dashboard toolbar, in both states", async () => {
      setAutoQuery(true);
      wrapper = createWrapper(
        {},
        {
          ODropdown: { template: '<span><slot name="trigger" /><slot /></span>' },
          ODropdownItem: { template: '<span><slot name="icon-left" /><slot /></span>' },
        },
      );
      await flushPromises();
      const toggle = () => wrapper.find('[data-test="dashboard-viewpanel-auto-run-toggle-btn"]');
      const lines = () =>
        toggle()
          .findAll("div")
          .map((line: any) => line.text());

      expect(lines()).toEqual([
        "search.turnOffLiveMode",
        "dashboard.viewDashboard.autoRunDescription",
        "dashboard.viewDashboard.autoRunScope",
      ]);
      expect(toggle().find('[data-test="dashboard-viewpanel-auto-run-scope"]').classes()).toEqual(
        expect.arrayContaining(["text-text-secondary", "text-xs"]),
      );

      wrapper.vm.toggleAutoRun();
      await flushPromises();

      expect(lines()).toEqual([
        "search.turnOnLiveMode",
        "dashboard.viewDashboard.autoRunDescription",
        "dashboard.viewDashboard.autoRunScope",
      ]);
    });
  });

  describe("Component Lifecycle", () => {
    it("should reset dashboard panel data on unmount", () => {
      wrapper = createWrapper();
      wrapper.unmount();

      expect(mockResetDashboardPanelData).toHaveBeenCalled();
    });
  });

  describe("Show Legends Dialog (ODialog)", () => {
    it("should show ShowLegendsPopup with open=true when showLegendsDialog is true", async () => {
      wrapper = createWrapper();

      wrapper.vm.showLegendsDialog = true;
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: "ShowLegendsPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.props("open")).toBe(true);
    });

    it("should close dialog when ShowLegendsPopup emits update:open=false", async () => {
      wrapper = createWrapper();

      wrapper.vm.showLegendsDialog = true;
      await wrapper.vm.$nextTick();

      const popup = wrapper.findComponent({ name: "ShowLegendsPopup" });
      await popup.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showLegendsDialog).toBe(false);
      expect(popup.props("open")).toBe(false);
    });
  });
});
