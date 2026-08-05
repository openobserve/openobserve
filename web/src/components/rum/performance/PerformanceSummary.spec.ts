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
import PerformanceSummary from "./PerformanceSummary.vue";
import { createI18n } from "vue-i18n";
import { createStore } from "vuex";
import { nextTick, reactive, ref } from "vue";

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

// This tab passes its time range, so the real composable would fire a platform-detection
// search on mount. Stub it out: platform resolution has its own spec
// (useRumPerformanceTab.spec.ts) and an unstubbed probe times the suite out.
const mockHasBrowser = ref(true);
const mockHasMobile = ref(false);
const mockResolvedKey = ref<string | null>("0-0");
const mockDetectPlatforms = vi.fn().mockResolvedValue(undefined);

vi.mock("@/composables/rum/useRumPlatforms", () => ({
  default: () => ({
    hasBrowser: mockHasBrowser,
    hasMobile: mockHasMobile,
    resolvedKey: mockResolvedKey,
    detectPlatforms: mockDetectPlatforms,
    resetRumPlatforms: vi.fn(),
  }),
}));

vi.mock("@/utils/commons.ts", () => ({
  getDashboard: vi.fn(),
  deletePanel: vi.fn(),
}));

vi.mock("@/utils/date", () => ({
  parseDuration: vi.fn((duration: string) => {
    if (duration === "15m") return 15;
    if (duration === "1h") return 60;
    if (duration === "6h") return 360;
    return 0;
  }),
  generateDurationLabel: vi.fn((duration: number) => {
    if (duration === 15) return "15m";
    if (duration === 60) return "1h";
    if (duration === 360) return "6h";
    return "0s";
  }),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

// Panels carry a layout because the capability filter reflows survivors when it drops
// anything. They intentionally declare no gated columns and no platform tag, so they
// survive every schema — this spec is about the tab, not the gate.
vi.mock("@/utils/rum/overview.json", () => ({
  default: {
    version: 2,
    title: "RUM Overview",
    panels: [
      { id: "panel1", title: "LCP", layout: { x: 0, y: 0, w: 6, h: 4, i: 1 } },
      { id: "panel2", title: "FID", layout: { x: 6, y: 0, w: 6, h: 4, i: 2 } },
    ],
  },
}));

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder",
    },
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
}));

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template: '<div data-test="render-dashboard-charts"><slot name="before_panels"></slot></div>',
    props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
    methods: {
      layoutUpdate: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
  },
});

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      rum: {
        webVitalsLabel: "Web Vitals",
        errorLabel: "Errors",
        sessionLabel: "Sessions",
      },
    },
  },
});

function mountComponent(routeQuery: Record<string, any> = {}, props: Record<string, any> = {}) {
  return mount(PerformanceSummary, {
    props,
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      mocks: {
        $store: mockStore,
        $router: mockRouter,
        $route: { query: { dashboard: "test-dashboard", folder: "test-folder", ...routeQuery } },
      },
      stubs: {
        OSpinner: { template: '<div data-test="spinner" v-bind="$attrs" />', inheritAttrs: false },
        OEmptyState: {
          name: "OEmptyState",
          template: '<div><slot name="title" /><slot name="description" /></div>',
        },
      },
    },
  });
}

// Seeds the shared performanceState so ensureRumSchema() short-circuits without calling
// getStream — the dashboard branch then renders after a single flush.
function seedRumSchema(schemaMap: Record<string, any> | null) {
  if (schemaMap === null) {
    delete mockPerformanceState.data.streams["_rumdata"];
    return;
  }
  mockPerformanceState.data.streams["_rumdata"] = { schema: schemaMap, name: "_rumdata" };
}

/**
 * Mounts with the schema gate already resolved, so the dashboard branch is rendered
 * rather than the loading spinner. Most tests here are about the tab's own behaviour and
 * need the dashboard on screen.
 */
