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
import { defineComponent, h, reactive, ref } from "vue";

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

// JSDOM loads no stylesheet, so the status tokens need the values base.css gives them.
vi.mock("@/utils/chartTheme", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, any>;
  const status: Record<string, string> = {
    "--color-success-500": "#22c55e",
    "--color-amber-500": "#f59e0b",
    "--color-error-500": "#ef4444",
  };
  return {
    ...actual,
    chartColor: (token: `--${string}`) => status[token] ?? actual.chartColor(token),
  };
});

import ThresholdsConfig from "./ThresholdsConfig.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { getColorPalette } from "@/utils/dashboard/colorPalette";

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const PALETTE = getColorPalette().slice(0, 5);

type Props = Record<string, unknown>;

let wrapper: VueWrapper<any> | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const mountConfig = (props: Props = {}) => {
  wrapper = mount(ThresholdsConfig, {
    attachTo: document.body,
    props: { chartType: "line", unit: "milliseconds", ...props },
    global: { plugins: [i18n, store] },
  });
  return wrapper;
};

// A parent that writes every emit back, like ConfigPanel does with the panel config.
const mountBound = (initialProps: Props = {}, initial?: Record<string, unknown>) => {
  const props = reactive<Props>({ ...initialProps });
  const model = ref<any>(initial);
  const emits: unknown[] = [];
  const Parent = defineComponent({
    setup: () => () =>
      h(ThresholdsConfig, {
        chartType: "line",
        unit: "milliseconds",
        ...props,
        modelValue: model.value,
        "onUpdate:modelValue": (value: unknown) => {
          emits.push(value);
          model.value = value;
        },
      }),
  });
  wrapper = mount(Parent, { attachTo: document.body, global: { plugins: [i18n, store] } });
  return { model, emits, props };
};

const find = (test: string) => wrapper!.find(`[data-test="${test}"]`);
const stepInput = (index: number) => find(`dashboard-config-thresholds-step-${index}-value-field`);
const stepText = (index: number) => find(`dashboard-config-thresholds-step-${index}`).text();
const addStep = async () => {
  await find("dashboard-config-thresholds-add-step").trigger("click");
  await flushPromises();
};
const typeStep = async (index: number, text: string) => {
  await stepInput(index).trigger("focus");
  await stepInput(index).setValue(text);
  await flushPromises();
};
// Blur plus a focusout whose next target is outside the step list (or the given element).
const blurStep = async (index: number, next: Element | null = null) => {
  const input = stepInput(index).element;
  await stepInput(index).trigger("blur");
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: next }));
  await flushPromises();
};
const selectOptions = async () => {
  await find("dashboard-config-thresholds-show-as-trigger").trigger("click");
  await flushPromises();
  return [
    ...document.body.querySelectorAll<HTMLElement>(
      '[data-test="dashboard-config-thresholds-show-as-option"]',
    ),
  ].map((el) => el.dataset.testValue);
};

const twoSteps = {
  mode: "absolute",
  showAs: "color_line",
  steps: [
    { value: 500, color: AMBER },
    { value: 1000, color: RED },
  ],
};

