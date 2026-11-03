// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OTextarea from "./OTextarea.vue";

describe("OTextarea", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders without errors", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a textarea element", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OTextarea, { props: { label: "Description" } });
    expect(wrapper.find("label").text()).toBe("Description");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(OTextarea, { props: { modelValue: "" } });
    await wrapper.find("textarea").setValue("hello world");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("hello world");
  });

  it("shows error message when provided", () => {
    wrapper = mount(OTextarea, {
      props: { error: true, errorMessage: "Required field" },
    });
    expect(wrapper.text()).toContain("Required field");
  });

  it("shows helpText when provided", () => {
    wrapper = mount(OTextarea, {
      props: { helpText: "Enter a description" },
    });
    expect(wrapper.text()).toContain("Enter a description");
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OTextarea, { props: { disabled: true } });
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();
  });

  it("shows counter when maxlength is set", () => {
    wrapper = mount(OTextarea, {
      props: { maxlength: 200, modelValue: "hello" },
    });
    expect(wrapper.text()).toContain("5/200");
  });

  it("routes aria-* attrs to the real control, not the wrapper", () => {
    wrapper = mount(OTextarea, {
      attrs: { "aria-label": "Name", "aria-labelledby": "lbl", "aria-describedby": "desc" },
    });
    const control = wrapper.find("textarea");
    expect(control.attributes("aria-label")).toBe("Name");
    expect(control.attributes("aria-labelledby")).toBe("lbl");
    expect(control.attributes("aria-describedby")).toBe("desc");
    expect(wrapper.element.getAttribute("aria-label")).toBeNull();
    expect(wrapper.element.getAttribute("aria-labelledby")).toBeNull();
    expect(wrapper.element.getAttribute("aria-describedby")).toBeNull();
  });

  it("warns when mounted without a label or aria name", () => {
    vi.stubEnv("MODE", "development");
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(OTextarea).unmount();
    mount(OTextarea, { attrs: { "aria-label": "Name" } }).unmount();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OTextarea"));
  });
});
