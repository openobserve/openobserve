// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OCombobox from "./OCombobox.vue";

describe("OCombobox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes aria-* attrs to the real control, not the wrapper", () => {
    wrapper = mount(OCombobox, {
      props: { items: [] },
      attrs: { "aria-label": "Name", "aria-labelledby": "lbl", "aria-describedby": "desc" },
    });
    const control = wrapper.find("input");
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
    mount(OCombobox, { props: { items: [] } }).unmount();
    mount(OCombobox, { attrs: { "aria-label": "Name" }, props: { items: [] } }).unmount();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OCombobox"));
  });
});
