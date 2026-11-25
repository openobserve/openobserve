import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ODropdownGroup from "./ODropdownGroup.vue";

describe("ODropdownGroup", () => {
  it("renders children inside the group", () => {
    const wrapper = mount(ODropdownGroup, {
      slots: { default: '<div data-testid="item">Item</div>' },
    });
    expect(wrapper.find('[data-testid="item"]').exists()).toBe(true);
  });

  it("renders a label when label prop is provided", () => {
    const wrapper = mount(ODropdownGroup, {
      props: { label: "Actions" },
    });
    expect(wrapper.text()).toContain("Actions");
  });

  it("styles the label as a sentence-case group header", () => {
    const wrapper = mount(ODropdownGroup, { props: { label: "Actions" } });
    const label = wrapper.get(".font-medium");
    expect(label.classes()).toEqual(
      expect.arrayContaining([
        "text-xs",
        "font-medium",
        "text-text-secondary",
        "px-2",
        "pt-2",
        "pb-1",
      ]),
    );
    expect(label.classes()).not.toContain("uppercase");
  });

  it("does not render a label element when label prop is absent", () => {
    const wrapper = mount(ODropdownGroup);
    expect(wrapper.text().trim()).toBe("");
  });
});
