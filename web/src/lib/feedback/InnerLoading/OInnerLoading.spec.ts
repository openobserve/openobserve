import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OInnerLoading from "./OInnerLoading.vue";

describe("OInnerLoading", () => {
  it("does not render when showing=false", () => {
    const wrapper = mount(OInnerLoading, { props: { showing: false } });
    expect(wrapper.find("[role='status']").exists()).toBe(false);
  });

  it("renders overlay when showing=true", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").exists()).toBe(true);
  });

  it("renders OSpinner inside the overlay", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.findComponent({ name: "OSpinner" }).exists()).toBe(true);
  });

  it("renders label text when label prop is provided", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true, label: "Fetching values..." },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.text()).toContain("Fetching values...");
  });

  it("does not render label span when no label prop", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("span.tw\\:text-xs.tw\\:text-inner-loading-label").exists()).toBe(false);
  });

  it("sets aria-label to label text when provided", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true, label: "Fetching values..." },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").attributes("aria-label")).toBe(
      "Fetching values..."
    );
  });

  it("defaults aria-label to 'Loading' when no label", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    expect(wrapper.find("[role='status']").attributes("aria-label")).toBe(
      "Loading"
    );
  });

  it("applies absolute+inset-0 overlay positioning", () => {
    const wrapper = mount(OInnerLoading, {
      props: { showing: true },
      global: { stubs: { transition: false } },
    });
    const overlay = wrapper.find("[role='status']");
    expect(overlay.classes()).toContain("tw:absolute");
    expect(overlay.classes()).toContain("tw:inset-0");
  });
});
