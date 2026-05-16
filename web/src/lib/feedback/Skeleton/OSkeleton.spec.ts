import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSkeleton from "./OSkeleton.vue";

describe("OSkeleton", () => {
  it("renders a span element", () => {
    const wrapper = mount(OSkeleton);
    expect(wrapper.find("span").exists()).toBe(true);
  });

  describe("type prop", () => {
    it("applies tw:rounded-md and tw:w-full for type=rect (default)", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("span").classes()).toContain("tw:rounded-md");
      expect(wrapper.find("span").classes()).toContain("tw:w-full");
    });

    it("applies tw:rounded-full and tw:aspect-square for type=circle", () => {
      const wrapper = mount(OSkeleton, { props: { type: "circle" } });
      expect(wrapper.find("span").classes()).toContain("tw:rounded-full");
      expect(wrapper.find("span").classes()).toContain("tw:aspect-square");
    });

    it("applies tw:rounded and tw:h-4 for type=text", () => {
      const wrapper = mount(OSkeleton, { props: { type: "text" } });
      expect(wrapper.find("span").classes()).toContain("tw:rounded");
      expect(wrapper.find("span").classes()).toContain("tw:h-4");
    });
  });

  describe("animation prop", () => {
    it("applies tw:animate-pulse for animation=pulse (default)", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("span").classes()).toContain("tw:animate-pulse");
    });

    it("applies tw:skeleton-wave for animation=wave", () => {
      const wrapper = mount(OSkeleton, { props: { animation: "wave" } });
      expect(wrapper.find("span").classes()).toContain("tw:skeleton-wave");
    });

    it("applies no animation class for animation=none", () => {
      const wrapper = mount(OSkeleton, { props: { animation: "none" } });
      expect(wrapper.find("span").classes()).not.toContain("tw:animate-pulse");
      expect(wrapper.find("span").classes()).not.toContain("tw:skeleton-wave");
    });
  });

  describe("accessibility", () => {
    it("has role=status", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("[role='status']").exists()).toBe(true);
    });

    it("has aria-busy=true", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("[role='status']").attributes("aria-busy")).toBe("true");
    });

    it("has aria-label=Loading", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("[role='status']").attributes("aria-label")).toBe("Loading");
    });
  });
});
