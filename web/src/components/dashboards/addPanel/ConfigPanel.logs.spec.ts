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

vi.mock("@/services/common", () => ({
  default: {
    list_Folders: vi.fn(async () => ({
      data: { list: [{ name: "Payments", folderId: "payments", description: "" }] },
    })),
  },
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
import { markPanelStarterQuery } from "@/composables/dashboard/usePanelAggregation";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

const makePanel = (type: string, config: Record<string, unknown> = {}) =>
  reactive<any>({
    data: {
      id: "panel-1",
      title: "Test Panel",
      description: "",
      type,
      queryType: "sql",
      queries: [
        {
          query: 'SELECT * FROM "demo_app"',
          customQuery: true,
          fields: { breakdown: [], x: [], y: [] },
          config: { time_shift: [], limit: 1000 },
        },
      ],
      config: {
        unit: null,
        unit_custom: "",
        trellis: { layout: null, num_of_columns: 1, group_by_y_axis: false },
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
      stream: {
        selectedStreamFields: [],
        customQueryFields: [{ name: "message" }, { name: "level" }, { name: "stack" }],
      },
    },
  });

describe("ConfigPanel logs settings", { timeout: 30_000 }, () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  const mountPanel = async (
    type: string,
    config: Record<string, unknown> = {},
    adjust: (panel: any) => void = () => {},
  ) => {
    const panel = makePanel(type, config);
    adjust(panel);
    vi.mocked(useDashboardPanelData).mockReturnValue({
      dashboardPanelData: panel,
      promqlMode: false,
      isPivotMode: computed(() => false),
      selectedStreamFields: [],
    } as any);
    store.state.selectedOrganization = { identifier: "test-org" };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = mount(ConfigPanel, {
      attachTo: document.body,
      props: { variablesData: { values: [] }, panelData: {} },
      global: {
        plugins: [i18n, store, [VueQueryPlugin, { queryClient }]],
        provide: { dashboardPanelDataPageKey: "dashboard" },
        stubs: {
          ColorBySeries: { template: "<div />" },
          OverrideConfig: { template: "<div />" },
          ValueMapping: { template: "<div />" },
        },
      },
    });
    // The section bodies are async components; wait for their imports before asserting.
    await vi.dynamicImportSettled();
    await flushPromises();
    return panel;
  };

  const has = (test: string) => wrapper!.find(`[data-test="${test}"]`).exists();
  const isShown = (test: string) => {
    const el = wrapper!.find(`[data-test="${test}"]`);
    return el.exists() && el.isVisible();
  };
  const selectFor = (test: string) =>
    wrapper!
      .findAllComponents({ name: "OSelect" })
      .find((component: any) => component.attributes("data-test") === test)!;
  const pick = async (test: string, value: string) => {
    const option = wrapper!.find(`[data-test="${test}-option"][data-test-label="${value}"]`);
    if (option.exists()) await option.trigger("click");
    else {
      const match = selectFor(test)
        .props("options")
        .find((entry: any) => entry.label === value);
      selectFor(test).vm.$emit("update:modelValue", match.value);
    }
    await flushPromises();
  };
  const emitFrom = async (name: string, test: string, value: unknown) => {
    const control = wrapper!
      .findAllComponents({ name })
      .find((component: any) => component.attributes("data-test") === test);
    expect(control, test).toBeTruthy();
    control!.vm.$emit("update:modelValue", value);
    await flushPromises();
  };

  it("mounting writes none of the new keys", async () => {
    for (const chart of ["logs"]) {
      const panel = await mountPanel(chart);
      const before = JSON.stringify(panel.data.config);
      await flushPromises();
      expect(JSON.stringify(panel.data.config), chart).toBe(before);
      wrapper!.unmount();
      wrapper = undefined;
    }
  });

  it("logs: shows only its own settings and the general section", async () => {
    await mountPanel("logs");
    expect(isShown("dashboard-config-logs_order")).toBe(true);
    expect(isShown("dashboard-config-logs_message_field")).toBe(true);
    expect(isShown("dashboard-config-description")).toBe(true);
    expect(isShown("dashboard-config-show-legend")).toBe(false);
    expect(isShown("dashboard-config-unit")).toBe(false);
  });

  it("logs: writes the order, field names and switches, and clearing a field deletes it", async () => {
    const panel = await mountPanel("logs");
    await pick("dashboard-config-logs_order", "Oldest first");
    await emitFrom("OCombobox", "dashboard-config-logs_message_field", " message ");
    await emitFrom("OSwitch", "dashboard-config-logs_wrap", true);
    await emitFrom("OSwitch", "dashboard-config-logs_show_time", false);
    await emitFrom("OSwitch", "dashboard-config-logs_prettify_json", false);
    expect(panel.data.config).toMatchObject({
      logs_order: "oldest",
      logs_message_field: "message",
      logs_wrap: true,
      logs_show_time: false,
      logs_prettify_json: false,
    });
    await emitFrom("OCombobox", "dashboard-config-logs_message_field", "");
    await emitFrom("OSwitch", "dashboard-config-logs_wrap", false);
    await emitFrom("OSwitch", "dashboard-config-logs_show_time", true);
    await emitFrom("OSwitch", "dashboard-config-logs_prettify_json", true);
    for (const key of ["logs_message_field", "logs_wrap", "logs_show_time", "logs_prettify_json"]) {
      expect(key in panel.data.config, key).toBe(false);
    }
  });

  it("logs: names each default — newest first for the order, auto from data for the fields", async () => {
    const panel = await mountPanel("logs");
    const labels = selectFor("dashboard-config-logs_order")
      .props("options")
      .map((option: any) => option.label);
    expect(labels[0]).toBe("Default (Newest first)");
    await pick("dashboard-config-logs_order", "Oldest first");
    await pick("dashboard-config-logs_order", "Default (Newest first)");
    expect("logs_order" in panel.data.config).toBe(false);
    const field = wrapper!
      .findAllComponents({ name: "OCombobox" })
      .find(
        (component: any) =>
          component.attributes("data-test") === "dashboard-config-logs_level_field",
      );
    expect(field!.props("placeholder")).toBe("Default (auto from data)");
  });

  it("logs: the order flips an untouched starter query and leaves hand-written SQL alone", async () => {
    const starter = 'SELECT * FROM "demo_app" ORDER BY _timestamp DESC LIMIT 100';
    const panel = await mountPanel("logs", {}, (draft) => {
      draft.data.queries[0].query = starter;
      markPanelStarterQuery(draft.data.queries[0]);
    });
    await pick("dashboard-config-logs_order", "Oldest first");
    expect(panel.data.queries[0].query).toBe(
      'SELECT * FROM "demo_app" ORDER BY _timestamp ASC LIMIT 100',
    );
    await pick("dashboard-config-logs_order", "Default (Newest first)");
    expect(panel.data.queries[0].query).toBe(starter);
    panel.data.queries[0].query = "SELECT * FROM \"demo_app\" WHERE level = 'error'";
    await pick("dashboard-config-logs_order", "Oldest first");
    expect(panel.data.queries[0].query).toBe("SELECT * FROM \"demo_app\" WHERE level = 'error'");
    expect(has("dashboard-config-logs_order-info")).toBe(true);
  });

  it("logs: offers the stream's columns when the query selects every column", async () => {
    await mountPanel("logs", {}, (panel) => {
      panel.data.queries[0].fields.stream = "demo_app";
      panel.meta.stream.customQueryFields = [];
      panel.meta.streamFields = {
        groupedFields: [
          {
            name: "demo_app",
            schema: [{ name: "_timestamp" }, { name: "level" }, { name: "message" }],
          },
          { name: "other_stream", schema: [{ name: "unrelated" }] },
        ],
      };
    });
    const combobox = wrapper!
      .findAllComponents({ name: "OCombobox" })
      .find(
        (component: any) =>
          component.attributes("data-test") === "dashboard-config-logs_message_field",
      );
    expect(combobox!.props("items").map((item: any) => item.value)).toEqual([
      "_timestamp",
      "level",
      "message",
    ]);
  });

  it("logs: offers only the query's named columns when it names them", async () => {
    await mountPanel("logs", {}, (panel) => {
      panel.meta.streamFields = { groupedFields: [{ name: "demo_app", schema: [{ name: "x" }] }] };
    });
    const combobox = wrapper!
      .findAllComponents({ name: "OCombobox" })
      .find(
        (component: any) =>
          component.attributes("data-test") === "dashboard-config-logs_level_field",
      );
    expect(combobox!.props("items").map((item: any) => item.value)).toEqual([
      "message",
      "level",
      "stack",
    ]);
  });

  it("other charts show none of the new controls", async () => {
    await mountPanel("line");
    for (const key of ["logs_order", "logs_message_field"]) {
      expect(has(`dashboard-config-${key}`), key).toBe(false);
    }
    expect(isShown("dashboard-config-show-legend")).toBe(true);
  });
});
