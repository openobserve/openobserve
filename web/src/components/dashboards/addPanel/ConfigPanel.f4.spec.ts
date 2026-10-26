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
  "ConfigPanel bar gauge, distribution, status history and treemap settings",
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
    const emitSwitch = async (test: string, value: unknown) => {
      const control = wrapper!
        .findAllComponents({ name: "OSwitch" })
        .find((component: any) => component.attributes("data-test") === test);
      expect(control, test).toBeTruthy();
      control!.vm.$emit("update:modelValue", value);
      await flushPromises();
    };

    it("mounting writes none of the new keys", async () => {
      for (const chart of ["bar-gauge", "distribution", "status-history", "treemap"]) {
        const panel = mountPanel(chart);
        const before = JSON.stringify(panel.data.config);
        await flushPromises();
        expect(JSON.stringify(panel.data.config), chart).toBe(before);
        wrapper!.unmount();
        wrapper = undefined;
      }
    });

    it("bar gauge: shares min and max with the gauge, and writes its own mode, orientation and unfilled keys", async () => {
      const panel = mountPanel("bar-gauge");
      await flushPromises();
      expect(isShown("dashboard-config-gauge-min")).toBe(true);
      expect(isShown("dashboard-config-gauge-max")).toBe(true);
      expect(isShown("dashboard-config-gauge_style")).toBe(false);
      expect(isShown("dashboard-config-gauge_round_cap")).toBe(false);
      await pick("dashboard-config-bar_gauge_mode", "Retro LCD");
      await pick("dashboard-config-bar_gauge_orientation", "Vertical");
      await emitSwitch("dashboard-config-bar_gauge_show_unfilled", false);
      expect(panel.data.config).toMatchObject({
        bar_gauge_mode: "lcd",
        bar_gauge_orientation: "vertical",
        bar_gauge_show_unfilled: false,
      });
      await emitSwitch("dashboard-config-bar_gauge_show_unfilled", true);
      expect("bar_gauge_show_unfilled" in panel.data.config).toBe(false);
    });

    it("gauge: hides the bar gauge controls", async () => {
      mountPanel("gauge");
      await flushPromises();
      expect(isShown("dashboard-config-gauge_style")).toBe(true);
      expect(isShown("dashboard-config-bar_gauge_mode")).toBe(false);
      expect(isShown("dashboard-config-bar_gauge_show_unfilled")).toBe(false);
    });

    it("distribution: writes the bucket keys, deletes a cleared one and locks the count while a size is set", async () => {
      const panel = mountPanel("distribution");
      await flushPromises();
      await type("dashboard-config-distribution_bucket_count", "12");
      await type("dashboard-config-distribution_bucket_offset", "0.5");
      expect(panel.data.config).toMatchObject({
        distribution_bucket_count: 12,
        distribution_bucket_offset: 0.5,
      });
      await type("dashboard-config-distribution_bucket_size", "50");
      expect(panel.data.config.distribution_bucket_size).toBe(50);
      expect(
        wrapper!
          .find('[data-test="dashboard-config-distribution_bucket_count-field"]')
          .attributes(),
      ).toHaveProperty("disabled");
      await type("dashboard-config-distribution_bucket_size", "");
      expect("distribution_bucket_size" in panel.data.config).toBe(false);
      expect(has("dashboard-config-treemap_show_breadcrumb")).toBe(false);
    });

    it("treemap: turning the breadcrumb off stores false and turning it on deletes the key", async () => {
      const panel = mountPanel("treemap");
      await flushPromises();
      expect(has("dashboard-config-distribution_bucket_count")).toBe(false);
      await emitSwitch("dashboard-config-treemap_show_breadcrumb", false);
      expect(panel.data.config.treemap_show_breadcrumb).toBe(false);
      await emitSwitch("dashboard-config-treemap_show_breadcrumb", true);
      expect("treemap_show_breadcrumb" in panel.data.config).toBe(false);
    });

    it("status history: shows its section with show values and the shared row settings, without merge gaps", async () => {
      const panel = mountPanel("status-history");
      await flushPromises();
      expect(wrapper!.text()).toContain("Status history");
      expect(isShown("dashboard-config-status_history_show_values")).toBe(true);
      expect(isShown("dashboard-config-state-timeline-row-height")).toBe(true);
      expect(isShown("dashboard-config-state_value_align")).toBe(true);
      expect(isShown("dashboard-config-state-timeline-merge-gaps")).toBe(false);
      expect(isShown("dashboard-config-state-timeline-show-state-text")).toBe(false);
      await emitSwitch("dashboard-config-status_history_show_values", false);
      expect(panel.data.config.status_history_show_values).toBe(false);
      await pick("dashboard-config-state_value_align", "Right");
      expect(panel.data.config.state_value_align).toBe("right");
    });

    it("state timeline: keeps its own controls and hides show values", async () => {
      mountPanel("state-timeline");
      await flushPromises();
      expect(isShown("dashboard-config-state-timeline-merge-gaps")).toBe(true);
      expect(isShown("dashboard-config-state-timeline-show-state-text")).toBe(true);
      expect(isShown("dashboard-config-status_history_show_values")).toBe(false);
    });
  },
);
