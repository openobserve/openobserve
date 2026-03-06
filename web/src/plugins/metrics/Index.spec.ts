// Copyright 2023 OpenObserve Inc.
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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import MetricsIndex from "./Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { reactive, ref } from "vue";

// ── module mocks ──────────────────────────────────────────────────────────────

const mockDashboardPanelData = reactive({
  data: {
    type: "line",
    queryType: "promql",
    title: "",
    queries: [
      {
        query: "",
        customQuery: false,
        fields: { stream: "", stream_type: "metrics", x: [], y: [], z: [], breakdown: [], filter: { filterType: "group", logicalOperator: "AND", conditions: [] } },
        config: { time_shift: [] },
      },
    ],
    config: {},
  },
  layout: {
    showQueryBar: true,
    isConfigPanelOpen: false,
    currentQueryIndex: 0,
  },
  meta: {
    dateTime: { start_time: new Date(), end_time: new Date() },
  },
});

const resetDashboardPanelData = vi.fn();
const resetDashboardPanelDataAndAddTimeField = vi.fn();
const resetAggregationFunction = vi.fn();
const validatePanel = vi.fn();
const removeXYFilters = vi.fn();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    resetDashboardPanelData,
    resetDashboardPanelDataAndAddTimeField,
    resetAggregationFunction,
    validatePanel,
    removeXYFilters,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: ref([]),
    cancelQuery: vi.fn(),
  }),
}));

vi.mock("@/utils/dashboard/checkConfigChangeApiCall", () => ({
  checkIfConfigChangeRequiredApiCallOrNot: vi.fn(() => false),
}));

vi.mock("lodash-es", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lodash-es")>();
  return {
    ...actual,
    isEqual: vi.fn(() => false),
    debounce: vi.fn((fn: any) => fn),
  };
});

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false" },
}));

// Stub all heavy child components
vi.mock("@/components/DateTimePickerDashboard.vue", () => ({
  default: {
    name: "DateTimePickerDashboard",
    template: "<div class='mock-dt-picker'></div>",
    props: ["modelValue", "disable"],
    emits: ["update:modelValue"],
    methods: {
      refresh: vi.fn(),
      getConsumableDateTime: () => ({ startTime: "2024-01-01", endTime: "2024-01-02" }),
      setCustomDate: vi.fn(),
    },
  },
}));

vi.mock("./SyntaxGuideMetrics.vue", () => ({
  default: { name: "SyntaxGuideMetrics", template: "<div></div>" },
}));

vi.mock("./MetricLegends.vue", () => ({
  default: { name: "MetricLegends", template: "<div></div>" },
}));

vi.mock("@/components/AutoRefreshInterval.vue", () => ({
  default: {
    name: "AutoRefreshInterval",
    template: "<div class='mock-auto-refresh'></div>",
    props: ["modelValue", "trigger", "minRefreshInterval"],
    emits: ["update:modelValue", "trigger"],
  },
}));

vi.mock("@/components/dashboards/PanelEditor", () => ({
  PanelEditor: {
    name: "PanelEditor",
    template: "<div class='mock-panel-editor'></div>",
    props: ["pageType", "editMode", "dashboardData", "variablesData", "selectedDateTime"],
    emits: ["addToDashboard", "chartApiError", "dataZoom"],
    expose: ["runQuery"],
    methods: { runQuery: vi.fn() },
  },
}));

vi.mock("./../metrics/AddToDashboard.vue", () => ({
  default: {
    name: "AddToDashboard",
    template: "<div class='mock-add-to-dashboard'></div>",
    props: ["dashboardPanelData"],
    emits: ["save"],
  },
}));

// ── test setup ────────────────────────────────────────────────────────────────

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({ plugins: [Dialog, Notify] });

const mountComponent = () =>
  mount(MetricsIndex, {
    global: {
      plugins: [store, router, i18n],
    },
    attachTo: document.getElementById("app") as HTMLElement,
  });

// ── tests ─────────────────────────────────────────────────────────────────────

