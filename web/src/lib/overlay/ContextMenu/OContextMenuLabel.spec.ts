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

  it("uses the shared sentence-case group header style", () => {
    const wrapper = mount(OContextMenuLabel);
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([
        "text-xs",
        "font-medium",
        "text-text-secondary",
        "px-2",
        "pt-2",
        "pb-1",
      ]),
    );
    expect(wrapper.classes()).not.toContain("uppercase");
  });

  it("truncates long labels rather than widening the menu", () => {
    const wrapper = mount(OContextMenuLabel);
    expect(wrapper.classes().join(" ")).toContain("truncate");
  });
});
