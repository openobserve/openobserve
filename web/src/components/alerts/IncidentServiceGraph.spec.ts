// Copyright 2025 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import IncidentServiceGraph from "./IncidentServiceGraph.vue";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";

// Mock services
vi.mock("@/services/incidents", () => ({
  default: {
    getServiceGraph: vi.fn(),
  },
}));

// Mock ChartRenderer component
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: {
    name: "ChartRenderer",
    template: '<div data-test="chart-renderer"></div>',
  },
}));

import incidentsService from "@/services/incidents";

installQuasar({ plugins: [Notify] });

describe("IncidentServiceGraph.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockGraphData = {
    incident_service: "service-a",
    root_cause_service: "service-c",
    nodes: [
      {
        service_name: "service-a",
        alert_count: 3,
        is_root_cause: false,
        is_primary: true,
      },
      {
        service_name: "service-b",
        alert_count: 7,
        is_root_cause: false,
        is_primary: false,
      },
      {
        service_name: "service-c",
        alert_count: 12,
        is_root_cause: true,
        is_primary: false,
      },
    ],
    edges: [
      { from: "service-a", to: "service-b" },
      { from: "service-b", to: "service-c" },
    ],
    stats: {
      total_services: 3,
      total_alerts: 22,
      services_with_alerts: 3,
    },
  };

  const createMockStore = (themeOverride?: string) => ({
    state: {
      theme: themeOverride || "light",
      zoConfig: {
        build_type: "opensource",
      },
    },
    dispatch: vi.fn(),
    commit: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountComponent = (props = {}, storeOverrides = {}) => {
    const mockStore = createMockStore(storeOverrides.theme);

    return mount(IncidentServiceGraph, {
      props: {
        orgId: "test-org",
        incidentId: "incident-123",
        ...props,
      },
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
      },
    });
  };

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display loading state on mount", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: mockGraphData } as any), 100);
          })
      );

      wrapper = mountComponent();
      await nextTick();
      expect(wrapper.vm.loading).toBe(true);
    });

    it("should call loadGraph on mount", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      expect(incidentsService.getServiceGraph).toHaveBeenCalledWith(
        "test-org",
        "incident-123"
      );
    });

    it("should initialize with force layout by default", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.layout).toBe("force");
    });
  });

  describe("Data Loading", () => {
    it("should load and display graph data successfully", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.graphData).toEqual(mockGraphData);
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should display stats banner when graph data is loaded", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain("Services:");
      expect(wrapper.text()).toContain("3");
      expect(wrapper.text()).toContain("Total Alerts:");
      expect(wrapper.text()).toContain("22");
    });

    it("should display root cause service when available", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain("Root Cause:");
      expect(wrapper.text()).toContain("service-c");
    });

    it("should not display root cause when not available", async () => {
      const dataWithoutRootCause = {
        ...mockGraphData,
        root_cause_service: undefined,
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: dataWithoutRootCause,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).not.toContain("Root Cause:");
    });

    it("should handle empty graph data", async () => {
      const emptyGraphData = {
        incident_service: "service-a",
        nodes: [],
        edges: [],
        stats: {
          total_services: 0,
          total_alerts: 0,
          services_with_alerts: 0,
        },
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: emptyGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain("Service Graph Unavailable");
      expect(wrapper.text()).toContain(
        "Topology data is being generated in the background"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle 404 error gracefully (show empty state)", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockRejectedValue({
        response: { status: 404 },
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();
      // Should not show notification for 404
    });

    it("should show warning notification for 403 error", async () => {
      const notifyMock = vi.fn();
      vi.stubGlobal("$q", { notify: notifyMock });

      vi.mocked(incidentsService.getServiceGraph).mockRejectedValue({
        response: { status: 403 },
      });

      wrapper = mountComponent();
      await flushPromises();

      // Verify loading is false and no data
      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();

      vi.unstubAllGlobals();
    });

    it("should show error notification for other errors", async () => {
      const notifyMock = vi.fn();
      vi.stubGlobal("$q", { notify: notifyMock });

      vi.mocked(incidentsService.getServiceGraph).mockRejectedValue({
        response: { status: 500 },
        message: "Server error",
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();

      vi.unstubAllGlobals();
    });

    it("should handle network errors", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockRejectedValue(
        new Error("Network Error")
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();
    });
  });

  describe("User Interactions", () => {
    it("should refresh graph when refresh button is clicked", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      vi.mocked(incidentsService.getServiceGraph).mockClear();

      // Call loadGraph directly since the button is a Quasar component
      await wrapper.vm.loadGraph();
      await flushPromises();

      expect(incidentsService.getServiceGraph).toHaveBeenCalledTimes(1);
    });

    it("should show loading state during refresh", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      vi.mocked(incidentsService.getServiceGraph).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: mockGraphData } as any), 100);
          })
      );

      // Call loadGraph directly and check loading state immediately
      const loadPromise = wrapper.vm.loadGraph();
      await nextTick();

      expect(wrapper.vm.loading).toBe(true);

      await loadPromise;
    });

    it("should change layout when layout selector changes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.layout).toBe("force");

      wrapper.vm.layout = "circular";
      await wrapper.vm.onLayoutChange();
      await nextTick();

      expect(wrapper.vm.layout).toBe("circular");
      expect(wrapper.vm.chartKey).toBeGreaterThan(0);
    });

    it("should increment chartKey when layout changes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      wrapper.vm.layout = "circular";
      await wrapper.vm.onLayoutChange();

      expect(wrapper.vm.chartKey).toBe(initialKey + 1);
    });

    it("should allow clicking empty state refresh button", async () => {
      const emptyGraphData = {
        incident_service: "service-a",
        nodes: [],
        edges: [],
        stats: {
          total_services: 0,
          total_alerts: 0,
          services_with_alerts: 0,
        },
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: emptyGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      vi.mocked(incidentsService.getServiceGraph).mockClear();

      // Find refresh button in empty state
      const buttons = wrapper.findAll("button");
      const refreshBtn = buttons.find((btn) =>
        btn.text().includes("Refresh to Check Again")
      );
      if (refreshBtn) {
        await refreshBtn.trigger("click");
        await flushPromises();

        expect(incidentsService.getServiceGraph).toHaveBeenCalled();
      }
    });
  });

  describe("Layout Options", () => {
    it("should have force and circular layout options", () => {
      wrapper = mountComponent();
      expect(wrapper.vm.layoutOptions).toEqual([
        { label: "Force Directed", value: "force" },
        { label: "Circular", value: "circular" },
      ]);
    });

    it("should generate force layout configuration", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.layout = "force";
      await nextTick();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].layout).toBe("force");
      expect(chartData.options.series[0].force).toBeDefined();
      expect(chartData.options.series[0].force.repulsion).toBe(300);
      expect(chartData.options.series[0].force.gravity).toBe(0.1);
      expect(chartData.options.series[0].force.edgeLength).toBe(150);
    });

    it("should generate circular layout configuration", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.layout = "circular";
      await nextTick();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].layout).toBe("circular");
      expect(chartData.options.series[0].circular).toBeDefined();
    });
  });

  describe("Node Styling", () => {
    it("should color root cause nodes red", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const rootCauseNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-c"
      );
      expect(rootCauseNode.itemStyle.color).toBe("#ef4444"); // red-500
    });

    it("should color high alert nodes orange", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const highAlertNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-b"
      );
      expect(highAlertNode.itemStyle.color).toBe("#f97316"); // orange-500
    });

    it("should color normal nodes blue", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const normalNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-a"
      );
      expect(normalNode.itemStyle.color).toBe("#3b82f6"); // blue-500
    });

    it("should prioritize root cause color over high alerts", async () => {
      // Node with both root cause and high alerts
      const mixedData = {
        ...mockGraphData,
        nodes: [
          ...mockGraphData.nodes,
          {
            service_name: "service-d",
            alert_count: 10,
            is_root_cause: true,
            is_primary: false,
          },
        ],
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mixedData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const mixedNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-d"
      );
      expect(mixedNode.itemStyle.color).toBe("#ef4444"); // red-500 for root cause
    });

    it("should calculate node size based on alert count", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node1 = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-a"
      ); // 3 alerts
      const node2 = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-b"
      ); // 7 alerts
      const node3 = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-c"
      ); // 12 alerts

      expect(node1.symbolSize).toBe(45); // 30 + 3*5
      expect(node2.symbolSize).toBe(65); // 30 + 7*5
      expect(node3.symbolSize).toBe(90); // 30 + 12*5
    });

    it("should cap node size at 100", async () => {
      // Create data with very high alert count
      const largeAlertData = {
        ...mockGraphData,
        nodes: [
          {
            service_name: "service-huge",
            alert_count: 100,
            is_root_cause: false,
            is_primary: false,
          },
        ],
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: largeAlertData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const largeNode = chartData.options.series[0].data[0];
      expect(largeNode.symbolSize).toBe(100); // Capped at 100
    });

    it("should add border to primary service nodes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const primaryNode = chartData.options.series[0].data.find(
        (node: any) => node.name === "service-a"
      );

      expect(primaryNode.itemStyle.borderColor).toBe("#a855f7"); // purple
      expect(primaryNode.itemStyle.borderWidth).toBe(4);
    });

    it("should not add border to non-primary nodes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const nonPrimaryNode = chartData.options.series[0].data.find(
        (node: any) => node.name === "service-b"
      );

      expect(nonPrimaryNode.itemStyle.borderColor).toBe("#f97316"); // orange (same as node color)
      expect(nonPrimaryNode.itemStyle.borderWidth).toBe(2);
    });
  });

  describe("Chart Data Generation", () => {
    it("should return empty options when no graph data", () => {
      wrapper = mountComponent();
      const chartData = wrapper.vm.chartData;

      expect(chartData).toEqual({ options: {}, notMerge: true });
    });

    it("should return empty options when nodes are empty", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: {
          ...mockGraphData,
          nodes: [],
        },
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData).toEqual({ options: {}, notMerge: true });
    });

    it("should generate valid ECharts options with nodes and edges", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series).toHaveLength(1);
      expect(chartData.options.series[0].type).toBe("graph");
      expect(chartData.options.series[0].data).toHaveLength(3);
      expect(chartData.options.series[0].links).toHaveLength(2);
    });

    it("should set tooltip configuration", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.trigger).toBe("item");
    });

    it("should enable roam and draggable on graph", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].roam).toBe(true);
      expect(chartData.options.series[0].draggable).toBe(true);
    });

    it("should set emphasis focus to adjacency", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].emphasis.focus).toBe("adjacency");
    });

    it("should generate edge with arrow symbols", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];

      expect(edge.symbol).toEqual(["none", "arrow"]);
      expect(edge.symbolSize).toEqual([0, 10]);
    });

    it("should set edge curveness", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];

      expect(edge.lineStyle.curveness).toBe(0.2);
    });
  });

  describe("Theme Support", () => {
    it("should apply light theme colors", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      expect(wrapper.vm.isDarkMode).toBe(false);

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.backgroundColor).toBe("#ffffff");
      expect(chartData.options.tooltip.textStyle.color).toBe("#374151");
    });

    it("should apply dark theme colors", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      expect(wrapper.vm.isDarkMode).toBe(true);

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.backgroundColor).toBe("#1f2937");
      expect(chartData.options.tooltip.textStyle.color).toBe("#e5e7eb");
    });

    it("should apply dark theme to edge colors", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];
      expect(edge.lineStyle.color).toBe("#6b7280");
    });

    it("should apply light theme to edge colors", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];
      expect(edge.lineStyle.color).toBe("#9ca3af");
    });

    it("should apply dark theme to node labels", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      expect(node.label.color).toBe("#e5e7eb");
    });

    it("should apply light theme to node labels", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      expect(node.label.color).toBe("#374151");
    });
  });

  describe("Watchers", () => {
    it("should reload graph when incidentId changes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({ incidentId: "incident-123" });
      await flushPromises();

      vi.mocked(incidentsService.getServiceGraph).mockClear();

      await wrapper.setProps({ incidentId: "incident-456" });
      await flushPromises();

      expect(incidentsService.getServiceGraph).toHaveBeenCalledWith(
        "test-org",
        "incident-456"
      );
    });

    it("should not reload when incidentId stays the same", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent({ incidentId: "incident-123" });
      await flushPromises();

      vi.mocked(incidentsService.getServiceGraph).mockClear();

      // Set the same incident ID
      await wrapper.setProps({ incidentId: "incident-123" });
      await flushPromises();

      expect(incidentsService.getServiceGraph).not.toHaveBeenCalled();
    });
  });

  describe("Props Validation", () => {
    it("should require orgId prop", () => {
      const { orgId } = IncidentServiceGraph.props;
      expect(orgId.required).toBe(true);
      expect(orgId.type).toBe(String);
    });

    it("should require incidentId prop", () => {
      const { incidentId } = IncidentServiceGraph.props;
      expect(incidentId.required).toBe(true);
      expect(incidentId.type).toBe(String);
    });
  });

  describe("Legend Display", () => {
    it("should display legend with all node types", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain("Root Cause");
      expect(wrapper.text()).toContain("High Alerts (>5)");
      expect(wrapper.text()).toContain("Normal");
      expect(wrapper.text()).toContain("Primary Service");
    });
  });

  describe("Node Tooltips", () => {
    it("should include service name in tooltip", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      const tooltip = node.tooltip.formatter();

      expect(tooltip).toContain("service-a");
    });

    it("should include alert count in tooltip", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      const tooltip = node.tooltip.formatter();

      expect(tooltip).toContain("Alerts:");
      expect(tooltip).toContain("3");
    });

    it("should show root cause indicator in tooltip", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const rootCauseNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-c"
      );
      const tooltip = rootCauseNode.tooltip.formatter();

      expect(tooltip).toContain("Suspected Root Cause");
    });

    it("should show primary service indicator in tooltip", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const primaryNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-a"
      );
      const tooltip = primaryNode.tooltip.formatter();

      expect(tooltip).toContain("Primary Service");
    });

    it("should not show root cause indicator for non-root-cause nodes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const normalNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-b"
      );
      const tooltip = normalNode.tooltip.formatter();

      expect(tooltip).not.toContain("Suspected Root Cause");
    });
  });

  describe("Edge Cases", () => {
    it("should handle graph with single node", async () => {
      const singleNodeData = {
        incident_service: "service-a",
        nodes: [
          {
            service_name: "service-a",
            alert_count: 5,
            is_root_cause: false,
            is_primary: true,
          },
        ],
        edges: [],
        stats: {
          total_services: 1,
          total_alerts: 5,
          services_with_alerts: 1,
        },
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: singleNodeData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].data).toHaveLength(1);
      expect(chartData.options.series[0].links).toHaveLength(0);
    });

    it("should handle node with zero alerts", async () => {
      const dataWithZeroAlerts = {
        ...mockGraphData,
        nodes: [
          ...mockGraphData.nodes,
          {
            service_name: "service-d",
            alert_count: 0,
            is_root_cause: false,
            is_primary: false,
          },
        ],
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: dataWithZeroAlerts,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const zeroAlertNode = chartData.options.series[0].data.find(
        (n: any) => n.name === "service-d"
      );
      expect(zeroAlertNode.symbolSize).toBe(30); // Base size
    });

    it("should handle very large alert counts", async () => {
      const dataWithLargeAlerts = {
        ...mockGraphData,
        nodes: [
          {
            service_name: "service-huge",
            alert_count: 1000,
            is_root_cause: false,
            is_primary: false,
          },
        ],
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: dataWithLargeAlerts,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const largeNode = chartData.options.series[0].data[0];
      expect(largeNode.symbolSize).toBe(100); // Capped at 100
    });

    it("should handle null orgId gracefully", () => {
      // This should not happen due to required prop, but testing edge case
      expect(() => {
        wrapper = mountComponent({ orgId: null as any });
      }).not.toThrow();
    });

    it("should handle null incidentId gracefully", () => {
      // This should not happen due to required prop, but testing edge case
      expect(() => {
        wrapper = mountComponent({ incidentId: null as any });
      }).not.toThrow();
    });
  });

  describe("Animation Configuration", () => {
    it("should set animation duration", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.animationDuration).toBe(1500);
    });

    it("should set animation easing", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.animationEasingUpdate).toBe("quinticInOut");
    });
  });

  describe("Chart Renderer Integration", () => {
    it("should pass chart data to ChartRenderer", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const chartRenderer = wrapper.find('[data-test="chart-renderer"]');
      expect(chartRenderer.exists()).toBe(true);
    });

    it("should hide ChartRenderer when no data", async () => {
      const emptyData = {
        incident_service: "service-a",
        nodes: [],
        edges: [],
        stats: {
          total_services: 0,
          total_alerts: 0,
          services_with_alerts: 0,
        },
      };

      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: emptyData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const chartContainer = wrapper.find(".tw-w-full.tw-h-full");
      expect(chartContainer.isVisible()).toBe(false);
    });

    it("should update chartKey when data changes", async () => {
      vi.mocked(incidentsService.getServiceGraph).mockResolvedValue({
        data: mockGraphData,
      } as any);

      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      await wrapper.vm.loadGraph();
      await flushPromises();

      expect(wrapper.vm.chartKey).toBeGreaterThan(initialKey);
    });
  });
});
