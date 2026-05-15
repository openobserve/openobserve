import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OToggleGroup from "./OToggleGroup.vue";
import OToggleGroupItem from "./OToggleGroupItem.vue";

// OToggleGroupItem requires a ToggleGroupRoot context — mount inside OToggleGroup
function mountItem(
  itemProps: Record<string, unknown> = {},
  slots: Record<string, () => ReturnType<typeof h>> = {},
) {
  return mount(OToggleGroup, {
    slots: {
      default: { render: () => h(OToggleGroupItem, itemProps, slots) },
    },
  });
}

describe("OToggleGroupItem", () => {
  it("renders slot content", () => {
    const wrapper = mountItem(
      { value: "x" },
      { default: () => h("span", "Option") },
    );
    expect(wrapper.text()).toContain("Option");
  });

  it("renders icon-left slot", () => {
    const wrapper = mountItem(
      { value: "x" },
      {
        "icon-left": () => h("span", { "data-testid": "icon-left" }, "←"),
      },
    );
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders icon-right slot", () => {
    const wrapper = mountItem(
      { value: "x" },
      {
        "icon-right": () => h("span", { "data-testid": "icon-right" }, "→"),
      },
    );
    expect(wrapper.find('[data-testid="icon-right"]').exists()).toBe(true);
  });

  it("applies base item classes", () => {
    const wrapper = mountItem(
      { value: "x" },
      { default: () => h("span", "A") },
    );
    const btn = wrapper.find("button");
    expect(btn.classes().join(" ")).toContain("tw:bg-toggle-item-bg");
  });

  it("sets data-disabled when disabled=true", () => {
    const wrapper = mountItem({ value: "x", disabled: true });
    const btn = wrapper.find("button");
    expect(btn.attributes("data-disabled")).toBeDefined();
  });

  // --- Size classes ---

  it("applies md size classes by default", () => {
    const wrapper = mountItem({ value: "x" });
    const classes = wrapper.find("button").classes().join(" ");
    expect(classes).toContain("tw:h-9");
    expect(classes).toContain("tw:px-3");
  });

  it('applies xs size classes when size="xs"', () => {
    const wrapper = mountItem({ value: "x", size: "xs" });
    const classes = wrapper.find("button").classes().join(" ");
    expect(classes).toContain("tw:h-3");
    expect(classes).toContain("tw:px-1.5");
    expect(classes).toContain("tw:text-xs");
  });
});
