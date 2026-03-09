// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import i18n from "@/locales";

// Mock heavy async components
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: { template: '<div data-test="render-dashboard-charts"></div>' },
}));

vi.mock("./TracesMetricsContextMenu.vue", () => ({
  default: { template: '<div data-test="traces-metrics-context-menu"></div>' },
}));

vi.mock("./TracesAnalysisDashboard.vue", () => ({
  default: {
    template: '<div data-test="traces-analysis-dashboard"></div>',
    props: ["streamName", "streamType", "timeRange", "analysisType"],
    emits: ["close"],
  },
}));

const mockMetricsRangeFilters = new Map();
const mockSearchObj = reactive({
  data: {
    stream: {
      selectedStream: { value: "default" },
      selectedStreamFields: [],
      userDefinedSchema: [],
    },
  },
  meta: {
    showHistogram: true,
    showErrorOnly: false,
    metricsRangeFilters: mockMetricsRangeFilters,
  },
});

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: (data: any) => data,
}));

vi.mock("./metrics.json", () => ({
  default: {
    tabs: [
      {
        panels: [
          {
            id: "panel-1",
            title: "Rate",
            queries: [{ query: "SELECT * FROM [STREAM_NAME] [WHERE_CLAUSE]" }],
          },
          {
            id: "panel-2",
            title: "Errors",
            queries: [{ query: "SELECT * FROM [STREAM_NAME] [WHERE_CLAUSE]" }],
          },
          {
            id: "panel-3",
            title: "Duration",
            queries: [{ query: "SELECT * FROM [STREAM_NAME] [WHERE_CLAUSE]" }],
          },
        ],
      },
    ],
  },
}));

vi.mock("@/utils/zincutils", () => ({
  deepCopy: (data: any) => JSON.parse(JSON.stringify(data)),
  formatTimeWithSuffix: (ms: number) => `${ms}ms`,
}));

import TracesMetricsDashboard from "./TracesMetricsDashboard.vue";

installQuasar();

const mockStore = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
  },
});

const defaultProps = {
  streamName: "default",
  timeRange: { startTime: 1000000, endTime: 2000000 },
  show: true,
};

describe("TracesMetricsDashboard", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    mockMetricsRangeFilters.clear();
    mockSearchObj.meta.showHistogram = true;
    vi.clearAllMocks();

    wrapper = mount(TracesMetricsDashboard, {
      props: defaultProps,
      global: {
        plugins: [mockStore, i18n],
        stubs: {
          QSplitter: { template: "<div><slot name='before'/><slot name='after'/></div>" },
          RenderDashboardCharts: {
            template: '<div data-test="render-dashboard-charts"></div>',
          },
          TracesMetricsContextMenu: {
            template: '<div data-test="traces-metrics-context-menu"></div>',
          },
          TracesAnalysisDashboard: {
            template: '<div data-test="traces-analysis-dashboard"></div>',
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the dashboard header when show=true", () => {
      const header = wrapper.find(".dashboard-header");
      expect(header.exists()).toBe(true);
    });

    it("should not render header when show=false", async () => {
      await wrapper.setProps({ show: false });
      const header = wrapper.find(".dashboard-header");
      expect(header.exists()).toBe(false);
    });

    it("should render the insights button", () => {
      const btn = wrapper.find('[data-test="insights-button"]');
      expect(btn.exists()).toBe(true);
    });

    it("should render dashboard charts when show=true and histogram is visible", () => {
      const charts = wrapper.find('[data-test="render-dashboard-charts"]');
      expect(charts.exists()).toBe(true);
    });
  });

  describe("collapse behavior", () => {
    it("should toggle showHistogram when header is clicked", async () => {
      const header = wrapper.find(".dashboard-header");
      await header.trigger("click");
      expect(mockSearchObj.meta.showHistogram).toBe(false);
    });

    it("should re-expand when header is clicked again", async () => {
      const header = wrapper.find(".dashboard-header");
      await header.trigger("click");
      expect(mockSearchObj.meta.showHistogram).toBe(false);
      await header.trigger("click");
      expect(mockSearchObj.meta.showHistogram).toBe(true);
    });
  });

  describe("insights button", () => {
    it("should open analysis dashboard when insights button is clicked", async () => {
      const btn = wrapper.find('[data-test="insights-button"]');
      await btn.trigger("click");
      expect(wrapper.vm.showAnalysisDashboard).toBe(true);
    });

    it("should render TracesAnalysisDashboard when showAnalysisDashboard is true", async () => {
      const btn = wrapper.find('[data-test="insights-button"]');
      await btn.trigger("click");

      const analysisDashboard = wrapper.find(
        '[data-test="traces-analysis-dashboard"]',
      );
      expect(analysisDashboard.exists()).toBe(true);
    });
  });

  describe("emits", () => {
    it("should emit filters-updated on context menu select", async () => {
      // Set up a range filter
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.vm.rangeFiltersVersion++;

      wrapper.vm.emitFiltersToQueryEditor();
      await flushPromises();

      const emitted = wrapper.emitted("filters-updated");
      expect(emitted).toBeTruthy();
    });
  });

  describe("range filter tracking", () => {
    it("should detect duration filter", async () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.vm.rangeFiltersVersion++;
      await flushPromises();

      expect(wrapper.vm.hasDurationFilter).toBe(true);
    });

    it("should detect rate filter", async () => {
      mockMetricsRangeFilters.set("panel-1", {
        panelTitle: "Rate",
        start: 10,
        end: 50,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.vm.rangeFiltersVersion++;
      await flushPromises();

      expect(wrapper.vm.hasRateFilter).toBe(true);
    });

    it("should detect error filter", async () => {
      mockMetricsRangeFilters.set("panel-2", {
        panelTitle: "Errors",
        start: 1,
        end: 10,
        timeStart: null,
        timeEnd: null,
      });
      wrapper.vm.rangeFiltersVersion++;
      await flushPromises();

      expect(wrapper.vm.hasErrorFilter).toBe(true);
    });
  });

  describe("expose API", () => {
    it("should expose refresh method", () => {
      expect(typeof wrapper.vm.refresh).toBe("function");
    });

    it("should expose loadDashboard method", () => {
      expect(typeof wrapper.vm.loadDashboard).toBe("function");
    });

    it("should expose getBaseFilters method", () => {
      expect(typeof wrapper.vm.getBaseFilters).toBe("function");
    });

    it("getBaseFilters should include duration filter when present", () => {
      mockMetricsRangeFilters.set("panel-3", {
        panelTitle: "Duration",
        start: 100,
        end: 500,
        timeStart: null,
        timeEnd: null,
      });
      const filters = wrapper.vm.getBaseFilters();
      expect(filters.some((f: string) => f.includes("duration"))).toBe(true);
    });

    it("getBaseFilters should include span_status filter when showErrorOnly is true", () => {
      mockSearchObj.meta.showErrorOnly = true;
      const filters = wrapper.vm.getBaseFilters();
      expect(filters.some((f: string) => f.includes("span_status"))).toBe(
        true,
      );
      mockSearchObj.meta.showErrorOnly = false;
    });
  });
});
