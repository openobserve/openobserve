import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OSkeleton from "./OSkeleton.vue";

describe("OSkeleton", () => {
  it("renders a span element", () => {
    const wrapper = mount(OSkeleton);
    expect(wrapper.find("span").exists()).toBe(true);
  });

  describe("type prop", () => {
    it("applies rounded-default and w-full for type=rect (default)", () => {
      const wrapper = mount(OSkeleton);
      expect(wrapper.find("span").classes()).toContain("rounded-default");
      expect(wrapper.find("span").classes()).toContain("w-full");
    });

    it("applies rounded-full and aspect-square for type=circle", () => {
      const wrapper = mount(OSkeleton, { props: { type: "circle" } });
      expect(wrapper.find("span").classes()).toContain("rounded-full");
      expect(wrapper.find("span").classes()).toContain("aspect-square");
    });

    it("applies rounded-default and h-4 for type=text", () => {
      const wrapper = mount(OSkeleton, { props: { type: "text" } });
      expect(wrapper.find("span").classes()).toContain("rounded-default");
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

  // Tailwind resolves conflicts by CSS source order, not class order, so a
  // baked-in w-full silently beat every caller width — sized skeletons rendered
  // full-bleed app-wide. The default must stand down when the caller sizes it.
  describe("caller size overrides", () => {
    it("should drop the default w-full when the caller sets a width", () => {
      const wrapper = mount(OSkeleton, { attrs: { class: "w-1/2" } });
      const classes = wrapper.find("span").classes();
      expect(classes).not.toContain("w-full");
      expect(classes).toContain("w-1/2");
    });

    it("should drop the default w-full for an arbitrary width value", () => {
      const wrapper = mount(OSkeleton, { attrs: { class: "w-[0.875rem] h-[0.875rem]" } });
      expect(wrapper.find("span").classes()).not.toContain("w-full");
    });

    it("should drop the default w-full when the caller uses flex-1", () => {
      const wrapper = mount(OSkeleton, { attrs: { class: "flex-1" } });
      expect(wrapper.find("span").classes()).not.toContain("w-full");
    });

    it("should drop only h-4 for type=text when the caller sets height alone", () => {
      const wrapper = mount(OSkeleton, { props: { type: "text" }, attrs: { class: "h-3" } });
      const classes = wrapper.find("span").classes();
      expect(classes).not.toContain("h-4");
      expect(classes).toContain("w-full");
      expect(classes).toContain("rounded-default");
    });

    it("should keep both defaults for type=text when the caller sets neither axis", () => {
      const wrapper = mount(OSkeleton, { props: { type: "text" }, attrs: { class: "shrink-0" } });
      const classes = wrapper.find("span").classes();
      expect(classes).toContain("w-full");
      expect(classes).toContain("h-4");
    });

    it("should never impose an axis on type=circle, which derives height from width", () => {
      const wrapper = mount(OSkeleton, { props: { type: "circle" }, attrs: { class: "w-4" } });
      const classes = wrapper.find("span").classes();
      expect(classes).not.toContain("w-full");
      expect(classes).not.toContain("h-4");
      expect(classes).toContain("aspect-square");
    });
  });
});