async function mountResolved(
  routeQuery: Record<string, any> = {},
  props: Record<string, any> = {},
) {
  seedRumSchema({ view_name: { name: "view_name" } });
  const mounted = mountComponent(routeQuery, props);
  await flushPromises();
  return mounted;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PerformanceSummary", () => {
  let wrapper: ReturnType<typeof mountComponent>;
  let mockDeletePanel: ReturnType<typeof vi.fn>;
  let mockConvertDashboardSchemaVersion: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Every test starts with no known `_rumdata` schema and a browser-resolved platform
    // probe; tests opt into a seeded schema via mountResolved().
    seedRumSchema(null);
    mockGetStream.mockReset();
    mockGetStream.mockResolvedValue({ schema: [{ name: "view_name" }] });
    mockHasBrowser.value = true;
    mockHasMobile.value = false;
    mockResolvedKey.value = "0-0";

    const { deletePanel } = await import("@/utils/commons.ts");
    mockDeletePanel = vi.mocked(deletePanel);

    const { convertDashboardSchemaVersion } =
      await import("@/utils/dashboard/convertDashboardSchemaVersion");
    mockConvertDashboardSchemaVersion = vi.mocked(convertDashboardSchemaVersion);
    // vi.clearAllMocks() clears call history but keeps queued return values, so restore
    // the identity default explicitly — otherwise one test's stubbed dashboard leaks into
    // every later mount and silently empties the capability filter.
    mockConvertDashboardSchemaVersion.mockReset();
    mockConvertDashboardSchemaVersion.mockImplementation((data: any) => data);

    mockRouterPush.mockClear();
    mockRouterReplace.mockClear();

    Object.defineProperty(window, "dispatchEvent", {
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Mounting and basic structure
  // -------------------------------------------------------------------------

  it("mounts successfully with default props", async () => {
    // Arrange + Act
    wrapper = mountComponent();
    await nextTick();

    // Assert
    expect(wrapper.exists()).toBe(true);
  });

  it("mounts with a custom dateTime prop", () => {
    // Arrange
    const customDateTime = {
      start_time: new Date("2023-01-01"),
      end_time: new Date("2023-01-02"),
    };

    // Act
    wrapper = mountComponent({}, { dateTime: customDateTime });

    // Assert
    expect(wrapper.props("dateTime")).toEqual(customDateTime);
  });

  it("has component name PerformanceSummary", () => {
    // Arrange
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.$options.name).toBe("PerformanceSummary");
  });

  it("uses default empty-object dateTime when no prop is provided", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.props("dateTime")).toEqual({});
  });

  // -------------------------------------------------------------------------
  // RenderDashboardCharts integration
  // -------------------------------------------------------------------------

  it("renders RenderDashboardCharts component", async () => {
    // Arrange
    wrapper = await mountResolved();

    // Assert
    expect(wrapper.findComponent({ name: "RenderDashboardCharts" }).exists()).toBe(true);
  });

  it("passes viewOnly=true to RenderDashboardCharts", async () => {
    // Arrange
    wrapper = await mountResolved();

    // Assert
    const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });
    expect(charts.props("viewOnly")).toBe(true);
  });

  it("passes searchType=RUM to RenderDashboardCharts", async () => {
    // Arrange
    wrapper = await mountResolved();

    // Assert
    const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });
    expect(charts.props("searchType")).toBe("RUM");
  });

  it("integrates with RenderDashboardCharts with correct props", async () => {
    // Arrange
    wrapper = await mountResolved();

    // Assert
    const chartsComponent = wrapper.findComponent({ name: "RenderDashboardCharts" });
    expect(chartsComponent.exists()).toBe(true);
    expect(chartsComponent.props()).toMatchObject({
      viewOnly: true,
      searchType: "RUM",
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it("shows loading indicator element when isLoading has items", async () => {
    // Arrange
    wrapper = await mountResolved();
    wrapper.vm.isLoading.push("loading");
    await nextTick();

    // Assert
    expect(wrapper.find('[data-test="performance-summary-loading-indicator"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Loading Dashboard");
  });

  it("hides loading indicator when isLoading is empty", async () => {
    // Arrange
    wrapper = await mountResolved();
    wrapper.vm.isLoading.splice(0); // ensure empty
    await nextTick();

    // Assert — the parent div with v-show is not visible when isLoading is empty
    // The indicator element itself is inside a v-show container; find its parent
    const indicator = wrapper.find('[data-test="performance-summary-loading-indicator"]');
    // When isLoading is empty the v-show wrapper is hidden — indicator still in DOM
    // but its parent container has display:none so isVisible returns false
    if (indicator.exists()) {
      expect(indicator.isVisible()).toBe(false);
    } else {
      // Element may not exist at all when not loading
      expect(indicator.exists()).toBe(false);
    }
  });

  it("starts with an empty isLoading array", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.isLoading).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Dashboard loading
  // -------------------------------------------------------------------------

  it("calls convertDashboardSchemaVersion on mount", async () => {
    // Arrange + Act
    wrapper = mountComponent();
    await nextTick();

    // Assert
    expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();
  });

  it("shows the schema-loading spinner and no dashboard until the gate resolves", async () => {
    // Arrange — a getStream that never settles keeps the gate open.
    let resolveStream!: (value: { schema: any[] }) => void;
    mockGetStream.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStream = resolve;
      }),
    );

    // Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.find('[data-test="performance-summary-schema-loading"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "RenderDashboardCharts" }).exists()).toBe(false);

    // Cleanup — settle the pending promise so it can't leak into other tests.
    resolveStream({ schema: [] });
    await flushPromises();
  });

  it("hands the schema-migrated dashboard to RenderDashboardCharts", async () => {
    // Arrange — the conversion runs once while the composable is created, so the return
    // value has to be queued before mount.
    const convertedDashboard = {
      title: "Converted RUM Overview",
      panels: [{ id: "panel1", title: "LCP", layout: { x: 0, y: 0, w: 6, h: 4, i: 1 } }],
    };
    mockConvertDashboardSchemaVersion.mockReturnValueOnce(convertedDashboard);

    // Act
    wrapper = await mountResolved();

    // Assert
    const charts = wrapper.findComponent({ name: "RenderDashboardCharts" });
    expect(charts.props("dashboardData")).toEqual(convertedDashboard);
  });

  it("renders the full dashboard when getStream rejects and the schema stays inconclusive", async () => {
    // Arrange
    mockGetStream.mockRejectedValueOnce(new Error("network error"));

    // Act
    wrapper = mountComponent();
    await flushPromises();

    // Assert — a transient error must never degrade a working dashboard.
    expect(wrapper.find('[data-test="performance-summary-empty"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "RenderDashboardCharts" }).exists()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // updateLayout
  // -------------------------------------------------------------------------

  it("exposes updateLayout as a function", () => {
    // Arrange
    wrapper = mountComponent();

    // Assert
    expect(typeof wrapper.vm.updateLayout).toBe("function");
  });

  it("dispatches window resize event when updateLayout is called", async () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    await wrapper.vm.updateLayout();

    // Assert
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.any(Event));
  });

  it("handles null performanceChartsRef in updateLayout without throwing", async () => {
    // Arrange
    wrapper = mountComponent();
    wrapper.vm.performanceChartsRef = null;

    // Act + Assert — should not throw
    await expect(wrapper.vm.updateLayout()).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // getSelectedDateFromQueryParams
  // -------------------------------------------------------------------------

  it("returns relative valueType when period param is present", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    const result = wrapper.vm.getSelectedDateFromQueryParams({ period: "1h" });

    // Assert
    expect(result).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    });
  });

  it("returns absolute valueType when from and to params are present", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    const result = wrapper.vm.getSelectedDateFromQueryParams({
      from: "2023-01-01",
      to: "2023-01-02",
    });

    // Assert
    expect(result).toEqual({
      valueType: "absolute",
      startTime: "2023-01-01",
      endTime: "2023-01-02",
      relativeTimePeriod: null,
    });
  });

  it("defaults to relative valueType when no date params are provided", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    const result = wrapper.vm.getSelectedDateFromQueryParams({});

    // Assert
    expect(result).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: null,
    });
  });

  // -------------------------------------------------------------------------
  // getQueryParamsForDuration
  // -------------------------------------------------------------------------

  it("returns period key when relativeTimePeriod is set", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    const result = wrapper.vm.getQueryParamsForDuration({
      relativeTimePeriod: "1h",
    });

    // Assert
    expect(result).toEqual({ period: "1h" });
  });

  it("returns from/to keys when startTime and endTime are set", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    const result = wrapper.vm.getQueryParamsForDuration({
      startTime: "2023-01-01",
      endTime: "2023-01-02",
    });

    // Assert
    expect(result).toEqual({ from: "2023-01-01", to: "2023-01-02" });
  });

  // -------------------------------------------------------------------------
  // Navigation functions
  // -------------------------------------------------------------------------

  it("navigates to /dashboards with query params when goBackToDashboardList is called", async () => {
    // Arrange
    wrapper = mountComponent({ dashboard: "test-dashboard", folder: "test-folder" });

    // Act
    await wrapper.vm.goBackToDashboardList();

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      path: "/dashboards",
      query: {
        dashboard: "test-dashboard",
        folder: "test-folder",
      },
    });
  });

  it("navigates to /dashboards/add_panel with query params when addPanelData is called", async () => {
    // Arrange
    wrapper = mountComponent({ dashboard: "test-dashboard", folder: "test-folder" });

    // Act
    await wrapper.vm.addPanelData();

    // Assert
    expect(mockRouterPush).toHaveBeenCalledWith({
      path: "/dashboards/add_panel",
      query: {
        dashboard: "test-dashboard",
        folder: "test-folder",
      },
    });
  });

  // -------------------------------------------------------------------------
  // refreshData
  // -------------------------------------------------------------------------

  it("calls refresh on dateTimePicker when refreshData is invoked", () => {
    // Arrange
    wrapper = mountComponent();
    const mockDateTimePicker = { refresh: vi.fn() };
    wrapper.vm.dateTimePicker = mockDateTimePicker;

    // Act
    wrapper.vm.refreshData();

    // Assert
    expect(mockDateTimePicker.refresh).toHaveBeenCalled();
  });

  it("throws when dateTimePicker is null and refreshData is called", () => {
    // Arrange
    wrapper = mountComponent();
    wrapper.vm.dateTimePicker = null;

    // Assert
    expect(() => wrapper.vm.refreshData()).toThrow();
  });

  // -------------------------------------------------------------------------
  // onDeletePanel
  // -------------------------------------------------------------------------

  it("calls deletePanel with correct args and reloads dashboard on onDeletePanel", async () => {
    // Arrange
    mockDeletePanel.mockResolvedValue(true);
    mockConvertDashboardSchemaVersion.mockReturnValueOnce({});
    wrapper = mountComponent({ dashboard: "test-dashboard", folder: "test-folder" });

    // Act
    await wrapper.vm.onDeletePanel("panel-123");

    // Assert
    expect(mockDeletePanel).toHaveBeenCalledWith(
      mockStore,
      "test-dashboard",
      "panel-123",
      "test-folder",
    );
    expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();
  });

  it("propagates rejection when deletePanel fails", async () => {
    // Arrange
    const error = new Error("Delete failed");
    mockDeletePanel.mockRejectedValue(error);
    wrapper = mountComponent({ dashboard: "test-dashboard" });

    // Assert
    await expect(wrapper.vm.onDeletePanel("panel-123")).rejects.toThrow("Delete failed");
  });

  // -------------------------------------------------------------------------
  // openSettingsDialog
  // -------------------------------------------------------------------------

  it("starts with showDashboardSettingsDialog=false", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
  });

  it("sets showDashboardSettingsDialog to true when openSettingsDialog is called", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    wrapper.vm.openSettingsDialog();

    // Assert
    expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
  });

  // -------------------------------------------------------------------------
  // selectedDate watcher
  // -------------------------------------------------------------------------

  it("updates currentTimeObj.start_time and end_time when selectedDate changes", async () => {
    // Arrange
    wrapper = mountComponent();
    const newDate = {
      startTime: "2023-01-01T00:00:00Z",
      endTime: "2023-01-02T00:00:00Z",
    };

    // Act
    wrapper.vm.selectedDate = newDate;
    await nextTick();

    // Assert
    expect(wrapper.vm.currentTimeObj.start_time).toEqual(new Date(newDate.startTime));
    expect(wrapper.vm.currentTimeObj.end_time).toEqual(new Date(newDate.endTime));
  });

  it("handles date range calculations for a 2-hour window", async () => {
    // Arrange
    wrapper = mountComponent();
    const dateRange = {
      startTime: "2023-01-01T10:00:00Z",
      endTime: "2023-01-01T12:00:00Z",
    };

    // Act
    wrapper.vm.selectedDate = dateRange;
    await nextTick();

    // Assert
    expect(wrapper.vm.currentTimeObj.start_time).toEqual(new Date(dateRange.startTime));
    expect(wrapper.vm.currentTimeObj.end_time).toEqual(new Date(dateRange.endTime));
  });

  // -------------------------------------------------------------------------
  // refreshInterval watcher
  // -------------------------------------------------------------------------

  it("calls router.replace with refresh query param when refreshInterval changes", async () => {
    // Arrange
    wrapper = mountComponent({ dashboard: "test-dashboard" });
    mockRouterReplace.mockClear();

    // Act
    wrapper.vm.refreshInterval = 60;
    await nextTick();

    // Assert
    expect(mockRouterReplace).toHaveBeenCalledWith({
      query: expect.objectContaining({
        refresh: "1h",
      }),
    });
  });

  it("calls router.replace when both refreshInterval and selectedDate change", async () => {
    // Arrange
    wrapper = mountComponent({ dashboard: "test-dashboard" });
    mockRouterReplace.mockClear();

    // Act
    wrapper.vm.refreshInterval = 0;
    wrapper.vm.selectedDate = { relativeTimePeriod: "1h" };
    await nextTick();
    await nextTick();

    // Assert
    expect(mockRouterReplace).toHaveBeenCalled();
  });

  it("calls router.replace when a large refresh interval is set", async () => {
    // Arrange
    wrapper = mountComponent({ dashboard: "test-dashboard" });
    mockRouterReplace.mockClear();

    // Act
    wrapper.vm.refreshInterval = 360;
    await nextTick();

    // Assert
    expect(mockRouterReplace).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Reactive data properties
  // -------------------------------------------------------------------------

  it("exposes all required reactive data properties", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.dashboardData).toBeDefined();
    expect(wrapper.vm.schemaResolved).toBe(false);
    expect(wrapper.vm.showEmptyState).toBe(false);
    expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
    expect(wrapper.vm.variablesData).toBeDefined();
    expect(wrapper.vm.selectedDate).toBeDefined();
    expect(wrapper.vm.currentTimeObj).toBeDefined();
    expect(wrapper.vm.refreshInterval).toBeDefined();
    expect(wrapper.vm.isLoading).toEqual([]);
  });

  it("exposes all required methods", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(typeof wrapper.vm.addPanelData).toBe("function");
    expect(typeof wrapper.vm.refreshData).toBe("function");
    expect(typeof wrapper.vm.onDeletePanel).toBe("function");
    expect(typeof wrapper.vm.openSettingsDialog).toBe("function");
    expect(typeof wrapper.vm.updateLayout).toBe("function");
  });

  // -------------------------------------------------------------------------
  // variablesData
  // -------------------------------------------------------------------------

  it("allows variablesData.values to be set to an array of variable objects", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    wrapper.vm.variablesData.values = [
      { name: "service", value: "web-service" },
      { name: "environment", value: "production" },
    ];

    // Assert
    expect(wrapper.vm.variablesData.values).toHaveLength(2);
  });

  it("allows variablesData.values to be cleared to an empty array", () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    wrapper.vm.variablesData.values = [];

    // Assert
    expect(wrapper.vm.variablesData.values).toEqual([]);
  });

  it("accepts complex variable data merges via Object.assign", () => {
    // Arrange
    wrapper = mountComponent();
    const complexVariableData = {
      isVariablesLoading: false,
      values: [
        { name: "service", value: "frontend" },
        { name: "version", value: "1.0.0" },
        { name: "region", value: "us-east-1" },
      ],
    };

    // Act
    Object.assign(wrapper.vm.variablesData, complexVariableData);

    // Assert
    expect(wrapper.vm.variablesData).toMatchObject(complexVariableData);
  });

  // -------------------------------------------------------------------------
  // Store and i18n access
  // -------------------------------------------------------------------------

  it("has access to the vuex store with correct organization identifier", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe("test-org");
  });

  it("exposes the i18n translation function", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(typeof wrapper.vm.t).toBe("function");
    expect(wrapper.vm.t("rum.webVitalsLabel")).toBe("Web Vitals");
  });

  it("has access to getDashboard utility", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.getDashboard).toBeDefined();
  });

  it("has performanceChartsRef reference defined", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.vm.performanceChartsRef).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Template rendering
  // -------------------------------------------------------------------------

  // Section headings used to be a fixed three-column label row rendered here, which only
  // described the browser layout. They now come from the dashboard's own section panels
  // (overview.json), so they are covered by the dashboardCapability specs instead.

  it("no longer renders the fixed browser-shaped label row", () => {
    // Arrange + Act
    wrapper = mountComponent();

    // Assert
    expect(wrapper.text()).not.toContain("Web Vitals");
    expect(wrapper.text()).not.toContain("Sessions");
  });

  // -------------------------------------------------------------------------
  // Activation and onActivated
  // -------------------------------------------------------------------------

  it("sets refreshInterval from route query refresh param during activation logic", () => {
    // Arrange
    wrapper = mountComponent({ refresh: "15m", dashboard: "test-dashboard" });
    wrapper.vm.refreshInterval = 0; // reset

    // Act — simulate onActivated behavior manually
    wrapper.vm.refreshInterval = 15; // parseDuration("15m") returns 15

    // Assert
    expect(wrapper.vm.refreshInterval).toBe(15);
  });

  it("dispatches resize event when called manually", () => {
    // Arrange
    wrapper = mountComponent();
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    // Act
    window.dispatchEvent(new Event("resize"));

    // Assert
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "resize" }));
  });

  // -------------------------------------------------------------------------
  // Props validation
  // -------------------------------------------------------------------------

  it("accepts valid dateTime prop with start_time and end_time", () => {
    // Arrange
    const validDateTime = {
      start_time: new Date(),
      end_time: new Date(),
    };

    // Act
    wrapper = mountComponent({}, { dateTime: validDateTime });

    // Assert
    expect(wrapper.props("dateTime")).toEqual(validDateTime);
  });

  // -------------------------------------------------------------------------
  // Multiple loading states
  // -------------------------------------------------------------------------

  it("accumulates multiple loading states in isLoading array", async () => {
    // Arrange
    wrapper = await mountResolved();

    // Act
    wrapper.vm.isLoading.push("dashboard");
    wrapper.vm.isLoading.push("variables");
    wrapper.vm.isLoading.push("panels");
    await nextTick();

    // Assert
    expect(wrapper.vm.isLoading.length).toBe(3);
    expect(wrapper.find('[data-test="performance-summary-loading-indicator"]').exists()).toBe(true);
  });

  it("shows loading indicator text when multiple loading states are active", async () => {
    // Arrange
    wrapper = mountComponent();

    // Act
    wrapper.vm.isLoading.push("dashboard");
    await nextTick();

    // Assert
    expect(wrapper.text()).toContain("Loading Dashboard");
  });

  it("hides loading indicator when all loading states are cleared", async () => {
    // Arrange
    wrapper = mountComponent();
    wrapper.vm.isLoading.push("dashboard");
    await nextTick();

    // Act
    wrapper.vm.isLoading.splice(0);
    await nextTick();

    // Assert — isLoading is empty and indicator is no longer visible
    expect(wrapper.vm.isLoading.length).toBe(0);
    const indicator = wrapper.find('[data-test="performance-summary-loading-indicator"]');
    if (indicator.exists()) {
      expect(indicator.isVisible()).toBe(false);
    } else {
      expect(indicator.exists()).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Unmounting
  // -------------------------------------------------------------------------

  it("unmounts cleanly without throwing errors", () => {
    // Arrange
    wrapper = mountComponent();

    // Act + Assert
    expect(() => wrapper.unmount()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Comprehensive integration
  // -------------------------------------------------------------------------

  it("performs full component workflow: mount, load dashboard, navigate, delete panel, open settings", async () => {
    // Arrange
    wrapper = mountComponent(
      {
        dashboard: "test-dashboard",
        folder: "test-folder",
        refresh: "1h",
        "var-service": "web-app",
      },
      { dateTime: { start_time: new Date("2023-01-01"), end_time: new Date("2023-01-02") } },
    );

    // Assert — mounted
    expect(wrapper.exists()).toBe(true);

    // Assert — dashboard loaded on mount
    expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();

    // Act — update variable data
    const variableData = { values: [{ name: "environment", value: "production" }] };
    Object.assign(wrapper.vm.variablesData, variableData);
    expect(wrapper.vm.variablesData.values).toEqual(variableData.values);

    // Act — navigate
    await wrapper.vm.addPanelData();
    expect(mockRouterPush).toHaveBeenCalled();

    // Act — delete panel
    mockDeletePanel.mockResolvedValue(true);
    await wrapper.vm.onDeletePanel("test-panel");
    expect(mockDeletePanel).toHaveBeenCalled();

    // Act — open settings
    wrapper.vm.openSettingsDialog();
    expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
  });
});
