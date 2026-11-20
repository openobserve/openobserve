// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "./OSelect.vue";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
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

describe("OSelect row click switches, the checkbox cell adds (M4)", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (props: Record<string, unknown>) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: {
        multiple: true,
        options: ["a", "b"].map((v) => ({ label: v, value: v })),
        ...props,
      },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  const cells = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>("[data-select-checkbox-cell]"));

  it("gives each checkbox a cell at least 1.5rem square with an add or remove tooltip", async () => {
    await open({ modelValue: ["a"], rowClickSingleSelect: true });
    expect(cells()).toHaveLength(2);
    expect(cells()[0].className).toContain("size-6");
    const tips = wrapper
      .findAllComponents(OTooltip)
      .map((tip) => tip.props("content"))
      .filter((content) => /selection/.test(String(content)));
    expect(tips).toEqual(["Remove from selection", "Add to selection"]);
  });

  // jsdom has no layout: the separator gets a box, and clicks land left or right of it.
  const clickRow = async (index: number, clientX: number) => {
    const item = document.body.querySelectorAll<HTMLElement>('[data-test="unit-option"]')[index];
    const separator = item.querySelector<HTMLElement>("[data-select-separator]")!;
    separator.getBoundingClientRect = () => ({ left: 28, right: 30 }) as DOMRect;
    const target = clientX <= 30 ? item.querySelector("[data-select-checkbox-cell]")! : item;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX }));
    await flushPromises();
  };
  const lastSelection = () => wrapper.emitted("update:modelValue")?.at(-1)?.[0];

  it("adds a stream from the checkbox cell and keeps the ones already picked", async () => {
    await open({ modelValue: ["a"], rowClickSingleSelect: true });
    await clickRow(1, 10);
    expect(lastSelection()).toEqual(["a", "b"]);
    expect(cells()).toHaveLength(2);
  });

  it("removes a picked stream from its checkbox cell and keeps the others", async () => {
    await open({ modelValue: ["a", "b"], rowClickSingleSelect: true });
    await clickRow(0, 10);
    expect(lastSelection()).toEqual(["b"]);
  });

  it("switches to the clicked stream alone from the rest of the row and closes", async () => {
    await open({ modelValue: ["a"], rowClickSingleSelect: true });
    await clickRow(1, 100);
    expect(lastSelection()).toEqual(["b"]);
    expect(cells()).toHaveLength(0);
  });

  it("keeps the plain checkbox where a row click toggles", async () => {
    await open({ modelValue: ["a"] });
    expect(cells()).toHaveLength(0);
    expect(document.body.querySelectorAll("[data-select-checkbox]")).toHaveLength(2);
  });
});
