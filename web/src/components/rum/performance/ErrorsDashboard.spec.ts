import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import ErrorsDashboard from "./ErrorsDashboard.vue";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template: '<div data-test="render-dashboard-charts"><slot /></div>',
    props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
    emits: ["variablesManagerReady"],
    setup() { return { layoutUpdate: vi.fn() }; },
  },
}));

vi.mock("@/utils/rum/errors.json", () => ({
  default: { title: "RUM Errors Dashboard", panels: [], variables: { list: [] } },
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
          setup() { return { layoutUpdate: vi.fn() }; },
        },
        OSpinner: { template: '<div data-test="spinner" />' },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ErrorsDashboard", () => {
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

    it("initializes currentDashboardData with a data property", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.currentDashboardData).toBeTruthy();
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
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
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("renders the performance-error-dashboard container", () => {
      // Act
      const container = wrapper.find(".performance-error-dashboard");

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

    it("populates currentDashboardData.data after loadDashboard is called", async () => {
      // Act
      await wrapper.vm.loadDashboard();

      // Assert
      expect(wrapper.vm.currentDashboardData.data).toBeTruthy();
    });

    it("calls convertDashboardSchemaVersion during loadDashboard", async () => {
      // Arrange
      const convertModule = await import("../../../utils/dashboard/convertDashboardSchemaVersion");
      const mockConvert = vi.mocked(convertModule.convertDashboardSchemaVersion);

      // Act
      await wrapper.vm.loadDashboard();

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
