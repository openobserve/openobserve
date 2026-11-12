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

describe("ConfigPanel cartesian settings", { timeout: 30_000 }, () => {
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
  const selectFor = (test: string): any =>
    wrapper!
      .findAllComponents({ name: "OSelect" })
      .find((component: any) => component.attributes("data-test") === test);
  const optionLabels = (test: string): string[] => {
    const options = wrapper!.findAll(`[data-test="${test}-option"]`);
    if (options.length) return options.map((option) => option.attributes("data-test-label")!);
    return selectFor(test)
      .props("options")
      .map((option: any) => option.label);
  };
  // Segmented choices are buttons; the longer ones are selects.
  const pick = async (test: string, value: string) => {
    const option = wrapper!.find(`[data-test="${test}-option"][data-test-label="${value}"]`);
    if (option.exists()) await option.trigger("click");
    else {
      const select = selectFor(test);
      const match = select.props("options").find((entry: any) => entry.label === value);
      select.vm.$emit("update:modelValue", match.value);
    }
    await flushPromises();
  };
  const type = async (test: string, value: string) => {
    await wrapper!.find(`[data-test="${test}-field"]`).setValue(value);
    await flushPromises();
  };

  const LINE_CONTROLS = [
    "dashboard-config-tooltip_mode",
    "dashboard-config-tooltip_sort",
    "dashboard-config-y_axis_scale",
    "dashboard-config-y_axis_label",
    "dashboard-config-y_axis_hard_min",
    "dashboard-config-y_axis_hard_max",
    "dashboard-config-line_style",
    "dashboard-config-mark_area",
  ];

  it("shows the line controls on a line chart and hides the bar/stack ones", async () => {
    mountPanel("line");
    await flushPromises();
    for (const test of LINE_CONTROLS) expect(isShown(test), test).toBe(true);
    for (const test of [
      "dashboard-config-stack_mode",
      "dashboard-config-sort_order",
      "dashboard-config-bar_radius",
      "dashboard-config-scatter_size_field",
      "dashboard-config-connect_nulls_threshold",
    ]) {
      expect(has(test), test).toBe(false);
    }
  });

  it("shows stack mode on stacked charts and sort order and radius on bars", async () => {
    mountPanel("area-stacked");
    await flushPromises();
    expect(isShown("dashboard-config-stack_mode")).toBe(true);
    wrapper!.unmount();
    mountPanel("bar");
    await flushPromises();
    expect(isShown("dashboard-config-sort_order")).toBe(true);
    expect(isShown("dashboard-config-bar_radius")).toBe(true);
    expect(has("dashboard-config-line_style")).toBe(false);
  });

  it("mounting writes none of the new keys", async () => {
    const panel = mountPanel("line");
    const before = Object.keys(panel.data.config).sort();
    await flushPromises();
    expect(Object.keys(panel.data.config).sort()).toEqual(before);
  });

  it("picks a log scale, shows the base, and writes the keys", async () => {
    const panel = mountPanel("line");
    await flushPromises();
    expect(has("dashboard-config-y_axis_log_base")).toBe(false);
    await pick("dashboard-config-y_axis_scale", "Log");
    expect(panel.data.config.y_axis_scale).toBe("log");
    expect(has("dashboard-config-y_axis_log_base")).toBe(true);
  });

  it("writes tooltip, stack and line choices", async () => {
    const panel = mountPanel("area-stacked");
    await flushPromises();
    await pick("dashboard-config-tooltip_mode", "Single");
    await pick("dashboard-config-tooltip_sort", "Ascending");
    await pick("dashboard-config-stack_mode", "Percent");
    await pick("dashboard-config-line_style", "Dashed");
    expect(panel.data.config).toMatchObject({
      tooltip_mode: "single",
      tooltip_sort: "asc",
      stack_mode: "percent",
      line_style: "dashed",
    });
  });

  it("every choice starts on a Default that names its value, and picking Default drops the stored key", async () => {
    const panel = mountPanel("area-stacked");
    await flushPromises();
    const choices: [string, string, string, string, string][] = [
      ["dashboard-config-tooltip_mode", "tooltip_mode", "Default (All series)", "Single", "single"],
      ["dashboard-config-tooltip_sort", "tooltip_sort", "Default (Descending)", "Unsorted", "none"],
      ["dashboard-config-stack_mode", "stack_mode", "Default (Normal)", "Normal", "normal"],
      ["dashboard-config-line_style", "line_style", "Default (Solid)", "Solid", "solid"],
      ["dashboard-config-y_axis_scale", "y_axis_scale", "Default (Linear)", "Linear", "linear"],
    ];
    for (const [test, key, defaultLabel, label, value] of choices) {
      expect(optionLabels(test)[0], test).toBe(defaultLabel);
      await pick(test, label);
      expect(panel.data.config[key], test).toBe(value);
      await pick(test, defaultLabel);
      expect(key in panel.data.config, test).toBe(false);
    }
  });

  it("number and text fields show their default in the placeholder", async () => {
    mountPanel("bar");
    await flushPromises();
    const placeholder = (test: string) =>
      wrapper!.find(`[data-test="${test}-field"]`).attributes("placeholder");
    expect(placeholder("dashboard-config-bar_radius")).toBe("Default: 0");
    expect(placeholder("dashboard-config-y_axis_hard_min")).toBe("Default: auto from data");
    expect(placeholder("dashboard-config-y_axis_hard_max")).toBe("Default: auto from data");
    expect(placeholder("dashboard-config-y_axis_label")).toBe("Default: auto from data");
  });

  it("text and number fields drop their key when cleared", async () => {
    const panel = mountPanel("bar");
    await flushPromises();
    await type("dashboard-config-y_axis_label", "Requests");
    expect(panel.data.config.y_axis_label).toBe("Requests");
    await type("dashboard-config-y_axis_label", "");
    expect("y_axis_label" in panel.data.config).toBe(false);
    await type("dashboard-config-bar_radius", "4");
    expect(panel.data.config.bar_radius).toBe(4);
    await type("dashboard-config-bar_radius", "");
    expect("bar_radius" in panel.data.config).toBe(false);
  });

  it("shows the gap threshold only while connect nulls is on", async () => {
    const panel = mountPanel("line", { connect_nulls: true });
    await flushPromises();
    await type("dashboard-config-connect_nulls_threshold", "300");
    expect(panel.data.config.connect_nulls_threshold).toBe(300);
  });

  it("adds, edits and removes mark areas (real MarkAreaConfig)", async () => {
    const panel = mountPanel("line");
    await flushPromises();
    expect("mark_area" in panel.data.config).toBe(false);
    await wrapper!.find('[data-test="dashboard-config-mark-area-add"]').trigger("click");
    await flushPromises();
    await type("dashboard-config-mark-area-from-0", "10");
    await type("dashboard-config-mark-area-to-0", "20");
    expect(panel.data.config.mark_area).toEqual([
      { name: "", axis: "x", from: "10", to: "20", color: null },
    ]);
    await wrapper!.find('[data-test="dashboard-config-mark-area-remove-0"]').trigger("click");
    await flushPromises();
    expect("mark_area" in panel.data.config).toBe(false);
  });

  it("offers the scatter fields on SQL scatter only", async () => {
    mountPanel("scatter");
    await flushPromises();
    expect(isShown("dashboard-config-scatter_size_field")).toBe(true);
    expect(isShown("dashboard-config-scatter_color_field")).toBe(true);
    expect(has("dashboard-config-scatter_size_min")).toBe(false);
    wrapper!.unmount();
    mountPanel("scatter", {}, true);
    await flushPromises();
    expect(has("dashboard-config-scatter_size_field")).toBe(false);
  });
});