describe("ThresholdsConfig", () => {
  describe("the rule: nothing is written until a step exists", () => {
    it("never emits on mount, with or without thresholds", async () => {
      mountConfig();
      await flushPromises();
      expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
      wrapper!.unmount();
      mountConfig({ modelValue: twoSteps });
      await flushPromises();
      expect(wrapper!.emitted("update:modelValue")).toBeUndefined();
    });

    it("keeps Mode, Show as and Base picked before the first step, and writes them with it", async () => {
      const { emits, model } = mountBound();
      await find("dashboard-config-thresholds-mode-percentage").trigger("click");
      await find("dashboard-config-thresholds-base-color-swatch-0").trigger("click");
      await flushPromises();
      expect(emits).toEqual([]);
      await addStep();
      expect(model.value).toEqual({
        mode: "percentage",
        showAs: "color_line",
        baseColor: GREEN,
        steps: [{ value: 80, color: AMBER }],
      });
    });

    it("emits undefined when the last step is removed", async () => {
      const { emits, model } = mountBound({}, { ...twoSteps, steps: [twoSteps.steps[0]] });
      await find("dashboard-config-thresholds-step-0-remove").trigger("click");
      await flushPromises();
      expect(emits).toEqual([undefined]);
      expect(model.value).toBeUndefined();
      expect(find("dashboard-config-thresholds-empty").exists()).toBe(true);
    });

    it("omits baseColor when None is picked and showAs on gauge and metric", async () => {
      const { model } = mountBound({ chartType: "gauge" }, { ...twoSteps, baseColor: GREEN });
      await find("dashboard-config-thresholds-base-color-none").trigger("click");
      await flushPromises();
      expect(model.value).toEqual({ mode: "absolute", steps: twoSteps.steps });
      expect("baseColor" in model.value).toBe(false);
    });
  });

  describe("adding and removing steps", () => {
    it("adds each step above the highest, amber then red then the palette", async () => {
      const { model } = mountBound();
      await addStep();
      await addStep();
      await addStep();
      await addStep();
      expect(model.value.steps).toEqual([
        { value: 80, color: AMBER },
        { value: 90, color: RED },
        { value: 100, color: PALETTE[0] },
        { value: 200, color: PALETTE[1] },
      ]);
      expect(model.value).toEqual({
        mode: "absolute",
        showAs: "color_line",
        steps: model.value.steps,
      });
    });

    it("caps a new percentage step at 100", async () => {
      const { model } = mountBound(
        {},
        { mode: "percentage", steps: [{ value: 95, color: AMBER }] },
      );
      await addStep();
      expect(model.value.steps[1].value).toBe(100);
    });

    it("focuses the new step's value so it can be typed over", async () => {
      mountBound();
      await addStep();
      expect(document.activeElement).toBe(stepInput(0).element);
    });

    it("removes the clicked step only", async () => {
      const { model } = mountBound({}, twoSteps);
      await find("dashboard-config-thresholds-step-0-remove").trigger("click");
      await flushPromises();
      expect(model.value.steps).toEqual([{ value: 1000, color: RED }]);
    });
  });

  describe("typing values", () => {
    it("stores a plain number and hints it in the panel unit", async () => {
      const { model } = mountBound();
      await addStep();
      await typeStep(0, "500");
      await blurStep(0);
      await addStep();
      await typeStep(1, " 1000 ");
      await blurStep(1);
      expect(model.value.steps).toEqual([
        { value: 500, color: AMBER },
        { value: 1000, color: RED },
      ]);
      expect(stepText(0)).toContain("= 500.00ms");
      expect(stepText(1)).toContain("= 1.00s");
      expect(stepText(0)).not.toContain("raw");
    });

    it("accepts decimals and negatives", async () => {
      const { model } = mountBound({}, twoSteps);
      await typeStep(0, "-2.5");
      expect(model.value.steps[0].value).toBe(-2.5);
      await typeStep(0, ".5");
      expect(model.value.steps[0].value).toBe(0.5);
    });

    it("shows the saved number as plain text, rounded to six significant digits", async () => {
      mountBound(
        { unit: "hours" },
        {
          steps: [
            { value: 0.366666666666667, color: AMBER },
            { value: 4294967296, color: RED },
          ],
        },
      );
      expect((stepInput(0).element as HTMLInputElement).value).toBe("0.366667");
      expect((stepInput(1).element as HTMLInputElement).value).toBe("4294967296");
    });

    it("hints in the panel unit and decimals", async () => {
      mountBound({ unit: "bytes", decimals: 2 }, { steps: [{ value: 4294967296, color: AMBER }] });
      expect(stepText(0)).toContain("= 4.00GB");
      wrapper!.unmount();
      mountBound({ unit: "hours", decimals: 2 }, { steps: [{ value: 22, color: AMBER }] });
      expect(stepText(0)).toContain("= 22.00h");
      wrapper!.unmount();
      mountBound({ unit: "percent", decimals: 2 }, { steps: [{ value: 90, color: AMBER }] });
      expect(stepText(0)).toContain("= 90.00%");
    });

    it("shows a plain example as placeholder", async () => {
      mountBound({}, twoSteps);
      expect(stepInput(0).attributes("placeholder")).toBe("e.g. 500");
    });

    it("refuses text with a unit or other words, applies nothing, and keeps the text", async () => {
      const { emits } = mountBound({}, twoSteps);
      for (const text of ["4 GB", "500 ms", "90%", "abc"]) {
        await typeStep(0, text);
        expect(stepText(0)).toContain("Enter a number");
        expect(find("dashboard-config-thresholds-step-0-value-error").exists()).toBe(true);
      }
      expect(emits).toEqual([]);
      await blurStep(0);
      expect((stepInput(0).element as HTMLInputElement).value).toBe("abc");
      expect(emits).toEqual([]);
    });

    it("restores the stored value when the field is left empty", async () => {
      const { emits } = mountBound({}, twoSteps);
      await typeStep(0, "");
      await blurStep(0);
      expect(emits).toEqual([]);
      expect((stepInput(0).element as HTMLInputElement).value).toBe("500");
    });

    it("never changes the field text when the panel unit changes", async () => {
      const { emits, props } = mountBound({}, twoSteps);
      props.unit = "bytes";
      await flushPromises();
      expect((stepInput(0).element as HTMLInputElement).value).toBe("500");
      expect((stepInput(1).element as HTMLInputElement).value).toBe("1000");
      expect(stepText(1)).toContain("= 1000.00B");
      await typeStep(0, "abc");
      props.unit = "seconds";
      await flushPromises();
      expect((stepInput(0).element as HTMLInputElement).value).toBe("abc");
      expect(emits).toEqual([]);
    });

    it("sorts rows ascending by value on leaving the list, not while typing", async () => {
      const { model } = mountBound({}, twoSteps);
      await typeStep(1, "200");
      expect(model.value.steps.map((s: any) => s.value)).toEqual([500, 200]);
      await blurStep(1);
      expect(model.value.steps).toEqual([
        { value: 200, color: RED },
        { value: 500, color: AMBER },
      ]);
      expect((stepInput(0).element as HTMLInputElement).value).toBe("200");
    });

    it("waits for a click to finish before sorting, so the clicked swatch colours its own row", async () => {
      const { model } = mountBound({}, twoSteps);
      await typeStep(1, "200");
      const root = find("dashboard-config-thresholds").element;
      root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await blurStep(1);
      expect(model.value.steps.map((s: any) => s.value)).toEqual([500, 200]);
      await find("dashboard-config-thresholds-step-1-color-swatch-0").trigger("click");
      document.dispatchEvent(new Event("pointerup"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPromises();
      expect(model.value.steps).toEqual([
        { value: 200, color: GREEN },
        { value: 500, color: AMBER },
      ]);
    });
  });

  describe("fix round 2", () => {
    it("keeps the last valid value while the text is invalid, so a half-typed value never reaches the chart", async () => {
      const { model } = mountBound({}, twoSteps);
      await typeStep(0, "4");
      expect(model.value.steps[0].value).toBe(4);
      await stepInput(0).setValue("4x");
      await flushPromises();
      expect(model.value.steps[0].value).toBe(500);
      await blurStep(0);
      expect(model.value.steps[0].value).toBe(500);
      expect((stepInput(0).element as HTMLInputElement).value).toBe("4x");
    });

    it("does not re-sort while focus moves between step fields", async () => {
      const { model } = mountBound({}, twoSteps);
      await typeStep(0, "2000");
      await blurStep(0, stepInput(1).element);
      expect(model.value.steps.map((s: any) => s.value)).toEqual([2000, 1000]);
      await typeStep(1, "3000");
      expect(model.value.steps.map((s: any) => s.value)).toEqual([2000, 3000]);
      await blurStep(1);
      expect(model.value.steps.map((s: any) => s.value)).toEqual([2000, 3000]);
      await typeStep(1, "1000");
      await blurStep(1);
      expect(model.value.steps.map((s: any) => s.value)).toEqual([1000, 2000]);
    });

    it.each([
      ["percent-1", undefined, [0.8, 0.9, 1, 1]],
      ["percent", undefined, [80, 90, 100, 100]],
      ["milliseconds", "percentage", [80, 90, 100, 100]],
      ["milliseconds", undefined, [80, 90, 100, 200]],
      ["bytes", undefined, [80, 90, 100, 200]],
    ])("adds sensible defaults on %s (%s mode)", async (unit, mode, expected) => {
      const { model } = mountBound({ unit }, mode ? { mode, steps: [] } : undefined);
      for (let i = 0; i < 4; i++) await addStep();
      expect(model.value.steps.map((s: any) => s.value)).toEqual(expected);
    });

    it("steps a large previous value by its magnitude", async () => {
      const { model } = mountBound(
        { unit: "bytes" },
        { steps: [{ value: 4294967296, color: AMBER }] },
      );
      await addStep();
      expect(model.value.steps[1].value).toBe(5294967296);
    });
  });

  describe("colour pickers", () => {
    it("offers None on the base row, selected by default, and none on step rows", () => {
      mountConfig({ modelValue: twoSteps });
      const none = find("dashboard-config-thresholds-base-color-none");
      expect(none.exists()).toBe(true);
      expect(none.attributes("aria-pressed")).toBe("true");
      expect(find("dashboard-config-thresholds-step-0-color-none").exists()).toBe(false);
      expect(find("dashboard-config-thresholds-step-1-color-none").exists()).toBe(false);
    });

    it("offers green, amber, red and five palette colours", () => {
      mountConfig({ modelValue: twoSteps });
      const swatches = wrapper!
        .findAll('[data-test^="dashboard-config-thresholds-step-0-color-swatch-"]')
        .map((el) => el.attributes("aria-label"));
      expect(swatches).toEqual([GREEN, AMBER, RED, ...PALETTE]);
    });

    it("writes the picked hex for a step and for the base", async () => {
      const { model } = mountBound({}, twoSteps);
      await find("dashboard-config-thresholds-step-1-color-swatch-3").trigger("click");
      await find("dashboard-config-thresholds-base-color-swatch-0").trigger("click");
      await flushPromises();
      expect(model.value.steps[1].color).toBe(PALETTE[0]);
      expect(model.value.baseColor).toBe(GREEN);
    });

    it("captions None by chart type", () => {
      mountConfig({ chartType: "line" });
      expect(find("dashboard-config-thresholds-base").text()).toContain(
        "None: each series keeps its own color",
      );
      wrapper!.unmount();
      mountConfig({ chartType: "metric" });
      expect(find("dashboard-config-thresholds-base").text()).toContain(
        "None: uses the Background color",
      );
    });
  });

  describe("mode", () => {
    it("disables Percentage on metric with the reason", () => {
      mountConfig({ chartType: "metric" });
      const item = find("dashboard-config-thresholds-mode-percentage");
      expect(item.attributes("disabled")).toBeDefined();
      expect(
        find("dashboard-config-thresholds-mode-absolute").attributes("disabled"),
      ).toBeUndefined();
    });

    it("reads 0 to 100 in Percentage mode and echoes the share of the range", async () => {
      const { model, emits } = mountBound(
        { chartType: "gauge" },
        { mode: "percentage", steps: [{ value: 70, color: AMBER }] },
      );
      expect((stepInput(0).element as HTMLInputElement).value).toBe("70");
      await typeStep(0, "80");
      expect(model.value.steps[0].value).toBe(80);
      expect(stepText(0)).toContain("= 80% of range");
      await typeStep(0, "120");
      expect(stepText(0)).toContain("Type a percentage from 0 to 100");
      expect(emits).toHaveLength(1);
    });

    it("switching Absolute to Percentage clears the steps and the next step saves Percentage", async () => {
      const { model, emits } = mountBound({}, { ...twoSteps, baseColor: GREEN });
      await find("dashboard-config-thresholds-mode-percentage").trigger("click");
      await flushPromises();
      expect(emits).toEqual([undefined]);
      expect(model.value).toBeUndefined();
      expect(find("dashboard-config-thresholds-step-0").exists()).toBe(false);
      await addStep();
      expect(model.value).toEqual({
        mode: "percentage",
        showAs: "color_line",
        baseColor: GREEN,
        steps: [{ value: 80, color: AMBER }],
      });
    });

    it("switching Percentage to Absolute keeps the steps and their numbers", async () => {
      const steps = [
        { value: 70, color: AMBER },
        { value: 90, color: RED },
      ];
      const { model } = mountBound(
        {},
        { mode: "percentage", showAs: "line", baseColor: GREEN, steps },
      );
      await find("dashboard-config-thresholds-mode-absolute").trigger("click");
      await flushPromises();
      expect(model.value).toEqual({ mode: "absolute", showAs: "line", baseColor: GREEN, steps });
      expect((stepInput(0).element as HTMLInputElement).value).toBe("70");
      await addStep();
      expect(model.value.mode).toBe("absolute");
      expect(model.value.steps).toHaveLength(3);
    });

    it("switching with no steps only changes the mode", async () => {
      const { emits, model } = mountBound();
      await find("dashboard-config-thresholds-mode-percentage").trigger("click");
      await flushPromises();
      expect(emits).toEqual([]);
      await addStep();
      expect(model.value.mode).toBe("percentage");
    });
  });

  describe("Show as", () => {
    it.each(["line", "area", "bar", "h-bar", "scatter"])(
      "offers four choices on %s",
      async (chartType) => {
        mountConfig({ chartType, modelValue: twoSteps });
        expect(await selectOptions()).toEqual(["color_line", "color", "line", "color_band"]);
      },
    );

    it("offers only Limit line and Shaded band on stacked area, with the hint", async () => {
      mountConfig({ chartType: "area-stacked", modelValue: twoSteps });
      expect(find("dashboard-config-thresholds").text()).toContain(
        "Stacked areas are not recolored; limits are drawn as lines or bands.",
      );
      expect(await selectOptions()).toEqual(["line", "color_band"]);
    });

    it("writes Limit line only as the stacked-area default", async () => {
      const { model } = mountBound({ chartType: "area-stacked" });
      await addStep();
      expect(model.value.showAs).toBe("line");
    });

    it("writes the picked choice", async () => {
      const { model } = mountBound({}, twoSteps);
      await selectOptions();
      document.body
        .querySelector<HTMLElement>(
          '[data-test="dashboard-config-thresholds-show-as-option"][data-test-value="color_band"]',
        )!
        .click();
      await flushPromises();
      expect(model.value.showAs).toBe("color_band");
    });

    it.each(["bar", "h-bar", "scatter"])(
      "allows Percentage and writes showAs on %s",
      async (chartType) => {
        const { model } = mountBound({ chartType });
        expect(
          find("dashboard-config-thresholds-mode-percentage").attributes("disabled"),
        ).toBeUndefined();
        await find("dashboard-config-thresholds-mode-percentage").trigger("click");
        await addStep();
        expect(model.value).toEqual({
          mode: "percentage",
          showAs: "color_line",
          steps: [{ value: 80, color: AMBER }],
        });
      },
    );

    it.each(["gauge", "metric"])("is hidden on %s", (chartType) => {
      mountConfig({ chartType });
      expect(find("dashboard-config-thresholds-show-as").exists()).toBe(false);
    });
  });

  describe("metric value mappings note", () => {
    it("shows only on metric with coloured value mappings", () => {
      mountConfig({ chartType: "metric", hasColouredValueMappings: true });
      expect(find("dashboard-config-thresholds-mapping-note").text()).toBe(
        "Value mappings win over these steps",
      );
      wrapper!.unmount();
      mountConfig({ chartType: "metric", hasColouredValueMappings: false });
      expect(find("dashboard-config-thresholds-mapping-note").exists()).toBe(false);
      wrapper!.unmount();
      mountConfig({ chartType: "gauge", hasColouredValueMappings: true });
      expect(find("dashboard-config-thresholds-mapping-note").exists()).toBe(false);
    });
  });
});
