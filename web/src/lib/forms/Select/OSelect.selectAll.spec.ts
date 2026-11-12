// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: { count: number } | { value: { count: number } }) =>
      computed(() => {
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

const OPTIONS = ["p1", "p2", "p3"].map((v) => ({ label: v, value: v }));

describe("OSelect allSelectedLabel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (props: Record<string, unknown>) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { multiple: true, selectAll: true, options: OPTIONS, ...props },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };

  const checkboxOf = (value: string) =>
    document.body
      .querySelector(`[data-test-value="${value}"]`)!
      .querySelector("[data-select-checkbox]")!;

  it("shows the override label in the trigger, not a chip list, when every option is selected", async () => {
    await open({ modelValue: ["p1", "p2", "p3"], allSelectedLabel: "All panels" });
    expect(wrapper.text()).toContain("All panels");
    expect(wrapper.text()).not.toContain("p1, p2, p3");
  });

  it("shows chips as usual for a partial selection, even with allSelectedLabel set", async () => {
    await open({ modelValue: ["p1"], allSelectedLabel: "All panels" });
    expect(wrapper.text()).not.toContain("All panels");
    expect(wrapper.text()).toContain("p1");
  });

  it("reopening with every option selected shows the Select All row and every item checked", async () => {
    await open({ modelValue: ["p1", "p2", "p3"], allSelectedLabel: "All panels" });
    const master = document.body.querySelector('[data-test="o-select-all"]')!;
    expect(master.getAttribute("aria-checked")).toBe("true");
    for (const value of ["p1", "p2", "p3"]) {
      expect(checkboxOf(value).className).toContain("bg-checkbox-checked-bg");
    }
  });

  it("unchecking one option after a full selection emits the remaining explicit list", async () => {
    await open({ modelValue: ["p1", "p2", "p3"], allSelectedLabel: "All panels" });
    (document.body.querySelector('[data-test-value="p2"]') as HTMLElement).click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual(["p1", "p3"]);
  });
});
