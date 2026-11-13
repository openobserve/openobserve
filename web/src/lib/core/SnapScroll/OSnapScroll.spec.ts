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

type Paging = { pageStop: (d: 1 | -1) => void; pageSection: (d: 1 | -1) => void };
const paging = (wrapper: VueWrapper) => wrapper.vm as unknown as Paging;

const wheel = (target: Element, deltaY: number) => {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("OSnapScroll", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("leaves the wheel and trackpad to the browser", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    for (const deltaY of [3, 40, 400, -40])
      expect(wheel(root, deltaY).defaultPrevented).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not force-snap scroll positions", () => {
    wrapper = mountScroll();
    const classes = wrapper.find('[data-test="o-snap-scroll"]').classes();
    expect(classes.some((c) => /snap-(y|mandatory|proximity|start)/.test(c))).toBe(false);
  });

  it("pages one stop at a time", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    paging(wrapper).pageStop(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: "smooth" });
    root.scrollTop = 400;
    paging(wrapper).pageStop(-1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  });

  it("stops at the end of a section taller than the view before moving on", () => {
    wrapper = mountScroll();
    const { root, scrollTo } = layOut(wrapper);
    Object.defineProperty(root.querySelector("#one"), "offsetHeight", {
      configurable: true,
      value: 700,
    });
    paging(wrapper).pageStop(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });

    root.scrollTop = 200;
    paging(wrapper).pageStop(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: "smooth" });

    root.scrollTop = 400;
    paging(wrapper).pageStop(-1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "smooth" });
  });

  it("never pages past more than one view of content", () => {
    tops.two = 900;
    try {
      wrapper = mountScroll();
      const { scrollTo } = layOut(wrapper);
      paging(wrapper).pageStop(1);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 500, behavior: "smooth" });
    } finally {
      tops.two = 400;
    }
  });

  it("spends no key press on a stop right at the section start", () => {
    wrapper = mount(OSnapScroll, {
      attachTo: document.body,
      props: { snap: true },
      slots: {
        default: () => [
          h("section", { "data-snap-section": "one", id: "one" }, [
            h("div", { "data-snap-stop": "", id: "near" }),
            h("div", { "data-snap-stop": "", id: "far" }),
          ]),
        ],
      },
    });
    const root = wrapper.find('[data-test="o-snap-scroll"]').element as HTMLElement;
    Object.defineProperty(root, "clientHeight", { configurable: true, value: 500 });
    Object.defineProperty(root, "scrollHeight", { configurable: true, value: 1200 });
    root.getBoundingClientRect = () => rect(0);
    const place = (id: string, top: number, height: number) => {
      const el = root.querySelector<HTMLElement>(`#${id}`)!;
      el.getBoundingClientRect = () => rect(top - root.scrollTop);
      Object.defineProperty(el, "offsetHeight", { configurable: true, value: height });
    };
    place("one", 0, 1200);
    place("near", 9, 100);
    place("far", 300, 100);
    root.scrollTo = vi.fn() as unknown as typeof root.scrollTo;
    paging(wrapper).pageStop(1);
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: "smooth" });
  });

  it("jumps whole sections with section paging", () => {
    wrapper = mountScroll();
    const { scrollTo } = layOut(wrapper, 400);
    paging(wrapper).pageSection(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 700, behavior: "smooth" });
    paging(wrapper).pageSection(-1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
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

  describe("inside a block taller than the view", () => {
    const tallLayout = (w: VueWrapper, targetTop: number) => {
      const { root, scrollTo } = layOut(w);
      Object.defineProperty(root, "scrollHeight", { configurable: true, value: 3000 });
      root.querySelector<HTMLElement>("#three")!.getBoundingClientRect = () => rect(2400);
      const section = root.querySelector<HTMLElement>("#two")!;
      Object.defineProperty(section, "offsetHeight", { value: 1800 });
      const block = document.createElement("div");
      block.setAttribute("data-snap-stop", "");
      block.style.setProperty("scroll-margin-top", "48px");
      Object.defineProperty(block, "offsetHeight", { value: 1400 });
      block.getBoundingClientRect = () => rect(450);
      const target = document.createElement("button");
      target.getBoundingClientRect = () => rect(targetTop);
      block.appendChild(target);
      section.appendChild(block);
      return { scrollTo, target };
    };

    it("rests just under the header above the element instead of on the block's start", () => {
      wrapper = mountScroll();
      const { scrollTo, target } = tallLayout(wrapper, 1600);
      reveal(wrapper, target);
      expect(scrollTo).toHaveBeenCalledWith({ top: 1552, behavior: "instant" });
    });

    it("stops where the section still covers the view when the element sits near its end", () => {
      wrapper = mountScroll();
      const { scrollTo, target } = tallLayout(wrapper, 2000);
      reveal(wrapper, target);
      expect(scrollTo).toHaveBeenCalledWith({ top: 1700, behavior: "instant" });
    });
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
