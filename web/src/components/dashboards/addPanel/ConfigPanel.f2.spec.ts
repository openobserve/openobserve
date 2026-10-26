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

describe(
  "ConfigPanel metric, gauge, pie, table, heatmap, state timeline and geomap settings",
  { timeout: 30_000 },
  () => {
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
    const isShown = (test: string) => {
      const el = wrapper!.find(`[data-test="${test}"]`);
      return el.exists() && el.isVisible();
    };
    const pick = async (test: string, value: string) => {
      await wrapper!
        .find(`[data-test="${test}-option"][data-test-label="${value}"]`)
        .trigger("click");
      await flushPromises();
    };
    const type = async (test: string, value: string) => {
      await wrapper!.find(`[data-test="${test}-field"]`).setValue(value);
      await flushPromises();
    };
    const emit = async (test: string, value: unknown) => {
      const control = wrapper!
        .findAllComponents({ name: "OSelect" })
        .concat(wrapper!.findAllComponents({ name: "OSwitch" }) as any)
        .find((component: any) => component.attributes("data-test") === test);
      expect(control, test).toBeTruthy();
      control!.vm.$emit("update:modelValue", value);
      await flushPromises();
    };

    it("mounting writes none of the new keys", async () => {
      for (const chart of [
        "metric",
        "gauge",
        "pie",
        "donut",
        "table",
        "heatmap",
        "state-timeline",
        "geomap",
      ]) {
        const panel = mountPanel(chart, { map_view: { lat: 0, lng: 0, zoom: 1 } });
        const before = JSON.stringify(panel.data.config);
        await flushPromises();
        expect(JSON.stringify(panel.data.config), chart).toBe(before);
        wrapper!.unmount();
        wrapper = undefined;
      }
    });

    it("metric: shows the change colour only while a change is on", async () => {
      const panel = mountPanel("metric");
      await flushPromises();
      for (const test of [
        "dashboard-config-stat_change",
        "dashboard-config-stat_text_mode",
        "dashboard-config-value_font_size",
      ]) {
        expect(isShown(test), test).toBe(true);
      }
      expect(has("dashboard-config-stat_change_color")).toBe(false);
      await pick("dashboard-config-stat_change", "Percent");
      expect(panel.data.config.stat_change).toBe("percent");
      expect(isShown("dashboard-config-stat_change_color")).toBe(true);
      await pick("dashboard-config-stat_change_color", "Down is good");
      await pick("dashboard-config-stat_text_mode", "Value and name");
      await type("dashboard-config-value_font_size", "48");
      expect(panel.data.config).toMatchObject({
        stat_change_color: "inverted",
        stat_text_mode: "value_and_name",
        value_font_size: 48,
      });
      await type("dashboard-config-value_font_size", "");
      expect("value_font_size" in panel.data.config).toBe(false);
    });

    it("gauge: writes the shape keys and drops the round cap when switched off", async () => {
      const panel = mountPanel("gauge");
      await flushPromises();
      await pick("dashboard-config-gauge_style", "Circle");
      await type("dashboard-config-gauge_segments", "8");
      await type("dashboard-config-gauge_neutral", "-5");
      await emit("dashboard-config-gauge_round_cap", true);
      expect(panel.data.config).toMatchObject({
        gauge_style: "circle",
        gauge_segments: 8,
        gauge_neutral: -5,
        gauge_round_cap: true,
      });
      await emit("dashboard-config-gauge_round_cap", false);
      expect("gauge_round_cap" in panel.data.config).toBe(false);
    });

    it("pie and donut: label parts, order, Other threshold and the donut hole", async () => {
      const panel = mountPanel("pie");
      await flushPromises();
      expect(has("dashboard-config-donut_inner_radius")).toBe(false);
      await emit("dashboard-config-pie_label_content", ["name", "percent"]);
      expect(panel.data.config.pie_label_content).toEqual(["name", "percent"]);
      await emit("dashboard-config-pie_label_content", []);
      expect("pie_label_content" in panel.data.config).toBe(false);
      await pick("dashboard-config-pie_sort_order", "Descending");
      await type("dashboard-config-pie_other_threshold", "5");
      expect(panel.data.config).toMatchObject({ sort_order: "desc", pie_other_threshold: 5 });
      wrapper!.unmount();
      const donut = mountPanel("donut");
      await flushPromises();
      await type("dashboard-config-donut_inner_radius", "60");
      expect(donut.data.config.donut_inner_radius).toBe(60);
    });

    it("table: density and footer on SQL, density only on PromQL", async () => {
      const panel = mountPanel("table");
      await flushPromises();
      await pick("dashboard-config-table_density", "Comfortable");
      await emit("dashboard-config-table_footer_calcs", ["sum", "max"]);
      expect(panel.data.config).toMatchObject({
        table_density: "comfortable",
        table_footer_calcs: ["sum", "max"],
      });
      wrapper!.unmount();
      mountPanel("table", {}, true);
      await flushPromises();
      expect(isShown("dashboard-config-table_density")).toBe(true);
      expect(has("dashboard-config-table_footer_calcs")).toBe(false);
    });

    it("heatmap and state timeline controls write their keys", async () => {
      const heatmap = mountPanel("heatmap");
      await flushPromises();
      await type("dashboard-config-heatmap_cell_gap", "2");
      await type("dashboard-config-heatmap_hide_below", "10");
      expect(heatmap.data.config).toMatchObject({ heatmap_cell_gap: 2, heatmap_hide_below: 10 });
      wrapper!.unmount();
      const timeline = mountPanel("state-timeline");
      await flushPromises();
      await pick("dashboard-config-state_value_align", "Center");
      expect(timeline.data.config.state_value_align).toBe("center");
    });

    it("geomap: the cluster size shows only while clustering is on", async () => {
      const panel = mountPanel("geomap", { map_view: { lat: 0, lng: 0, zoom: 1 } });
      await flushPromises();
      expect(has("dashboard-config-map_cluster_radius")).toBe(false);
      await emit("dashboard-config-map_cluster", true);
      expect(panel.data.config.map_cluster).toBe(true);
      await type("dashboard-config-map_cluster_radius", "60");
      expect(panel.data.config.map_cluster_radius).toBe(60);
      await emit("dashboard-config-map_cluster", false);
      expect("map_cluster" in panel.data.config).toBe(false);
    });
  },
);
