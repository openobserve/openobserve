// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
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

const OPTIONS = [
  { label: "Asia/Kolkata", value: "Asia/Kolkata", searchText: "Asia/Kolkata Asia/Calcutta" },
  { label: "Europe/Kyiv", value: "Europe/Kyiv", searchText: "Europe/Kyiv Europe/Kiev" },
  { label: "UTC", value: "UTC" },
];

describe("OSelect option searchText", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const option = (value: string) =>
    document.body.querySelector<HTMLElement>(
      `[data-test="unit-option"][data-test-value="${value}"]`,
    );

  const searchFor = async (term: string) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { options: OPTIONS, searchable: true },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
    input.value = term;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };

  it("finds an option by a name only its searchText holds", async () => {
    await searchFor("Calcutta");
    expect(option("Asia/Kolkata")).not.toBeNull();
    expect(option("Europe/Kyiv")).toBeNull();
    expect(option("UTC")).toBeNull();
  });

  it("still finds an option by its label", async () => {
    await searchFor("utc");
    expect(option("UTC")).not.toBeNull();
    expect(option("Asia/Kolkata")).toBeNull();
  });
});
