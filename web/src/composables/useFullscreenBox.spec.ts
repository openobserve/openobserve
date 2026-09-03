// Copyright 2026 OpenObserve Inc.

// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useFullscreenBox } from "./useFullscreenBox";

// jsdom implements neither the Fullscreen API nor a settable
// `document.fullscreenElement` — both are stood up manually so `toggle()`'s
// real call into `Element.requestFullscreen()` has something to hit, and so a
// test can simulate the browser firing `fullscreenchange` (e.g. on Escape).
let currentFullscreenElement: Element | null = null;

function fireFullscreenChange(target: Element | null) {
  currentFullscreenElement = target;
  document.dispatchEvent(new Event("fullscreenchange"));
}

beforeEach(() => {
  currentFullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => currentFullscreenElement,
  });
  Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
    fireFullscreenChange(this);
    return Promise.resolve();
  });
  document.exitFullscreen = vi.fn(() => {
    fireFullscreenChange(null);
    return Promise.resolve();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mountHarness() {
  let exposed: ReturnType<typeof useFullscreenBox>;
  const wrapper = mount(
    defineComponent({
      setup() {
        exposed = useFullscreenBox();
        return () => null;
      },
    }),
  );
  return {
    wrapper,
    get exposed() {
      return exposed;
    },
  };
}

describe("useFullscreenBox", () => {
  it("starts with nothing fullscreen", () => {
    const { exposed } = mountHarness();
    expect(exposed.fullscreenEl.value).toBeNull();
  });

  it("requests fullscreen on the given element and reflects it once the browser confirms", async () => {
    const { exposed } = mountHarness();
    const box = document.createElement("div");

    exposed.toggle(box);
    await nextTick();

    expect(box.requestFullscreen).toHaveBeenCalled();
    expect(exposed.fullscreenEl.value).toBe(box);
  });

  it("a second box's toggle replaces the first — only one element is ever fullscreen", async () => {
    const { exposed } = mountHarness();
    const boxA = document.createElement("div");
    const boxB = document.createElement("div");

    exposed.toggle(boxA);
    await nextTick();
    expect(exposed.fullscreenEl.value).toBe(boxA);

    // The real browser call is exitFullscreen() then requestFullscreen() on
    // the new target, not a direct swap — simulate that sequence.
    await document.exitFullscreen();
    exposed.toggle(boxB);
    await nextTick();

    expect(exposed.fullscreenEl.value).toBe(boxB);
  });

  it("clears when the browser exits fullscreen outside any click — e.g. Escape", async () => {
    const { exposed } = mountHarness();
    const box = document.createElement("div");
    exposed.toggle(box);
    await nextTick();
    expect(exposed.fullscreenEl.value).toBe(box);

    fireFullscreenChange(null);
    await nextTick();

    expect(exposed.fullscreenEl.value).toBeNull();
  });

  it("does nothing for a null element rather than throwing", () => {
    const { exposed } = mountHarness();
    expect(() => exposed.toggle(null)).not.toThrow();
    expect(exposed.fullscreenEl.value).toBeNull();
  });

  it("stops listening once the owning component unmounts", async () => {
    const { wrapper, exposed } = mountHarness();
    wrapper.unmount();

    fireFullscreenChange(document.createElement("div"));
    await nextTick();

    // No error from a listener touching a torn-down component, and the last
    // value it saw stays put — there is nothing left to update it.
    expect(exposed.fullscreenEl.value).toBeNull();
  });
});
