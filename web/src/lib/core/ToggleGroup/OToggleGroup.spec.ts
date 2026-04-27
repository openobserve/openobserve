import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OToggleGroup from "./OToggleGroup.vue";
import OToggleGroupItem from "./OToggleGroupItem.vue";

function mountGroup(
  groupProps: Record<string, unknown> = {},
  items: Array<{ value: string; label: string; disabled?: boolean }> = [],
) {
  return mount(OToggleGroup, {
    props: groupProps,
    slots: {
      default: items.map((item) =>
        h(
          OToggleGroupItem,
          { value: item.value, disabled: item.disabled },
          () => item.label,
        ),
      ),
    },
  });
}

describe("OToggleGroup", () => {
  // --- Defaults ---

  it("renders without crashing", () => {
    const wrapper = mountGroup();
    expect(wrapper.exists()).toBe(true);
  });

  it("applies horizontal flex class by default", () => {
    const wrapper = mountGroup();
    expect(wrapper.classes().join(" ")).toContain("tw:flex-row");
  });

  it("applies outer border class", () => {
    const wrapper = mountGroup();
    expect(wrapper.classes().join(" ")).toContain("tw:border");
  });

  // --- Orientation ---

  it('applies vertical flex class when orientation="vertical"', () => {
    const wrapper = mountGroup({ orientation: "vertical" });
    expect(wrapper.classes().join(" ")).toContain("tw:flex-col");
  });

  // --- Children ---

  it("renders OToggleGroupItem children", () => {
    const wrapper = mountGroup({}, [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
  });

  // --- Controlled value ---

  it("emits update:modelValue when an item is clicked", async () => {
    const wrapper = mountGroup({ modelValue: "" }, [
      { value: "left", label: "Left" },
    ]);
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeDefined();
  });

  // --- v-model: active item has data-state=on ---

  it('marks the active item with data-state="on"', async () => {
    const wrapper = mountGroup({ modelValue: "left" }, [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ]);
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("data-state")).toBe("on");
    expect(buttons[1].attributes("data-state")).toBe("off");
  });
});
