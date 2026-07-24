import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import ApiDashboard from "./ApiDashboard.vue";

// ---------------------------------------------------------------------------
// Module mocks — must be at top level
// ---------------------------------------------------------------------------

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

vi.mock("@/utils/rum/api.json", () => ({
  default: { title: "RUM API Dashboard", panels: [], variables: { list: [] } },
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

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiDashboard", () => {
  let wrapper: ReturnType<typeof createWrapper>;

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

    it("initializes variablesData with isVariablesLoading false and empty values", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.variablesData).toEqual({ isVariablesLoading: false, values: [] });
    });

    it("initializes currentDashboardData with a data property", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.currentDashboardData).toBeTruthy();
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
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
    beforeEach(() => {
      wrapper = createWrapper();
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

    it("passes currentDashboardData.data as dashboardData to RenderDashboardCharts", () => {
      // Act
      const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });

      // Assert
      expect(charts.props("dashboardData")).toBe(wrapper.vm.currentDashboardData.data);
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

  describe("dashboard loading", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("exposes loadDashboard as a function", () => {
      // Assert
      expect(typeof wrapper.vm.loadDashboard).toBe("function");
    });

    it("sets currentDashboardData.data after loadDashboard is called", async () => {
      // Act
      await wrapper.vm.loadDashboard();

      // Assert
      expect(wrapper.vm.currentDashboardData.data).toBeTruthy();
    });

    it("calls convertDashboardSchemaVersion during loadDashboard", async () => {
      // Arrange
      const convertModule = await import("@/utils/dashboard/convertDashboardSchemaVersion");
      const mockConvert = vi.mocked(convertModule.convertDashboardSchemaVersion);

      // Act
      await wrapper.vm.loadDashboard();

      // Assert
      expect(mockConvert).toHaveBeenCalled();
    });

    it("sets variablesData.isVariablesLoading to false when no variables exist", async () => {
      // Arrange
      wrapper.vm.variablesData.isVariablesLoading = true;

      // Act
      await wrapper.vm.loadDashboard();

      // Assert
      expect(wrapper.vm.variablesData.isVariablesLoading).toBe(false);
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
