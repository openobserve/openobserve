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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const makePanel = (panelTime: Record<string, unknown> = {}) =>
  reactive({
    data: {
      id: "panel-1",
      title: "Test Panel",
      description: "",
      type: "line",
      queries: [
        {
          query: "SELECT * FROM test",
          queryType: "sql",
          fields: { breakdown: [] },
          config: { time_shift: [], limit: 1000 },
        },
      ],
      config: {
        unit: null,
        unit_custom: "",
        step_value: 0,
        top_results: 10,
        trellis: { layout: "horizontal", num_of_columns: 1, group_by_y_axis: false },
        legend_width: { value: null, unit: "px" },
        label_option: { position: null, rotate: 0 },
        map_type: { type: "world" },
        base_map: { type: "osm" },
        map_symbol_style: { size: "by Value", size_by_value: { min: 1, max: 100 }, size_fixed: 2 },
        ...panelTime,
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

describe("ConfigPanel panel-specific time range (real picker)", { timeout: 30_000 }, () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    store.state.timezone = "UTC";
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const mountPanel = (panelTime: Record<string, unknown> = {}) => {
    const panel = makePanel(panelTime);
    vi.mocked(useDashboardPanelData).mockReturnValue({
      dashboardPanelData: panel,
      promqlMode: false,
      isPivotMode: computed(() => false),
      selectedStreamFields: [],
    } as any);
    store.state.selectedOrganization = { identifier: "test-org" };
    wrapper = mount(ConfigPanel, {
      attachTo: document.body,
      props: {
        dashboardPanelData: panel,
        variablesData: { values: [] },
        panelData: {},
        promqlMode: false,
        colorBySeriesData: {},
        panelSchema: {},
        overrideConfig: {},
        valueMappingData: [],
      },
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

  const el = (dataTest: string) =>
    document.body.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  const pickerLabel = () =>
    document.body
      .querySelector('[data-test="dashboard-config-panel-time-picker"] .date-time-label')
      ?.textContent?.trim();

  it("stores a calendar range picked in the panel picker as the panel's own time", async () => {
    const panel = mountPanel();
    await flushPromises();

    el("dashboard-config-allow-panel-time")!
      .querySelector<HTMLElement>('[data-test$="-btn"]')!
      .click();
    await flushPromises();
    el("dashboard-config-set-panel-time")!.click();
    await flushPromises();
    expect(panel.data.config.panel_time_enabled).toBe(true);

    document.body
      .querySelector<HTMLElement>(
        '[data-test="dashboard-config-panel-time-picker"] #date-time-button',
      )!
      .click();
    await flushPromises();
    el("date-time-rail-calendar-last-week")!.click();
    await flushPromises();

    expect(panel.data.config.panel_time_range).toEqual({
      type: "relative",
      relativeTimePeriod: "calendar:week:-1",
    });
    expect(pickerLabel()).toBe("Last week");
  });

  it("shows a saved calendar range in the panel picker when the panel is edited again", async () => {
    mountPanel({
      panel_time_enabled: true,
      panel_time_range: { type: "relative", relativeTimePeriod: "calendar:week:-1" },
    });
    await flushPromises();

    expect(pickerLabel()).toBe("Last week");
  });
});
