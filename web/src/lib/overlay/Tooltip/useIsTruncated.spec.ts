// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { isElementTruncated, useIsTruncated } from "./useIsTruncated";

function box(
  el: HTMLElement,
  m: Partial<Record<"scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight", number>>,
) {
  for (const [k, v] of Object.entries(m)) {
    Object.defineProperty(el, k, { configurable: true, get: () => v });
  }
}

// jsdom's Range has no getBoundingClientRect; the spec supplies one per case.
function rangeWidth(width: number) {
  Range.prototype.getBoundingClientRect = vi.fn(() => ({ width }) as DOMRect);
}

describe("isElementTruncated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  });

  it("compares scrollWidth with clientWidth in the default (nowrap) mode", () => {
    const el = document.createElement("div");
    box(el, { scrollWidth: 120, clientWidth: 80 });
    expect(isElementTruncated(el, false)).toBe(true);
    box(el, { scrollWidth: 80, clientWidth: 80 });
    expect(isElementTruncated(el, false)).toBe(false);
  });

  it("in clamp mode reports a label whose lines overflow the clamped height", () => {
    const el = document.createElement("div");
    box(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 48, clientHeight: 32 });
    expect(isElementTruncated(el, true)).toBe(true);
  });

  it("in clamp mode reports a word wider than the box even when scrollWidth equals clientWidth", () => {
    const el = document.createElement("div");
    el.textContent = "Zuverlässigkeit";
    box(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 32, clientHeight: 32 });
    el.getBoundingClientRect = () => ({ width: 80 }) as DOMRect;
    rangeWidth(80.03);
    expect(isElementTruncated(el, true)).toBe(true);
  });

  it("in clamp mode reports a fitting label as not truncated", () => {
    const el = document.createElement("div");
    el.textContent = "Logs";
    box(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 16, clientHeight: 32 });
    el.getBoundingClientRect = () => ({ width: 80 }) as DOMRect;
    rangeWidth(28);
    expect(isElementTruncated(el, true)).toBe(false);
  });
});

describe("useIsTruncated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  });

  it("re-measures once the document fonts are ready", async () => {
    let resolveFonts: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready, status: "loading" },
    });
    // The fallback font fits the box at mount.
    rangeWidth(0);
    const Host = defineComponent({
      setup() {
        const label = ref<HTMLElement | null>(null);
        const { isTruncated } = useIsTruncated(label, { clamp: true });
        return { label, isTruncated };
      },
      render() {
        return h("div", { ref: "label" }, "Einstellungen");
      },
    });
    const wrapper = mount(Host);
    const el = wrapper.element as HTMLElement;
    box(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 32, clientHeight: 32 });
    el.getBoundingClientRect = () => ({ width: 80 }) as DOMRect;
    expect((wrapper.vm as any).isTruncated).toBe(false);
    // The web font lands wider than the fallback: the label now overflows.
    rangeWidth(80.03);
    resolveFonts();
    await ready;
    await Promise.resolve();
    expect((wrapper.vm as any).isTruncated).toBe(true);
    wrapper.unmount();
    delete (document as Partial<Document>).fonts;
  });

  it("skips the fonts-ready re-measure once fonts have loaded", () => {
    const then = vi.fn();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: { then }, status: "loaded" },
    });
    const Host = defineComponent({
      setup() {
        const label = ref<HTMLElement | null>(null);
        useIsTruncated(label);
        return { label };
      },
      render() {
        return h("div", { ref: "label" }, "Logs");
      },
    });
    const wrapper = mount(Host);
    expect(then).not.toHaveBeenCalled();
    wrapper.unmount();
    delete (document as Partial<Document>).fonts;
  });

  it("measures on mount and again on update(), in clamp mode", async () => {
    rangeWidth(80.03);
    const Host = defineComponent({
      setup() {
        const label = ref<HTMLElement | null>(null);
        const { isTruncated, update } = useIsTruncated(label, { clamp: true });
        return { label, isTruncated, update };
      },
      render() {
        return h("div", { ref: "label" }, "Zuverlässigkeit");
      },
    });
    const wrapper = mount(Host);
    const el = wrapper.element as HTMLElement;
    box(el, { scrollWidth: 80, clientWidth: 80, scrollHeight: 32, clientHeight: 32 });
    el.getBoundingClientRect = () => ({ width: 80 }) as DOMRect;
    (wrapper.vm as any).update();
    expect((wrapper.vm as any).isTruncated).toBe(true);
    rangeWidth(40);
    (wrapper.vm as any).update();
    expect((wrapper.vm as any).isTruncated).toBe(false);
    wrapper.unmount();
  });
});
