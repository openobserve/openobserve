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
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

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

// The converters are the render builder's; here they only echo the schema they were given.
const { convertPanelData, echoSchema } = vi.hoisted(() => {
  const echo = async (schema: any) => ({
    chartType: schema.type,
    options: {
      series: ["checkout", "cart", "search"].map((name) => ({ name, type: "line", data: [] })),
      seriesOverrides: (schema.config?.override_config ?? []).filter((e: any) =>
        String(e?.field?.matchBy).startsWith("series"),
      ),
    },
    extras: {},
  });
  return { convertPanelData: vi.fn(echo), echoSchema: echo };
});
vi.mock("@/utils/dashboard/convertPanelData", () => ({ convertPanelData }));

import OverrideConfigPopup from "@/components/dashboards/OverrideConfigPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ECharts can not draw in JSDOM; the probe shows what the preview would render.
const ChartRendererProbe = defineComponent({
  name: "ChartRenderer",
  props: { data: { type: Object, default: null }, renderType: { type: String, default: "" } },
  setup(props) {
    return () =>
      h(
        "pre",
        { "data-test": "chart-renderer-probe", "data-render-type": props.renderType },
        JSON.stringify(props.data?.options?.seriesOverrides ?? null),
      );
  },
});

const LEGEND = ["checkout", "cart", "search"];

let wrapper: any;

