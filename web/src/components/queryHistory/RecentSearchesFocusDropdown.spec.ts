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
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import { FIRST_LINE_CARET, type CaretBox } from "@/test/unit/helpers/monacoCaret";

const api = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn(), star: vi.fn(), remove: vi.fn() }));
vi.mock("@/services/query_history", () => ({ default: api }));

import RecentSearchesFocusDropdown from "./RecentSearchesFocusDropdown.vue";

enableAutoUnmount(afterEach);

const rectOf =
  ({ left, top, right, bottom }: CaretBox) =>
  () =>
    ({
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;

// The editor box with Monaco's caret element inside, as the real editor renders it.
const editorWithCaret = (caret: CaretBox) => {
  const anchor = document.createElement("div");
  const monaco = document.createElement("div");
  monaco.className = "monaco-editor";
  const layer = document.createElement("div");
  layer.className = "cursors-layer";
  const cursor = document.createElement("div");
  cursor.className = "cursor";
  cursor.getBoundingClientRect = rectOf(caret);
  layer.appendChild(cursor);
  monaco.appendChild(layer);
  anchor.appendChild(monaco);
  document.body.appendChild(anchor);
  // Monaco moves its caret by rewriting the element's inline style, which is what the panel listens for.
  const moveCaret = (to: CaretBox) => {
    cursor.getBoundingClientRect = rectOf(to);
    cursor.style.top = `${to.top}px`;
    cursor.style.left = `${to.left}px`;
  };
  // A page scroll or a resize moves the caret on screen with no change inside the editor.
  const shiftCaret = (to: CaretBox) => (cursor.getBoundingClientRect = rectOf(to));
  return { anchor, monaco, moveCaret, shiftCaret };
};

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

const panel = () =>
  document.querySelector<HTMLElement>('[data-test="recent-searches-focus-dropdown"]');

const px = (value: string) => parseFloat(value);

const ownsNode = vi.fn((_node: Node | null) => false);
const PopoverStub = defineComponent({
  setup(_, { expose }) {
    expose({
      ownsNode,
      focusFirst: () => false,
      pickActive: () => false,
      scrollDetails: () => false,
    });
    return () => h("div", { "data-test": "popover-stub" });
  },
});

const mountDropdown = (anchor: HTMLElement | null) =>
  mount(RecentSearchesFocusDropdown, {
    props: { source: "logs", anchor, open: true },
    attachTo: document.body,
    global: { plugins: [store], stubs: { RecentSearchesPopover: PopoverStub } },
  });

describe("RecentSearchesFocusDropdown placement at the caret", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    store.state.zoConfig.query_history_enabled = true;
    setViewport(1440, 900);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete store.state.zoConfig.query_history_enabled;
    setViewport(1024, 768);
    document.body.innerHTML = "";
  });

  it("opens under the caret line from the caret's x, like the editor's suggest widget", () => {
    mountDropdown(editorWithCaret(FIRST_LINE_CARET).anchor);
    const el = panel()!;
    expect(el.dataset.side).toBe("below");
    expect(px(el.style.top)).toBe(FIRST_LINE_CARET.bottom);
    expect(px(el.style.left)).toBe(FIRST_LINE_CARET.left);
    expect(el.style.bottom).toBe("");
    expect(px(el.style.maxHeight)).toBe(900 - FIRST_LINE_CARET.bottom - 8);
  });

  it("shifts left to stay on-screen when the caret is near the right edge", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(430);
    mountDropdown(editorWithCaret({ left: 1300, top: 91, right: 1302, bottom: 109 }).anchor);
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(px(panel()!.style.left)).toBe(1440 - 430 - 8);
    expect(px(panel()!.style.top)).toBe(109);
  });

  it("flips above the caret line only when there is no room below, never covering it", () => {
    const caret = { left: 200, top: 800, right: 202, bottom: 818 };
    mountDropdown(editorWithCaret(caret).anchor);
    const el = panel()!;
    expect(el.dataset.side).toBe("above");
    expect(px(el.style.bottom)).toBe(900 - caret.top);
    expect(el.style.top).toBe("");
    expect(px(el.style.left)).toBe(caret.left);
    expect(px(el.style.maxHeight)).toBe(caret.top - 8);
  });

  it("stays below with the least room it needs, rather than flipping", () => {
    const caret = { left: 200, top: 714, right: 202, bottom: 732 };
    mountDropdown(editorWithCaret(caret).anchor);
    expect(panel()!.dataset.side).toBe("below");
    expect(px(panel()!.style.maxHeight)).toBe(160);
  });

  it("stays closed when there is room neither below nor above the caret line", async () => {
    setViewport(1440, 200);
    const wrapper = mountDropdown(
      editorWithCaret({ left: 200, top: 90, right: 202, bottom: 108 }).anchor,
    );
    await nextTick();
    expect(panel()).toBeNull();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("stays closed while the editor has no caret on screen", async () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const wrapper = mountDropdown(anchor);
    await nextTick();
    expect(panel()).toBeNull();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("follows the caret as Monaco moves it, without polling", async () => {
    const { anchor, moveCaret } = editorWithCaret(FIRST_LINE_CARET);
    mountDropdown(anchor);
    moveCaret({ left: 420, top: 127, right: 422, bottom: 145 });
    await settle();
    await nextTick();
    expect(px(panel()!.style.top)).toBe(145);
    expect(px(panel()!.style.left)).toBe(420);
  });

  it("follows the editor when its page scrolls, and ignores scrolling elsewhere", async () => {
    const { anchor, shiftCaret } = editorWithCaret(FIRST_LINE_CARET);
    const page = document.createElement("div");
    page.appendChild(anchor);
    document.body.appendChild(page);
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    mountDropdown(anchor);
    await settle();

    shiftCaret({ left: 113, top: 300, right: 115, bottom: 318 });
    elsewhere.dispatchEvent(new Event("scroll"));
    await settle();
    await nextTick();
    expect(px(panel()!.style.top)).toBe(109);

    page.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(px(panel()!.style.top)).toBe(318);
  });

  it("follows the editor when a banner mounts above it inside a container that keeps its size", async () => {
    const { anchor, shiftCaret } = editorWithCaret(FIRST_LINE_CARET);
    const column = document.createElement("div");
    column.appendChild(anchor);
    document.body.appendChild(column);
    mountDropdown(anchor);
    await settle();

    shiftCaret({ left: 113, top: 141, right: 115, bottom: 159 });
    column.insertBefore(document.createElement("div"), anchor);
    await settle();
    expect(px(panel()!.style.top)).toBe(159);
  });

  it("re-places on a synthetic window resize, as Metrics dispatches one after an edit", async () => {
    const { anchor, shiftCaret } = editorWithCaret(FIRST_LINE_CARET);
    const wrapper = mountDropdown(anchor);
    shiftCaret({ left: 461, top: 649, right: 463, bottom: 667 });
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    expect(px(panel()!.style.top)).toBe(667);
    expect(px(panel()!.style.left)).toBe(461);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it.each([
    ["above the viewport", { left: 113, top: -60, right: 115, bottom: -42 }],
    ["at the viewport top edge", { left: 113, top: -18, right: 115, bottom: 0 }],
    ["below the viewport", { left: 113, top: 900, right: 115, bottom: 918 }],
    ["far below the viewport", { left: 113, top: 1400, right: 115, bottom: 1418 }],
  ])("never opens off-screen with the caret line %s", async (_where, caret) => {
    const wrapper = mountDropdown(editorWithCaret(caret).anchor);
    await nextTick();
    expect(panel()).toBeNull();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it.each([
    ["above", { left: 113, top: -60, right: 115, bottom: -42 }],
    ["below", { left: 113, top: 1000, right: 115, bottom: 1018 }],
  ])("closes when the page scrolls the caret line %s the viewport", async (_where, caret) => {
    const { anchor, moveCaret } = editorWithCaret(FIRST_LINE_CARET);
    const wrapper = mountDropdown(anchor);
    expect(panel()).not.toBeNull();
    moveCaret(caret);
    await settle();
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("closes once the caret scrolls out of reach", async () => {
    const { anchor, moveCaret } = editorWithCaret(FIRST_LINE_CARET);
    const wrapper = mountDropdown(anchor);
    setViewport(1440, 300);
    moveCaret({ left: 113, top: 130, right: 115, bottom: 148 });
    await settle();
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});

describe("RecentSearchesFocusDropdown outside clicks", () => {
  beforeEach(() => {
    store.state.zoConfig.query_history_enabled = true;
    setViewport(1440, 900);
  });
  afterEach(() => {
    delete store.state.zoConfig.query_history_enabled;
    setViewport(1024, 768);
    document.body.innerHTML = "";
  });

  it("closes on a pointerdown elsewhere and lets that click reach its target", async () => {
    const picker = document.createElement("button");
    document.body.appendChild(picker);
    const onPicker = vi.fn();
    picker.addEventListener("click", onPicker);
    const seenPointerdown = vi.fn();
    document.addEventListener("pointerdown", seenPointerdown);
    const wrapper = mountDropdown(editorWithCaret(FIRST_LINE_CARET).anchor);
    expect(panel()).not.toBeNull();

    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    picker.dispatchEvent(down);
    picker.click();
    await nextTick();

    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(down.defaultPrevented).toBe(false);
    expect(seenPointerdown).toHaveBeenCalledTimes(1);
    expect(onPicker).toHaveBeenCalledTimes(1);
    document.removeEventListener("pointerdown", seenPointerdown);
  });

  it("stays open on a pointerdown in the list's details pane, which lives outside the panel", async () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);
    ownsNode.mockImplementation((node) => node === pane);
    const wrapper = mountDropdown(editorWithCaret(FIRST_LINE_CARET).anchor);
    pane.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    pane.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    ownsNode.mockReset();
    ownsNode.mockReturnValue(false);
  });

  it("stays open on a pointerdown in the editor or the panel", async () => {
    const { anchor, monaco } = editorWithCaret(FIRST_LINE_CARET);
    const wrapper = mountDropdown(anchor);
    monaco.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    panel()!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(panel()).not.toBeNull();
  });
});

describe("RecentSearchesFocusDropdown when the editor resizes while open", () => {
  const observers: {
    callback: ResizeObserverCallback;
    targets: Element[];
    boxes: (ResizeObserverBoxOptions | undefined)[];
  }[] = [];
  const RealResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    store.state.zoConfig.query_history_enabled = true;
    setViewport(1440, 900);
    observers.length = 0;
    globalThis.ResizeObserver = class {
      private entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, targets: [], boxes: [] };
        observers.push(this.entry);
      }
      observe(target: Element, options?: ResizeObserverOptions) {
        this.entry.targets.push(target);
        this.entry.boxes.push(options?.box);
      }
      unobserve() {}
      disconnect() {
        this.entry.targets = [];
      }
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = RealResizeObserver;
    delete store.state.zoConfig.query_history_enabled;
    setViewport(1024, 768);
    document.body.innerHTML = "";
  });

  const fireResize = () =>
    observers.forEach((o) => {
      if (o.targets.length) o.callback([], {} as ResizeObserver);
    });

  it("stays at the caret as the editor re-lays out, and closes once it would go off-screen", async () => {
    const { anchor, moveCaret } = editorWithCaret(FIRST_LINE_CARET);
    const wrapper = mountDropdown(anchor);
    const active = observers.find((o) => o.targets.length);
    expect(active?.targets).toEqual([anchor]);
    expect(active?.boxes).toEqual(["border-box"]);

    moveCaret({ left: 113, top: 300, right: 115, bottom: 318 });
    fireResize();
    await nextTick();
    expect(px(panel()!.style.top)).toBe(318);

    setViewport(1440, 240);
    moveCaret({ left: 113, top: 100, right: 115, bottom: 118 });
    fireResize();
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
