import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OModalFooter from "./OModalFooter.vue";

describe("OModalFooter", () => {
  it("renders slot content", () => {
    const wrapper = mount(OModalFooter, {
      slots: { default: '<button data-testid="action">Save</button>' },
    });
    expect(wrapper.find('[data-testid="action"]').exists()).toBe(true);
  });

  it("has border-top for visual separation from body", () => {
    const wrapper = mount(OModalFooter);
    expect(wrapper.classes().join(" ")).toContain("tw:border-t");
  });

  it("right-aligns content with justify-end", () => {
    const wrapper = mount(OModalFooter);
    expect(wrapper.classes().join(" ")).toContain("tw:justify-end");
  });

  it("applies horizontal padding and vertical padding", () => {
    const wrapper = mount(OModalFooter);
    const cls = wrapper.classes().join(" ");
    expect(cls).toContain("tw:px-6");
    expect(cls).toContain("tw:py-4");
  });

  it("shrinks to content height and does not grow", () => {
    const wrapper = mount(OModalFooter);
    expect(wrapper.classes().join(" ")).toContain("tw:shrink-0");
  });
});
