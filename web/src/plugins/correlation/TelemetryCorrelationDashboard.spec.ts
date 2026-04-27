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
import { createI18n } from "vue-i18n";
import { Quasar, Notify } from "quasar";
import TelemetryCorrelationDashboard from "./TelemetryCorrelationDashboard.vue";
import store from "@/test/unit/helpers/store";
import { nextTick } from "vue";

const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCancelStreamQueryBasedOnRequestId = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
  }),
}));

// Mock composables
vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({
    showErrorNotification: vi.fn(),
    showSuccessNotification: vi.fn(),
  })),
}));

vi.mock("@/composables/useTraces", () => ({
  default: vi.fn(() => ({
    formatTracesMetaData: vi.fn((traces: any[]) => traces),
  })),
}));

vi.mock("@/composables/useMetricsCorrelationDashboard", () => ({
  useMetricsCorrelationDashboard: vi.fn(() => ({
    generateDashboard: vi.fn(() => ({ title: "Test Dashboard", panels: [] })),
    generateLogsDashboard: vi.fn(() => ({ title: "Logs Dashboard", panels: [] })),
  })),
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: vi.fn(() => ({
    semanticGroups: { value: [] },
    loadSemanticGroups: vi.fn(),
  })),
}));

vi.mock("@/utils/metrics/metricGrouping", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    groupMetricsByCategory: vi.fn((streams: any[]) => {
      const infraStreams = streams.slice(0, 2);
      return {
        byGroup: { infra: infraStreams, network: [], others: [] },
        groups: [
          { id: "infra", label: "Infrastructure", icon: "computer", streams: infraStreams },
          { id: "network", label: "Network", icon: "network_check", streams: [] },
          { id: "others", label: "Others", icon: "category", streams: [] },
        ],
      };
    }),
  };
});

vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(() =>
      Promise.resolve({ data: { list: [] } })
    ),
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(() =>
      Promise.resolve({ data: { hits: [], total: 0, took: 0 } })
    ),
    get_traces: vi.fn(() =>
      Promise.resolve({ data: { hits: [], total: 0 } })
    ),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    b64EncodeUnicode: vi.fn((str: string) => btoa(str)),
  };
});

vi.mock("@/utils/dashboard/constants", () => ({
  SELECT_ALL_VALUE: "*",
}));

// Stub heavy child components
vi.mock("@/plugins/traces/TraceDetails.vue", () => ({
  default: { name: "TraceDetails", template: "<div data-test='trace-details'></div>" },
}));

vi.mock("@/plugins/traces/components/TracesSearchResultList.vue", () => ({
  default: {
    name: "TracesSearchResultList",
    template: "<div data-test='traces-search-result-list'></div>",
  },
}));

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template: "<div data-test='render-dashboard-charts'></div>",
  },
}));

const mockTranslations = {
  "correlation.filters": "Filters",
  "correlation.all": "All",
  "correlation.loadingLogs": "Loading logs...",
  "correlation.loadingMetrics": "Loading metrics...",
  "correlation.loadingTraces": "Loading traces...",
  "correlation.noLogsFound": "No logs found",
  "correlation.noLogsDescription": "No matching logs",
  "correlation.noMetrics": "No metrics",
  "correlation.noMetricsDescription": "No matching metrics",
  "correlation.noTracesFound": "No traces found",
  "correlation.noTracesDescription": "No matching traces",
  "correlation.correlatedTraces": "Correlated Traces",
  "correlation.correlatedTracesFor": "Correlated traces for {service}",
  "correlation.metricsError": "Metrics Error",
  "correlation.metricsErrorDetails": "Failed to load metrics",
  "correlation.tracesError": "Traces Error",
  "correlation.tracesErrorDetails": "Failed to load traces",
  "correlation.retryButton": "Retry",
  "correlation.dimensionBasedCorrelation": "Dimension-based correlation",
  "correlation.tracesFromService": "Traces from {service}",
  "correlation.viewInTraces": "View in Traces",
  "correlation.selectMetrics": "Select Metrics",
  "common.logs": "Logs",
  "common.apply": "Apply",
  "common.refresh": "Refresh",
  "search.metrics": "Metrics",
  "search.searchField": "Search",
  "search.noResult": "No results",
  "menu.traces": "Traces",
};

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: mockTranslations },
});

