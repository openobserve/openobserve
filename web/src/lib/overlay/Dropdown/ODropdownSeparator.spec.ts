import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ODropdownSeparator from "./ODropdownSeparator.vue";

describe("ODropdownSeparator", () => {
  it("renders a separator element", () => {
    const wrapper = mount(ODropdownSeparator);
    expect(wrapper.element).toBeTruthy();
  });

  it("applies separator bg class", () => {
    const wrapper = mount(ODropdownSeparator);
    expect(wrapper.classes().join(" ")).toContain("tw:bg-dropdown-separator");
  });
});