beforeEach(() => {
  convertPanelData.mockReset();
  convertPanelData.mockImplementation(echoSchema);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

// A series entry of override_config in the stored shape.
const series = (value: string, config: any[] = [], matchBy = "series") => ({
  field: { matchBy, value },
  config,
});

const mountChart = async (props: Record<string, unknown> = {}) => {
  const { entries = [], ...rest } = props as { entries?: any[] };
  wrapper = mount(OverrideConfigPopup, {
    attachTo: document.body,
    props: {
      open: true,
      mode: "chart",
      columns: [],
      overrideConfig: { overrideConfigs: entries },
      seriesNames: LEGEND,
      chartType: "line",
      panelUnit: "milliseconds",
      panelDecimals: 2,
      ...rest,
    },
    global: {
      plugins: [i18n, store],
      stubs: { ChartRenderer: ChartRendererProbe },
    },
  });
  await flushPromises();
  return wrapper;
};

const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const $$ = (selector: string) => Array.from(document.querySelectorAll(selector)) as HTMLElement[];

const setInput = async (dataTest: string, value: string) => {
  const input = $(`[data-test="${dataTest}-field"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await flushPromises();
};

const openAddMenu = async (dataTest = "dashboard-series-format-add") => {
  const trigger = $(`[data-test="${dataTest}-trigger"]`)!;
  trigger.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
};

const pickMenuItem = async (element: HTMLElement) => {
  element.click();
  await flushPromises();
};

const matchLine = () => $('[data-test="dashboard-series-format-match-line"]');

const save = async () => {
  $('[data-test="override-config-popup-save"]')!.click();
  await flushPromises();
};

const waitForPreview = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  await flushPromises();
};

describe("OverrideConfigPopup in chart mode", () => {
  it("opens as Series Formatting with the empty states", async () => {
    await mountChart();
    expect(document.body.textContent).toContain("Series Formatting");
    expect(document.body.textContent).toContain(
      "Add the series you want to format, then style each one with a live preview.",
    );
    expect(document.body.textContent).toContain("No series added");
    expect(document.body.textContent).toContain("Format a series");
    expect(document.body.textContent).toContain("No series formatted yet");
    expect(document.body.textContent).not.toContain("Column Formatting");
  });

  it("adds a series picked from the legend list with a Name badge and a live match line", async () => {
    await mountChart();
    await openAddMenu();
    const items = $$('[data-test="dashboard-series-format-add-name"]');
    expect(items.map((el) => el.getAttribute("data-series-name"))).toEqual(LEGEND);
    const menuText = $('[data-test="dashboard-series-format-add-menu"]')!.textContent!;
    expect(menuText.indexOf("Match by regex…")).toBeLessThan(menuText.indexOf("checkout"));

    await pickMenuItem(items[0]);

    expect($('[data-test="series-override-row-0-badge"]')!.textContent!.trim()).toBe("Name");
    expect($('[data-test="series-override-row-0"]')!.textContent).toContain("checkout");
    expect(matchLine()!.getAttribute("data-state")).toBe("some");
    expect(matchLine()!.textContent).toContain("Matches 1 of 3: checkout");
    expect(document.body.textContent).toContain("1 series formatted");
  });

  it("offers each legend name once and filters the list by the search box", async () => {
    await mountChart({ entries: [series("cart")] });
    await openAddMenu();
    expect(
      $$('[data-test="dashboard-series-format-add-name"]').map((el) => el.textContent?.trim()),
    ).toEqual(["checkout", "search"]);
    await setInput("dashboard-series-format-add-search", "sea");
    expect(
      $$('[data-test="dashboard-series-format-add-name"]').map((el) => el.textContent?.trim()),
    ).toEqual(["search"]);
  });

  it("adds a regex override and shows how many legend series it matches", async () => {
    await mountChart();
    await openAddMenu();
    await pickMenuItem($('[data-test="dashboard-series-format-add-regex"]')!);

    expect($('[data-test="series-override-row-0-badge"]')!.textContent!.trim()).toBe("Regex");
    expect($('[data-test="series-override-row-0"]')!.textContent).toContain("Type a pattern");

    await setInput("dashboard-series-format-match-value", "^c");
    expect(matchLine()!.textContent).toContain("Matches 2 of 3: checkout, cart");

    await setInput("dashboard-series-format-match-value", "^zzz");
    expect(matchLine()!.getAttribute("data-state")).toBe("none");
    expect(matchLine()!.textContent).toContain("Matches 0 of 3. Nothing will change.");
  });

  it("switches an exact match to a regex match", async () => {
    await mountChart({ entries: [series("^c")] });
    expect(matchLine()!.getAttribute("data-state")).toBe("none");
    $('[data-test="dashboard-series-format-match-regex"]')!.click();
    await flushPromises();
    expect($('[data-test="series-override-row-0-badge"]')!.textContent!.trim()).toBe("Regex");
    expect(matchLine()!.textContent).toContain("Matches 2 of 3: checkout, cart");
  });

  it("shows an inline error for an invalid regex and keeps the dialog open on Save", async () => {
    await mountChart({ entries: [series("cart", [{ type: "series_color", value: "#ff0000" }])] });
    await openAddMenu();
    await pickMenuItem($('[data-test="dashboard-series-format-add-regex"]')!);
    await setInput("dashboard-series-format-match-value", "(?=a)b");

    expect(document.body.textContent).toContain("This pattern is invalid or not supported.");
    expect(matchLine()).toBeNull();

    $('[data-test="series-override-row-0"]')!.click();
    await flushPromises();
    await save();
    expect(wrapper.emitted("save")).toBeUndefined();
    expect($('[data-test="series-override-row-1"]')!.className).toContain("bg-accent/6");
  });

  it("writes the display name, unit, decimals and colour, and only the settings that are set", async () => {
    await mountChart();
    await openAddMenu();
    await pickMenuItem($$('[data-test="dashboard-series-format-add-name"]')[1]);

    await setInput("dashboard-series-format-display-name", "  Cart  ");
    await setInput("dashboard-series-format-decimals", "1");
    wrapper.findComponent({ name: "SeriesFormatControls" }).vm.$emit("update", {
      unit: "seconds",
    });
    await flushPromises();
    $('[data-test="dashboard-series-format-color-swatch-2"]')!.click();
    await flushPromises();

    await save();
    const saved = wrapper.emitted("save")[0][0];
    expect(saved).toEqual([
      {
        field: { matchBy: "series", value: "cart" },
        config: [
          { type: "unit", value: { unit: "seconds", customUnit: "" } },
          { type: "decimals", value: 1 },
          { type: "display_name", value: "Cart" },
          { type: "series_color", value: expect.stringMatching(/^#|^rgb/) },
        ],
      },
    ]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("selects the unit from the grouped list and names the panel unit for Default", async () => {
    await mountChart({ entries: [series("cart")] });
    const unitSelect = wrapper
      .findAllComponents({ name: "OSelect" })
      .find((c: any) => c.attributes("data-test") === "dashboard-series-format-unit");
    const options = unitSelect.props("options");
    expect(options).toContainEqual(
      expect.objectContaining({ value: null, label: "Inherit: Milliseconds (ms)" }),
    );
    expect(options).toContainEqual(expect.objectContaining({ label: "Throughput", header: true }));
    expect(options).toContainEqual(expect.objectContaining({ value: "req-per-sec" }));
  });

  it("labels the Decimals field beside the unit and shows the inherited value as placeholder", async () => {
    await mountChart({ entries: [series("cart")], panelDecimals: 3 });
    const input = $('[data-test="dashboard-series-format-decimals-field"]') as HTMLInputElement;
    expect(input.placeholder).toBe("3");
    const label = $('[data-test="dashboard-series-format-decimals-label"]') as HTMLLabelElement;
    expect(label.textContent!.trim()).toBe("Decimals");
    expect(label.htmlFor).toBe(input.id);
    expect(label.className).not.toContain("sr-only");
  });

  it("notes that the axis keeps the panel unit only when the unit family differs", async () => {
    await mountChart({
      entries: [series("cart", [{ type: "unit", value: { unit: "seconds", customUnit: "" } }])],
    });
    expect($('[data-test="dashboard-series-format-axis-note"]')).toBeNull();
    wrapper.findComponent({ name: "SeriesFormatControls" }).vm.$emit("update", {
      unit: "bytes",
    });
    await flushPromises();
    expect($('[data-test="dashboard-series-format-axis-note"]')!.textContent).toContain(
      "Axis stays in Milliseconds (ms); this unit shows in tooltip and legend.",
    );
  });

  it("offers None for the colour and saves no colour when None is picked", async () => {
    await mountChart({ entries: [series("cart", [{ type: "series_color", value: "#123456" }])] });
    expect($('[data-test="dashboard-series-format-color-caption"]')).toBeNull();
    $('[data-test="dashboard-series-format-color-none"]')!.click();
    await flushPromises();
    expect($('[data-test="dashboard-series-format-color-caption"]')!.textContent).toContain(
      "None: the series keeps its color",
    );
    expect($$('[data-test^="dashboard-series-format-color-swatch-"]')).toHaveLength(8);
    await save();
    // With the colour gone the entry sets nothing, so it is not written.
    expect(wrapper.emitted("save")[0][0]).toEqual([]);
  });

  it.each(["line", "area", "area-stacked", "bar", "h-bar", "scatter", "gauge", "metric"])(
    "shows the Thresholds field on %s",
    async (chartType) => {
      await mountChart({ chartType, entries: [series("cart")] });
      expect($('[data-test="dashboard-series-format-thresholds"]')).not.toBeNull();
      expect($('[data-test="dashboard-series-format-thresholds-inherit"]')!.textContent).toBe(
        "Inherits panel",
      );
    },
  );

  it.each(["stacked", "h-stacked", "pie", "donut"])(
    "hides the Thresholds field on %s",
    async (chartType) => {
      await mountChart({ chartType, entries: [series("cart")] });
      expect($('[data-test="dashboard-series-format-thresholds"]')).toBeNull();
      expect($('[data-test="dashboard-series-format-rule"]')!.textContent).toContain(
        "Later overrides win. An override beats the panel setting and Color by series.",
      );
    },
  );

  it("saves override thresholds once a step exists", async () => {
    await mountChart({ entries: [series("^c", [], "series_regex")] });
    $('[data-test="dashboard-config-thresholds-add-step"]')!.click();
    await flushPromises();
    await save();
    const saved = wrapper.emitted("save")[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].field).toEqual({ matchBy: "series_regex", value: "^c" });
    expect(saved[0].config).toHaveLength(1);
    expect(saved[0].config[0].type).toBe("thresholds");
    expect(saved[0].config[0].value.steps).toHaveLength(1);
    expect(saved[0].config[0].value.steps[0].value).toBe(80);
  });

  it("takes a plain number for an override step and refuses text with a unit", async () => {
    await mountChart({ entries: [series("cart")] });
    $('[data-test="dashboard-config-thresholds-add-step"]')!.click();
    await flushPromises();
    const input = $(
      '[data-test="dashboard-config-thresholds-step-0-value-field"]',
    ) as HTMLInputElement;
    input.value = "4 GB";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect($('[data-test="dashboard-config-thresholds-step-0"]')!.textContent).toContain(
      "Enter a number",
    );
    input.value = "250";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await save();
    expect(wrapper.emitted("save")[0][0][0].config[0].value.steps[0].value).toBe(250);
  });

  it("clears an override's steps on a mode switch and saves the next step in the new mode", async () => {
    const thresholds = {
      mode: "absolute",
      showAs: "color_line",
      steps: [{ value: 500, color: "#f59e0b" }],
    };
    await mountChart({ entries: [series("cart", [{ type: "thresholds", value: thresholds }])] });
    expect($('[data-test="dashboard-config-thresholds-step-0"]')).not.toBeNull();
    $('[data-test="dashboard-config-thresholds-mode-percentage"]')!.click();
    await flushPromises();
    expect($('[data-test="dashboard-config-thresholds-step-0"]')).toBeNull();
    $('[data-test="dashboard-config-thresholds-add-step"]')!.click();
    await flushPromises();
    await save();
    const value = wrapper.emitted("save")[0][0][0].config[0].value;
    expect(value.mode).toBe("percentage");
    expect(value.steps).toEqual([{ value: 80, color: expect.any(String) }]);
  });

  it("keeps an override's steps when switching back to Absolute", async () => {
    const thresholds = {
      mode: "percentage",
      showAs: "color_line",
      steps: [{ value: 70, color: "#f59e0b" }],
    };
    await mountChart({ entries: [series("cart", [{ type: "thresholds", value: thresholds }])] });
    $('[data-test="dashboard-config-thresholds-mode-absolute"]')!.click();
    await flushPromises();
    expect($('[data-test="dashboard-config-thresholds-step-0"]')).not.toBeNull();
    await save();
    const value = wrapper.emitted("save")[0][0][0].config[0].value;
    expect(value.mode).toBe("absolute");
    expect(value.steps).toEqual([{ value: 70, color: "#f59e0b" }]);
  });

  it("edits a copy: Cancel discards edits and leaves the stored list untouched", async () => {
    const stored = [series("cart", [{ type: "display_name", value: "Cart" }])];
    await mountChart({ entries: stored });
    await setInput("dashboard-series-format-display-name", "Basket");
    $('[data-test="series-override-remove-0"]')!.click();
    await flushPromises();
    $('[data-test="override-config-popup-cancel"]')!.click();
    await flushPromises();
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(stored).toEqual([series("cart", [{ type: "display_name", value: "Cart" }])]);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect($('[data-test="series-override-row-0"]')!.textContent).toContain("cart");
  });

  it("saves an empty list after the last override is removed", async () => {
    await mountChart({ entries: [series("cart")] });
    $('[data-test="series-override-remove-0"]')!.click();
    await flushPromises();
    expect(document.body.textContent).toContain("Format a series");
    await save();
    expect(wrapper.emitted("save")[0][0]).toEqual([]);
  });

  it("drops an override with nothing to match on Save", async () => {
    await mountChart();
    await openAddMenu();
    await pickMenuItem($('[data-test="dashboard-series-format-add-regex"]')!);
    await save();
    expect(wrapper.emitted("save")[0][0]).toEqual([]);
  });

  it("keeps the table entries of override_config, in place, when it saves the series entries", async () => {
    const tableEntry = {
      field: { matchBy: "name", value: "latency" },
      config: [{ type: "unit", value: { unit: "bytes", customUnit: "" } }],
    };
    const legacyEntry = {
      field: { value: "service" },
      config: [{ type: "alignment", value: "left" }],
    };
    await mountChart({
      entries: [
        tableEntry,
        series("api", [{ type: "series_color", value: "#111111" }]),
        legacyEntry,
      ],
    });
    expect($$('[data-test^="series-override-row-"][role="button"]')).toHaveLength(1);
    await setInput("dashboard-series-format-display-name", "API");
    await save();
    expect(wrapper.emitted("save")[0][0]).toEqual([
      tableEntry,
      legacyEntry,
      series("api", [
        { type: "display_name", value: "API" },
        { type: "series_color", value: "#111111" },
      ]),
    ]);
  });

  it("emits nothing on mount", async () => {
    await mountChart({ entries: [series("cart")] });
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  describe("preview", () => {
    const source = () => ({
      panelSchema: { type: "line", config: { unit: "milliseconds" } },
      data: [[{ x: 1, y: 2 }]],
      metadata: { queries: [] },
      resultMetaData: [[]],
    });

    it("says to run the query when there is no fetched data", async () => {
      await mountChart({ entries: [series("cart")] });
      await waitForPreview();
      expect($('[data-test="series-format-preview-empty"]')!.textContent).toContain(
        "Run the query to see a preview.",
      );
      expect(convertPanelData).not.toHaveBeenCalled();
    });

    it("converts the fetched data with the draft overrides and redraws on each edit", async () => {
      await mountChart({
        previewSource: source(),
        entries: [series("cart")],
      });
      await waitForPreview();
      // An entry that sets nothing is not written, so the preview starts without overrides.
      expect($('[data-test="chart-renderer-probe"]')!.textContent).toBe("[]");

      await setInput("dashboard-series-format-display-name", "Basket");
      await waitForPreview();
      expect(JSON.parse($('[data-test="chart-renderer-probe"]')!.textContent!)).toEqual([
        series("cart", [{ type: "display_name", value: "Basket" }]),
      ]);
    });

    it("leaves hidden queries out of the preview, as the panel does", async () => {
      await mountChart({
        previewSource: {
          panelSchema: {
            type: "line",
            queryType: "sql",
            queries: [{ query: "A" }, { query: "B" }, { query: "C" }],
            config: {},
          },
          data: [[{ q: "A" }], [{ q: "B" }], [{ q: "C" }]],
          metadata: { queries: [] },
          resultMetaData: [],
          hiddenQueries: [1],
        },
        entries: [series("cart")],
      });
      await waitForPreview();
      expect(convertPanelData.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const [schema, data] of convertPanelData.mock.calls as any[]) {
        expect(schema.queries.map((q: any) => q.query)).toEqual(["A", "C"]);
        expect(data).toEqual([[{ q: "A" }], [{ q: "C" }]]);
      }
    });

    it("lists the original legend names from a conversion without overrides", async () => {
      convertPanelData.mockImplementation(async (schema: any) => ({
        chartType: "line",
        options: {
          series: ((schema.config?.override_config ?? []).some(
            (e: any) => e.field.matchBy === "series",
          )
            ? ["Checkout!", "cart"]
            : ["checkout", "cart"]
          ).map((name) => ({ name })),
        },
        extras: {},
      }));
      const tableEntry = { field: { matchBy: "name", value: "x" }, config: [] };
      const applied = source();
      (applied.panelSchema.config as any).override_config = [
        tableEntry,
        series("checkout", [{ type: "display_name", value: "Checkout!" }]),
      ];
      await mountChart({ previewSource: applied, seriesNames: ["Checkout!", "cart"] });
      await waitForPreview();
      const baseCall = convertPanelData.mock.calls.find(
        (call: any[]) =>
          JSON.stringify(call[0].config.override_config) === JSON.stringify([tableEntry]),
      );
      expect(baseCall).toBeTruthy();
      await openAddMenu("dashboard-series-format-add-empty");
      expect(
        $$('[data-test="dashboard-series-format-add-empty-name"]').map((el) =>
          el.getAttribute("data-series-name"),
        ),
      ).toEqual(["checkout", "cart"]);
    });
  });
});
