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

// Same shape as the alert Destination picker: two header groups in one flat list.
const GROUPED = [
  { label: "Destinations", header: true },
  { label: "d1", value: "d1" },
  { label: "d2", value: "d2" },
  { label: "d3", value: "d3" },
  { label: "Workflows", header: true },
  { label: "w1", value: "w1" },
  { label: "w2", value: "w2" },
  { label: "w3", value: "w3" },
  { label: "w4", value: "w4" },
];

describe("OSelect multi-select floats the selection to the top on open", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (props: Record<string, unknown>) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { multiple: true, ...props },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  // Every rendered row (headers and options) in list order.
  const rows = () =>
    Array.from(document.body.querySelectorAll<HTMLElement>("[data-vrow]")).map((el) =>
      el.textContent!.trim(),
    );

  it("floats selected options to the top of a flat list", async () => {
    await open({
      modelValue: ["c", "a"],
      options: ["a", "b", "c", "d"].map((v) => ({ label: v, value: v })),
    });
    expect(rows()).toEqual(["a", "c", "b", "d"]);
  });

  it("keeps a grouped list in its order unless pinSelectedInGroups is set", async () => {
    // Same shape as the dashboard variable panel picker: "Current Panel" leads each tab group.
    await open({
      modelValue: ["p2"],
      options: [
        { label: "Tab A", isTab: true },
        { label: "Current Panel", value: "current_panel" },
        { label: "p1", value: "p1" },
        { label: "p2", value: "p2" },
      ],
    });
    expect(rows()).toEqual(["Tab A", "Current Panel", "p1", "p2"]);
  });

  describe("with pinSelectedInGroups", () => {
    const openPinned = (props: Record<string, unknown>) =>
      open({ pinSelectedInGroups: true, ...props });

    it("floats selected options to the top of their own group and keeps the headers in place", async () => {
      await openPinned({ modelValue: ["w4", "d3", "w2"], options: GROUPED });
      expect(rows()).toEqual([
        "Destinations",
        "d3",
        "d1",
        "d2",
        "Workflows",
        "w2",
        "w4",
        "w1",
        "w3",
      ]);
    });

    it("treats options before the first header as their own group", async () => {
      await openPinned({
        modelValue: ["w3", "all-b"],
        options: [
          { label: "all-a", value: "all-a" },
          { label: "all-b", value: "all-b" },
          ...GROUPED.slice(4),
        ],
      });
      expect(rows()).toEqual(["all-b", "all-a", "Workflows", "w3", "w1", "w2", "w4"]);
    });

    it("keeps the order frozen while open, so a row never moves under the pointer", async () => {
      await openPinned({ modelValue: ["w2"], options: GROUPED });
      await wrapper.setProps({ modelValue: ["w2", "w4"] });
      expect(rows()).toEqual([
        "Destinations",
        "d1",
        "d2",
        "d3",
        "Workflows",
        "w2",
        "w1",
        "w3",
        "w4",
      ]);
    });

    it("floats an option selected in the last session on the next open", async () => {
      await openPinned({ modelValue: [], options: GROUPED });
      await wrapper.setProps({ modelValue: ["w3"] });
      document.body
        .querySelector('[data-test="unit-search"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();
      expect(rows()).toEqual([]);
      await wrapper.find("button").trigger("click");
      await flushPromises();
      expect(rows()).toEqual([
        "Destinations",
        "d1",
        "d2",
        "d3",
        "Workflows",
        "w3",
        "w1",
        "w2",
        "w4",
      ]);
    });

    it("collapses a group with its floated options", async () => {
      await openPinned({ modelValue: ["w2", "d3"], options: GROUPED, collapsibleGroups: true });
      const header = Array.from(
        document.body.querySelectorAll<HTMLElement>("[data-vrow] > div"),
      ).find((el) => el.textContent!.trim() === "Workflows")!;
      header.click();
      await flushPromises();
      expect(rows()).toEqual(["Destinations", "d3", "d1", "d2", "Workflows"]);
    });
  });
});
