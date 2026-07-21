// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, ref, nextTick } from "vue";
import OVirtualScroll from "./OVirtualScroll.vue";

// @tanstack/vue-virtual uses DOM measurements that jsdom doesn't support.
// We mock useVirtualizer to return predictable virtual items.
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: vi.fn((options: any) => {
    const opts =
      typeof options === "function" ? options() : options.value ?? options;
    const count = typeof opts.count === "function" ? opts.count() : opts.count;
    const estimateSize =
      typeof opts.estimateSize === "function"
        ? opts.estimateSize(0)
        : opts.estimateSize ?? 40;

    const virtualItems = Array.from({ length: count }, (_, i) => ({
      index: i,
      key: i,
      start: i * estimateSize,
      end: (i + 1) * estimateSize,
      size: estimateSize,
      lane: 0,
    }));

    return ref({
      getVirtualItems: () => virtualItems,
      getTotalSize: () => count * estimateSize,
      scrollToIndex: vi.fn(),
      measure: vi.fn(),
    });
  }),
}));

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i, label: `Item ${i}` }));
}

describe("OVirtualScroll", () => {
  // ── Rendering ──────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the root container", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(5) },
      });
      expect(wrapper.find("[data-test='o2-virtual-scroll']").exists()).toBe(true);
    });

    it("renders the correct number of visible items", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(10) },
        slots: {
          default: ({ item }: any) => h("div", { class: "item" }, item.label),
        },
      });
      expect(wrapper.findAll(".item").length).toBe(10);
    });

    it("renders nothing when items array is empty", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: [] },
        slots: {
          default: ({ item }: any) => h("div", { class: "item" }, String(item)),
        },
      });
      expect(wrapper.findAll(".item").length).toBe(0);
    });

    it("passes item and index to the default slot", () => {
      const received: { item: any; index: number }[] = [];
      mount(OVirtualScroll, {
        props: { items: makeItems(3) },
        slots: {
          default: (slotProps: any) => {
            received.push({ item: slotProps.item, index: slotProps.index });
            return h("div");
          },
        },
      });
      expect(received[0]).toMatchObject({ item: { id: 0, label: "Item 0" }, index: 0 });
      expect(received[1]).toMatchObject({ item: { id: 1, label: "Item 1" }, index: 1 });
    });
  });

  // ── Spacer height ──────────────────────────────────────────────

  describe("spacer / total size", () => {
    it("sets the inner spacer height to totalSize", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(5), estimateSize: 40 },
      });
      const content = wrapper.find(".o2-virtual-scroll__content");
      expect(content.attributes("style")).toContain("height: 200px");
    });
  });

  // ── Scroll container ownership ─────────────────────────────────

  describe("scroll container", () => {
    it("has overflow-y: auto when no scrollTarget is provided", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(3) },
      });
      const style = wrapper.find("[data-test='o2-virtual-scroll']").attributes("style") ?? "";
      expect(style).toContain("overflow");
    });

    it("does not set overflow when scrollTarget is provided", () => {
      const externalEl = document.createElement("div");
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(3), scrollTarget: externalEl },
      });
      const style = wrapper.find("[data-test='o2-virtual-scroll']").attributes("style") ?? "";
      expect(style).not.toContain("overflow-y");
    });
  });

  // ── Height prop ────────────────────────────────────────────────

  describe("height prop", () => {
    it("defaults to 100% height", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(3) },
      });
      const style = wrapper.find("[data-test='o2-virtual-scroll']").attributes("style") ?? "";
      expect(style).toContain("height: 100%");
    });

    it("applies custom height when provided", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(3), height: "400px" },
      });
      const style = wrapper.find("[data-test='o2-virtual-scroll']").attributes("style") ?? "";
      expect(style).toContain("height: 400px");
    });
  });

  // ── Exposed methods ────────────────────────────────────────────

  describe("exposed methods", () => {
    it("exposes scrollToIndex", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(10) },
      });
      expect(typeof (wrapper.vm as any).scrollToIndex).toBe("function");
    });

    it("exposes scrollToTop", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(10) },
      });
      expect(typeof (wrapper.vm as any).scrollToTop).toBe("function");
    });

    it("exposes measure", () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(10) },
      });
      expect(typeof (wrapper.vm as any).measure).toBe("function");
    });
  });

  // ── Emit virtual-scroll ────────────────────────────────────────

  describe("virtual-scroll event", () => {
    it("emits virtual-scroll when items are rendered", async () => {
      const wrapper = mount(OVirtualScroll, {
        props: { items: makeItems(5) },
      });
      // Trigger watcher
      await nextTick();
      const emissions = wrapper.emitted("virtual-scroll");
      expect(emissions).toBeTruthy();
    });
  });

  // ── CSS classes ────────────────────────────────────────────────

  describe("CSS classes", () => {
    it("applies o2-virtual-scroll class to root", () => {
      const wrapper = mount(OVirtualScroll, { props: { items: [] } });
      expect(wrapper.classes()).toContain("o2-virtual-scroll");
    });

    it("applies o2-virtual-scroll__content class to spacer", () => {
      const wrapper = mount(OVirtualScroll, { props: { items: makeItems(2) } });
      expect(wrapper.find(".o2-virtual-scroll__content").exists()).toBe(true);
    });
  });
});
