import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSkeleton from "./OSkeleton.vue";

describe("OSkeleton", () => {
  it("renders a span element", () => {
    const wrapper = mount(OSkeleton);
    expect(wrapper.find("span").exists()).toBe(true);
  });

  describe("type prop", () => {
    it("applies rounded-md and w-full for type=rect (default)", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("span").classes()).toContain("rounded-md");
      expect(wrapper.find("span").classes()).toContain("w-full");
    });

    it("applies rounded-full and aspect-square for type=circle", () => {
      const wrapper = mount(OSkeleton, { props: { type: "circle" } });
      expect(wrapper.find("span").classes()).toContain("rounded-full");
      expect(wrapper.find("span").classes()).toContain("aspect-square");
    });

    it("applies rounded and h-4 for type=text", () => {
      const wrapper = mount(OSkeleton, { props: { type: "text" } });
      expect(wrapper.find("span").classes()).toContain("rounded");
      expect(wrapper.find("span").classes()).toContain("h-4");
    });
  });

  describe("animation prop", () => {
    it("applies animate-pulse for animation=pulse", () => {
      const wrapper = mount(OSkeleton, { props: { animation: "pulse" } });
      expect(wrapper.find("span").classes()).toContain("animate-pulse");
    });

    it("applies skeleton-wave for animation=wave (default)", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("span").classes()).toContain("skeleton-wave");
    });

    it("applies no animation class for animation=none", () => {
      const wrapper = mount(OSkeleton, { props: { animation: "none" } });
      expect(wrapper.find("span").classes()).not.toContain("animate-pulse");
      expect(wrapper.find("span").classes()).not.toContain("skeleton-wave");
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
