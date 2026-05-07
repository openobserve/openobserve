import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
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
    expect(wrapper.classes().join(" ")).toContain("tw:flex-row");
  });

  it("applies horizontal divide-x class by default", () => {
    const wrapper = mount(OButtonGroup);
    expect(wrapper.classes().join(" ")).toContain("tw:divide-x");
  });

  // --- Orientation: vertical ---

  it('applies vertical flex classes when orientation="vertical"', () => {
    const wrapper = mount(OButtonGroup, { props: { orientation: "vertical" } });
    expect(wrapper.classes().join(" ")).toContain("tw:flex-col");
  });

  it('applies vertical divide-y class when orientation="vertical"', () => {
    const wrapper = mount(OButtonGroup, { props: { orientation: "vertical" } });
    expect(wrapper.classes().join(" ")).toContain("tw:divide-y");
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

  // --- Attrs passthrough ---

  it("passes extra attributes to the wrapper div", () => {
    const wrapper = mount(OButtonGroup, {
      attrs: { "data-testid": "my-group" },
    });
    expect(wrapper.attributes("data-testid")).toBe("my-group");
  });
});