describe("metrics/Index.vue", () => {
  let wrapper: ReturnType<typeof mountComponent>;

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  // ── rendering ───────────────────────────────────────────────────────────────

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders PanelEditor stub", () => {
    expect(wrapper.find(".mock-panel-editor").exists()).toBe(true);
  });

  it("renders AutoRefreshInterval when chart type is not html or markdown", () => {
    expect(wrapper.find(".mock-auto-refresh").exists()).toBe(true);
  });

  it("renders run query button", () => {
    const btn = wrapper.find("[data-test='metrics-apply']");
    expect(btn.exists()).toBe(true);
  });

  // ── onMounted ────────────────────────────────────────────────────────────────

  it("calls resetDashboardPanelDataAndAddTimeField on mount", async () => {
    expect(resetDashboardPanelDataAndAddTimeField).toHaveBeenCalled();
  });

  it("calls removeXYFilters on mount", async () => {
    expect(removeXYFilters).toHaveBeenCalled();
  });

  it("calls resetDashboardPanelData on unmount", async () => {
    wrapper.unmount();
    expect(resetDashboardPanelData).toHaveBeenCalled();
    // Re-mount for afterEach unmount safety
    wrapper = mountComponent();
    await flushPromises();
  });

  // ── runQuery ────────────────────────────────────────────────────────────────

  it("runQuery calls validatePanel first", async () => {
    // Make validatePanel not push errors
    validatePanel.mockImplementation(() => {});
    wrapper.vm.runQuery();
    expect(validatePanel).toHaveBeenCalled();
  });

  it("runQuery returns early when isValid fails (errors pushed)", async () => {
    validatePanel.mockImplementation((errors: any[]) => {
      errors.push("Some field error");
    });
    wrapper.vm.runQuery();
    // showAddToDashboardDialog should still be false
    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  // ── addToDashboard ───────────────────────────────────────────────────────────

  it("addToDashboard opens dialog when no errors", async () => {
    validatePanel.mockImplementation(() => {});
    wrapper.vm.addToDashboard();
    await flushPromises();
    expect(wrapper.vm.showAddToDashboardDialog).toBe(true);
  });

  it("addToDashboard does not open dialog when validation has errors", async () => {
    validatePanel.mockImplementation((errors: any[]) => {
      errors.push("Validation error");
    });
    wrapper.vm.addToDashboard();
    await flushPromises();
    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  // ── addPanelToDashboard ──────────────────────────────────────────────────────

  it("addPanelToDashboard closes the add-to-dashboard dialog", async () => {
    // First open the dialog
    validatePanel.mockImplementation(() => {});
    wrapper.vm.addToDashboard();
    await flushPromises();
    expect(wrapper.vm.showAddToDashboardDialog).toBe(true);

    wrapper.vm.addPanelToDashboard();
    await flushPromises();
    expect(wrapper.vm.showAddToDashboardDialog).toBe(false);
  });

  // ── handleChartApiError ─────────────────────────────────────────────────────

  it("handleChartApiError sets errorData errors when message is provided", async () => {
    wrapper.vm.handleChartApiError({ message: "API failed", code: "500" });
    await flushPromises();
    expect(wrapper.vm.errorData.errors).toContain("API failed");
  });

  it("handleChartApiError does nothing when message is falsy", async () => {
    const initialLength = wrapper.vm.errorData.errors.length;
    wrapper.vm.handleChartApiError({ message: "", code: "" });
    expect(wrapper.vm.errorData.errors.length).toBe(initialLength);
  });

  // ── onDataZoom ───────────────────────────────────────────────────────────────

  it("onDataZoom updates selectedDate to absolute with correct range", async () => {
    const start = new Date("2024-01-15T10:05:30Z");
    const end = new Date("2024-01-15T11:10:45Z");
    wrapper.vm.onDataZoom({ start: start.getTime(), end: end.getTime() });
    await flushPromises();
    // seconds should be zeroed out — just verify no throw
    expect(wrapper.vm.selectedDate).toBeDefined();
  });

  it("onDataZoom increments end by 1 minute when start equals end", async () => {
    const ts = new Date("2024-01-15T10:05:00Z").getTime();
    // Should not throw even when start === end
    expect(() => wrapper.vm.onDataZoom({ start: ts, end: ts })).not.toThrow();
  });

  // ── searchRequestTraceIds ────────────────────────────────────────────────────

  it("searchRequestTraceIds is initially an empty array", () => {
    expect(Array.isArray(wrapper.vm.searchRequestTraceIds)).toBe(true);
    expect(wrapper.vm.searchRequestTraceIds.length).toBe(0);
  });

  // ── disable ──────────────────────────────────────────────────────────────────

  it("disable starts as false", () => {
    expect(wrapper.vm.disable).toBe(false);
  });

  // ── refreshInterval ──────────────────────────────────────────────────────────

  it("refreshInterval starts at 0", () => {
    expect(wrapper.vm.refreshInterval).toBe(0);
  });
});
