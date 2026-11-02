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

describe("ConfigPanel box plot settings", { timeout: 30_000 }, () => {
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
  const whiskerSelect = (): any =>
    wrapper!
      .findAllComponents({ name: "OSelect" })
      .find(
        (component: any) =>
          component.attributes("data-test") === "dashboard-config-boxplot_whisker",
      );
  const pick = async (test: string, value: string) => {
    const option = wrapper!.find(`[data-test="${test}-option"][data-test-label="${value}"]`);
    if (option.exists()) await option.trigger("click");
    else {
      const select: any = wrapper!
        .findAllComponents({ name: "OSelect" })
        .find((component: any) => component.attributes("data-test") === test);
      expect(select, test).toBeTruthy();
      const match = select.props("options").find((entry: any) => entry.label === value);
      select.vm.$emit("update:modelValue", match.value);
    }
    await flushPromises();
  };
  it("mounting writes no box plot key", async () => {
    const panel = mountPanel("boxplot");
    const before = JSON.stringify(panel.data.config);
    await flushPromises();
    expect(JSON.stringify(panel.data.config)).toBe(before);
  });

  it("box plot: writes the whisker mode", async () => {
    const panel = mountPanel("boxplot");
    await flushPromises();
    expect(isShown("dashboard-config-boxplot_whisker")).toBe(true);
    await pick("dashboard-config-boxplot_whisker", "1.5 × IQR");
    expect(panel.data.config.boxplot_whisker).toBe("iqr");
  });

  it("box plot: summarises in SQL, so the query limit shows no raw-row cap", async () => {
    mountPanel("boxplot");
    await flushPromises();
    expect(
      wrapper!.find('[data-test="dashboard-config-limit-field"]').attributes("placeholder"),
    ).toBe("0");
  });

  it("box plot: the Default whisker choice names min to max and picking it deletes the key", async () => {
    const panel = mountPanel("boxplot");
    await flushPromises();
    const options = whiskerSelect().props("options");
    expect(options[0].label).toBe("Default (Min to max)");
    await pick("dashboard-config-boxplot_whisker", "1.5 × IQR");
    expect(panel.data.config.boxplot_whisker).toBe("iqr");
    await pick("dashboard-config-boxplot_whisker", "Default (Min to max)");
    expect("boxplot_whisker" in panel.data.config).toBe(false);
  });

  it("pie: shows no whisker control", async () => {
    mountPanel("pie");
    await flushPromises();
    expect(has("dashboard-config-boxplot_whisker")).toBe(false);
    expect(
      wrapper!.find('[data-test="dashboard-config-limit-field"]').attributes("placeholder"),
    ).toBe("0");
  });
});
