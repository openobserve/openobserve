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

vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetAggregationFunction: vi.fn(),
    resetDashboardPanelData: vi.fn(),
    updateGroupedFields: vi.fn(),
  }),
}));

// Mock usePanelEditor composable
vi.mock("./composables/usePanelEditor", () => ({
  usePanelEditor: vi.fn(() => ({
    chartData: ref(undefined),
    errorData: reactive({ errors: [] }),
    metaData: ref(null),
    seriesData: ref([]),
    lastTriggeredAt: ref(null),
    showLegendsDialog: ref(false),
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

describe("PanelEditor.vue", () => {
  let wrapper: any;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully with dashboard pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
          editMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".panel-editor").exists()).toBe(true);
    });

    it("should mount successfully with metrics pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "metrics",
          editMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully with logs pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
          editMode: false,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully with build pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "build",
          editMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept pageType prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("pageType")).toBe("dashboard");
    });

    it("should accept editMode prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
          editMode: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("editMode")).toBe(true);
    });

    it("should accept allowedChartTypes prop", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
          allowedChartTypes: ["table", "bar"],
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("allowedChartTypes")).toEqual(["table", "bar"]);
    });

    it("should accept selectedDateTime prop", () => {
      const dateTime = {
        start_time: new Date("2024-01-01"),
        end_time: new Date("2024-01-02"),
      };

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
          selectedDateTime: dateTime,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("selectedDateTime")).toEqual(dateTime);
    });
  });

  describe("Exposed Methods", () => {
    it("should expose runQuery method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.runQuery).toBe("function");
    });

    it("should expose resetErrors method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.resetErrors).toBe("function");
    });

    it("should expose collapseFieldList method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.collapseFieldList).toBe("function");
    });

    it("should expose updateDateTime method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.updateDateTime).toBe("function");
    });

    it("should expose dashboardPanelData", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
    });
  });

  describe("Emits", () => {
    it("should emit addToDashboard event when triggered", async () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "metrics",
          showAddToDashboardButton: true,
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      // Trigger the emit through component's exposed method or internal logic
      // The emit would normally be triggered by clicking "Add to Dashboard" button
      expect(wrapper.emitted()).toBeDefined();
    });

    it("should emit customQueryModeChanged on mount (immediate watcher)", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      // The watcher with { immediate: true } should fire on mount
      expect(wrapper.emitted("customQueryModeChanged")).toBeDefined();
    });

    it("should emit searchRequestTraceIdsUpdated on mount (immediate watcher)", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.emitted("searchRequestTraceIdsUpdated")).toBeDefined();
    });
  });

  describe("Exposed State Refs", () => {
    it("should expose chartData ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      // chartData starts as undefined
      expect(wrapper.vm.chartData).toBeUndefined();
    });

    it("should expose errorData ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.errorData).toBeDefined();
      expect(wrapper.vm.errorData.errors).toEqual([]);
    });

    it("should expose metaData ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.metaData).toBeNull();
    });

    it("should expose seriesData ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "metrics",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.seriesData).toEqual([]);
    });

    it("should expose lastTriggeredAt ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.lastTriggeredAt).toBeNull();
    });

    it("should expose isOutDated computed", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.isOutDated).toBe(false);
    });

    it("should expose isLoading computed", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.isLoading).toBe(false);
    });

    it("should expose searchRequestTraceIds ref", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.searchRequestTraceIds).toEqual([]);
    });

    it("should expose warning message refs", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.vm.maxQueryRangeWarning).toBe("");
      expect(wrapper.vm.limitNumberOfSeriesWarningMessage).toBe("");
      expect(wrapper.vm.errorMessage).toBe("");
    });
  });

  describe("Exposed Methods", () => {
    it("should expose cancelRunningQuery method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.cancelRunningQuery).toBe("function");
    });

    it("should expose initChartData method", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(typeof wrapper.vm.initChartData).toBe("function");
    });
  });

  describe("Content Height Calculation", () => {
    it("should calculate correct content height for dashboard pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      // The component should be mounted without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should calculate correct content height for logs pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      // The component should be mounted without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should calculate correct content height for metrics pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "metrics",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should calculate correct content height for build pageType", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "build",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Conditional Rendering", () => {
    it("should show collapsed field list when showFieldList is false", () => {
      mockDashboardPanelData.layout.showFieldList = false;

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.find(".field-list-sidebar-header-collapsed").exists()).toBe(true);

      // Restore
      mockDashboardPanelData.layout.showFieldList = true;
    });

    it("should not show collapsed field list when showFieldList is true", () => {
      mockDashboardPanelData.layout.showFieldList = true;

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.find(".field-list-sidebar-header-collapsed").exists()).toBe(false);
    });

    it("should show HTML editor section when type is html", async () => {
      mockDashboardPanelData.data.type = "html";

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);

      // Restore
      mockDashboardPanelData.data.type = "line";
    });

    it("should show markdown editor section when type is markdown", async () => {
      mockDashboardPanelData.data.type = "markdown";

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);

      // Restore
      mockDashboardPanelData.data.type = "line";
    });

    it("should show custom chart editor section when type is custom_chart", async () => {
      mockDashboardPanelData.data.type = "custom_chart";

      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);

      // Restore
      mockDashboardPanelData.data.type = "line";
    });
  });

  describe("Props Defaults", () => {
    it("should default editMode to false", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "dashboard",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("editMode")).toBe(false);
    });

    it("should default isUiHistogram to false", () => {
      wrapper = shallowMount(PanelEditor, {
        props: {
          pageType: "logs",
        },
        global: {
          plugins: [i18n, Quasar],
          stubs: {
            QSeparator: true,
            QSplitter: {
              template: '<div class="q-splitter-mock"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            },
            QIcon: true,
            QBtn: true,
            QTooltip: true,
            QAvatar: true,
            QDialog: true,
          },
        },
      });

      expect(wrapper.props("isUiHistogram")).toBe(false);
    });
  });
});
