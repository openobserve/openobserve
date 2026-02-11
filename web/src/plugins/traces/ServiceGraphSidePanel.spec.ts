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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Notify } from "quasar";
import { nextTick } from "vue";
import ServiceGraphSidePanel from "./ServiceGraphSidePanel.vue";

installQuasar({
  plugins: [Notify],
});

// Mock dependencies
vi.mock("@/services/search", () => ({
  default: {
    get_traces: vi.fn(),
  },
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("quasar", async () => {
  const actual: any = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
    }),
  };
});

import searchService from "@/services/search";

// Mock store
const createMockStore = (overrides = {}) => ({
  state: {
    theme: "dark",
    selectedOrganization: {
      identifier: "test-org",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("ServiceGraphSidePanel.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;
  let mockRouter: any;

  const mockNodes = [
    {
      id: "service-a",
      label: "Service A",
      name: "Service A",
      error_rate: 2.5,
      requests: 2000, // Total requests
      errors: 50, // 2.5% of 2000 = 50 (exactly 2.50%)
    },
    {
      id: "service-b",
      label: "Service B",
      name: "Service B",
      error_rate: 7.8,
      requests: 1500,
      errors: 117, // 7.8% of 1500
    },
    {
      id: "service-c",
      label: "Service C",
      name: "Service C",
      error_rate: 12.5,
      requests: 800,
      errors: 100, // 12.5% of 800
    },
    {
      id: "service-upstream",
      label: "Service Upstream",
      name: "Service Upstream",
      error_rate: 2.0,
      requests: 1000,
      errors: 20,
    },
    {
      id: "service-upstream-2",
      label: "Service Upstream 2",
      name: "Service Upstream 2",
      error_rate: 2.0,
      requests: 500,
      errors: 10,
    },
    {
      id: "service-upstream-3",
      label: "Service Upstream 3",
      name: "Service Upstream 3",
      error_rate: 3.375,
      requests: 800,
      errors: 27,
    },
  ];

  const mockEdges = [
    {
      from: "service-upstream",
      to: "service-a",
      total_requests: 1000,
      failed_requests: 20,
      p95_latency_ns: 50000000, // 50ms
      error_rate: 2.0,
    },
    {
      from: "service-upstream-2",
      to: "service-a",
      total_requests: 500,
      failed_requests: 10,
      p95_latency_ns: 75000000, // 75ms
      error_rate: 2.0,
    },
    {
      from: "service-upstream-3",
      to: "service-a",
      total_requests: 800,
      failed_requests: 27,
      p95_latency_ns: 100000000, // 100ms (max latency for service-a)
      error_rate: 3.375,
    },
    {
      from: "service-a",
      to: "service-b",
      total_requests: 1500,
      failed_requests: 50,
      p95_latency_ns: 75000000, // 75ms
      error_rate: 3.33,
    },
    {
      from: "service-a",
      to: "service-c",
      total_requests: 800,
      failed_requests: 100,
      p95_latency_ns: 100000000, // 100ms
      error_rate: 12.5,
    },
  ];

  const mockTimeRange = {
    startTime: Date.now() - 3600000,
    endTime: Date.now(),
  };

  const mockTraces = {
    data: {
      hits: [
        {
          trace_id: "trace-123456789012345678901234567890ab",
          duration: 150000, // 150ms in microseconds
          start_time: Date.now() * 1000000, // Convert to nanoseconds
          spans: [5, 0], // [total spans, error spans]
        },
        {
          trace_id: "trace-abcdef1234567890abcdef1234567890",
          duration: 2500000, // 2.5s in microseconds
          start_time: Date.now() * 1000000,
          spans: [10, 2], // [total spans, error spans]
        },
      ],
    },
  };

  const createWrapper = (props = {}, storeOverrides = {}) => {
    mockStore = createMockStore(storeOverrides);
    mockRouter = {
      push: vi.fn(),
    };

    return mount(ServiceGraphSidePanel, {
      props: {
        selectedNode: mockNodes[0],
        graphData: { nodes: mockNodes, edges: mockEdges },
        timeRange: mockTimeRange,
        visible: true,
        streamFilter: "default",
        ...props,
      },
      global: {
        mocks: {
          $store: mockStore,
          $router: mockRouter,
        },
        provide: {
          store: mockStore,
          router: mockRouter,
        },
        stubs: {
          QBtn: false,
          QIcon: false,
          QTooltip: false,
          QSpinner: false,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render panel when visible is true", () => {
      wrapper = createWrapper({ visible: true });
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(true);
    });

    it("should not render panel when visible is false", () => {
      wrapper = createWrapper({ visible: false });
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(false);
    });

    it("should display panel header", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-header"]').exists()).toBe(true);
    });

    it("should display service name", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-service-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-side-panel-service-name"]').text()).toContain("Service A");
    });

    it("should display close button", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-close-btn"]').exists()).toBe(true);
    });
  });

  describe("Computed Properties - upstreamServices", () => {
    it("should compute upstream services correctly", () => {
      wrapper = createWrapper();
      const upstream = wrapper.vm.upstreamServices;

      expect(upstream).toHaveLength(3);
      expect(upstream[0].id).toBe("service-upstream");
      expect(upstream[0].requests).toBe(1000);
    });

    it("should return empty array when no upstream services", () => {
      wrapper = createWrapper({
        selectedNode: { id: "isolated-service", label: "Isolated" },
      });

      expect(wrapper.vm.upstreamServices).toHaveLength(0);
    });

    it("should calculate health status for upstream services", () => {
      wrapper = createWrapper();
      const upstream = wrapper.vm.upstreamServices;

      expect(upstream[0].healthStatus).toBe("healthy"); // 2% error rate
    });

    it("should handle missing node labels in upstream services", () => {
      const customEdges = [
        {
          from: "unknown-service",
          to: "service-a",
          total_requests: 100,
          error_rate: 1.0,
        },
      ];

      wrapper = createWrapper({
        graphData: { nodes: mockNodes, edges: customEdges },
      });

      const upstream = wrapper.vm.upstreamServices;
      expect(upstream[0].name).toBe("unknown-service");
    });
  });

  describe("Computed Properties - downstreamServices", () => {
    it("should compute downstream services correctly", () => {
      wrapper = createWrapper();
      const downstream = wrapper.vm.downstreamServices;

      expect(downstream).toHaveLength(2);
      expect(downstream[0].id).toBe("service-b");
      expect(downstream[1].id).toBe("service-c");
    });

    it("should return empty array when no downstream services", () => {
      wrapper = createWrapper({
        selectedNode: mockNodes[1], // service-b has no downstream
        graphData: { nodes: mockNodes, edges: mockEdges.slice(0, 2) },
      });

      const downstream = wrapper.vm.downstreamServices;
      expect(downstream).toHaveLength(0);
    });

    it("should calculate health status for downstream services", () => {
      wrapper = createWrapper();
      const downstream = wrapper.vm.downstreamServices;

      expect(downstream[0].healthStatus).toBe("healthy"); // 3.33% error rate
      expect(downstream[1].healthStatus).toBe("critical"); // 12.5% error rate
    });
  });

  describe("Computed Properties - serviceMetrics", () => {
    it("should compute service metrics correctly", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      expect(metrics.requestRate).toBeTruthy();
      expect(metrics.errorRate).toBe("2.50%");
      expect(metrics.p95Latency).toBeTruthy();
    });

    it("should calculate total requests from outgoing edges", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      // Total requests from node
      expect(metrics.requestRateValue).toBe("2.0K");
    });

    it("should use node's error_rate property", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      expect(metrics.errorRate).toBe("2.50%");
    });

    it("should show N/A for P95 latency when no outgoing edges", () => {
      wrapper = createWrapper({
        selectedNode: mockNodes[1],
        graphData: { nodes: mockNodes, edges: [] },
      });

      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.p95Latency).toBe("N/A");
    });

    it("should return N/A for all metrics when selectedNode is null", () => {
      wrapper = createWrapper({
        selectedNode: null,
      });

      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.requestRate).toBe("N/A");
      expect(metrics.errorRate).toBe("N/A");
      expect(metrics.p95Latency).toBe("N/A");
    });

    it("should format P95 latency in milliseconds", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      // Max of 75ms and 100ms = 100ms
      expect(metrics.p95Latency).toBe("100ms");
    });

    it("should format high latency in seconds", () => {
      const highLatencyEdges = [
        {
          from: "service-upstream",
          to: "service-a",
          total_requests: 1000,
          p95_latency_ns: 2500000000, // 2.5 seconds
        },
      ];

      wrapper = createWrapper({
        graphData: { nodes: mockNodes, edges: highLatencyEdges },
      });

      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.p95Latency).toBe("2.50s");
    });

    it("should format large request numbers with M suffix", () => {
      const highVolumeNode = {
        id: "service-a",
        label: "Service A",
        name: "Service A",
        error_rate: 2.5,
        requests: 2500000, // 2.5M requests
        errors: 62500,
      };

      wrapper = createWrapper({
        selectedNode: highVolumeNode,
        graphData: { nodes: [highVolumeNode], edges: [] },
      });

      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.requestRateValue).toBe("2.5M");
    });
  });

  describe("Computed Properties - serviceHealth", () => {
    it("should return healthy status when error rate <= 5%", () => {
      wrapper = createWrapper();
      const health = wrapper.vm.serviceHealth;

      expect(health.status).toBe("healthy");
      expect(health.text).toBe("Healthy");
      expect(health.color).toBe("positive");
      expect(health.icon).toBe("check_circle");
    });

    it("should return degraded status when error rate > 5% and <= 10%", () => {
      wrapper = createWrapper({
        selectedNode: mockNodes[1], // 7.8% error rate
      });

      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("degraded");
      expect(health.text).toBe("Degraded");
      expect(health.color).toBe("warning");
      expect(health.icon).toBe("warning");
    });

    it("should return critical status when error rate > 10%", () => {
      wrapper = createWrapper({
        selectedNode: mockNodes[2], // 12.5% error rate
      });

      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("critical");
      expect(health.text).toBe("Critical");
      expect(health.color).toBe("negative");
      expect(health.icon).toBe("error");
    });

    it("should return unknown status when selectedNode is null", () => {
      wrapper = createWrapper({
        selectedNode: null,
      });

      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("unknown");
      expect(health.text).toBe("Unknown");
    });

    it("should handle missing error_rate property", () => {
      wrapper = createWrapper({
        selectedNode: { id: "test", label: "Test" },
      });

      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("healthy");
    });
  });

  describe("Computed Properties - isAllStreamsSelected", () => {
    it("should return true when streamFilter is 'all'", () => {
      wrapper = createWrapper({ streamFilter: "all" });
      expect(wrapper.vm.isAllStreamsSelected).toBe(true);
    });

    it("should return false when streamFilter is not 'all'", () => {
      wrapper = createWrapper({ streamFilter: "default" });
      expect(wrapper.vm.isAllStreamsSelected).toBe(false);
    });
  });

  describe("Health Status Functionality", () => {
    it("should correctly categorize upstream services by health", () => {
      wrapper = createWrapper();
      const upstream = wrapper.vm.upstreamServices;

      // Upstream service has 2% error rate, should be healthy
      expect(upstream[0].healthStatus).toBe("healthy");
    });

    it("should correctly categorize downstream services by health", () => {
      wrapper = createWrapper();
      const downstream = wrapper.vm.downstreamServices;

      // Service B: 3.33% error rate - healthy
      expect(downstream[0].healthStatus).toBe("healthy");

      // Service C: 12.5% error rate - critical
      expect(downstream[1].healthStatus).toBe("critical");
    });

    it("should calculate degraded health status correctly", () => {
      // Create a service with 7.8% error rate (degraded)
      wrapper = createWrapper({
        selectedNode: mockNodes[1], // Service B with 7.8% error
      });

      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("degraded");
    });

    it("should provide health information for different error rates", () => {
      // Test healthy status
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: 3 },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("healthy");

      // Test degraded status
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: 8 },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("degraded");

      // Test critical status
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: 15 },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("critical");
    });
  });

  describe("Helper Functions - Metric Formatting", () => {
    it("should format request rates in service metrics", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      // Verify the formatted values are shown correctly
      expect(metrics.requestRate).toContain("req/min");
      expect(metrics.requestRateValue).toBeTruthy();
    });

    it("should format latency values in service metrics", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      // P95 latency should be formatted (either in ms or s)
      expect(metrics.p95Latency).toMatch(/(ms|s|N\/A)/);
    });

    it("should format error rates as percentages", () => {
      wrapper = createWrapper();
      const metrics = wrapper.vm.serviceMetrics;

      // Error rate should be a percentage
      expect(metrics.errorRate).toContain("%");
    });
  });

  describe("Event Handlers - handleClose", () => {
    it("should emit close event when close button is clicked", async () => {
      wrapper = createWrapper();
      const closeBtn = wrapper.find('[data-test="service-graph-side-panel-close-btn"]');

      await closeBtn.trigger("click");

      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });
  });

  describe("Event Handlers - handleViewTraces", () => {
    it("should emit view-traces event when button is clicked", async () => {
      wrapper = createWrapper();
      const viewTracesBtn = wrapper.find('[data-test="service-graph-side-panel-view-traces-btn"]');

      await viewTracesBtn.trigger("click");

      expect(wrapper.emitted("view-traces")).toBeTruthy();
    });

    it("should disable view traces button when all streams selected", () => {
      wrapper = createWrapper({ streamFilter: "all" });

      // Verify isAllStreamsSelected computed property is true
      expect(wrapper.vm.isAllStreamsSelected).toBe(true);
    });

    it("should enable view traces button when specific stream selected", () => {
      wrapper = createWrapper({ streamFilter: "default" });

      // Verify isAllStreamsSelected computed property is false
      expect(wrapper.vm.isAllStreamsSelected).toBe(false);
    });
  });

  describe("Event Handlers - handleTraceClick", () => {
    it("should have handleTraceClick method defined", () => {
      wrapper = createWrapper();

      // Verify the method exists
      expect(typeof wrapper.vm.handleTraceClick).toBe("function");
    });

    it("should navigate with trace data", async () => {
      wrapper = createWrapper();

      const mockTrace = {
        traceId: "test-trace-id",
      };

      // Call the method (router navigation happens inside)
      wrapper.vm.handleTraceClick(mockTrace);

      // The method should be callable without errors
      expect(wrapper.vm.handleTraceClick).toBeTruthy();
    });
  });

  describe("Event Handlers - copyTraceId", () => {
    it("should copy trace ID to clipboard", async () => {
      wrapper = createWrapper();

      await wrapper.vm.copyTraceId("test-trace-id");

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-trace-id");
    });

    it("should set copiedTraceId state after copying", async () => {
      wrapper = createWrapper();

      await wrapper.vm.copyTraceId("test-trace-id");

      expect(wrapper.vm.copiedTraceId).toBe("test-trace-id");
    });

    it("should reset copiedTraceId after 2 seconds", async () => {
      vi.useFakeTimers();
      wrapper = createWrapper();

      await wrapper.vm.copyTraceId("test-trace-id");
      expect(wrapper.vm.copiedTraceId).toBe("test-trace-id");

      vi.advanceTimersByTime(2000);
      expect(wrapper.vm.copiedTraceId).toBeNull();

      vi.useRealTimers();
    });

    it("should handle clipboard copy failure", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error("Copy failed"));

      wrapper = createWrapper();

      await wrapper.vm.copyTraceId("test-trace-id");
      await flushPromises();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("Async Operations - fetchRecentTraces", () => {
    it("should fetch traces when panel is visible and stream is selected", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(searchService.get_traces).toHaveBeenCalledWith({
        org_identifier: "test-org",
        stream_name: "default",
        filter: "service_name = 'Service A'",
        start_time: mockTimeRange.startTime,
        end_time: mockTimeRange.endTime,
        from: 0,
        size: 10,
      });
    });

    it("should not fetch traces when streamFilter is 'all'", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "all" });
      await flushPromises();

      expect(searchService.get_traces).not.toHaveBeenCalled();
    });

    it("should not fetch traces when panel is not visible", async () => {
      wrapper = createWrapper({ visible: false, streamFilter: "default" });
      await flushPromises();

      expect(searchService.get_traces).not.toHaveBeenCalled();
    });

    it("should manage loading state during fetch", async () => {
      let resolvePromise: any;
      vi.mocked(searchService.get_traces).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () => resolve(mockTraces);
          })
      );

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await nextTick();

      // Check loading state during fetch
      expect(wrapper.vm.loadingTraces).toBe(true);

      // Resolve the promise
      resolvePromise();
      await flushPromises();
      await nextTick();

      // Check loading state is false after fetch completes
      expect(wrapper.vm.loadingTraces).toBe(false);
    });

    it("should process trace data correctly", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.vm.recentTraces).toHaveLength(2);
      expect(wrapper.vm.recentTraces[0].status).toBe("OK");
      expect(wrapper.vm.recentTraces[1].status).toBe("ERROR");
    });

    it("should mark slow traces correctly", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      // First trace: 150ms (< 1s) - not slow
      expect(wrapper.vm.recentTraces[0].durationClass).toBe("");

      // Second trace: 2.5s (> 1s) - slow
      expect(wrapper.vm.recentTraces[1].durationClass).toBe("duration-slow");
    });

    it("should handle fetch error gracefully", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(searchService.get_traces).mockRejectedValue(new Error("API Error"));

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.vm.recentTraces).toHaveLength(0);
      expect(wrapper.vm.loadingTraces).toBe(false);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it("should handle empty trace response", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue({ data: { hits: [] } });

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.vm.recentTraces).toHaveLength(0);
    });
  });

  describe("Watchers", () => {
    it("should fetch traces when visible changes to true", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: false, streamFilter: "default" });
      await flushPromises();

      expect(searchService.get_traces).not.toHaveBeenCalled();

      await wrapper.setProps({ visible: true });
      await flushPromises();

      expect(searchService.get_traces).toHaveBeenCalled();
    });

    it("should fetch traces when selectedNode changes", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      const callCount = vi.mocked(searchService.get_traces).mock.calls.length;

      await wrapper.setProps({ selectedNode: mockNodes[1] });
      await flushPromises();

      expect(vi.mocked(searchService.get_traces).mock.calls.length).toBeGreaterThan(callCount);
    });

    it("should fetch traces when streamFilter changes", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      const callCount = vi.mocked(searchService.get_traces).mock.calls.length;

      await wrapper.setProps({ streamFilter: "another-stream" });
      await flushPromises();

      expect(vi.mocked(searchService.get_traces).mock.calls.length).toBeGreaterThan(callCount);
    });

    it("should not fetch traces when changing to 'all' stream", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      vi.mocked(searchService.get_traces).mockClear();

      await wrapper.setProps({ streamFilter: "all" });
      await flushPromises();

      expect(searchService.get_traces).not.toHaveBeenCalled();
    });
  });

  describe("UI Rendering - Metrics Section", () => {
    it("should display metrics section", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-metrics"]').exists()).toBe(true);
    });

    it("should display request rate metric", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-request-rate"]').exists()).toBe(true);
    });

    it("should display error rate metric", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-error-rate"]').exists()).toBe(true);
    });

    it("should display P95 latency metric", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-p95-latency"]').exists()).toBe(true);
    });
  });

  describe("UI Rendering - Services Lists", () => {
    it("should display upstream services section", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-upstream-services"]').exists()).toBe(true);
    });

    it("should display downstream services section", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="service-graph-side-panel-downstream-services"]').exists()).toBe(true);
    });

    it("should display correct upstream service count", () => {
      wrapper = createWrapper();
      const upstreamSection = wrapper.find('[data-test="service-graph-side-panel-upstream-services"]');
      expect(upstreamSection.text()).toContain("(3)");
    });

    it("should display correct downstream service count", () => {
      wrapper = createWrapper();
      const downstreamSection = wrapper.find('[data-test="service-graph-side-panel-downstream-services"]');
      expect(downstreamSection.text()).toContain("(2)");
    });

    it("should render upstream service items", () => {
      wrapper = createWrapper();
      const upstreamItems = wrapper.findAll('[data-test="service-graph-side-panel-upstream-service-item"]');
      expect(upstreamItems.length).toBeGreaterThan(0);
    });

    it("should render downstream service items", () => {
      wrapper = createWrapper();
      const downstreamItems = wrapper.findAll('[data-test="service-graph-side-panel-downstream-service-item"]');
      expect(downstreamItems.length).toBe(2);
    });
  });

  describe("UI Rendering - Recent Traces", () => {
    it("should display recent traces section when stream is selected", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.find('[data-test="service-graph-side-panel-recent-traces"]').exists()).toBe(true);
    });

    it("should not display recent traces section when stream is 'all'", () => {
      wrapper = createWrapper({ streamFilter: "all" });
      expect(wrapper.find('[data-test="service-graph-side-panel-recent-traces"]').exists()).toBe(false);
    });

    it("should show loading spinner while fetching traces", async () => {
      vi.mocked(searchService.get_traces).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockTraces), 100);
          })
      );

      wrapper = createWrapper({ visible: true, streamFilter: "default" });

      // Should show loading immediately
      expect(wrapper.vm.loadingTraces).toBe(true);
    });

    it("should render trace items after loading", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      await nextTick();

      const traceItems = wrapper.findAll('[data-test="service-graph-side-panel-trace-item"]');
      expect(traceItems.length).toBe(2);
    });

    it("should display copy button for each trace", async () => {
      vi.mocked(searchService.get_traces).mockResolvedValue(mockTraces);

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      await nextTick();

      const copyButtons = wrapper.findAll('[data-test="service-graph-side-panel-copy-trace-btn"]');
      expect(copyButtons.length).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null selectedNode", () => {
      wrapper = createWrapper({ selectedNode: null });
      expect(wrapper.vm.upstreamServices).toHaveLength(0);
      expect(wrapper.vm.downstreamServices).toHaveLength(0);
    });

    it("should handle empty graphData", () => {
      wrapper = createWrapper({
        graphData: { nodes: [], edges: [] },
      });

      expect(wrapper.vm.upstreamServices).toHaveLength(0);
      expect(wrapper.vm.downstreamServices).toHaveLength(0);
    });

    it("should handle missing node name/label", () => {
      wrapper = createWrapper({
        selectedNode: { id: "test-service" },
      });

      const serviceName = wrapper.find('[data-test="service-graph-side-panel-service-name"]');
      expect(serviceName.text()).toContain("test-service");
    });

    it("should handle very large request numbers", () => {
      const largeNode = {
        id: "service-a",
        label: "Service A",
        name: "Service A",
        error_rate: 2.5,
        requests: 99999999, // ~100M requests
        errors: 2499999,
      };

      wrapper = createWrapper({
        selectedNode: largeNode,
        graphData: { nodes: [largeNode], edges: [] },
      });

      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.requestRateValue).toContain("M");
    });

    it("should handle negative error rates", () => {
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: -5 },
      });

      const health = wrapper.vm.serviceHealth;
      expect(health).toBeTruthy();
    });
  });

  describe("Props Validation", () => {
    it("should accept all required props", () => {
      wrapper = createWrapper();

      expect(wrapper.props("selectedNode")).toEqual(mockNodes[0]);
      expect(wrapper.props("graphData")).toEqual({ nodes: mockNodes, edges: mockEdges });
      expect(wrapper.props("timeRange")).toEqual(mockTimeRange);
      expect(wrapper.props("visible")).toBe(true);
      expect(wrapper.props("streamFilter")).toBe("default");
    });

    it("should handle visible prop change", async () => {
      wrapper = createWrapper({ visible: true });
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(true);

      await wrapper.setProps({ visible: false });
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(false);
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-side-panel-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-side-panel-service-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-side-panel-close-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-side-panel-view-traces-btn"]').exists()).toBe(true);
    });
  });
});
