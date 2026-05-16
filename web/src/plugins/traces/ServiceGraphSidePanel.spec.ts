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
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Notify],
});

// vi.mock calls are hoisted — must appear before imports of mocked modules
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/services/service_streams", () => ({
  correlate: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
      dialog: vi.fn(),
    }),
  };
});

import searchService from "@/services/search";
import ServiceGraphSidePanel from "./ServiceGraphNodeSidePanel.vue";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const mockNodes = [
  {
    id: "service-a",
    label: "Service A",
    name: "Service A",
    error_rate: 2.5,
    requests: 2000,
    errors: 50, // 50/2000 = 2.50%
  },
  {
    id: "service-b",
    label: "Service B",
    name: "Service B",
    error_rate: 7.8,
    requests: 1500,
    errors: 117,
  },
  {
    id: "service-c",
    label: "Service C",
    name: "Service C",
    error_rate: 12.5,
    requests: 800,
    errors: 100,
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
    p95_latency_ns: 100000000, // 100ms — max latency for service-a
    error_rate: 3.375,
  },
  {
    from: "service-a",
    to: "service-b",
    total_requests: 1500,
    failed_requests: 50,
    p95_latency_ns: 75000000,
    error_rate: 3.33,
  },
  {
    from: "service-a",
    to: "service-c",
    total_requests: 800,
    failed_requests: 100,
    p95_latency_ns: 100000000,
    error_rate: 12.5,
  },
];

const mockTimeRange = {
  startTime: 1700000000000,
  endTime: 1700003600000,
};

