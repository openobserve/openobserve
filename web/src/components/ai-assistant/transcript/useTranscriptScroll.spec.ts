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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";

import { MARKDOWN_FILL_EVENT } from "./markdown";
import { useTranscriptScroll, type TranscriptScroll } from "./useTranscriptScroll";

interface Harness {
  el: HTMLElement;
  api: TranscriptScroll;
  follow: { value: boolean };
  setFollow: ReturnType<typeof vi.fn>;
  saveTop: ReturnType<typeof vi.fn>;
  content: { value: number };
  turn: { value: string | null };
  session: { value: string | null };
  unmount(): void;
}

// jsdom lays nothing out, so the box is described by hand: 1000 px of content in a 200 px window.
function harness(over: { savedTop?: number | "bottom"; follow?: boolean } = {}): Harness {
  const follow = ref(over.follow ?? true);
  const content = ref(0);
  const turn = ref<string | null>("t1");
  const session = ref<string | null>("s1");
  const setFollow = vi.fn((value: boolean) => (follow.value = value));
  const saveTop = vi.fn();
  let api!: TranscriptScroll;
  const container = ref<HTMLElement | null>(null);
  const Host = defineComponent({
    setup() {
      api = useTranscriptScroll({
        container,
        follow: () => follow.value,
        setFollow,
        savedTop: () => over.savedTop ?? "bottom",
        saveTop,
        content: () => content.value,
        latestTurn: () => turn.value,
        session: () => session.value,
        reducedMotion: () => true,
      });
      return () =>
        h("div", { ref: container, tabindex: 0 }, [
          h("article", { "data-turn-id": "t1", "data-scroll-anchor": "" }),
          h("article", { "data-turn-id": "t2", "data-scroll-anchor": "" }),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const el = wrapper.element as HTMLElement;
  return {
    el,
    api,
    follow,
    setFollow,
    saveTop,
    content,
    turn,
    session,
    unmount: () => wrapper.unmount(),
  };
}

function layout(el: HTMLElement, scrollHeight = 1000, clientHeight = 200) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

// jsdom never resizes, so the test reports a box's height by hand.
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this);
  }
  observe(node: Element) {
    this.observed.add(node);
    this.resize(node, 0);
  }
  unobserve(node: Element) {
    this.observed.delete(node);
  }
  disconnect() {
    this.observed.clear();
  }
  resize(target: Element, height: number) {
    if (!this.observed.has(target)) return;
    const entry = { target, contentRect: { height } } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

const realResizeObserver = globalThis.ResizeObserver;

function fakeResizes(): () => FakeResizeObserver | undefined {
  FakeResizeObserver.made = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return () => FakeResizeObserver.made[FakeResizeObserver.made.length - 1];
}

function userScroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

// A following reader at the bottom (800 of 1000) whose second turn starts `top` px from the viewport top when revealed.
function revealSecond(t: Harness, top: number): HTMLElement {
  layout(t.el);
  t.el.scrollTop = 800;
  const block = t.el.querySelector<HTMLElement>('[data-turn-id="t2"]')!;
  vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
  t.api.reveal(block);
  return block;
}

describe("useTranscriptScroll (`30` §1.3)", () => {
  afterEach(() => {
    vi.stubGlobal("ResizeObserver", realResizeObserver);
  });

  it("rule 1: follows every committed batch to the bottom while following", async () => {
    const t = harness();
    layout(t.el, 1000);
    t.content.value += 1;
    await nextTick();
    expect(t.el.scrollTop).toBe(1000);
    t.unmount();
  });

  it("rule 1: follows a Markdown part that grows in a later slice, and not when the reader left (Z3)", async () => {
    const t = harness();
    layout(t.el, 1000);
    const fill = () =>
      t.el
        .querySelector("article")!
        .dispatchEvent(new Event(MARKDOWN_FILL_EVENT, { bubbles: true }));
    fill();
    fill();
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1000);
    t.follow.value = false;
    layout(t.el, 1400);
    fill();
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1000);
    t.unmount();
  });

  it("rule 2: any upward move by the reader stops following; no delta re-arms it", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    userScroll(t.el, 999);
    expect(t.setFollow).toHaveBeenLastCalledWith(false);
    t.content.value += 1;
    await nextTick();
    expect(t.el.scrollTop).toBe(999);
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("rule 2: a reader scroll still counts after a batch that did not move the view", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    t.el.dispatchEvent(new Event("scroll"));
    t.content.value += 1;
    await nextTick();
    userScroll(t.el, 900);
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("rule 2: a reader move coalesced with a batch's own scroll into one event ends following", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    t.el.scrollTop = 940;
    t.content.value += 1;
    await nextTick();
    t.el.scrollTop = 900;
    t.el.dispatchEvent(new Event("scroll"));
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("rule 2: a wheel up ends following even when the batch's scroll wins the frame", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    t.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -40 }));
    t.content.value += 1;
    await nextTick();
    t.el.dispatchEvent(new Event("scroll"));
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("does not end following when a layout change clamps the position without reader input", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    t.el.dispatchEvent(new Event("scroll"));
    layout(t.el, 700);
    t.el.scrollTop = 500;
    t.el.dispatchEvent(new Event("scroll"));
    expect(t.follow.value).toBe(true);
    t.unmount();
  });

  it("keeps following through every frame of a smooth Jump to latest (F8)", () => {
    const t = harness({ follow: false, savedTop: 100 });
    layout(t.el);
    const scrollTo = vi.fn();
    Object.defineProperty(t.el, "scrollTo", { configurable: true, value: scrollTo });
    t.el.scrollTop = 100;
    t.api.jumpToLatest();
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
    for (const top of [300, 520, 700, 800]) userScroll(t.el, top);
    expect(t.follow.value).toBe(true);
    t.unmount();
  });

  it("keeps following through a smooth End scroll, and a wheel during it still wins (F8)", () => {
    const t = harness({ follow: false, savedTop: 100 });
    layout(t.el);
    Object.defineProperty(t.el, "scrollTo", { configurable: true, value: vi.fn() });
    t.el.scrollTop = 100;
    const end = new KeyboardEvent("keydown", { key: "End" });
    Object.defineProperty(end, "target", { value: t.el });
    t.api.onKeydown(end);
    userScroll(t.el, 400);
    expect(t.follow.value).toBe(true);
    t.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("treats a resize clamp onto the bottom as layout even right after a wheel", async () => {
    const t = harness();
    layout(t.el);
    t.content.value += 1;
    await nextTick();
    t.el.dispatchEvent(new WheelEvent("wheel", { deltaY: 40 }));
    layout(t.el, 700);
    t.el.scrollTop = 500;
    t.el.dispatchEvent(new Event("scroll"));
    expect(t.follow.value).toBe(true);
    t.unmount();
  });

  it("follows again when the reader scrolls back to the bottom", () => {
    const t = harness({ follow: false, savedTop: 100 });
    layout(t.el);
    userScroll(t.el, 50);
    expect(t.follow.value).toBe(false);
    userScroll(t.el, 800);
    expect(t.setFollow).toHaveBeenLastCalledWith(true);
    t.unmount();
  });

  it("rule 3: Jump to latest and End re-arm following and land at the bottom", async () => {
    const t = harness({ follow: false, savedTop: 100 });
    layout(t.el, 1200);
    t.api.jumpToLatest();
    expect(t.setFollow).toHaveBeenLastCalledWith(true);
    expect(t.el.scrollTop).toBe(1200);
    t.follow.value = false;
    t.el.scrollTop = 0;
    const end = new KeyboardEvent("keydown", { key: "End" });
    Object.defineProperty(end, "target", { value: t.el });
    t.api.onKeydown(end);
    expect(t.follow.value).toBe(true);
    expect(t.el.scrollTop).toBe(1200);
    t.unmount();
  });

  it("rule 4: a new turn scrolls its top into view, not its bottom", async () => {
    const t = harness();
    layout(t.el);
    const second = t.el.querySelector<HTMLElement>('[data-turn-id="t2"]')!;
    vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ top: 640 } as DOMRect);
    t.el.scrollTop = 0;
    t.turn.value = "t2";
    await nextTick();
    expect(t.el.scrollTop).toBe(640);
    t.unmount();
  });

  it("rule 5: Show earlier keeps the block the reader was on where it was", async () => {
    const t = harness({ follow: false, savedTop: 300 });
    layout(t.el);
    const first = t.el.querySelector<HTMLElement>('[data-turn-id="t1"]')!;
    Object.defineProperty(first, "offsetHeight", { value: 400 });
    vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const rect = vi.spyOn(first, "getBoundingClientRect").mockReturnValue({ top: -50 } as DOMRect);
    await t.api.preserveAnchor(() => {
      rect.mockReturnValue({ top: 750 } as DOMRect);
    });
    expect(t.el.scrollTop).toBe(300 + 800);
    t.unmount();
  });

  it("rule 6: a session switch follows again, and a remount restores the saved position", async () => {
    const t = harness({ follow: false, savedTop: 250 });
    layout(t.el);
    t.session.value = "s2";
    await nextTick();
    expect(t.setFollow).toHaveBeenLastCalledWith(true);
    t.unmount();
    expect(t.saveTop).toHaveBeenCalled();
    const back = harness({ follow: false, savedTop: 250 });
    expect(back.el.scrollTop).toBe(250);
    back.unmount();
  });

  it("reveals a block's top above the viewport while following, and leaves a reader alone", () => {
    const t = harness();
    layout(t.el);
    t.el.scrollTop = 800;
    const block = t.el.querySelector<HTMLElement>('[data-turn-id="t2"]')!;
    vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top: -120 } as DOMRect);
    t.api.reveal(block);
    expect(t.el.scrollTop).toBe(680);
    t.el.dispatchEvent(new Event("scroll"));
    expect(t.follow.value).toBe(true);
    t.follow.value = false;
    t.el.scrollTop = 800;
    t.api.reveal(block);
    expect(t.el.scrollTop).toBe(800);
    t.unmount();
  });

  it("stays at the bottom when the log itself shrinks under a following reader", async () => {
    const observer = fakeResizes();
    const t = harness();
    layout(t.el);
    t.el.scrollTop = 800;
    layout(t.el, 1000, 182);
    observer()!.resize(t.el, 182);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1000);
    t.unmount();
  });

  it("leaves a reader who is not following where they are when the log shrinks", async () => {
    const observer = fakeResizes();
    const t = harness({ follow: false, savedTop: 300 });
    layout(t.el);
    layout(t.el, 1000, 182);
    observer()!.resize(t.el, 182);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(300);
    expect(t.follow.value).toBe(false);
    t.unmount();
  });

  it("re-pins a following reader when a row grows with no batch, and keeps a revealed block's top in view", async () => {
    const observer = fakeResizes();
    const t = harness();
    layout(t.el);
    t.el.scrollTop = 800;
    const block = t.el.querySelector<HTMLElement>('[data-turn-id="t2"]')!;
    layout(t.el, 1052);
    observer()!.resize(block, 52);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1052);
    vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const rect = vi.spyOn(block, "getBoundingClientRect").mockReturnValue({ top: -120 } as DOMRect);
    t.api.reveal(block);
    expect(t.el.scrollTop).toBe(932);
    rect.mockReturnValue({ top: 0 } as DOMRect);
    layout(t.el, 1052, 182);
    observer()!.resize(t.el, 182);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(932);
    t.unmount();
  });

  it("does not hold a revealed block that was already in view", async () => {
    const observer = fakeResizes();
    const t = harness();
    const block = revealSecond(t, 10);
    expect(t.el.scrollTop).toBe(800);
    layout(t.el, 1052);
    observer()!.resize(block, 52);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1052);
    t.unmount();
  });

  it("releases a revealed block when the reader leaves and scrolls back to the bottom", async () => {
    const observer = fakeResizes();
    const t = harness();
    const block = revealSecond(t, -120);
    expect(t.el.scrollTop).toBe(680);
    userScroll(t.el, 600);
    expect(t.follow.value).toBe(false);
    userScroll(t.el, 800);
    expect(t.follow.value).toBe(true);
    layout(t.el, 1052);
    observer()!.resize(block, 52);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1052);
    t.unmount();
  });

  it("releases a revealed block on Jump to latest", async () => {
    const observer = fakeResizes();
    const t = harness();
    const block = revealSecond(t, -120);
    t.api.jumpToLatest();
    expect(t.el.scrollTop).toBe(1000);
    layout(t.el, 1052);
    observer()!.resize(block, 52);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1052);
    t.unmount();
  });

  it("releases a revealed block on the next committed batch", async () => {
    const observer = fakeResizes();
    const t = harness();
    const block = revealSecond(t, -120);
    t.content.value += 1;
    await nextTick();
    expect(t.el.scrollTop).toBe(1000);
    layout(t.el, 1052);
    observer()!.resize(block, 52);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1052);
    t.unmount();
  });

  it("rule 4: a log resize after a new turn keeps that turn's top in view", async () => {
    const observer = fakeResizes();
    const t = harness();
    layout(t.el);
    const second = t.el.querySelector<HTMLElement>('[data-turn-id="t2"]')!;
    vi.spyOn(t.el, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const rect = vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ top: 640 } as DOMRect);
    t.el.scrollTop = 0;
    t.turn.value = "t2";
    await nextTick();
    expect(t.el.scrollTop).toBe(640);
    rect.mockReturnValue({ top: 0 } as DOMRect);
    layout(t.el, 1000, 182);
    observer()!.resize(t.el, 182);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(640);
    t.unmount();
  });

  it("lands on the real bottom when content grew during a smooth Jump to latest", async () => {
    const t = harness({ follow: false, savedTop: 100 });
    layout(t.el);
    Object.defineProperty(t.el, "scrollTo", { configurable: true, value: vi.fn() });
    t.el.scrollTop = 100;
    t.api.jumpToLatest();
    layout(t.el, 1200);
    for (const top of [400, 700, 800]) userScroll(t.el, top);
    await Promise.resolve();
    expect(t.el.scrollTop).toBe(1200);
    expect(t.follow.value).toBe(true);
    t.unmount();
  });

  it("observes the log while mounted and disconnects on unmount", () => {
    const observer = fakeResizes();
    const t = harness();
    expect(observer()?.observed.has(t.el)).toBe(true);
    t.unmount();
    expect(observer()?.observed.size).toBe(0);
  });

  it("ignores keys that did not land on the transcript itself", () => {
    const t = harness({ follow: false });
    const event = new KeyboardEvent("keydown", { key: "End" });
    Object.defineProperty(event, "target", { value: document.body });
    t.api.onKeydown(event);
    expect(t.setFollow).not.toHaveBeenCalled();
    t.unmount();
  });
});
