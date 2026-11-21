import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, h } from "vue";

vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isMobile: computed(() => true) }),
}));

import OToggleGroup from "./OToggleGroup.vue";
import OToggleGroupItem from "./OToggleGroupItem.vue";

describe("OToggleGroup as a mobile dropdown", () => {
  it("puts aria-describedby on the dropdown trigger a screen reader enters, once", () => {
    const wrapper = mount(OToggleGroup, {
      props: { mobileDropdown: true, type: "single", modelValue: "a" },
      attrs: { "aria-describedby": "line-1", "data-test": "tier" },
      slots: {
        default: () => [
          h(OToggleGroupItem, { value: "a" }, () => "A"),
          h(OToggleGroupItem, { value: "b" }, () => "B"),
        ],
      },
    });
    const trigger = wrapper.get('[data-test="tier-dropdown-btn"]');
    expect(trigger.attributes("aria-describedby")).toBe("line-1");
    expect(wrapper.findAll("[aria-describedby]")).toHaveLength(1);
  });
});
