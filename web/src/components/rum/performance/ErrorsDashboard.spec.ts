import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick, reactive } from "vue";
import ErrorsDashboard from "./ErrorsDashboard.vue";

// ---------------------------------------------------------------------------
// Module mocks
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
// references a gated crash column so it survives a crash-capable schema and is dropped by
// a stream that has never recorded one.
vi.mock("@/utils/rum/errors.json", () => ({
  default: {
    title: "RUM Errors Dashboard",
    panels: [
      {
        id: "crash-panel",
        title: "Crashes",
        layout: { x: 0, y: 0, w: 12, h: 4, i: 1 },
        queries: [{ query: 'SELECT count(*) FROM "_rumdata" WHERE error_is_crash = true' }],
      },
    ],
    variables: { list: [] },
  },
}));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

vi.mock("../../../utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

const mockStore = {
  state: { selectedOrganization: { identifier: "test-org" } },
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  dateTime: {
    startTime: 1234567890,
    endTime: 1234568000,
    relativeTimePeriod: "15m",
    valueType: "relative",
  },
  selectedDate: {
    startDate: "2023-01-01",
    endDate: "2023-01-02",
  },
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(ErrorsDashboard, {
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

// Columns the mocked errors dashboard gates on.
const ERROR_FIELDS = ["error_is_crash", "error_category"];

function buildSchemaMap(fieldNames: string[]): Record<string, any> {
  const schemaMap: Record<string, any> = {};
  fieldNames.forEach((name) => {
    schemaMap[name] = { name };
  });
  return schemaMap;
}

const errorSchemaMap = buildSchemaMap(ERROR_FIELDS);

// Seeds the shared performanceState so ensureRumSchema() short-circuits without calling
// getStream — the dashboard branch then renders after a single flush.
function seedRumSchema(schemaMap: Record<string, any> | null) {
  if (schemaMap === null) {
    delete mockPerformanceState.data.streams["_rumdata"];
    return;
  }
  mockPerformanceState.data.streams["_rumdata"] = { schema: schemaMap, name: "_rumdata" };
}

/** Mounts with a resolved, crash-capable schema so the dashboard branch is rendered. */
async function createResolvedWrapper(props: Record<string, any> = {}) {
  seedRumSchema(errorSchemaMap);
  const mounted = createWrapper(props);
  await flushPromises();
  return mounted;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorsDashboard", () => {
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

    it("initializes viewOnly as true", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.viewOnly).toBe(true);
    });

    it("initializes errorsByView as empty array", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.errorsByView).toEqual([]);
    });

    it("initializes isLoading as empty array", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.isLoading).toEqual([]);
    });

    it("exposes the capability-filtered dashboard as dashboardData", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.dashboardData).toMatchObject({ title: "RUM Errors Dashboard" });
    });

    it("initializes variablesData ref", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.variablesData).toBeDefined();
    });

    it("handles empty dateTime prop gracefully", () => {
      // Arrange + Act
      wrapper = createWrapper({ dateTime: {} });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("template rendering", () => {
    beforeEach(async () => {
      // A known crash-capable schema resolves the gate without calling getStream, so the
      // dashboard branch (not the spinner or the empty state) renders.
      wrapper = await createResolvedWrapper();
    });

    it("renders the performance-error-dashboard container", () => {
      // Act
      const container = wrapper.find('[data-test="performance-error-dashboard"]');

      // Assert
      expect(container.exists()).toBe(true);
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
    it("resolves the schema gate after mount so the dashboard renders", async () => {
      // Act
      wrapper = await createResolvedWrapper();

      // Assert
      expect(wrapper.vm.schemaResolved).toBe(true);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
    });

    it("renders the empty state when the resolved schema lacks the gated error columns", async () => {
      // Arrange — a stream that has never recorded a crash.
      mockGetStream.mockResolvedValueOnce({
        schema: [{ name: "view_name" }, { name: "session_id" }],
      });

      // Act
      wrapper = createWrapper();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="errors-dashboard-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(false);
    });

    it("renders the full dashboard when getStream rejects and the schema stays inconclusive", async () => {
      // Arrange
      mockGetStream.mockRejectedValueOnce(new Error("network error"));

      // Act
      wrapper = createWrapper();
      await flushPromises();

      // Assert — a transient error must never degrade a working dashboard.
      expect(wrapper.find('[data-test="errors-dashboard-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="render-dashboard-charts"]').exists()).toBe(true);
    });

    it("migrates the dashboard schema while setting up", async () => {
      // Arrange
      const convertModule = await import("../../../utils/dashboard/convertDashboardSchemaVersion");
      const mockConvert = vi.mocked(convertModule.convertDashboardSchemaVersion);

      // Act
      wrapper = await createResolvedWrapper();

      // Assert
      expect(mockConvert).toHaveBeenCalled();
    });
  });

  describe("variables management", () => {
    it("variablesData is defined and has isVariablesLoading property", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.variablesData).toHaveProperty("isVariablesLoading");
    });

    it("variablesData is defined and has values property", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.variablesData).toHaveProperty("values");
    });

    it("allows direct modification of variablesData", () => {
      // Arrange
      wrapper = createWrapper();
      const newData = { isVariablesLoading: false, values: ["test"] };

      // Act
      wrapper.vm.variablesData = newData;

      // Assert
      expect(wrapper.vm.variablesData).toEqual(newData);
    });
  });

  describe("settings management", () => {
    it("starts with showDashboardSettingsDialog as false", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
    });

    it("sets showDashboardSettingsDialog to true when addSettingsData is called", () => {
      // Arrange
      wrapper = createWrapper();

      // Act
      wrapper.vm.addSettingsData();

      // Assert
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
    });
  });

  describe("onDataZoom emit", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("emits update:dateTime when onDataZoom is called", async () => {
      // Arrange
      const zoomEvent = { start: 1000, end: 2000 };

      // Act
      wrapper.vm.onDataZoom(zoomEvent);
      await nextTick();

      // Assert
      expect(wrapper.emitted("update:dateTime")).toBeTruthy();
      expect(wrapper.emitted("update:dateTime")?.[0]).toEqual([zoomEvent]);
    });

    it("passes the zoom event payload as-is to the update:dateTime emit", async () => {
      // Arrange
      const zoomEvent = { startTime: "2023-01-01", endTime: "2023-01-02" };

      // Act
      wrapper.vm.onDataZoom(zoomEvent);
      await nextTick();

      // Assert
      expect(wrapper.emitted("update:dateTime")?.[0][0]).toEqual(zoomEvent);
    });
  });

  describe("onVariablesManagerReady emit", () => {
    it("emits variablesManagerReady with the manager payload", async () => {
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

  describe("columns definition", () => {
    it("exposes columns array", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(Array.isArray(wrapper.vm.columns)).toBe(true);
    });

    it("columns array contains url field", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      const urlCol = wrapper.vm.columns.find((c: any) => c.name === "url");
      expect(urlCol).toBeDefined();
    });

    it("columns array contains error_count field", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      const errorCol = wrapper.vm.columns.find((c: any) => c.name === "error_count");
      expect(errorCol).toBeDefined();
    });
  });

  describe("updateLayout", () => {
    beforeEach(() => {
      wrapper = createWrapper();
      Object.defineProperty(window, "dispatchEvent", { value: vi.fn(), writable: true });
    });

    it("exposes updateLayout as a function", () => {
      // Assert
      expect(typeof wrapper.vm.updateLayout).toBe("function");
    });

    it("dispatches resize event when updateLayout is called", async () => {
      // Act
      await wrapper.vm.updateLayout();

      // Assert
      expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
    });
  });

  describe("store access", () => {
    it("has access to the store with correct organization identifier", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test-org");
    });
  });
});
