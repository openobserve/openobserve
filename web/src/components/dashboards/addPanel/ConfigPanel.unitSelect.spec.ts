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

const makePanel = (unit: string | null) =>
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
        unit,
        unit_custom: "",
        step_value: 0,
        top_results: 10,
        trellis: { layout: "horizontal", num_of_columns: 1, group_by_y_axis: false },
        legend_width: { value: null, unit: "px" },
        label_option: { position: null, rotate: 0 },
        map_type: { type: "world" },
        base_map: { type: "osm" },
        map_symbol_style: { size: "by Value", size_by_value: { min: 1, max: 100 }, size_fixed: 2 },
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

describe("ConfigPanel Unit select (real OSelect)", { timeout: 30_000 }, () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  const mountPanel = (unit: string | null) => {
    const panel = makePanel(unit);
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

  const trigger = () => wrapper!.find('[data-test="dashboard-config-unit-trigger"]');
  const searchInput = () =>
    document.body.querySelector<HTMLInputElement>('[data-test="dashboard-config-unit-search"]');
  const optionValues = () =>
    [
      ...document.body.querySelectorAll<HTMLElement>('[data-test="dashboard-config-unit-option"]'),
    ].map((el) => el.dataset.testValue);
  const option = (value: string) =>
    document.body.querySelector<HTMLElement>(
      `[data-test="dashboard-config-unit-option"][data-test-value="${value}"]`,
    );
  const popoverText = () =>
    document.body.querySelector('[data-test="dashboard-config-unit-popover"]')?.textContent ?? "";

  // The panel focuses its settings search after mount; opening before that lands loses the popover to focus-outside.
  const open = async () => {
    await flushPromises();
    await trigger().trigger("click");
    await flushPromises();
  };
  const search = async (term: string) => {
    const input = searchInput()!;
    input.value = term;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };

  it("shows the group headers and the 1024 scale in the binary labels", async () => {
    mountPanel(null);
    await open();
    const text = popoverText();
    for (const header of [
      "Number",
      "Data",
      "Data rate",
      "Throughput",
      "Time",
      "Percent",
      "Currency",
    ]) {
      expect(text).toContain(header);
    }
    expect(option("bytes")!.dataset.testLabel).toBe("Bytes (1024)");
    expect(option("kilobytes")!.dataset.testLabel).toBe("Kilobytes (KB, 1024)");
    expect(option("megabytes")!.dataset.testLabel).toBe("Megabytes (MB, 1024)");
    expect(option("bps")!.dataset.testLabel).toBe("Bytes/Second (1024)");
    expect(option("bytes")!.textContent!.trim()).toBe("Bytes (1024)");
    expect(option("bytes")!.querySelector(".font-medium")).toBeNull();
  });

  it.each([
    ["1024", ["bytes", "kilobytes", "megabytes", "bps"]],
    ["kilo", ["kilobytes", "kilobytes-si"]],
    ["req", ["req-per-sec", "req-per-min"]],
    ["si", ["bytes-si", "kilobytes-si", "megabytes-si", "bits", "bps-si", "bits-per-sec"]],
    ["bit", ["bits", "bits-per-sec"]],
    ["min", ["req-per-min", "ops-per-min", "events-per-min", "per-min", "minutes"]],
  ])("searching %j finds the new units", async (term, values) => {
    mountPanel(null);
    await open();
    await search(term);
    const found = optionValues();
    for (const value of values) expect(found).toContain(value);
  });

  it("shows the empty state, not a lone Number header, when only Other Locale matches", async () => {
    mountPanel(null);
    await open();
    await search("other");
    expect(optionValues()).toEqual([]);
    expect(popoverText()).not.toContain("Number");
    expect(popoverText()).toContain("No options found");
  });

  it("saves a new unit picked from the search results", async () => {
    const panel = mountPanel(null);
    await open();
    await search("req");
    option("req-per-sec")!.click();
    await flushPromises();
    expect(panel.data.config.unit).toBe("req-per-sec");
    expect(trigger().attributes("data-test-selected-label")).toBe("Requests/sec (req/s)");
  });

  it("keeps the Other Locale row expandable inside the Number group", async () => {
    mountPanel(null);
    await open();
    const row = document.body.querySelector<HTMLElement>(
      '[data-test="dashboard-config-unit-expand"]',
    )!;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(option("locale:cs-CZ")).toBeNull();
    row.click();
    await flushPromises();
    expect(option("locale:cs-CZ")).not.toBeNull();
    expect(option("locale:cs-CZ")!.classList.contains("ps-7")).toBe(true);
  });

  it("opens with a pinned locale's group expanded", async () => {
    mountPanel("locale:de-DE");
    await open();
    expect(option("locale:de-DE")).not.toBeNull();
    expect(trigger().attributes("data-test-selected-label")).toBe("German - DE (de_DE)");
  });

  it("shows a binary unit with its scale in the label", () => {
    mountPanel("bytes");
    expect(trigger().attributes("data-test-selected-label")).toBe("Bytes (1024)");
  });
});
