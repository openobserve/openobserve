import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTimeline from "./OTimeline.vue";

describe("OTimeline", () => {
  it("renders an ordered list", () => {
    const wrapper = mount(OTimeline, {
      slots: { default: "<li>item</li>" },
    });
    expect(wrapper.element.tagName).toBe("OL");
  });

  it("passes through attrs to the root element", () => {
    const wrapper = mount(OTimeline, {
      attrs: { "data-test": "my-timeline" },
      slots: { default: "<li>item</li>" },
    });
    expect(wrapper.attributes("data-test")).toBe("my-timeline");
  });

  it("renders slotted content", () => {
    const wrapper = mount(OTimeline, {
      slots: { default: '<li class="item-a">A</li><li class="item-b">B</li>' },
    });
    expect(wrapper.find(".item-a").exists()).toBe(true);
    expect(wrapper.find(".item-b").exists()).toBe(true);
  });
});
