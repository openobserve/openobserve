// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import { raw } from "@/types/i18n";

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

describe("OSelect list semantics", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  const open = async (props: Record<string, unknown>, attrs: Record<string, unknown> = {}) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      props: {
        searchable: true,
        options: [
          { label: raw("a"), value: "a" },
          { label: raw("b"), value: "b" },
        ],
        ...props,
      },
      attrs,
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    return document.body.querySelector<HTMLElement>("[role='listbox']");
  };

  it("wraps the options of a multi-select in a named, multi-selectable listbox", async () => {
    const listbox = await open(
      { multiple: true, modelValue: ["a"] },
      { "aria-label": "Select stream" },
    );
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute("aria-multiselectable")).toBe("true");
    expect(listbox!.getAttribute("aria-label")).toBe("Select stream");
    expect(listbox!.querySelectorAll("[role='option']").length).toBe(2);
    expect(listbox!.querySelector("[role='option'][aria-selected='true']")).not.toBeNull();
  });

  it("does not claim multi-selection for a single select", async () => {
    const listbox = await open({ modelValue: "a" });
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute("aria-multiselectable")).toBeNull();
  });
});
