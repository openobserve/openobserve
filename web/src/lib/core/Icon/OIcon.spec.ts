import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OIcon from "./OIcon.vue";

describe("OIcon", () => {
  it("renders a span wrapper with the default size class (md = 24px)", () => {
    const wrapper = mount(OIcon, { props: { name: "close" } });
    expect(wrapper.find("span").classes()).toContain("tw:size-6");
  });

  it("applies the correct size class for each size value", () => {
    const cases: Array<[NonNullable<import("./OIcon.types").IconProps["size"]>, string]> = [
      ["xs", "tw:size-3"],
      ["sm", "tw:size-4"],
      ["md", "tw:size-6"],
      ["lg", "tw:size-8"],
      ["xl", "tw:size-10"],
    ];

    for (const [size, expected] of cases) {
      const wrapper = mount(OIcon, { props: { name: "close", size } });
      expect(wrapper.find("span").classes()).toContain(expected);
    }
  });

  it("is aria-hidden when no label is provided", () => {
    const wrapper = mount(OIcon, { props: { name: "close" } });
    expect(wrapper.find("span").attributes("aria-hidden")).toBe("true");
  });

  it("adds role=img and aria-label when label is provided", () => {
    const wrapper = mount(OIcon, {
      props: { name: "close", label: "Close dialog" },
    });
    const span = wrapper.find("span");
    expect(span.attributes("role")).toBe("img");
    expect(span.attributes("aria-label")).toBe("Close dialog");
    expect(span.attributes("aria-hidden")).toBeUndefined();
  });

  it("renders the default slot", () => {
    const wrapper = mount(OIcon, {
      props: { name: "info" },
      slots: { default: () => h("span", { class: "tooltip-stub" }, "tip") },
    });
    expect(wrapper.find(".tooltip-stub").exists()).toBe(true);
  });

  it("renders a child component (the icon SVG placeholder)", () => {
    const wrapper = mount(OIcon, { props: { name: "settings" } });
    // The inner component rendered by unplugin-icons is a Vue component —
    // verify the wrapper renders something inside the span.
    expect(wrapper.find("span").element.children.length).toBeGreaterThan(0);
  });
});
