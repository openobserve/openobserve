import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OButtonGroup from "./OButtonGroup.vue";
import OButton from "./OButton.vue";

describe("OButtonGroup", () => {
  it('renders with role="group" and its children', () => {
    const wrapper = mount(OButtonGroup, {
      slots: { default: () => [h(OButton, () => "Day"), h(OButton, () => "Week")] },
    });
    expect(wrapper.attributes("role")).toBe("group");
    expect(wrapper.findAllComponents(OButton)).toHaveLength(2);
  });

  it("is always horizontal and divided", () => {
    const classes = mount(OButtonGroup).classes();
    expect(classes).toContain("flex-row");
    expect(classes).toContain("divide-x");
    expect(classes).toContain("[&>*:not(:first-child)]:border-s-0");
  });

  it("never clips overflow, so a child's offset focus outline stays visible", () => {
    const classes = mount(OButtonGroup).classes();
    expect(classes.some((c) => c.startsWith("overflow-"))).toBe(false);
    expect(classes).toContain("[&_:focus-visible]:z-1");
  });

  it("hands its size to the children", () => {
    const wrapper = mount(OButtonGroup, {
      props: { size: "xs" },
      slots: { default: () => [h(OButton, () => "Fit")] },
    });
    expect(wrapper.findComponent(OButton).classes()).toContain("h-control-xs");
  });

  it("passes extra attributes to the wrapper div", () => {
    const wrapper = mount(OButtonGroup, { attrs: { "data-test": "zoom" } });
    expect(wrapper.attributes("data-test")).toBe("zoom");
  });
});
