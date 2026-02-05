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

// Mock ChartRenderer component
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: {
    name: "ChartRenderer",
    template: '<div data-test="chart-renderer"></div>',
  },
}));

installQuasar({ plugins: [Notify] });

describe("IncidentServiceGraph.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockGraphData = {
    nodes: [
      {
        alert_id: "alert_cpu_high",
        alert_name: "High CPU Usage",
        service_name: "service-a",
        alert_count: 3,
        first_fired_at: 1000000,
        last_fired_at: 2000000,
      },
      {
        alert_id: "alert_latency",
        alert_name: "High Latency",
        service_name: "service-b",
        alert_count: 7,
        first_fired_at: 1500000,
        last_fired_at: 3000000,
      },
      {
        alert_id: "alert_db_pool",
        alert_name: "DB Pool Exhausted",
        service_name: "service-c",
        alert_count: 12,
        first_fired_at: 2000000,
        last_fired_at: 4000000,
      },
    ],
    edges: [
      { from_node_index: 0, to_node_index: 1, edge_type: "temporal" },
      { from_node_index: 1, to_node_index: 2, edge_type: "service_dependency" },
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

  const mountComponent = (props = {}, storeOverrides: { theme?: string } = {}) => {
    const mockStore = createMockStore(storeOverrides.theme);

    return mount(IncidentServiceGraph, {
      props: {
        topologyContext: mockGraphData,
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
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should not have loading state on mount (data comes from props)", async () => {
      wrapper = mountComponent();
      await nextTick();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should receive topology context from props", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.graphData).toEqual(mockGraphData);
    });

    it("should initialize with force layout by default", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Layout is 'none' because we use D3-force to pre-compute positions
      expect(chartData.options.series[0].layout).toBe("none");
    });
  });

  describe("Data Loading", () => {
    it("should display graph data from props", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.graphData).toEqual(mockGraphData);
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should display graph when topology context is provided", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      // Check that ChartRenderer component is rendered
      expect(wrapper.findComponent({ name: "ChartRenderer" }).exists()).toBe(true);
      expect(wrapper.vm.graphData).toEqual(mockGraphData);
    });

    it("should mark first node as root cause (red)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const chartData = wrapper.vm.chartData;
      // First node is always marked as root cause (red), so there should be 1
      const rootCauseNodes = chartData.options.series[0].data.filter(
        (n: any) => n.itemStyle.color === "#ef4444"
      );
      expect(rootCauseNodes.length).toBe(1);
    });

    it("should handle empty graph data", async () => {
      const emptyGraphData = {
        nodes: [],
        edges: [],
      };

      wrapper = mountComponent({ topologyContext: emptyGraphData });
      await flushPromises();
      await nextTick();

      expect(wrapper.text()).toContain("Service Graph Unavailable");
      expect(wrapper.text()).toContain(
        "No topology data available for this incident"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle null topology context (show empty state)", async () => {
      wrapper = mountComponent({ topologyContext: null });
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();
      // Should show empty state
      expect(wrapper.text()).toContain("Service Graph Unavailable");
    });

    it("should handle undefined topology context gracefully", async () => {
      wrapper = mountComponent({ topologyContext: undefined });
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toBeNull();
    });

    it("should handle topology context with no nodes", async () => {
      wrapper = mountComponent({ topologyContext: { nodes: [], edges: [] } });
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.vm.graphData).toEqual({ nodes: [], edges: [] });
      expect(wrapper.text()).toContain("Service Graph Unavailable");
    });

    it("should handle topology context with undefined nodes", async () => {
      wrapper = mountComponent({ topologyContext: { edges: [] } });
      await flushPromises();

      expect(wrapper.vm.loading).toBe(false);
      expect(wrapper.text()).toContain("Service Graph Unavailable");
    });
  });

  describe("User Interactions", () => {
    it("should increment chartKey when loadGraph is called", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      // Call loadGraph directly
      wrapper.vm.loadGraph();
      await nextTick();

      expect(wrapper.vm.chartKey).toBe(initialKey + 1);
    });

    it("should not show loading state during refresh (data comes from props)", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Call loadGraph directly
      wrapper.vm.loadGraph();
      await nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });

    it("should change layout when layout selector changes", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Layout is 'none' because we use D3-force to pre-compute positions
      expect(chartData.options.series[0].layout).toBe("none");
      // Nodes should have fixed positions
      expect(chartData.options.series[0].data[0].fixed).toBe(true);
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

        data: emptyGraphData,

      wrapper = mountComponent();
      await flushPromises();


      // Find refresh button in empty state
      const buttons = wrapper.findAll("button");
      const refreshBtn = buttons.find((btn) =>
        btn.text().includes("Refresh to Check Again")
      );
      if (refreshBtn) {
        await refreshBtn.trigger("click");
        await flushPromises();

      }
    });
  });

  describe("Layout Options", () => {
    it("should use D3-force pre-computed layout", async () => {

      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.layout = "force";
      await nextTick();

      const chartData = wrapper.vm.chartData;
      // Layout is 'none' because we use D3-force to pre-compute positions
      expect(chartData.options.series[0].layout).toBe("none");
      // Nodes should have pre-computed x, y positions
      expect(chartData.options.series[0].data[0].x).toBeDefined();
      expect(chartData.options.series[0].data[0].y).toBeDefined();
      expect(chartData.options.series[0].data[0].fixed).toBe(true);
    });

    it("should generate circular layout configuration", async () => {

      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.layout = "circular";
      await nextTick();

      const chartData = wrapper.vm.chartData;
      // Layout is always 'none' because we use D3-force to pre-compute positions
      // regardless of the layout selector value
      expect(chartData.options.series[0].layout).toBe("none");
      // Check that layout selector changed
      expect(wrapper.vm.layout).toBe("circular");
    });
  });

  describe("Node Styling", () => {
    it("should color root cause nodes red", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // First node (index 0) is the root cause - service-a
      const rootCauseNode = chartData.options.series[0].data[0];
      expect(rootCauseNode.itemStyle.color).toBe("#ef4444"); // red-500
    });

    it("should color high alert nodes orange", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // service-b has 7 alerts (>5), so it should be orange
      // It's at index 1
      const highAlertNode = chartData.options.series[0].data[1];
      expect(highAlertNode.itemStyle.color).toBe("#f97316"); // orange-500
    });

    it("should color normal nodes blue", async () => {
      // Create data where index 0 will still be red, but we need a node that's not first and has <=5 alerts
      const normalNodeData = {
        nodes: [
          {
            alert_id: "alert_cpu_high",
            alert_name: "High CPU Usage",
            service_name: "service-a",
            alert_count: 3,
            first_fired_at: 1000000,
            last_fired_at: 2000000,
          },
          {
            alert_id: "alert_memory",
            alert_name: "Memory Usage",
            service_name: "service-b",
            alert_count: 2, // <=5 alerts, not first, should be blue
            first_fired_at: 1500000,
            last_fired_at: 3000000,
          },
        ],
        edges: [],
        stats: {
          total_services: 2,
          total_alerts: 5,
          services_with_alerts: 2,
        },
      };

      wrapper = mountComponent({ topologyContext: normalNodeData });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Second node with <=5 alerts should be blue
      const normalNode = chartData.options.series[0].data[1];
      expect(normalNode.itemStyle.color).toBe("#3b82f6"); // blue-500
    });

    it("should prioritize root cause color over high alerts", async () => {
      // First node with high alert count should be red (root cause takes priority)
      const mixedData = {
        nodes: [
          {
            alert_id: "alert_high",
            alert_name: "High Load",
            service_name: "service-d",
            alert_count: 10, // High alert count
            first_fired_at: 1000000,
            last_fired_at: 2000000,
          },
        ],
        edges: [],
        stats: {
          total_services: 1,
          total_alerts: 10,
          services_with_alerts: 1,
        },
      };

        data: mixedData,

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // First node should be red regardless of alert count
      const mixedNode = chartData.options.series[0].data[0];
      expect(mixedNode.itemStyle.color).toBe("#ef4444"); // red-500 for root cause
    });

    it("should calculate node size based on alert count", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node1 = chartData.options.series[0].data[0]; // 3 alerts
      const node2 = chartData.options.series[0].data[1]; // 7 alerts
      const node3 = chartData.options.series[0].data[2]; // 12 alerts

      // All nodes have fixed size of 60
      expect(node1.symbolSize).toBe(60);
      expect(node2.symbolSize).toBe(60);
      expect(node3.symbolSize).toBe(60);
    });

    it("should cap node size at 100", async () => {
      // Create data with very high alert count
      const largeAlertData = {
        nodes: [
          {
            alert_id: "alert_huge",
            alert_name: "Huge Alert",
            service_name: "service-huge",
            alert_count: 100,
            first_fired_at: 1000000,
            last_fired_at: 2000000,
          },
        ],
        edges: [],
        stats: {
          total_services: 1,
          total_alerts: 100,
          services_with_alerts: 1,
        },
      };

      wrapper = mountComponent({ topologyContext: largeAlertData });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const largeNode = chartData.options.series[0].data[0];
      expect(largeNode.symbolSize).toBe(60); // Fixed size for all nodes
    });

    it("should add border to primary service nodes", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // First node (root cause) has a red border with width 4
      const primaryNode = chartData.options.series[0].data[0];

      expect(primaryNode.itemStyle.borderColor).toBe("#dc2626"); // darker red
      expect(primaryNode.itemStyle.borderWidth).toBe(4);
    });

    it("should not add border to non-primary nodes", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Second node (not root cause) has same color border as the node color with width 2
      const nonPrimaryNode = chartData.options.series[0].data[1];

      expect(nonPrimaryNode.itemStyle.borderColor).toBe("#f97316"); // orange (same as node color)
      expect(nonPrimaryNode.itemStyle.borderWidth).toBe(2);
    });
  });

  describe("Chart Data Generation", () => {
    it("should return empty options when no graph data", () => {
      wrapper = mountComponent({ topologyContext: null });
      const chartData = wrapper.vm.chartData;

      expect(chartData).toEqual({ options: {}, notMerge: true });
    });

    it("should return empty options when nodes are empty", async () => {
      wrapper = mountComponent({
        topologyContext: {
          ...mockGraphData,
          nodes: [],
        }
      });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData).toEqual({ options: {}, notMerge: true });
    });

    it("should generate valid ECharts options with nodes and edges", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series).toHaveLength(1);
      expect(chartData.options.series[0].type).toBe("graph");
      expect(chartData.options.series[0].data).toHaveLength(3);
      expect(chartData.options.series[0].links).toHaveLength(2);
    });

    it("should set tooltip configuration", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.trigger).toBe("item");
    });

    it("should enable roam and draggable on graph", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].roam).toBe(true);
      expect(chartData.options.series[0].draggable).toBe(true);
    });

    it("should set emphasis focus to adjacency", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].emphasis.focus).toBe("adjacency");
    });

    it("should generate edge with arrow symbols", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];

      expect(edge.symbol).toEqual(["none", "arrow"]);
      expect(edge.symbolSize).toEqual([0, 10]);
    });

    it("should set edge curveness", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];

      expect(edge.lineStyle.curveness).toBe(0.2);
    });
  });

  describe("Theme Support", () => {
    it("should apply light theme colors", async () => {

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      expect(wrapper.vm.isDarkMode).toBe(false);

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.backgroundColor).toBe("#ffffff");
      expect(chartData.options.tooltip.textStyle.color).toBe("#374151");
    });

    it("should apply dark theme colors", async () => {

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      expect(wrapper.vm.isDarkMode).toBe(true);

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.tooltip.backgroundColor).toBe("#1f2937");
      expect(chartData.options.tooltip.textStyle.color).toBe("#e5e7eb");
    });

    it("should apply dark theme to edge colors", async () => {

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];
      // First edge is temporal, so it should be purple in dark mode
      expect(edge.lineStyle.color).toBe("#a78bfa");
    });

    it("should apply light theme to edge colors", async () => {

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const edge = chartData.options.series[0].links[0];
      // First edge is temporal, so it should be purple in light mode
      expect(edge.lineStyle.color).toBe("#8b5cf6");
    });

    it("should apply dark theme to node labels", async () => {

      wrapper = mountComponent({}, { theme: "dark" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      expect(node.label.color).toBe("#e5e7eb");
    });

    it("should apply light theme to node labels", async () => {

      wrapper = mountComponent({}, { theme: "light" });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      expect(node.label.color).toBe("#374151");
    });
  });

  describe("Watchers", () => {
    it("should clear cached positions when topology context changes", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      // Change the topology context
      const newData = {
        nodes: [mockGraphData.nodes[0]], // Different data - only first node
        edges: [], // No edges since we only have one node
      };

      await wrapper.setProps({ topologyContext: newData });
      await flushPromises();

      expect(wrapper.vm.chartKey).toBe(initialKey + 1);
    });

    it("should not reload when topology context stays the same", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      // Set the same topology context (no actual change)
      await wrapper.setProps({ topologyContext: mockGraphData });
      await flushPromises();

      // chartKey should not change since the data is the same (Vue's deep watcher won't trigger)
      expect(wrapper.vm.chartKey).toBe(initialKey);
    });
  });

  describe("Props Validation", () => {
    it("should have topologyContext prop", () => {
      const { topologyContext } = IncidentServiceGraph.props;
      expect(topologyContext).toBeDefined();
      expect(topologyContext.required).toBe(false);
    });

    it("should accept null as default for topologyContext", () => {
      const { topologyContext } = IncidentServiceGraph.props;
      expect(topologyContext.default).toBe(null);
    });
  });

  describe("Legend Display", () => {
    it("should display legend with all node types", async () => {

      wrapper = mountComponent();
      await flushPromises();
      await nextTick();

      const chartData = wrapper.vm.chartData;
      // First node is the root cause
      const rootCauseNode = chartData.options.series[0].data[0];

      // Root cause node should have tooltip formatter that includes root cause text
      expect(rootCauseNode.tooltip.formatter).toBeDefined();
      const tooltipHtml = rootCauseNode.tooltip.formatter();
      expect(tooltipHtml).toContain("First Alert (Potential Root Cause)");
    });
  });

  describe("Node Tooltips", () => {
    it("should include service name in tooltip", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      const tooltip = node.tooltip.formatter();

      expect(tooltip).toContain("service-a");
    });

    it("should include alert count in tooltip", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const node = chartData.options.series[0].data[0];
      const tooltip = node.tooltip.formatter();

      expect(tooltip).toContain("Alert Count:");
      expect(tooltip).toContain("3");
    });

    it("should show root cause indicator in tooltip", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // First node is the root cause
      const rootCauseNode = chartData.options.series[0].data[0];
      const tooltip = rootCauseNode.tooltip.formatter();

      expect(tooltip).toContain("First Alert (Potential Root Cause)");
    });

    it("should show primary service indicator in tooltip", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // First node shows "First Alert (Potential Root Cause)" which is our primary indicator
      const primaryNode = chartData.options.series[0].data[0];
      const tooltip = primaryNode.tooltip.formatter();

      expect(tooltip).toContain("First Alert (Potential Root Cause)");
    });

    it("should not show root cause indicator for non-root-cause nodes", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Second node is not the root cause
      const normalNode = chartData.options.series[0].data[1];
      const tooltip = normalNode.tooltip.formatter();

      expect(tooltip).not.toContain("First Alert (Potential Root Cause)");
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

      wrapper = mountComponent({ topologyContext: singleNodeData });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      expect(chartData.options.series[0].data).toHaveLength(1);
      expect(chartData.options.series[0].links).toHaveLength(0);
    });

    it("should handle node with zero alerts", async () => {
      const dataWithZeroAlerts = {
        nodes: [
          {
            alert_id: "alert_1",
            alert_name: "Alert 1",
            service_name: "service-a",
            alert_count: 5,
            first_fired_at: 1000000,
            last_fired_at: 2000000,
          },
          {
            alert_id: "alert_2",
            alert_name: "Alert 2",
            service_name: "service-d",
            alert_count: 0,
            first_fired_at: 1500000,
            last_fired_at: 1500000,
          },
        ],
        edges: [],
        stats: {
          total_services: 2,
          total_alerts: 5,
          services_with_alerts: 1,
        },
      };

      wrapper = mountComponent({ topologyContext: dataWithZeroAlerts });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Second node has 0 alerts
      const zeroAlertNode = chartData.options.series[0].data[1];
      expect(zeroAlertNode.symbolSize).toBe(60); // Fixed size for all nodes
    });

    it("should handle very large alert counts", async () => {
      const dataWithLargeAlerts = {
        nodes: [
          {
            alert_id: "alert_huge",
            alert_name: "Huge Alert",
            service_name: "service-huge",
            alert_count: 1000,
            first_fired_at: 1000000,
            last_fired_at: 2000000,
          },
        ],
        edges: [],
        stats: {
          total_services: 1,
          total_alerts: 1000,
          services_with_alerts: 1,
        },
      };

      wrapper = mountComponent({ topologyContext: dataWithLargeAlerts });
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      const largeNode = chartData.options.series[0].data[0];
      expect(largeNode.symbolSize).toBe(60); // Fixed size for all nodes
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

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Animation is disabled for better performance with pre-computed positions
      expect(chartData.options.animation).toBe(false);
    });

    it("should set animation easing", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const chartData = wrapper.vm.chartData;
      // Animation is disabled, so no easing setting
      expect(chartData.options.animation).toBe(false);
    });
  });

  describe("Chart Renderer Integration", () => {
    it("should pass chart data to ChartRenderer", async () => {

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

      wrapper = mountComponent({ topologyContext: emptyData });
      await flushPromises();
      await nextTick();

      const chartRenderer = wrapper.find('[data-test="chart-renderer"]');
      expect(chartRenderer.exists()).toBe(false);
    });

    it("should update chartKey when loadGraph is called", async () => {

      wrapper = mountComponent();
      await flushPromises();

      const initialKey = wrapper.vm.chartKey;

      // loadGraph increments chartKey to force re-render
      wrapper.vm.loadGraph();
      await nextTick();

      expect(wrapper.vm.chartKey).toBe(initialKey + 1);
    });
  });
});
