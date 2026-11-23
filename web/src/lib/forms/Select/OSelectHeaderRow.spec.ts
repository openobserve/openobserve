// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSelectHeaderRow from "./OSelectHeaderRow.vue";
import { raw } from "@/types/i18n";

describe("OSelectHeaderRow", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders the label bold with the count after a separator", () => {
    wrapper = mount(OSelectHeaderRow, {
      props: { label: raw("Internal streams"), count: raw("3 hidden") },
    });
    expect(wrapper.find(".font-bold").text()).toBe("Internal streams");
    expect(wrapper.text()).toContain("3 hidden");
    const hidden = wrapper.findAll('[aria-hidden="true"]').map((el) => el.text());
    expect(hidden).toContain("·");
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("renders the action as a named button and emits action on click", async () => {
    wrapper = mount(OSelectHeaderRow, {
      attrs: { "data-test": "row" },
      props: {
        label: raw("Internal streams"),
        action: raw("Show"),
        actionAriaLabel: raw("Show internal streams"),
      },
    });
    const button = wrapper.find('[data-test="row-action"]');
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-label")).toBe("Show internal streams");
    expect(button.text()).toBe("Show");
    await button.trigger("click");
    expect(wrapper.emitted("action")).toHaveLength(1);
  });

  it("leaves out the count separator when there is no count", () => {
    wrapper = mount(OSelectHeaderRow, {
      props: { label: raw("Internal streams"), action: raw("Show") },
    });
    expect(wrapper.text()).not.toContain("·");
  });

  it("prevents mousedown so an open select keeps focus in its search input", async () => {
    wrapper = mount(OSelectHeaderRow, {
      props: { label: raw("Internal streams"), action: raw("Hide") },
    });
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    wrapper.find("button").element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("paints the option highlight and the action's hover fill while highlighted", async () => {
    wrapper = mount(OSelectHeaderRow, {
      props: { label: raw("Internal streams"), action: raw("Hide") },
    });
    expect(wrapper.classes()).toContain("bg-select-header-bg");
    expect(wrapper.classes()).not.toContain("bg-select-item-hover-bg");
    expect(wrapper.find("button").classes()).toContain("bg-transparent");
    expect(wrapper.attributes("data-highlighted")).toBeUndefined();
    await wrapper.setProps({ highlighted: true });
    expect(wrapper.attributes("data-highlighted")).toBe("");
    expect(wrapper.classes()).toContain("bg-select-item-hover-bg");
    expect(wrapper.classes()).not.toContain("bg-select-header-bg");
    expect(wrapper.find("button").classes()).toContain("bg-select-header-action-hover-bg");
  });
});
