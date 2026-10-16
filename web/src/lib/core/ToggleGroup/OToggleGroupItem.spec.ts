import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h, nextTick, reactive } from "vue";
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
    const wrapper = mountItem({ value: "x" }, { default: () => h("span", "Option") });
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
    const wrapper = mountItem({ value: "x" }, { default: () => h("span", "A") });
    const btn = wrapper.find("button");
    expect(btn.classes().join(" ")).toContain("bg-toggle-item-bg");
  });

  it("sets data-disabled when disabled=true", () => {
    const wrapper = mountItem({ value: "x", disabled: true });
    const btn = wrapper.find("button");
    expect(btn.attributes("data-disabled")).toBeDefined();
  });

  it("focuses the unavailable reason without changing the selection", async () => {
    const wrapper = mountItem(
      { value: "x", disabled: true, focusableUnavailable: true, tooltip: "Run the query first" },
      { default: () => h("span", "Visualize") },
    );
    const reasonControl = wrapper.find('[role="button"][aria-disabled="true"]');
    expect(reasonControl.attributes("tabindex")).toBe("0");
    expect(reasonControl.attributes("aria-label")).toBeUndefined();
    const label = wrapper.get(`#${reasonControl.attributes("aria-labelledby")}`);
    expect(label.text()).toBe("Visualize");
    expect(label.attributes("aria-hidden")).toBeUndefined();
    expect(reasonControl.get("button").attributes("aria-hidden")).toBe("true");
    expect(wrapper.find(`#${reasonControl.attributes("aria-describedby")}`).text()).toBe(
      "Run the query first",
    );
    await reasonControl.trigger("keydown", { key: "Enter" });
    await reasonControl.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("keeps the icon-only unavailable wrapper name separate from its reason", () => {
    const wrapper = mountItem({
      value: "x",
      disabled: true,
      focusableUnavailable: true,
      "aria-label": "Visualize",
      tooltip: "Run the query first",
      iconLeft: "timeline",
    });
    const control = wrapper.get('[role="button"][aria-disabled="true"]');
    expect(control.attributes("aria-label")).toBe("Visualize");
    const reason = wrapper.get(`#${control.attributes("aria-describedby")}`);
    expect(reason.text()).toBe("Run the query first");
    expect(reason.attributes("aria-hidden")).toBe("true");
    wrapper.unmount();
  });

  it("exposes only the unavailable wrapper when the Timechart text is collapsed", async () => {
    const props = reactive({
      value: "timechart",
      disabled: true,
      focusableUnavailable: true,
      "aria-label": "Timechart",
      tooltip: "Run the query first",
      iconLeft: "timeline",
    });
    const wrapper = mountItem(props);
    const control = wrapper.get('[role="button"][aria-disabled="true"]');
    const inner = control.get("button");
    expect(control.attributes("aria-label")).toBe("Timechart");
    expect(control.attributes("aria-labelledby")).toBeUndefined();
    expect(control.attributes("tabindex")).toBe("0");
    expect(control.attributes("aria-hidden")).toBeUndefined();
    expect(inner.attributes("aria-hidden")).toBe("true");
    expect(inner.attributes("disabled")).toBeDefined();
    expect(wrapper.get(`#${control.attributes("aria-describedby")}`).text()).toBe(
      "Run the query first",
    );
    await control.trigger("click");
    await control.trigger("keydown", { key: "Enter" });
    await control.trigger("keydown", { key: " " });
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    props.disabled = false;
    await nextTick();
    expect(wrapper.get("button").attributes("aria-hidden")).toBeUndefined();
    expect(wrapper.find('[role="button"][aria-disabled="true"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("applies md size classes by default", () => {
    const wrapper = mountItem({ value: "x" });
    const classes = wrapper.find("button").classes().join(" ");
    expect(classes).toContain("h-9");
    expect(classes).toContain("px-3");
  });

  it('applies xs size classes when size="xs"', () => {
    const wrapper = mountItem({ value: "x", size: "xs" });
    const classes = wrapper.find("button").classes().join(" ");
    expect(classes).toContain("h-5");
    expect(classes).toContain("px-1.5");
    expect(classes).toContain("text-xs");
  });
});
