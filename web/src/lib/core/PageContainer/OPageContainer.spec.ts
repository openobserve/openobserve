// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OPageContainer from "./OPageContainer.vue";

describe("OPageContainer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function mountPageContainer(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
    return mount(OPageContainer, {
      props,
      slots,
    });
  }

  describe("rendering", () => {
    it("should render the component", () => {
      wrapper = mountPageContainer();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render as a div by default", () => {
      wrapper = mountPageContainer();
      expect(wrapper.element.tagName).toBe("DIV");
    });

    it("should render as a custom element when as prop is set", () => {
      wrapper = mountPageContainer({ as: "section" });
      expect(wrapper.element.tagName).toBe("SECTION");
    });

    it("should have data-o2-page-container attribute", () => {
      wrapper = mountPageContainer();
      expect(wrapper.attributes("data-o2-page-container")).toBeDefined();
    });
  });

  describe("slots", () => {
    it("should render default slot content", () => {
      wrapper = mountPageContainer({}, { default: "<div class='inner'>Inside</div>" });
      expect(wrapper.find(".inner").exists()).toBe(true);
      expect(wrapper.find(".inner").text()).toBe("Inside");
    });
  });

  describe("provide injections", () => {
    it("should provide _q_pc_ as true", () => {
      wrapper = mountPageContainer();
      expect((wrapper.vm as any).$.provides._q_pc_).toBe(true);
    });
  });
});
