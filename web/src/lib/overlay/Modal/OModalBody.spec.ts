import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OModalBody from "./OModalBody.vue";

describe("OModalBody", () => {
  it("renders slot content", () => {
    const wrapper = mount(OModalBody, {
      slots: { default: '<p data-testid="body-content">Body text</p>' },
    });
    expect(wrapper.find('[data-testid="body-content"]').exists()).toBe(true);
  });

  it("adds overflow-y-auto by default (scrollable=true)", () => {
    const wrapper = mount(OModalBody);
    expect(wrapper.classes().join(" ")).toContain("tw:overflow-y-auto");
  });

  it("adds overflow-hidden when scrollable=false", () => {
    const wrapper = mount(OModalBody, { props: { scrollable: false } });
    expect(wrapper.classes().join(" ")).toContain("tw:overflow-hidden");
  });

  it("applies flex-1 so it fills remaining modal height", () => {
    const wrapper = mount(OModalBody);
    expect(wrapper.classes().join(" ")).toContain("tw:flex-1");
  });

  it("applies horizontal and vertical padding", () => {
    const wrapper = mount(OModalBody);
    const cls = wrapper.classes().join(" ");
    expect(cls).toContain("tw:px-6");
    expect(cls).toContain("tw:py-4");
  });
});
