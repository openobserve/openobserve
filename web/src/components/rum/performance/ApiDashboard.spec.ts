import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick, reactive } from "vue";
import ApiDashboard from "./ApiDashboard.vue";

// ---------------------------------------------------------------------------
// Module mocks — must be at top level
// ---------------------------------------------------------------------------

// Shared reactive `_rumdata` schema state, mirroring the module-level singleton the real
// usePerformance() exposes. `mock` prefix so the vi.mock factories may reference it.
const mockPerformanceState = reactive({
  data: {
    datetime: { startTime: 0, endTime: 0, relativeTimePeriod: "15m", valueType: "relative" },
    streams: {} as Record<string, any>,
  },
});

const mockGetStream = vi.fn();

vi.mock("@/composables/rum/usePerformance", () => ({
  default: () => ({ performanceState: mockPerformanceState }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: mockGetStream }),
}));

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template: '<div data-test="render-dashboard-charts"><slot /></div>',
    props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
    emits: ["variablesManagerReady"],
    setup() {
      return { layoutUpdate: vi.fn() };
    },
  },
}));

// At least one panel is required: the capability filter treats a zero-panel dashboard as
// "everything dropped", which flips the component into its empty state. This panel's SQL
// references gated resource columns, so it survives a network-capable schema and is
// dropped by a stream without resource instrumentation.
vi.mock("@/utils/rum/api.json", () => ({
  default: {
    title: "RUM API Dashboard",
    panels: [
      {
        id: "slow-resources",
        title: "Slowest resources",
        layout: { x: 0, y: 0, w: 12, h: 4, i: 1 },
        queries: [
          {
            query:
              'SELECT avg(resource_duration) as y_axis, resource_url as x_axis FROM "_rumdata"',
          },
        ],
      },
    ],
    variables: { list: [] },
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
  },
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data || { variables: { list: [] } }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({
    query: { dashboard: "test-dashboard", folder: "test-folder", org_identifier: "test-org" },
  }),
}));

