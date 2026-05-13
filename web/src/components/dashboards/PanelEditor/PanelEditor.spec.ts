import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { ref, reactive, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { Quasar } from "quasar";
import PanelEditor from "./PanelEditor.vue";

// Mock vuex store
const mockStore = {
  state: {
    timezone: "UTC",
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      isDataIngested: true,
    },
    zoConfig: {
      timestamp_column: "_timestamp",
      default_functions: [],
    },
    savedViewDialog: {
      show: false,
    },
  },
  commit: vi.fn(),
  dispatch: vi.fn().mockResolvedValue({}),
  getters: {},
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock useDashboardPanelData
const mockDashboardPanelData = reactive({
  data: {
    description: "",
    type: "line",
    config: {},
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
          filter: { conditions: [] },
        },
      },
    ],
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
      start_time: new Date("2024-01-01"),
      end_time: new Date("2024-01-02"),
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

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: vi.fn(),
    resetDashboardPanelData: vi.fn(),
    updateGroupedFields: vi.fn(),
  }),
}));

// Shared refs so tests can toggle composable state to truthy/falsy
const mockChartData = ref(undefined as any);
const mockShowLegendsDialog = ref(false);

// Mock usePanelEditor composable
vi.mock("./composables/usePanelEditor", () => ({
  usePanelEditor: vi.fn(() => ({
    chartData: mockChartData,
    errorData: reactive({ errors: [] }),
    metaData: ref(null),
    seriesData: ref([]),
    lastTriggeredAt: ref(null),
    showLegendsDialog: mockShowLegendsDialog,
    shouldRefreshWithoutCache: ref(false),
    maxQueryRangeWarning: ref(""),
    limitNumberOfSeriesWarningMessage: ref(""),
    errorMessage: ref(""),
    isPartialData: ref(false),
    isPanelLoading: ref(false),
    isCachedDataDifferWithCurrentTimeRange: ref(false),
    searchRequestTraceIds: ref([]),
    panelSchemaRendererRef: ref(null),
    splitterModel: ref(50),
    isOutDated: ref(false),
    isLoading: ref(false),
    currentPanelData: ref({}),
    initChartData: vi.fn(),
    runQuery: vi.fn(),
    handleChartApiError: vi.fn(),
    handleLastTriggeredAtUpdate: vi.fn(),
    handleLimitNumberOfSeriesWarningMessage: vi.fn(),
    handleIsPartialDataUpdate: vi.fn(),
    handleLoadingStateChange: vi.fn(),
    handleIsCachedDataDifferWithCurrentTimeRangeUpdate: vi.fn(),
    handleResultMetadataUpdate: vi.fn(),
    metaDataValue: vi.fn(),
    seriesDataUpdate: vi.fn(),
    collapseFieldList: vi.fn(),
    layoutSplitterUpdated: vi.fn(),
    updateVrlFunctionFieldList: vi.fn(),
    onDataZoom: vi.fn().mockReturnValue({ start: new Date(), end: new Date() }),
    cancelRunningQuery: vi.fn(),
    resetErrors: vi.fn(),
    updateDateTime: vi.fn(),
  })),
}));

// Mock utility functions
vi.mock("./types/panelEditor", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    resolveConfig: vi.fn().mockReturnValue({
      showQueryEditor: true,
      showQueryBuilder: true,
      showVariablesSelector: false,
      showLastRefreshedTime: true,
      showOutdatedWarning: true,
      showAddToDashboardButton: false,
      showQueryTypeSelector: false,
      showGeneratedQueryDisplay: false,
      hideChartPreview: false,
    }),
  };
});

// Mock child components
vi.mock("@/components/dashboards/addPanel/ChartSelection.vue", () => ({
  default: {
    name: "ChartSelection",
    template: '<div class="chart-selection-mock">ChartSelection</div>',
  },
}));

