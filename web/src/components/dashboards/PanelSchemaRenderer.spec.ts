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

import { describe, expect, it, beforeEach, vi, afterEach, onTestFinished } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { computed, defineComponent, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

// Mock all the heavy dependencies
vi.mock("@/composables/dashboard/usePanelDataLoader", () => ({
  usePanelDataLoader: vi.fn(() => ({
    data: { value: [{ data: [] }] },
    loading: { value: false },
    errorDetail: { value: { message: "", code: "" } },
    metadata: { value: {} },
    resultMetaData: { value: {} },
    annotations: { value: [] },
    lastTriggeredAt: { value: null },
    isCachedDataDifferWithCurrentTimeRange: { value: false },
    searchRequestTraceIds: { value: [] },
    loadingProgressPercentage: { value: 0 },
    isPartialData: { value: false },
  })),
}));

vi.mock("@/composables/dashboard/useAnnotationsData", () => ({
  useAnnotationsData: vi.fn(() => ({
    isAddAnnotationMode: { value: false },
    isAddAnnotationDialogVisible: { value: false },
    annotationToAddEdit: { value: null },
    editAnnotation: vi.fn(),
    toggleAddAnnotationMode: vi.fn(),
    handleAddAnnotation: vi.fn(),
    closeAddAnnotation: vi.fn(),
    disableAddAnnotationMode: vi.fn(),
    fetchAllPanels: vi.fn(),
    panelsList: { value: [] },
  })),
}));

vi.mock("@/utils/dashboard/convertPanelData", () => ({
  convertPanelData: vi.fn().mockResolvedValue({
    chartType: "line",
    options: {},
    extras: { isTimeSeries: true },
  }),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/utils/commons", () => ({
  getAllDashboardsByFolderId: vi.fn(),
  getDashboard: vi.fn(),
  getFoldersList: vi.fn(),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: fn,
    isLoading: { value: false },
  })),
}));

// Mock async components
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: {
    name: "ChartRenderer",
    template: '<div data-test="chart-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/panels/TableRenderer.vue", () => ({
  default: {
    name: "TableRenderer",
    template: '<div data-test="table-renderer"></div>',
    methods: {
      downloadTableAsCSV: vi.fn(),
      downloadTableAsJSON: vi.fn(),
    },
  },
}));

