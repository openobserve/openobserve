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

describe("ConfigPanel chart type settings", { timeout: 30_000 }, () => {
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
  const has = (test: string) => wrapper!.find(`[data-test="${test}"]`).exists();
  const select = (test: string) =>
    wrapper!
      .findAllComponents({ name: "OSelect" })
      .find((c: any) => c.attributes("data-test") === test);
  const type = async (test: string, value: string) => {
    await wrapper!.find(`[data-test="${test}-field"]`).setValue(value);
    await flushPromises();
  };
  const emitSwitch = async (test: string, value: unknown) => {
    const control = wrapper!
      .findAllComponents({ name: "OSwitch" })
      .find((component: any) => component.attributes("data-test") === test);
    control!.vm.$emit("update:modelValue", value);
    await flushPromises();
  };

  it("mounting a bar gauge writes none of the new keys", async () => {
    const panel = mountPanel("bar-gauge");
    const before = JSON.stringify(panel.data.config);
    await flushPromises();
    expect(JSON.stringify(panel.data.config)).toBe(before);
  });

  it("bar gauge: scales to its data by default and shows min and max only once Fixed is picked", async () => {
    const panel = mountPanel("bar-gauge");
    await flushPromises();
    const rangeMode = wrapper!
      .findAllComponents({ name: "OSelect" })
      .find((c: any) => c.attributes("data-test") === "dashboard-config-bar-gauge-range-mode");
    expect(rangeMode, "range mode select").toBeTruthy();
    expect(isShown("dashboard-config-bar-gauge-range-mode")).toBe(true);
    expect(isShown("dashboard-config-gauge-range-mode")).toBe(false);
    expect(isShown("dashboard-config-gauge-max")).toBe(false);
    rangeMode!.vm.$emit("update:modelValue", "fixed");
    await flushPromises();
    expect(panel.data.queries[0].config.range_mode).toBe("fixed");
    expect(isShown("dashboard-config-gauge-min")).toBe(true);
    expect(isShown("dashboard-config-gauge-max")).toBe(true);
    rangeMode!.vm.$emit("update:modelValue", "__auto__");
    await flushPromises();
    expect("range_mode" in panel.data.queries[0].config).toBe(false);
    expect(isShown("dashboard-config-gauge-max")).toBe(false);
  });

  it("bar gauge: writes its own mode, orientation and unfilled keys", async () => {
    const panel = mountPanel("bar-gauge");
    await flushPromises();
    expect(isShown("dashboard-config-gauge_style")).toBe(false);
    expect(isShown("dashboard-config-gauge_round_cap")).toBe(false);
    select("dashboard-config-bar_gauge_mode")!.vm.$emit("update:modelValue", "lcd");
    select("dashboard-config-bar_gauge_orientation")!.vm.$emit("update:modelValue", "vertical");
    await flushPromises();
    await emitSwitch("dashboard-config-bar_gauge_show_unfilled", false);
    expect(panel.data.config).toMatchObject({
      bar_gauge_mode: "lcd",
      bar_gauge_orientation: "vertical",
      bar_gauge_show_unfilled: false,
    });
    await emitSwitch("dashboard-config-bar_gauge_show_unfilled", true);
    expect("bar_gauge_show_unfilled" in panel.data.config).toBe(false);
    select("dashboard-config-bar_gauge_mode")!.vm.$emit("update:modelValue", "__auto__");
    await flushPromises();
    expect("bar_gauge_mode" in panel.data.config).toBe(false);
  });

  it("bar gauge: each Default choice names what an unset option falls back to", async () => {
    mountPanel("bar-gauge");
    await flushPromises();
    const firstLabel = (test: string) => select(test)!.props("options")[0].label;
    expect(firstLabel("dashboard-config-bar_gauge_mode")).toBe("Default (Gradient)");
    expect(firstLabel("dashboard-config-bar_gauge_orientation")).toBe("Default (Horizontal)");
    expect(firstLabel("dashboard-config-bar-gauge-range-mode")).toBe("Default (auto from data)");
  });

  it("gauge: hides the bar gauge controls", async () => {
    mountPanel("gauge");
    await flushPromises();
    expect(isShown("dashboard-config-gauge_style")).toBe(true);
    expect(isShown("dashboard-config-bar_gauge_mode")).toBe(false);
    expect(isShown("dashboard-config-bar_gauge_show_unfilled")).toBe(false);
  });

  it("state timeline: keeps its own controls and writes the value alignment", async () => {
    const panel = mountPanel("state-timeline");
    await flushPromises();
    expect(isShown("dashboard-config-state-timeline-merge-gaps")).toBe(true);
    expect(isShown("dashboard-config-state-timeline-show-state-text")).toBe(true);
    expect(isShown("dashboard-config-state_value_align")).toBe(true);
    await pick("dashboard-config-state_value_align", "Right");
    expect(panel.data.config.state_value_align).toBe("right");
    expect(has("dashboard-config-state-timeline-row-gap")).toBe(true);
    await type("dashboard-config-state-timeline-merge-gaps", "30");
    expect(panel.data.config.merge_gaps).toBe(30);
    await emitSwitch("dashboard-config-state-timeline-show-state-text", false);
    expect(panel.data.config.show_state_text).toBe(false);
  });
});