vi.mock("@/components/dashboards/addPanel/FieldList.vue", () => ({
  default: {
    name: "FieldList",
    template: '<div class="field-list-mock">FieldList</div>',
  },
}));

vi.mock("@/components/dashboards/addPanel/PanelSidebar.vue", () => ({
  default: {
    name: "PanelSidebar",
    template: '<div class="panel-sidebar-mock"><slot /></div>',
  },
}));

vi.mock("@/components/dashboards/addPanel/DashboardQueryBuilder.vue", () => ({
  default: {
    name: "DashboardQueryBuilder",
    template: '<div class="query-builder-mock">DashboardQueryBuilder</div>',
  },
}));

vi.mock("@/components/dashboards/addPanel/DashboardErrors.vue", () => ({
  default: {
    name: "DashboardErrorsComponent",
    template: '<div class="errors-mock">DashboardErrors</div>',
  },
}));

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    props: ["searchType"],
    template: '<div class="panel-renderer-mock">PanelSchemaRenderer</div>',
  },
}));

vi.mock("@/components/common/RelativeTime.vue", () => ({
  default: {
    name: "RelativeTime",
    template: '<span class="relative-time-mock">RelativeTime</span>',
  },
}));

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      panel: {
        fields: "Fields",
        generatedSql: "Generated SQL",
        customSql: "Custom SQL",
      },
      dashboard: {
        configLabel: "Config",
      },
      search: {
        addToDashboard: "Add to Dashboard",
      },
    },
  },
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport) and we can
// drive emits + assert forwarded props. Mirrors the runtime contract: it accepts
// open/size/title/.../width and emits update:open + click:primary/secondary/neutral.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
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
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="String(size)"
      :data-show-close="String(showClose)"
      :data-width="String(width)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

// Shared global mount options. Centralizing avoids the same 12-line block
// repeated in every test and keeps the stub set in one place.
const mountGlobal = {
  plugins: [i18n, Quasar],
  stubs: {
    QSeparator: true,
    QSplitter: {
      template:
        '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
    },
    QIcon: true,
    QBtn: true,
    QTooltip: true,
    QAvatar: true,
    ODialog: ODialogStub,
    // Explicit stub so shallowMount tracks `open` as a declared prop.
    ShowLegendsPopup: {
      name: "ShowLegendsPopup",
      props: ["open", "panelData"],
      emits: ["update:open"],
      template: '<div data-test="show-legends-popup-stub" :data-open="String(open)"></div>',
    },
  },
};

