import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OButtonGroup from "./OButtonGroup.vue";
import OButton from "./OButton.vue";

describe("OButtonGroup", () => {
  // --- Role ---

  it('renders with role="group"', () => {
    const wrapper = mount(OButtonGroup);
    expect(wrapper.attributes("role")).toBe("group");
  });

  // --- Slot ---

  it("renders slotted children", () => {
    const wrapper = mount(OButtonGroup, {
      slots: { default: "<button>A</button><button>B</button>" },
    });
    expect(wrapper.findAll("button")).toHaveLength(2);
  });

  // --- Orientation: horizontal (default) ---

  it("applies horizontal flex classes by default", () => {
    const wrapper = mount(OButtonGroup);
    expect(wrapper.classes().join(" ")).toContain("flex-row");
  });

  it("applies horizontal divide-x class by default", () => {
    const wrapper = mount(OButtonGroup);
    expect(wrapper.classes().join(" ")).toContain("divide-x");
  });

  // --- Orientation: vertical ---

  it('applies vertical flex classes when orientation="vertical"', () => {
    const wrapper = mount(OButtonGroup, { props: { orientation: "vertical" } });
    expect(wrapper.classes().join(" ")).toContain("flex-col");
  });

  it('applies vertical divide-y class when orientation="vertical"', () => {
    const wrapper = mount(OButtonGroup, { props: { orientation: "vertical" } });
    expect(wrapper.classes().join(" ")).toContain("divide-y");
  });

  // --- Border collapse between bordered children ---

  it("collapses the start border of every child after the first when horizontal", () => {
    const wrapper = mount(OButtonGroup);
    expect(wrapper.classes()).toContain("[&>*:not(:first-child)]:border-s-0");
  });

  it('collapses the top border of every child after the first when orientation="vertical"', () => {
    const wrapper = mount(OButtonGroup, { props: { orientation: "vertical" } });
    expect(wrapper.classes()).toContain("[&>*:not(:first-child)]:border-t-0");
  });

  // --- Integration: OButton children ---

  it("renders OButton children inside the group", () => {
    const wrapper = mount(OButtonGroup, {
      slots: {
        default: [OButton, OButton],
      },
    });
    expect(wrapper.findAll("button")).toHaveLength(2);
  });

  it("divides solid pending segments with the darker pending divider instead of the grey one", () => {
    const wrapper = mount(OButtonGroup, {
      slots: {
        default: () => [
          h(OButton, { variant: "pending" }, () => "Apply"),
          h(OButton, { variant: "pending", size: "icon-sm", iconLeft: "keyboard-arrow-down" }),
        ],
      },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.attributes("data-o2-variant")).toBe("pending");
      expect(button.classes()).toContain("border-button-pending-bg");
      expect(button.classes()).toContain("rounded-default");
    }
    expect(wrapper.classes()).toContain("[&>*:not(:first-child)]:border-s-0");
    expect(wrapper.classes()).toContain(
      "[&>[data-o2-variant=pending]:not(:last-child)]:border-e-button-pending-hover-bg",
    );
  });

  it("drops the pending divider when the group is not divided", () => {
    const wrapper = mount(OButtonGroup, { props: { divided: false } });
    expect(wrapper.classes().join(" ")).not.toContain("button-pending-hover-bg");
  });

  // --- Attrs passthrough ---

  it("passes extra attributes to the wrapper div", () => {
    const wrapper = mount(OButtonGroup, {
      attrs: { "data-testid": "my-group" },
    });
    expect(wrapper.attributes("data-testid")).toBe("my-group");
  });
});
