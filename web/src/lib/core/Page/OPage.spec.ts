// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OPage from "./OPage.vue";

describe("OPage", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function mountPage(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
    return mount(OPage, {
      props,
      slots,
    });
  }

  describe("rendering", () => {
    it("should render the component", () => {
      wrapper = mountPage();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render as a div by default", () => {
      wrapper = mountPage();
      expect(wrapper.element.tagName).toBe("DIV");
    });

    it("should render as a custom element when as prop is set", () => {
      wrapper = mountPage({ as: "main" });
      expect(wrapper.element.tagName).toBe("MAIN");
    });

    it("should have oo-page class", () => {
      wrapper = mountPage();
      expect(wrapper.classes()).toContain("oo-page");
    });

    it("should have tw:rounded-md class", () => {
      wrapper = mountPage();
      expect(wrapper.classes()).toContain("tw:rounded-md");
    });

    it("should have data-o2-page attribute", () => {
      wrapper = mountPage();
      expect(wrapper.attributes("data-o2-page")).toBeDefined();
    });
  });

  describe("slots", () => {
    it("should render default slot content", () => {
      wrapper = mountPage({}, { default: "<p class='page-content'>Page Content</p>" });
      expect(wrapper.find(".page-content").exists()).toBe(true);
      expect(wrapper.find(".page-content").text()).toBe("Page Content");
    });

    it("should render multiple elements in default slot", () => {
      wrapper = mountPage({}, { default: "<span>A</span><span>B</span>" });
      const spans = wrapper.findAll("span");
      expect(spans).toHaveLength(2);
    });
  });
});