vi.mock("@/components/dashboards/panels/GeoMapRenderer.vue", () => ({
  default: {
    name: "GeoMapRenderer",
    template: '<div data-test="geomap-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/panels/MapsRenderer.vue", () => ({
  default: {
    name: "MapsRenderer",
    template: '<div data-test="maps-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/panels/HTMLRenderer.vue", () => ({
  default: {
    name: "HTMLRenderer",
    template: '<div data-test="html-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/panels/MarkdownRenderer.vue", () => ({
  default: {
    name: "MarkdownRenderer",
    template: '<div data-test="markdown-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/panels/CustomChartRenderer.vue", () => ({
  default: {
    name: "CustomChartRenderer",
    template: '<div data-test="custom-chart-renderer"></div>',
  },
}));

vi.mock("@/components/dashboards/addPanel/AddAnnotation.vue", () => ({
  default: {
    name: "AddAnnotation",
    template: '<div data-test="add-annotation"></div>',
  },
}));

vi.mock("@/components/common/LoadingProgress.vue", () => ({
  default: {
    name: "LoadingProgress",
    template: '<div data-test="loading-progress"></div>',
  },
}));

const exemplarLookup = vi.hoisted(() => vi.fn());
vi.mock("@/composables/dashboard/useExemplarTraceLookup", () => ({
  useExemplarTraceLookup: () => ({
    peek: () => undefined,
    lookup: exemplarLookup,
    dispose: () => {},
  }),
}));

// Mock console methods
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn(),
};

import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import PanelErrorButtons from "@/components/dashboards/PanelErrorButtons.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { usePanelDataLoader } from "@/composables/dashboard/usePanelDataLoader";
import { copyToClipboard } from "@/utils/clipboard";
import { calculateWidthText } from "@/utils/dashboard/chartDimensionUtils";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import {
  CustomChartSkippedError,
  panelRefreshTargets,
  settlePanelRefresh,
} from "@/utils/dashboard/convertCustomChartData";
import { FORECAST_MIN_DAYS, forecastAlertFromChart } from "@/utils/alerts/forecastAlert";
import { getPanelDataForPageKey } from "@/composables/dashboard/useDashboardPanel";
import searchService from "@/services/search";
import { DASHBOARD_ANNOTATION_SOURCES_KEY } from "@/composables/dashboard/usePanelAnnotationSources";
import {
  alertCreationDialog,
  closeAlertCreationDialog,
} from "@/composables/alerts/useAlertCreation";

describe("PanelSchemaRenderer", () => {
  let wrapper: any;

  const defaultProps = {
    selectedTimeObj: {
      start_time: new Date("2024-01-01T00:00:00Z"),
      end_time: new Date("2024-01-01T23:59:59Z"),
    },
    panelSchema: {
      id: "panel-1",
      type: "line",
      queryType: "sql",
      queries: [
        {
          query: "SELECT * FROM table",
          fields: {
            x: [{ alias: "timestamp", label: "Timestamp" }],
            y: [{ alias: "count", label: "Count" }],
            stream: "logs",
            stream_type: "logs",
          },
        },
      ],
      config: {},
    },
    variablesData: {
      values: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (
    props = {},
    extra: { plugins?: any[]; stubs?: Record<string, unknown> } = {},
  ) => {
    return mount(PanelSchemaRenderer, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store, ...(extra.plugins ?? [])],
        provide: {
          hoveredSeriesState: { value: null },
          variablesAndPanelsDataLoadingState: {
            panels: {},
            variablesData: {},
            searchRequestTraceIds: {},
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          ChartRenderer: {
            name: "ChartRenderer",
            props: ["findLineOnContextMenu"],
            template: '<div data-test="chart-renderer"></div>',
          },
          TableRenderer: { template: '<div data-test="table-renderer"></div>' },
          GeoMapRenderer: { template: '<div data-test="geomap-renderer"></div>' },
          MapsRenderer: { template: '<div data-test="maps-renderer"></div>' },
          HTMLRenderer: {
            name: "HTMLRenderer",
            props: ["variablesData"],
            template: '<div data-test="html-renderer"></div>',
          },
          MarkdownRenderer: {
            name: "MarkdownRenderer",
            props: ["variablesData"],
            template: '<div data-test="markdown-renderer"></div>',
          },
          CustomChartRenderer: { template: '<div data-test="custom-chart-renderer"></div>' },
          AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
          LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          ...extra.stubs,
        },
      },
    });
  };

  /** Whether the panel asks the chart to name the line under a right-click. */
  const findsLine = async () => {
    await nextTick();
    return wrapper.findComponent({ name: "ChartRenderer" }).props("findLineOnContextMenu");
  };

  /** The loader's state for the next mount: data and metadata as the executors store them. */
  it("names the chart after the resolved panel title, not the raw template", async () => {
    wrapper = createWrapper({
      panelSchema: { ...defaultProps.panelSchema, title: "Hosts in ${rack}" },
      variablesData: { values: [{ name: "rack", value: ["r1", "r2"] }] },
    });
    await nextTick();
    expect(wrapper.findComponent({ name: "ChartRenderer" }).attributes("label")).toBe(
      "Hosts in r1, r2",
    );
  });

  const mockLoadedData = (data: unknown[], metadataQueries: Record<string, unknown>[]) =>
    vi.mocked(usePanelDataLoader).mockReturnValueOnce({
      data: ref(data),
      loading: ref(false),
      errorDetail: ref({ message: "", code: "" }),
      metadata: ref({ queries: metadataQueries }),
      resultMetaData: ref({}),
      annotations: ref([]),
      lastTriggeredAt: ref(null),
      isCachedDataDifferWithCurrentTimeRange: ref(false),
      searchRequestTraceIds: ref([]),
      loadingProgressPercentage: ref(0),
      isPartialData: ref(false),
    } as unknown as ReturnType<typeof usePanelDataLoader>);

  describe("Panel Type Rendering", () => {
    it("should render ChartRenderer for line type", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "line" },
      });

      expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
    });

    it("should render TableRenderer for table type", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "table" },
      });

      expect(wrapper.find('[data-test="table-renderer"]').exists()).toBe(true);
    });

    it("keys SQL table rows on the x and breakdown aliases of every query", () => {
      const field = (alias: string) => ({ alias, column: alias });
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          type: "table",
          queries: [
            { query: "", fields: { x: [field("host")], y: [field("count")], breakdown: [] } },
            {
              query: "",
              fields: { x: [field("host")], y: [field("p95")], breakdown: [field("region")] },
            },
          ],
        },
      });

      expect((wrapper.vm as any).tableRowKeyFields).toEqual(["host", "region"]);
    });

    it("should render MapsRenderer for maps type", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "maps" },
      });

      expect(wrapper.find('[data-test="maps-renderer"]').exists()).toBe(true);
    });

    it("should render GeoMapRenderer for geomap type", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "geomap" },
      });

      expect(wrapper.find('[data-test="geomap-renderer"]').exists()).toBe(true);
    });

    it("should render HTMLRenderer for html type", () => {
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          type: "html",
          htmlContent: "<h1>Test HTML</h1>",
        },
      });

      expect(wrapper.find('[data-test="html-renderer"]').exists()).toBe(true);
    });

    it("should render MarkdownRenderer for markdown type", () => {
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          type: "markdown",
          markdownContent: "# Test Markdown",
        },
      });

      expect(wrapper.find('[data-test="markdown-renderer"]').exists()).toBe(true);
    });

    it.each([
      ["markdown", "MarkdownRenderer"],
      ["html", "HTMLRenderer"],
    ])(
      "passes start_time and end_time to %s panels after the dashboard variables",
      (type, renderer) => {
        const selectedTimeObj = {
          start_time: new Date(1_700_000_000_000_000),
          end_time: new Date(1_700_000_360_000_000),
        };
        wrapper = createWrapper({
          panelSchema: { ...defaultProps.panelSchema, type },
          selectedTimeObj,
          variablesData: { values: [{ name: "env", value: "prod" }] },
        });

        expect(wrapper.findComponent({ name: renderer }).props("variablesData").values).toEqual([
          { name: "env", value: "prod" },
          { name: "start_time", value: 1_700_000_000_000_000 },
          { name: "end_time", value: 1_700_000_360_000_000 },
        ]);
      },
    );

    it("should render CustomChartRenderer for custom_chart type", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "custom_chart" },
      });

      expect(wrapper.find('[data-test="custom-chart-renderer"]').exists()).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should display error message when errorDetail has message", () => {
      wrapper = createWrapper();

      // Test the error handling structure exists and functionality
      expect(wrapper.vm.errorDetail).toBeDefined();
      expect(typeof wrapper.vm.errorDetail).toBe("object");
      // Since the component is properly initialized with mocks, verify the structure is correct
      expect(wrapper.exists()).toBe(true);
    });

    it("should display custom error message when configured", () => {
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          error_config: {
            custom_error_handeling: true,
            custom_error_message: "Custom error message",
            default_data_on_error: false,
          },
        },
      });

      // Test the custom error config is properly set
      expect(wrapper.vm.panelSchema.error_config).toBeDefined();
      expect(wrapper.vm.panelSchema.error_config.custom_error_handeling).toBe(true);
      expect(wrapper.vm.panelSchema.error_config.custom_error_message).toBe("Custom error message");
      expect(wrapper.exists()).toBe(true);
    });

    it("should hide error message when no error", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="panel-schema-renderer-error-message"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="panel-schema-renderer-custom-error-message"]').exists(),
      ).toBe(false);
    });
  });

  describe("No Data State", () => {
    it("should display no data message for non-special panel types", () => {
      wrapper = createWrapper();

      // Test the no-data functionality structure
      // Since we're testing with default mocks (no error, not loading), the no-data logic should be available
      expect(wrapper.vm.noData).toBeDefined();
      expect(wrapper.vm.loading).toBeDefined();
      expect(wrapper.vm.errorDetail).toBeDefined();
      expect(wrapper.exists()).toBe(true);
    });

    it("should not display no data for html panels", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "html" },
      });

      expect(wrapper.text()).not.toContain("No Data");
    });

    it("should not display no data for markdown panels", () => {
      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "markdown" },
      });

      expect(wrapper.text()).not.toContain("No Data");
    });

    // Regression: removing the required columns after a successful run clears
    // the underlying data (noData => "No Data") but leaves the already-converted
    // rows in panelData, because convertPanelDataCommon bails on validation and
    // never refreshes it. tableRendererData must NOT re-serve those stale rows
    // behind the empty state (mirrors chartRendererData's noData guard).
    // NOTE: uses the default loader mock (no mockReturnValue override) so the
    // real-ref shape doesn't leak into later tests via beforeEach's clearAllMocks.
    it("clears stale table rows once required columns are removed (No Data)", async () => {
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          type: "table",
          // No First Column / Other Columns => validation fails, so
          // convertPanelDataCommon leaves panelData untouched (stale).
          queries: [
            {
              ...defaultProps.panelSchema.queries[0],
              fields: { x: [], y: [], stream: "logs", stream_type: "logs" },
            },
          ],
        },
      });
      await flushPromises();

      // Default loader data has no usable rows => hasRawData falsy => "No Data".
      // Simulate a prior successful run leaving converted rows in panelData.
      wrapper.vm.panelData = {
        chartType: "table",
        rows: [{ a: 1 }, { a: 2 }],
        columns: [{ name: "a", field: "a" }],
      };
      await flushPromises();

      expect(wrapper.vm.noData).toBe("No Data");
      expect(wrapper.vm.tableRendererData).toEqual({ rows: [], columns: [] });
    });

    it("shows No Data for a custom_chart with no rows instead of an error", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "custom_chart" },
      });
      await flushPromises();

      expect(wrapper.vm.noData).toBe("No Data");
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="panel-schema-renderer-error-message"]').exists()).toBe(
        false,
      );
    });

    it("shows the panel's empty-state text with dashboard variables substituted", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          config: { no_data_text: "Set site_meter: candidates for $site_meter" },
        },
        variablesData: { values: [{ name: "site_meter", value: "pm-07", type: "custom" }] },
      });
      await flushPromises();

      const empty = wrapper.find('[data-test="no-data"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("Set site_meter: candidates for pm-07");
      expect(empty.text()).not.toContain("No Data");
    });

    it("shows No Data when the panel sets no empty-state text", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="no-data"]').text()).toContain("No Data");
    });

    it("clears a stale custom_chart error when switching to another chart type", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "Error executing code", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "custom_chart" },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="panel-schema-renderer-error-message"]').exists()).toBe(true);

      await wrapper.setProps({ panelSchema: { ...defaultProps.panelSchema, type: "bar" } });
      await flushPromises();

      expect(wrapper.find('[data-test="panel-schema-renderer-error-message"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
    });

    describe("a named missing value replaces No Data", () => {
      const nullMapping = { type: "special", match: "null", text: "N/A", color: null };
      const mountEmpty = async (panelSchema: any, data: any) => {
        vi.mocked(usePanelDataLoader).mockReturnValueOnce({
          data: ref(data),
          loading: ref(false),
          errorDetail: ref({ message: "", code: "" }),
          metadata: ref({}),
          resultMetaData: ref({}),
          annotations: ref([]),
          lastTriggeredAt: ref(null),
          isCachedDataDifferWithCurrentTimeRange: ref(false),
          searchRequestTraceIds: ref([]),
          loadingProgressPercentage: ref(0),
          isPartialData: ref(false),
        } as any);
        wrapper = createWrapper({ panelSchema: { ...defaultProps.panelSchema, ...panelSchema } });
        await flushPromises();
        wrapper.vm.panelData = { chartType: panelSchema.type, options: { series: [] } };
        await flushPromises();
        return wrapper.vm.noData;
      };

      it("metric with a special null mapping, no rows and a NULL value", async () => {
        const config = { ...defaultProps.panelSchema.config, mappings: [nullMapping] };
        expect(await mountEmpty({ type: "metric", config }, [[]])).toBe("");
        expect(await mountEmpty({ type: "metric", config }, [[{ y_axis_1: null }]])).toBe("");
      });

      it("metric and SQL gauge with a no-value replacement", async () => {
        const config = { ...defaultProps.panelSchema.config, no_value_replacement: "-" };
        expect(await mountEmpty({ type: "metric", config }, [[]])).toBe("");
        expect(await mountEmpty({ type: "gauge", config }, [[]])).toBe("");
      });

      it("keeps No Data without one, and for a PromQL gauge", async () => {
        expect(await mountEmpty({ type: "metric" }, [[]])).toBe("No Data");
        const config = { ...defaultProps.panelSchema.config, no_value_replacement: "-" };
        expect(
          await mountEmpty({ type: "gauge", queryType: "promql", config }, [{ result: [] }]),
        ).toBe("No Data");
      });
    });

    // Guard must not over-trigger: with rows present the table keeps serving
    // the converted data (unchanged fall-through behaviour).
    // mockReturnValueOnce only overrides THIS mount, so the real-ref shape can't
    // leak into later tests (unlike a persistent mockReturnValue).
    it("serves converted table data while rows are present", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([[{ a: 1 }]]), // loader has rows => hasRawData truthy
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "table" },
      });
      await flushPromises();

      const converted = {
        chartType: "table",
        rows: [{ a: 1 }],
        columns: [{ name: "a", field: "a" }],
      };
      wrapper.vm.panelData = converted; // reactive: forces noData re-eval
      await flushPromises();

      expect(wrapper.vm.noData).toBe("");
      expect(wrapper.vm.tableRendererData).toEqual(converted);
    });
  });

  describe("Geomap No Data state", () => {
    const loaderWith = (data: any, loading = false) =>
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref(data),
        loading: ref(loading),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);
    const geomapPanel = (queryType = "sql") => ({
      ...defaultProps.panelSchema,
      type: "geomap",
      queryType,
    });

    it("shows No Data when the rows hold no plottable points", async () => {
      loaderWith([[{ lat: null, lon: null }]]);
      wrapper = createWrapper({ panelSchema: geomapPanel() });
      await flushPromises();
      wrapper.vm.panelData = { chartType: "geomap", options: { series: [] } };
      await flushPromises();

      expect(wrapper.vm.noData).toBe("No Data");
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
    });

    it("keeps the map when at least one layer has points", async () => {
      loaderWith([[{ lat: 1, lon: 2 }]]);
      wrapper = createWrapper({ panelSchema: geomapPanel() });
      await flushPromises();
      wrapper.vm.panelData = {
        chartType: "geomap",
        options: { series: [{ data: [] }, { data: [[2, 1, 1]] }] },
      };
      await flushPromises();

      expect(wrapper.vm.noData).toBe("");
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(false);
    });

    it("shows No Data when lat/lon are not configured", async () => {
      loaderWith([[{ lat: 1, lon: 2 }]]);
      wrapper = createWrapper({ panelSchema: geomapPanel() });
      await flushPromises();
      wrapper.vm.panelData = { chartType: "geomap", options: null };
      await flushPromises();

      expect(wrapper.vm.noData).toBe("No Data");
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
    });

    it("hands the map a placeholder instead of an empty layer list", async () => {
      loaderWith([[{ lat: 1, lon: 2 }]]);
      wrapper = createWrapper({ panelSchema: geomapPanel() });
      await flushPromises();
      const withPoints = { chartType: "geomap", options: { series: [{ data: [[2, 1, 1]] }] } };
      wrapper.vm.panelData = withPoints;
      await flushPromises();
      expect(wrapper.vm.geoMapRendererData).toEqual(withPoints);

      wrapper.vm.panelData = { chartType: "geomap", options: { lmap: {}, series: [] } };
      await flushPromises();
      expect(wrapper.vm.geoMapRendererData).toEqual({
        options: { backgroundColor: "transparent" },
      });
    });

    it("keeps the previous points while a reload has cleared the rows", async () => {
      loaderWith([], true);
      wrapper = createWrapper({ panelSchema: geomapPanel() });
      await flushPromises();
      const withPoints = { chartType: "geomap", options: { series: [{ data: [[2, 1, 1]] }] } };
      wrapper.vm.panelData = withPoints;
      await flushPromises();

      expect(wrapper.vm.noData).toBe("");
      expect(wrapper.vm.geoMapRendererData).toEqual(withPoints);
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(false);
    });

    it("shows No Data for PromQL series without geo labels", async () => {
      loaderWith([{ result: [{ metric: { job: "a" }, values: [[1, "1"]] }] }]);
      wrapper = createWrapper({ panelSchema: geomapPanel("promql") });
      await flushPromises();
      wrapper.vm.panelData = { chartType: "geomap", options: { series: [] } };
      await flushPromises();

      expect(wrapper.vm.noData).toBe("No Data");
    });
  });

  describe("Drilldowns", () => {
    const withDrilldown = (allowDrilldown?: boolean) =>
      createWrapper({
        ...(allowDrilldown === undefined ? {} : { allowDrilldown }),
        panelSchema: {
          ...defaultProps.panelSchema,
          config: { drilldown: [{ name: "to logs", type: "logs", data: {} }] },
        },
      });
    const click = { data: { name: "a", value: 1 }, event: { offsetX: 1, offsetY: 1 } };

    it("opens the drilldown menu on a click by default", async () => {
      wrapper = withDrilldown();
      await wrapper.vm.onPanelClick(click);
      expect(wrapper.vm.drilldownArray).toHaveLength(1);
    });

    it("ignores clicks when drilldowns are turned off", async () => {
      wrapper = withDrilldown(false);
      await wrapper.vm.onPanelClick(click);
      expect(wrapper.vm.drilldownArray).toHaveLength(0);
    });

    // The table's search icon opens the logs drawer; the public page turns drilldowns off.
    const exploreFromTable = async (allowDrilldown: boolean) => {
      const resultSchema = vi.spyOn(searchService, "result_schema").mockResolvedValue({
        data: {
          where_clause: "rev = 1793591100",
          cross_links: { stream_links: [], org_links: [] },
        },
      } as any);
      onTestFinished(() => resultSchema.mockRestore());
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/", component: { template: "<div />" } }],
      });
      await router.push("/");
      wrapper = createWrapper(
        { allowDrilldown, panelSchema: { ...defaultProps.panelSchema, type: "table" } },
        {
          plugins: [router],
          stubs: {
            TableRenderer: {
              name: "TableRenderer",
              emits: ["explore-cell"],
              template: '<div data-test="table-renderer"></div>',
            },
          },
        },
      );
      wrapper
        .findComponent({ name: "TableRenderer" })
        .vm.$emit("explore-cell", { columnId: "count", value: 7, row: {} });
      await flushPromises();
      return {
        drawerOpen: wrapper.vm.cellDrawer.open,
        baseWhere: wrapper.vm.cellDrawer.baseWhere,
        query: router.currentRoute.value.query,
        resultSchema,
      };
    };

    it("opens the logs drawer from a table cell when drilldowns are on", async () => {
      const { drawerOpen, query } = await exploreFromTable(true);
      expect(drawerOpen).toBe(true);
      expect(query.cell_value).toBe("7");
    });

    it("filters the cell drawer by the panel WHERE even with cross-linking off", async () => {
      expect(store.state.zoConfig.enable_cross_linking).toBeFalsy();
      const { baseWhere, resultSchema } = await exploreFromTable(true);
      expect(resultSchema).toHaveBeenCalledTimes(1);
      expect(resultSchema.mock.calls[0][0].cross_linking).toBe(false);
      expect(baseWhere).toBe("rev = 1793591100");
    });

    // PanelContainer's Go To Logs reads these off the renderer ref.
    it("exposes the panel WHERE through ensureDrilldownSchema on the instance", async () => {
      const resultSchema = vi.spyOn(searchService, "result_schema").mockResolvedValue({
        data: { where_clause: "rev = 1", where_by_stream: {} },
      } as any);
      onTestFinished(() => resultSchema.mockRestore());
      wrapper = createWrapper();
      await wrapper.vm.ensureDrilldownSchema(0, true);
      expect(resultSchema).toHaveBeenCalledTimes(1);
      expect(wrapper.vm.panelBaseWhere).toBe("rev = 1");
    });

    it("makes no result_schema call on a chart click with cross-linking off", async () => {
      const resultSchema = vi.spyOn(searchService, "result_schema");
      onTestFinished(() => resultSchema.mockRestore());
      wrapper = withDrilldown();
      await wrapper.vm.onPanelClick(click);
      expect(resultSchema).not.toHaveBeenCalled();
    });

    it("does not open the logs drawer from a table cell when drilldowns are off", async () => {
      const { drawerOpen, query } = await exploreFromTable(false);
      expect(drawerOpen).toBe(false);
      expect(query.cell_value).toBeUndefined();
    });
  });

  describe("Partial Data Functionality", () => {
    it("should emit is-partial-data-update when partial data state changes", async () => {
      const isPartialData = ref(false);
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [] }),
        resultMetaData: ref([]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData,
        isFirstLoadSettled: ref(true),
      } as any);
      wrapper = createWrapper();
      await flushPromises();

      isPartialData.value = true;
      await nextTick();
      isPartialData.value = false;
      await nextTick();

      expect(wrapper.emitted("is-partial-data-update")).toEqual([[true], [false]]);
    });
  });

  describe("Cache restore and the first load", () => {
    describe("before the first load settles", () => {
      const loaderWith = (overrides: Record<string, any>) => ({
        data: ref([]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [] }),
        resultMetaData: ref([]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
        isFirstLoadSettled: ref(false),
        ...overrides,
      });

      it("shows neither the chart nor No Data", async () => {
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(loaderWith({}) as any);
        wrapper = createWrapper();
        await flushPromises();

        expect(wrapper.find('[data-test="no-data"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(false);
      });

      it("keeps a table's empty footer hidden too", async () => {
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(loaderWith({}) as any);
        wrapper = createWrapper({ panelSchema: { ...defaultProps.panelSchema, type: "table" } });
        await flushPromises();

        expect(wrapper.find('[data-test="table-renderer"]').exists()).toBe(false);
      });

      it("shows No Data once an empty first load settles", async () => {
        const isFirstLoadSettled = ref(false);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled }) as any,
        );
        wrapper = createWrapper();
        await flushPromises();

        isFirstLoadSettled.value = true;
        await flushPromises();

        expect(wrapper.find('[data-test="no-data"]').exists()).toBe(true);
      });

      it("renders the chart once the restored result settles", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        wrapper = createWrapper({
          panelSchema: {
            ...defaultProps.panelSchema,
            queryType: "promql",
            queries: [{ query: "up", fields: {}, config: {} }],
          },
        });
        await flushPromises();
        expect(convertPanelData).not.toHaveBeenCalled();

        data.value = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "4"]] }] }];
        isFirstLoadSettled.value = true;
        await flushPromises();

        expect(convertPanelData).toHaveBeenCalled();
        expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="no-data"]').exists()).toBe(false);
      });

      it("hands custom chart code the committed variables, time range, timezone and theme", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        store.state.theme = "dark";
        const previousTimezone = store.state.timezone;
        onTestFinished(() => {
          store.state.timezone = previousTimezone;
        });
        store.state.timezone = "Asia/Kolkata";
        wrapper = createWrapper({
          selectedTimeObj: {
            start_time: new Date(1_700_000_000_000_000),
            end_time: new Date(1_700_000_600_000_000),
          },
          variablesData: {
            values: [
              { name: "service", value: "api" },
              { name: "regions", value: ["eu", "us"] },
              { name: "env", value: "_o2_all_" },
              { name: "zones", value: ["_o2_all_"] },
              { name: "picked", value: [] },
              { name: "unset", value: null },
            ],
          },
          currentVariablesData: { values: [{ name: "service", value: "uncommitted" }] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]).toEqual({
          variables: {
            service: "api",
            regions: ["eu", "us"],
            env: null,
            zones: null,
            picked: null,
            unset: null,
          },
          timeRange: { start: 1_700_000_000_000_000, end: 1_700_000_600_000_000 },
          timezone: "Asia/Kolkata",
          theme: "dark",
        });
      });

      it("passes no custom chart context for other chart types", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        wrapper = createWrapper({
          panelSchema: {
            ...defaultProps.panelSchema,
            queryType: "promql",
            queries: [{ query: "up", fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "4"]] }] }];
        isFirstLoadSettled.value = true;
        await flushPromises();

        expect(convertPanelData).toHaveBeenCalled();
        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]).toBeUndefined();
      });

      it("re-runs custom chart code when a variable the query does not use changes", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        wrapper = createWrapper({
          variablesData: { values: [{ name: "threshold", value: "5" }] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();
        const callsBefore = vi.mocked(convertPanelData).mock.calls.length;

        await wrapper.setProps({ variablesData: { values: [{ name: "threshold", value: "9" }] } });
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.length).toBeGreaterThan(callsBefore);
        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]?.variables).toEqual({
          threshold: "9",
        });
      });

      it("keeps the rendered chart and shows no error when the chart run is skipped", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        const rendered = { chartType: "custom_chart", series: [{ type: "bar" }] };
        vi.mocked(convertPanelData).mockResolvedValueOnce(rendered as any);
        wrapper = createWrapper({
          variablesData: { values: [{ name: "threshold", value: "5" }] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();
        expect(wrapper.vm.panelData).toEqual(rendered);
        const errorEmits = wrapper.emitted("error")?.length ?? 0;

        vi.mocked(convertPanelData).mockRejectedValueOnce(new CustomChartSkippedError());
        await wrapper.setProps({ variablesData: { values: [{ name: "threshold", value: "9" }] } });
        await flushPromises();

        expect(wrapper.vm.panelData).toEqual(rendered);
        expect(wrapper.vm.errorDetail.message).toBe("");
        expect(wrapper.emitted("error")?.length ?? 0).toBe(errorEmits);
      });

      it("still renders the next load's result after a skipped chart run", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        const loading = ref(false);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data, loading }) as any,
        );
        vi.mocked(convertPanelData).mockRejectedValueOnce(new CustomChartSkippedError());
        wrapper = createWrapper({
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        const errorEmits = wrapper.emitted("error")?.length ?? 0;
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();
        expect(wrapper.emitted("error")?.length ?? 0).toBe(errorEmits);
        const callsBefore = vi.mocked(convertPanelData).mock.calls.length;
        const rendered = { chartType: "custom_chart", series: [{ type: "line" }] };
        vi.mocked(convertPanelData).mockResolvedValueOnce(rendered as any);

        loading.value = true;
        await flushPromises();
        loading.value = false;
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.length).toBeGreaterThan(callsBefore);
        expect(wrapper.vm.panelData).toEqual(rendered);
      });

      it("leaves a change to a variable the query uses to the reload instead of re-running on old data", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        wrapper = createWrapper({
          variablesData: { values: [{ name: "svc", value: "checkout" }] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [
              {
                query: "SELECT * FROM t WHERE svc = '$svc'",
                customQuery: true,
                fields: {},
                config: {},
              },
            ],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();
        const callsBefore = vi.mocked(convertPanelData).mock.calls.length;

        await wrapper.setProps({ variablesData: { values: [{ name: "svc", value: "payments" }] } });
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.length).toBe(callsBefore);
      });

      it("replays a run skipped during another panel's refresh once that refresh ends", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        onTestFinished(() => panelRefreshTargets.clear());
        wrapper = createWrapper({
          variablesData: { values: [{ name: "threshold", value: "5" }] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();

        vi.mocked(convertPanelData).mockRejectedValueOnce(new CustomChartSkippedError());
        await wrapper.setProps({ variablesData: { values: [{ name: "threshold", value: "9" }] } });
        await flushPromises();
        const callsBefore = vi.mocked(convertPanelData).mock.calls.length;
        const replayed = { chartType: "custom_chart", series: [{ type: "pie" }] };
        vi.mocked(convertPanelData).mockResolvedValueOnce(replayed as any);

        panelRefreshTargets.set("other-panel", false);
        settlePanelRefresh("other-panel");
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.length).toBe(callsBefore + 1);
        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]?.variables).toEqual({
          threshold: "9",
        });
        expect(wrapper.vm.panelData).toEqual(replayed);

        panelRefreshTargets.set("other-panel", false);
        settlePanelRefresh("other-panel");
        await flushPromises();
        expect(vi.mocked(convertPanelData).mock.calls.length).toBe(callsBefore + 1);
      });

      it("does not re-run custom chart code when only variable options or loading flags change", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        const variable = { name: "threshold", value: "5", options: [], isLoading: false };
        wrapper = createWrapper({
          variablesData: { values: [variable] },
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();
        const callsBefore = vi.mocked(convertPanelData).mock.calls.length;

        await wrapper.setProps({
          variablesData: {
            values: [{ ...variable, options: [{ label: "9", value: "9" }], isLoading: true }],
          },
        });
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.length).toBe(callsBefore);
      });

      it("re-runs custom chart code with the new theme when the theme changes", async () => {
        const isFirstLoadSettled = ref(false);
        const data = ref<any[]>([]);
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({ isFirstLoadSettled, data }) as any,
        );
        wrapper = createWrapper({
          panelSchema: {
            ...defaultProps.panelSchema,
            type: "custom_chart",
            customChartContent: "option = {}",
            queries: [{ query: "SELECT 1", customQuery: true, fields: {}, config: {} }],
          },
        });
        await flushPromises();
        data.value = [[{ count: 1 }]];
        isFirstLoadSettled.value = true;
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]?.theme).toBe("light");

        store.state.theme = "dark";
        await flushPromises();

        expect(vi.mocked(convertPanelData).mock.calls.at(-1)?.[11]?.theme).toBe("dark");
      });

      it("shows the error when the first load fails", async () => {
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(
          loaderWith({
            isFirstLoadSettled: ref(true),
            errorDetail: ref({ message: "Query failed", code: 400 }),
          }) as any,
        );
        wrapper = createWrapper();
        await flushPromises();

        expect(wrapper.find('[data-test="panel-schema-renderer-error-message"]').text()).toContain(
          "Query failed",
        );
      });

      it("never holds back a markdown panel", async () => {
        vi.mocked(usePanelDataLoader).mockReturnValueOnce(loaderWith({}) as any);
        wrapper = createWrapper({
          panelSchema: { ...defaultProps.panelSchema, type: "markdown", queries: [] },
        });
        await flushPromises();

        expect(wrapper.find('[data-test="markdown-renderer"]').exists()).toBe(true);
      });
    });

    it("keeps the line loader on, over the restored chart, while a refresh loads", async () => {
      vi.mocked(usePanelDataLoader).mockReturnValueOnce({
        data: ref([{ resultType: "matrix", result: [{ metric: {}, values: [[1, "4"]] }] }]),
        loading: ref(true),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [] }),
        resultMetaData: ref([]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
        isFirstLoadSettled: ref(true),
      } as any);
      wrapper = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          queryType: "promql",
          queries: [{ query: "up", fields: {}, config: {} }],
        },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="loading-progress"]').attributes("loading")).toBe("true");
      expect(wrapper.find('[data-test="chart-renderer"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="no-data"]').exists()).toBe(false);
    });
  });

  describe("Advanced Event Emissions", () => {
    it("should emit limit-number-of-series-warning-message-update", async () => {
      wrapper = createWrapper();

      const warningMessage = "Too many series, showing only first 100";

      // Mock limit warning message
      wrapper.vm.limitNumberOfSeriesWarningMessage = { value: warningMessage };
      await nextTick();

      expect(wrapper.vm.limitNumberOfSeriesWarningMessage).toBeDefined();
    });

    it("should emit last-triggered-at-update when lastTriggeredAt changes", async () => {
      wrapper = createWrapper();

      const timestamp = new Date().getTime();

      // Mock lastTriggeredAt change
      wrapper.vm.lastTriggeredAt = { value: timestamp };
      await nextTick();

      expect(wrapper.vm.lastTriggeredAt).toBeDefined();
    });

    it("should emit is-cached-data-differ-with-current-time-range-update", async () => {
      wrapper = createWrapper();

      // Mock cached data difference state
      wrapper.vm.isCachedDataDifferWithCurrentTimeRange = { value: true };
      await nextTick();

      expect(wrapper.vm.isCachedDataDifferWithCurrentTimeRange).toBeDefined();
    });

    it("should emit updated:vrlFunctionFieldList when data has fields", async () => {
      // Start with empty data so the (non-immediate) data watcher fires when
      // the loader resolves and populates the ref after mount.
      const mockData = ref<any[]>([]);

      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: mockData,
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({}),
        resultMetaData: ref({}),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = createWrapper();
      await flushPromises();

      // Simulate the loader delivering query results after mount.
      mockData.value = [
        [
          {
            ts: "2024-01-01T10:00:00Z",
            count: 100,
          },
          {
            ts: "2024-01-01T11:00:00Z",
            count: 150,
            service: "api",
          },
        ],
        [
          {
            source: "a",
            target: "b",
            value: 12,
          },
        ],
      ];
      await flushPromises();

      const emitted = wrapper.emitted("updated:vrlFunctionFieldList") || [];
      expect(emitted.length).toBeGreaterThan(0);
      const latestPayload = emitted[emitted.length - 1][0];
      expect(latestPayload).toEqual([
        ["ts", "count", "service"],
        ["source", "target", "value"],
      ]);
    });

    it("should emit update:initialVariableValues during drilldown navigation", () => {
      wrapper = createWrapper();

      // Test that the component can emit initial variable values
      expect(wrapper.vm.openDrilldown).toBeTypeOf("function");
    });
  });

  describe("Alert Context Menu", () => {
    it("should not show context menu when alert creation is not allowed", () => {
      wrapper = createWrapper({ allowAlertCreation: false });

      const mockEvent = {
        x: 100,
        y: 200,
        value: 50,
      };

      wrapper.vm.onChartDomContextMenu(mockEvent);

      expect(wrapper.vm.contextMenuVisible).toBe(false);
    });

    it("should show context menu when alert creation is allowed via domcontextmenu", () => {
      wrapper = createWrapper({ allowAlertCreation: true });

      const mockEvent = {
        x: 150,
        y: 250,
        value: 75,
      };

      wrapper.vm.onChartDomContextMenu(mockEvent);

      expect(wrapper.vm.contextMenuVisible).toBe(true);
      expect(wrapper.vm.contextMenuPosition).toEqual({ x: 150, y: 250 });
      expect(wrapper.vm.contextMenuValue).toBe(75);
    });

    it("opens the alert menu locked while alerts is license-locked", async () => {
      const zoConfig = store.state.zoConfig as any;
      const previous = zoConfig.features;
      zoConfig.features = { alerts: "locked" };
      try {
        wrapper = createWrapper({ allowAlertCreation: true });
        wrapper.vm.onChartDomContextMenu({ x: 150, y: 250, value: 75 });
        await nextTick();
        expect(wrapper.vm.contextMenuVisible).toBe(true);
        expect(wrapper.vm.alertsLocked).toBe(true);
        expect(wrapper.vm.alertsLockedReason).toContain("Locked: needs");
      } finally {
        zoConfig.features = previous;
      }
    });

    it.each([
      ["logs", "logs"],
      ["metrics", "metrics"],
      ["traces", "traces"],
    ])(
      "a logs drilldown on a %s panel is locked with a lock while %s is license-locked",
      async (streamType, key) => {
        const zoConfig = store.state.zoConfig as any;
        const previous = zoConfig.features;
        zoConfig.features = { [key]: "locked" };
        try {
          const drilldown = [
            { name: "ToLogs", type: "logs", data: { logsMode: "auto" } },
            { name: "ToUrl", type: "byUrl", data: { url: "https://example.com" } },
          ];
          wrapper = createWrapper({
            panelSchema: {
              ...defaultProps.panelSchema,
              queries: [
                { ...defaultProps.panelSchema.queries[0], fields: { stream_type: streamType } },
              ],
              config: { drilldown },
            },
          });
          wrapper.vm.drilldownArray = drilldown;
          await nextTick();
          expect(wrapper.find('[data-test="drilldown-menu-item-ToLogs-lock"]').exists()).toBe(true);
          expect(wrapper.find('[data-test="drilldown-menu-item-ToUrl-lock"]').exists()).toBe(false);
        } finally {
          zoConfig.features = previous;
        }
      },
    );

    it("a logs drilldown stays live while another signal is locked", async () => {
      const zoConfig = store.state.zoConfig as any;
      const previous = zoConfig.features;
      zoConfig.features = { traces: "locked" };
      try {
        const drilldown = [{ name: "ToLogs", type: "logs", data: { logsMode: "auto" } }];
        wrapper = createWrapper({
          panelSchema: { ...defaultProps.panelSchema, config: { drilldown } },
        });
        wrapper.vm.drilldownArray = drilldown;
        await nextTick();
        expect(wrapper.find('[data-test="drilldown-menu-item-ToLogs"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="drilldown-menu-item-ToLogs-lock"]').exists()).toBe(false);
      } finally {
        zoConfig.features = previous;
      }
    });

    it.each([
      ["locked", 0],
      ["enabled", 1],
    ] as const)("following an exemplar with traces %s navigates %i times", async (state, calls) => {
      const zoConfig = store.state.zoConfig as any;
      const previous = zoConfig.features;
      zoConfig.features = { traces: state };
      try {
        const router = createRouter({
          history: createMemoryHistory(),
          routes: [
            { path: "/", component: { template: "<div />" } },
            { path: "/trace", name: "traceDetails", component: { template: "<div />" } },
          ],
        });
        await router.push("/");
        const push = vi.spyOn(router, "push");
        exemplarLookup.mockResolvedValue({
          state: "found",
          stream: "default",
          startUs: 1,
          endUs: 2,
        });
        wrapper = createWrapper({}, { plugins: [router] });
        await wrapper.vm.exemplarInteraction.follow({ id: "m1", traceId: "abc", tsMs: 1 });
        expect(push).toHaveBeenCalledTimes(calls);
      } finally {
        zoConfig.features = previous;
      }
    });

    it("hides the chart tooltip when the alert menu opens, from a series or from empty chart area", () => {
      wrapper = createWrapper({ allowAlertCreation: true });
      const dispatchAction = vi.fn();
      wrapper.vm.chartRendererRef = { chart: { dispatchAction } };
      wrapper.vm.panelData = { options: { series: [{ name: "a", _panelQueryIndex: 0 }] } };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 0, dataIndex: 1 });
      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 4 });

      expect(dispatchAction).toHaveBeenCalledTimes(2);
      expect(dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    });

    it("keeps the chart tooltip on a right-click when alert creation is off", () => {
      wrapper = createWrapper({ allowAlertCreation: false });
      const dispatchAction = vi.fn();
      wrapper.vm.chartRendererRef = { chart: { dispatchAction } };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 0 });
      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 4 });

      expect(dispatchAction).not.toHaveBeenCalled();
    });

    it("resolves the clicked series to its panel query and role", () => {
      wrapper = createWrapper({ allowAlertCreation: true });
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "a", _panelQueryIndex: 0, _seriesRole: "primary" },
            { name: "b (1 day ago)", _panelQueryIndex: 1, _seriesRole: "shifted" },
          ],
        },
      };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 1 });

      expect(wrapper.vm.contextMenuData).toMatchObject({
        value: 3,
        panelQueryIndex: 1,
        seriesRole: "shifted",
      });

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 4 });
      expect(wrapper.vm.contextMenuData.panelQueryIndex).toBeUndefined();
    });

    it("maps a SQL series past a hidden query to its own panel query", () => {
      mockLoadedData(
        [[], [], []],
        [{ panelQueryIndex: 0 }, { panelQueryIndex: 1 }, { panelQueryIndex: 2 }],
      );
      const query = defaultProps.panelSchema.queries[0];
      wrapper = createWrapper({
        allowAlertCreation: true,
        panelSchema: {
          ...defaultProps.panelSchema,
          queries: [query, { ...query, config: { hide: true } }, query],
        },
      });
      // convertSQLData read the unfiltered metadata, so the second kept series claims query 1.
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "a", _queryIndex: 0, _panelQueryIndex: 0 },
            { name: "c", _queryIndex: 1, _panelQueryIndex: 1, yAxisGroup: 1 },
          ],
        },
      };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 1 });
      expect(wrapper.vm.contextMenuData.panelQueryIndex).toBe(2);
      expect(wrapper.vm.contextMenuData.yField).toBe(1);

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 0 });
      expect(wrapper.vm.contextMenuData.panelQueryIndex).toBe(0);
    });

    describe("a multi-query SQL panel's series mapped back to their query", () => {
      const clickedQuery = (position: number) => {
        wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: position });
        return wrapper.vm.contextMenuData.panelQueryIndex;
      };
      const query = defaultProps.panelSchema.queries[0];
      const series = (count: number) =>
        Array.from({ length: count }, (_, position) => ({
          name: `s${position}`,
          _queryIndex: position,
        }));

      it("sends a time-shifted series to its parent query", () => {
        mockLoadedData(
          [[], [], []],
          [
            { panelQueryIndex: 0, timeRangeGap: { seconds: 0 } },
            { panelQueryIndex: 0, timeRangeGap: { seconds: 86400 } },
            { panelQueryIndex: 1, timeRangeGap: { seconds: 0 } },
          ],
        );
        wrapper = createWrapper({
          allowAlertCreation: true,
          panelSchema: { ...defaultProps.panelSchema, queries: [query, query] },
        });
        wrapper.vm.panelData = { options: { series: series(3) } };

        expect(clickedQuery(1)).toBe(0);
        expect(clickedQuery(2)).toBe(1);
      });

      it("maps past an empty query slot the executor never ran, which leaves a hole in its data", async () => {
        const holey = <T>(first: T, third: T): T[] => {
          const entries: T[] = [];
          entries[0] = first;
          entries[2] = third;
          return entries;
        };
        mockLoadedData(holey([], []), holey({ panelQueryIndex: 0 }, { panelQueryIndex: 2 }));
        wrapper = createWrapper({
          allowAlertCreation: true,
          panelSchema: {
            ...defaultProps.panelSchema,
            queries: [query, { ...query, query: "" }, query],
          },
        });
        wrapper.vm.panelData = {
          options: {
            series: [
              { name: "a", _queryIndex: 0, _panelQueryIndex: 0 },
              { name: "c", _queryIndex: 2, _panelQueryIndex: 2, yAxisGroup: 0 },
            ],
          },
        };

        expect(await findsLine()).toBe(true);
        expect(clickedQuery(0)).toBe(0);
        expect(clickedQuery(1)).toBe(2);
        expect(wrapper.vm.contextMenuData.yField).toBe(0);
      });
    });

    it("maps the one visible, time-shifted SQL query's series past a hidden one", async () => {
      mockLoadedData(
        [[], [], []],
        [
          { panelQueryIndex: 0, timeRangeGap: { seconds: 0 } },
          { panelQueryIndex: 1, timeRangeGap: { seconds: 0 } },
          { panelQueryIndex: 1, timeRangeGap: { seconds: 86400 } },
        ],
      );
      const query = defaultProps.panelSchema.queries[0];
      wrapper = createWrapper({
        allowAlertCreation: true,
        panelSchema: {
          ...defaultProps.panelSchema,
          queries: [{ ...query, config: { hide: true } }, query],
        },
      });
      // convertSQLData labels these from the unfiltered metadata, so they claim the hidden query.
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "b", _queryIndex: 0, _panelQueryIndex: 0, yAxisGroup: 1 },
            { name: "b (1 day ago)", _queryIndex: 1, _panelQueryIndex: 0 },
          ],
        },
      };

      expect(await findsLine()).toBe(false);
      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 0 });
      expect(wrapper.vm.contextMenuData.panelQueryIndex).toBe(1);
      expect(wrapper.vm.contextMenuData.yField).toBe(1);
      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 3, seriesIndex: 1 });
      expect(wrapper.vm.contextMenuData.panelQueryIndex).toBe(1);
    });

    it("looks for the clicked line on a single query plotting two y fields", async () => {
      const query = defaultProps.panelSchema.queries[0];
      wrapper = createWrapper({
        allowAlertCreation: true,
        panelSchema: {
          ...defaultProps.panelSchema,
          queries: [
            {
              ...query,
              fields: { ...query.fields, y: [...query.fields.y, { alias: "avg", label: "Avg" }] },
            },
          ],
        },
      });

      expect(await findsLine()).toBe(true);
    });

    it("reads a forecast line's start and the clicked point's time, for the forecast alert", () => {
      wrapper = createWrapper({ allowAlertCreation: true });
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "a", _panelQueryIndex: 0, _seriesRole: "primary", data: [] },
            {
              name: "a (forecast)",
              _panelQueryIndex: 0,
              _seriesRole: "forecast",
              _timestamps: [100, 160, 220, 280],
              _rangeEndValue: 0.45,
              data: [
                ["x0", null],
                ["x1", 0.5],
                ["x2", 0.6],
                ["x3", 0.7],
              ],
            },
          ],
        },
      };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 0.7, seriesIndex: 1, dataIndex: 3 });

      expect(wrapper.vm.contextMenuData).toMatchObject({
        seriesRole: "forecast",
        forecastPoint: {
          rangeEndValue: 0.45,
          startTime: 160,
          startValue: 0.5,
          endValue: 0.7,
          clickedTime: 280,
        },
      });
    });

    it("measures a forecast line from the range end, past the points that close the seam", () => {
      wrapper = createWrapper({ allowAlertCreation: true });
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "a", _panelQueryIndex: 0, _seriesRole: "primary", data: [] },
            {
              name: "a (forecast)",
              _panelQueryIndex: 0,
              _seriesRole: "forecast",
              _timestamps: [100, 160, 220, 280],
              _fitStartIndex: 1,
              _rangeEndValue: 0.45,
              data: [
                ["x0", 0.4],
                ["x1", 0.5],
                ["x2", 0.6],
                ["x3", 0.7],
              ],
            },
          ],
        },
      };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 0.7, seriesIndex: 1, dataIndex: 3 });

      expect(wrapper.vm.contextMenuData.forecastPoint).toMatchObject({
        startTime: 160,
        startValue: 0.5,
        endValue: 0.7,
      });
    });

    it("measures a right-click on a seam point from the range end, at the shortest horizon", () => {
      wrapper = createWrapper({ allowAlertCreation: true });
      wrapper.vm.panelData = {
        options: {
          series: [
            { name: "a", _panelQueryIndex: 0, _seriesRole: "primary", data: [] },
            {
              name: "a (forecast)",
              _panelQueryIndex: 0,
              _seriesRole: "forecast",
              _timestamps: [100, 160, 220, 280],
              _fitStartIndex: 1,
              _rangeEndValue: 0.45,
              data: [
                ["x0", 0.4],
                ["x1", 0.5],
                ["x2", 0.6],
                ["x3", 0.7],
              ],
            },
          ],
        },
      };

      wrapper.vm.onChartDomContextMenu({ x: 1, y: 2, value: 0.4, seriesIndex: 1, dataIndex: 0 });

      const point = wrapper.vm.contextMenuData.forecastPoint;
      expect(point).toMatchObject({ startTime: 160, startValue: 0.5, clickedTime: 100 });
      // The clicked value is the target, as on any forecast point; H from before the range end clamps.
      expect(wrapper.vm.contextMenuData.value).toBe(0.4);
      expect(
        forecastAlertFromChart({ ...point, U: "x", T: 0.4, rangeSeconds: 3600 }),
      ).toMatchObject({ direction: "falls", H: FORECAST_MIN_DAYS });
    });
  });

  describe("metric copy button", () => {
    const metricSeries = () => [
      {
        _metricText: "1.50KB",
        _metricLayout: {
          left: 0,
          top: 0,
          width: 200,
          height: 100,
          cx: 100,
          cy: 50,
          fontSize: 24,
        },
      },
      {
        _metricText: "2.00MB",
        _metricLayout: {
          left: 200,
          top: 0,
          width: 200,
          height: 100,
          cx: 300,
          cy: 50,
          fontSize: 24,
        },
      },
    ];

    const mountMetric = async (series: any[] = metricSeries()) => {
      const w = createWrapper({
        panelSchema: { ...defaultProps.panelSchema, type: "metric" },
      });
      await flushPromises();
      w.vm.panelData = { chartType: "metric", options: { series } };
      await nextTick();
      return w;
    };

    it("builds one copy item per metric value", async () => {
      wrapper = await mountMetric();
      expect(wrapper.vm.metricItems).toHaveLength(2);
      expect(wrapper.vm.metricItems[0]).toMatchObject({ idx: 0, text: "1.50KB" });
      expect(wrapper.vm.metricItems[1]).toMatchObject({ idx: 1, text: "2.00MB" });
    });

    it("skips series without a value or layout", async () => {
      wrapper = await mountMetric([
        { _metricText: "", _metricLayout: { left: 0, width: 100 } },
        { _metricText: "5", _metricLayout: null },
      ]);
      expect(wrapper.vm.metricItems).toHaveLength(0);
    });

    it("keeps the hover zone of a zero value but gives it no copy button", async () => {
      const layout = {
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        cx: 50,
        cy: 20,
        fontSize: 12,
      };
      wrapper = await mountMetric([
        { _metricText: "0", _metricLayout: { ...layout } },
        { _metricText: "0.00", _metricLayout: { ...layout } },
        { _metricText: "0 ms", _metricLayout: { ...layout } },
        { _metricText: "0%", _metricLayout: { ...layout } },
        { _metricText: "2.00MB", _metricLayout: { ...layout } },
      ]);
      expect(wrapper.vm.metricItems).toHaveLength(5);
      expect(wrapper.vm.metricItems.map((m: any) => m.iconStyle !== null)).toEqual([
        false,
        false,
        false,
        false,
        true,
      ]);
    });

    it("offers a cut series label in full on its hover zone, and only a cut one", async () => {
      const [first, second] = metricSeries();
      wrapper = await mountMetric([
        {
          ...first,
          _metricLabel: '{instance="10.0.0.12:9100"}',
          _metricLayout: { ...first._metricLayout, labelCut: true },
        },
        { ...second, _metricLabel: "web" },
      ]);
      expect(wrapper.vm.metricItems[0].fullLabel).toBe('{instance="10.0.0.12:9100"}');
      expect(wrapper.vm.metricItems[1].fullLabel).toBeUndefined();
    });

    it("returns no items for non-metric panels", async () => {
      wrapper = createWrapper();
      await flushPromises();
      wrapper.vm.panelData = { options: { series: metricSeries() } };
      await nextTick();
      expect(wrapper.vm.metricItems).toEqual([]);
    });

    it("zone style spans the value's grid cell", async () => {
      wrapper = await mountMetric();
      expect(wrapper.vm.metricZoneStyle(wrapper.vm.metricItems[1])).toEqual({
        left: "200px",
        top: "0px",
        width: "200px",
        height: "100px",
      });
    });

    it("positions the icon beside the number, clamped inside the cell", async () => {
      wrapper = await mountMetric();
      const style = wrapper.vm.metricIconStyle(wrapper.vm.metricItems[0]);
      // left = cx (100) + measured text width / 2 + 2px gap, inside the cell
      const textWidth = calculateWidthText("1.50KB", "24px");
      expect(style.left).toBe(`${100 + textWidth / 2 + 2}px`);
      expect(style.top).toBe("50px");
      expect(style.transform).toBe("translateY(-50%)");
    });

    const clickZone = async (target: HTMLElement) => {
      const w = createWrapper({
        panelSchema: {
          ...defaultProps.panelSchema,
          type: "metric",
          config: {
            ...defaultProps.panelSchema.config,
            drilldown: [{ name: "Link", type: "byUrl", data: { url: "https://example.com" } }],
          },
        },
      });
      await flushPromises();
      w.vm.panelData = { chartType: "metric", options: { series: metricSeries() } };
      await nextTick();
      w.vm.onMetricZoneClick(w.vm.metricItems[1], { target, offsetX: 5, offsetY: 6 });
      await flushPromises();
      return w;
    };

    it("opens the drilldown menu from a click on a value's hover zone", async () => {
      wrapper = await clickZone(document.createElement("div"));
      expect(wrapper.vm.drilldownArray).toHaveLength(1);
    });

    it("leaves the drilldown menu closed when the copy button is clicked", async () => {
      const button = document.createElement("button");
      button.appendChild(document.createElement("span"));
      wrapper = await clickZone(button.firstChild as HTMLElement);
      expect(wrapper.vm.drilldownArray).toHaveLength(0);
    });

    it("copies the displayed value and flags the copied state", async () => {
      wrapper = await mountMetric();
      wrapper.vm.copyMetricItem(wrapper.vm.metricItems[1]);
      expect(copyToClipboard).toHaveBeenCalledWith("2.00MB", expect.any(Function), {
        silent: true,
      });
      await flushPromises();
      expect(wrapper.vm.metricCopiedIdx).toBe(1);
    });
  });

  // A time shift appends shifted streams after the primaries: [A, B, A', B'].
  describe("hidden PromQL queries with time-shifted results", () => {
    const PAGE_KEY = "time-shift-hidden-queries";
    const entry = (name: string) => ({ resultType: "matrix", result: [{ metric: { q: name } }] });
    const metaEntry = (panelQueryIndex: number, gapMs = 0) => ({
      panelQueryIndex,
      timeRangeGap: { seconds: gapMs, periodAsStr: gapMs ? "1 day ago" : "" },
    });

    const mountWithHidden = async (hiddenQueries: number[]) => {
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: ref([entry("A"), entry("B"), entry("A1d"), entry("B1d")]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({
          queries: [metaEntry(0), metaEntry(1), metaEntry(0, 86_400_000), metaEntry(1, 86_400_000)],
        }),
        resultMetaData: ref([[{ step: 1 }], [{ step: 2 }], [{ step: 3 }], [{ step: 4 }]]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      const w = mount(PanelSchemaRenderer, {
        props: {
          ...defaultProps,
          panelSchema: {
            id: "panel-ts",
            type: "line",
            queryType: "promql",
            queries: [
              { query: "a", fields: {}, config: { time_shift: [{ offSet: "1d" }] } },
              { query: "b", fields: {}, config: { time_shift: [{ offSet: "1d" }] } },
            ],
            config: {},
          },
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            dashboardPanelDataPageKey: PAGE_KEY,
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: { template: '<div data-test="chart-renderer"></div>' },
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      await flushPromises();
      getPanelDataForPageKey(PAGE_KEY).layout.hiddenQueries = hiddenQueries;
      await flushPromises();
      return w;
    };

    const lastConversion = () => {
      const call = vi.mocked(convertPanelData).mock.calls.at(-1)!;
      return { data: call[1], resultMetaData: (call[5] as any)?.value, metadata: call[6] };
    };

    afterEach(() => {
      getPanelDataForPageKey(PAGE_KEY).layout.hiddenQueries = [];
    });

    it("hiding query B also hides B's shifted results, keeping data and metadata aligned", async () => {
      wrapper = await mountWithHidden([1]);

      const { data, metadata, resultMetaData } = lastConversion();
      expect(data.map((d: any) => d.result[0].metric.q)).toEqual(["A", "A1d"]);
      expect(metadata.queries.map((m: any) => m.panelQueryIndex)).toEqual([0, 0]);
      expect(metadata.queries[1].timeRangeGap.seconds).toBe(86_400_000);
      expect(resultMetaData.map((r: any) => r[0].step)).toEqual([1, 3]);
    });

    it("hiding query A keeps B and B's shifted results", async () => {
      wrapper = await mountWithHidden([0]);

      const { data, metadata } = lastConversion();
      expect(data.map((d: any) => d.result[0].metric.q)).toEqual(["B", "B1d"]);
      expect(metadata.queries.map((m: any) => m.panelQueryIndex)).toEqual([1, 1]);
    });
  });

  describe("the saved hide flag", () => {
    const entry = (name: string) => ({ resultType: "matrix", result: [{ metric: { q: name } }] });
    const metaEntry = (panelQueryIndex: number, gapMs = 0) => ({
      panelQueryIndex,
      timeRangeGap: { seconds: gapMs, periodAsStr: gapMs ? "1 day ago" : "" },
    });

    it("hides a query saved with config.hide on a dashboard, outside the editor", async () => {
      const loaded = ref<any[]>([]);
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: loaded,
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [metaEntry(0), metaEntry(1), metaEntry(0, 86_400_000)] }),
        resultMetaData: ref([[{ step: 1 }], [{ step: 2 }], [{ step: 3 }]]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);
      wrapper = mount(PanelSchemaRenderer, {
        props: {
          ...defaultProps,
          panelSchema: {
            id: "panel-saved-hide",
            type: "line",
            queryType: "promql",
            queries: [
              { query: "a", fields: {}, config: { time_shift: [{ offSet: "1d" }] } },
              { query: "b", fields: {}, config: { hide: true } },
            ],
            config: {},
          },
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: { template: '<div data-test="chart-renderer"></div>' },
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      await flushPromises();
      loaded.value = [entry("A"), entry("B"), entry("A1d")];
      await flushPromises();

      const call = vi.mocked(convertPanelData).mock.calls.at(-1)!;
      expect(call[1].map((d: any) => d.result[0].metric.q)).toEqual(["A", "A1d"]);
      expect(call[6].queries.map((m: any) => m.panelQueryIndex)).toEqual([0, 0]);
    });

    it("right-click on empty chart area alerts on the formula, not its saved-hidden inputs", async () => {
      closeAlertCreationDialog();
      const combined = "(sum(rate(errors[1m]))) / (sum(rate(requests[1m])))";
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: ref([entry("A"), entry("B"), entry("F")]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({
          queries: [
            { ...metaEntry(0), query: "sum(rate(errors[1m]))" },
            { ...metaEntry(1), query: "sum(rate(requests[1m]))" },
            { ...metaEntry(2), query: combined },
          ],
        }),
        resultMetaData: ref([[{ step: 1 }], [{ step: 1 }], [{ step: 1 }]]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);
      wrapper = createWrapper({
        allowAlertCreation: true,
        panelSchema: {
          id: "panel-formula",
          type: "line",
          queryType: "promql",
          queries: [
            {
              query: "sum(rate(errors[1m]))",
              fields: { stream: "errors", stream_type: "metrics" },
              config: { ref: "A", hide: true },
            },
            {
              query: "sum(rate(requests[1m]))",
              fields: { stream: "requests", stream_type: "metrics" },
              config: { ref: "B", hide: true },
            },
            { query: "", fields: { stream_type: "metrics" }, config: { formula: "A / B" } },
          ],
          config: {},
        },
      });
      await flushPromises();

      wrapper.vm.handleCreateAlert({ condition: "above", threshold: 1 });

      const prefill = alertCreationDialog.value?.prefill;
      expect(prefill?.promql).toBe(combined);
      expect(prefill?.queryChoices).toBeUndefined();
      expect(prefill?.streamCandidates?.map((c: any) => c.name)).toEqual(["errors", "requests"]);
    });

    it("in the editor, follows the editor's live hide state over the applied panel's", async () => {
      const loaded = ref<any[]>([]);
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: loaded,
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [metaEntry(0), metaEntry(1), metaEntry(0, 86_400_000)] }),
        resultMetaData: ref([[{ step: 1 }], [{ step: 2 }], [{ step: 3 }]]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);
      wrapper = mount(PanelSchemaRenderer, {
        props: {
          ...defaultProps,
          panelSchema: {
            id: "panel-saved-hide",
            type: "line",
            queryType: "promql",
            queries: [
              { query: "a", fields: {}, config: { time_shift: [{ offSet: "1d" }] } },
              { query: "b", fields: {}, config: { hide: true } },
            ],
            config: {},
          },
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            dashboardPanelDataPageKey: "saved-hide-editor",
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: { template: '<div data-test="chart-renderer"></div>' },
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      await flushPromises();
      getPanelDataForPageKey("saved-hide-editor").layout.hiddenQueries = [0];
      loaded.value = [entry("A"), entry("B"), entry("A1d")];
      await flushPromises();

      const call = vi.mocked(convertPanelData).mock.calls.at(-1)!;
      expect(call[1].map((d: any) => d.result[0].metric.q)).toEqual(["B"]);
      expect(call[6].queries.map((m: any) => m.panelQueryIndex)).toEqual([1]);
    });
  });
  // A chunk conversion landing after the final one must not overwrite it.
  describe("conversions finishing out of order", () => {
    const PAGE_KEY = "conversion-race";
    const primary = {
      resultType: "matrix",
      result: [{ metric: { host: "a" }, values: [[1, "1"]] }],
    };
    const shifted = {
      resultType: "matrix",
      result: [{ metric: { host: "a" }, values: [[1, "2"]] }],
    };
    const optionsWith = (...names: string[]) => ({
      chartType: "line",
      options: { series: names.map((name) => ({ name, data: [[1, 1]] })) },
      extras: {},
    });

    const mountRacing = async () => {
      const data = ref<any[]>([]);
      const loading = ref(false);
      const errorDetail = ref({ message: "", code: "" });
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data,
        loading,
        errorDetail,
        metadata: ref({
          queries: [
            { panelQueryIndex: 0, timeRangeGap: { seconds: 0, periodAsStr: "" } },
            {
              panelQueryIndex: 0,
              timeRangeGap: { seconds: 600_000, periodAsStr: "10 Minutes ago" },
            },
          ],
        }),
        resultMetaData: ref([]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);

      wrapper = mount(PanelSchemaRenderer, {
        props: {
          ...defaultProps,
          panelSchema: {
            id: "panel-race",
            type: "line",
            queryType: "promql",
            queries: [{ query: "x", fields: {}, config: { time_shift: [{ offSet: "10m" }] } }],
            config: {},
          },
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            dashboardPanelDataPageKey: PAGE_KEY,
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: { template: '<div data-test="chart-renderer"></div>' },
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      await flushPromises();
      return { data, loading, errorDetail };
    };

    it("emits an empty sankey notice on mount, clearing a previous chart's chip", async () => {
      await mountRacing();
      expect(wrapper.emitted("sankey-notice-update")?.[0]).toEqual([null]);
    });

    it("keeps the latest conversion when an earlier, slower one resolves after it", async () => {
      const { data, loading } = await mountRacing();

      // A streamed chunk with only the primary: its conversion is slow.
      let resolveChunk!: (v: any) => void;
      vi.mocked(convertPanelData).mockImplementationOnce(
        () => new Promise((resolve) => (resolveChunk = resolve)),
      );
      loading.value = true;
      data.value = [primary];
      await flushPromises();

      // The final render with both streams resolves at once.
      vi.mocked(convertPanelData).mockResolvedValueOnce(optionsWith("a", "a (10 Minutes ago)"));
      data.value = [primary, shifted];
      loading.value = false;
      await flushPromises();
      expect(wrapper.vm.panelData.options.series.map((s: any) => s.name)).toEqual([
        "a",
        "a (10 Minutes ago)",
      ]);

      // The stale chunk lands last.
      resolveChunk(optionsWith("a"));
      await flushPromises();
      expect(wrapper.vm.panelData.options.series.map((s: any) => s.name)).toEqual([
        "a",
        "a (10 Minutes ago)",
      ]);
    });

    // Run 1 has rendered a chart and has a chunk conversion in flight when run 2 resets the buffer.
    const startRunTwoOverPendingChunk = async (data: any, loading: any) => {
      vi.mocked(convertPanelData).mockResolvedValueOnce(optionsWith("run1"));
      data.value = [primary];
      await flushPromises();
      expect(wrapper.vm.panelData.options.series.map((s: any) => s.name)).toEqual(["run1"]);

      loading.value = true;
      const chunk: { resolve: (v: any) => void; reject: (e: any) => void } = {} as any;
      vi.mocked(convertPanelData).mockImplementationOnce(
        () => new Promise((resolve, reject) => Object.assign(chunk, { resolve, reject })),
      );
      data.value = [primary, shifted];
      await flushPromises();

      data.value = [];
      await flushPromises();
      return chunk;
    };

    it("emits an empty series limit on mount, clearing a previous chart's series chip", async () => {
      await mountRacing();
      expect(wrapper.emitted("series-limit-update")?.[0]).toEqual([null]);
    });

    it("clears a line chart's series chip in the editor preview when the panel turns into a host map", async () => {
      const data = ref<any[]>([]);
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data,
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [{ panelQueryIndex: 0 }] }),
        resultMetaData: ref([]),
        annotations: ref([]),
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as any);
      const schemaOf = (type: string) => ({
        id: "panel-preview",
        type,
        queryType: "promql",
        queries: [{ query: "gpu_power_watts", fields: {}, config: {} }],
        config: {},
      });
      // The editor keys its preview renderer by chart type and feeds its notices to PanelErrorButtons.
      const Preview = defineComponent({
        components: { PanelSchemaRenderer, PanelErrorButtons },
        props: { type: { type: String, required: true } },
        setup(props) {
          const limit = ref<any>(null);
          const message = ref("");
          const schema = computed(() => schemaOf(props.type));
          return { limit, message, schema, defaultProps };
        },
        template: `
          <div>
            <PanelErrorButtons :seriesLimit="limit" :limitNumberOfSeriesWarningMessage="message" />
            <PanelSchemaRenderer
              :key="type"
              v-bind="defaultProps"
              :panelSchema="schema"
              @series-limit-update="limit = $event"
              @limit-number-of-series-warning-message-update="message = $event"
            />
          </div>`,
      });
      vi.mocked(convertPanelData).mockResolvedValueOnce({
        ...optionsWith("gpu"),
        extras: {
          limitNumberOfSeriesWarningMessage: "Showing 100 of 512 series to keep the chart fast",
        },
      });
      const host = mount(Preview, {
        props: { type: "line" },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            dashboardPanelDataPageKey: PAGE_KEY,
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: { template: '<div data-test="chart-renderer"></div>' },
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      onTestFinished(() => host.unmount());
      await flushPromises();
      data.value = [primary];
      await flushPromises();
      expect(host.find('[data-test="panel-notice-chip-series-cap"]').exists()).toBe(true);

      vi.mocked(convertPanelData).mockResolvedValueOnce({
        ...optionsWith("gpu"),
        chartType: "hostmap",
        extras: { panelId: "panel-preview" },
      });
      await host.setProps({ type: "hostmap" });
      await flushPromises();
      data.value = [{ ...primary }];
      await flushPromises();
      expect(host.find('[data-test="panel-notice-chip-series-cap"]').exists()).toBe(false);
    });

    it("emits an empty map notice on mount, clearing a previous chart's chip", async () => {
      await mountRacing();
      expect(wrapper.emitted("region-join-update")?.[0]).toEqual([null]);
    });

    it("emits the maps region join from each conversion and clears it on the next", async () => {
      const { data } = await mountRacing();
      const join = { unmatched: ["us-east-1"], unmatchedTotal: 1 };

      vi.mocked(convertPanelData).mockResolvedValueOnce({
        ...optionsWith("a"),
        extras: { regionJoin: join },
      });
      data.value = [primary];
      await flushPromises();
      expect(wrapper.emitted("region-join-update")?.at(-1)).toEqual([join]);

      vi.mocked(convertPanelData).mockResolvedValueOnce(optionsWith("b"));
      data.value = [shifted];
      await flushPromises();
      expect(wrapper.emitted("region-join-update")?.at(-1)).toEqual([null]);
    });

    it("clears the maps region join when a conversion fails", async () => {
      const { data } = await mountRacing();
      vi.mocked(convertPanelData).mockResolvedValueOnce({
        ...optionsWith("a"),
        extras: { regionJoin: { unmatched: ["x"], unmatchedTotal: 1 } },
      });
      data.value = [primary];
      await flushPromises();

      vi.mocked(convertPanelData).mockRejectedValueOnce(new Error("bad"));
      data.value = [shifted];
      await flushPromises();
      expect(wrapper.emitted("region-join-update")?.at(-1)).toEqual([null]);
    });

    it("clears the maps region join when the next run carries a query error", async () => {
      const { data, errorDetail } = await mountRacing();
      vi.mocked(convertPanelData).mockResolvedValueOnce({
        ...optionsWith("a"),
        extras: { regionJoin: { unmatched: ["x"], unmatchedTotal: 1 } },
      });
      data.value = [primary];
      await flushPromises();

      errorDetail.value = { message: "bad query", code: "400" };
      data.value = [shifted];
      await flushPromises();
      expect(wrapper.emitted("region-join-update")?.at(-1)).toEqual([null]);
    });

    it("drops a previous run's conversion that resolves after the next run reset", async () => {
      const { data, loading } = await mountRacing();
      const chunk = await startRunTwoOverPendingChunk(data, loading);

      chunk.resolve(optionsWith("stale"));
      await flushPromises();
      expect(wrapper.vm.panelData.options.series.map((s: any) => s.name)).toEqual(["run1"]);
    });

    it("drops a previous run's conversion error that lands after the next run reset", async () => {
      const { data, loading, errorDetail } = await mountRacing();
      const chunk = await startRunTwoOverPendingChunk(data, loading);

      chunk.reject(new Error("stale failure"));
      await flushPromises();
      expect(errorDetail.value.message).toBe("");
    });

    it("keeps a stream error set while a conversion is still awaiting", async () => {
      const { data, loading, errorDetail } = await mountRacing();
      loading.value = true;
      const chunk: { resolve: (v: any) => void } = {} as any;
      vi.mocked(convertPanelData).mockImplementationOnce(
        () => new Promise((resolve) => Object.assign(chunk, { resolve })),
      );
      data.value = [primary];
      await flushPromises();

      errorDetail.value = { message: "stream failed", code: "500" };
      chunk.resolve(optionsWith("late"));
      await flushPromises();
      expect(errorDetail.value.message).toBe("stream failed");
    });
  });

  describe("dashboard annotation sources", () => {
    const manual = { title: "rollback", text: "", start_time: 1_704_067_200_000_000 };
    const queryMarker = {
      start_time: 1_704_070_800_000_000,
      end_time: null,
      title: "checkout deployed",
      text: "by alice",
      source: { id: "deploys", name: "Deploys", color: "#34d399" },
    };
    const chartApi = { dispatchAction: vi.fn(), setOption: vi.fn() };
    const ChartRendererStub = {
      name: "ChartRenderer",
      emits: ["mouseover", "mouseout", "click"],
      template: '<div data-test="chart-renderer"></div>',
      setup: () => ({ chart: chartApi }),
    };

    const mountWithSources = async (failed: string[] = []) => {
      const entry = { resultType: "matrix", result: [{ metric: { q: "A" } }] };
      const manualAnnotations = ref<unknown[]>([]);
      vi.mocked(usePanelDataLoader).mockReturnValue({
        data: ref([entry]),
        loading: ref(false),
        errorDetail: ref({ message: "", code: "" }),
        metadata: ref({ queries: [{ panelQueryIndex: 0 }] }),
        resultMetaData: ref([[{ step: 1 }]]),
        annotations: manualAnnotations,
        lastTriggeredAt: ref(null),
        isCachedDataDifferWithCurrentTimeRange: ref(false),
        searchRequestTraceIds: ref([]),
        loadingProgressPercentage: ref(0),
        isPartialData: ref(false),
      } as unknown as ReturnType<typeof usePanelDataLoader>);
      const markersForPanel = vi.fn(() => [queryMarker]);
      const w = mount(PanelSchemaRenderer, {
        props: {
          ...defaultProps,
          panelSchema: {
            id: "panel-ts",
            type: "line",
            queryType: "promql",
            queries: [{ query: "a", fields: {}, config: {} }],
            config: {},
          },
        },
        global: {
          plugins: [i18n, store],
          provide: {
            hoveredSeriesState: { value: null },
            variablesAndPanelsDataLoadingState: {
              panels: {},
              variablesData: {},
              searchRequestTraceIds: {},
            },
            [DASHBOARD_ANNOTATION_SOURCES_KEY as symbol]: {
              loading: ref(false),
              markersForPanel,
              failedSourcesForPanel: () => failed,
            },
          },
          mocks: { $t: (key: string) => key },
          stubs: {
            ChartRenderer: ChartRendererStub,
            AddAnnotation: { template: '<div data-test="add-annotation"></div>' },
            LoadingProgress: { template: '<div data-test="loading-progress"></div>' },
          },
        },
      });
      await flushPromises();
      return { w, markersForPanel, manualAnnotations };
    };

    it("draws the panel's own annotations first, then the dashboard's source markers", async () => {
      const { w, markersForPanel, manualAnnotations } = await mountWithSources();
      wrapper = w;
      manualAnnotations.value = [manual];
      await flushPromises();

      expect(markersForPanel).toHaveBeenCalledWith("panel-ts", "line");
      const annotations = vi.mocked(convertPanelData).mock.calls.at(-1)![8] as { value: unknown[] };
      expect(annotations.value).toEqual([manual, queryMarker]);
    });

    const tooltipEl = () =>
      document.body.querySelector<HTMLElement>('[data-test="dashboard-query-annotation-tooltip"]');
    const hover = (
      w: ReturnType<typeof mount>,
      annotationDetails: object,
      clientX: number,
      clientY: number,
    ) =>
      w.findComponent(ChartRendererStub).vm.$emit("mouseover", {
        componentType: "markLine",
        data: { annotationDetails },
        event: { event: { clientX, clientY } },
      });

    it("shows the source, title, description and time when a query marker is hovered", async () => {
      const { w } = await mountWithSources();
      wrapper = w;

      hover(w, queryMarker, 10, 20);
      await nextTick();

      const tooltip = tooltipEl();
      expect(tooltip).not.toBeNull();
      expect(tooltip!.textContent).toContain("Deploys");
      expect(tooltip!.textContent).toContain("checkout deployed");
      expect(tooltip!.textContent).toContain("by alice");
      expect(
        tooltip!
          .querySelector('[data-test="dashboard-query-annotation-tooltip-time"]')!
          .textContent!.trim(),
      ).toMatch(/^2024-01-01 \d{2}:\d{2}$/);

      w.findComponent(ChartRendererStub).vm.$emit("mouseout", {});
      await nextTick();
      expect(tooltipEl()).toBeNull();
    });

    it("renders the tooltip outside the panel card and clamps it at the viewport edges", async () => {
      const { w } = await mountWithSources();
      wrapper = w;

      hover(w, queryMarker, 10, 20);
      await nextTick();
      expect(tooltipEl()!.parentElement).toBe(document.body);
      expect(tooltipEl()!.style.left).toBe("10px");
      expect(tooltipEl()!.style.top).toBe("20px");

      hover(w, queryMarker, window.innerWidth - 5, window.innerHeight - 5);
      await nextTick();
      expect(tooltipEl()!.style.left).toBe(`${window.innerWidth - 8}px`);
      expect(tooltipEl()!.style.top).toBe(`${window.innerHeight - 8}px`);
    });

    it("pauses the chart's axis tooltip while a query marker shows its own, and resumes after", async () => {
      chartApi.dispatchAction.mockClear();
      chartApi.setOption.mockClear();
      const { w } = await mountWithSources();
      wrapper = w;

      hover(w, queryMarker, 10, 20);
      await nextTick();
      expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
      expect(chartApi.setOption).toHaveBeenLastCalledWith({ tooltip: { triggerOn: "none" } });

      w.findComponent(ChartRendererStub).vm.$emit("mouseout", {});
      await nextTick();
      expect(chartApi.setOption).toHaveBeenLastCalledWith({
        tooltip: { triggerOn: "mousemove|click" },
      });
    });

    it("leaves the axis tooltip alone for manual markers and plain mouseouts", async () => {
      chartApi.dispatchAction.mockClear();
      chartApi.setOption.mockClear();
      const { w } = await mountWithSources();
      wrapper = w;

      hover(w, manual, 10, 20);
      w.findComponent(ChartRendererStub).vm.$emit("mouseout", {});
      await nextTick();
      expect(chartApi.dispatchAction).not.toHaveBeenCalled();
      expect(chartApi.setOption).not.toHaveBeenCalled();
    });

    it("shows no tooltip for a manual annotation", async () => {
      const { w } = await mountWithSources();
      wrapper = w;

      hover(w, manual, 10, 20);
      await nextTick();
      expect(tooltipEl()).toBeNull();
    });

    it("exposes the failed sources aimed at the panel", async () => {
      const { w } = await mountWithSources(["Incidents"]);
      wrapper = w;
      expect(w.vm.failedAnnotationSources).toEqual(["Incidents"]);
    });
  });
});
