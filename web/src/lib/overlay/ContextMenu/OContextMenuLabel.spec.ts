import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OContextMenuLabel from "./OContextMenuLabel.vue";

describe("OContextMenuLabel", () => {
  it("renders slot content", () => {
    const wrapper = mount(OContextMenuLabel, {
      slots: { default: "kubernetes_namespace_name" },
    });
    expect(wrapper.text()).toContain("kubernetes_namespace_name");
  });

  it("applies label token class", () => {
    const wrapper = mount(OContextMenuLabel);
    expect(wrapper.classes().join(" ")).toContain("text-dropdown-label");
  });

  it("truncates long labels rather than widening the menu", () => {
    const wrapper = mount(OContextMenuLabel);
    expect(wrapper.classes().join(" ")).toContain("truncate");
  });
});
