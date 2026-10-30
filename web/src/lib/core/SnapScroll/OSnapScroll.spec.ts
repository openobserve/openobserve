// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import OSnapScroll from "./OSnapScroll.vue";

const tops: Record<string, number> = { one: 0, two: 400, three: 800 };

const mountScroll = (snap = true) =>
  mount(OSnapScroll, {
    attachTo: document.body,
    props: { snap },
    slots: {
      default: () =>
        Object.keys(tops).map((id) => h("section", { "data-snap-section": id, id }, id)),
    },
  });

const rect = (top: number) =>
  ({ top, bottom: top + 300, left: 0, right: 0, height: 300 }) as DOMRect;

const layOut = (wrapper: VueWrapper, scrollTop = 0) => {
  const root = wrapper.find('[data-test="o-snap-scroll"]').element as HTMLElement;
  Object.defineProperty(root, "clientHeight", { configurable: true, value: 500 });
  Object.defineProperty(root, "scrollHeight", { configurable: true, value: 1200 });
  root.scrollTop = scrollTop;
  root.getBoundingClientRect = () => rect(0);
  for (const [id, top] of Object.entries(tops)) {
    const el = root.querySelector<HTMLElement>(`#${id}`)!;
    el.getBoundingClientRect = () => rect(top - root.scrollTop);
  }
  const scrollTo = vi.fn();
  root.scrollTo = scrollTo as unknown as typeof root.scrollTo;
  return { root, scrollTo };
};

const wheel = (target: Element, deltaY: number, timeStamp: number) => {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  target.dispatchEvent(event);
  return event;
};

describe("OSnapScroll", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("moves one stop per wheel gesture and swallows the native scroll", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    const first = wheel(root, 40, 1000);
    wheel(root, 40, 1050);
    wheel(root, 40, 1100);
    expect(first.defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: "smooth" });
    wheel(root, 40, 1600);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("pages up to the previous section start", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper, 400);
    wheel(root, -40, 1000);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("leaves the wheel alone when snapping is off", () => {
    wrapper = mountScroll(false);
    const { root, scrollTo } = layOut(wrapper);
    const event = wheel(root, 40, 1000);
    expect(event.defaultPrevented).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls a section's start to the top on request", () => {
    wrapper = mountScroll();
    const { scrollTo } = layOut(wrapper);
    (wrapper.vm as unknown as { scrollToSection: (id: string) => void }).scrollToSection("three");
    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: "smooth" });
  });

  it("moves focus to the section's heading without scrolling again", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    const heading = document.createElement("h2");
    heading.setAttribute("data-snap-heading", "");
    heading.tabIndex = -1;
    const focus = vi.spyOn(heading, "focus");
    root.querySelector("#three")!.appendChild(heading);
    (wrapper.vm as unknown as { scrollToSection: (id: string) => void }).scrollToSection("three");
    expect(document.activeElement).toBe(heading);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("reports the section in view as the user scrolls", async () => {
    wrapper = mountScroll();
    const { root } = layOut(wrapper, 400);
    root.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const emitted = wrapper.emitted("update:active") ?? [];
    expect(emitted[emitted.length - 1]).toEqual(["two"]);
  });
  it("makes each section at least one view tall while snapping, and not otherwise", () => {
    wrapper = mountScroll(true);
    const classes = wrapper.find('[data-test="o-snap-scroll"]').classes();
    expect(classes).toContain("[container-type:size]");
    expect(classes).toContain("[&_[data-snap-section]]:min-h-[100cqh]");
    wrapper.unmount();
    wrapper = mountScroll(false);
    const flowing = wrapper.find('[data-test="o-snap-scroll"]').classes();
    expect(flowing.some((c) => c.includes("min-h-[100cqh]"))).toBe(false);
    expect(flowing).not.toContain("[container-type:size]");
  });
});

describe("OSnapScroll.revealElement", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const reveal = (w: VueWrapper, el: HTMLElement) =>
    (w.vm as unknown as { revealElement: (el: HTMLElement) => void }).revealElement(el);

  it("lands instantly on the last stop at or above the element while snapping", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    const inner = document.createElement("input");
    root.querySelector("#two")!.appendChild(inner);
    inner.getBoundingClientRect = () => rect(650);
    reveal(wrapper, inner);
    expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: "instant" });
  });

  it("centres the element instantly when snapping is off", () => {
    wrapper = mountScroll(false);
    const { root, scrollTo } = layOut(wrapper);
    const inner = document.createElement("input");
    root.querySelector("#three")!.appendChild(inner);
    const scrollIntoView = vi.fn();
    inner.scrollIntoView = scrollIntoView;
    reveal(wrapper, inner);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "center" });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("ignores an element outside the scroller", () => {
    wrapper = mountScroll();
    const { scrollTo } = layOut(wrapper);
    reveal(wrapper, document.createElement("div"));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
