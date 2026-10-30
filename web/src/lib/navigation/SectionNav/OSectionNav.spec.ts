// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OSectionNav from "./OSectionNav.vue";
import { raw } from "@/types/i18n";
import type { SectionNavItem } from "./OSectionNav.types";

const items: SectionNavItem[] = [
  { id: "a", title: raw("First"), summary: raw("logs_stream"), state: "done" },
  { id: "b", title: raw("Second"), state: "attention", stateLabel: raw("Needs a value") },
  { id: "c", title: raw("Third"), state: "error", stateLabel: raw("Needs a fix") },
  { id: "d", title: raw("Fourth"), state: "saved" },
];

const mountNav = (active?: string) =>
  mount(OSectionNav, { props: { items, active, label: raw("Sections") } });

describe("OSectionNav", () => {
  it("renders one item per section in order", () => {
    const wrapper = mountNav();
    const ids = wrapper.findAll("button").map((b) => b.attributes("data-test"));
    expect(ids).toEqual([
      "o-section-nav-item-a",
      "o-section-nav-item-b",
      "o-section-nav-item-c",
      "o-section-nav-item-d",
    ]);
  });

  it("marks only the active item as the current location", () => {
    const wrapper = mountNav("b");
    expect(wrapper.find('[data-test="o-section-nav-item-b"]').attributes("aria-current")).toBe(
      "location",
    );
    expect(
      wrapper.find('[data-test="o-section-nav-item-a"]').attributes("aria-current"),
    ).toBeUndefined();
  });

  it("shows a state icon per section and words for attention and error", () => {
    const wrapper = mountNav();
    expect(wrapper.find('[data-test="o-section-nav-state-icon-done"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-section-nav-state-icon-saved"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-section-nav-state-icon-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-section-nav-state-attention"]').text()).toBe(
      "Needs a value",
    );
    expect(wrapper.find('[data-test="o-section-nav-state-error"]').text()).toBe("Needs a fix");
  });

  it("shows the summary phrase", () => {
    const wrapper = mountNav();
    expect(wrapper.find('[data-test="o-section-nav-summary-a"]').text()).toBe("logs_stream");
  });

  it("emits select with the section id on click", async () => {
    const wrapper = mountNav();
    await wrapper.find('[data-test="o-section-nav-item-c"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["c"]]);
  });
  it("words a changed section and marks it apart from a saved one", () => {
    const wrapper = mount(OSectionNav, {
      props: {
        items: [{ id: "x", title: raw("Fifth"), state: "changed", stateLabel: raw("Changed") }],
        label: raw("Sections"),
      },
    });
    expect(wrapper.find('[data-test="o-section-nav-state-changed"]').text()).toBe("Changed");
    expect(wrapper.find('[data-test="o-section-nav-state-icon-changed"]').classes()).toContain(
      "text-accent",
    );
  });
  it("scrolls the chip row so the current section's chip is in view", async () => {
    const wrapper = mount(OSectionNav, {
      attachTo: document.body,
      props: { items, active: "a", label: raw("Sections") },
    });
    const row = wrapper.find("ol").element as HTMLOListElement;
    Object.defineProperty(row, "scrollWidth", { configurable: true, value: 600 });
    Object.defineProperty(row, "clientWidth", { configurable: true, value: 300 });
    row.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 }) as DOMRect;
    const chip = wrapper.find('[data-test="o-section-nav-item-c"]').element as HTMLElement;
    chip.getBoundingClientRect = () => ({ left: 400, right: 500, width: 100 }) as DOMRect;
    const scrollTo = vi.fn();
    row.scrollTo = scrollTo as unknown as typeof row.scrollTo;
    await wrapper.setProps({ active: "c" });
    await new Promise((resolve) => setTimeout(resolve));
    expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: "smooth" });
    wrapper.unmount();
  });
});
