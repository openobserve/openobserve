import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import WebVitalsDashboard from "./WebVitalsDashboard.vue";

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

vi.mock("@/utils/rum/web_vitals.json", () => ({
  default: { title: "Web Vitals Dashboard", panels: [], variables: { list: [] } },
}));

vi.mock("../../../utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

vi.mock("@/utils/commons.ts", () => ({
  getConsumableDateTime: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/utils/date", () => ({
  parseDuration: vi.fn(),
  generateDurationLabel: vi.fn(),
  getDurationObjectFromParams: vi.fn(),
  getQueryParamsForDuration: vi.fn(),
}));

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
  useRoute: () => ({
    query: { dashboard: "test-dashboard", folder: "test-folder", org_identifier: "test-org" },
  }),
}));

const mockStore = {
  state: { selectedOrganization: { identifier: "test-org" }, theme: "light" },
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      rum: { learnWebVitalsLabel: "Learn about Web Vitals", clickHereLabel: "Click here" },
    },
  },
});

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
};

function createWrapper(props: Record<string, any> = {}) {
  return mount(WebVitalsDashboard, {
    props: { ...defaultProps, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        RenderDashboardCharts: {
          name: "RenderDashboardCharts",
          template: '<div data-test="render-dashboard-charts"><slot /></div>',
          props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
          emits: ["variablesManagerReady"],
          setup() { return { layoutUpdate: vi.fn() }; },
        },
        OSpinner: { template: '<div data-test="spinner" />' },
        OIcon: { name: "OIcon", template: '<span data-test="o-icon" />', props: ["name", "size"] },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebVitalsDashboard", () => {
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

    it("accepts dateTime prop correctly", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.$props.dateTime).toEqual(defaultProps.dateTime);
    });

    it("accepts custom dateTime prop", () => {
      // Arrange
      const custom = { startTime: 1609459200, endTime: 1609545600, relativeTimePeriod: "1h", valueType: "absolute" };

      // Act
      wrapper = createWrapper({ dateTime: custom });

      // Assert
      expect(wrapper.vm.$props.dateTime).toEqual(custom);
    });

    it("initializes viewOnly as true", () => {
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

    it("initializes currentDashboardData with a data property", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.vm.currentDashboardData).toBeTruthy();
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
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

    it("renders the performance-dashboard container", () => {
      // Act
      const container = wrapper.find(".performance-dashboard");

      // Assert
      expect(container.exists()).toBe(true);
    });

    it("renders the learn-web-vitals-link section", () => {
      // Act
      const section = wrapper.find('[data-test="learn-web-vitals-link"]');

      // Assert
      expect(section.exists()).toBe(true);
    });

    it("renders the external link to web.dev", () => {
      // Act
      const link = wrapper.find('a[href="https://web.dev/articles/vitals"]');

      // Assert
      expect(link.exists()).toBe(true);
    });

    it("renders the web.dev link with target _blank", () => {
      // Act
      const link = wrapper.find('a[href="https://web.dev/articles/vitals"]');

      // Assert
      expect(link.attributes("target")).toBe("_blank");
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

    it("sets currentDashboardData.data after mount", () => {
      // Assert
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
    });
  });

  describe("router navigation", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("exposes goBackToDashboardList as a function", () => {
      // Assert
      expect(typeof wrapper.vm.goBackToDashboardList).toBe("function");
    });

    it("navigates to /dashboards when goBackToDashboardList is called", () => {
      // Act
      wrapper.vm.goBackToDashboardList();

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        path: "/dashboards",
        query: { dashboard: "test-dashboard", folder: "test-folder" },
      });
    });

    it("exposes addPanelData as a function", () => {
      // Assert
      expect(typeof wrapper.vm.addPanelData).toBe("function");
    });

    it("navigates to /dashboards/add_panel when addPanelData is called", () => {
      // Act
      wrapper.vm.addPanelData();

      // Assert
      expect(mockRouterPush).toHaveBeenCalledWith({
        path: "/dashboards/add_panel",
        query: { dashboard: "test-dashboard", folder: "test-folder" },
      });
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
    it("onVariablesManagerReady does not throw", () => {
      // Arrange
      wrapper = createWrapper();

      // Act + Assert
      expect(() => wrapper.vm.onVariablesManagerReady({ test: "manager" })).not.toThrow();
    });
  });

  describe("filter functionality", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("filters rows by name containing search term (case-insensitive)", () => {
      // Arrange
      const rows = [
        { name: "Dashboard One" },
        { name: "Dashboard Two" },
        { name: "Report One" },
        { name: "DASHBOARD THREE" },
      ];

      // Act
      const result = wrapper.vm.filterData(rows, "dashboard");

      // Assert
      expect(result).toHaveLength(3);
    });

    it("returns empty array when no matches found", () => {
      // Arrange
      const rows = [{ name: "Dashboard One" }, { name: "Dashboard Two" }];

      // Act
      const result = wrapper.vm.filterData(rows, "report");

      // Assert
      expect(result).toHaveLength(0);
    });

    it("returns all rows when search term is empty string", () => {
      // Arrange
      const rows = [{ name: "Dashboard One" }, { name: "Dashboard Two" }];

      // Act
      const result = wrapper.vm.filterData(rows, "");

      // Assert
      expect(result).toHaveLength(2);
    });

    it("matches case-insensitively", () => {
      // Arrange
      const rows = [{ name: "DASHBOARD ONE" }, { name: "dashboard two" }];

      // Act
      const result = wrapper.vm.filterData(rows, "DashBoard");

      // Assert
      expect(result).toHaveLength(2);
    });
  });

  describe("onDataZoom emit", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("emits update:dateTime when onDataZoom is called with an event", async () => {
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
      const zoomEvent = { startTime: "2023-01-01T00:00:00Z", endTime: "2023-01-02T00:00:00Z" };

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

  describe("i18n label rendering", () => {
    it("renders the learnWebVitalsLabel text from i18n", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.text()).toContain("Learn about Web Vitals");
    });

    it("renders the clickHereLabel text from i18n", () => {
      // Arrange + Act
      wrapper = createWrapper();

      // Assert
      expect(wrapper.text()).toContain("Click here");
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
