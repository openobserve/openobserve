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
import { defineComponent, h } from "vue";

vi.mock("@/utils/dashboard/convertPanelData", () => ({
  convertPanelData: vi.fn(async (schema: any) => ({
    chartType: schema.type,
    options: {
      series: [
        ...["leaf", "spine"].map((name) => ({ name, type: "line", data: [[1, 5]] })),
        // The annotation holder a PromQL time series adds after its data series.
        { type: "line", data: [[1, null]], markLine: { data: [] }, markArea: { data: [] } },
      ],
    },
    extras: {},
  })),
}));

import OverrideConfigPopup from "@/components/dashboards/OverrideConfigPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const ChartRendererProbe = defineComponent({
  name: "ChartRenderer",
  props: { data: { type: Object, default: null } },
  setup: (props) => () =>
    h("div", { "data-test": "chart-renderer-probe" }, String(props.data?.options?.series?.length)),
});

let wrapper: any;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const entry = (value: string, config: any[] = []) => ({
  field: { matchBy: "series", value },
  config,
});

// Mounts the real dialog with the real SeriesFormatControls; only the ECharts canvas is replaced.
const mountPopup = async (
  chartType = "line",
  entries: any[] = [entry("spine")],
  data: any[] = [],
) => {
  wrapper = mount(OverrideConfigPopup, {
    attachTo: document.body,
    props: {
      open: true,
      mode: "chart",
      columns: [],
      overrideConfig: { overrideConfigs: entries },
      seriesNames: ["leaf", "spine"],
      chartType,
      previewSource: {
        panelSchema: { type: chartType, config: { line_thickness: 2.5 } },
        data,
      },
    },
    global: { plugins: [i18n, store], stubs: { ChartRenderer: ChartRendererProbe } },
  });
  await flushPromises();
  return wrapper;
};

const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;

const select = (dataTest: string) =>
  wrapper
    .findAllComponents({ name: "OSelect" })
    .find((c: any) => c.attributes("data-test") === dataTest);

const pick = async (dataTest: string, value: unknown) => {
  select(dataTest).vm.$emit("update:modelValue", value);
  await flushPromises();
};

const setInput = async (dataTest: string, value: string) => {
  const input = $(`[data-test="${dataTest}-field"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
};

const save = async () => {
  $('[data-test="override-config-popup-save"]')!.click();
  await flushPromises();
  return wrapper.emitted("save")?.[0]?.[0];
};

describe("OverrideConfigPopup series style", () => {
  it("writes every style setting the user sets, as Config items", async () => {
    await mountPopup();
    await pick("dashboard-series-format-draw-style", "line");
    await pick("dashboard-series-format-line-style", "dashed");
    await setInput("dashboard-series-format-line-width", "4");
    await setInput("dashboard-series-format-fill-opacity", "30");
    await pick("dashboard-series-format-show-points", "show");
    await setInput("dashboard-series-format-stack-group", "fabric");
    await pick("dashboard-series-format-y-axis", "right");
    $('[data-test="dashboard-series-format-hide-legend"] button')!.click();
    await flushPromises();

    expect(await save()).toEqual([
      entry("spine", [
        { type: "line_style", value: "dashed" },
        { type: "line_width", value: 4 },
        { type: "fill_opacity", value: 30 },
        { type: "show_points", value: true },
        { type: "draw_style", value: "line" },
        { type: "stack_group", value: "fabric" },
        { type: "y_axis", value: "right" },
        { type: "hide_from", value: { legend: true } },
      ]),
    ]);
  });

  it("shows a stored style and keeps it on save", async () => {
    const stored = entry("spine", [
      { type: "line_style", value: "dotted" },
      { type: "hide_from", value: { chart: true, tooltip: true } },
    ]);
    await mountPopup("line", [stored]);
    expect(select("dashboard-series-format-line-style").props("modelValue")).toBe("dotted");
    const checked = (target: string) =>
      $(`[data-test="dashboard-series-format-hide-${target}"] button`)!.getAttribute(
        "aria-checked",
      );
    expect(checked("chart")).toBe("true");
    expect(checked("legend")).toBe("false");
    expect(checked("tooltip")).toBe("true");
    expect(await save()).toEqual([stored]);
  });

  it("the panel line width is the line width placeholder; unset settings save nothing", async () => {
    await mountPopup();
    const width = $('[data-test="dashboard-series-format-line-width-field"]') as HTMLInputElement;
    expect(width.placeholder).toBe("2.5");
    expect(await save()).toEqual([]);
  });

  it("bar charts hide the line settings until the series is drawn as a line", async () => {
    await mountPopup("bar");
    expect($('[data-test="dashboard-series-format-line-row"]')).toBeNull();
    expect($('[data-test="dashboard-series-format-show-points"]')).toBeNull();
    await pick("dashboard-series-format-draw-style", "line");
    expect($('[data-test="dashboard-series-format-line-row"]')).not.toBeNull();
  });

  it("horizontal bars offer no y-axis side", async () => {
    await mountPopup("h-bar");
    expect($('[data-test="dashboard-series-format-draw-row"]')).not.toBeNull();
    expect(select("dashboard-series-format-y-axis")).toBeUndefined();
  });

  it("two remove clicks queued before the list re-renders remove both rules", async () => {
    await mountPopup("line", [entry("leaf"), entry("spine")]);
    const first = $('[data-test="series-override-remove-0"]')!;
    const second = $('[data-test="series-override-remove-1"]')!;
    first.click();
    second.click();
    await flushPromises();
    expect($('[data-test="series-override-row-0"]')).toBeNull();
  });

  it("the preview leaves out the empty annotation holder, so it draws only the real series", async () => {
    await mountPopup("line", [entry("spine")], [{ result: [] }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushPromises();
    expect($('[data-test="chart-renderer-probe"]')!.textContent).toBe("2");
  });

  it("pie charts show no style settings", async () => {
    await mountPopup("pie");
    expect($('[data-test="dashboard-series-format-draw-row"]')).toBeNull();
    expect($('[data-test="dashboard-series-format-hide-row"]')).toBeNull();
  });
});
