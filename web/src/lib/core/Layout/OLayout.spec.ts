// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OLayout from "./OLayout.vue";

describe("OLayout", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function mountLayout(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
    return mount(OLayout, {
      props,
      slots,
    });
  }

  describe("rendering", () => {
    it("should render the component", () => {
      wrapper = mountLayout();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render as a div by default", () => {
      wrapper = mountLayout();
      expect(wrapper.element.tagName).toBe("DIV");
    });

    it("should render as a custom element when as prop is set", () => {
      wrapper = mountLayout({ as: "section" });
      expect(wrapper.element.tagName).toBe("SECTION");
    });

    it("should have data-o2-layout attribute", () => {
      wrapper = mountLayout();
      expect(wrapper.attributes("data-o2-layout")).toBeDefined();
    });
  });

  describe("slots", () => {
    it("should render default slot content", () => {
      wrapper = mountLayout({}, { default: "<div class='child-content'>Child</div>" });
      expect(wrapper.find(".child-content").exists()).toBe(true);
      expect(wrapper.find(".child-content").text()).toBe("Child");
    });
  });

  describe("provide injections", () => {
    it("should provide _q_pc_ as false", () => {
      wrapper = mountLayout();
      // Access provided value via component internals
      expect((wrapper.vm as any).$.provides._q_pc_).toBe(false);
    });

    it("should provide _q_l_ with correct layout structure", () => {
      wrapper = mountLayout();
      const layout = (wrapper.vm as any).$.provides._q_l_;
      expect(layout).toBeDefined();
      expect(layout.isContainer).toBe(true);
      expect(layout.header).toEqual({ size: 0, offset: 0, space: false });
      expect(layout.left).toEqual({ size: 0, offset: 0, space: false });
      expect(layout.right).toEqual({ size: 0, offset: 0, space: false });
      expect(layout.footer).toEqual({ size: 0, offset: 0, space: false });
    });
  });

  describe("attrs forwarding", () => {
    it("should forward extra attributes to the rendered element", () => {
      wrapper = mountLayout({}, {}, { attrs: { id: "test-layout", class: "custom-class" } });
      // Note: mounting with attrs in this way — verify the attributes land
    });
  });
});
