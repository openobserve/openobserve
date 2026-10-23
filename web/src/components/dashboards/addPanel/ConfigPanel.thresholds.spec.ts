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
          fields: { breakdown: [] },
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

describe("ConfigPanel Thresholds section", { timeout: 30_000 }, () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  const mountPanel = (type: string, config: Record<string, unknown> = {}) => {
    const panel = makePanel(type, config);
    vi.mocked(useDashboardPanelData).mockReturnValue({
      dashboardPanelData: panel,
      promqlMode: false,
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

  const section = () => wrapper!.find('[data-test="dashboard-addpanel-config-thresholds-section"]');
  const count = () => wrapper!.find('[data-test="dashboard-addpanel-config-thresholds-count"]');

  it.each(["line", "area", "area-stacked", "bar", "h-bar", "scatter", "gauge", "metric"])(
    "shows on %s",
    async (type) => {
      mountPanel(type);
      await flushPromises();
      expect(section().exists()).toBe(true);
      expect(wrapper!.find('[data-test="dashboard-config-thresholds"]').exists()).toBe(true);
    },
  );

  it.each(["stacked", "h-stacked", "pie", "donut", "heatmap", "table"])(
    "is absent on %s",
    async (type) => {
      mountPanel(type);
      await flushPromises();
      expect(section().exists()).toBe(false);
    },
  );

  it("sits between Mark Lines and Background", async () => {
    mountPanel("metric");
    await flushPromises();
    const html = wrapper!.html();
    const thresholds = html.indexOf('data-test="dashboard-addpanel-config-thresholds-section"');
    expect(thresholds).toBeGreaterThan(-1);
    expect(html.indexOf("dashboard-config-color-mode")).toBeGreaterThan(thresholds);
    wrapper!.unmount();
    mountPanel("line");
    await flushPromises();
    const lineHtml = wrapper!.html();
    expect(lineHtml.indexOf("dashboard-addpanel-config-markline-info")).toBeLessThan(
      lineHtml.indexOf('data-test="dashboard-addpanel-config-thresholds-section"'),
    );
  });

  it("does not create the thresholds key on mount", async () => {
    const panel = mountPanel("line");
    await flushPromises();
    expect("thresholds" in panel.data.config).toBe(false);
    expect(count().exists()).toBe(false);
  });

  it("writes the key on the first step, counts steps, and deletes it with the last", async () => {
    const panel = mountPanel("line");
    await flushPromises();
    await wrapper!.find('[data-test="dashboard-config-thresholds-add-step"]').trigger("click");
    await flushPromises();
    const input = wrapper!.find('[data-test="dashboard-config-thresholds-step-0-value-field"]');
    await input.setValue("500");
    await flushPromises();
    expect(panel.data.config.thresholds).toEqual({
      mode: "absolute",
      showAs: "color_line",
      steps: [{ value: 500, color: expect.any(String) }],
    });
    expect(count().text()).toBe("1");
    await wrapper!.find('[data-test="dashboard-config-thresholds-step-0-remove"]').trigger("click");
    await flushPromises();
    expect("thresholds" in panel.data.config).toBe(false);
    expect(count().exists()).toBe(false);
  });

  it("passes coloured value mappings to the metric note", async () => {
    mountPanel("metric", { mappings: [{ type: "value", value: "1", color: "#ff0000" }] });
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-config-thresholds-mapping-note"]').exists()).toBe(
      true,
    );
    wrapper!.unmount();
    mountPanel("metric", { mappings: [{ type: "value", value: "1", text: "up" }] });
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-config-thresholds-mapping-note"]').exists()).toBe(
      false,
    );
  });

  it.each(["threshold", "limit", "limits", "thresholds"])(
    "is found by the config search for %j",
    async (term) => {
      mountPanel("line");
      await flushPromises();
      wrapper!.vm.searchQuery = term;
      await flushPromises();
      expect(section().isVisible()).toBe(true);
      wrapper!.vm.searchQuery = "legend";
      await flushPromises();
      expect(section().isVisible()).toBe(false);
    },
  );

  it.each(["format", "formatting"])("finds Series Overrides for %j", async (term) => {
    mountPanel("line");
    await flushPromises();
    wrapper!.vm.searchQuery = term;
    await flushPromises();
    expect(
      wrapper!.find('[data-test="dashboard-addpanel-config-series-overrides-section"]').isVisible(),
    ).toBe(true);
  });

  it("notes series overrides that have their own steps, even with no panel steps", async () => {
    mountPanel("line", {
      override_config: [
        {
          field: { matchBy: "series", value: "a" },
          config: [{ type: "thresholds", value: { steps: [{ value: 1, color: "#ef4444" }] } }],
        },
        {
          field: { matchBy: "series", value: "b" },
          config: [{ type: "series_color", value: "#ef4444" }],
        },
        {
          field: { matchBy: "series", value: "c" },
          config: [{ type: "thresholds", value: { steps: [{ value: 1, color: "#ef4444" }] } }],
        },
        {
          field: { matchBy: "name", value: "a" },
          config: [{ type: "unit", value: { unit: "bytes" } }],
        },
      ],
    });
    await flushPromises();
    const note = wrapper!.find('[data-test="dashboard-config-thresholds-overrides-note"]');
    expect(note.text()).toBe("2 series overrides have their own limits");
    wrapper!.unmount();
    mountPanel("line", {
      override_config: [
        {
          field: { matchBy: "series", value: "a" },
          config: [{ type: "thresholds", value: { steps: [{ value: 1, color: "#ef4444" }] } }],
        },
      ],
    });
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-config-thresholds-overrides-note"]').text()).toBe(
      "1 series override has its own limits",
    );
    wrapper!.unmount();
    mountPanel("line", {
      override_config: [
        {
          field: { matchBy: "series", value: "b" },
          config: [{ type: "series_color", value: "#ef4444" }],
        },
      ],
    });
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-config-thresholds-overrides-note"]').exists()).toBe(
      false,
    );
  });

  it('finds the Unit field for "units"', async () => {
    mountPanel("line");
    await flushPromises();
    wrapper!.vm.searchQuery = "units";
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-config-unit-trigger"]').isVisible()).toBe(true);
  });
});
