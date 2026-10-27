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

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

import { raw } from "@/types/i18n";

import OSheet from "./OSheet.vue";
import type { OSheetProps } from "./OSheet.types";

const base: OSheetProps = {
  open: true,
  snap: "half",
  ariaLabel: "Assistant",
  dataTest: "sheet",
  expandLabel: raw("Show more"),
  collapseLabel: raw("Show less"),
};

const sheet = () => document.body.querySelector<HTMLElement>('[data-test="sheet"]');
const handle = () => document.body.querySelector<HTMLElement>('[data-test="sheet-handle"]')!;

const mounted: VueWrapper[] = [];

function mountSheet(props: Partial<OSheetProps> = {}, slots: Record<string, string> = {}) {
  const wrapper = mount(OSheet, { props: { ...base, ...props }, slots, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

const inset = () => document.documentElement.style.getPropertyValue("--o-assistant-inset-bottom");

const escape = (init: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });

function rectAt(el: Element, top: number): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
}

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
});

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--o-assistant-inset-bottom");
  vi.restoreAllMocks();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
});

describe("OSheet", () => {
  it("is a named non-modal dialog portalled to body", () => {
    const wrapper = mountSheet({}, { default: "<p>body</p>" });
    const el = sheet()!;
    expect(el.parentElement).toBe(document.body);
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-modal")).toBe("false");
    expect(el.getAttribute("aria-label")).toBe("Assistant");
    expect(el.textContent).toContain("body");
    wrapper.unmount();
  });

  it("renders in place when inline, so a modal drawer's focus scope keeps it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const wrapper = mount(OSheet, { props: { ...base, inline: true }, attachTo: host });
    mounted.push(wrapper);
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("spans only the columns of the element it is aligned to, and follows it when it resizes", async () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const drawer = document.createElement("div");
    let rect = { left: 460, right: 768, width: 308 };
    drawer.getBoundingClientRect = () => rect as DOMRect;
    vi.stubGlobal("innerWidth", 800);
    mountSheet({ alignTo: drawer });
    await nextTick();
    expect(sheet()!.style.getPropertyValue("--o-sheet-start")).toBe("460");
    expect(sheet()!.style.getPropertyValue("--o-sheet-end")).toBe("32");
    rect = { left: 230, right: 768, width: 538 };
    observers.forEach((callback) => callback([], {} as ResizeObserver));
    expect(sheet()!.style.getPropertyValue("--o-sheet-start")).toBe("230");
    vi.unstubAllGlobals();
  });

  it("spans the whole window on a phone or for a target as wide as the window, as every other sheet does", async () => {
    const drawer = document.createElement("div");
    drawer.getBoundingClientRect = () => ({ left: 10, right: 365, width: 355 }) as DOMRect;
    vi.stubGlobal("innerWidth", 375);
    mountSheet({ alignTo: drawer });
    await nextTick();
    expect(sheet()!.style.getPropertyValue("--o-sheet-start")).toBe("0");
    expect(sheet()!.style.getPropertyValue("--o-sheet-end")).toBe("0");
    vi.unstubAllGlobals();
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    mountSheet({});
    await nextTick();
    expect(sheet()!.style.getPropertyValue("--o-sheet-start")).toBe("0");
  });

  it("renders nothing while closed", () => {
    mountSheet({ open: false });
    expect(sheet()).toBeNull();
  });

  it("sizes each snap in dvh with the safe-area inset and the registered layer", () => {
    for (const [snap, cls] of [
      ["peek", "h-14"],
      ["half", "h-[50dvh]"],
      ["full", "h-[calc(100dvh-var(--navbar-height,2.25rem))]"],
    ] as const) {
      const wrapper = mountSheet({ snap });
      expect(sheet()!.dataset.snap).toBe(snap);
      expect(sheet()!.classList).toContain(cls);
      expect(sheet()!.classList).toContain("pb-[env(safe-area-inset-bottom)]");
      expect(sheet()!.classList).toContain("z-6000");
      expect(sheet()!.className).not.toMatch(/100vh/);
      wrapper.unmount();
    }
  });

  it("changes snaps instantly under reduced motion", () => {
    mountSheet();
    expect(sheet()!.classList).toContain("motion-reduce:transition-none");
    expect(sheet()!.classList).toContain("motion-safe:transition-[height]");
  });

  it("offers Show more and Show less only where a larger or smaller snap exists", async () => {
    const wrapper = mountSheet({ snap: "half" });
    const more = document.body.querySelector<HTMLElement>('[data-test="sheet-expand"]')!;
    const less = document.body.querySelector<HTMLElement>('[data-test="sheet-peek"]')!;
    expect(more.textContent).toContain("Show more");
    expect(less.textContent).toContain("Show less");
    more.click();
    less.click();
    expect(wrapper.emitted("update:snap")).toEqual([["full"], ["peek"]]);
    await wrapper.setProps({ snap: "full" });
    expect(document.body.querySelector('[data-test="sheet-expand"]')).toBeNull();
    await wrapper.setProps({ snap: "half", snapPoints: ["half", "full"] });
    expect(document.body.querySelector('[data-test="sheet-peek"]')).toBeNull();
  });

  it("drags to the nearest snap point and never to a free height", async () => {
    const wrapper = mountSheet({ snap: "half" });
    handle().dispatchEvent(new PointerEvent("pointerdown", { clientY: 400, bubbles: true }));
    handle().dispatchEvent(new PointerEvent("pointerup", { clientY: 120, bubbles: true }));
    expect(wrapper.emitted("update:snap")).toEqual([["full"]]);
    handle().dispatchEvent(new PointerEvent("pointerdown", { clientY: 400, bubbles: true }));
    handle().dispatchEvent(new PointerEvent("pointerup", { clientY: 730, bubbles: true }));
    expect(wrapper.emitted("update:snap")?.[1]).toEqual(["peek"]);
  });

  it("dismisses on a swipe below peek unless persistent", async () => {
    const wrapper = mountSheet({ snap: "peek" });
    handle().dispatchEvent(new PointerEvent("pointerdown", { clientY: 740, bubbles: true }));
    handle().dispatchEvent(new PointerEvent("pointerup", { clientY: 795, bubbles: true }));
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    wrapper.unmount();
    const kept = mountSheet({ snap: "peek", persistent: true });
    handle().dispatchEvent(new PointerEvent("pointerdown", { clientY: 740, bubbles: true }));
    handle().dispatchEvent(new PointerEvent("pointerup", { clientY: 795, bubbles: true }));
    expect(kept.emitted("dismiss")).toBeUndefined();
  });

  it("opens half from a tap on the handle at peek", () => {
    const wrapper = mountSheet({ snap: "peek" });
    handle().dispatchEvent(new PointerEvent("pointerdown", { clientY: 770, bubbles: true }));
    handle().dispatchEvent(new PointerEvent("pointerup", { clientY: 772, bubbles: true }));
    expect(wrapper.emitted("update:snap")).toEqual([["half"]]);
  });

  it("writes its covered height to the page inset and clears it on close", async () => {
    const wrapper = mountSheet({ open: false });
    await wrapper.setProps({ open: true });
    rectAt(sheet()!, 500);
    await wrapper.setProps({ snap: "full" });
    await flushPromises();
    expect(document.documentElement.style.getPropertyValue("--o-assistant-inset-bottom")).toBe(
      "300",
    );
    await wrapper.setProps({ open: false });
    expect(document.documentElement.style.getPropertyValue("--o-assistant-inset-bottom")).toBe("");
  });

  it("tracks the on-screen keyboard through visualViewport", async () => {
    const listeners: Record<string, () => void> = {};
    const viewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    mountSheet();
    await flushPromises();
    expect(sheet()!.style.getPropertyValue("--o-sheet-kb")).toBe("300");
    viewport.height = 800;
    listeners.resize();
    expect(sheet()!.style.getPropertyValue("--o-sheet-kb")).toBe("0");
  });

  it("stays above anchorAbove", async () => {
    const footer = document.createElement("div");
    document.body.appendChild(footer);
    rectAt(footer, 740);
    mountSheet({ anchorAbove: footer });
    await flushPromises();
    expect(sheet()!.style.getPropertyValue("--o-sheet-anchor")).toBe("60");
  });

  it("stays above the footer of the open drawer and portals after it", async () => {
    const drawer = document.createElement("div");
    drawer.setAttribute("data-o2-drawer", "");
    drawer.setAttribute("data-state", "open");
    drawer.innerHTML = '<div></div><div class="overflow-y-auto"></div><footer></footer>';
    document.body.appendChild(drawer);
    rectAt(drawer.querySelector("footer")!, 720);
    mountSheet();
    await flushPromises();
    expect(sheet()!.style.getPropertyValue("--o-sheet-anchor")).toBe("80");
    expect(
      drawer.compareDocumentPosition(sheet()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the inset of a sheet that stays open when another one closes", async () => {
    const first = mountSheet({ open: false, dataTest: "first" });
    const second = mountSheet({ open: false, dataTest: "second" });
    await first.setProps({ open: true });
    await second.setProps({ open: true });
    rectAt(document.body.querySelector('[data-test="first"]')!, 400);
    rectAt(document.body.querySelector('[data-test="second"]')!, 600);
    await first.setProps({ snap: "full" });
    await second.setProps({ snap: "full" });
    await flushPromises();
    expect(inset()).toBe("400");
    await second.setProps({ open: false });
    expect(inset()).toBe("400");
    await first.setProps({ open: false });
    expect(inset()).toBe("");
  });

  it("closes on Escape unless persistent, told not to, or composing", async () => {
    const wrapper = mountSheet({}, { default: '<button data-test="inside">x</button>' });
    await flushPromises();
    const inside = document.body.querySelector<HTMLElement>('[data-test="inside"]')!;
    inside.dispatchEvent(escape({ isComposing: true }));
    expect(wrapper.emitted("update:open")).toBeUndefined();
    const event = escape();
    inside.dispatchEvent(event);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
    for (const props of [{ persistent: true }, { closeOnEscape: false }]) {
      const kept = mountSheet({ ...props, dataTest: "kept" }, { default: "<button>y</button>" });
      await flushPromises();
      document.body.querySelector('[data-test="kept"] button')!.dispatchEvent(escape());
      expect(kept.emitted("update:open")).toBeUndefined();
      kept.unmount();
    }
  });

  it("keeps its content mounted while closed when asked", async () => {
    const wrapper = mountSheet({ open: false, keepMounted: true }, { default: "<p>kept</p>" });
    expect(sheet()?.style.display).toBe("none");
    expect(sheet()?.textContent).toContain("kept");
    await wrapper.setProps({ open: true });
    expect(sheet()?.style.display).toBe("");
  });

  it("shows only the peek row at peek, and the whole row expands", async () => {
    const wrapper = mountSheet(
      { snap: "peek" },
      { peek: "<span>Checkout spike</span>", default: "<p>body</p>" },
    );
    const row = document.body.querySelector<HTMLElement>('[data-test="sheet-peek-row"]')!;
    expect(row.textContent).toContain("Checkout spike");
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(row.querySelector(".sr-only")?.textContent).toBe("Show more");
    expect(handle().closest<HTMLElement>("div[style]")?.style.display).toBe("none");
    row.click();
    expect(wrapper.emitted("update:snap")).toEqual([["half"]]);
    await wrapper.setProps({ snap: "half" });
    expect(document.body.querySelector('[data-test="sheet-peek-row"]')).toBeNull();
  });
});
