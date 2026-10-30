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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, reactive } from "vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(),
  useDashboardPanelData: vi.fn(),
}));

vi.mock("@/utils/dashboard/searchLabelsConfig", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const allExpanded = Object.fromEntries(
    Object.keys(actual.DEFAULT_EXPANDED_SECTIONS as Record<string, boolean>).map((k) => [k, true]),
  );
  return { ...actual, DEFAULT_EXPANDED_SECTIONS: allExpanded };
});

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed: vueComputed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      vueComputed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

const makePanel = (type: string, config: Record<string, unknown> = {}) =>
  reactive<any>({
    data: {
      id: "panel-1",
      title: "Test Panel",
      description: "",
      type,
      queries: [
        {
          query: "SELECT * FROM test",
          queryType: "sql",
          fields: {
            breakdown: [],
            y: [
              { alias: "y_axis_1", label: "Latency" },
              { alias: "y_axis_2", label: "Size" },
            ],
          },
          config: { time_shift: [], limit: 1000 },
        },
      ],
      config: {
        unit: "milliseconds",
        unit_custom: "",
        step_value: 0,
        top_results: 10,
        trellis: { layout: "horizontal", num_of_columns: 1, group_by_y_axis: false },
        legend_width: { value: null, unit: "px" },
        label_option: { position: null, rotate: 0 },
        map_type: { type: "world" },
        base_map: { type: "osm" },
        map_symbol_style: { size: "by Value", size_by_value: { min: 1, max: 100 }, size_fixed: 2 },
        ...config,
      },
    },
    layout: { currentQueryIndex: 0 },
    meta: {
      dateTime: {
        start_time: new Date("2023-01-01T00:00:00Z"),
        end_time: new Date("2023-01-01T23:59:59Z"),
      },
      stream: { selectedStreamFields: [] },
    },
  });

describe("ConfigPanel node graph settings", { timeout: 30_000 }, () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  const mountPanel = (type: string, config: Record<string, unknown> = {}, promql = false) => {
    const panel = makePanel(type, config);
    vi.mocked(useDashboardPanelData).mockReturnValue({
      dashboardPanelData: panel,
      promqlMode: promql,
      isPivotMode: computed(() => false),
      selectedStreamFields: [],
    } as any);
    store.state.selectedOrganization = { identifier: "test-org" };
    wrapper = mount(ConfigPanel, {
      attachTo: document.body,
      props: { variablesData: { values: [] }, panelData: {} },
      global: {
        plugins: [i18n, store],
        provide: { dashboardPanelDataPageKey: "dashboard" },
        stubs: {
          ColorBySeries: { template: "<div />" },
          OverrideConfig: { template: "<div />" },
          ValueMapping: { template: "<div />" },
        },
      },
    });
    return panel;
  };

  const has = (test: string) => wrapper!.find(`[data-test="${test}"]`).exists();
  const pick = async (test: string, value: string) => {
    await wrapper!
      .find(`[data-test="${test}-option"][data-test-label="${value}"]`)
      .trigger("click");
    await flushPromises();
  };
  const emitSwitch = async (test: string, value: unknown) => {
    const control = wrapper!
      .findAllComponents({ name: "OSwitch" })
      .find((component: any) => component.attributes("data-test") === test);
    expect(control, test).toBeTruthy();
    control!.vm.$emit("update:modelValue", value);
    await flushPromises();
  };

  it("mounting writes none of the node graph keys", async () => {
    const panel = mountPanel("node-graph");
    const before = JSON.stringify(panel.data.config);
    await flushPromises();
    expect(JSON.stringify(panel.data.config)).toBe(before);
  });

  it("node graph: writes the layout and the edge label switch", async () => {
    const panel = mountPanel("node-graph");
    await flushPromises();
    await pick("dashboard-config-node_graph_layout", "Circular");
    await emitSwitch("dashboard-config-node_graph_show_edge_labels", true);
    expect(panel.data.config).toMatchObject({
      node_graph_layout: "circular",
      node_graph_show_edge_labels: true,
    });
    await emitSwitch("dashboard-config-node_graph_show_edge_labels", false);
    expect("node_graph_show_edge_labels" in panel.data.config).toBe(false);
  });

  it("node graph: the layout's Default choice names the force layout and clears the key", async () => {
    const panel = mountPanel("node-graph");
    await flushPromises();
    const labels = wrapper!
      .findAll('[data-test="dashboard-config-node_graph_layout-option"]')
      .map((option) => option.attributes("data-test-label"));
    expect(labels).toEqual(["Default (Force)", "Force", "Circular"]);
    await pick("dashboard-config-node_graph_layout", "Circular");
    expect(panel.data.config.node_graph_layout).toBe("circular");
    await pick("dashboard-config-node_graph_layout", "Default (Force)");
    expect("node_graph_layout" in panel.data.config).toBe(false);
  });

  it("sankey: shows none of the node graph controls", async () => {
    mountPanel("sankey");
    await flushPromises();
    expect(has("dashboard-config-node_graph_layout")).toBe(false);
    expect(has("dashboard-config-node_graph_show_edge_labels")).toBe(false);
  });
});