const mockStore = {
  state: { selectedOrganization: { identifier: "test-org" } },
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Columns the API dashboard's panels gate on — a stream that instruments network calls.
const RESOURCE_FIELDS = [
  "resource_url",
  "resource_duration",
  "resource_size",
  "resource_status_code",
  "resource_method",
];

function buildSchemaMap(fieldNames: string[]): Record<string, any> {
  const schemaMap: Record<string, any> = {};
  fieldNames.forEach((name) => {
    schemaMap[name] = { name };
  });
  return schemaMap;
}

// A schema carrying every resource column the API panels need.
const resourceSchemaMap = buildSchemaMap(RESOURCE_FIELDS);

// Seeds the shared performanceState so ensureRumSchema() short-circuits without calling
// getStream — the dashboard branch then renders after a single flush.
function seedRumSchema(schemaMap: Record<string, any> | null) {
  if (schemaMap === null) {
    delete mockPerformanceState.data.streams["_rumdata"];
    return;
  }
  mockPerformanceState.data.streams["_rumdata"] = { schema: schemaMap, name: "_rumdata" };
}

/** Mounts with a resolved, network-capable schema so the dashboard branch is rendered. */
async function createResolvedWrapper(props: Record<string, any> = {}) {
  seedRumSchema(resourceSchemaMap);
  const mounted = createWrapper(props);
  await flushPromises();
  return mounted;
}

const defaultProps = {
  dateTime: { startTime: 1234567890, endTime: 1234568000, type: "relative", period: "15m" },
  selectedDate: { startTime: 1234567890, endTime: 1234568000 },
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(ApiDashboard, {
    props: { ...defaultProps, ...props },
    global: {
      stubs: {
        RenderDashboardCharts: {
          name: "RenderDashboardCharts",
          template: '<div data-test="render-dashboard-charts"><slot /></div>',
          props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
          emits: ["variablesManagerReady"],
          setup() {
            return { layoutUpdate: vi.fn() };
          },
        },
        OSpinner: { template: '<div data-test="spinner" />' },
        OEmptyState: {
          name: "OEmptyState",
          template: '<div><slot name="title" /><slot name="description" /></div>',
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiDashboard", () => {
  let wrapper: ReturnType<typeof createWrapper>;

  beforeEach(() => {
    // Every test starts with no known `_rumdata` schema; tests opt into one as needed.
    seedRumSchema(null);
    mockGetStream.mockReset();
    mockGetStream.mockResolvedValue({ schema: [] });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("component initialization", () => {
    it("renders without errors when given valid props", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("exposes viewOnly as true", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.viewOnly).toBe(true);
    });

    it("initializes isLoading as empty array", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.isLoading).toEqual([]);
    });

    it("initializes eventLog as empty array", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.eventLog).toEqual([]);
    });

    it("initializes refreshInterval as 0", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.refreshInterval).toBe(0);
    });

    it("initializes variablesData as loading with empty values", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.variablesData).toEqual({ isVariablesLoading: true, values: [] });
    });

    it("exposes the capability-filtered dashboard as dashboardData", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.dashboardData).toMatchObject({ title: "RUM API Dashboard" });
    });

    it("accepts dateTime prop correctly", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.$props.dateTime).toEqual(defaultProps.dateTime);
    });

    it("accepts selectedDate prop correctly", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.$props.selectedDate).toEqual(defaultProps.selectedDate);
    });

    it("accepts custom dateTime prop", () => {
      // Arrange
      const customDateTime = {
        startTime: 1609459200,
        endTime: 1609545600,
        type: "absolute",
        period: "1h",
      };

      // Act
      wrapper = createWrapper({ dateTime: customDateTime });

      // Assert
      expect(wrapper.vm.$props.dateTime).toEqual(customDateTime);
    });

    it("handles empty dateTime prop gracefully", () => {
      // Arrange + Act
      wrapper = createWrapper({ dateTime: {} });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("handles undefined props gracefully", () => {
      // Arrange + Act
      wrapper = createWrapper({ dateTime: undefined, selectedDate: undefined });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("template rendering", () => {
    beforeEach(async () => {
      // A known network-capable schema resolves the gate without calling getStream, so
      // the dashboard branch (not the spinner or the empty state) renders.
      wrapper = await createResolvedWrapper();
    });

    it("renders the api-performance-dashboards container", () => {
      // Arrange (done in beforeEach)
      // Act
      const container = wrapper.find('[data-test="api-performance-dashboards"]');

      // Assert
      expect(container.exists()).toBe(true);
    });

    it("renders the performance-dashboard section", () => {
      // Act
      const section = wrapper.find(".performance-dashboard");

      // Assert
      expect(section.exists()).toBe(true);
    });

    it("renders RenderDashboardCharts component", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.exists()).toBe(true);
    });

    it("passes viewOnly=true to RenderDashboardCharts", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.props("viewOnly")).toBe(true);
    });

    it("passes searchType='RUM' to RenderDashboardCharts", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.props("searchType")).toBe("RUM");
    });

    it("passes dateTime as currentTimeObj to RenderDashboardCharts", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.props("currentTimeObj")).toEqual(defaultProps.dateTime);
    });

    it("passes the capability-filtered dashboardData to RenderDashboardCharts", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.props("dashboardData")).toEqual(wrapper.vm.dashboardData);
    });

    it("renders loading spinner when isLoading has items", async () => {
      // Act
      wrapper.vm.isLoading.push(true);
      await nextTick();

      // Assert
      expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
    });

    it("renders loading text when isLoading has items", async () => {
      // Act
      wrapper.vm.isLoading.push(true);
      await nextTick();

      // Assert
      expect(wrapper.text()).toContain("Loading Dashboard");
    });
  });

  describe("schema gating", () => {
    it("migrates the dashboard schema while setting up", async () => {
      // Arrange
      const convertModule = await import("@/utils/dashboard/convertDashboardSchemaVersion");
      const mockConvert = vi.mocked(convertModule.convertDashboardSchemaVersion);

      // Act
      wrapper = await createResolvedWrapper();

      // Assert
      expect(mockConvert).toHaveBeenCalled();
    });

    it("shows the loading spinner and no dashboard while the schema is unresolved", async () => {
      // Arrange — a getStream that never settles keeps the gate open.
      let resolveStream!: (value: { schema: any[] }) => void;
      mockGetStream.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
      );

      // Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.find('[data-test="api-dashboard-schema-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="api-dashboard-empty"]').exists()).toBe(false);

      // Cleanup — settle the pending promise so it can't leak into other tests.
      resolveStream({ schema: [] });
      await flushPromises();
    });

    it("renders the dashboard when the resolved schema has the resource columns", async () => {
      // Arrange
      mockGetStream.mockResolvedValueOnce({
        schema: RESOURCE_FIELDS.map((name) => ({ name })),
      });

      // Act
      wrapper = createWrapper();
      await flushPromises();

      // Assert
      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", true);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="api-dashboard-empty"]').exists()).toBe(false);
    });

    it("renders the empty state when the resolved schema has no resource columns", async () => {
      // Arrange — a stream with no network instrumentation.
      mockGetStream.mockResolvedValueOnce({
        schema: [{ name: "view_name" }, { name: "session_id" }],
      });

      // Act
      wrapper = createWrapper();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="api-dashboard-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(false);
    });

    it("does not call getStream when the schema is already in the shared state", async () => {
      // Arrange + Act
      wrapper = await createResolvedWrapper();

      // Assert
      expect(mockGetStream).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
    });

    it("renders the full dashboard when getStream rejects and the schema stays inconclusive", async () => {
      // Arrange
      mockGetStream.mockRejectedValueOnce(new Error("network error"));

      // Act
      wrapper = createWrapper();
      await flushPromises();

      // Assert — a transient error must never degrade a working dashboard.
      expect(wrapper.find('[data-test="api-dashboard-schema-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="api-dashboard-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
    });
  });

  describe("settings management", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("starts with showDashboardSettingsDialog as false", () => {
      // Assert
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
    });

    it("sets showDashboardSettingsDialog to true when addSettingsData is called", () => {
      // Act
      wrapper.vm.addSettingsData();

      // Assert
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
    });
  });

  describe("variables management", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("handles variablesData updates", () => {
      // Arrange
      const newData = { isVariablesLoading: true, values: [{ variable1: "value1" }] };

      // Act
      wrapper.vm.variablesData = newData;

      // Assert
      expect(wrapper.vm.variablesData).toEqual(newData);
    });

    it("onVariablesManagerReady does not throw", () => {
      // Arrange
      const mockManager = { test: "manager" };

      // Act + Assert
      expect(() => wrapper.vm.onVariablesManagerReady(mockManager)).not.toThrow();
    });
  });

  describe("store integration", () => {
    it("accesses store state correctly", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.store).toBe(mockStore);
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test-org");
    });
  });

  describe("component references", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("exposes apiDashboardChartsRef", () => {
      // Assert
      expect(wrapper.vm.apiDashboardChartsRef).toBeDefined();
    });

    it("exposes apiDashboard import", () => {
      // Assert
      expect(wrapper.vm.apiDashboard).toBeDefined();
    });
  });

  describe("prop changes", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("updates selectedDate prop correctly", async () => {
      // Arrange
      const newSelectedDate = { startTime: 1234567999, endTime: 1234568999 };

      // Act
      await wrapper.setProps({ selectedDate: newSelectedDate });
      await nextTick();

      // Assert
      expect(wrapper.props("selectedDate")).toEqual(newSelectedDate);
    });

    it("remains functional after prop changes", async () => {
      // Act
      await wrapper.setProps({ selectedDate: defaultProps.selectedDate });
      await nextTick();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("search service integration", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("makes search service available", async () => {
      // Arrange
      const searchModule = await import("@/services/search");

      // Assert
      expect(typeof searchModule.default.search).toBe("function");
    });

    it("does not crash when search service throws an error", async () => {
      // Arrange
      const searchModule = await import("@/services/search");
      vi.mocked(searchModule.default.search).mockRejectedValue(new Error("API Error"));

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("resource data fetching", () => {
    let mockSearch: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const searchModule = await import("@/services/search");
      mockSearch = vi.mocked(searchModule.default.search);
      mockSearch.mockResolvedValue({
        data: {
          hits: [
            {
              url: "https://api.example.com/users?id=1",
              max_duration: 150.25,
              max_resource_size: 1024.5,
              error_count: 5,
            },
            {
              url: "https://api.example.com/orders",
              max_duration: 89.75,
              max_resource_size: 512.0,
              error_count: 2,
            },
          ],
        },
      });
      wrapper = createWrapper();
    });

    it("exposes getTopSlowResources as a function", () => {
      // Assert
      expect(typeof wrapper.vm.getTopSlowResources).toBe("function");
    });

    it("calls searchService when getTopSlowResources is invoked", async () => {
      // Act
      wrapper.vm.getTopSlowResources();
      await nextTick();

      // Assert
      expect(mockSearch).toHaveBeenCalled();
    });

    it("getTopSlowResources calls searchService with org_identifier and RUM page_type", async () => {
      // Act
      wrapper.vm.getTopSlowResources();
      await nextTick();

      // Assert
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "test-org",
          page_type: "logs",
        }),
        "RUM",
      );
    });

    it("exposes getTopHeavyResources as a function", () => {
      // Assert
      expect(typeof wrapper.vm.getTopHeavyResources).toBe("function");
    });

    it("calls searchService when getTopHeavyResources is invoked", async () => {
      // Act
      wrapper.vm.getTopHeavyResources();
      await nextTick();

      // Assert
      expect(mockSearch).toHaveBeenCalled();
    });

    it("exposes getTopErrorResources as a function", () => {
      // Assert
      expect(typeof wrapper.vm.getTopErrorResources).toBe("function");
    });

    it("calls searchService when getTopErrorResources is invoked", async () => {
      // Act
      wrapper.vm.getTopErrorResources();
      await nextTick();

      // Assert
      expect(mockSearch).toHaveBeenCalled();
    });

    it("initializes topSlowResources as empty array", () => {
      // Assert
      expect(wrapper.vm.topSlowResources).toEqual([]);
    });

    it("initializes topHeavyResources as empty array", () => {
      // Assert
      expect(wrapper.vm.topHeavyResources).toEqual([]);
    });

    it("initializes topErrorResources as empty array", () => {
      // Assert
      expect(wrapper.vm.topErrorResources).toEqual([]);
    });
  });

  describe("getVariablesString", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("exposes getVariablesString as a function", () => {
      // Assert
      expect(typeof wrapper.vm.getVariablesString).toBe("function");
    });

    it("returns empty string when variablesData.values is empty", () => {
      // Arrange
      wrapper.vm.variablesData = { isVariablesLoading: false, values: [] };

      // Act
      const result = wrapper.vm.getVariablesString();

      // Assert
      expect(result).toBe("");
    });

    it("returns SQL clause for query_values type variables with a value", () => {
      // Arrange
      wrapper.vm.variablesData = {
        isVariablesLoading: false,
        values: [{ name: "service", value: "web-app", type: "query_values" }],
      };

      // Act
      const result = wrapper.vm.getVariablesString();

      // Assert
      expect(result).toContain("service");
      expect(result).toContain("web-app");
    });

    it("skips variables without a value", () => {
      // Arrange
      wrapper.vm.variablesData = {
        isVariablesLoading: false,
        values: [{ name: "service", value: "", type: "query_values" }],
      };

      // Act
      const result = wrapper.vm.getVariablesString();

      // Assert
      expect(result).toBe("");
    });
  });

  describe("selectedDate watcher triggers resource fetches", () => {
    let mockSearch: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const searchModule = await import("@/services/search");
      mockSearch = vi.mocked(searchModule.default.search);
      mockSearch.mockResolvedValue({ data: { hits: [] } });
      wrapper = createWrapper();
      mockSearch.mockClear();
    });

    it("calls getTopHeavyResources and getTopSlowResources when selectedDate prop changes", async () => {
      // Arrange
      const newSelectedDate = { startTime: 1234567999, endTime: 1234568999 };

      // Act
      await wrapper.setProps({ selectedDate: newSelectedDate });
      await nextTick();

      // Assert — both getTopHeavyResources and getTopSlowResources call searchService
      expect(mockSearch).toHaveBeenCalled();
    });
  });

  describe("onVariablesManagerReady emit", () => {
    it("emits variablesManagerReady event with the manager payload", async () => {
      // Arrange
      wrapper = createWrapper();
      const mockManager = { refresh: vi.fn() };

      // Act
      wrapper.vm.onVariablesManagerReady(mockManager);
      await nextTick();

      // Assert
      expect(wrapper.emitted("variablesManagerReady")).toBeTruthy();
      expect(wrapper.emitted("variablesManagerReady")?.[0]).toEqual([mockManager]);
    });
  });
});