// Mock response for searchService.search (operations)
const mockSearchResponse = {
  data: {
    hits: [
      {
        operation_name: "/api/orders",
        request_count: 500,
        error_count: 10,
        p50_latency: 12000,
        p75_latency: 18000,
        p95_latency: 25000,
        p99_latency: 40000,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

// ODrawer stub — renders slots inline so internal data-test selectors are
// queryable (real ODrawer teleports its content to <body> via DialogPortal,
// which puts it outside the test wrapper's element tree).
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "width",
    "seamless",
    "portalTarget",
    "title",
    "subTitle",
    "size",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      v-if="open"
      :data-test="$attrs['data-test'] || 'o-drawer-stub'"
      :data-title="title"
    >
      <div class="o-drawer-stub-header">
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
        <button
          type="button"
          data-test="o-drawer-close-btn"
          @click="$emit('update:open', false)"
        >Close</button>
      </div>
      <div class="o-drawer-stub-body"><slot /></div>
      <div class="o-drawer-stub-footer"><slot name="footer" /></div>
    </div>
  `,
};

function createWrapper(props: Record<string, unknown> = {}) {
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
      plugins: [store],
      stubs: {
        RenderDashboardCharts: { template: "<div />" },
        TenstackTable: { template: "<div />" },
        TelemetryCorrelationDashboard: { template: "<div />" },
        ODrawer: ODrawerStub,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ServiceGraphSidePanel.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(searchService.search).mockResolvedValue(mockSearchResponse);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render panel when visible is true", () => {
      wrapper = createWrapper({ visible: true });
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(true);
    });

    it("should not render panel when visible is false", () => {
      wrapper = createWrapper({ visible: false });
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(false);
    });

    it("should pass the service name as the drawer title", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("Service A");
    });

    it("should display close button", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="o-drawer-close-btn"]').exists(),
      ).toBe(true);
    });

    it("should display view-related button", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-view-related-btn"]')
          .exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Computed - serviceMetrics
  // -------------------------------------------------------------------------

  describe("Computed Properties - serviceMetrics", () => {
    it("should compute error rate as percentage from node errors/requests", () => {
      wrapper = createWrapper();
      // 50 errors / 2000 requests = 2.50%
      expect(wrapper.vm.serviceMetrics.errorRate).toBe("2.50%");
    });

    it("should format request count with K suffix for thousands", () => {
      wrapper = createWrapper();
      // 2000 → "2.0K"
      expect(wrapper.vm.serviceMetrics.requestRateValue).toBe("2.0K");
    });

    it("should format request count with M suffix for millions", () => {
      const highVolumeNode = {
        ...mockNodes[0],
        requests: 2500000,
        errors: 62500,
      };
      wrapper = createWrapper({
        selectedNode: highVolumeNode,
        graphData: { nodes: [highVolumeNode], edges: [] },
      });
      expect(wrapper.vm.serviceMetrics.requestRateValue).toBe("2.5M");
    });

    it("should include req/min unit in requestRate", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.serviceMetrics.requestRate).toContain("req/min");
    });

    it("should compute P95 latency from max of incoming edges", () => {
      wrapper = createWrapper();
      // Incoming edges to service-a have p95: 50ms, 75ms, 100ms → max = 100ms
      expect(wrapper.vm.serviceMetrics.p95Latency).toBe("100ms");
    });

    it("should format high P95 latency in seconds", () => {
      const highLatencyEdges = [
        {
          from: "service-upstream",
          to: "service-a",
          total_requests: 1000,
          p95_latency_ns: 2500000000, // 2.5s
        },
      ];
      wrapper = createWrapper({
        graphData: { nodes: mockNodes, edges: highLatencyEdges },
      });
      expect(wrapper.vm.serviceMetrics.p95Latency).toBe("2.50s");
    });

    it("should return N/A for P95 latency when there are no incoming edges", () => {
      wrapper = createWrapper({
        selectedNode: mockNodes[1],
        graphData: { nodes: mockNodes, edges: [] },
      });
      expect(wrapper.vm.serviceMetrics.p95Latency).toBe("N/A");
    });

    it("should return N/A for all metrics when selectedNode is null", () => {
      wrapper = createWrapper({ selectedNode: null });
      const metrics = wrapper.vm.serviceMetrics;
      expect(metrics.requestRate).toBe("N/A");
      expect(metrics.errorRate).toBe("N/A");
      expect(metrics.p95Latency).toBe("N/A");
    });

    it("should format error rate as a percentage string", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.serviceMetrics.errorRate).toContain("%");
    });

    it("should handle large request numbers that format with M suffix", () => {
      const largeNode = {
        id: "service-a",
        label: "Service A",
        name: "Service A",
        error_rate: 2.5,
        requests: 99999999,
        errors: 2499999,
      };
      wrapper = createWrapper({
        selectedNode: largeNode,
        graphData: { nodes: [largeNode], edges: [] },
      });
      expect(wrapper.vm.serviceMetrics.requestRateValue).toContain("M");
    });
  });

  // -------------------------------------------------------------------------
  // Computed - serviceHealth
  // -------------------------------------------------------------------------

  describe("Computed Properties - serviceHealth", () => {
    it("should return healthy status when error_rate <= 5%", () => {
      wrapper = createWrapper(); // service-a: error_rate = 2.5
      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("healthy");
      expect(health.text).toBe("Healthy");
      expect(health.color).toBe("positive");
      expect(health.icon).toBe("check_circle");
    });

    it("should return degraded status when error_rate > 5% and <= 10%", () => {
      wrapper = createWrapper({ selectedNode: mockNodes[1] }); // 7.8%
      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("degraded");
      expect(health.text).toBe("Degraded");
      expect(health.color).toBe("warning");
      expect(health.icon).toBe("warning");
    });

    it("should return critical status when error_rate > 10%", () => {
      wrapper = createWrapper({ selectedNode: mockNodes[2] }); // 12.5%
      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("critical");
      expect(health.text).toBe("Critical");
      expect(health.color).toBe("negative");
      expect(health.icon).toBe("error");
    });

    it("should return unknown status when selectedNode is null", () => {
      wrapper = createWrapper({ selectedNode: null });
      const health = wrapper.vm.serviceHealth;
      expect(health.status).toBe("unknown");
      expect(health.text).toBe("Unknown");
    });

    it("should treat missing error_rate as 0 (healthy)", () => {
      wrapper = createWrapper({
        selectedNode: { id: "test", label: "Test" },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("healthy");
    });

    it("should categorize error_rate=8 as degraded", () => {
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: 8 },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("degraded");
    });

    it("should categorize error_rate=15 as critical", () => {
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: 15 },
      });
      expect(wrapper.vm.serviceHealth.status).toBe("critical");
    });
  });

  // -------------------------------------------------------------------------
  // Computed - isAllStreamsSelected
  // -------------------------------------------------------------------------

  describe("Computed Properties - isAllStreamsSelected", () => {
    it("should return true when streamFilter is 'all'", () => {
      wrapper = createWrapper({ streamFilter: "all" });
      expect(wrapper.vm.isAllStreamsSelected).toBe(true);
    });

    it("should return false when streamFilter is 'default'", () => {
      wrapper = createWrapper({ streamFilter: "default" });
      expect(wrapper.vm.isAllStreamsSelected).toBe(false);
    });

    it("should return false when streamFilter is any custom stream name", () => {
      wrapper = createWrapper({ streamFilter: "my-traces-stream" });
      expect(wrapper.vm.isAllStreamsSelected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Event Handlers - handleClose
  // -------------------------------------------------------------------------

  describe("Event Handlers - handleClose", () => {
    it("should emit close event when close button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper
        .find('[data-test="o-drawer-close-btn"]')
        .trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Event Handlers - handleShowTelemetry
  // -------------------------------------------------------------------------

  describe("Event Handlers - handleShowTelemetry", () => {
    it("should render view-related button with correct label", () => {
      wrapper = createWrapper();
      const btn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-btn"]',
      );
      expect(btn.exists()).toBe(true);
      expect(btn.text()).toContain("View Related");
    });
  });

  // -------------------------------------------------------------------------
  // Event Handlers - navigateToTraces
  // -------------------------------------------------------------------------

  describe("Event Handlers - navigateToTraces", () => {
    it("should emit view-traces event when navigateToTraces is called", () => {
      wrapper = createWrapper();
      wrapper.vm.navigateToTraces({ operationName: "/api/orders" });
      expect(wrapper.emitted("view-traces")).toBeTruthy();
    });

    it("should include serviceName in the view-traces payload", () => {
      wrapper = createWrapper();
      wrapper.vm.navigateToTraces({});
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.serviceName).toBe("Service A");
    });

    it("should include stream from props in the view-traces payload", () => {
      wrapper = createWrapper({ streamFilter: "custom-stream" });
      wrapper.vm.navigateToTraces({});
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.stream).toBe("custom-stream");
    });

    it("should include timeRange from props in the view-traces payload", () => {
      wrapper = createWrapper();
      wrapper.vm.navigateToTraces({});
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.timeRange).toEqual(mockTimeRange);
    });

    it("should pass operationName through in the view-traces payload", () => {
      wrapper = createWrapper();
      wrapper.vm.navigateToTraces({ operationName: "/checkout" });
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.operationName).toBe("/checkout");
    });

    it("should pass errorsOnly flag through in the view-traces payload", () => {
      wrapper = createWrapper();
      wrapper.vm.navigateToTraces({ errorsOnly: true });
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.errorsOnly).toBe(true);
    });

    it("should use node label when name is absent", () => {
      wrapper = createWrapper({
        selectedNode: { id: "svc", label: "Label Only" },
      });
      wrapper.vm.navigateToTraces({});
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.serviceName).toBe("Label Only");
    });

    it("should fall back to node id when name and label are absent", () => {
      wrapper = createWrapper({
        selectedNode: { id: "fallback-id" },
      });
      wrapper.vm.navigateToTraces({});
      const payload = wrapper.emitted("view-traces")![0][0] as any;
      expect(payload.serviceName).toBe("fallback-id");
    });
  });

  // -------------------------------------------------------------------------
  // Async Operations - fetchAggregatedOperations
  // -------------------------------------------------------------------------

  describe("Async Operations - fetchAggregatedOperations", () => {
    it("should call searchService.search when visible=true, node set, and streamFilter is not 'all'", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      expect(searchService.search).toHaveBeenCalled();
    });

    it("should call searchService.search with the correct org_identifier", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      const call = vi.mocked(searchService.search).mock.calls[0][0] as any;
      // Store helper uses "default" as identifier
      expect(call.org_identifier).toBe("default");
    });

    it("should call searchService.search with page_type traces", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      const call = vi.mocked(searchService.search).mock.calls[0][0] as any;
      expect(call.page_type).toBe("traces");
    });

    it("should NOT call searchService.search when streamFilter is 'all'", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "all" });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should NOT call searchService.search when visible is false", async () => {
      wrapper = createWrapper({ visible: false, streamFilter: "default" });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should populate recentOperations from the search response", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      expect(wrapper.vm.recentOperations).toHaveLength(1);
      expect(wrapper.vm.recentOperations[0].name).toBe("/api/orders");
    });

    it("should set loadingOperations to false after fetch completes", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      expect(wrapper.vm.loadingOperations).toBe(false);
    });

    it("should keep recentOperations empty and reset loadingOperations on error", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(searchService.search).mockRejectedValueOnce(
        new Error("API Error"),
      );

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.vm.recentOperations).toHaveLength(0);
      expect(wrapper.vm.loadingOperations).toBe(false);
      consoleError.mockRestore();
    });

    it("should handle an empty hits array without errors", async () => {
      vi.mocked(searchService.search).mockResolvedValueOnce({
        data: { hits: [] },
      });

      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();

      expect(wrapper.vm.recentOperations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Watchers
  // -------------------------------------------------------------------------

  describe("Watchers", () => {
    it("should call searchService.search when visible changes from false to true", async () => {
      wrapper = createWrapper({ visible: false, streamFilter: "default" });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();

      await wrapper.setProps({ visible: true });
      await flushPromises();

      expect(searchService.search).toHaveBeenCalled();
    });

    it("should call searchService.search again when selectedNode changes", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      const callCount = vi.mocked(searchService.search).mock.calls.length;

      await wrapper.setProps({ selectedNode: mockNodes[1] });
      await flushPromises();

      expect(vi.mocked(searchService.search).mock.calls.length).toBeGreaterThan(
        callCount,
      );
    });

    it("should call searchService.search again when streamFilter changes to another stream", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      const callCount = vi.mocked(searchService.search).mock.calls.length;

      await wrapper.setProps({ streamFilter: "another-stream" });
      await flushPromises();

      expect(vi.mocked(searchService.search).mock.calls.length).toBeGreaterThan(
        callCount,
      );
    });

    it("should NOT call searchService.search when streamFilter changes to 'all'", async () => {
      wrapper = createWrapper({ visible: true, streamFilter: "default" });
      await flushPromises();
      vi.mocked(searchService.search).mockClear();

      await wrapper.setProps({ streamFilter: "all" });
      await flushPromises();

      expect(searchService.search).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // UI Rendering - Tabs section
  // -------------------------------------------------------------------------

  describe("UI Rendering - Tabs", () => {
    it("should show tabs when streamFilter is not 'all'", () => {
      wrapper = createWrapper({ streamFilter: "default" });
      expect(
        wrapper.find('[data-test="service-graph-node-panel-tabs"]').exists(),
      ).toBe(true);
    });

    it("should hide tabs when streamFilter is 'all'", () => {
      wrapper = createWrapper({ streamFilter: "all" });
      expect(
        wrapper.find('[data-test="service-graph-node-panel-tabs"]').exists(),
      ).toBe(false);
    });

    it("should render the operations tab", () => {
      wrapper = createWrapper({ streamFilter: "default" });
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-tab-operations"]')
          .exists(),
      ).toBe(true);
    });

    it.skip("should render the nodes tab", () => {
      // nodes tab is dynamic — only rendered after the async workload-fields
      // service resolves with k8s/aws/etc schema groups; not available in unit tests
    });

    it.skip("should render the pods tab", () => {
      // pods tab is dynamic — only rendered after the async workload-fields
      // service resolves with k8s/aws/etc schema groups; not available in unit tests
    });

    it("should default to operations tab on mount", () => {
      wrapper = createWrapper({ streamFilter: "default" });
      expect(wrapper.vm.activeTab).toBe("operations");
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------

  describe("Edge Cases", () => {
    it("should render service name using node id when name and label are absent", () => {
      wrapper = createWrapper({
        selectedNode: { id: "test-service" },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("test-service");
    });

    it("should handle visible prop toggle — show then hide panel", async () => {
      wrapper = createWrapper({ visible: true });
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(true);

      await wrapper.setProps({ visible: false });
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(false);
    });

    it("should handle negative error_rate without crashing", () => {
      wrapper = createWrapper({
        selectedNode: { ...mockNodes[0], error_rate: -5 },
      });
      expect(wrapper.vm.serviceHealth).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Props Validation
  // -------------------------------------------------------------------------

  describe("Props Validation", () => {
    it("should reflect all provided props correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.props("selectedNode")).toEqual(mockNodes[0]);
      expect(wrapper.props("graphData")).toEqual({
        nodes: mockNodes,
        edges: mockEdges,
      });
      expect(wrapper.props("timeRange")).toEqual(mockTimeRange);
      expect(wrapper.props("visible")).toBe(true);
      expect(wrapper.props("streamFilter")).toBe("default");
    });
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  describe("Accessibility", () => {
    it("should have all required data-test attributes in the rendered panel", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="service-graph-side-panel"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o-drawer-close-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="service-graph-node-panel-view-related-btn"]')
          .exists(),
      ).toBe(true);
    });
  });
});
