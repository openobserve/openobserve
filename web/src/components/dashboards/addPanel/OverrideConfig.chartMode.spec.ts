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
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({ default: vi.fn() }));

import OverrideConfig from "@/components/dashboards/addPanel/OverrideConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

const makePanel = (type: string, config: Record<string, unknown> = {}) =>
  reactive<any>({
    data: {
      type,
      queries: [{ fields: { x: [], y: [{ alias: "count", label: "Count" }] } }],
      config: { unit: "milliseconds", decimals: 2, ...config },
    },
    layout: { currentQueryIndex: 0 },
    meta: {},
  });

const legendOptions = {
  options: { series: [{ name: "checkout" }, { name: "cart" }, { name: "search" }] },
};

let wrapper: any;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const mountConfig = (panel: any, props: Record<string, unknown> = {}) => {
  vi.mocked(useDashboardPanelData).mockReturnValue({
    dashboardPanelData: panel,
    promqlMode: ref(false),
    fetchPromQLLabels: vi.fn(),
  } as any);
  wrapper = mount(OverrideConfig, {
    attachTo: document.body,
    props: { mode: "chart", panelData: legendOptions, ...props },
    global: {
      plugins: [i18n, store],
      provide: { dashboardPanelDataPageKey: "dashboard" },
      stubs: { ChartRenderer: { template: "<div />" } },
    },
  });
  return wrapper;
};

const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;

const openDialog = async () => {
  await wrapper.vm.openOverrideConfigPopup();
  await flushPromises();
};

const addFromLegend = async (name: string) => {
  const trigger = $('[data-test="dashboard-series-format-add-empty-trigger"]')!;
  trigger.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
  $(`[data-test="dashboard-series-format-add-empty-name"][data-series-name="${name}"]`)!.click();
  await flushPromises();
};

const click = async (dataTest: string) => {
  $(`[data-test="${dataTest}"]`)!.click();
  await flushPromises();
};

const tableEntry = () => ({
  field: { matchBy: "name", value: "latency" },
  config: [{ type: "unit", value: { unit: "bytes", customUnit: "" } }],
});
const seriesEntry = (value: string, config: any[], matchBy = "series") => ({
  field: { matchBy, value },
  config,
});

describe("OverrideConfig in chart mode with the real dialog", () => {
  it("writes nothing to the panel config on mount", async () => {
    const panel = makePanel("line");
    mountConfig(panel);
    await flushPromises();
    expect("override_config" in panel.data.config).toBe(false);
  });

  it("opens Series Formatting with the panel's legend series", async () => {
    mountConfig(makePanel("line"));
    await openDialog();
    expect(document.body.textContent).toContain("Series Formatting");
    expect(wrapper.findComponent({ name: "OverrideConfigPopup" }).props("seriesNames")).toEqual([
      "checkout",
      "cart",
      "search",
    ]);
  });

  it("saves a picked series as an override_config series entry", async () => {
    const panel = makePanel("bar");
    mountConfig(panel);
    await openDialog();
    await addFromLegend("cart");
    const input = $('[data-test="dashboard-series-format-display-name-field"]') as HTMLInputElement;
    input.value = "Basket";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    await click("override-config-popup-save");

    expect(panel.data.config.override_config).toEqual([
      seriesEntry("cart", [{ type: "display_name", value: "Basket" }]),
    ]);
    expect(wrapper.vm.showOverrideConfigPopup).toBe(false);
  });

  it("keeps the table entries in place when the chart dialog saves", async () => {
    const table = tableEntry();
    const panel = makePanel("line", {
      override_config: [table, seriesEntry("^c", [{ type: "decimals", value: 1 }], "series_regex")],
    });
    mountConfig(panel);
    await openDialog();
    await click("series-override-remove-0");
    await click("override-config-popup-save");
    expect(panel.data.config.override_config).toEqual([table]);
  });

  it("keeps the series entries when the table dialog saves", async () => {
    const series = seriesEntry("api", [{ type: "series_color", value: "#123456" }]);
    const panel = makePanel("table", { override_config: [tableEntry(), series] });
    mountConfig(panel, { mode: "table", panelData: {} });
    await openDialog();
    expect(document.body.textContent).toContain("Column Formatting");
    expect(document.querySelectorAll('[data-test^="override-config-row-"]')).toHaveLength(1);
    await click("override-config-popup-save");
    expect(panel.data.config.override_config).toEqual([tableEntry(), series]);
  });

  it("leaves the key absent when a panel without it saves no overrides", async () => {
    const panel = makePanel("line");
    mountConfig(panel);
    await openDialog();
    await click("override-config-popup-save");
    expect("override_config" in panel.data.config).toBe(false);
  });

  it("keeps the stored list when the dialog is cancelled", async () => {
    const stored = [seriesEntry("cart", [{ type: "series_color", value: "#123456" }])];
    const panel = makePanel("line", { override_config: stored });
    mountConfig(panel);
    await openDialog();
    await click("series-override-remove-0");
    await click("override-config-popup-cancel");
    expect(panel.data.config.override_config).toEqual([
      seriesEntry("cart", [{ type: "series_color", value: "#123456" }]),
    ]);
  });

  it("still initialises override_config on mount in table mode", async () => {
    const panel = makePanel("table");
    mountConfig(panel, { mode: "table", panelData: {} });
    await flushPromises();
    expect(panel.data.config.override_config).toEqual([]);
    await openDialog();
    expect(document.body.textContent).toContain("Column Formatting");
    await click("override-config-popup-save");
    expect(panel.data.config.override_config).toEqual([]);
  });
});