const SOURCE_TS = 1704110400000000;
const FIVE_MIN_US = 5 * 60 * 1000 * 1000;

const mockMetricStreams = [
  { stream_name: "cpu_usage", stream_type: "metrics", filters: { service: "api" } },
  { stream_name: "memory_usage", stream_type: "metrics", filters: { service: "api" } },
  { stream_name: "disk_io", stream_type: "metrics", filters: { service: "api" } },
];

describe("TelemetryCorrelationDashboard.vue", () => {
  let wrapper: any;

  const defaultProps = {
    serviceName: "my-service",
    matchedDimensions: { service: "api", env: "prod" },
    additionalDimensions: { pod_id: "pod-123" },
    metricStreams: mockMetricStreams,
    logStreams: [{ stream_name: "default", stream_type: "logs", filters: {} }],
    traceStreams: [{ stream_name: "traces", stream_type: "traces", filters: {} }],
    timeRange: {
      startTime: SOURCE_TS - FIVE_MIN_US,
      endTime: SOURCE_TS + FIVE_MIN_US,
    },
    mode: "embedded-tabs" as const,
    externalActiveTab: "logs",
  };

  const createWrapper = (props = {}) => {
    return mount(TelemetryCorrelationDashboard, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [
          [Quasar, { plugins: { Notify } }],
          i18n,
          store,
        ],
        stubs: {
          TraceDetails: true,
          TracesSearchResultList: true,
          RenderDashboardCharts: true,
          DimensionFiltersBar: true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Mounting", () => {
    it("should mount successfully in embedded-tabs mode", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully in dialog mode", () => {
      wrapper = createWrapper({ mode: "dialog" });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("isEmbeddedTabs computed", () => {
    it("should be true when mode is embedded-tabs", () => {
      wrapper = createWrapper({ mode: "embedded-tabs" });
      expect(wrapper.vm.isEmbeddedTabs).toBe(true);
    });

    it("should be false when mode is dialog", () => {
      wrapper = createWrapper({ mode: "dialog" });
      expect(wrapper.vm.isEmbeddedTabs).toBe(false);
    });
  });

  describe("activeTab control", () => {
    it("should use externalActiveTab when in embedded-tabs mode", () => {
      wrapper = createWrapper({
        mode: "embedded-tabs",
        externalActiveTab: "metrics",
      });
      expect(wrapper.vm.activeTab).toBe("metrics");
    });

    it("should use internal tab when in dialog mode", () => {
      wrapper = createWrapper({ mode: "dialog" });
      expect(wrapper.vm.activeTab).toBe("logs");
    });

    it("should update activeTab when externalActiveTab changes in embedded mode", async () => {
      wrapper = createWrapper({
        mode: "embedded-tabs",
        externalActiveTab: "logs",
      });

      await wrapper.setProps({ externalActiveTab: "traces" });
      await nextTick();

      expect(wrapper.vm.activeTab).toBe("traces");
    });
  });

  describe("hasPendingChanges computed", () => {
    it("should be false when pendingDimensions matches activeDimensions", () => {
      wrapper = createWrapper();
      // Initially they match
      expect(wrapper.vm.hasPendingChanges).toBe(false);
    });

    it("should be true when pendingDimensions differs from activeDimensions", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingDimensions = { service: "new-service", env: "dev", pod_id: "pod-456" };
      await nextTick();
      expect(wrapper.vm.hasPendingChanges).toBe(true);
    });

    it("should be false after applyDimensionChanges syncs pending to active", async () => {
      wrapper = createWrapper();
      wrapper.vm.pendingDimensions = { service: "new-service", env: "dev" };
      await nextTick();

      expect(wrapper.vm.hasPendingChanges).toBe(true);

      // After apply, activeDimensions should equal pendingDimensions
      wrapper.vm.activeDimensions = { ...wrapper.vm.pendingDimensions };
      await nextTick();

      expect(wrapper.vm.hasPendingChanges).toBe(false);
    });
  });

  describe("unstableDimensionKeys computed", () => {
    it("should contain keys from additionalDimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.unstableDimensionKeys.has("pod_id")).toBe(true);
    });

    it("should not contain keys from matchedDimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.unstableDimensionKeys.has("service")).toBe(false);
      expect(wrapper.vm.unstableDimensionKeys.has("env")).toBe(false);
    });

    it("should be empty when no additionalDimensions provided", () => {
      wrapper = createWrapper({ additionalDimensions: {} });
      expect(wrapper.vm.unstableDimensionKeys.size).toBe(0);
    });
  });

  describe("getDimensionOptions", () => {
    it("should always include wildcard (SELECT_ALL_VALUE) option", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getDimensionOptions("service", "api");
      expect(options.some((o: any) => o.value === "*")).toBe(true);
    });

    it("should include original value in options", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getDimensionOptions("service", "api");
      expect(options.some((o: any) => o.value === "api")).toBe(true);
    });

    it("should include current value if different from original", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getDimensionOptions("service", "new-api");
      expect(options.some((o: any) => o.value === "new-api")).toBe(true);
    });

    it("should not duplicate values", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getDimensionOptions("service", "api");
      const values = options.map((o: any) => o.value);
      const uniqueValues = new Set(values);
      expect(values.length).toBe(uniqueValues.size);
    });

    it("should label unstable dimension original value with (current)", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.getDimensionOptions("pod_id", "pod-123");
      const originalOption = options.find((o: any) => o.value === "pod-123");
      expect(originalOption?.label).toContain("current");
    });
  });

  describe("handleDimensionUpdate", () => {
    it("should update pendingDimensions with new value", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleDimensionUpdate({ key: "service", value: "new-api" });
      await nextTick();

      expect(wrapper.vm.pendingDimensions.service).toBe("new-api");
    });

    it("should trigger hasPendingChanges to become true", async () => {
      wrapper = createWrapper();

      wrapper.vm.handleDimensionUpdate({ key: "service", value: "different-service" });
      await nextTick();

      expect(wrapper.vm.hasPendingChanges).toBe(true);
    });

    it("should not change activeDimensions", async () => {
      wrapper = createWrapper();
      const originalActive = { ...wrapper.vm.activeDimensions };

      wrapper.vm.handleDimensionUpdate({ key: "service", value: "new-api" });
      await nextTick();

      expect(wrapper.vm.activeDimensions.service).toBe(originalActive.service);
    });
  });

  describe("getUniqueStreams", () => {
    it("should return unique streams by stream_name", () => {
      wrapper = createWrapper();
      const streams = [
        { stream_name: "cpu", stream_type: "metrics", filters: {} },
        { stream_name: "cpu", stream_type: "metrics", filters: {} }, // duplicate
        { stream_name: "memory", stream_type: "metrics", filters: {} },
      ];
      const result = wrapper.vm.getUniqueStreams(streams);
      expect(result.length).toBe(2);
    });

    it("should preserve first occurrence for duplicates", () => {
      wrapper = createWrapper();
      const streams = [
        { stream_name: "cpu", stream_type: "metrics", filters: { a: "1" } },
        { stream_name: "cpu", stream_type: "metrics", filters: { a: "2" } },
      ];
      const result = wrapper.vm.getUniqueStreams(streams);
      expect(result[0].filters.a).toBe("1");
    });

    it("should handle empty array", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getUniqueStreams([]);
      expect(result).toEqual([]);
    });
  });

  describe("toggleMetricStream", () => {
    it("should add stream to selectedMetricStreams when not already selected", async () => {
      wrapper = createWrapper({ metricStreams: [] });
      const stream = { stream_name: "new_metric", stream_type: "metrics", filters: {} };

      const initialCount = wrapper.vm.selectedMetricStreams.length;
      wrapper.vm.selectedMetricStreams = [];
      wrapper.vm.toggleMetricStream(stream);
      await nextTick();

      expect(wrapper.vm.selectedMetricStreams.some((s: any) => s.stream_name === "new_metric")).toBe(true);
    });

    it("should remove stream when already selected", async () => {
      wrapper = createWrapper();
      const streamName = mockMetricStreams[0].stream_name;

      // Ensure stream is selected first
      wrapper.vm.selectedMetricStreams = [...mockMetricStreams.slice(0, 1)];
      wrapper.vm.toggleMetricStream(mockMetricStreams[0]);
      await nextTick();

      expect(wrapper.vm.selectedMetricStreams.some((s: any) => s.stream_name === streamName)).toBe(false);
    });
  });

  describe("toggleGroupCollapse", () => {
    it("should add group to collapsedGroups when not collapsed", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.collapsedGroups.has("infra")).toBe(false);

      wrapper.vm.toggleGroupCollapse("infra");
      await nextTick();

      expect(wrapper.vm.collapsedGroups.has("infra")).toBe(true);
    });

    it("should remove group from collapsedGroups when already collapsed", async () => {
      wrapper = createWrapper();
      wrapper.vm.collapsedGroups = new Set(["infra"]);

      wrapper.vm.toggleGroupCollapse("infra");
      await nextTick();

      expect(wrapper.vm.collapsedGroups.has("infra")).toBe(false);
    });
  });

  describe("formatTimeRange", () => {
    it("should return a formatted string", () => {
      wrapper = createWrapper();
      const range = {
        startTime: SOURCE_TS - FIVE_MIN_US,
        endTime: SOURCE_TS + FIVE_MIN_US,
      };
      const result = wrapper.vm.formatTimeRange(range);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include duration in minutes", () => {
      wrapper = createWrapper();
      const range = {
        startTime: SOURCE_TS - FIVE_MIN_US,
        endTime: SOURCE_TS + FIVE_MIN_US,
      };
      const result = wrapper.vm.formatTimeRange(range);
      expect(result).toContain("min");
    });

    it("should include time range separator", () => {
      wrapper = createWrapper();
      const range = {
        startTime: SOURCE_TS - FIVE_MIN_US,
        endTime: SOURCE_TS + FIVE_MIN_US,
      };
      const result = wrapper.vm.formatTimeRange(range);
      expect(result).toContain(" - ");
    });
  });

  describe("onClose", () => {
    it("should emit close event", async () => {
      wrapper = createWrapper({ mode: "dialog" });

      wrapper.vm.onClose();
      await nextTick();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should set isOpen to false in dialog mode", async () => {
      wrapper = createWrapper({ mode: "dialog" });
      wrapper.vm.isOpen = true;

      wrapper.vm.onClose();
      await nextTick();

      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should reset initialLoadCompleted flag", async () => {
      wrapper = createWrapper({ mode: "dialog" });
      wrapper.vm.initialLoadCompleted = true;

      wrapper.vm.onClose();
      await nextTick();

      expect(wrapper.vm.initialLoadCompleted).toBe(false);
    });
  });

  describe("Initial state", () => {
    it("should initialize pendingDimensions with matched and additional dimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pendingDimensions.service).toBe("api");
      expect(wrapper.vm.pendingDimensions.env).toBe("prod");
      expect(wrapper.vm.pendingDimensions.pod_id).toBe("pod-123");
    });

    it("should initialize activeDimensions with merged dimensions", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeDimensions.service).toBe("api");
      expect(wrapper.vm.activeDimensions.pod_id).toBe("pod-123");
    });

    it("should initialize splitterModel at 25", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.splitterModel).toBe(25);
    });

    it("should initialize collapsedGroups as empty Set", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.collapsedGroups).toBeInstanceOf(Set);
      expect(wrapper.vm.collapsedGroups.size).toBe(0);
    });
  });

  describe("uniqueMetricStreams computed", () => {
    it("should return unique streams from metricStreams prop", () => {
      const streamsWithDuplicates = [
        ...mockMetricStreams,
        mockMetricStreams[0], // duplicate
      ];
      wrapper = createWrapper({ metricStreams: streamsWithDuplicates });
      expect(wrapper.vm.uniqueMetricStreams.length).toBe(mockMetricStreams.length);
    });
  });

  describe("currentTimeObj computed", () => {
    it("should create __global time object from timeRange", () => {
      wrapper = createWrapper();
      const timeObj = wrapper.vm.currentTimeObj;
      expect(timeObj.__global).toBeDefined();
      expect(timeObj.__global.start_time).toBeInstanceOf(Date);
      expect(timeObj.__global.end_time).toBeInstanceOf(Date);
    });
  });

  describe("fetchTracesByDimensions", () => {
    beforeEach(() => {
      mockFetchQueryDataWithHttpStream.mockReset();
      mockCancelStreamQueryBasedOnRequestId.mockReset();
    });

    it("should return empty array when traceStreams is empty", async () => {
      wrapper = createWrapper({ traceStreams: [] });
      const result = await wrapper.vm.fetchTracesByDimensions();
      expect(result).toEqual([]);
    });

    it("should call fetchQueryDataWithHttpStream with correct stream params", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        handlers.complete();
      });

      wrapper = createWrapper({
        traceStreams: [{ stream_name: "traces", stream_type: "traces", filters: { service: "api" } }],
      });

      await wrapper.vm.fetchTracesByDimensions();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledOnce();
      const callArg = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
      expect(callArg.queryReq.stream_name).toBe("traces");
      expect(callArg.queryReq.start_time).toBe(defaultProps.timeRange.startTime);
      expect(callArg.queryReq.end_time).toBe(defaultProps.timeRange.endTime);
      expect(callArg.type).toBe("traces");
    });

    it("should build filter string from traceStream filters", async () => {
      mockFetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        handlers.complete();
      });

      wrapper = createWrapper({
        traceStreams: [{ stream_name: "traces", stream_type: "traces", filters: { service: "api", env: "prod" } }],
      });

      await wrapper.vm.fetchTracesByDimensions();

      const callArg = mockFetchQueryDataWithHttpStream.mock.calls[0][0];
      expect(callArg.queryReq.filter).toContain("service='api'");
      expect(callArg.queryReq.filter).toContain("env='prod'");
    });

    it("should accumulate and return hits from streaming data callback", async () => {
      const mockHit = { traceId: "abc123", trace_id: "abc123" };
      mockFetchQueryDataWithHttpStream.mockImplementation((_payload: any, handlers: any) => {
        handlers.data(_payload, { content: { results: { hits: [mockHit] } } });
        handlers.complete();
      });

      wrapper = createWrapper({
        traceStreams: [{ stream_name: "traces", stream_type: "traces", filters: {} }],
      });

      const result = await wrapper.vm.fetchTracesByDimensions();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it("should cancel in-flight stream before starting a new one", async () => {
      // First call never completes (simulates in-flight)
      mockFetchQueryDataWithHttpStream.mockImplementationOnce(() => {
        // no-op: never calls complete/error
      });
      mockFetchQueryDataWithHttpStream.mockImplementationOnce((_payload: any, handlers: any) => {
        handlers.complete();
      });

      wrapper = createWrapper({
        traceStreams: [{ stream_name: "traces", stream_type: "traces", filters: {} }],
      });

      // First call — sets currentTracesStreamTraceId
      wrapper.vm.fetchTracesByDimensions();
      // Second call — should cancel first before starting
      await wrapper.vm.fetchTracesByDimensions();

      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledOnce();
    });
  });
});
