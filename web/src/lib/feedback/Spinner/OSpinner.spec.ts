import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OSpinner from "./OSpinner.vue";

describe("OSpinner", () => {
  describe("variant: ring (default)", () => {
    it("renders an svg with animate-spin class", () => {
      const wrapper = mount(OSpinner);
      expect(wrapper.find("svg").exists()).toBe(true);
      expect(wrapper.find("svg").classes()).toContain("tw:animate-spin");
    });

    it("does not render dots", () => {
      const wrapper = mount(OSpinner, { props: { variant: "ring" } });
      expect(wrapper.findAll("span.tw\\:rounded-full").length).toBe(0);
    });
  });

  describe("variant: dots", () => {
    it("renders three dot spans", () => {
      const wrapper = mount(OSpinner, { props: { variant: "dots" } });
      const dots = wrapper.findAll("span[aria-hidden='true']");
      expect(dots.length).toBe(3);
    });

    it("does not render an svg", () => {
      const wrapper = mount(OSpinner, { props: { variant: "dots" } });
      expect(wrapper.find("svg").exists()).toBe(false);
    });

    it("applies staggered animation delays", () => {
      const wrapper = mount(OSpinner, { props: { variant: "dots" } });
      const dots = wrapper.findAll("span[aria-hidden='true']");
      expect(dots[0].attributes("style")).toContain("animation-delay: 0s");
      expect(dots[1].attributes("style")).toContain("animation-delay: 0.15s");
      expect(dots[2].attributes("style")).toContain("animation-delay: 0.3s");
    });
  });

  describe("sizes", () => {
    const sizes = ["xs", "sm", "md", "lg", "xl"] as const;
    const expectedClasses = {
      xs: "tw:size-4",
      sm: "tw:size-5",
      md: "tw:size-8",
      lg: "tw:size-12",
      xl: "tw:size-16",
    };

    sizes.forEach((size) => {
      it(`applies ${expectedClasses[size]} for size="${size}"`, () => {
        const wrapper = mount(OSpinner, { props: { size } });
        expect(wrapper.find("span[role='status']").classes()).toContain(
          expectedClasses[size]
        );
      });
    });
  });

  describe("accessibility", () => {
    it("has role=status", () => {
      const wrapper = mount(OSpinner);
      expect(wrapper.find("[role='status']").exists()).toBe(true);
    });

    it("has aria-label=Loading", () => {
      const wrapper = mount(OSpinner);
      expect(wrapper.find("[role='status']").attributes("aria-label")).toBe(
        "Loading"
      );
    });

    it("svg has aria-hidden=true", () => {
      const wrapper = mount(OSpinner, { props: { variant: "ring" } });
      expect(wrapper.find("svg").attributes("aria-hidden")).toBe("true");
    });
  });
});
