import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCard from "./OCard.vue";

describe("OCard", () => {
  it("renders slot content", () => {
    const wrapper = mount(OCard, { slots: { default: "<p>Content</p>" } });
    expect(wrapper.html()).toContain("Content");
  });

  it("applies card background token class", () => {
    const wrapper = mount(OCard);
    expect(wrapper.classes().join(" ")).toContain("tw:bg-card-bg");
  });

  it("applies card text token class", () => {
    const wrapper = mount(OCard);
    expect(wrapper.classes().join(" ")).toContain("tw:text-card-text");
  });

  it("forwards additional class via attrs", () => {
    const wrapper = mount(OCard, { attrs: { class: "tw:w-full" } });
    expect(wrapper.classes()).toContain("tw:w-full");
  });

  it("forwards data-test via attrs", () => {
    const wrapper = mount(OCard, { attrs: { "data-test": "my-card" } });
    expect(wrapper.attributes("data-test")).toBe("my-card");
  });

  it("forwards style via attrs", () => {
    const wrapper = mount(OCard, { attrs: { style: "min-width: 500px" } });
    expect(wrapper.attributes("style")).toContain("min-width");
  });
});
