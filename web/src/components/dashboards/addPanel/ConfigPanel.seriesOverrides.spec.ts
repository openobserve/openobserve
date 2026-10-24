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

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { shouldShowSeriesOverrides } from "@/composables/dashboard/useConfigPanel";

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

const SERIES_TYPES = [
  "line",
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "stacked",
  "h-stacked",
  "scatter",
  "pie",
  "donut",
  "gauge",
  "metric",
];

describe("ConfigPanel Series Overrides section", { timeout: 30_000 }, () => {
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
          ThresholdsConfig: { template: "<div />" },
        },
      },
    });
    return panel;
  };

  const section = () =>
    wrapper!.find('[data-test="dashboard-addpanel-config-series-overrides-section"]');
  const count = () =>
    wrapper!.find('[data-test="dashboard-addpanel-config-series-overrides-count"]');
  const addButton = () =>
    wrapper!.find('[data-test="dashboard-addpanel-config-series-overrides-add-btn"]');
  const fieldOverridesButton = () =>
    wrapper!.find('[data-test="dashboard-addpanel-config-override-config-add-btn"]');

  it.each(SERIES_TYPES)("shows on %s with one Add series override button", async (type) => {
    mountPanel(type);
    await flushPromises();
    expect(section().exists()).toBe(true);
    expect(section().text()).toContain("Series Overrides");
    expect(addButton().text()).toBe("Add series override");
    expect(fieldOverridesButton().exists()).toBe(false);
  });

  // geomap is left out: its map section needs a full map config this fixture does not carry.
  it.each(["heatmap", "maps", "sankey", "table"])("is absent on %s", async (type) => {
    mountPanel(type);
    await flushPromises();
    expect(section().exists()).toBe(false);
  });

  it.each(["heatmap", "geomap", "sankey", "table", "html", "custom_chart"])(
    "is not offered for %s",
    (type) => {
      expect(shouldShowSeriesOverrides({ data: { type } })).toBe(false);
    },
  );

  it("leaves tables with their Column Formatting section", async () => {
    mountPanel("table");
    await flushPromises();
    expect(fieldOverridesButton().text()).toBe("Configure column formatting");
  });

  it("does not create the override_config key on mount and shows no chip", async () => {
    const panel = mountPanel("line");
    await flushPromises();
    expect("override_config" in panel.data.config).toBe(false);
    expect(count().exists()).toBe(false);
  });

  it("counts only the series entries of override_config on the header chip", async () => {
    const panel = mountPanel("line", {
      override_config: [
        { field: { matchBy: "series", value: "cart" }, config: [] },
        { field: { matchBy: "name", value: "latency" }, config: [] },
        { field: { matchBy: "series_regex", value: "^c" }, config: [] },
      ],
    });
    await flushPromises();
    expect(count().text()).toBe("2");
    expect(count().attributes("aria-label")).toBe("2 overrides");
    panel.data.config.override_config.pop();
    await flushPromises();
    expect(count().text()).toBe("1");
    panel.data.config.override_config.shift();
    await flushPromises();
    expect(count().exists()).toBe(false);
  });

  it("asks the editor to open the dialog", async () => {
    mountPanel("bar");
    await flushPromises();
    await addButton().trigger("click");
    expect(wrapper!.emitted("open-series-overrides")).toHaveLength(1);
    expect(wrapper!.emitted("open-field-overrides")).toBeUndefined();
  });

  it("sits before Thresholds on a line chart", async () => {
    mountPanel("line");
    await flushPromises();
    const html = wrapper!.html();
    const series = html.indexOf('data-test="dashboard-addpanel-config-series-overrides-section"');
    expect(series).toBeGreaterThan(-1);
    expect(
      html.indexOf('data-test="dashboard-addpanel-config-thresholds-section"'),
    ).toBeGreaterThan(series);
  });

  it.each(["series override", "override", "rename series", "series colour"])(
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
});