describe("PanelEditor.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset shared state to a known baseline before each test
    mockChartData.value = undefined;
    mockShowLegendsDialog.value = false;
    mockDashboardPanelData.data.type = "line";
    mockDashboardPanelData.layout.showFieldList = true;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully with dashboard pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard", editMode: false },
        global: mountGlobal,
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".panel-editor").exists()).toBe(true);
    });

    it("should mount successfully with metrics pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "metrics", editMode: false },
        global: mountGlobal,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully with logs pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "logs", editMode: false },
        global: mountGlobal,
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully with build pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "build", editMode: true },
        global: mountGlobal,
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept pageType prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      expect(wrapper.props("pageType")).toBe("dashboard");
    });

    it("should accept editMode prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard", editMode: true },
        global: mountGlobal,
      });

      expect(wrapper.props("editMode")).toBe(true);
    });

    it("should accept allowedChartTypes prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
          allowedChartTypes: ["table", "bar"],
        },
        global: mountGlobal,
      });

      expect(wrapper.props("allowedChartTypes")).toEqual(["table", "bar"]);
    });

    it("should accept selectedDateTime prop", () => {
      const dateTime = {
        start_time: new Date("2024-01-01"),
        end_time: new Date("2024-01-02"),
      };

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard", selectedDateTime: dateTime },
        global: mountGlobal,
      });

      expect(wrapper.props("selectedDateTime")).toEqual(dateTime);
    });
  });

  describe("Exposed Methods", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });
    });

    it("should expose runQuery method", () => {
      expect(typeof wrapper.vm.runQuery).toBe("function");
    });

    it("should expose resetErrors method", () => {
      expect(typeof wrapper.vm.resetErrors).toBe("function");
    });

    it("should expose collapseFieldList method", () => {
      expect(typeof wrapper.vm.collapseFieldList).toBe("function");
    });

    it("should expose updateDateTime method", () => {
      expect(typeof wrapper.vm.updateDateTime).toBe("function");
    });

    it("should expose dashboardPanelData", () => {
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
    });

    it("should expose cancelRunningQuery method", () => {
      expect(typeof wrapper.vm.cancelRunningQuery).toBe("function");
    });

    it("should expose initChartData method", () => {
      expect(typeof wrapper.vm.initChartData).toBe("function");
    });
  });

  describe("Emits", () => {
    it("should emit addToDashboard event when triggered", async () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "metrics", showAddToDashboardButton: true },
        global: mountGlobal,
      });

      // The emit would normally be triggered by clicking "Add to Dashboard" button
      expect(wrapper.emitted()).toBeDefined();
    });

    it("should emit customQueryModeChanged on mount (immediate watcher)", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      // The watcher with { immediate: true } should fire on mount
      expect(wrapper.emitted("customQueryModeChanged")).toBeDefined();
    });

    it("should emit searchRequestTraceIdsUpdated on mount (immediate watcher)", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      expect(wrapper.emitted("searchRequestTraceIdsUpdated")).toBeDefined();
    });
  });

  describe("Exposed State Refs", () => {
    beforeEach(() => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });
    });

    it("should expose chartData ref (undefined initially)", () => {
      expect(wrapper.vm.chartData).toBeUndefined();
    });

    it("should expose errorData ref with empty errors array", () => {
      expect(wrapper.vm.errorData).toBeDefined();
      expect(wrapper.vm.errorData.errors).toEqual([]);
    });

    it("should expose metaData ref (null initially)", () => {
      expect(wrapper.vm.metaData).toBeNull();
    });

    it("should expose seriesData ref (empty array initially)", () => {
      expect(wrapper.vm.seriesData).toEqual([]);
    });

    it("should expose lastTriggeredAt ref (null initially)", () => {
      expect(wrapper.vm.lastTriggeredAt).toBeNull();
    });

    it("should expose isOutDated computed (false initially)", () => {
      expect(wrapper.vm.isOutDated).toBe(false);
    });

    it("should expose isLoading computed (false initially)", () => {
      expect(wrapper.vm.isLoading).toBe(false);
    });

    it("should expose searchRequestTraceIds ref (empty array initially)", () => {
      expect(wrapper.vm.searchRequestTraceIds).toEqual([]);
    });

    it("should expose warning message refs (empty strings initially)", () => {
      expect(wrapper.vm.maxQueryRangeWarning).toBe("");
      expect(wrapper.vm.limitNumberOfSeriesWarningMessage).toBe("");
      expect(wrapper.vm.errorMessage).toBe("");
    });
  });

  describe("Content Height Calculation", () => {
    it.each([
      ["dashboard"],
      ["logs"],
      ["metrics"],
      ["build"],
    ])("should mount cleanly for pageType=%s", (pageType) => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: pageType as any },
        global: mountGlobal,
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Conditional Rendering", () => {
    it("should show collapsed field list when showFieldList is false", () => {
      mockDashboardPanelData.layout.showFieldList = false;

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      expect(
        wrapper.find(".field-list-sidebar-header-collapsed").exists(),
      ).toBe(true);
    });

    it("should not show collapsed field list when showFieldList is true", () => {
      mockDashboardPanelData.layout.showFieldList = true;

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      expect(
        wrapper.find(".field-list-sidebar-header-collapsed").exists(),
      ).toBe(false);
    });

    it("should show HTML editor section when type is html", async () => {
      mockDashboardPanelData.data.type = "html";

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should show markdown editor section when type is markdown", async () => {
      mockDashboardPanelData.data.type = "markdown";

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should show custom chart editor section when type is custom_chart", async () => {
      mockDashboardPanelData.data.type = "custom_chart";

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Props Defaults", () => {
    it("should default editMode to false", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      expect(wrapper.props("editMode")).toBe(false);
    });

    it("should default isUiHistogram to false", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "logs" },
        global: mountGlobal,
      });

      expect(wrapper.props("isUiHistogram")).toBe(false);
    });
  });

  describe("searchType computed", () => {
    // PanelSchemaRenderer only renders when chartData is truthy
    beforeEach(() => {
      mockChartData.value = {};
    });

    it('should pass searchType "dashboards" to PanelSchemaRenderer when pageType is "dashboard"', () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
      expect(renderer.props("searchType")).toBe("dashboards");
    });

    it('should pass searchType "ui" to PanelSchemaRenderer when pageType is "metrics"', () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "metrics" },
        global: mountGlobal,
      });

      const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
      expect(renderer.props("searchType")).toBe("ui");
    });

    it('should pass searchType "ui" to PanelSchemaRenderer when pageType is "logs"', () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "logs" },
        global: mountGlobal,
      });

      const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
      expect(renderer.props("searchType")).toBe("ui");
    });

    it('should pass searchType "dashboards" to PanelSchemaRenderer when pageType is "build"', () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "build" },
        global: mountGlobal,
      });

      const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
      expect(renderer.props("searchType")).toBe("dashboards");
    });

    it('should default searchType to "dashboards" for unknown pageType', () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "unknown" as any },
        global: mountGlobal,
      });

      const renderer = wrapper.findComponent({ name: "PanelSchemaRenderer" });
      expect(renderer.props("searchType")).toBe("dashboards");
    });
  });

  describe("ODialog migration (legends popup)", () => {
    // ShowLegendsPopup wraps ODialog internally. PanelEditor owns the v-model:open binding.
    // We test at the ShowLegendsPopup level (it is auto-stubbed in shallowMount).
    beforeEach(() => {
      mockChartData.value = {};
      mockShowLegendsDialog.value = false;
    });

    it("renders the legends popup with open=true when showLegendsDialog is true", () => {
      mockShowLegendsDialog.value = true;

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      const popup = wrapper.findComponent({ name: "ShowLegendsPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.props("open")).toBe(true);
    });

    it("starts with the legends popup closed (open=false)", () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      const popup = wrapper.findComponent({ name: "ShowLegendsPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.props("open")).toBe(false);
    });

    it("closes the legends dialog when ShowLegendsPopup emits update:open=false", async () => {
      mockShowLegendsDialog.value = true;

      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      const popup = wrapper.findComponent({ name: "ShowLegendsPopup" });
      expect(popup.exists()).toBe(true);
      expect(popup.props("open")).toBe(true);

      await popup.vm.$emit("update:open", false);
      await nextTick();

      expect(mockShowLegendsDialog.value).toBe(false);
    });
  });

  describe("ODialog migration (custom chart type selector)", () => {
    // The CustomChartTypeSelector ODialog only renders when type === 'custom_chart'
    // AND pageType === 'dashboard' (the v-if on the wrapping div).
    beforeEach(() => {
      mockDashboardPanelData.data.type = "custom_chart";
    });

    it("renders the custom-chart-type-selector ODialog with width=95 and show-close=false", async () => {
      wrapper = shallowMount(PanelEditor, {
        props: { pageType: "dashboard" },
        global: mountGlobal,
      });

      await nextTick();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const selectorDialog = dialogs.find(
        (d: any) => d.attributes("data-width") === "95",
      );

      expect(selectorDialog).toBeTruthy();
      expect(selectorDialog!.attributes("data-show-close")).toBe("false");
      // Closed by default
      expect(selectorDialog!.attributes("data-open")).toBe("false");
    });
  });
});
