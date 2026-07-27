import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OContextMenuSeparator from "./OContextMenuSeparator.vue";

describe("OContextMenuSeparator", () => {
  it("renders a separator element", () => {
    const wrapper = mount(OContextMenuSeparator);
    expect(wrapper.element).toBeTruthy();
  });

  it("applies separator bg class", () => {
    const wrapper = mount(OContextMenuSeparator);
    expect(wrapper.classes().join(" ")).toContain("bg-dropdown-separator");
  });
});
